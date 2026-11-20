"""
virtual_esp32.py
================
Virtual ESP32 Edge Device Emulator for EV SENSE.

Conceptual model:
    VirtualEV (Vehicle Physics)
        ↓
    Virtual Sensors (Battery, Motor, GPS, Energy)
        ↓
    VirtualESP32 (IoT Edge Node & MQTT Transport)
        ↓
    MQTT Broker
"""

import asyncio
import json
import logging
import time
from datetime import datetime, timezone, timedelta
from typing import Optional, Any

from vehicle import VirtualEV
from sensors import (
    BatterySoCSensor,
    BatteryVoltageSensor,
    BatteryTempSensor,
    MotorTempSensor,
    GPSSensor,
    SpeedSensor,
    CurrentEnergySensor,
)
from telemetry import TelemetryPayload

logger = logging.getLogger(__name__)


class VirtualESP32:
    """Emulates an ESP32 microcontroller edge node deployed on an EV.

    Parameters
    ----------
    vehicle : VirtualEV
        The parent virtual vehicle whose state is being sensed.
    publish_interval : float
        Pace in seconds at which the device publishes telemetry.
    """

    def __init__(self, vehicle: VirtualEV, publish_interval: float = 3.0) -> None:
        self.vehicle = vehicle
        self.device_id = f"ESP32-{vehicle.vehicle_id}"
        self.publish_interval = publish_interval
        self.is_online = True

        # Initialize virtual sensor suite
        self.soc_sensor = BatterySoCSensor(vehicle)
        self.voltage_sensor = BatteryVoltageSensor(vehicle)
        self.pack_temp_sensor = BatteryTempSensor(vehicle)
        self.motor_temp_sensor = MotorTempSensor(vehicle)
        self.gps_sensor = GPSSensor(vehicle)
        self.speed_sensor = SpeedSensor(vehicle)
        self.current_energy_sensor = CurrentEnergySensor(vehicle)

    def read_telemetry(self) -> Optional[dict[str, Any]]:
        """Poll the virtual sensors and construct a canonical telemetry payload.

        Returns None if the device is offline or the scenario calls for dropout.
        """
        cfg = self.vehicle.scenario_config

        # Check for device or sensor dropout
        if not self.is_online or cfg.drop_payload:
            return None

        # Sample sensors
        soc = self.soc_sensor.read()
        voltage = self.voltage_sensor.read()
        pack_temp = self.pack_temp_sensor.read()
        motor_temp = self.motor_temp_sensor.read()
        gps = self.gps_sensor.read()
        speed = self.speed_sensor.read()
        energy_data = self.current_energy_sensor.read()

        # Timestamp generation (support intentional delay scenario)
        now_dt = datetime.now(timezone.utc)
        if cfg.sensor_fault_type == "delayed" and cfg.delayed_seconds > 0:
            now_dt = now_dt - timedelta(seconds=cfg.delayed_seconds)
        timestamp_str = now_dt.isoformat()

        payload = TelemetryPayload(
            vehicle_id=self.vehicle.vehicle_id,
            fleet_id=self.vehicle.fleet_id,
            device_id=self.device_id,
            vehicle_type=self.vehicle.vehicle_type,
            battery_capacity_kwh=self.vehicle.battery_capacity_kwh,
            timestamp=timestamp_str,
            battery_soc=soc,
            battery_voltage=voltage,
            battery_current=energy_data["battery_current"],
            battery_temperature=pack_temp,
            motor_temperature=motor_temp,
            latitude=gps["latitude"],
            longitude=gps["longitude"],
            speed=speed,
            heading=gps["heading"],
            energy_consumption_kwh_per_km=energy_data["energy_consumption_kwh_per_km"],
            odometer_km=round(self.vehicle.odometer, 2),
            charging=self.vehicle.charging,
            online=self.is_online,
            vehicle_status=self.vehicle.status,
            scenario=self.vehicle.scenario,
        )

        return payload.to_dict()

    async def run(self, mqtt_client: Any, orchestrator: Any) -> None:
        """Async device runtime loop: update physics, poll sensors, publish telemetry."""
        topic = f"fleet/{self.vehicle.fleet_id}/ev/{self.vehicle.vehicle_id}/telemetry"
        loop = asyncio.get_event_loop()

        while True:
            try:
                # Obey simulation state control: pause stops physics & publish
                if orchestrator.is_paused:
                    await asyncio.sleep(0.5)
                    continue

                if orchestrator.is_stopped:
                    await asyncio.sleep(0.5)
                    continue

                # Advance vehicle physics tick
                self.vehicle.update_state()

                # Poll sensors and build telemetry payload
                telemetry = self.read_telemetry()

                if telemetry is not None:
                    payload_bytes = json.dumps(telemetry).encode("utf-8")
                    await loop.run_in_executor(
                        None,
                        lambda pb=payload_bytes: mqtt_client.publish(
                            topic, pb, qos=1
                        ),
                    )
                    logger.debug(
                        "%s (%s) -> %s soc=%s temp=%s C",
                        self.device_id,
                        self.vehicle.vehicle_id,
                        topic,
                        telemetry.get("battery_soc"),
                        telemetry.get("battery_temperature"),
                    )

            except asyncio.CancelledError:
                logger.info("%s loop cancelled", self.device_id)
                raise
            except Exception:
                logger.exception("%s error in run loop", self.device_id)

            await asyncio.sleep(self.publish_interval)
