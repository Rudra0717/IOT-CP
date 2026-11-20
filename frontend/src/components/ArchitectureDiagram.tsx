'use client';

import React from 'react';
import { Vehicle } from '@/types/fleet';
import {
  Car,
  Battery,
  Zap,
  Cpu,
  Radio,
  Server,
  Navigation,
  Activity,
  AlertTriangle,
  AlertOctagon,
} from 'lucide-react';

export type ComponentTab = 'battery' | 'motor' | 'gps' | 'esp32' | 'mqtt' | 'telemetry';

interface ArchitectureDiagramProps {
  vehicle: Vehicle;
  activeTab: ComponentTab;
  onSelectTab: (tab: ComponentTab) => void;
  hasActiveAlert?: boolean;
}

export default function ArchitectureDiagram({
  vehicle,
  activeTab,
  onSelectTab,
  hasActiveAlert = false,
}: ArchitectureDiagramProps) {
  const soc = vehicle.battery_soc ?? vehicle.soc ?? 0;
  const voltage = vehicle.battery_voltage ?? vehicle.voltage ?? 48.0;
  const packTemp = vehicle.battery_temperature ?? vehicle.pack_temp ?? 30.0;
  const motorTemp = vehicle.motor_temperature ?? vehicle.motor_temp ?? 35.0;
  const speed = vehicle.speed ?? 0;
  const isOnline = vehicle.online ?? vehicle.is_online ?? true;
  const deviceId = vehicle.device_id || `ESP32-${vehicle.id}`;

  const isBatteryOverheat = packTemp > 45;
  const isMotorOverheat = motorTemp > 75;

  return (
    <div className="bg-surface/90 border border-border/80 rounded-xl p-5 backdrop-blur-md flex flex-col gap-4 shadow-xl">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-3">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted flex items-center gap-1.5">
            <Activity className="w-3.5 h-3.5 text-accent-blue" /> Virtual EV IoT Architecture
          </h3>
          <p className="text-[11px] text-text-muted mt-0.5">
            Interactive system topology — click any component block to inspect live sensor telemetry
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono text-text-muted">Edge-to-Cloud Pipeline</span>
        </div>
      </div>

      {/* Interactive Topology Graph */}
      <div className="relative py-2 flex flex-col items-center gap-5">
        {/* Tier 1: Vehicle Master Node */}
        <div className="flex flex-col items-center">
          <div className="px-5 py-2.5 rounded-xl bg-surface-2 border border-accent-blue/40 shadow-[0_0_15px_rgba(59,130,246,0.15)] flex items-center gap-3">
            <div className="w-7 h-7 rounded-lg bg-accent-blue/20 flex items-center justify-center text-accent-blue">
              <Car className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-mono font-bold text-sm text-text-primary">
                  {vehicle.id}
                </span>
                <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-surface border border-border text-accent-blue">
                  {vehicle.vehicle_type || 'delivery_ev'}
                </span>
              </div>
              <span className="text-[10px] text-text-muted">
                Physical Edge Simulation Platform
              </span>
            </div>
          </div>
          {/* Vertical Bus Trunk */}
          <div className="w-0.5 h-5 bg-gradient-to-b from-accent-blue/40 to-border" />
        </div>

        {/* Tier 2: Subsystems & Physical Sensors (Battery, Motor, GPS) */}
        <div className="w-full relative">
          {/* Horizontal Interconnect Bus */}
          <div className="absolute top-0 left-[12%] right-[12%] h-0.5 bg-border/80 -translate-y-px" />

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-3">
            {/* Battery Subsystem Node */}
            <button
              type="button"
              onClick={() => onSelectTab('battery')}
              className={`p-3 rounded-xl border text-left transition-all duration-200 flex flex-col gap-2 relative group ${
                activeTab === 'battery'
                  ? 'bg-accent-blue/15 border-accent-blue shadow-[0_0_15px_rgba(59,130,246,0.25)] ring-1 ring-accent-blue/50'
                  : isBatteryOverheat
                  ? 'bg-accent-red/10 border-accent-red/60 animate-pulse'
                  : 'bg-surface-2/70 border-border/70 hover:border-accent-blue/40 hover:bg-surface-2'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-md bg-accent-green/15 text-accent-green flex items-center justify-center">
                    <Battery className="w-3.5 h-3.5" />
                  </div>
                  <span className="text-xs font-semibold text-text-primary">Battery System</span>
                </div>
                {isBatteryOverheat ? (
                  <span className="text-[10px] font-mono text-accent-red font-bold flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" /> FAULT
                  </span>
                ) : (
                  <span className="text-[10px] font-mono text-accent-green">● ACTIVE</span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-1 text-[11px] font-mono text-text-muted bg-surface/50 p-1.5 rounded-lg border border-border/40">
                <div>SoC: <span className="text-text-primary font-bold">{soc.toFixed(1)}%</span></div>
                <div>Temp: <span className={isBatteryOverheat ? 'text-accent-red font-bold' : 'text-text-primary'}>{packTemp.toFixed(1)}°C</span></div>
                <div>Volt: <span className="text-text-primary">{voltage.toFixed(1)}V</span></div>
                <div>Cap: <span className="text-text-primary">{vehicle.battery_capacity_kwh || 4.8}kWh</span></div>
              </div>
              <span className="text-[10px] text-text-muted flex items-center gap-1">
                <Zap className="w-3 h-3 text-accent-yellow" /> 4 Virtual Sensors (SoC, V, A, T)
              </span>
            </button>

            {/* Motor Subsystem Node */}
            <button
              type="button"
              onClick={() => onSelectTab('motor')}
              className={`p-3 rounded-xl border text-left transition-all duration-200 flex flex-col gap-2 relative group ${
                activeTab === 'motor'
                  ? 'bg-accent-blue/15 border-accent-blue shadow-[0_0_15px_rgba(59,130,246,0.25)] ring-1 ring-accent-blue/50'
                  : isMotorOverheat
                  ? 'bg-accent-red/10 border-accent-red/60 animate-pulse'
                  : 'bg-surface-2/70 border-border/70 hover:border-accent-blue/40 hover:bg-surface-2'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-md bg-accent-blue/15 text-accent-blue flex items-center justify-center">
                    <Zap className="w-3.5 h-3.5" />
                  </div>
                  <span className="text-xs font-semibold text-text-primary">Traction Motor</span>
                </div>
                {isMotorOverheat ? (
                  <span className="text-[10px] font-mono text-accent-red font-bold flex items-center gap-1">
                    <AlertOctagon className="w-3 h-3" /> FAULT
                  </span>
                ) : (
                  <span className="text-[10px] font-mono text-accent-green">● ACTIVE</span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-1 text-[11px] font-mono text-text-muted bg-surface/50 p-1.5 rounded-lg border border-border/40">
                <div>Temp: <span className={isMotorOverheat ? 'text-accent-red font-bold' : 'text-text-primary'}>{motorTemp.toFixed(1)}°C</span></div>
                <div>Speed: <span className="text-text-primary font-bold">{speed.toFixed(0)} km/h</span></div>
              </div>
              <span className="text-[10px] text-text-muted flex items-center gap-1">
                <Activity className="w-3 h-3 text-accent-blue" /> Motor Temperature Sensor
              </span>
            </button>

            {/* GPS Subsystem Node */}
            <button
              type="button"
              onClick={() => onSelectTab('gps')}
              className={`p-3 rounded-xl border text-left transition-all duration-200 flex flex-col gap-2 relative group ${
                activeTab === 'gps'
                  ? 'bg-accent-blue/15 border-accent-blue shadow-[0_0_15px_rgba(59,130,246,0.25)] ring-1 ring-accent-blue/50'
                  : 'bg-surface-2/70 border-border/70 hover:border-accent-blue/40 hover:bg-surface-2'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-md bg-accent-yellow/15 text-accent-yellow flex items-center justify-center">
                    <Navigation className="w-3.5 h-3.5" />
                  </div>
                  <span className="text-xs font-semibold text-text-primary">GPS Navigation</span>
                </div>
                <span className="text-[10px] font-mono text-accent-green">● ACTIVE</span>
              </div>
              <div className="grid grid-cols-2 gap-1 text-[11px] font-mono text-text-muted bg-surface/50 p-1.5 rounded-lg border border-border/40">
                <div>Heading: <span className="text-text-primary font-bold">{Math.round(vehicle.heading || 0)}°</span></div>
                <div>Speed: <span className="text-text-primary font-bold">{speed.toFixed(0)} km/h</span></div>
              </div>
              <span className="text-[10px] text-text-muted flex items-center gap-1">
                <Navigation className="w-3 h-3 text-accent-yellow" /> GPS & Heading Sensor
              </span>
            </button>
          </div>
        </div>

        {/* Bus Convergence Lines to Virtual ESP32 */}
        <div className="w-full flex justify-center items-center">
          <div className="w-0.5 h-5 bg-border/80" />
        </div>

        {/* Tier 3: Virtual ESP32 Edge Node */}
        <button
          type="button"
          onClick={() => onSelectTab('esp32')}
          className={`w-full max-w-md p-3.5 rounded-xl border transition-all duration-200 flex items-center justify-between gap-4 text-left ${
            activeTab === 'esp32'
              ? 'bg-accent-blue/20 border-accent-blue shadow-[0_0_20px_rgba(59,130,246,0.25)] ring-1 ring-accent-blue/50'
              : 'bg-surface-2/80 border-border/80 hover:border-accent-blue/50 hover:bg-surface-2'
          }`}
        >
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-accent-blue/20 border border-accent-blue/40 flex items-center justify-center text-accent-blue">
              <Cpu className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-mono font-bold text-sm text-text-primary">
                  {deviceId}
                </span>
                <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-accent-green/15 text-accent-green border border-accent-green/30">
                  VIRTUAL ESP32
                </span>
              </div>
              <span className="text-[11px] text-text-muted">
                Polls 7 virtual sensors • Serializes canonical JSON payload
              </span>
            </div>
          </div>

          <div className="text-right font-mono text-[11px]">
            <div className="text-accent-green flex items-center gap-1 justify-end">
              <Radio className="w-3 h-3 animate-ping" /> STREAMING
            </div>
            <div className="text-text-muted text-[10px]">
              QoS 1 • TCP/IP
            </div>
          </div>
        </button>

        {/* Vertical MQTT Downlink */}
        <div className="flex flex-col items-center">
          <div className="w-0.5 h-4 bg-gradient-to-b from-accent-blue/50 to-border" />
          <span className="text-[10px] font-mono uppercase tracking-wider text-accent-blue px-2 py-0.5 rounded bg-surface border border-accent-blue/30">
            MQTT v3.1.1
          </span>
          <div className="w-0.5 h-4 bg-gradient-to-b from-border to-accent-blue/50" />
        </div>

        {/* Tier 4: MQTT Broker & Backend Telemetry Pipeline */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 w-full max-w-2xl">
          {/* MQTT Broker Block */}
          <button
            type="button"
            onClick={() => onSelectTab('mqtt')}
            className={`p-3 rounded-xl border text-left transition-all duration-200 flex items-center gap-3 ${
              activeTab === 'mqtt'
                ? 'bg-accent-blue/15 border-accent-blue shadow-[0_0_15px_rgba(59,130,246,0.25)] ring-1 ring-accent-blue/50'
                : 'bg-surface-2/60 border-border/70 hover:border-accent-blue/40 hover:bg-surface-2'
            }`}
          >
            <div className="w-8 h-8 rounded-lg bg-surface flex items-center justify-center text-accent-blue border border-border">
              <Radio className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-text-primary">Mosquitto Broker</span>
                <span className="text-[9px] font-mono px-1 py-0.2 rounded bg-surface border text-text-muted">
                  :1883
                </span>
              </div>
              <span className="text-[10px] font-mono text-text-muted truncate block max-w-[200px]">
                fleet/{vehicle.fleet_id || 'fleet_001'}/ev/{vehicle.id}/telemetry
              </span>
            </div>
          </button>

          {/* Backend Ingestion & Anomaly Detection */}
          <button
            type="button"
            onClick={() => onSelectTab('telemetry')}
            className={`p-3 rounded-xl border text-left transition-all duration-200 flex items-center gap-3 ${
              activeTab === 'telemetry'
                ? 'bg-accent-blue/15 border-accent-blue shadow-[0_0_15px_rgba(59,130,246,0.25)] ring-1 ring-accent-blue/50'
                : 'bg-surface-2/60 border-border/70 hover:border-accent-blue/40 hover:bg-surface-2'
            }`}
          >
            <div className="w-8 h-8 rounded-lg bg-surface flex items-center justify-center text-accent-green border border-border">
              <Server className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-text-primary">FastAPI Backend</span>
                <span className="text-[9px] font-mono px-1 py-0.2 rounded bg-accent-green/15 text-accent-green border border-accent-green/30">
                  ANOMALY ENGINE
                </span>
              </div>
              <span className="text-[10px] text-text-muted">
                Validation • Time-Series SQLite • WebSocket
              </span>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}
