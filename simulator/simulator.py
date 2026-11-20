"""
simulator.py
============
Main entry point for the EV Fleet Telemetry Simulator.

Responsibilities
----------------
* Reads environment configuration (MQTT broker, fleet size, etc.)
* Instantiates a FleetOrchestrator that owns VirtualESP32 + VirtualEV instances
* Manages simulation lifecycle states (RUNNING, PAUSED, STOPPED)
* Manages a paho MQTT client (connect, subscribe to control topics, publish)
* Runs each virtual device as an independent asyncio task
* Hosts a FastAPI control-plane server on port 8001 via uvicorn
* Supports SIGINT / SIGTERM for graceful shutdown
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import signal
import sys
from enum import Enum
from typing import Optional

import paho.mqtt.client as mqtt
import uvicorn

from vehicle import VirtualEV
from virtual_esp32 import VirtualESP32
from api import create_app

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

_LOG_LEVEL = os.environ.get("LOG_LEVEL", "INFO").upper()
logging.basicConfig(
    level=_LOG_LEVEL,
    format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
    stream=sys.stdout,
)
logger = logging.getLogger("simulator")


# ---------------------------------------------------------------------------
# Simulation States
# ---------------------------------------------------------------------------

class SimState(str, Enum):
    RUNNING = "RUNNING"
    PAUSED  = "PAUSED"
    STOPPED = "STOPPED"


# ---------------------------------------------------------------------------
# FleetOrchestrator
# ---------------------------------------------------------------------------

class FleetOrchestrator:
    """Coordinates virtual vehicles, virtual ESP32 devices, MQTT, and control API."""

    def __init__(
        self,
        mqtt_broker: str,
        mqtt_port: int,
        fleet_id: str,
        fleet_size: int,
        publish_interval: float,
    ) -> None:
        self.mqtt_broker = mqtt_broker
        self.mqtt_port = mqtt_port
        self.fleet_id = fleet_id
        self.publish_interval = publish_interval

        # Simulation state machine
        self.state: SimState = SimState.RUNNING

        # vehicle_id -> VirtualEV
        self.vehicles: dict[str, VirtualEV] = {}
        # vehicle_id -> VirtualESP32
        self.devices: dict[str, VirtualESP32] = {}
        # vehicle_id -> asyncio.Task
        self._tasks: dict[str, asyncio.Task] = {}

        # Shared shutdown event
        self._stop_event: asyncio.Event = asyncio.Event()
        # MQTT client
        self._mqtt: mqtt.Client = self._build_mqtt_client()

        self._init_fleet(fleet_size)

    @property
    def is_running(self) -> bool:
        return self.state == SimState.RUNNING

    @property
    def is_paused(self) -> bool:
        return self.state == SimState.PAUSED

    @property
    def is_stopped(self) -> bool:
        return self.state == SimState.STOPPED

    def start_sim(self) -> str:
        self.state = SimState.RUNNING
        logger.info("Simulation state set to RUNNING")
        return self.state.value

    def pause_sim(self) -> str:
        self.state = SimState.PAUSED
        logger.info("Simulation state set to PAUSED")
        return self.state.value

    def resume_sim(self) -> str:
        self.state = SimState.RUNNING
        logger.info("Simulation state RESUMED -> RUNNING")
        return self.state.value

    def stop_sim(self) -> str:
        self.state = SimState.STOPPED
        logger.info("Simulation state set to STOPPED")
        return self.state.value

    # ------------------------------------------------------------------
    # Fleet helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _make_vehicle_id(n: int) -> str:
        return f"EV-{n:03d}"

    def _init_fleet(self, fleet_size: int) -> None:
        for i in range(1, fleet_size + 1):
            vid = self._make_vehicle_id(i)
            ev = VirtualEV(vid, self.fleet_id, self.publish_interval)
            device = VirtualESP32(ev, self.publish_interval)
            self.vehicles[vid] = ev
            self.devices[vid] = device
        logger.info(
            "Fleet '%s' initialised with %d vehicles and virtual ESP32 nodes",
            self.fleet_id,
            fleet_size,
        )

    # ------------------------------------------------------------------
    # MQTT setup
    # ------------------------------------------------------------------

    def _build_mqtt_client(self) -> mqtt.Client:
        client = mqtt.Client(
            client_id=f"simulator-{self.fleet_id}",
            clean_session=True,
            protocol=mqtt.MQTTv311,
        )
        client.on_connect = self._on_connect
        client.on_message = self._on_message
        client.on_disconnect = self._on_disconnect
        return client

    def _on_connect(self, client, userdata, flags, rc) -> None:
        if rc == 0:
            control_topic = f"fleet/{self.fleet_id}/ev/+/control"
            client.subscribe(control_topic, qos=1)
            logger.info(
                "MQTT connected to %s:%d | subscribed to %s",
                self.mqtt_broker,
                self.mqtt_port,
                control_topic,
            )
        else:
            logger.error("MQTT connection refused (rc=%d)", rc)

    def _on_disconnect(self, client, userdata, rc) -> None:
        if rc != 0:
            logger.warning(
                "MQTT unexpectedly disconnected (rc=%d). Will auto-reconnect.", rc
            )

    def _on_message(self, client, userdata, msg) -> None:
        """Handle incoming control messages on fleet/{fleet_id}/ev/{vehicle_id}/control."""
        try:
            parts = msg.topic.split("/")
            if len(parts) < 5:
                logger.warning("Unexpected topic structure: %s", msg.topic)
                return

            vehicle_id = parts[3]
            payload = json.loads(msg.payload.decode("utf-8"))
            scenario_name = payload.get("scenario")

            if not scenario_name:
                logger.warning("Control message missing 'scenario' key: %s", payload)
                return

            if vehicle_id.lower() == "all":
                for v in self.vehicles.values():
                    v.set_scenario(scenario_name)
                logger.info("Control: all vehicles set to scenario '%s'", scenario_name)
            else:
                vehicle = self.vehicles.get(vehicle_id)
                if vehicle is None:
                    logger.warning("Control message for unknown vehicle '%s'", vehicle_id)
                    return
                vehicle.set_scenario(scenario_name)
                logger.info("Control: %s scenario set to '%s'", vehicle_id, scenario_name)

        except json.JSONDecodeError:
            logger.error("Could not parse control payload: %s", msg.payload)
        except Exception:
            logger.exception("Error handling control message on topic %s", msg.topic)

    # ------------------------------------------------------------------
    # Dynamic scaling
    # ------------------------------------------------------------------

    async def scale(self, new_size: int) -> None:
        """Add or remove vehicle tasks to reach ``new_size``."""
        current_size = len(self.vehicles)

        if new_size > current_size:
            for i in range(current_size + 1, new_size + 1):
                vid = self._make_vehicle_id(i)
                ev = VirtualEV(vid, self.fleet_id, self.publish_interval)
                device = VirtualESP32(ev, self.publish_interval)
                self.vehicles[vid] = ev
                self.devices[vid] = device
                task = asyncio.create_task(
                    device.run(self._mqtt, self),
                    name=f"esp32-{vid}",
                )
                self._tasks[vid] = task
                logger.info("Scaled up: added %s (ESP32 node)", vid)

        elif new_size < current_size:
            sorted_ids = sorted(self.vehicles.keys(), reverse=True)
            to_remove = sorted_ids[: current_size - new_size]
            for vid in to_remove:
                task = self._tasks.pop(vid, None)
                if task and not task.done():
                    task.cancel()
                    try:
                        await task
                    except asyncio.CancelledError:
                        pass
                self.vehicles.pop(vid, None)
                self.devices.pop(vid, None)
                logger.info("Scaled down: removed %s", vid)

    # ------------------------------------------------------------------
    # Main async run
    # ------------------------------------------------------------------

    async def run(self) -> None:
        """Connect MQTT, launch device tasks, serve control API."""
        loop = asyncio.get_event_loop()

        for sig in (signal.SIGINT, signal.SIGTERM):
            try:
                loop.add_signal_handler(sig, self._stop_event.set)
            except NotImplementedError:
                signal.signal(sig, lambda *_: self._stop_event.set())

        logger.info(
            "Connecting to MQTT broker %s:%d ...", self.mqtt_broker, self.mqtt_port
        )
        try:
            await loop.run_in_executor(
                None,
                lambda: self._mqtt.connect(
                    self.mqtt_broker, self.mqtt_port, keepalive=60
                ),
            )
        except Exception as exc:
            logger.error("Failed to connect to MQTT broker: %s", exc)

        self._mqtt.loop_start()

        # Start all VirtualESP32 device tasks
        for vid, device in self.devices.items():
            task = asyncio.create_task(
                device.run(self._mqtt, self),
                name=f"esp32-{vid}",
            )
            self._tasks[vid] = task
        logger.info("Started %d virtual ESP32 device tasks", len(self._tasks))

        # FastAPI control server on port 8001
        app = create_app(self)
        config = uvicorn.Config(
            app=app,
            host="0.0.0.0",
            port=8001,
            log_level=_LOG_LEVEL.lower(),
            loop="asyncio",
        )
        server = uvicorn.Server(config)
        api_task = asyncio.create_task(server.serve(), name="control-api")
        logger.info("Control API listening on http://0.0.0.0:8001")

        await self._stop_event.wait()
        logger.info("Shutdown signal received — stopping simulator ...")

        for task in self._tasks.values():
            task.cancel()
        results = await asyncio.gather(*self._tasks.values(), return_exceptions=True)
        for vid, result in zip(list(self._tasks.keys()), results):
            if isinstance(result, Exception) and not isinstance(
                result, asyncio.CancelledError
            ):
                logger.error("Device %s error during teardown: %s", vid, result)

        server.should_exit = True
        await api_task

        self._mqtt.loop_stop()
        self._mqtt.disconnect()
        logger.info("Simulator shut down cleanly.")


def _read_env() -> dict:
    return {
        "mqtt_broker": os.environ.get("MQTT_BROKER", "localhost"),
        "mqtt_port": int(os.environ.get("MQTT_PORT", "1883")),
        "fleet_id": os.environ.get("FLEET_ID", "fleet_001"),
        "fleet_size": int(os.environ.get("FLEET_SIZE", "10")),
        "publish_interval": float(os.environ.get("PUBLISH_INTERVAL", "3")),
    }


def main() -> None:
    cfg = _read_env()
    logger.info(
        "EV Fleet Simulator starting | broker=%s:%d | fleet=%s | size=%d | interval=%.1fs",
        cfg["mqtt_broker"],
        cfg["mqtt_port"],
        cfg["fleet_id"],
        cfg["fleet_size"],
        cfg["publish_interval"],
    )
    orchestrator = FleetOrchestrator(**cfg)
    asyncio.run(orchestrator.run())


if __name__ == "__main__":
    main()
