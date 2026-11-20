"""
mqtt_client.py
==============
MQTT transport client for EV SENSE.
Handles connection, subscription, reconnect exponential backoff,
and dispatches payloads to the TelemetryProcessor.
"""

import asyncio
import logging
from typing import Optional

import paho.mqtt.client as mqtt

from telemetry_processor import TelemetryProcessor

logger = logging.getLogger(__name__)


class MQTTIngestionClient:
    """Subscribes to EV telemetry topics and hands messages to TelemetryProcessor."""

    TOPIC_PATTERN = "fleet/+/ev/+/telemetry"
    MAX_BACKOFF   = 30  # seconds

    def __init__(
        self,
        broker: str,
        port: int,
        telemetry_processor: TelemetryProcessor,
        loop: asyncio.AbstractEventLoop,
    ) -> None:
        self.broker = broker
        self.port = port
        self.telemetry_processor = telemetry_processor
        self.loop = loop

        self._backoff: float = 1.0
        self._reconnecting: bool = False

        self.client = mqtt.Client(client_id="ev-fleet-backend", clean_session=True)
        self.client.on_connect    = self._on_connect
        self.client.on_disconnect = self._on_disconnect
        self.client.on_message    = self._on_message

    @property
    def vehicles(self) -> dict:
        """Backward-compatibility alias to vehicles cache."""
        return self.telemetry_processor.vehicles_cache

    # ------------------------------------------------------------------
    # Paho callbacks
    # ------------------------------------------------------------------

    def _on_connect(self, client: mqtt.Client, userdata, flags, rc: int) -> None:
        if rc == 0:
            logger.info("MQTT connected to %s:%s", self.broker, self.port)
            self._backoff = 1.0
            self._reconnecting = False
            client.subscribe(self.TOPIC_PATTERN, qos=1)
            logger.info("Subscribed to %s", self.TOPIC_PATTERN)
        else:
            logger.error("MQTT connection refused: rc=%d", rc)

    def _on_disconnect(self, client: mqtt.Client, userdata, rc: int) -> None:
        if rc == 0:
            logger.info("MQTT disconnected cleanly.")
            return
        logger.warning("Unexpected MQTT disconnect (rc=%d). Scheduling reconnect.", rc)
        self._schedule_reconnect()

    def _schedule_reconnect(self) -> None:
        if self._reconnecting:
            return
        self._reconnecting = True
        backoff = self._backoff
        self._backoff = min(self._backoff * 2, self.MAX_BACKOFF)
        logger.info("Reconnecting in %.0fs …", backoff)
        asyncio.run_coroutine_threadsafe(self._reconnect_after(backoff), self.loop)

    async def _reconnect_after(self, delay: float) -> None:
        await asyncio.sleep(delay)
        try:
            self.client.reconnect()
        except Exception as exc:
            logger.error("Reconnect attempt failed: %s", exc)
            self._reconnecting = False
            self._schedule_reconnect()

    def _on_message(
        self, client: mqtt.Client, userdata, msg: mqtt.MQTTMessage
    ) -> None:
        """Dispatch incoming MQTT messages to the asyncio processor."""
        asyncio.run_coroutine_threadsafe(
            self.telemetry_processor.process_raw_message(msg.topic, msg.payload),
            self.loop,
        )

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def start(self) -> None:
        """Connect to the broker and start Paho network loop thread."""
        logger.info("Connecting to MQTT broker %s:%d …", self.broker, self.port)
        try:
            self.client.connect(self.broker, self.port, keepalive=60)
        except Exception as exc:
            logger.error("Initial MQTT connect failed: %s", exc)
        self.client.loop_start()

    def stop(self) -> None:
        """Stop Paho network loop and disconnect cleanly."""
        logger.info("Stopping MQTT client …")
        self.client.loop_stop()
        try:
            self.client.disconnect()
        except Exception:
            pass
