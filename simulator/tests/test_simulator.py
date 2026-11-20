"""
Unit tests for the EV Fleet Simulator components.
Run with: python -m unittest test_simulator.py
"""

import unittest
import time
import os
import sys

# Add parent directory to path so simulator modules can be imported
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from vehicle import VirtualEV, _compute_heading
from scenarios import SCENARIOS
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
from virtual_esp32 import VirtualESP32


class TestVirtualEV(unittest.TestCase):
    def setUp(self):
        self.ev = VirtualEV(
            vehicle_id="EV-001",
            fleet_id="fleet_001",
            interval=3.0,
            vehicle_type="delivery_ev",
            battery_capacity_kwh=4.8,
        )

    def test_ev_initial_state(self):
        self.assertEqual(self.ev.vehicle_id, "EV-001")
        self.assertEqual(self.ev.fleet_id, "fleet_001")
        self.assertEqual(self.ev.vehicle_type, "delivery_ev")
        self.assertGreaterEqual(self.ev.soc, 50.0)
        self.assertLessEqual(self.ev.soc, 100.0)
        self.assertEqual(self.ev.voltage, 48.0)
        self.assertEqual(self.ev.scenario, "normal")
        self.assertTrue(self.ev.online)

    def test_heading_calculation(self):
        # East: lat equal, lon increases -> 90 deg
        h_east = _compute_heading(28.0, 77.0, 28.0, 77.1)
        self.assertAlmostEqual(h_east, 90.0, delta=1.0)
        # North: lat increases, lon equal -> 0 deg
        h_north = _compute_heading(28.0, 77.0, 28.1, 77.0)
        self.assertAlmostEqual(h_north, 0.0, delta=1.0)

    def test_state_advancement_and_energy(self):
        # Force driving state
        self.ev.status = "DRIVING"
        self.ev.speed = 50.0
        self.ev.current = 40.0
        self.ev.voltage = 48.0
        self.ev.update_state()

        self.assertGreater(self.ev.odometer, 0.0)
        # Energy consumption should be ~ (48 * 40 / 1000) / 50 = 1.92 / 50 = ~0.0384
        self.assertGreater(self.ev.energy_consumption_kwh_per_km, 0.0)
        self.assertLess(self.ev.energy_consumption_kwh_per_km, 5.0)

    def test_scenario_switching_and_recovery(self):
        self.ev.set_scenario("battery_overheat")
        self.assertEqual(self.ev.scenario, "battery_overheat")
        self.assertEqual(self.ev.scenario_config.name, "battery_overheat")

        # Simulate fault state
        self.ev.soc = 2.0
        self.ev.update_state()
        self.assertEqual(self.ev.status, "FAULT")

        # Switching to normal must revive the vehicle
        self.ev.set_scenario("normal")
        self.assertEqual(self.ev.status, "IDLE")
        self.assertGreaterEqual(self.ev.soc, 50.0)


class TestVirtualSensorsAndESP32(unittest.TestCase):
    def setUp(self):
        self.ev = VirtualEV("EV-002", "fleet_001", 3.0)
        self.device = VirtualESP32(self.ev, publish_interval=3.0)

    def test_device_sensors_normal(self):
        self.assertEqual(self.device.device_id, "ESP32-EV-002")
        telemetry = self.device.read_telemetry()
        self.assertIsNotNone(telemetry)
        self.assertEqual(telemetry["vehicle_id"], "EV-002")
        self.assertEqual(telemetry["device_id"], "ESP32-EV-002")
        self.assertIn("battery_soc", telemetry)
        self.assertIn("energy_consumption_kwh_per_km", telemetry)
        self.assertIn("heading", telemetry)

    def test_sensor_offline_dropout(self):
        self.ev.set_scenario("sensor_offline")
        telemetry = self.device.read_telemetry()
        self.assertIsNone(telemetry)

    def test_sensor_invalid_scenario(self):
        self.ev.set_scenario("sensor_invalid")
        telemetry = self.device.read_telemetry()
        self.assertIsNotNone(telemetry)
        # In sensor_invalid, SoC sensor emits 145.0
        self.assertEqual(telemetry["battery_soc"], 145.0)

    def test_sensor_corrupted_scenario(self):
        self.ev.set_scenario("sensor_corrupted")
        telemetry = self.device.read_telemetry()
        self.assertIsNotNone(telemetry)
        self.assertEqual(telemetry["battery_soc"], "ERROR")

    def test_sensor_delayed_scenario(self):
        self.ev.set_scenario("sensor_delayed")
        telemetry = self.device.read_telemetry()
        self.assertIsNotNone(telemetry)
        # Timestamp must be in ISO format
        self.assertIn("T", telemetry["timestamp"])


if __name__ == "__main__":
    unittest.main()
