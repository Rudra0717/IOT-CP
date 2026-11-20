"""
patterns.py
===========
Temporal and trend-based pattern anomaly detection.
Maintains a sliding history buffer per vehicle to detect rapid temperature spikes,
sudden voltage drops, and erratic GPS jumps.
"""

from typing import Any, List, Optional
from collections import deque
import math
import logging

from .thresholds import AnomalyResult

logger = logging.getLogger(__name__)


class PatternEvaluator:
    """Detects temporal patterns and abnormal rates of change."""

    def __init__(self, window_size: int = 5) -> None:
        self.window_size = window_size
        # vehicle_id -> deque of recent (timestamp, pack_temp, voltage, lat, lon)
        self._history: dict[str, deque[tuple[float, float, float, float, float]]] = {}

    def evaluate(self, payload: dict[str, Any]) -> List[AnomalyResult]:
        results: List[AnomalyResult] = []

        vehicle_id = payload.get("vehicle_id") or payload.get("id", "UNKNOWN")
        fleet_id   = payload.get("fleet_id", "")
        device_id  = payload.get("device_id") or f"ESP32-{vehicle_id}"

        pack_temp = payload.get("battery_temperature") if payload.get("battery_temperature") is not None else payload.get("pack_temp")
        voltage   = payload.get("battery_voltage") if payload.get("battery_voltage") is not None else payload.get("voltage")
        lat       = payload.get("latitude") if payload.get("latitude") is not None else payload.get("lat")
        lon       = payload.get("longitude") if payload.get("longitude") is not None else payload.get("lon")

        try:
            pt_f = float(pack_temp) if pack_temp is not None else None
            v_f  = float(voltage) if voltage is not None else None
            lat_f = float(lat) if lat is not None else None
            lon_f = float(lon) if lon is not None else None
        except (ValueError, TypeError):
            return results

        if vehicle_id not in self._history:
            self._history[vehicle_id] = deque(maxlen=self.window_size)

        buf = self._history[vehicle_id]

        if pt_f is not None and v_f is not None and lat_f is not None and lon_f is not None:
            if len(buf) >= 3:
                # 1. Rapid temperature rise detection
                oldest_pt = buf[0][1]
                delta_temp = pt_f - oldest_pt
                if delta_temp >= 4.0:
                    results.append(AnomalyResult(
                        vehicle_id=vehicle_id,
                        fleet_id=fleet_id,
                        device_id=device_id,
                        alert_type="WARNING",
                        rule="RAPID_TEMP_RISE",
                        message=f"Rapid battery temperature increase detected (+{delta_temp:.1f}°C in {len(buf)} samples)",
                        value=delta_temp,
                        threshold=4.0,
                        recommended_action="Proactive cooling alert: reduce acceleration and monitor cell thermals.",
                    ))

                # 2. Sudden voltage drop detection
                avg_voltage = sum(entry[2] for entry in buf) / len(buf)
                drop_v = avg_voltage - v_f
                if drop_v >= 3.0:
                    results.append(AnomalyResult(
                        vehicle_id=vehicle_id,
                        fleet_id=fleet_id,
                        device_id=device_id,
                        alert_type="WARNING",
                        rule="SUDDEN_VOLTAGE_DROP",
                        message=f"Sudden voltage drop detected (-{drop_v:.2f}V from moving average)",
                        value=drop_v,
                        threshold=3.0,
                        recommended_action="Inspect auxiliary loads and battery interconnect cables for loose contact.",
                    ))

                # 3. Erratic GPS / position jump
                prev_lat, prev_lon = buf[-1][3], buf[-1][4]
                d_lat = lat_f - prev_lat
                d_lon = lon_f - prev_lon
                dist_deg = math.sqrt(d_lat ** 2 + d_lon ** 2)
                if dist_deg > 0.05:  # ~5 km leap in one tick
                    results.append(AnomalyResult(
                        vehicle_id=vehicle_id,
                        fleet_id=fleet_id,
                        device_id=device_id,
                        alert_type="WARNING",
                        rule="ERRATIC_GPS",
                        message=f"Impossible GPS jump detected (displacement {dist_deg * 111.0:.1f} km)",
                        value=dist_deg * 111.0,
                        threshold=5.0,
                        recommended_action="Verify GNSS receiver signal and multipath interference.",
                    ))

            # Record sample
            import time
            buf.append((time.time(), pt_f, v_f, lat_f, lon_f))

        return results
