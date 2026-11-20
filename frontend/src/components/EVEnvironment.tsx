'use client';

import React, { useState, useEffect, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { Vehicle, Alert, TelemetryPoint } from '@/types/fleet';
import ArchitectureDiagram, { ComponentTab } from './ArchitectureDiagram';
import {
  ArrowLeft,
  Battery,
  Zap,
  Navigation,
  Cpu,
  Radio,
  Activity,
  AlertTriangle,
  AlertOctagon,
  Clock,
  Gauge,
  Thermometer,
  Compass,
  CheckCircle,
  Flame,
  PowerOff,
  Bug,
  ShieldAlert,
  RotateCcw,
  TrendingUp,
  AlertCircle,
  Info,
} from 'lucide-react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  ReferenceLine,
} from 'recharts';

// Dynamically import Leaflet map preview with no SSR
const MiniFleetMap = dynamic(() => import('./FleetMap'), { ssr: false });

interface EVEnvironmentProps {
  vehicle: Vehicle;
  history: TelemetryPoint[];
  alerts: Alert[];
  onBack: () => void;
  onScenarioInject: (vehicleId: string, scenario: string) => Promise<void>;
  onAcknowledgeAlert: (id: number) => void;
  onResolveAlert: (id: number) => void;
}

// Detailed scenario metadata for the injection console and live output
const SCENARIO_DETAILS: Record<
  string,
  {
    name: string;
    desc: string;
    category: 'Normal' | 'Thermal' | 'Battery' | 'Electrical' | 'Communication' | 'Data Integrity';
    expectedBehavior: string;
    rules: string[];
    criticalThreshold: string;
    severity: 'normal' | 'warning' | 'critical';
  }
> = {
  normal: {
    name: 'Normal Driving',
    desc: 'Revives EV physics to healthy operational baseline.',
    category: 'Normal',
    expectedBehavior: 'Nominal city delivery route. Pack temp < 45°C, Motor temp < 75°C, voltage 44–52V.',
    rules: ['None (Auto-resolves active alerts)'],
    criticalThreshold: 'All metrics within safety envelope',
    severity: 'normal',
  },
  battery_overheat: {
    name: 'Battery Overheat',
    desc: 'Thermal runaway precursor: rapid pack temperature spike > 55°C.',
    category: 'Thermal',
    expectedBehavior: 'Cell cooling failure. Pack temp rises +2.5°C to +4.0°C per tick up to 68°C.',
    rules: ['PACK_OVERHEAT', 'RAPID_TEMP_RISE'],
    criticalThreshold: 'Pack Temp > 55.0°C (Warning at 45.0°C)',
    severity: 'critical',
  },
  motor_overheat: {
    name: 'Motor Overheat',
    desc: 'Traction motor stator temperature surge > 85°C under high torque load.',
    category: 'Thermal',
    expectedBehavior: 'Motor stator thermal dissipation blockage. Motor temp rises +3.5°C per tick up to 105°C.',
    rules: ['MOTOR_OVERHEAT'],
    criticalThreshold: 'Motor Temp > 85.0°C (Warning at 75.0°C)',
    severity: 'critical',
  },
  low_battery: {
    name: 'Low Battery',
    desc: 'Accelerated Coulomb discharge draining SoC rapidly below 15%.',
    category: 'Battery',
    expectedBehavior: 'Cell imbalance / accelerated discharge. SoC drops 8x faster than nominal.',
    rules: ['LOW_SOC'],
    criticalThreshold: 'SoC < 10.0% (Warning at 20.0%)',
    severity: 'warning',
  },
  energy_spike: {
    name: 'Energy Spike',
    desc: 'Severe voltage sag under contactor/inverter high current surge.',
    category: 'Electrical',
    expectedBehavior: 'Inverter surge. Bus voltage sags below 44V while current surges > 60A.',
    rules: ['VOLTAGE_SAG', 'ABNORMAL_ENERGY_CONSUMPTION'],
    criticalThreshold: 'Voltage < 44.0V, Energy > 0.45 kWh/km',
    severity: 'warning',
  },
  sensor_offline: {
    name: 'Sensor Dropout',
    desc: 'Virtual ESP32 drops MQTT telemetry transmission to simulate comms failure.',
    category: 'Communication',
    expectedBehavior: 'Edge node silence. Telemetry publish stops on MQTT topic.',
    rules: ['HEARTBEAT_MISS'],
    criticalThreshold: 'No packet received for > 2x publish interval (6s)',
    severity: 'critical',
  },
  sensor_invalid: {
    name: 'Sensor Invalid',
    desc: 'Payload contains physically impossible sensor values (e.g. SoC 145%).',
    category: 'Data Integrity',
    expectedBehavior: 'ADC register corruption. Telemetry validator flags out-of-bounds sensor values.',
    rules: ['INVALID_SENSOR_VALUE'],
    criticalThreshold: 'Physical boundary violation (SoC > 100%)',
    severity: 'warning',
  },
  sensor_corrupted: {
    name: 'Sensor Corrupted',
    desc: 'Corrupted non-numeric frame payloads in numeric voltage/temperature fields.',
    category: 'Data Integrity',
    expectedBehavior: 'CAN bus transmission noise. Type validation detects string in numeric fields.',
    rules: ['CORRUPTED_SENSOR_VALUE'],
    criticalThreshold: 'Type mismatch in schema payload',
    severity: 'warning',
  },
  sensor_delayed: {
    name: 'Sensor Delayed',
    desc: 'Stale packets delayed significantly (> 60s in the past).',
    category: 'Communication',
    expectedBehavior: 'Transmission buffer delay or clock desync. Timestamp is > 60s behind server time.',
    rules: ['STALE_TELEMETRY'],
    criticalThreshold: 'Packet latency > 60 seconds',
    severity: 'warning',
  },
};

export default function EVEnvironment({
  vehicle,
  history,
  alerts,
  onBack,
  onScenarioInject,
  onAcknowledgeAlert,
  onResolveAlert,
}: EVEnvironmentProps) {
  const [activeTab, setActiveTab] = useState<ComponentTab>('battery');
  const [isInjecting, setIsInjecting] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [telemetryLogs, setTelemetryLogs] = useState<Array<{ time: string; text: string }>>([]);
  const [liveHistory, setLiveHistory] = useState<TelemetryPoint[]>([]);

  // Telemetry metric extraction
  const soc = vehicle.battery_soc ?? vehicle.soc ?? 0;
  const voltage = vehicle.battery_voltage ?? vehicle.voltage ?? 48.0;
  const packTemp = vehicle.battery_temperature ?? vehicle.pack_temp ?? 30.0;
  const motorTemp = vehicle.motor_temperature ?? vehicle.motor_temp ?? 35.0;
  const current = vehicle.battery_current ?? vehicle.current ?? 0;
  const speed = vehicle.speed ?? 0;
  const lat = vehicle.latitude ?? vehicle.lat ?? 28.6139;
  const lon = vehicle.longitude ?? vehicle.lon ?? 77.2090;
  const heading = vehicle.heading ?? 0;
  const energy = vehicle.energy_consumption_kwh_per_km ?? 0;
  const isOnline = vehicle.online ?? vehicle.is_online ?? true;
  const isCharging = vehicle.charging ?? false;
  const deviceId = vehicle.device_id || `ESP32-${vehicle.id}`;
  const batteryCap = vehicle.battery_capacity_kwh || 4.8;
  const mqttTopic = `fleet/${vehicle.fleet_id || 'fleet_001'}/ev/${vehicle.id}/telemetry`;
  const currentScenario = vehicle.scenario || 'normal';

  // Seed liveHistory from incoming history prop (sorted chronologically oldest -> newest)
  useEffect(() => {
    if (history && history.length > 0) {
      const sorted = [...history].sort((a, b) => {
        const tA = new Date(a.timestamp || 0).getTime();
        const tB = new Date(b.timestamp || 0).getTime();
        return tA - tB;
      });
      setLiveHistory(sorted);
    }
  }, [history]);

  // Stream new live telemetry points directly into liveHistory & telemetryLogs
  useEffect(() => {
    const now = new Date();
    const timeStr = now.toTimeString().split(' ')[0];
    const logText = `TELEMETRY: ${soc.toFixed(1)}% SoC • ${voltage.toFixed(1)}V • ${packTemp.toFixed(1)}°C • ${speed.toFixed(0)} km/h • ${current.toFixed(1)}A`;
    setTelemetryLogs((prev) => [{ time: timeStr, text: logText }, ...prev.slice(0, 24)]);

    const newPoint: TelemetryPoint = {
      timestamp: now.toISOString(),
      soc,
      voltage,
      pack_temp: packTemp,
      motor_temp: motorTemp,
      speed,
      current,
      lat,
      lon,
    };

    setLiveHistory((prev) => {
      // Keep up to 60 historical points for smooth time-series visualization
      const updated = [...prev, newPoint];
      return updated.slice(-60);
    });
  }, [soc, voltage, packTemp, motorTemp, speed, current, lat, lon]); // eslint-disable-line react-hooks/exhaustive-deps

  const activeVehicleAlerts = alerts.filter((a) => a.vehicle_id === vehicle.id && a.is_active);

  // GPS breadcrumb trail for Leaflet polyline
  const gpsTrail = useMemo(() => {
    return liveHistory
      .filter((p) => p.lat && p.lon && !isNaN(p.lat) && !isNaN(p.lon))
      .map((p) => [p.lat, p.lon] as [number, number]);
  }, [liveHistory]);

  const handleApplyScenario = async (scenName: string) => {
    setIsInjecting(true);
    try {
      await onScenarioInject(vehicle.id, scenName);
      setToastMessage(`Injected scenario: ${scenName.toUpperCase()}`);
      setTimeout(() => setToastMessage(null), 3500);
    } catch {
      setToastMessage('Failed to inject scenario');
      setTimeout(() => setToastMessage(null), 3500);
    } finally {
      setIsInjecting(false);
    }
  };

  const getHeadingDirection = (deg: number) => {
    const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    return directions[Math.round(deg / 45) % 8];
  };

  const activeScenarioMeta = SCENARIO_DETAILS[currentScenario] || SCENARIO_DETAILS['normal'];
  const isFaultActive = currentScenario !== 'normal';

  return (
    <div className="flex flex-col gap-6 max-w-7xl mx-auto w-full pb-12">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-5 right-5 z-50 bg-accent-blue text-white px-4 py-2.5 rounded-xl shadow-2xl text-xs font-mono font-medium flex items-center gap-2 animate-bounce">
          <CheckCircle className="w-4 h-4" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Top Breadcrumb & Device Title Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-surface/90 border border-border/80 rounded-xl p-4 sm:p-5 backdrop-blur-md shadow-lg">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-2 border border-border hover:bg-surface-2/80 text-text-muted hover:text-text-primary text-xs font-medium transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back to Fleet</span>
          </button>

          <div className="h-5 w-px bg-border/80" />

          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold font-mono text-text-primary tracking-wide">
                {vehicle.id}
              </h1>
              <span className="text-xs font-mono text-accent-blue px-2 py-0.5 rounded bg-accent-blue/10 border border-accent-blue/30">
                {vehicle.vehicle_type || 'delivery_ev'}
              </span>
            </div>
            <p className="text-xs text-text-muted">
              Virtual EV IoT Edge Node • Microcontroller:{' '}
              <span className="font-mono text-text-primary">{deviceId}</span>
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Active Scenario Badge */}
          <div
            className={`flex items-center gap-1.5 px-3 py-1 rounded-lg border text-xs ${
              isFaultActive
                ? 'bg-accent-red/15 border-accent-red/40 text-accent-red animate-pulse'
                : 'bg-surface-2 border-border text-accent-green'
            }`}
          >
            <span className="text-text-muted text-[11px]">Scenario:</span>
            <span className="font-mono font-bold uppercase">
              {currentScenario.replace(/_/g, ' ')}
            </span>
          </div>

          {/* Online / Offline Status */}
          <div
            className={`flex items-center gap-2 px-3 py-1 rounded-lg border text-xs font-mono ${
              isOnline
                ? 'bg-accent-green/10 text-accent-green border-accent-green/30'
                : 'bg-accent-red/10 text-accent-red border-accent-red/30'
            }`}
          >
            <span
              className={`w-2 h-2 rounded-full ${
                isOnline ? 'bg-accent-green animate-pulse' : 'bg-accent-red'
              }`}
            />
            <span>{isOnline ? 'ONLINE' : 'OFFLINE'}</span>
          </div>
        </div>
      </div>

      {/* VIRTUAL EV ARCHITECTURE Interactive Diagram */}
      <ArchitectureDiagram
        vehicle={vehicle}
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        hasActiveAlert={activeVehicleAlerts.length > 0}
      />

      {/* Component Inspector Tabs */}
      <div className="flex flex-col gap-4">
        {/* Tab Buttons */}
        <div className="flex flex-wrap gap-1.5 border-b border-border/80 pb-2">
          {(
            [
              { id: 'battery', label: 'Battery System & Sensors', icon: Battery },
              { id: 'motor', label: 'Motor & Traction', icon: Zap },
              { id: 'gps', label: 'GPS Navigation & Map', icon: Navigation },
              { id: 'esp32', label: 'Virtual ESP32 Edge', icon: Cpu },
              { id: 'mqtt', label: 'MQTT Transport', icon: Radio },
              { id: 'telemetry', label: 'Live Telemetry Log', icon: Activity },
            ] as const
          ).map((tab) => {
            const Icon = tab.icon;
            const isTabActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-medium transition-all ${
                  isTabActive
                    ? 'bg-accent-blue text-white shadow-md shadow-accent-blue/20 font-semibold'
                    : 'bg-surface/80 text-text-muted hover:text-text-primary hover:bg-surface-2 border border-border/60'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Tab 1: Battery System */}
        {activeTab === 'battery' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            {/* Battery Overview */}
            <div className="lg:col-span-6 bg-surface/90 border border-border/80 rounded-xl p-5 backdrop-blur-sm flex flex-col gap-4">
              <div className="flex items-center justify-between border-b border-border/60 pb-3">
                <span className="text-xs font-semibold uppercase tracking-wider text-text-muted flex items-center gap-1.5">
                  <Battery className="w-4 h-4 text-accent-green" /> Battery Pack Specification
                </span>
                <span className="text-xs font-mono text-accent-blue font-bold">
                  {batteryCap} kWh (48V Nominal)
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="bg-surface-2/60 p-3 rounded-xl border border-border/60 flex flex-col">
                  <span className="text-[11px] text-text-muted">State of Charge</span>
                  <span className="text-2xl font-mono font-bold text-accent-green mt-1">
                    {soc.toFixed(1)}%
                  </span>
                  <div className="w-full bg-surface h-1.5 rounded-full mt-2 overflow-hidden">
                    <div
                      className="bg-accent-green h-full"
                      style={{ width: `${Math.min(100, Math.max(0, soc))}%` }}
                    />
                  </div>
                </div>

                <div className="bg-surface-2/60 p-3 rounded-xl border border-border/60 flex flex-col">
                  <span className="text-[11px] text-text-muted">Pack Voltage</span>
                  <span className="text-2xl font-mono font-bold text-text-primary mt-1">
                    {voltage.toFixed(1)} V
                  </span>
                  <span className="text-[10px] text-text-muted mt-2">
                    Operating Range: 40V – 54V
                  </span>
                </div>

                <div className="bg-surface-2/60 p-3 rounded-xl border border-border/60 flex flex-col">
                  <span className="text-[11px] text-text-muted">Battery Current</span>
                  <span className="text-2xl font-mono font-bold text-accent-yellow mt-1">
                    {current.toFixed(1)} A
                  </span>
                  <span className="text-[10px] text-text-muted mt-2">
                    {isCharging ? 'Charging (+)' : 'Discharge (-)'}
                  </span>
                </div>

                <div
                  className={`p-3 rounded-xl border flex flex-col ${
                    packTemp > 55
                      ? 'bg-accent-red/15 border-accent-red/50 text-accent-red'
                      : packTemp > 45
                      ? 'bg-accent-yellow/15 border-accent-yellow/40 text-accent-yellow'
                      : 'bg-surface-2/60 border-border/60 text-text-primary'
                  }`}
                >
                  <span className="text-[11px] text-text-muted">Pack Temperature</span>
                  <span className="text-2xl font-mono font-bold mt-1">
                    {packTemp.toFixed(1)}°C
                  </span>
                  <span className="text-[10px] text-text-muted mt-2">
                    Critical Threshold: &gt; 55.0°C
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-between text-xs pt-2 border-t border-border/60">
                <span className="text-text-muted">Charging State:</span>
                <span className="font-mono font-bold text-text-primary">
                  {isCharging ? 'YES (Active AC Charger)' : 'NO (Discharging on Route)'}
                </span>
              </div>
            </div>

            {/* Battery Physical Sensors List */}
            <div className="lg:col-span-6 bg-surface/90 border border-border/80 rounded-xl p-5 backdrop-blur-sm flex flex-col gap-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-text-muted flex items-center gap-1.5 border-b border-border/60 pb-3">
                <Zap className="w-4 h-4 text-accent-yellow" /> Virtual Battery Sensors (Hardware Emulation)
              </span>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {/* Sensor 1: SoC */}
                <div className="p-3 bg-surface-2/60 border border-border/60 rounded-xl flex flex-col justify-between gap-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-text-primary">SoC Sensor</span>
                    <span className="text-[10px] font-mono text-accent-green">● ACTIVE</span>
                  </div>
                  <span className="text-lg font-mono font-bold text-accent-green">
                    {soc.toFixed(1)} %
                  </span>
                  <span className="text-[10px] text-text-muted">Analog Gauge (Coulomb Counter)</span>
                </div>

                {/* Sensor 2: Voltage */}
                <div className="p-3 bg-surface-2/60 border border-border/60 rounded-xl flex flex-col justify-between gap-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-text-primary">Voltage Sensor</span>
                    <span className="text-[10px] font-mono text-accent-green">● ACTIVE</span>
                  </div>
                  <span className="text-lg font-mono font-bold text-text-primary">
                    {voltage.toFixed(2)} V
                  </span>
                  <span className="text-[10px] text-text-muted">Bus Potential Divider</span>
                </div>

                {/* Sensor 3: Current */}
                <div className="p-3 bg-surface-2/60 border border-border/60 rounded-xl flex flex-col justify-between gap-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-text-primary">Current Sensor</span>
                    <span className="text-[10px] font-mono text-accent-green">● ACTIVE</span>
                  </div>
                  <span className="text-lg font-mono font-bold text-accent-yellow">
                    {current.toFixed(1)} A
                  </span>
                  <span className="text-[10px] text-text-muted">Hall Effect Transducer</span>
                </div>

                {/* Sensor 4: Temp */}
                <div
                  className={`p-3 border rounded-xl flex flex-col justify-between gap-1 ${
                    packTemp > 55
                      ? 'bg-accent-red/10 border-accent-red/40'
                      : packTemp > 45
                      ? 'bg-accent-yellow/10 border-accent-yellow/30'
                      : 'bg-surface-2/60 border-border/60'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-text-primary">Pack Thermistor</span>
                    <span
                      className={`text-[10px] font-mono ${
                        packTemp > 55
                          ? 'text-accent-red font-bold'
                          : packTemp > 45
                          ? 'text-accent-yellow'
                          : 'text-accent-green'
                      }`}
                    >
                      {packTemp > 55 ? '● CRITICAL' : packTemp > 45 ? '● WARNING' : '● ACTIVE'}
                    </span>
                  </div>
                  <span
                    className={`text-lg font-mono font-bold ${
                      packTemp > 55
                        ? 'text-accent-red'
                        : packTemp > 45
                        ? 'text-accent-yellow'
                        : 'text-text-primary'
                    }`}
                  >
                    {packTemp.toFixed(1)} °C
                  </span>
                  <span className="text-[10px] text-text-muted">NTC Module Thermistor</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Tab 2: Motor System */}
        {activeTab === 'motor' && (
          <div className="bg-surface/90 border border-border/80 rounded-xl p-5 backdrop-blur-sm flex flex-col gap-4">
            <div className="flex items-center justify-between border-b border-border/60 pb-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-text-muted flex items-center gap-1.5">
                <Zap className="w-4 h-4 text-accent-blue" /> Permanent Magnet Traction Motor System
              </span>
              <span
                className={`text-xs font-mono font-bold ${
                  motorTemp > 85
                    ? 'text-accent-red flex items-center gap-1'
                    : motorTemp > 75
                    ? 'text-accent-yellow'
                    : 'text-accent-green'
                }`}
              >
                {motorTemp > 85
                  ? 'MOTOR OVERHEAT FAULT'
                  : motorTemp > 75
                  ? 'THERMAL WARNING'
                  : '● NOMINAL OPERATION'}
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
              <div
                className={`p-4 rounded-xl border flex flex-col gap-2 ${
                  motorTemp > 85
                    ? 'bg-accent-red/15 border-accent-red/50 text-accent-red shadow-[0_0_15px_rgba(239,68,68,0.2)]'
                    : motorTemp > 75
                    ? 'bg-accent-yellow/15 border-accent-yellow/40 text-accent-yellow'
                    : 'bg-surface-2/60 border-border/60 text-text-primary'
                }`}
              >
                <span className="text-[11px] text-text-muted flex items-center gap-1">
                  <Thermometer className="w-3.5 h-3.5" /> Stator Temperature
                </span>
                <span className="text-3xl font-mono font-bold mt-1">
                  {motorTemp.toFixed(1)}°C
                </span>
                <span className="text-[10px] text-text-muted">
                  Warning: &gt;75°C • Critical: &gt;85°C
                </span>
              </div>

              <div className="p-4 rounded-xl bg-surface-2/60 border border-border/60 flex flex-col gap-2">
                <span className="text-[11px] text-text-muted flex items-center gap-1">
                  <Gauge className="w-3.5 h-3.5 text-accent-green" /> Road Velocity
                </span>
                <span className="text-3xl font-mono font-bold text-accent-green mt-1">
                  {speed.toFixed(1)} km/h
                </span>
                <span className="text-[10px] text-text-muted">
                  Calculated from wheel rotation transducer
                </span>
              </div>

              <div className="p-4 rounded-xl bg-surface-2/60 border border-border/60 flex flex-col gap-2">
                <span className="text-[11px] text-text-muted flex items-center gap-1">
                  <Activity className="w-3.5 h-3.5 text-accent-yellow" /> Energy Consumption
                </span>
                <span className="text-3xl font-mono font-bold text-text-primary mt-1">
                  {energy.toFixed(3)} kWh/km
                </span>
                <span className="text-[10px] text-text-muted">
                  Threshold limit: 0.45 kWh/km
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Tab 3: GPS Navigation & Spatial Map */}
        {activeTab === 'gps' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            <div className="lg:col-span-5 bg-surface/90 border border-border/80 rounded-xl p-5 backdrop-blur-sm flex flex-col gap-4">
              <span className="text-xs font-semibold uppercase tracking-wider text-text-muted flex items-center gap-1.5 border-b border-border/60 pb-3">
                <Navigation className="w-4 h-4 text-accent-yellow" /> GPS Transponder Telemetry
              </span>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="bg-surface-2/60 p-3 rounded-xl border border-border/60">
                  <span className="text-[10px] text-text-muted">Latitude</span>
                  <div className="font-mono font-bold text-sm text-text-primary mt-1">
                    {lat.toFixed(6)}° N
                  </div>
                </div>

                <div className="bg-surface-2/60 p-3 rounded-xl border border-border/60">
                  <span className="text-[10px] text-text-muted">Longitude</span>
                  <div className="font-mono font-bold text-sm text-text-primary mt-1">
                    {lon.toFixed(6)}° E
                  </div>
                </div>

                <div className="bg-surface-2/60 p-3 rounded-xl border border-border/60">
                  <span className="text-[10px] text-text-muted">Compass Heading</span>
                  <div className="font-mono font-bold text-sm text-accent-blue mt-1 flex items-center gap-1">
                    <Compass className="w-3.5 h-3.5" />
                    <span>
                      {Math.round(heading)}° ({getHeadingDirection(heading)})
                    </span>
                  </div>
                </div>

                <div className="bg-surface-2/60 p-3 rounded-xl border border-border/60">
                  <span className="text-[10px] text-text-muted">Total Odometer</span>
                  <div className="font-mono font-bold text-sm text-text-primary mt-1">
                    {(vehicle.odometer || vehicle.odometer_km || 0).toFixed(1)} km
                  </div>
                </div>
              </div>

              <div className="p-3 bg-surface-2/40 border border-border/60 rounded-xl text-xs flex items-center justify-between">
                <span className="text-text-muted">GPS Signal Status:</span>
                <span className="text-accent-green font-mono font-semibold">
                  ● 3D FIX (8 SATELLITES)
                </span>
              </div>

              <div className="p-3 bg-surface-2/40 border border-border/60 rounded-xl text-xs flex items-center justify-between">
                <span className="text-text-muted">Delivery Sector:</span>
                <span className="text-accent-blue font-mono font-semibold">
                  Connaught Place / New Delhi
                </span>
              </div>
            </div>

            {/* Mini Map Preview with Live Trail & Auto Center */}
            <div className="lg:col-span-7 bg-surface/90 border border-border/80 rounded-xl p-3 backdrop-blur-sm overflow-hidden flex flex-col gap-2 min-h-[300px]">
              <div className="flex items-center justify-between px-2 pt-1 text-xs">
                <span className="font-semibold text-text-primary flex items-center gap-1">
                  <Navigation className="w-3.5 h-3.5 text-accent-blue" /> Live Spatial Position & Route Path
                </span>
                <span className="text-[10px] font-mono text-text-muted">
                  Waypoints Tracked: {gpsTrail.length}
                </span>
              </div>
              <div className="flex-1 rounded-lg overflow-hidden border border-border min-h-[280px]">
                <MiniFleetMap
                  vehicles={[vehicle]}
                  trail={gpsTrail}
                  autoCenter={true}
                />
              </div>
            </div>
          </div>
        )}

        {/* Tab 4: Virtual ESP32 Edge Node */}
        {activeTab === 'esp32' && (
          <div className="bg-surface/90 border border-border/80 rounded-xl p-5 backdrop-blur-sm flex flex-col gap-4">
            <div className="flex items-center justify-between border-b border-border/60 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-accent-blue/15 border border-accent-blue/30 flex items-center justify-center text-accent-blue">
                  <Cpu className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-text-primary">
                    Virtual ESP32 Edge Microcontroller Node
                  </h3>
                  <p className="text-xs text-text-muted">
                    Software-emulated edge computer polling simulated hardware registers
                  </p>
                </div>
              </div>
              <span className="font-mono text-xs px-2.5 py-1 rounded-full bg-accent-green/15 text-accent-green border border-accent-green/30">
                ● FIRMWARE ACTIVE (v2.4.0)
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 text-xs font-mono">
              <div className="bg-surface-2/60 p-3 rounded-xl border border-border/60">
                <span className="text-[10px] text-text-muted uppercase block">Hardware Device ID</span>
                <span className="text-sm font-bold text-accent-blue mt-1 block">{deviceId}</span>
              </div>

              <div className="bg-surface-2/60 p-3 rounded-xl border border-border/60">
                <span className="text-[10px] text-text-muted uppercase block">Associated Vehicle ID</span>
                <span className="text-sm font-bold text-text-primary mt-1 block">{vehicle.id}</span>
              </div>

              <div className="bg-surface-2/60 p-3 rounded-xl border border-border/60">
                <span className="text-[10px] text-text-muted uppercase block">Edge Connection</span>
                <span className="text-sm font-bold text-accent-green mt-1 block">● CONNECTED</span>
              </div>

              <div className="bg-surface-2/60 p-3 rounded-xl border border-border/60">
                <span className="text-[10px] text-text-muted uppercase block">Telemetry Transmission</span>
                <span
                  className={`text-sm font-bold mt-1 block ${
                    currentScenario === 'sensor_offline' ? 'text-accent-red' : 'text-accent-green'
                  }`}
                >
                  {currentScenario === 'sensor_offline' ? '● DROPPED (OFFLINE)' : '● STREAMING'}
                </span>
              </div>
            </div>

            <div className="p-4 bg-surface-2/40 border border-border/60 rounded-xl flex flex-col gap-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-text-muted">Publish Topic:</span>
                <span className="font-mono text-accent-blue font-semibold">{mqttTopic}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-text-muted">Edge Protocol:</span>
                <span className="font-mono text-text-primary">
                  MQTT v3.1.1 over TCP (QoS 1, Clean Session)
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-text-muted">Sensor Polling Engine:</span>
                <span className="font-mono text-text-primary">
                  7 Virtual Sensor Probes @ 10 Hz sampling
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Tab 5: MQTT Transport */}
        {activeTab === 'mqtt' && (
          <div className="bg-surface/90 border border-border/80 rounded-xl p-5 backdrop-blur-sm flex flex-col gap-4">
            <div className="flex items-center justify-between border-b border-border/60 pb-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-text-muted flex items-center gap-1.5">
                <Radio className="w-4 h-4 text-accent-blue" /> Mosquitto MQTT Transport Pipeline
              </span>
              <span className="text-xs font-mono text-accent-green">● BROKER CONNECTED</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs font-mono">
              <div className="bg-surface-2/60 p-3 rounded-xl border border-border/60">
                <span className="text-[10px] text-text-muted uppercase block">MQTT Broker</span>
                <span className="text-sm font-bold text-text-primary mt-1 block">
                  Eclipse Mosquitto 2.x
                </span>
              </div>
              <div className="bg-surface-2/60 p-3 rounded-xl border border-border/60">
                <span className="text-[10px] text-text-muted uppercase block">Broker Ports</span>
                <span className="text-sm font-bold text-accent-blue mt-1 block">
                  1883 (TCP) • 9001 (WS)
                </span>
              </div>
              <div className="bg-surface-2/60 p-3 rounded-xl border border-border/60">
                <span className="text-[10px] text-text-muted uppercase block">Quality of Service</span>
                <span className="text-sm font-bold text-accent-green mt-1 block">
                  QoS 1 (At least once)
                </span>
              </div>
            </div>

            <div className="bg-surface-2/30 p-3 rounded-xl border border-border/60 font-mono text-xs">
              <span className="text-text-muted block text-[10px] uppercase mb-1">
                Active Publish Topic
              </span>
              <div className="text-accent-blue font-bold p-2 bg-surface rounded-lg border border-border/80 select-all">
                {mqttTopic}
              </div>
            </div>
          </div>
        )}

        {/* Tab 6: Live Telemetry Log */}
        {activeTab === 'telemetry' && (
          <div className="bg-surface/90 border border-border/80 rounded-xl p-5 backdrop-blur-sm flex flex-col gap-3">
            <div className="flex items-center justify-between border-b border-border/60 pb-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-text-muted flex items-center gap-1.5">
                <Activity className="w-4 h-4 text-accent-green" /> Real-Time Telemetry Event Log
              </span>
              <span className="text-[10px] font-mono text-text-muted">
                Live Stream (Last {telemetryLogs.length} updates)
              </span>
            </div>

            <div className="h-56 overflow-y-auto font-mono text-xs flex flex-col gap-1.5 p-2 bg-surface-2/60 rounded-xl border border-border/60">
              {telemetryLogs.length === 0 ? (
                <div className="text-text-muted text-center py-8">
                  Waiting for incoming telemetry packets...
                </div>
              ) : (
                telemetryLogs.map((log, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2.5 py-1 px-2 rounded hover:bg-surface/50 transition-colors"
                  >
                    <span className="text-accent-blue text-[11px] shrink-0">{log.time}</span>
                    <span className="text-text-primary text-[11px]">{log.text}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Fault / Scenario Injection Console & Live Output ─────────────── */}
      <div className="bg-surface/90 border border-border/80 rounded-xl p-5 backdrop-blur-sm shadow-xl flex flex-col gap-5">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-3">
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wider text-text-primary flex items-center gap-2">
              <Flame className="w-4 h-4 text-accent-red" /> Fault & Scenario Injection Console
            </h3>
            <p className="text-xs text-text-muted mt-0.5">
              Inject hardware faults, physical stress, or sensor corruptions into {vehicle.id}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs font-mono px-2.5 py-1 rounded bg-surface-2 border border-border text-text-muted">
              Target: <strong className="text-accent-blue">{vehicle.id}</strong>
            </span>

            {isFaultActive && (
              <button
                type="button"
                onClick={() => handleApplyScenario('normal')}
                disabled={isInjecting}
                className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-accent-green/20 text-accent-green border border-accent-green/40 hover:bg-accent-green/30 text-xs font-semibold transition-all shadow-sm"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset to Normal Baseline</span>
              </button>
            )}
          </div>
        </div>

        {/* 9 Scenario Injection Buttons */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
          {(
            [
              {
                id: 'normal',
                name: 'Normal Driving',
                desc: 'Revives EV physics to healthy baseline',
                icon: CheckCircle,
                color: 'border-accent-green/40 hover:bg-accent-green/10 text-accent-green',
              },
              {
                id: 'battery_overheat',
                name: 'Battery Overheat',
                desc: 'Rapid pack temperature spike > 55°C',
                icon: Flame,
                color: 'border-accent-red/40 hover:bg-accent-red/10 text-accent-red',
              },
              {
                id: 'motor_overheat',
                name: 'Motor Overheat',
                desc: 'Traction motor temperature spike > 85°C',
                icon: Zap,
                color: 'border-accent-red/40 hover:bg-accent-red/10 text-accent-red',
              },
              {
                id: 'low_battery',
                name: 'Low Battery',
                desc: 'Accelerated SoC discharge below 15%',
                icon: Battery,
                color: 'border-accent-yellow/40 hover:bg-accent-yellow/10 text-accent-yellow',
              },
              {
                id: 'energy_spike',
                name: 'Energy Spike',
                desc: 'Voltage sag + severe current surge',
                icon: AlertTriangle,
                color: 'border-accent-yellow/40 hover:bg-accent-yellow/10 text-accent-yellow',
              },
              {
                id: 'sensor_offline',
                name: 'Sensor Dropout',
                desc: 'ESP32 stops MQTT payload transmission',
                icon: PowerOff,
                color: 'border-gray-500/40 hover:bg-gray-800 text-gray-400',
              },
              {
                id: 'sensor_invalid',
                name: 'Sensor Invalid',
                desc: 'Out-of-range sensor value (SoC 145%)',
                icon: Bug,
                color: 'border-purple-500/40 hover:bg-purple-900/20 text-purple-400',
              },
              {
                id: 'sensor_corrupted',
                name: 'Sensor Corrupted',
                desc: 'Corrupted string data in numeric fields',
                icon: ShieldAlert,
                color: 'border-pink-500/40 hover:bg-pink-900/20 text-pink-400',
              },
              {
                id: 'sensor_delayed',
                name: 'Sensor Delayed',
                desc: 'Stale packets delayed by > 60 seconds',
                icon: Clock,
                color: 'border-cyan-500/40 hover:bg-cyan-900/20 text-cyan-400',
              },
            ] as const
          ).map((scen) => {
            const Icon = scen.icon;
            const isCurrent = currentScenario === scen.id;
            return (
              <button
                key={scen.id}
                type="button"
                onClick={() => handleApplyScenario(scen.id)}
                disabled={isInjecting}
                className={`p-3 rounded-xl border text-left flex items-start gap-2.5 transition-all ${
                  isCurrent
                    ? 'bg-surface-2 ring-2 ring-accent-blue border-accent-blue shadow-md'
                    : 'bg-surface-2/60 ' + scen.color
                }`}
              >
                <Icon className="w-4 h-4 mt-0.5 shrink-0" />
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-xs text-text-primary">{scen.name}</span>
                    {isCurrent && (
                      <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-accent-blue text-white font-bold">
                        ACTIVE
                      </span>
                    )}
                  </div>
                  <span className="text-[11px] text-text-muted block mt-0.5">{scen.desc}</span>
                </div>
              </button>
            );
          })}
        </div>

        {/* ── DEDICATED REAL-TIME FAULT OUTPUT & IMPACT MONITOR ──────────────── */}
        <div
          className={`p-4 rounded-xl border transition-all ${
            isFaultActive
              ? 'bg-accent-red/10 border-accent-red/40 text-text-primary'
              : 'bg-surface-2/40 border-border/80 text-text-primary'
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-3 mb-3">
            <div className="flex items-center gap-2">
              <span
                className={`w-2.5 h-2.5 rounded-full ${
                  isFaultActive ? 'bg-accent-red animate-ping' : 'bg-accent-green'
                }`}
              />
              <span className="font-mono font-bold text-xs uppercase tracking-wider">
                {isFaultActive
                  ? `FAULT INJECTION OUTPUT: ${activeScenarioMeta.name.toUpperCase()}`
                  : 'SYSTEM OPERATING AT NOMINAL BASELINE'}
              </span>
            </div>

            <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-surface border border-border text-text-muted">
              Category: <strong className="text-accent-blue">{activeScenarioMeta.category}</strong>
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
            {/* Column 1: Physical Simulation Effect */}
            <div className="bg-surface/60 p-3 rounded-lg border border-border/60 flex flex-col gap-1.5">
              <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider flex items-center gap-1">
                <Info className="w-3.5 h-3.5 text-accent-blue" /> Physical Simulation Effect
              </span>
              <p className="text-[11px] text-text-primary leading-relaxed">
                {activeScenarioMeta.expectedBehavior}
              </p>
            </div>

            {/* Column 2: Triggered Anomaly Rules */}
            <div className="bg-surface/60 p-3 rounded-lg border border-border/60 flex flex-col gap-1.5">
              <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider flex items-center gap-1">
                <AlertCircle className="w-3.5 h-3.5 text-accent-yellow" /> Anomaly Detection Rules
              </span>
              <div className="flex flex-wrap gap-1 mt-0.5">
                {activeScenarioMeta.rules.map((rule, idx) => (
                  <span
                    key={idx}
                    className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-surface-2 border border-border text-accent-yellow font-bold"
                  >
                    {rule}
                  </span>
                ))}
              </div>
              <span className="text-[10px] text-text-muted mt-1">
                Threshold: {activeScenarioMeta.criticalThreshold}
              </span>
            </div>

            {/* Column 3: Live Sensor Readings Output */}
            <div className="bg-surface/60 p-3 rounded-lg border border-border/60 flex flex-col gap-1.5">
              <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider flex items-center gap-1">
                <TrendingUp className="w-3.5 h-3.5 text-accent-green" /> Live Metric Values
              </span>
              <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
                <div>
                  <span className="text-text-muted block text-[10px]">Pack Temp:</span>
                  <span
                    className={`font-bold ${
                      packTemp > 55 ? 'text-accent-red' : packTemp > 45 ? 'text-accent-yellow' : 'text-text-primary'
                    }`}
                  >
                    {packTemp.toFixed(1)}°C
                  </span>
                </div>
                <div>
                  <span className="text-text-muted block text-[10px]">Motor Temp:</span>
                  <span
                    className={`font-bold ${
                      motorTemp > 85 ? 'text-accent-red' : motorTemp > 75 ? 'text-accent-yellow' : 'text-text-primary'
                    }`}
                  >
                    {motorTemp.toFixed(1)}°C
                  </span>
                </div>
                <div>
                  <span className="text-text-muted block text-[10px]">Bus Voltage:</span>
                  <span
                    className={`font-bold ${voltage < 44 ? 'text-accent-yellow' : 'text-text-primary'}`}
                  >
                    {voltage.toFixed(1)}V
                  </span>
                </div>
                <div>
                  <span className="text-text-muted block text-[10px]">Battery SoC:</span>
                  <span
                    className={`font-bold ${soc < 15 ? 'text-accent-red' : 'text-accent-green'}`}
                  >
                    {soc.toFixed(1)}%
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Telemetry History Chart (Recharts with Live Real-Time Updates) ── */}
      <div className="bg-surface/90 border border-border/80 rounded-xl p-5 backdrop-blur-sm shadow-xl flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-text-primary flex items-center gap-1.5">
              <Activity className="w-4 h-4 text-accent-blue" /> Telemetry Time-Series History
            </span>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-accent-green/15 text-accent-green border border-accent-green/30 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-accent-green animate-pulse" />
              LIVE STREAMING
            </span>
          </div>

          <span className="text-[11px] font-mono text-text-muted">
            Displaying last {liveHistory.length} chronological points
          </span>
        </div>

        <div className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={liveHistory}
              margin={{ top: 10, right: 15, left: -15, bottom: 5 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.35} />
              <XAxis
                dataKey="timestamp"
                stroke="#9ca3af"
                fontSize={10}
                tickFormatter={(val) => {
                  if (typeof val === 'string') {
                    const parts = val.split('T');
                    return parts[1]?.slice(0, 8) || val;
                  }
                  return String(val);
                }}
              />
              <YAxis
                yAxisId="left"
                stroke="#9ca3af"
                fontSize={10}
                domain={['auto', 'auto']}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                domain={[0, 100]}
                stroke="#10b981"
                fontSize={10}
                unit="%"
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#111827',
                  borderColor: '#374151',
                  fontSize: '11px',
                  borderRadius: '8px',
                  boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.5)',
                }}
              />
              <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '8px' }} />

              {/* Reference Warning Lines */}
              <ReferenceLine
                yAxisId="left"
                y={55}
                stroke="#f97316"
                strokeDasharray="4 4"
                label={{ value: 'Pack Limit (55°C)', fill: '#f97316', fontSize: 9, position: 'insideTopLeft' }}
              />
              <ReferenceLine
                yAxisId="left"
                y={85}
                stroke="#ef4444"
                strokeDasharray="4 4"
                label={{ value: 'Motor Limit (85°C)', fill: '#ef4444', fontSize: 9, position: 'insideTopRight' }}
              />
              <ReferenceLine
                yAxisId="left"
                y={44}
                stroke="#38bdf8"
                strokeDasharray="3 3"
                label={{ value: 'Sag (44V)', fill: '#38bdf8', fontSize: 9, position: 'insideBottomLeft' }}
              />

              {/* Data Lines */}
              <Line
                yAxisId="left"
                type="monotone"
                dataKey="pack_temp"
                name="Pack Temp (°C)"
                stroke="#f97316"
                strokeWidth={2.5}
                dot={false}
                isAnimationActive={false}
              />
              <Line
                yAxisId="left"
                type="monotone"
                dataKey="motor_temp"
                name="Motor Temp (°C)"
                stroke="#ef4444"
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
              <Line
                yAxisId="left"
                type="monotone"
                dataKey="voltage"
                name="Voltage (V)"
                stroke="#38bdf8"
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
              />
              <Line
                yAxisId="left"
                type="monotone"
                dataKey="speed"
                name="Speed (km/h)"
                stroke="#a855f7"
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
              />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="soc"
                name="SoC (%)"
                stroke="#10b981"
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ── Active Alerts for this vehicle ───────────────────────────────── */}
      <div className="bg-surface/90 border border-border/80 rounded-xl p-5 backdrop-blur-sm shadow-xl flex flex-col gap-3">
        <div className="flex items-center justify-between border-b border-border/60 pb-3">
          <span className="text-xs font-semibold uppercase tracking-wider text-text-muted flex items-center gap-1.5">
            <AlertTriangle className="w-4 h-4 text-accent-yellow" /> Active Anomaly Alerts ({activeVehicleAlerts.length})
          </span>
        </div>

        {activeVehicleAlerts.length === 0 ? (
          <div className="p-4 bg-surface-2/40 border border-border/60 rounded-xl text-center text-xs text-text-muted">
            No active anomalies detected for {vehicle.id}. All telemetry values within normal operational thresholds.
          </div>
        ) : (
          <div className="flex flex-col gap-2.5">
            {activeVehicleAlerts.map((alert) => (
              <div
                key={alert.id}
                className={`p-3.5 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                  alert.alert_type === 'CRITICAL'
                    ? 'bg-accent-red/10 border-accent-red/40'
                    : 'bg-accent-yellow/10 border-accent-yellow/30'
                }`}
              >
                <div className="flex items-start gap-2.5">
                  {alert.alert_type === 'CRITICAL' ? (
                    <AlertOctagon className="w-4 h-4 text-accent-red mt-0.5 shrink-0" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-accent-yellow mt-0.5 shrink-0" />
                  )}
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono font-bold text-text-primary">
                        {alert.rule}
                      </span>
                      <span className="text-[10px] font-mono px-1.5 rounded bg-surface border border-border font-bold">
                        {alert.alert_type}
                      </span>
                    </div>
                    <p className="text-xs text-text-primary mt-0.5">{alert.message}</p>
                    {alert.recommended_action && (
                      <p className="text-[11px] text-text-muted mt-1 italic">
                        Action: {alert.recommended_action}
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 self-end sm:self-center">
                  {!alert.acknowledged && (
                    <button
                      type="button"
                      onClick={() => onAcknowledgeAlert(alert.id)}
                      className="px-2.5 py-1 text-xs font-medium rounded-lg bg-surface border border-border hover:bg-surface-2 text-text-primary transition-colors"
                    >
                      Acknowledge
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => onResolveAlert(alert.id)}
                    className="px-2.5 py-1 text-xs font-medium rounded-lg bg-accent-green/20 text-accent-green border border-accent-green/40 hover:bg-accent-green/30 transition-colors"
                  >
                    Resolve
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
