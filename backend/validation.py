"""
validation.py
=============
Schema and physical range validation for EV SENSE telemetry payloads.
"""

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Optional, List
import logging

logger = logging.getLogger(__name__)


@dataclass
class ValidationIssue:
    field: str
    rule: str
    message: str
    value: Any
    severity: str = "WARNING"  # WARNING or CRITICAL


@dataclass
class ValidationResult:
    is_valid: bool
    normalized_payload: dict[str, Any]
    issues: List[ValidationIssue]


def parse_timestamp(raw_ts: Any) -> tuple[Optional[datetime], Optional[str]]:
    """Parse timestamp into UTC datetime and ISO-8601 string."""
    if raw_ts is None:
        return None, None

    # Handle float / int epoch timestamp
    if isinstance(raw_ts, (int, float)):
        try:
            dt = datetime.fromtimestamp(raw_ts, tz=timezone.utc)
            return dt, dt.isoformat()
        except Exception:
            return None, None

    # Handle ISO string
    if isinstance(raw_ts, str):
        try:
            # Handle trailing Z
            clean_ts = raw_ts.replace("Z", "+00:00")
            dt = datetime.fromisoformat(clean_ts)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt, dt.astimezone(timezone.utc).isoformat()
        except Exception:
            return None, None

    return None, None


def validate_telemetry(payload: dict[str, Any]) -> ValidationResult:
    """Validate telemetry payload structure, types, and physical ranges."""
    issues: List[ValidationIssue] = []
    norm: dict[str, Any] = dict(payload)

    # 1. Identity validation
    vehicle_id = payload.get("vehicle_id") or payload.get("id")
    if not vehicle_id or not isinstance(vehicle_id, str):
        issues.append(
            ValidationIssue(
                field="vehicle_id",
                rule="MISSING_IDENTITY",
                message="Telemetry payload missing valid 'vehicle_id'",
                value=vehicle_id,
                severity="CRITICAL",
            )
        )
        return ValidationResult(is_valid=False, normalized_payload=norm, issues=issues)

    norm["vehicle_id"] = vehicle_id
    norm["id"] = vehicle_id

    device_id = payload.get("device_id") or f"ESP32-{vehicle_id}"
    norm["device_id"] = device_id

    fleet_id = payload.get("fleet_id") or "fleet_001"
    norm["fleet_id"] = fleet_id

    # 2. Timestamp validation & freshness
    raw_ts = payload.get("timestamp")
    dt, iso_str = parse_timestamp(raw_ts)
    if dt is None:
        issues.append(
            ValidationIssue(
                field="timestamp",
                rule="CORRUPTED_SENSOR_VALUE",
                message=f"Invalid or corrupted timestamp: {raw_ts}",
                value=raw_ts,
                severity="WARNING",
            )
        )
        now_dt = datetime.now(timezone.utc)
        norm["timestamp"] = now_dt.isoformat()
        norm["_dt"] = now_dt
    else:
        norm["timestamp"] = iso_str
        norm["_dt"] = dt

        # Check for stale telemetry (e.g. sensor_delayed scenario)
        now_dt = datetime.now(timezone.utc)
        delay_sec = (now_dt - dt).total_seconds()
        if delay_sec > 60.0:
            issues.append(
                ValidationIssue(
                    field="timestamp",
                    rule="STALE_TELEMETRY",
                    message=f"Telemetry timestamp is stale ({delay_sec:.1f}s lag)",
                    value=delay_sec,
                    severity="WARNING",
                )
            )

    # 3. Numeric range & type checks helper
    def check_num(
        field_keys: list[str],
        canonical_name: str,
        min_val: float,
        max_val: float,
        default_val: Optional[float] = None,
    ) -> Optional[float]:
        val = None
        for k in field_keys:
            if k in payload and payload[k] is not None:
                val = payload[k]
                break

        if val is None:
            norm[canonical_name] = default_val
            return default_val

        # Corrupted non-numeric check
        if isinstance(val, str):
            try:
                val = float(val)
            except ValueError:
                issues.append(
                    ValidationIssue(
                        field=canonical_name,
                        rule="CORRUPTED_SENSOR_VALUE",
                        message=f"Sensor {canonical_name} corrupted with non-numeric value: '{val}'",
                        value=val,
                        severity="WARNING",
                    )
                )
                norm[canonical_name] = default_val
                return default_val

        if not isinstance(val, (int, float)):
            issues.append(
                ValidationIssue(
                    field=canonical_name,
                    rule="CORRUPTED_SENSOR_VALUE",
                    message=f"Sensor {canonical_name} has invalid data type: {type(val)}",
                    value=val,
                    severity="WARNING",
                )
            )
            norm[canonical_name] = default_val
            return default_val

        fval = float(val)
        # Out-of-bounds physical check
        if fval < min_val or fval > max_val:
            issues.append(
                ValidationIssue(
                    field=canonical_name,
                    rule="INVALID_SENSOR_VALUE",
                    message=f"{canonical_name} reading {fval} out of physical bounds [{min_val}, {max_val}]",
                    value=fval,
                    severity="WARNING",
                )
            )

        norm[canonical_name] = fval
        return fval

    # Range validations
    check_num(["battery_soc", "soc"], "battery_soc", 0.0, 100.0, default_val=50.0)
    norm["soc"] = norm["battery_soc"]

    check_num(["battery_voltage", "voltage"], "battery_voltage", 10.0, 80.0, default_val=48.0)
    norm["voltage"] = norm["battery_voltage"]

    check_num(["battery_temperature", "pack_temp"], "battery_temperature", -20.0, 150.0, default_val=30.0)
    norm["pack_temp"] = norm["battery_temperature"]

    check_num(["motor_temperature", "motor_temp"], "motor_temperature", -20.0, 200.0, default_val=35.0)
    norm["motor_temp"] = norm["motor_temperature"]

    check_num(["battery_current", "current"], "battery_current", 0.0, 600.0, default_val=0.0)
    norm["current"] = norm["battery_current"]

    check_num(["speed"], "speed", 0.0, 150.0, default_val=0.0)
    check_num(["latitude", "lat"], "latitude", -90.0, 90.0, default_val=28.6139)
    norm["lat"] = norm["latitude"]

    check_num(["longitude", "lon"], "longitude", -180.0, 180.0, default_val=77.2090)
    norm["lon"] = norm["longitude"]

    check_num(["heading"], "heading", 0.0, 360.0, default_val=0.0)
    check_num(["energy_consumption_kwh_per_km", "energy_consumption"], "energy_consumption_kwh_per_km", 0.0, 10.0, default_val=0.0)
    check_num(["odometer_km", "odometer"], "odometer_km", 0.0, 1000000.0, default_val=0.0)
    norm["odometer"] = norm["odometer_km"]

    # Status & booleans
    status = payload.get("vehicle_status") or payload.get("status") or "IDLE"
    norm["vehicle_status"] = str(status).upper()
    norm["status"] = norm["vehicle_status"]

    norm["charging"] = bool(payload.get("charging", norm["status"] == "CHARGING"))
    norm["online"] = bool(payload.get("online", True))
    norm["scenario"] = str(payload.get("scenario") or "normal")
    norm["vehicle_type"] = str(payload.get("vehicle_type") or "delivery_ev")
    norm["battery_capacity_kwh"] = float(payload.get("battery_capacity_kwh") or 4.8)

    return ValidationResult(
        is_valid=True,
        normalized_payload=norm,
        issues=issues,
    )
