"""
communication.py
================
Communication failure and data-quality anomaly detection.
Tracks heartbeats, detect missing/stale telemetry, and validates data transmission integrity.
"""

from typing import Any, List, Optional
import time
import logging

from .thresholds import AnomalyResult
from validation import ValidationIssue

logger = logging.getLogger(__name__)


class CommunicationEvaluator:
    """Monitors telemetry connectivity, freshness, and data quality."""

    def __init__(self, interval: float = 3.0) -> None:
        self.interval = interval
        # vehicle_id -> last Unix timestamp when a valid payload was received
        self._heartbeats: dict[str, float] = {}
        self._fleet_map: dict[str, str] = {}
        self._device_map: dict[str, str] = {}
        # Track vehicles currently in offline fault state
        self._offline_vehicles: set[str] = set()

    def update_heartbeat(self, vehicle_id: str, fleet_id: str, device_id: str) -> Optional[str]:
        """Record telemetry arrival. Returns vehicle_id if it recovered from an offline state."""
        self._heartbeats[vehicle_id] = time.time()
        self._fleet_map[vehicle_id] = fleet_id
        self._device_map[vehicle_id] = device_id

        if vehicle_id in self._offline_vehicles:
            self._offline_vehicles.remove(vehicle_id)
            logger.info("Vehicle %s recovered communication (heartbeat restored)", vehicle_id)
            return vehicle_id
        return None

    def evaluate_validation_issues(
        self,
        vehicle_id: str,
        fleet_id: str,
        device_id: str,
        issues: List[ValidationIssue],
    ) -> List[AnomalyResult]:
        """Convert data quality and schema validation issues into AnomalyResults."""
        results: List[AnomalyResult] = []

        action_map = {
            "INVALID_SENSOR_VALUE": "Inspect sensor physical limits and sensor calibration.",
            "CORRUPTED_SENSOR_VALUE": "Check CAN bus frame integrity and data serialization.",
            "STALE_TELEMETRY": "Verify transmission buffer latency and edge clock NTP synchronization.",
            "MISSING_IDENTITY": "Verify MQTT topic payload packaging and vehicle registration.",
        }

        for issue in issues:
            results.append(
                AnomalyResult(
                    vehicle_id=vehicle_id,
                    fleet_id=fleet_id,
                    device_id=device_id,
                    alert_type=issue.severity,
                    rule=issue.rule,
                    message=issue.message,
                    value=float(issue.value) if isinstance(issue.value, (int, float)) else 0.0,
                    threshold=0.0,
                    recommended_action=action_map.get(issue.rule, "Inspect virtual sensor communication."),
                )
            )

        return results

    def check_heartbeats(self) -> List[AnomalyResult]:
        """Scan all tracked vehicles and return HEARTBEAT_MISS for overdue telemetry."""
        now = time.time()
        deadline = 2.0 * self.interval
        results: List[AnomalyResult] = []

        for vehicle_id, last_ts in list(self._heartbeats.items()):
            elapsed = now - last_ts
            if elapsed > deadline:
                fleet_id = self._fleet_map.get(vehicle_id, "fleet_001")
                device_id = self._device_map.get(vehicle_id, f"ESP32-{vehicle_id}")
                self._offline_vehicles.add(vehicle_id)

                results.append(
                    AnomalyResult(
                        vehicle_id=vehicle_id,
                        fleet_id=fleet_id,
                        device_id=device_id,
                        alert_type="CRITICAL",
                        rule="HEARTBEAT_MISS",
                        message=f"No telemetry from {vehicle_id} for {elapsed:.0f}s (expected every {self.interval:.0f}s)",
                        value=round(elapsed, 1),
                        threshold=deadline,
                        recommended_action="Check virtual ESP32 device network link and broker subscription.",
                    )
                )

        return results
