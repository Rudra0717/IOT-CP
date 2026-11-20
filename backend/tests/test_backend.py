"""
Unit tests for the EV Fleet Backend components.
Tests validation, anomaly rules (thresholds, patterns, communication),
alert deduplication, and database operations.

Run with: python -m unittest test_backend.py
"""

import unittest
import os
import sys
import time
from datetime import datetime, timezone, timedelta

# Point to backend directory and use a test SQLite database
BACKEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, BACKEND_DIR)

TEST_DB_PATH = os.path.join(BACKEND_DIR, "data", "test_fleet.db")
os.environ["DATABASE_URL"] = f"sqlite:///{TEST_DB_PATH.replace(os.sep, '/')}"

from validation import validate_telemetry, parse_timestamp, ValidationIssue
from anomaly.thresholds import ThresholdEvaluator
from anomaly.patterns import PatternEvaluator
from anomaly.communication import CommunicationEvaluator
from anomaly.engine import AnomalyEngine
from database import init_db, SessionLocal, Vehicle, TelemetrySnapshot, Alert, upsert_vehicle, insert_snapshot


class TestValidation(unittest.TestCase):
    def test_valid_payload_normalization(self):
        payload = {
            "vehicle_id": "EV-001",
            "device_id": "ESP32-EV-001",
            "fleet_id": "fleet_001",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "battery_soc": 78.5,
            "battery_voltage": 49.2,
            "battery_temp": 32.0,
            "motor_temp": 45.0,
            "current": 15.0,
            "speed": 35.0,
            "heading": 90.0,
            "energy_consumption_kwh_per_km": 0.045,
            "lat": 28.6139,
            "lon": 77.2090,
            "status": "DRIVING",
            "scenario": "normal",
        }
        res = validate_telemetry(payload)
        self.assertTrue(res.is_valid)
        self.assertEqual(len(res.issues), 0)
        self.assertEqual(res.normalized_payload["vehicle_id"], "EV-001")
        self.assertEqual(res.normalized_payload["device_id"], "ESP32-EV-001")
        self.assertEqual(res.normalized_payload["soc"], 78.5)
        self.assertEqual(res.normalized_payload["voltage"], 49.2)

    def test_missing_vehicle_identity(self):
        payload = {"soc": 50.0}
        res = validate_telemetry(payload)
        self.assertFalse(res.is_valid)
        self.assertTrue(any(i.rule == "MISSING_IDENTITY" for i in res.issues))

    def test_corrupted_sensor_value_handled(self):
        payload = {
            "vehicle_id": "EV-002",
            "timestamp": time.time(),
            "battery_soc": "ERROR_CORRUPTED",
            "speed": 20.0,
        }
        res = validate_telemetry(payload)
        # Should not crash; should flag CORRUPTED_SENSOR_VALUE
        self.assertTrue(any(i.rule == "CORRUPTED_SENSOR_VALUE" and i.field == "battery_soc" for i in res.issues))
        # Normalizes to fallback
        self.assertIsInstance(res.normalized_payload["battery_soc"], float)

    def test_invalid_sensor_range_clamped(self):
        payload = {
            "vehicle_id": "EV-003",
            "timestamp": time.time(),
            "battery_soc": 145.0,  # Range is 0 - 100
            "battery_voltage": 80.0,  # Range is 10 - 80
        }
        res = validate_telemetry(payload)
        self.assertTrue(any(i.rule == "INVALID_SENSOR_VALUE" and i.field == "battery_soc" for i in res.issues))
        self.assertEqual(res.normalized_payload["battery_soc"], 145.0)

    def test_stale_telemetry_detection(self):
        # 90 seconds old timestamp (> 60s threshold)
        old_time = (datetime.now(timezone.utc) - timedelta(seconds=90)).isoformat()
        payload = {
            "vehicle_id": "EV-004",
            "timestamp": old_time,
            "battery_soc": 50.0,
        }
        res = validate_telemetry(payload)
        self.assertTrue(any(i.rule == "STALE_TELEMETRY" for i in res.issues))


class TestThresholdEvaluator(unittest.TestCase):
    def setUp(self):
        self.evaluator = ThresholdEvaluator()

    def test_low_soc_thresholds(self):
        # Warning < 15%
        res_warn = self.evaluator.evaluate({"vehicle_id": "EV-001", "battery_soc": 12.0})
        self.assertTrue(any(a.rule == "LOW_SOC" and a.alert_type == "WARNING" for a in res_warn))

        # Critical < 5%
        res_crit = self.evaluator.evaluate({"vehicle_id": "EV-001", "battery_soc": 3.0})
        self.assertTrue(any(a.rule == "LOW_SOC" and a.alert_type == "CRITICAL" for a in res_crit))

    def test_overheat_thresholds(self):
        # Pack temp > 45 (Warning), > 55 (Critical)
        res_pack = self.evaluator.evaluate({"vehicle_id": "EV-001", "battery_temperature": 58.0})
        self.assertTrue(any(a.rule == "PACK_OVERHEAT" and a.alert_type == "CRITICAL" for a in res_pack))

        # Motor temp > 75 (Warning), > 85 (Critical)
        res_motor = self.evaluator.evaluate({"vehicle_id": "EV-001", "motor_temperature": 79.0})
        self.assertTrue(any(a.rule == "MOTOR_OVERHEAT" and a.alert_type == "WARNING" for a in res_motor))

    def test_voltage_sag_under_load(self):
        # Sag: voltage < 44.0 under load (current > 10.0)
        res_sag = self.evaluator.evaluate({"vehicle_id": "EV-001", "battery_voltage": 42.5, "current": 25.0})
        self.assertTrue(any(a.rule == "VOLTAGE_SAG" for a in res_sag))

        # No sag if current is low (no load)
        res_no_sag = self.evaluator.evaluate({"vehicle_id": "EV-001", "battery_voltage": 42.5, "current": 2.0})
        self.assertFalse(any(a.rule == "VOLTAGE_SAG" for a in res_no_sag))

    def test_energy_spike(self):
        # High consumption: > 0.45 kWh/km (Warning), > 1.0 (Critical)
        res_energy = self.evaluator.evaluate({"vehicle_id": "EV-001", "energy_consumption_kwh_per_km": 1.25})
        self.assertTrue(any(a.rule == "ABNORMAL_ENERGY_CONSUMPTION" and a.alert_type == "CRITICAL" for a in res_energy))


class TestPatternEvaluator(unittest.TestCase):
    def setUp(self):
        self.evaluator = PatternEvaluator(window_size=5)

    def test_rapid_temp_rise(self):
        vid = "EV-P1"
        # Simulate temp rising rapidly by +4°C in 5 steps
        temps = [30.0, 31.0, 32.5, 34.0, 35.5]
        anomalies = []
        for t in temps:
            anomalies = self.evaluator.evaluate({"vehicle_id": vid, "battery_temperature": t, "battery_voltage": 48.0, "lat": 28.61, "lon": 77.20})
        self.assertTrue(any(a.rule == "RAPID_TEMP_RISE" for a in anomalies))

    def test_sudden_voltage_drop(self):
        vid = "EV-P2"
        # 4 steady voltage readings followed by sudden drop of > 3V
        voltages = [48.0, 48.0, 48.0, 48.0, 43.5]
        anomalies = []
        for v in voltages:
            anomalies = self.evaluator.evaluate({"vehicle_id": vid, "battery_temperature": 30.0, "battery_voltage": v, "lat": 28.61, "lon": 77.20})
        self.assertTrue(any(a.rule == "SUDDEN_VOLTAGE_DROP" for a in anomalies))


class TestCommunicationEvaluator(unittest.TestCase):
    def setUp(self):
        self.evaluator = CommunicationEvaluator(interval=1.0)

    def test_heartbeat_miss_and_recovery(self):
        vid = "EV-C1"
        self.evaluator.update_heartbeat(vid, "fleet_001", "ESP32-EV-C1")

        # No missed heartbeat immediately
        misses = self.evaluator.check_heartbeats()
        self.assertFalse(any(m.vehicle_id == vid for m in misses))

        # Backdate last seen to simulate timeout (> 2 * interval = 2.0s)
        self.evaluator._heartbeats[vid] = time.time() - 3.0
        misses = self.evaluator.check_heartbeats()
        self.assertTrue(any(m.vehicle_id == vid and m.rule == "HEARTBEAT_MISS" for m in misses))

        # Recovery on subsequent payload
        recovered = self.evaluator.update_heartbeat(vid, "fleet_001", "ESP32-EV-C1")
        self.assertEqual(recovered, vid)


class TestDatabaseAndAnomalyEngine(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        init_db()

    def test_upsert_vehicle_and_snapshot(self):
        db = SessionLocal()
        try:
            payload = {
                "vehicle_id": "EV-DB1",
                "device_id": "ESP32-EV-DB1",
                "fleet_id": "fleet_001",
                "battery_soc": 72.0,
                "battery_voltage": 48.5,
                "battery_temp": 31.0,
                "motor_temp": 42.0,
                "current": 18.0,
                "speed": 40.0,
                "heading": 120.0,
                "energy_consumption_kwh_per_km": 0.052,
                "vehicle_type": "delivery_ev",
                "battery_capacity_kwh": 4.8,
                "charging": False,
                "lat": 28.62,
                "lon": 77.21,
                "status": "DRIVING",
                "scenario": "normal",
            }
            v = upsert_vehicle(db, payload)
            self.assertEqual(v.id, "EV-DB1")
            self.assertEqual(v.device_id, "ESP32-EV-DB1")
            self.assertEqual(v.vehicle_type, "delivery_ev")
            self.assertEqual(v.heading, 120.0)

            snap = insert_snapshot(db, payload)
            self.assertEqual(snap.vehicle_id, "EV-DB1")
            self.assertEqual(snap.energy_consumption, 0.052)
        finally:
            db.close()

    def test_stateful_alert_deduplication_and_autoresolution(self):
        engine = AnomalyEngine(interval=3.0)

        # 1. Trigger low SOC anomaly
        high_heat_payload = {
            "vehicle_id": "EV-DEDUP",
            "fleet_id": "fleet_001",
            "battery_temperature": 60.0,  # Critical > 55
            "battery_voltage": 48.0,
            "current": 5.0,
        }
        alerts1, resolved = engine.evaluate_payload(high_heat_payload)
        self.assertEqual(len(alerts1), 1)
        self.assertEqual(alerts1[0]["rule"], "PACK_OVERHEAT")
        alert_id_first = alerts1[0]["id"]

        # 2. Trigger again with same high heat -> must update same alert, not create a new ID
        alerts2, resolved = engine.evaluate_payload(high_heat_payload)
        self.assertEqual(len(alerts2), 1)
        self.assertEqual(alerts2[0]["id"], alert_id_first)

        # 3. Send normal payload -> must auto-resolve PACK_OVERHEAT
        normal_payload = {
            "vehicle_id": "EV-DEDUP",
            "fleet_id": "fleet_001",
            "battery_temperature": 30.0,  # Normal temp
            "battery_voltage": 48.0,
            "current": 5.0,
        }
        alerts3, resolved = engine.evaluate_payload(normal_payload)
        self.assertEqual(len(alerts3), 0)
        self.assertTrue(any(r["rule"] == "PACK_OVERHEAT" for r in resolved))

    def test_interval_synchronization(self):
        engine = AnomalyEngine(interval=3.0)
        self.assertEqual(engine.interval, 3.0)
        self.assertEqual(engine.communication.interval, 3.0)

        # Synchronize interval to 10 seconds
        engine.set_interval(10.0)
        self.assertEqual(engine.interval, 10.0)
        self.assertEqual(engine.communication.interval, 10.0)

        # Heartbeat check should not trigger at 7 seconds since timeout is 2 * 10 = 20s
        engine.communication.update_heartbeat("EV-SYNC1", "fleet_001", "ESP32-EV-SYNC1")
        engine.communication._heartbeats["EV-SYNC1"] = time.time() - 7.0
        misses = engine.communication.check_heartbeats()
        self.assertFalse(any(m.vehicle_id == "EV-SYNC1" for m in misses))

    def test_battery_capacity_propagation(self):
        payload = {
            "vehicle_id": "EV-BAT1",
            "battery_capacity_kwh": 5.2,
            "timestamp": time.time(),
        }
        res = validate_telemetry(payload)
        self.assertEqual(res.normalized_payload["battery_capacity_kwh"], 5.2)

        db = SessionLocal()
        try:
            v = upsert_vehicle(db, res.normalized_payload)
            self.assertEqual(v.battery_capacity_kwh, 5.2)
        finally:
            db.close()


if __name__ == "__main__":
    unittest.main()
