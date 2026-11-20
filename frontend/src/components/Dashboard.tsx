'use client';

import React, { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { useFleetData } from '@/hooks/useFleetData';
import FleetSimulatorControls from './FleetSimulatorControls';
import EVGrid from './EVGrid';
import EVEnvironment from './EVEnvironment';
import AlertCenter from './AlertCenter';
import ConfigPanel from './ConfigPanel';
import { Vehicle, TelemetryPoint } from '@/types/fleet';
import {
  Car,
  Settings,
  Activity,
  Radio,
  MapPin,
  AlertTriangle,
  Layers,
  ChevronRight,
  ShieldCheck,
} from 'lucide-react';

// Dynamic import for Leaflet map (SSR safe)
const FleetMap = dynamic(() => import('./FleetMap'), { ssr: false });

export default function Dashboard() {
  const {
    vehicles,
    fleetSummary,
    simulationState,
    alerts,
    isConnected,
    fetchVehicleHistory,
    acknowledgeAlert,
    resolveAlert,
    controlSimulation,
    scaleFleet,
    changeInterval,
    injectScenario,
  } = useFleetData();

  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
  const [vehicleHistory, setVehicleHistory] = useState<TelemetryPoint[]>([]);
  const [activeTab, setActiveTab] = useState<'fleet' | 'map' | 'alerts'>('fleet');
  const [isConfigOpen, setIsConfigOpen] = useState(false);
  const [publishInterval, setPublishInterval] = useState(3);

  // Active selected vehicle derived from live vehicles list
  const selectedVehicle = vehicles.find((v) => v.id === selectedVehicleId) || null;

  // Sync initial history when selected vehicle changes
  useEffect(() => {
    if (selectedVehicleId) {
      fetchVehicleHistory(selectedVehicleId).then((pts) => {
        // Ensure chronological order (oldest -> newest) for Recharts
        const sorted = [...pts].sort((a, b) => {
          const tA = new Date(a.timestamp || 0).getTime();
          const tB = new Date(b.timestamp || 0).getTime();
          return tA - tB;
        });
        setVehicleHistory(sorted);
      });
    }
  }, [selectedVehicleId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Stream new live telemetry readings directly into time-series history
  useEffect(() => {
    if (!selectedVehicle) return;
    setVehicleHistory((prev) => {
      const nowStr = new Date().toISOString();
      const lastPoint = prev[prev.length - 1];
      if (lastPoint && lastPoint.timestamp && typeof lastPoint.timestamp === 'string') {
        const lastTime = new Date(lastPoint.timestamp).getTime();
        if (Date.now() - lastTime < 500) {
          return prev;
        }
      }
      const newPoint: TelemetryPoint = {
        timestamp: nowStr,
        soc: selectedVehicle.battery_soc ?? selectedVehicle.soc ?? 0,
        voltage: selectedVehicle.battery_voltage ?? selectedVehicle.voltage ?? 48.0,
        pack_temp: selectedVehicle.battery_temperature ?? selectedVehicle.pack_temp ?? 30.0,
        motor_temp: selectedVehicle.motor_temperature ?? selectedVehicle.motor_temp ?? 35.0,
        speed: selectedVehicle.speed ?? 0,
        current: selectedVehicle.battery_current ?? selectedVehicle.current ?? 0,
        lat: selectedVehicle.latitude ?? selectedVehicle.lat ?? 28.6139,
        lon: selectedVehicle.longitude ?? selectedVehicle.lon ?? 77.2090,
      };
      return [...prev.slice(-59), newPoint];
    });
  }, [
    selectedVehicle?.pack_temp,
    selectedVehicle?.motor_temp,
    selectedVehicle?.soc,
    selectedVehicle?.voltage,
    selectedVehicle?.speed,
    selectedVehicle?.scenario,
  ]);

  const handleSelectVehicle = (v: Vehicle) => {
    setSelectedVehicleId(v.id);
  };

  const handleSelectVehicleById = (id: string) => {
    setSelectedVehicleId(id);
    setActiveTab('fleet');
  };

  const handleScaleFleet = async (newSize: number) => {
    const clamped = Math.min(20, Math.max(1, newSize));
    await scaleFleet(clamped);
  };

  const handleChangeInterval = async (interval: number) => {
    setPublishInterval(interval);
    await changeInterval(interval);
  };

  // Critical alerts count for quick indicator
  const activeAlerts = alerts.filter((a) => a.is_active);
  const criticalAlertsCount = activeAlerts.filter((a) => a.alert_type === 'CRITICAL').length;
  const warningAlertsCount = activeAlerts.filter((a) => a.alert_type === 'WARNING').length;

  return (
    <div className="min-h-screen bg-background text-text-primary flex flex-col">
      {/* ── Main Laboratory Header ────────────────────────────────────────── */}
      <header className="border-b border-border/80 bg-surface/90 backdrop-blur-md sticky top-0 z-30 px-4 sm:px-6 py-3.5 shadow-md">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-accent-blue to-accent-green flex items-center justify-center text-white shadow-lg shadow-accent-blue/20">
              <Car className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-text-primary via-gray-200 to-accent-blue font-mono">
                  EV SENSE
                </h1>
                <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded-full bg-accent-blue/15 text-accent-blue border border-accent-blue/30 font-semibold">
                  IoT Lab
                </span>
              </div>
              <p className="text-xs text-text-muted">
                Virtual EV IoT Simulation Laboratory • Simulate • Observe • Inject Faults • Monitor Telemetry
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5 self-end sm:self-center">
            {/* System Online / WS status indicator */}
            <div className="flex items-center gap-2 bg-surface-2 px-3 py-1.5 rounded-full border border-border text-xs font-mono">
              <span
                className={`w-2 h-2 rounded-full ${
                  isConnected ? 'bg-accent-green animate-pulse' : 'bg-accent-red'
                }`}
              />
              <span className="text-text-muted">
                {isConnected ? 'SYSTEM ONLINE' : 'DISCONNECTED'}
              </span>
            </div>

            {/* Advanced Settings */}
            <button
              type="button"
              onClick={() => setIsConfigOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-surface-2 border border-border hover:bg-surface-2/80 text-text-muted hover:text-text-primary text-xs font-medium transition-colors"
              title="Advanced Simulation Parameters"
            >
              <Settings className="w-4 h-4 text-text-muted" />
              <span className="hidden sm:inline">Config</span>
            </button>
          </div>
        </div>
      </header>

      {/* ── Active Critical Anomaly Alert Bar (if active) ────────────────── */}
      {criticalAlertsCount > 0 && !selectedVehicle && (
        <div className="bg-accent-red/15 border-b border-accent-red/40 px-4 py-2.5 text-xs text-accent-red backdrop-blur-sm animate-pulse">
          <div className="max-w-7xl mx-auto flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-accent-red" />
              <span className="font-bold uppercase tracking-wider font-mono">
                Critical Anomaly Detected:
              </span>
              <span>
                {criticalAlertsCount} critical fault{criticalAlertsCount > 1 ? 's' : ''} active across the fleet.
              </span>
            </div>
            <button
              type="button"
              onClick={() => setActiveTab('alerts')}
              className="font-mono underline font-bold hover:text-white transition-colors"
            >
              Inspect in Alert Center →
            </button>
          </div>
        </div>
      )}

      {/* ── Main Workspace Body ─────────────────────────────────────────── */}
      <main className="flex-1 max-w-7xl mx-auto w-full p-4 sm:p-6 flex flex-col gap-6">
        {/* If an EV is currently selected, display its complete Virtual EV Environment */}
        {selectedVehicle ? (
          <EVEnvironment
            vehicle={selectedVehicle}
            history={vehicleHistory}
            alerts={alerts}
            onBack={() => setSelectedVehicleId(null)}
            onScenarioInject={injectScenario}
            onAcknowledgeAlert={acknowledgeAlert}
            onResolveAlert={resolveAlert}
          />
        ) : (
          <>
            {/* Primary Simulation Workspace Control Bar */}
            <FleetSimulatorControls
              fleetSize={vehicles.length || fleetSummary.total || 10}
              simulationState={simulationState}
              publishInterval={publishInterval}
              onScale={handleScaleFleet}
              onControlSimulation={controlSimulation}
              onChangeInterval={handleChangeInterval}
              onOpenConfig={() => setIsConfigOpen(true)}
            />

            {/* Navigation Tabs (Fleet Grid vs GPS Map vs Alert Center) */}
            <div className="flex items-center justify-between border-b border-border/80 pb-2">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setActiveTab('fleet')}
                  className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all ${
                    activeTab === 'fleet'
                      ? 'bg-accent-blue text-white shadow-md shadow-accent-blue/20'
                      : 'bg-surface-2 text-text-muted hover:text-text-primary border border-border/60'
                  }`}
                >
                  <Layers className="w-4 h-4" />
                  <span>Virtual EV Fleet ({vehicles.length})</span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab('map')}
                  className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all ${
                    activeTab === 'map'
                      ? 'bg-accent-blue text-white shadow-md shadow-accent-blue/20'
                      : 'bg-surface-2 text-text-muted hover:text-text-primary border border-border/60'
                  }`}
                >
                  <MapPin className="w-4 h-4" />
                  <span>Fleet Spatial Map</span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab('alerts')}
                  className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all relative ${
                    activeTab === 'alerts'
                      ? 'bg-accent-blue text-white shadow-md shadow-accent-blue/20'
                      : 'bg-surface-2 text-text-muted hover:text-text-primary border border-border/60'
                  }`}
                >
                  <AlertTriangle className="w-4 h-4" />
                  <span>Alert Center</span>
                  {activeAlerts.length > 0 && (
                    <span
                      className={`ml-1 px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
                        criticalAlertsCount > 0 ? 'bg-accent-red text-white' : 'bg-accent-yellow text-gray-900'
                      }`}
                    >
                      {activeAlerts.length}
                    </span>
                  )}
                </button>
              </div>

              {/* Quick Fleet Health Badge */}
              <div className="hidden md:flex items-center gap-3 text-xs font-mono text-text-muted">
                <span>Online: <strong className="text-accent-green">{vehicles.filter(v => v.online ?? v.is_online).length}</strong></span>
                <span>Driving: <strong className="text-text-primary">{vehicles.filter(v => v.status === 'DRIVING').length}</strong></span>
                <span>Charging: <strong className="text-accent-blue">{vehicles.filter(v => v.charging).length}</strong></span>
              </div>
            </div>

            {/* Active View Container */}
            {activeTab === 'fleet' && (
              <EVGrid
                vehicles={vehicles}
                alerts={alerts}
                onSelectVehicle={handleSelectVehicle}
              />
            )}

            {activeTab === 'map' && (
              <div className="bg-surface/90 border border-border/80 rounded-xl p-4 backdrop-blur-sm shadow-xl flex flex-col gap-3 min-h-[540px]">
                <div className="flex items-center justify-between text-xs border-b border-border/60 pb-2">
                  <span className="font-semibold text-text-primary flex items-center gap-1.5">
                    <MapPin className="w-4 h-4 text-accent-blue" /> New Delhi Delivery Route Telemetry
                  </span>
                  <span className="font-mono text-text-muted text-[11px]">
                    Click any vehicle node on the map to inspect its IoT architecture
                  </span>
                </div>
                <div className="flex-1 rounded-xl overflow-hidden border border-border min-h-[480px]">
                  <FleetMap
                    vehicles={vehicles}
                    onVehicleClick={handleSelectVehicle}
                  />
                </div>
              </div>
            )}

            {activeTab === 'alerts' && (
              <AlertCenter
                alerts={alerts}
                onAcknowledge={acknowledgeAlert}
                onResolve={resolveAlert}
                onSelectVehicle={handleSelectVehicleById}
              />
            )}
          </>
        )}
      </main>

      {/* ── Advanced Configuration Modal ─────────────────────────────────── */}
      <ConfigPanel
        isOpen={isConfigOpen}
        onClose={() => setIsConfigOpen(false)}
        vehicleIds={vehicles.map((v) => v.id)}
        simulationState={simulationState}
        onControlSimulation={controlSimulation}
      />
    </div>
  );
}
