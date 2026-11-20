"""
telemetry_processor.py
======================
Decoupled Telemetry Processing Layer for EV SENSE.

Pipeline:
  MQTT Ingestion
       ↓
  JSON Parsing & Extraction
       ↓
  Schema & Range Validation (validation.py)
       ↓
  Metadata Normalization & Enrichment
       ↓
  Database Persistence (vehicles state + time-series snapshots)
       ↓
  Modular Anomaly Detection (anomaly/engine.py)
       ↓
  WebSocket Broadcasts (telemetry, alerts, fleet summary)
"""

import json
import logging
import time
from datetime import datetime
from typing import Any, Callable, Optional

from validation import validate_telemetry, ValidationResult
from database import SessionLocal, upsert_vehicle, insert_snapshot
from anomaly.engine import AnomalyEngine
from websocket_manager import ConnectionManager

logger = logging.getLogger(__name__)


class TelemetryProcessor:
    """Processes, validates, stores, and evaluates incoming EV telemetry."""

    def __init__(
        self,
        anomaly_engine: AnomalyEngine,
        ws_manager: ConnectionManager,
        db_session_factory: Callable = SessionLocal,
    ) -> None:
        self.anomaly_engine = anomaly_engine
        self.ws_manager = ws_manager
        self.db_session_factory = db_session_factory

        # Live in-memory vehicle cache: vehicle_id -> latest payload dict
        self.vehicles_cache: dict[str, dict[str, Any]] = {}

    async def process_raw_message(self, topic: str, raw_bytes: bytes) -> Optional[dict[str, Any]]:
        """Process a raw MQTT telemetry message through the complete pipeline."""
        # 1. Parse JSON safely
        try:
            payload: dict[str, Any] = json.loads(raw_bytes.decode("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError) as exc:
            logger.warning("Malformed JSON received on topic %s: %s", topic, exc)
            return None

        # 2. Extract vehicle_id and fleet_id fallback from MQTT topic if missing
        # Topic format: fleet/{fleet_id}/ev/{vehicle_id}/telemetry
        if not payload.get("vehicle_id") and not payload.get("id"):
            parts = topic.split("/")
            if len(parts) >= 4:
                payload["vehicle_id"] = parts[3]

        if not payload.get("fleet_id"):
            parts = topic.split("/")
            if len(parts) >= 2:
                payload["fleet_id"] = parts[1]

        # 3. Telemetry validation & range checks
        val_res: ValidationResult = validate_telemetry(payload)
        if not val_res.is_valid:
            logger.warning("Dropped invalid telemetry message on %s: %s", topic, val_res.issues)
            return None

        norm = val_res.normalized_payload
        vehicle_id = norm["vehicle_id"]

        # 4. Update in-memory vehicle cache
        norm["_last_seen_ts"] = time.time()
        self.vehicles_cache[vehicle_id] = norm

        # 5. Persist to DB (current vehicle state + historical time-series snapshot)
        db = self.db_session_factory()
        try:
            upsert_vehicle(db, norm)
            insert_snapshot(db, norm)
        except Exception as exc:
            logger.error("Database persistence error for %s: %s", vehicle_id, exc)
        finally:
            db.close()

        # 6. Evaluate anomalies & process alert lifecycle
        new_or_updated_alerts, resolved_alerts = self.anomaly_engine.evaluate_payload(
            norm, validation_issues=val_res.issues
        )

        # 7. Broadcast alerts over WebSocket
        for alert_data in new_or_updated_alerts:
            await self.ws_manager.broadcast("NEW_ALERT", alert_data)

        for resolved_data in resolved_alerts:
            await self.ws_manager.broadcast("ALERT_RESOLVED", resolved_data)

        # 8. Broadcast normalized telemetry event
        # Strip internal temporary keys before broadcast
        broadcast_payload = {k: v for k, v in norm.items() if not k.startswith("_")}
        await self.ws_manager.broadcast("VEHICLE_TELEMETRY", broadcast_payload)

        # 9. Broadcast fleet-level KPI summary
        await self.ws_manager.broadcast("FLEET_UPDATE", self.compute_fleet_summary())

        return norm

    def compute_fleet_summary(self) -> dict[str, Any]:
        """Compute aggregated fleet metrics from in-memory cache."""
        now = time.time()
        online_cutoff = 10.0  # seconds

        total    = len(self.vehicles_cache)
        online   = 0
        charging = 0
        driving  = 0
        idle     = 0
        fault    = 0
        soc_sum  = 0.0
        soc_cnt  = 0

        for v in self.vehicles_cache.values():
            last_ts = v.get("_last_seen_ts", 0)
            is_online = (now - last_ts) < online_cutoff
            if is_online:
                online += 1

            status = str(v.get("vehicle_status") or v.get("status") or "IDLE").upper()
            if status == "CHARGING":
                charging += 1
            elif status == "DRIVING":
                driving += 1
            elif status == "FAULT":
                fault += 1
            else:
                idle += 1

            soc = v.get("battery_soc") if v.get("battery_soc") is not None else v.get("soc")
            if soc is not None:
                try:
                    soc_sum += float(soc)
                    soc_cnt += 1
                except (ValueError, TypeError):
                    pass

        avg_soc = round(soc_sum / soc_cnt, 1) if soc_cnt else 0.0

        # Active alert counts directly from engine cache (O(1), zero DB latency)
        warning_count, critical_count = self.anomaly_engine.get_active_alert_counts()

        return {
            "total_vehicles": total,
            "total":          total,
            "online":         online,
            "offline":        total - online,
            "charging":       charging,
            "driving":        driving,
            "idle":           idle,
            "fault":          fault,
            "average_soc":    avg_soc,
            "warnings":       warning_count,
            "criticals":      critical_count,
            "timestamp":      datetime.utcnow().isoformat(),
        }
