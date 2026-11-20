"""
thresholds.py
=============
Rule-based static and range threshold anomaly checks.
"""

from typing import Any, List, Optional
from dataclasses import dataclass


@dataclass
class AnomalyResult:
    vehicle_id: str
    fleet_id: str
    device_id: str
    alert_type: str   # 'WARNING' | 'CRITICAL'
    rule: str
    message: str
    value: float
    threshold: float
    recommended_action: str


class ThresholdEvaluator:
    """Evaluates static physical limit thresholds."""

    SOC_CRITICAL_THRESHOLD  = 5.0    # %
    SOC_WARNING_THRESHOLD   = 15.0   # %

    PACK_TEMP_CRITICAL      = 55.0   # °C
    PACK_TEMP_WARNING       = 45.0   # °C

    MOTOR_TEMP_CRITICAL     = 85.0   # °C
    MOTOR_TEMP_WARNING      = 75.0   # °C

    VOLTAGE_SAG_THRESHOLD   = 44.0   # V
    VOLTAGE_SAG_CURRENT_MIN = 10.0   # A

    ENERGY_CRITICAL         = 1.0    # kWh / km
    ENERGY_WARNING          = 0.45   # kWh / km

    def evaluate(self, payload: dict[str, Any]) -> List[AnomalyResult]:
        results: List[AnomalyResult] = []

        vehicle_id = payload.get("vehicle_id") or payload.get("id", "UNKNOWN")
        fleet_id   = payload.get("fleet_id", "")
        device_id  = payload.get("device_id") or f"ESP32-{vehicle_id}"

        soc        = payload.get("battery_soc") if payload.get("battery_soc") is not None else payload.get("soc")
        pack_temp  = payload.get("battery_temperature") if payload.get("battery_temperature") is not None else payload.get("pack_temp")
        motor_temp = payload.get("motor_temperature") if payload.get("motor_temperature") is not None else payload.get("motor_temp")
        voltage    = payload.get("battery_voltage") if payload.get("battery_voltage") is not None else payload.get("voltage")
        current    = payload.get("battery_current") if payload.get("battery_current") is not None else payload.get("current", 0.0)
        energy     = payload.get("energy_consumption_kwh_per_km") if payload.get("energy_consumption_kwh_per_km") is not None else payload.get("energy_consumption", 0.0)

        # 1. State-of-Charge (SoC)
        if soc is not None:
            try:
                soc_f = float(soc)
                if soc_f < self.SOC_CRITICAL_THRESHOLD:
                    results.append(AnomalyResult(
                        vehicle_id=vehicle_id,
                        fleet_id=fleet_id,
                        device_id=device_id,
                        alert_type="CRITICAL",
                        rule="LOW_SOC",
                        message=f"SoC critically low: {soc_f:.1f}% (threshold {self.SOC_CRITICAL_THRESHOLD}%)",
                        value=soc_f,
                        threshold=self.SOC_CRITICAL_THRESHOLD,
                        recommended_action="Immediate charging required. Vehicle in critical reserve.",
                    ))
                elif soc_f < self.SOC_WARNING_THRESHOLD:
                    results.append(AnomalyResult(
                        vehicle_id=vehicle_id,
                        fleet_id=fleet_id,
                        device_id=device_id,
                        alert_type="WARNING",
                        rule="LOW_SOC",
                        message=f"SoC low: {soc_f:.1f}% (threshold {self.SOC_WARNING_THRESHOLD}%)",
                        value=soc_f,
                        threshold=self.SOC_WARNING_THRESHOLD,
                        recommended_action="Schedule vehicle charging or reduce route payload.",
                    ))
            except (ValueError, TypeError):
                pass

        # 2. Battery pack temperature
        if pack_temp is not None:
            try:
                temp_f = float(pack_temp)
                if temp_f > self.PACK_TEMP_CRITICAL:
                    results.append(AnomalyResult(
                        vehicle_id=vehicle_id,
                        fleet_id=fleet_id,
                        device_id=device_id,
                        alert_type="CRITICAL",
                        rule="PACK_OVERHEAT",
                        message=f"Battery temperature critical: {temp_f:.1f}°C (threshold {self.PACK_TEMP_CRITICAL}°C)",
                        value=temp_f,
                        threshold=self.PACK_TEMP_CRITICAL,
                        recommended_action="Thermal hazard: halt vehicle and isolate battery cooling loop.",
                    ))
                elif temp_f > self.PACK_TEMP_WARNING:
                    results.append(AnomalyResult(
                        vehicle_id=vehicle_id,
                        fleet_id=fleet_id,
                        device_id=device_id,
                        alert_type="WARNING",
                        rule="PACK_OVERHEAT",
                        message=f"Battery temperature high: {temp_f:.1f}°C (threshold {self.PACK_TEMP_WARNING}°C)",
                        value=temp_f,
                        threshold=self.PACK_TEMP_WARNING,
                        recommended_action="Inspect battery cooling fan and reduce heavy acceleration.",
                    ))
            except (ValueError, TypeError):
                pass

        # 3. Motor temperature
        if motor_temp is not None:
            try:
                mtemp_f = float(motor_temp)
                if mtemp_f > self.MOTOR_TEMP_CRITICAL:
                    results.append(AnomalyResult(
                        vehicle_id=vehicle_id,
                        fleet_id=fleet_id,
                        device_id=device_id,
                        alert_type="CRITICAL",
                        rule="MOTOR_OVERHEAT",
                        message=f"Motor temperature critical: {mtemp_f:.1f}°C (threshold {self.MOTOR_TEMP_CRITICAL}°C)",
                        value=mtemp_f,
                        threshold=self.MOTOR_TEMP_CRITICAL,
                        recommended_action="Motor overload: shut down traction drive immediately.",
                    ))
                elif mtemp_f > self.MOTOR_TEMP_WARNING:
                    results.append(AnomalyResult(
                        vehicle_id=vehicle_id,
                        fleet_id=fleet_id,
                        device_id=device_id,
                        alert_type="WARNING",
                        rule="MOTOR_OVERHEAT",
                        message=f"Motor temperature high: {mtemp_f:.1f}°C (threshold {self.MOTOR_TEMP_WARNING}°C)",
                        value=mtemp_f,
                        threshold=self.MOTOR_TEMP_WARNING,
                        recommended_action="Reduce vehicle speed and check inverter cooling.",
                    ))
            except (ValueError, TypeError):
                pass

        # 4. Voltage sag under load
        if voltage is not None and current is not None:
            try:
                v_f = float(voltage)
                c_f = float(current)
                if c_f > self.VOLTAGE_SAG_CURRENT_MIN and v_f < self.VOLTAGE_SAG_THRESHOLD:
                    results.append(AnomalyResult(
                        vehicle_id=vehicle_id,
                        fleet_id=fleet_id,
                        device_id=device_id,
                        alert_type="WARNING",
                        rule="VOLTAGE_SAG",
                        message=f"Voltage sag detected: {v_f:.2f}V under {c_f:.1f}A load (threshold {self.VOLTAGE_SAG_THRESHOLD}V)",
                        value=v_f,
                        threshold=self.VOLTAGE_SAG_THRESHOLD,
                        recommended_action="Inspect battery cell balance and main contactor resistance.",
                    ))
            except (ValueError, TypeError):
                pass

        # 5. Energy consumption
        if energy is not None:
            try:
                e_f = float(energy)
                if e_f > self.ENERGY_CRITICAL:
                    results.append(AnomalyResult(
                        vehicle_id=vehicle_id,
                        fleet_id=fleet_id,
                        device_id=device_id,
                        alert_type="CRITICAL",
                        rule="ABNORMAL_ENERGY_CONSUMPTION",
                        message=f"Severe energy spike: {e_f:.3f} kWh/km (threshold {self.ENERGY_CRITICAL} kWh/km)",
                        value=e_f,
                        threshold=self.ENERGY_CRITICAL,
                        recommended_action="Inspect traction inverter for short-circuit or regenerative brake lock.",
                    ))
                elif e_f > self.ENERGY_WARNING:
                    results.append(AnomalyResult(
                        vehicle_id=vehicle_id,
                        fleet_id=fleet_id,
                        device_id=device_id,
                        alert_type="WARNING",
                        rule="ABNORMAL_ENERGY_CONSUMPTION",
                        message=f"High energy consumption: {e_f:.3f} kWh/km (threshold {self.ENERGY_WARNING} kWh/km)",
                        value=e_f,
                        threshold=self.ENERGY_WARNING,
                        recommended_action="Check for mechanical drag, low tire pressure, or severe headwind.",
                    ))
            except (ValueError, TypeError):
                pass

        return results
