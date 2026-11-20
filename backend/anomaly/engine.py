"""
engine.py
=========
Central Anomaly Engine orchestrating threshold, pattern, and communication checks,
with stateful alert deduplication and auto-resolution.
"""

from typing import Any, List, Optional
from datetime import datetime
import logging

from .thresholds import ThresholdEvaluator, AnomalyResult
from .patterns import PatternEvaluator
from .communication import CommunicationEvaluator
from validation import ValidationIssue
from database import SessionLocal, Alert

logger = logging.getLogger(__name__)


class AnomalyEngine:
    """Main Anomaly Detection and Alert Lifecycle Engine."""

    def __init__(self, interval: float = 3.0) -> None:
        self.interval = interval
        self.thresholds = ThresholdEvaluator()
        self.patterns = PatternEvaluator(window_size=5)
        self.communication = CommunicationEvaluator(interval=interval)

        # In-memory deduplication cache: (vehicle_id, rule) -> active Alert.id
        self._active_alerts: dict[tuple[str, str], int] = {}
        # (vehicle_id, rule) -> alert_type ('WARNING' or 'CRITICAL')
        self._active_alert_types: dict[tuple[str, str], str] = {}
        self._populate_active_alerts_cache()

    def _populate_active_alerts_cache(self) -> None:
        """Seed the active alert cache from the database at startup."""
        db = SessionLocal()
        try:
            active_db_alerts = db.query(Alert).filter(Alert.is_active == True).all()
            for a in active_db_alerts:
                self._active_alerts[(a.vehicle_id, a.rule)] = a.id
                self._active_alert_types[(a.vehicle_id, a.rule)] = a.alert_type
            logger.info("Loaded %d active alerts into deduplication cache", len(self._active_alerts))
        except Exception as exc:
            logger.warning("Could not pre-populate active alerts cache: %s", exc)
        finally:
            db.close()

    def get_active_alert_counts(self) -> tuple[int, int]:
        """Return (warning_count, critical_count) without database roundtrips."""
        warns = sum(1 for t in self._active_alert_types.values() if t == "WARNING")
        crits = sum(1 for t in self._active_alert_types.values() if t == "CRITICAL")
        return warns, crits

    def set_interval(self, new_interval: float) -> None:
        """Dynamically update publish interval for heartbeat timeout calculation."""
        self.interval = new_interval
        self.communication.interval = new_interval

    def evaluate_payload(
        self,
        payload: dict[str, Any],
        validation_issues: Optional[List[ValidationIssue]] = None,
    ) -> tuple[List[dict[str, Any]], List[dict[str, Any]]]:
        """
        Evaluate all rules against incoming telemetry.

        Returns
        -------
        tuple[list[dict], list[dict]]
            (new_or_updated_alerts, auto_resolved_alerts)
        """
        vehicle_id = payload.get("vehicle_id") or payload.get("id", "UNKNOWN")
        fleet_id   = payload.get("fleet_id", "")
        device_id  = payload.get("device_id") or f"ESP32-{vehicle_id}"

        # 1. Update heartbeat tracking & check communication recovery
        recovered_vid = self.communication.update_heartbeat(vehicle_id, fleet_id, device_id)
        resolved_alerts: List[dict[str, Any]] = []

        db = SessionLocal()
        try:
            if recovered_vid:
                # If heartbeat is recovered, auto-resolve any active HEARTBEAT_MISS alert
                res = self._auto_resolve_alert(db, vehicle_id, "HEARTBEAT_MISS")
                if res:
                    resolved_alerts.append(res)

            # 2. Run rule evaluators
            triggered_anomalies: List[AnomalyResult] = []

            # (a) Threshold rules
            triggered_anomalies.extend(self.thresholds.evaluate(payload))

            # (b) Pattern / temporal rules
            triggered_anomalies.extend(self.patterns.evaluate(payload))

            # (c) Data-quality validation issues
            if validation_issues:
                triggered_anomalies.extend(
                    self.communication.evaluate_validation_issues(
                        vehicle_id, fleet_id, device_id, validation_issues
                    )
                )

            # 3. Check for cleared threshold conditions to auto-resolve active alerts
            triggered_rules = {a.rule for a in triggered_anomalies}

            # Check SoC recovery
            soc = payload.get("battery_soc") or payload.get("soc")
            if soc is not None and float(soc) >= self.thresholds.SOC_WARNING_THRESHOLD:
                res = self._auto_resolve_alert(db, vehicle_id, "LOW_SOC")
                if res:
                    resolved_alerts.append(res)

            # Check Pack Temp recovery
            pt = payload.get("battery_temperature") or payload.get("pack_temp")
            if pt is not None and float(pt) <= self.thresholds.PACK_TEMP_WARNING:
                res = self._auto_resolve_alert(db, vehicle_id, "PACK_OVERHEAT")
                if res:
                    resolved_alerts.append(res)

            # Check Motor Temp recovery
            mt = payload.get("motor_temperature") or payload.get("motor_temp")
            if mt is not None and float(mt) <= self.thresholds.MOTOR_TEMP_WARNING:
                res = self._auto_resolve_alert(db, vehicle_id, "MOTOR_OVERHEAT")
                if res:
                    resolved_alerts.append(res)

            # 4. Deduplicate and persist active alerts
            processed_alerts: List[dict[str, Any]] = []

            for anomaly in triggered_anomalies:
                key = (anomaly.vehicle_id, anomaly.rule)
                active_alert_id = self._active_alerts.get(key)

                if active_alert_id:
                    # Update existing active alert to prevent flooding
                    existing_alert = db.query(Alert).filter(Alert.id == active_alert_id).first()
                    if existing_alert and existing_alert.is_active:
                        existing_alert.value = anomaly.value
                        existing_alert.message = anomaly.message
                        existing_alert.alert_type = anomaly.alert_type
                        db.commit()
                        db.refresh(existing_alert)
                        self._active_alert_types[key] = anomaly.alert_type
                        processed_alerts.append(self._alert_to_dict(existing_alert))
                        continue

                # Create fresh active alert
                new_alert = Alert(
                    vehicle_id=anomaly.vehicle_id,
                    fleet_id=anomaly.fleet_id,
                    device_id=anomaly.device_id,
                    alert_type=anomaly.alert_type,
                    rule=anomaly.rule,
                    message=anomaly.message,
                    value=anomaly.value,
                    threshold=anomaly.threshold,
                    recommended_action=anomaly.recommended_action,
                    is_active=True,
                    acknowledged=False,
                    created_at=datetime.utcnow(),
                )
                db.add(new_alert)
                db.commit()
                db.refresh(new_alert)

                self._active_alerts[key] = new_alert.id
                self._active_alert_types[key] = new_alert.alert_type
                processed_alerts.append(self._alert_to_dict(new_alert))

            return processed_alerts, resolved_alerts

        finally:
            db.close()

    def check_heartbeats(self) -> List[dict[str, Any]]:
        """Periodic scan for missing telemetry from active vehicles."""
        misses = self.communication.check_heartbeats()
        if not misses:
            return []

        saved_alerts: List[dict[str, Any]] = []
        db = SessionLocal()
        try:
            for miss in misses:
                key = (miss.vehicle_id, miss.rule)
                active_id = self._active_alerts.get(key)
                if active_id:
                    # Update existing ongoing heartbeat miss alert
                    alert = db.query(Alert).filter(Alert.id == active_id).first()
                    if alert and alert.is_active:
                        alert.value = miss.value
                        alert.message = miss.message
                        db.commit()
                        db.refresh(alert)
                        saved_alerts.append(self._alert_to_dict(alert))
                        continue

                # Insert new heartbeat miss alert
                new_alert = Alert(
                    vehicle_id=miss.vehicle_id,
                    fleet_id=miss.fleet_id,
                    device_id=miss.device_id,
                    alert_type=miss.alert_type,
                    rule=miss.rule,
                    message=miss.message,
                    value=miss.value,
                    threshold=miss.threshold,
                    recommended_action=miss.recommended_action,
                    is_active=True,
                    acknowledged=False,
                    created_at=datetime.utcnow(),
                )
                db.add(new_alert)
                db.commit()
                db.refresh(new_alert)

                self._active_alerts[key] = new_alert.id
                self._active_alert_types[key] = new_alert.alert_type
                saved_alerts.append(self._alert_to_dict(new_alert))

            return saved_alerts
        finally:
            db.close()

    def _auto_resolve_alert(self, db: Any, vehicle_id: str, rule: str) -> Optional[dict[str, Any]]:
        """Mark an active alert as resolved once the condition has cleared."""
        key = (vehicle_id, rule)
        alert_id = self._active_alerts.pop(key, None)
        self._active_alert_types.pop(key, None)
        if not alert_id:
            return None

        alert = db.query(Alert).filter(Alert.id == alert_id).first()
        if alert and alert.is_active:
            alert.is_active = False
            alert.resolved_at = datetime.utcnow()
            db.commit()
            db.refresh(alert)
            logger.info("Auto-resolved alert #%d for %s (%s)", alert.id, vehicle_id, rule)
            return self._alert_to_dict(alert)
        return None

    @staticmethod
    def _alert_to_dict(a: Alert) -> dict[str, Any]:
        return {
            "id": a.id,
            "vehicle_id": a.vehicle_id,
            "fleet_id": a.fleet_id,
            "device_id": a.device_id,
            "alert_type": a.alert_type,
            "rule": a.rule,
            "message": a.message,
            "value": a.value,
            "threshold": a.threshold,
            "recommended_action": a.recommended_action,
            "is_active": a.is_active,
            "acknowledged": a.acknowledged,
            "created_at": a.created_at.isoformat() if a.created_at else None,
            "resolved_at": a.resolved_at.isoformat() if a.resolved_at else None,
        }
