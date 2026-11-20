"""
vehicle.py
==========
Defines ``VirtualEV`` - a stateful simulation of an electric delivery vehicle.

The class drives a physics-based state machine every tick, advancing the
vehicle along a circular GPS delivery route while applying the active
scenario modifiers (temperature spikes, drain multipliers, etc.).
"""

import asyncio
import json
import math
import random
import time
import logging
from typing import Optional

from scenarios import SCENARIOS, ScenarioConfig

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

STATUS = ["IDLE", "DRIVING", "CHARGING", "FAULT"]

#: Nominal battery capacity in Amp-hours (48 V * 100 Ah = 4.8 kWh)
DEFAULT_BATTERY_CAPACITY_AH: float = 100.0
DEFAULT_BATTERY_CAPACITY_KWH: float = 4.8

#: Ambient temperature the vehicle tries to cool toward when idle/charging
AMBIENT_TEMP: float = 28.0

#: Circular GPS waypoints forming a delivery route around New Delhi city centre
DELIVERY_ROUTE: list[tuple[float, float]] = [
    (28.6139, 77.2090),
    (28.6200, 77.2150),
    (28.6280, 77.2200),
    (28.6350, 77.2250),
    (28.6400, 77.2180),
    (28.6420, 77.2090),
    (28.6380, 77.1990),
    (28.6300, 77.1920),
    (28.6220, 77.1880),
    (28.6150, 77.1930),
    (28.6100, 77.2000),
    (28.6090, 77.2060),
    (28.6110, 77.2100),
    (28.6139, 77.2090),
    (28.6170, 77.2120),
    (28.6230, 77.2160),
    (28.6310, 77.2210),
    (28.6370, 77.2130),
    (28.6390, 77.2050),
    (28.6330, 77.1960),
]

_ROUTE_LEN = len(DELIVERY_ROUTE)


# ---------------------------------------------------------------------------
# Helper: GPS interpolation & heading
# ---------------------------------------------------------------------------

def _interpolate_toward(
    lat: float,
    lon: float,
    target_lat: float,
    target_lon: float,
    step_km: float = 0.05,
) -> tuple[float, float]:
    """Move (lat, lon) a fixed distance toward the target waypoint."""
    d_lat = target_lat - lat
    d_lon = target_lon - lon
    dist = math.sqrt(d_lat ** 2 + d_lon ** 2)
    if dist < 1e-6:
        return target_lat, target_lon
    ratio = min(step_km / 111.0 / dist, 1.0)   # 1 deg lat ~ 111 km
    return lat + d_lat * ratio, lon + d_lon * ratio


def _compute_heading(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Compute bearing / heading angle in degrees (0 to 360) from point 1 to point 2."""
    d_lat = lat2 - lat1
    d_lon = lon2 - lon1
    if abs(d_lat) < 1e-7 and abs(d_lon) < 1e-7:
        return 0.0
    # Bearing: angle from North (lat axis) clockwise
    angle = math.degrees(math.atan2(d_lon, d_lat))
    return round((angle + 360.0) % 360.0, 1)


# ---------------------------------------------------------------------------
# VirtualEV
# ---------------------------------------------------------------------------

class VirtualEV:
    """Simulated electric delivery vehicle with realistic physical state machine.

    Parameters
    ----------
    vehicle_id : str
        Unique identifier, e.g. ``"EV-001"``.
    fleet_id : str
        Fleet grouping, e.g. ``"fleet_001"``.
    interval : float
        Publish interval in seconds (used by the physics tick).
    vehicle_type : str
        Type of vehicle, defaults to ``"delivery_ev"``.
    battery_capacity_kwh : float
        Nominal pack capacity in kWh.
    """

    def __init__(
        self,
        vehicle_id: str,
        fleet_id: str,
        interval: float,
        vehicle_type: str = "delivery_ev",
        battery_capacity_kwh: float = DEFAULT_BATTERY_CAPACITY_KWH,
    ) -> None:
        self.vehicle_id = vehicle_id
        self.fleet_id = fleet_id
        self.interval = interval
        self.vehicle_type = vehicle_type
        self.battery_capacity_kwh = battery_capacity_kwh
        self.battery_capacity_ah = (battery_capacity_kwh * 1000.0) / 48.0

        # ------------------------------------------------------------------
        # Physics state
        # ------------------------------------------------------------------
        self.soc: float = random.uniform(60.0, 95.0)
        self.voltage: float = 48.0
        self.pack_temp: float = random.uniform(25.0, 35.0)
        self.motor_temp: float = random.uniform(30.0, 45.0)
        self.current: float = 0.0
        self.speed: float = 0.0
        self.status: str = "IDLE"
        self.odometer: float = round(random.uniform(0.0, 5000.0), 2)
        self.heading: float = 0.0
        self.energy_consumption_kwh_per_km: float = 0.0

        # ------------------------------------------------------------------
        # GPS - start near a random route waypoint with small jitter
        # ------------------------------------------------------------------
        start_wp = random.choice(DELIVERY_ROUTE)
        self.lat: float = start_wp[0] + random.uniform(-0.0005, 0.0005)
        self.lon: float = start_wp[1] + random.uniform(-0.0005, 0.0005)
        self.waypoint_idx: int = random.randint(0, _ROUTE_LEN - 1)
        next_wp = DELIVERY_ROUTE[self.waypoint_idx % _ROUTE_LEN]
        self.heading = _compute_heading(self.lat, self.lon, next_wp[0], next_wp[1])

        # ------------------------------------------------------------------
        # Scenario
        # ------------------------------------------------------------------
        self.scenario: str = "normal"
        self.scenario_config: ScenarioConfig = SCENARIOS["normal"]

        # ------------------------------------------------------------------
        # Timing
        # ------------------------------------------------------------------
        self.last_update: float = time.time()

        logger.info(
            "VirtualEV %s initialised | fleet=%s | type=%s | soc=%.1f%% | "
            "pack_temp=%.1f C | motor_temp=%.1f C",
            self.vehicle_id,
            self.fleet_id,
            self.vehicle_type,
            self.soc,
            self.pack_temp,
            self.motor_temp,
        )

    @property
    def charging(self) -> bool:
        """True when the vehicle is in CHARGING state."""
        return self.status == "CHARGING"

    @property
    def online(self) -> bool:
        """True when the vehicle is operational and not in dropout."""
        return self.status != "FAULT" and not self.scenario_config.drop_payload

    # ------------------------------------------------------------------
    # Scenario control
    # ------------------------------------------------------------------

    def set_scenario(self, scenario_name: str) -> None:
        """Switch the active scenario.

        Parameters
        ----------
        scenario_name : str
            Must be a key in :data:`scenarios.SCENARIOS`.
        """
        if scenario_name not in SCENARIOS:
            raise ValueError(
                f"Unknown scenario '{scenario_name}'. "
                f"Valid options: {list(SCENARIOS.keys())}"
            )
        self.scenario = scenario_name
        self.scenario_config = SCENARIOS[scenario_name]
        logger.info(
            "%s scenario changed -> %s", self.vehicle_id, scenario_name
        )

        # When resetting to normal, fully revive the vehicle so it can drive again
        if scenario_name == "normal":
            self.soc = random.uniform(60.0, 90.0)
            self.pack_temp = random.uniform(28.0, 38.0)
            self.motor_temp = random.uniform(30.0, 45.0)
            self.speed = 0.0
            self.current = 0.0
            self.status = "IDLE"
            self.energy_consumption_kwh_per_km = 0.0
            logger.info("%s state reset to normal (soc=%.1f%%)", self.vehicle_id, self.soc)

    # ------------------------------------------------------------------
    # Physics tick
    # ------------------------------------------------------------------

    def update_state(self) -> None:
        """Core physics tick. Advances vehicle state by one interval."""
        now = time.time()
        dt = max(0.1, min(10.0, now - self.last_update))
        self.last_update = now
        cfg = self.scenario_config

        # ----------------------------------------------------------------
        # 1. Status machine
        # ----------------------------------------------------------------
        if self.soc <= 5.0:
            self.status = "FAULT"
        elif self.status == "IDLE":
            if random.random() < 0.80:
                self.status = "DRIVING"
        elif self.status == "DRIVING":
            if random.random() < 0.05:
                self.status = "CHARGING"
        elif self.status == "CHARGING":
            if self.soc >= 98.0:
                self.status = "IDLE"
        elif self.status == "FAULT":
            # Recovers via scenario reset to 'normal' or external recharge
            pass

        # ----------------------------------------------------------------
        # 2. Driving physics
        # ----------------------------------------------------------------
        if self.status == "DRIVING":
            target_speed = random.uniform(20.0, 80.0) * cfg.speed_multiplier
            # Smooth speed toward target
            self.speed += (target_speed - self.speed) * 0.4
            self.speed = max(0.0, self.speed)

            # Traction current (A) based on speed + noise
            raw_current = (self.speed * 0.8) + random.uniform(-2.0, 2.0)
            self.current = max(0.0, raw_current * cfg.current_multiplier)

            # SoC drain: Q = I * t / capacity * 100 %
            soc_delta = (
                self.current * dt / 3600.0 / self.battery_capacity_ah * 100.0
            ) * cfg.soc_drain_multiplier
            self.soc = max(0.0, self.soc - soc_delta)

            # Odometer (km)
            self.odometer += self.speed * dt / 3600.0

            # Motor and pack temperature rise under load
            load_heat = self.current * 0.005
            self.motor_temp += load_heat * dt
            self.pack_temp += load_heat * 0.5 * dt

            # Deterministic Energy consumption (kWh per km)
            # Power in kW = (V * I) / 1000
            # If stationary or crawling (< 2 km/h), report nominal 0 to avoid div-by-zero
            if self.speed > 2.0:
                power_kw = (self.voltage * self.current) / 1000.0
                raw_consumption = power_kw / self.speed
                self.energy_consumption_kwh_per_km = round(
                    max(0.05, min(3.5, raw_consumption)), 3
                )
            else:
                self.energy_consumption_kwh_per_km = 0.0

        elif self.status == "CHARGING":
            self.speed = 0.0
            self.current = 0.0
            self.energy_consumption_kwh_per_km = 0.0
            # SoC recovery: +0.5 % per second
            self.soc = min(100.0, self.soc + 0.5 * dt)
            # Cool toward ambient
            self.pack_temp += (AMBIENT_TEMP - self.pack_temp) * 0.05 * dt
            self.motor_temp += (AMBIENT_TEMP - self.motor_temp) * 0.05 * dt

        elif self.status == "IDLE":
            self.speed = 0.0
            self.current = 0.0
            self.energy_consumption_kwh_per_km = 0.0
            self.pack_temp += (AMBIENT_TEMP - self.pack_temp) * 0.02 * dt
            self.motor_temp += (AMBIENT_TEMP - self.motor_temp) * 0.02 * dt

        elif self.status == "FAULT":
            self.speed = 0.0
            self.current = 0.0
            self.energy_consumption_kwh_per_km = 0.0

        # ----------------------------------------------------------------
        # 3. Scenario temperature spikes (cumulative per tick)
        # ----------------------------------------------------------------
        self.pack_temp += cfg.temp_spike
        self.motor_temp += cfg.motor_temp_spike

        # ----------------------------------------------------------------
        # 4. Voltage sag model
        # ----------------------------------------------------------------
        sag = (1.0 - self.soc / 100.0) * 4.0
        self.voltage = 48.0 + cfg.voltage_offset - sag

        # ----------------------------------------------------------------
        # 5. Clamp all values to realistic operating ranges
        # ----------------------------------------------------------------
        self.soc = max(0.0, min(100.0, self.soc))
        self.voltage = max(36.0, min(58.0, self.voltage))
        self.pack_temp = max(AMBIENT_TEMP - 5.0, min(90.0, self.pack_temp))
        self.motor_temp = max(AMBIENT_TEMP - 5.0, min(130.0, self.motor_temp))
        self.current = max(0.0, min(500.0, self.current))
        self.speed = max(0.0, min(120.0, self.speed))

        # ----------------------------------------------------------------
        # 6. GPS: interpolate toward next waypoint & update heading
        # ----------------------------------------------------------------
        if self.status == "DRIVING":
            target = DELIVERY_ROUTE[self.waypoint_idx % _ROUTE_LEN]
            step_km = self.speed * dt / 3600.0
            self.lat, self.lon = _interpolate_toward(
                self.lat, self.lon, target[0], target[1], step_km=max(step_km, 0.001)
            )
            self.heading = _compute_heading(self.lat, self.lon, target[0], target[1])
            # Advance waypoint when close (< ~20 m)
            d_lat = target[0] - self.lat
            d_lon = target[1] - self.lon
            if math.sqrt(d_lat ** 2 + d_lon ** 2) < 0.0002:
                self.waypoint_idx = (self.waypoint_idx + 1) % _ROUTE_LEN
                next_target = DELIVERY_ROUTE[self.waypoint_idx % _ROUTE_LEN]
                self.heading = _compute_heading(self.lat, self.lon, next_target[0], next_target[1])

    # Backward compatibility alias
    _update_state = update_state

    # ------------------------------------------------------------------
    # Summary
    # ------------------------------------------------------------------

    def get_state_summary(self) -> dict:
        """Return a lightweight summary dict for the control API."""
        return {
            "vehicle_id": self.vehicle_id,
            "fleet_id": self.fleet_id,
            "vehicle_type": self.vehicle_type,
            "status": self.status,
            "scenario": self.scenario,
            "soc": round(self.soc, 2),
            "voltage": round(self.voltage, 2),
            "pack_temp": round(self.pack_temp, 2),
            "motor_temp": round(self.motor_temp, 2),
            "current": round(self.current, 2),
            "speed": round(self.speed, 2),
            "heading": self.heading,
            "energy_consumption_kwh_per_km": round(self.energy_consumption_kwh_per_km, 3),
            "odometer": round(self.odometer, 2),
            "charging": self.charging,
            "online": self.online,
            "lat": round(self.lat, 6),
            "lon": round(self.lon, 6),
        }

    # ------------------------------------------------------------------
    # Legacy payload generator (for backward compatibility)
    # ------------------------------------------------------------------

    def get_payload(self) -> Optional[dict]:
        """Return raw telemetry dict or None if dropped."""
        if self.scenario_config.drop_payload:
            return None

        return {
            "vehicle_id": self.vehicle_id,
            "fleet_id": self.fleet_id,
            "device_id": f"ESP32-{self.vehicle_id}",
            "vehicle_type": self.vehicle_type,
            "timestamp": time.time(),
            # Legacy short names
            "soc": round(self.soc, 2),
            "voltage": round(self.voltage, 2),
            "pack_temp": round(self.pack_temp, 2),
            "motor_temp": round(self.motor_temp, 2),
            "current": round(self.current, 2),
            "speed": round(self.speed, 2),
            "lat": round(self.lat, 6),
            "lon": round(self.lon, 6),
            "odometer": round(self.odometer, 2),
            # Canonical extended names
            "battery_soc": round(self.soc, 2),
            "battery_voltage": round(self.voltage, 2),
            "battery_current": round(self.current, 2),
            "battery_temperature": round(self.pack_temp, 2),
            "motor_temperature": round(self.motor_temp, 2),
            "latitude": round(self.lat, 6),
            "longitude": round(self.lon, 6),
            "heading": self.heading,
            "energy_consumption_kwh_per_km": round(self.energy_consumption_kwh_per_km, 3),
            "odometer_km": round(self.odometer, 2),
            "charging": self.charging,
            "online": self.online,
            "vehicle_status": self.status,
            "status": self.status,
            "scenario": self.scenario,
        }

    async def run(self, mqtt_client, publish_interval: float) -> None:
        """Legacy standalone async run loop."""
        topic = f"fleet/{self.fleet_id}/ev/{self.vehicle_id}/telemetry"
        loop = asyncio.get_event_loop()

        while True:
            try:
                self.update_state()
                payload = self.get_payload()

                if payload is not None:
                    payload_bytes = json.dumps(payload).encode("utf-8")
                    await loop.run_in_executor(
                        None,
                        lambda pb=payload_bytes: mqtt_client.publish(
                            topic, pb, qos=1
                        ),
                    )
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("%s error in run loop", self.vehicle_id)

            await asyncio.sleep(publish_interval)
