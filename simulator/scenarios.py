"""
scenarios.py
============
Defines driving / fault / sensor scenarios for the EV Fleet Simulator.

Each scenario is a ``ScenarioConfig`` dataclass that the ``VirtualEV``
physics engine and ``VirtualESP32`` sensor emulator pick up every tick.

Available scenarios
-------------------
- normal          : regular urban-delivery driving
- battery_overheat: pack temperature spikes to 55-65 degC
- motor_overheat  : motor temperature spikes to 90-100 degC
- low_battery     : state-of-charge drains rapidly to 5-12 %
- energy_spike    : voltage sags + current & energy consumption spike
- sensor_offline  : payload dropped to simulate sensor / comms dropout
- sensor_invalid  : payload contains physically impossible sensor values (e.g. SoC > 100)
- sensor_corrupted: payload contains corrupted field types (e.g. string 'ERROR')
- sensor_delayed  : payload timestamp is stale / delayed significantly in the past
"""

from dataclasses import dataclass
from typing import Optional


@dataclass(frozen=True)
class ScenarioConfig:
    """Immutable configuration for a single simulation scenario.

    Attributes
    ----------
    name : str
        Machine-readable scenario identifier.
    description : str
        Human-readable explanation of what this scenario simulates.
    soc_drain_multiplier : float
        Multiplier applied to the normal SoC drain rate.
    temp_spike : float
        Extra degrees Celsius added to ``pack_temp`` every tick.
    motor_temp_spike : float
        Extra degrees Celsius added to ``motor_temp`` every tick.
    voltage_offset : float
        Constant offset (V) added to the computed bus voltage.
    current_multiplier : float
        Multiplier applied to the traction current draw.
    drop_payload : bool
        When ``True`` the device drops telemetry publish.
    speed_multiplier : float
        Multiplier applied to the random target speed.
    sensor_fault_type : Optional[str]
        None, 'invalid', 'corrupted', or 'delayed'.
    delayed_seconds : float
        Number of seconds in the past to report when delayed.
    """

    name: str
    description: str
    soc_drain_multiplier: float = 1.0
    temp_spike: float = 0.0
    motor_temp_spike: float = 0.0
    voltage_offset: float = 0.0
    current_multiplier: float = 1.0
    drop_payload: bool = False
    speed_multiplier: float = 1.0
    sensor_fault_type: Optional[str] = None
    delayed_seconds: float = 0.0


# ---------------------------------------------------------------------------
# Scenario registry
# ---------------------------------------------------------------------------

SCENARIOS: dict[str, ScenarioConfig] = {
    # ------------------------------------------------------------------
    # NORMAL - baseline urban delivery driving
    # ------------------------------------------------------------------
    "normal": ScenarioConfig(
        name="normal",
        description=(
            "Regular urban-delivery driving. Moderate speed, nominal SoC drain, "
            "pack and motor temperatures within safe operating range."
        ),
        soc_drain_multiplier=1.0,
        temp_spike=0.0,
        motor_temp_spike=0.0,
        voltage_offset=0.0,
        current_multiplier=1.0,
        drop_payload=False,
        speed_multiplier=1.0,
        sensor_fault_type=None,
    ),
    # ------------------------------------------------------------------
    # BATTERY OVERHEAT - pack temperature climbs rapidly
    # ------------------------------------------------------------------
    "battery_overheat": ScenarioConfig(
        name="battery_overheat",
        description=(
            "Battery thermal runaway precursor: pack temperature spikes rapidly "
            "towards 55-65 degC due to a cooling-system fault or aggressive charging. "
            "SoC drain is slightly elevated."
        ),
        soc_drain_multiplier=1.3,
        temp_spike=2.5,
        motor_temp_spike=0.5,
        voltage_offset=-0.8,
        current_multiplier=1.1,
        drop_payload=False,
        speed_multiplier=0.85,
        sensor_fault_type=None,
    ),
    # ------------------------------------------------------------------
    # MOTOR OVERHEAT - motor temperature climbs rapidly
    # ------------------------------------------------------------------
    "motor_overheat": ScenarioConfig(
        name="motor_overheat",
        description=(
            "Motor thermal fault: motor temperature spikes towards 90-100 degC "
            "due to sustained overload or cooling-loop failure. "
            "Vehicle may enter a fault state."
        ),
        soc_drain_multiplier=1.4,
        temp_spike=0.3,
        motor_temp_spike=3.5,
        voltage_offset=-1.2,
        current_multiplier=1.5,
        drop_payload=False,
        speed_multiplier=0.7,
        sensor_fault_type=None,
    ),
    # ------------------------------------------------------------------
    # LOW BATTERY - SoC drains aggressively
    # ------------------------------------------------------------------
    "low_battery": ScenarioConfig(
        name="low_battery",
        description=(
            "Rapid state-of-charge depletion simulating a degraded battery pack "
            "or unexpectedly high auxiliary loads. SoC drops to 5-12 % quickly, "
            "triggering a FAULT status."
        ),
        soc_drain_multiplier=8.0,
        temp_spike=0.8,
        motor_temp_spike=0.5,
        voltage_offset=-2.5,
        current_multiplier=1.2,
        drop_payload=False,
        speed_multiplier=0.9,
        sensor_fault_type=None,
    ),
    # ------------------------------------------------------------------
    # ENERGY SPIKE - voltage sag + current spike
    # ------------------------------------------------------------------
    "energy_spike": ScenarioConfig(
        name="energy_spike",
        description=(
            "Sudden energy anomaly: bus voltage sags significantly while traction "
            "current spikes (e.g. regenerative braking system failure or short-circuit), "
            "driving energy consumption far above expected bounds."
        ),
        soc_drain_multiplier=3.0,
        temp_spike=1.2,
        motor_temp_spike=2.0,
        voltage_offset=-5.0,
        current_multiplier=4.5,
        drop_payload=False,
        speed_multiplier=1.0,
        sensor_fault_type=None,
    ),
    # ------------------------------------------------------------------
    # SENSOR OFFLINE - telemetry dropout
    # ------------------------------------------------------------------
    "sensor_offline": ScenarioConfig(
        name="sensor_offline",
        description=(
            "Telemetry sensor or communication module offline. The vehicle continues "
            "operating normally internally, but no payload is published - simulating "
            "a GPS/CAN dropout or broker disconnection."
        ),
        soc_drain_multiplier=1.0,
        temp_spike=0.0,
        motor_temp_spike=0.0,
        voltage_offset=0.0,
        current_multiplier=1.0,
        drop_payload=True,
        speed_multiplier=1.0,
        sensor_fault_type="offline",
    ),
    # ------------------------------------------------------------------
    # SENSOR INVALID - out of physical bounds
    # ------------------------------------------------------------------
    "sensor_invalid": ScenarioConfig(
        name="sensor_invalid",
        description=(
            "Sensor reports out-of-range impossible physical values (e.g. SoC = 145%, "
            "negative battery voltage, or extreme temperatures) to test data validation."
        ),
        soc_drain_multiplier=1.0,
        temp_spike=0.0,
        motor_temp_spike=0.0,
        voltage_offset=0.0,
        current_multiplier=1.0,
        drop_payload=False,
        speed_multiplier=1.0,
        sensor_fault_type="invalid",
    ),
    # ------------------------------------------------------------------
    # SENSOR CORRUPTED - malformed field data
    # ------------------------------------------------------------------
    "sensor_corrupted": ScenarioConfig(
        name="sensor_corrupted",
        description=(
            "Sensor reading is corrupted into invalid types (e.g. numeric sensor "
            "transmitting 'ERROR' or NaN values) to verify graceful backend handling."
        ),
        soc_drain_multiplier=1.0,
        temp_spike=0.0,
        motor_temp_spike=0.0,
        voltage_offset=0.0,
        current_multiplier=1.0,
        drop_payload=False,
        speed_multiplier=1.0,
        sensor_fault_type="corrupted",
    ),
    # ------------------------------------------------------------------
    # SENSOR DELAYED - stale telemetry timestamps
    # ------------------------------------------------------------------
    "sensor_delayed": ScenarioConfig(
        name="sensor_delayed",
        description=(
            "Telemetry messages are transmitted with timestamps lagging significantly "
            "in the past (e.g. 120 seconds old), simulating transmission lag or buffer replay."
        ),
        soc_drain_multiplier=1.0,
        temp_spike=0.0,
        motor_temp_spike=0.0,
        voltage_offset=0.0,
        current_multiplier=1.0,
        drop_payload=False,
        speed_multiplier=1.0,
        sensor_fault_type="delayed",
        delayed_seconds=120.0,
    ),
}
