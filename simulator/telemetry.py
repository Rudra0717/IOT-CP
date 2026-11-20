"""
telemetry.py
============
Canonical Telemetry Schema definitions and serialization for EV SENSE.
"""

from datetime import datetime, timezone
from typing import Any, Optional
from pydantic import BaseModel, Field


class TelemetryPayload(BaseModel):
    """Canonical IoT Telemetry model for simulated EV edge nodes."""

    vehicle_id: str
    fleet_id: str
    device_id: str
    vehicle_type: str = "delivery_ev"
    timestamp: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )

    battery_soc: Any
    battery_voltage: Any
    battery_current: Any
    battery_temperature: Any
    motor_temperature: Any

    latitude: Any
    longitude: Any
    speed: Any
    heading: Any

    energy_consumption_kwh_per_km: Any
    odometer_km: Any

    charging: bool = False
    online: bool = True

    vehicle_status: str = "IDLE"
    scenario: str = "normal"

    # Backward compatibility aliases
    soc: Optional[Any] = None
    voltage: Optional[Any] = None
    pack_temp: Optional[Any] = None
    motor_temp: Optional[Any] = None
    current: Optional[Any] = None
    lat: Optional[Any] = None
    lon: Optional[Any] = None
    odometer: Optional[Any] = None
    status: Optional[str] = None

    def model_post_init(self, __context: Any) -> None:
        """Populate backward-compatibility aliases if not set."""
        if self.soc is None:
            self.soc = self.battery_soc
        if self.voltage is None:
            self.voltage = self.battery_voltage
        if self.pack_temp is None:
            self.pack_temp = self.battery_temperature
        if self.motor_temp is None:
            self.motor_temp = self.motor_temperature
        if self.current is None:
            self.current = self.battery_current
        if self.lat is None:
            self.lat = self.latitude
        if self.lon is None:
            self.lon = self.longitude
        if self.odometer is None:
            self.odometer = self.odometer_km
        if self.status is None:
            self.status = self.vehicle_status

    def to_dict(self) -> dict[str, Any]:
        """Serialize model to dictionary ready for JSON serialization."""
        return self.model_dump()
