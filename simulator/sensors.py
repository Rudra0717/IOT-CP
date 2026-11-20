"""
sensors.py
==========
Logical Virtual Sensor Layer for the EV Simulator.

Each sensor encapsulates reading physical values from a ``VirtualEV`` instance,
allowing scenarios to inject sensor-level faults (invalid values, corrupted
types, dropout) independently of vehicle physics.
"""

from typing import Any, Optional
import logging

logger = logging.getLogger(__name__)


class BaseSensor:
    """Base class for all virtual EV sensors."""

    def __init__(self, name: str, vehicle: Any) -> None:
        self.name = name
        self.vehicle = vehicle
        self.is_healthy = True

    def read(self) -> Any:
        raise NotImplementedError


class BatterySoCSensor(BaseSensor):
    """Measures battery State of Charge (%)."""

    def __init__(self, vehicle: Any) -> None:
        super().__init__("battery_soc", vehicle)

    def read(self) -> Any:
        cfg = self.vehicle.scenario_config
        if cfg.sensor_fault_type == "invalid":
            return 145.0  # Impossible >100% reading
        if cfg.sensor_fault_type == "corrupted":
            return "ERROR"
        return round(float(self.vehicle.soc), 2)


class BatteryVoltageSensor(BaseSensor):
    """Measures main battery bus voltage (V)."""

    def __init__(self, vehicle: Any) -> None:
        super().__init__("battery_voltage", vehicle)

    def read(self) -> Any:
        cfg = self.vehicle.scenario_config
        if cfg.sensor_fault_type == "invalid":
            return -12.5  # Impossible negative DC voltage
        if cfg.sensor_fault_type == "corrupted":
            return "ERR_V_SAG"
        return round(float(self.vehicle.voltage), 2)


class BatteryTempSensor(BaseSensor):
    """Measures battery pack temperature (°C)."""

    def __init__(self, vehicle: Any) -> None:
        super().__init__("battery_temperature", vehicle)

    def read(self) -> Any:
        cfg = self.vehicle.scenario_config
        if cfg.sensor_fault_type == "invalid":
            return 250.0  # Sensor out-of-range
        if cfg.sensor_fault_type == "corrupted":
            return "OVERFLOW"
        return round(float(self.vehicle.pack_temp), 2)


class MotorTempSensor(BaseSensor):
    """Measures traction motor temperature (°C)."""

    def __init__(self, vehicle: Any) -> None:
        super().__init__("motor_temperature", vehicle)

    def read(self) -> Any:
        cfg = self.vehicle.scenario_config
        if cfg.sensor_fault_type == "invalid":
            return 320.0
        return round(float(self.vehicle.motor_temp), 2)


class GPSSensor(BaseSensor):
    """Simulates GPS receiver (latitude, longitude, heading)."""

    def __init__(self, vehicle: Any) -> None:
        super().__init__("gps", vehicle)

    def read(self) -> dict[str, Any]:
        cfg = self.vehicle.scenario_config
        if cfg.sensor_fault_type == "invalid":
            return {"latitude": 195.0, "longitude": -240.0, "heading": 999.0}
        return {
            "latitude": round(float(self.vehicle.lat), 6),
            "longitude": round(float(self.vehicle.lon), 6),
            "heading": round(float(self.vehicle.heading), 1),
        }


class SpeedSensor(BaseSensor):
    """Measures vehicle road speed (km/h)."""

    def __init__(self, vehicle: Any) -> None:
        super().__init__("speed", vehicle)

    def read(self) -> Any:
        cfg = self.vehicle.scenario_config
        if cfg.sensor_fault_type == "invalid":
            return -50.0
        return round(float(self.vehicle.speed), 2)


class CurrentEnergySensor(BaseSensor):
    """Measures battery traction current (A) and energy consumption (kWh/km)."""

    def __init__(self, vehicle: Any) -> None:
        super().__init__("current_energy", vehicle)

    def read(self) -> dict[str, Any]:
        cfg = self.vehicle.scenario_config
        current = round(float(self.vehicle.current), 2)
        consumption = round(float(self.vehicle.energy_consumption_kwh_per_km), 3)

        if cfg.name == "energy_spike":
            # Scenario: abnormal consumption spike
            consumption = round(max(consumption, 1.85), 3)

        if cfg.sensor_fault_type == "invalid":
            current = -999.0
            consumption = -2.5

        return {
            "battery_current": current,
            "energy_consumption_kwh_per_km": consumption,
        }
