import React, { useState } from 'react';
import { X, RotateCcw, Play, Pause, Square, FastForward } from 'lucide-react';
import { SimulationState } from '@/types/fleet';

interface ConfigPanelProps {
  isOpen: boolean;
  onClose: () => void;
  vehicleIds: string[];
  simulationState?: SimulationState;
  onControlSimulation?: (action: 'start' | 'pause' | 'resume' | 'stop') => Promise<void>;
}

const API_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';

export default function ConfigPanel({
  isOpen,
  onClose,
  vehicleIds,
  simulationState = 'RUNNING',
  onControlSimulation,
}: ConfigPanelProps) {
  const [fleetSize, setFleetSize]             = useState(10);
  const [publishInterval, setPublishInterval] = useState(3);
  const [vehicleType, setVehicleType]         = useState('delivery_ev');
  const [batteryCapacity, setBatteryCapacity] = useState(4.8);
  const [selectedVehicle, setSelectedVehicle] = useState('all');
  const [scenario, setScenario]               = useState('normal');
  const [submitting, setSubmitting]           = useState(false);
  const [actionLoading, setActionLoading]     = useState<string | null>(null);
  const [toast, setToast]                     = useState<{ msg: string; ok: boolean } | null>(null);

  if (!isOpen) return null;

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3500);
  };

  const handleSimAction = async (action: 'start' | 'pause' | 'resume' | 'stop') => {
    setActionLoading(action);
    try {
      if (onControlSimulation) {
        await onControlSimulation(action);
      } else {
        const res = await fetch(`${API_URL}/api/simulation/${action}`, { method: 'POST' });
        if (!res.ok) throw new Error(await res.text());
      }
      showToast(`Simulation ${action.toUpperCase()} executed successfully.`);
    } catch (e: any) {
      showToast(`Action failed: ${e.message || 'unknown error'}`, false);
    } finally {
      setActionLoading(null);
    }
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const res = await fetch(`${API_URL}/api/simulation/configure`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fleet_size: fleetSize,
          interval: publishInterval,
          vehicle_id: selectedVehicle,
          vehicle_type: vehicleType,
          battery_capacity_kwh: batteryCapacity,
          scenario,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      showToast('Configuration applied successfully.');
    } catch (e: any) {
      showToast(`Failed: ${e.message ?? 'unknown error'}`, false);
    } finally {
      setSubmitting(false);
    }
  };

  const handleReset = async () => {
    setSubmitting(true);
    try {
      const res = await fetch(`${API_URL}/api/simulation/configure`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vehicle_id: 'all', scenario: 'normal' }),
      });
      if (!res.ok) throw new Error(await res.text());
      showToast('All vehicles reset to Normal Operation.');
    } catch (e: any) {
      showToast(`Reset failed: ${e.message ?? 'unknown error'}`, false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[9999] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-surface border border-border rounded-xl w-full max-w-lg shadow-2xl flex flex-col max-h-[92vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border sticky top-0 bg-surface z-10">
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold">Fleet Configuration & Control</h2>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-surface-2 rounded-full text-text-muted transition-colors">
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* Simulation Lifecycle Control Buttons */}
          <div className="bg-surface-2 p-3.5 rounded-xl border border-border space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">Simulation Engine Control</span>
              <span className="text-xs px-2 py-0.5 rounded bg-surface border border-border font-bold text-accent-blue">
                {simulationState}
              </span>
            </div>
            <div className="grid grid-cols-4 gap-2">
              <button
                type="button"
                onClick={() => handleSimAction('start')}
                disabled={actionLoading !== null}
                className="flex items-center justify-center gap-1.5 py-1.5 px-2 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 border border-emerald-500/30 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50"
              >
                <Play className="w-3.5 h-3.5" /> Start
              </button>
              <button
                type="button"
                onClick={() => handleSimAction('pause')}
                disabled={actionLoading !== null}
                className="flex items-center justify-center gap-1.5 py-1.5 px-2 bg-amber-600/20 hover:bg-amber-600/30 text-amber-400 border border-amber-500/30 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50"
              >
                <Pause className="w-3.5 h-3.5" /> Pause
              </button>
              <button
                type="button"
                onClick={() => handleSimAction('resume')}
                disabled={actionLoading !== null}
                className="flex items-center justify-center gap-1.5 py-1.5 px-2 bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 border border-blue-500/30 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50"
              >
                <FastForward className="w-3.5 h-3.5" /> Resume
              </button>
              <button
                type="button"
                onClick={() => handleSimAction('stop')}
                disabled={actionLoading !== null}
                className="flex items-center justify-center gap-1.5 py-1.5 px-2 bg-rose-600/20 hover:bg-rose-600/30 text-rose-400 border border-rose-500/30 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50"
              >
                <Square className="w-3.5 h-3.5" /> Stop
              </button>
            </div>
          </div>

          {/* Fleet Size */}
          <div className="space-y-1.5">
            <div className="flex justify-between items-center">
              <label className="text-sm font-medium">Fleet Size (Virtual Vehicles)</label>
              <span className="text-accent-blue font-bold text-lg">{fleetSize}</span>
            </div>
            <input
              type="range"
              min="1" max="100" step="1"
              value={fleetSize}
              onChange={e => setFleetSize(parseInt(e.target.value))}
              className="w-full accent-blue-500 cursor-pointer"
            />
            <div className="flex justify-between text-xs text-text-muted">
              <span>1</span><span>25</span><span>50</span><span>100</span>
            </div>
          </div>

          {/* Publish Interval */}
          <div className="space-y-1.5">
            <div className="flex justify-between items-center">
              <label className="text-sm font-medium">Telemetry Publish Interval</label>
              <span className="text-accent-blue font-bold text-lg">{publishInterval}s</span>
            </div>
            <input
              type="range"
              min="1" max="30" step="1"
              value={publishInterval}
              onChange={e => setPublishInterval(parseInt(e.target.value))}
              className="w-full accent-blue-500 cursor-pointer"
            />
            <div className="flex justify-between text-xs text-text-muted">
              <span>1s (High Freq)</span><span>15s</span><span>30s (Low Freq)</span>
            </div>
          </div>

          {/* Vehicle Type & Battery Specs */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-text-muted">Vehicle Model / Class</label>
              <select
                value={vehicleType}
                onChange={e => setVehicleType(e.target.value)}
                className="w-full bg-surface-2 border border-border rounded-md px-3 py-1.5 text-sm focus:outline-none focus:border-accent-blue"
              >
                <option value="delivery_ev">Delivery EV (Urban)</option>
                <option value="cargo_van">Commercial Cargo Van</option>
                <option value="electric_sedan">Fleet Sedan</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-text-muted">Battery Pack Capacity</label>
              <select
                value={batteryCapacity}
                onChange={e => setBatteryCapacity(parseFloat(e.target.value))}
                className="w-full bg-surface-2 border border-border rounded-md px-3 py-1.5 text-sm focus:outline-none focus:border-accent-blue"
              >
                <option value={4.8}>4.8 kWh (48V 100Ah)</option>
                <option value={15.0}>15.0 kWh (Extended)</option>
                <option value={40.0}>40.0 kWh (Heavy Duty)</option>
              </select>
            </div>
          </div>

          {/* Divider */}
          <div className="border-t border-border pt-4 space-y-3">
            <h3 className="font-semibold text-base">Scenario & Fault Injection</h3>

            <div className="space-y-1">
              <label className="text-xs text-text-muted">Target Vehicle(s)</label>
              <select
                value={selectedVehicle}
                onChange={e => setSelectedVehicle(e.target.value)}
                className="w-full bg-surface-2 border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:border-accent-blue"
              >
                <option value="all">All Vehicles (Fleet-wide)</option>
                {vehicleIds.map(id => (
                  <option key={id} value={id}>{id}</option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-xs text-text-muted">Scenario Selection</label>
              <select
                value={scenario}
                onChange={e => setScenario(e.target.value)}
                className="w-full bg-surface-2 border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:border-accent-blue"
              >
                <optgroup label="Operating & Thermal Scenarios">
                  <option value="normal">Normal Operation (Nominal Physics)</option>
                  <option value="battery_overheat">Battery Overheat (Thermal Runaway)</option>
                  <option value="motor_overheat">Motor Overheat (Overload)</option>
                  <option value="low_battery">Rapid Battery Drain (Degradation)</option>
                  <option value="energy_spike">Energy Spike (Inverter / Aux Short)</option>
                </optgroup>
                <optgroup label="IoT Sensor & Communication Faults">
                  <option value="sensor_offline">Sensor Offline (Comms Dropout)</option>
                  <option value="sensor_invalid">Sensor Invalid Data (Out of Bounds)</option>
                  <option value="sensor_corrupted">Sensor Corrupted Data (Type Error)</option>
                  <option value="sensor_delayed">Sensor Delayed Telemetry (Stale Lag)</option>
                </optgroup>
              </select>
            </div>

            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting}
              className="w-full bg-accent-blue hover:bg-blue-600 text-white px-4 py-2.5 rounded-lg font-medium transition-colors disabled:opacity-50 mt-2 shadow-lg"
            >
              {submitting ? 'Applying Configuration…' : 'Apply Configuration'}
            </button>

            <button
              type="button"
              onClick={handleReset}
              disabled={submitting}
              className="w-full flex items-center justify-center gap-2 border border-border hover:bg-surface-2 text-text-muted hover:text-text-primary px-4 py-2 rounded-lg font-medium transition-colors disabled:opacity-50 text-sm"
            >
              <RotateCcw className="w-4 h-4" /> Reset All Vehicles to Normal
            </button>

            {toast && (
              <p className={`text-sm text-center mt-2 font-medium ${toast.ok ? 'text-accent-green' : 'text-accent-red'}`}>
                {toast.msg}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
