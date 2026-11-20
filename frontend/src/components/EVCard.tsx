'use client';

import React from 'react';
import { Vehicle } from '@/types/fleet';
import {
  Car,
  Cpu,
  Wifi,
  Radio,
  Thermometer,
  Zap,
  Gauge,
  ArrowUpRight,
  AlertTriangle,
  AlertOctagon,
  BatteryCharging,
} from 'lucide-react';

interface EVCardProps {
  vehicle: Vehicle;
  onSelect: (vehicle: Vehicle) => void;
  hasActiveAlert?: boolean;
  alertType?: 'WARNING' | 'CRITICAL';
}

export default function EVCard({
  vehicle,
  onSelect,
  hasActiveAlert = false,
  alertType,
}: EVCardProps) {
  const soc = vehicle.battery_soc ?? vehicle.soc ?? 0;
  const voltage = vehicle.battery_voltage ?? vehicle.voltage ?? 48.0;
  const packTemp = vehicle.battery_temperature ?? vehicle.pack_temp ?? 30.0;
  const motorTemp = vehicle.motor_temperature ?? vehicle.motor_temp ?? 35.0;
  const speed = vehicle.speed ?? 0;
  const energy = vehicle.energy_consumption_kwh_per_km ?? 0;
  const isOnline = vehicle.online ?? vehicle.is_online ?? true;
  const isCharging = vehicle.charging ?? false;
  const scenario = vehicle.scenario || 'normal';
  const deviceId = vehicle.device_id || `ESP32-${vehicle.id}`;

  // Color mapping for SoC
  const getSoCColor = (val: number) => {
    if (val < 15) return 'bg-accent-red text-accent-red';
    if (val < 50) return 'bg-accent-yellow text-accent-yellow';
    return 'bg-accent-green text-accent-green';
  };

  // Status computation
  const isCritical = alertType === 'CRITICAL' || packTemp > 55 || motorTemp > 85 || soc < 5;
  const isWarning = alertType === 'WARNING' || packTemp > 45 || motorTemp > 75 || soc < 15;

  let statusBadge = (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium bg-accent-green/10 text-accent-green border border-accent-green/30">
      <span className="w-1.5 h-1.5 rounded-full bg-accent-green animate-pulse" />
      ONLINE
    </span>
  );

  if (!isOnline) {
    statusBadge = (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium bg-gray-800 text-text-muted border border-border">
        <span className="w-1.5 h-1.5 rounded-full bg-gray-500" />
        OFFLINE
      </span>
    );
  } else if (isCritical) {
    statusBadge = (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium bg-accent-red/20 text-accent-red border border-accent-red/50 shadow-[0_0_8px_rgba(239,68,68,0.3)]">
        <span className="w-1.5 h-1.5 rounded-full bg-accent-red animate-ping" />
        CRITICAL
      </span>
    );
  } else if (isWarning) {
    statusBadge = (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium bg-accent-yellow/20 text-accent-yellow border border-accent-yellow/40">
        <span className="w-1.5 h-1.5 rounded-full bg-accent-yellow" />
        WARNING
      </span>
    );
  }

  // Border styling based on alert status
  const cardBorderClass = isCritical
    ? 'border-accent-red/60 shadow-[0_0_15px_rgba(239,68,68,0.2)]'
    : isWarning
    ? 'border-accent-yellow/50 shadow-[0_0_12px_rgba(245,158,11,0.15)]'
    : 'border-border/80 hover:border-accent-blue/50 hover:shadow-lg hover:shadow-accent-blue/5';

  return (
    <div
      onClick={() => onSelect(vehicle)}
      className={`group relative bg-surface/90 rounded-xl border p-4.5 transition-all duration-200 cursor-pointer flex flex-col justify-between gap-3.5 backdrop-blur-sm ${cardBorderClass}`}
    >
      {/* Header: ID + Status */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-surface-2 border border-border flex items-center justify-center text-text-primary group-hover:text-accent-blue transition-colors">
            <Car className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="font-mono font-bold text-sm text-text-primary tracking-wide">
                {vehicle.id}
              </span>
              {isCharging && (
                <BatteryCharging className="w-3.5 h-3.5 text-accent-blue animate-pulse" />
              )}
            </div>
            <span className="text-[10px] font-mono text-text-muted">
              {vehicle.vehicle_type || 'delivery_ev'}
            </span>
          </div>
        </div>

        {statusBadge}
      </div>

      {/* Battery State of Charge Meter */}
      <div className="bg-surface-2/60 border border-border/60 rounded-lg p-2.5 flex flex-col gap-1.5">
        <div className="flex items-center justify-between text-xs">
          <span className="text-text-muted flex items-center gap-1 text-[11px]">
            <Zap className="w-3 h-3 text-accent-blue" /> Battery SoC
          </span>
          <span className={`font-mono font-bold ${getSoCColor(soc).split(' ')[1]}`}>
            {soc.toFixed(1)}%
          </span>
        </div>
        <div className="w-full bg-surface-2 h-2 rounded-full overflow-hidden border border-border/40">
          <div
            className={`h-full transition-all duration-300 ${getSoCColor(soc).split(' ')[0]}`}
            style={{ width: `${Math.min(100, Math.max(0, soc))}%` }}
          />
        </div>
      </div>

      {/* Core Telemetry Metrics Grid */}
      <div className="grid grid-cols-2 gap-2 text-xs">
        {/* Voltage */}
        <div className="bg-surface-2/40 border border-border/40 rounded-lg p-2 flex flex-col">
          <span className="text-[10px] text-text-muted flex items-center gap-1">
            <Zap className="w-2.5 h-2.5 text-accent-yellow" /> Voltage
          </span>
          <span className="font-mono font-semibold text-text-primary mt-0.5">
            {voltage.toFixed(1)} V
          </span>
        </div>

        {/* Speed */}
        <div className="bg-surface-2/40 border border-border/40 rounded-lg p-2 flex flex-col">
          <span className="text-[10px] text-text-muted flex items-center gap-1">
            <Gauge className="w-2.5 h-2.5 text-accent-green" /> Speed
          </span>
          <span className="font-mono font-semibold text-text-primary mt-0.5">
            {speed.toFixed(0)} km/h
          </span>
        </div>

        {/* Battery Temperature */}
        <div
          className={`border rounded-lg p-2 flex flex-col ${
            packTemp > 55
              ? 'bg-accent-red/10 border-accent-red/40 text-accent-red'
              : packTemp > 45
              ? 'bg-accent-yellow/10 border-accent-yellow/30 text-accent-yellow'
              : 'bg-surface-2/40 border-border/40 text-text-primary'
          }`}
        >
          <span className="text-[10px] text-text-muted flex items-center gap-1">
            <Thermometer className="w-2.5 h-2.5" /> Pack Temp
          </span>
          <span className="font-mono font-semibold mt-0.5">
            {packTemp.toFixed(1)}°C
          </span>
        </div>

        {/* Motor Temperature */}
        <div
          className={`border rounded-lg p-2 flex flex-col ${
            motorTemp > 85
              ? 'bg-accent-red/10 border-accent-red/40 text-accent-red'
              : motorTemp > 75
              ? 'bg-accent-yellow/10 border-accent-yellow/30 text-accent-yellow'
              : 'bg-surface-2/40 border-border/40 text-text-primary'
          }`}
        >
          <span className="text-[10px] text-text-muted flex items-center gap-1">
            <Thermometer className="w-2.5 h-2.5" /> Motor Temp
          </span>
          <span className="font-mono font-semibold mt-0.5">
            {motorTemp.toFixed(1)}°C
          </span>
        </div>
      </div>

      {/* IoT Edge Node Identity & Scenario */}
      <div className="pt-2 border-t border-border/60 flex items-center justify-between text-[11px]">
        <div className="flex items-center gap-1.5 text-text-muted">
          <Cpu className="w-3.5 h-3.5 text-accent-blue" />
          <span className="font-mono font-medium text-text-primary">
            {deviceId}
          </span>
        </div>

        <div className="flex items-center gap-1 text-[10px] font-mono text-accent-green">
          <Radio className="w-3 h-3 animate-pulse" />
          <span>MQTT LIVE</span>
        </div>
      </div>

      {/* Scenario & Open Action */}
      <div className="flex items-center justify-between gap-2 pt-1">
        <span
          className={`text-[10px] font-mono uppercase px-2 py-0.5 rounded border ${
            scenario === 'normal'
              ? 'bg-surface-2 text-text-muted border-border'
              : 'bg-accent-yellow/15 text-accent-yellow border-accent-yellow/30 font-semibold'
          }`}
        >
          {scenario.replace(/_/g, ' ')}
        </span>

        <button
          type="button"
          className="flex items-center gap-1 text-xs font-medium text-accent-blue group-hover:text-accent-blue/80 group-hover:translate-x-0.5 transition-all"
        >
          <span>OPEN EV</span>
          <ArrowUpRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
