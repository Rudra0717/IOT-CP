import React, { useState } from 'react';
import { Vehicle, TelemetryPoint, Alert } from '@/types/fleet';
import { X, MapPin, Compass, Zap, Gauge, Cpu } from 'lucide-react';
import { Badge } from './ui/Badge';
import { LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts';

interface VehicleDrawerProps {
  vehicle: Vehicle | null;
  history: TelemetryPoint[];
  alerts: Alert[];
  onClose: () => void;
  onScenarioInject: (vehicleId: string, scenario: string) => Promise<void>;
}

export default function VehicleDrawer({
  vehicle,
  history,
  alerts,
  onClose,
  onScenarioInject,
}: VehicleDrawerProps) {
  const [scenario, setScenario] = useState('normal');
  const [injecting, setInjecting] = useState(false);

  if (!vehicle) return null;

  const handleInject = async () => {
    setInjecting(true);
    await onScenarioInject(vehicle.id, scenario);
    setInjecting(false);
  };

  const formattedHistory = history.map((h, i) => {
    let timeStr = `-${history.length - i}s`;
    if (typeof h.timestamp === 'number') {
      timeStr = new Date(h.timestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } else if (typeof h.timestamp === 'string') {
      timeStr = new Date(h.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }
    return {
      ...h,
      time: timeStr,
      soc: h.soc,
      pack_temp: h.pack_temp,
      motor_temp: h.motor_temp,
      voltage: h.voltage,
      energy_consumption: h.energy_consumption || 0.0,
    };
  });

  return (
    <div className="fixed inset-y-0 right-0 w-full md:w-[540px] bg-surface border-l border-border shadow-2xl z-50 transform transition-transform duration-300 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border bg-surface sticky top-0 z-10">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold text-text-primary">{vehicle.id}</h2>
            <Badge variant={vehicle.status === 'FAULT' ? 'critical' : vehicle.status === 'DRIVING' ? 'success' : 'info'}>
              {vehicle.status}
            </Badge>
          </div>
          <p className="text-xs text-text-muted mt-0.5">
            Node: <span className="font-mono text-accent-blue">{vehicle.device_id || `ESP32-${vehicle.id}`}</span> &bull; Type: {vehicle.vehicle_type || 'delivery_ev'}
          </p>
        </div>
        <button onClick={onClose} className="p-1 hover:bg-surface-2 rounded-full text-text-muted transition-colors">
          <X className="w-6 h-6" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        {/* Core telemetry gauges */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-surface-2 p-3 rounded-xl flex flex-col items-center justify-center border border-border">
            <span className="text-xs text-text-muted mb-0.5">SoC</span>
            <span className="text-xl font-bold text-accent-green">{(vehicle.soc ?? 0).toFixed(1)}%</span>
            <span className="text-[10px] text-text-muted mt-0.5">{vehicle.charging ? 'Charging' : 'Discharging'}</span>
          </div>
          <div className="bg-surface-2 p-3 rounded-xl flex flex-col items-center justify-center border border-border">
            <span className="text-xs text-text-muted mb-0.5">Pack Temp</span>
            <span className="text-xl font-bold text-accent-yellow">{(vehicle.pack_temp ?? 0).toFixed(1)}°C</span>
            <span className="text-[10px] text-text-muted mt-0.5">Battery</span>
          </div>
          <div className="bg-surface-2 p-3 rounded-xl flex flex-col items-center justify-center border border-border">
            <span className="text-xs text-text-muted mb-0.5">Motor Temp</span>
            <span className="text-xl font-bold text-accent-red">{(vehicle.motor_temp ?? 0).toFixed(1)}°C</span>
            <span className="text-[10px] text-text-muted mt-0.5">Traction</span>
          </div>
          <div className="bg-surface-2 p-3 rounded-xl flex flex-col items-center justify-center border border-border">
            <span className="text-xs text-text-muted mb-0.5">Voltage</span>
            <span className="text-xl font-bold text-accent-blue">{(vehicle.voltage ?? 0).toFixed(1)}V</span>
            <span className="text-[10px] text-text-muted mt-0.5">{(vehicle.current ?? 0).toFixed(1)} A draw</span>
          </div>
        </div>

        {/* Secondary metrics row */}
        <div className="grid grid-cols-3 gap-3 bg-surface-2/60 p-3 rounded-xl border border-border text-xs">
          <div>
            <span className="text-text-muted block">Road Speed</span>
            <span className="text-sm font-semibold text-text-primary">{(vehicle.speed ?? 0).toFixed(1)} km/h</span>
          </div>
          <div>
            <span className="text-text-muted block">Energy Consumption</span>
            <span className="text-sm font-semibold text-text-primary">{(vehicle.energy_consumption_kwh_per_km ?? 0).toFixed(3)} kWh/km</span>
          </div>
          <div>
            <span className="text-text-muted block">Odometer</span>
            <span className="text-sm font-semibold text-text-primary">{(vehicle.odometer ?? 0).toFixed(1)} km</span>
          </div>
        </div>

        {/* Location & GPS Info */}
        <div className="flex items-center justify-between text-xs text-text-muted bg-surface-2 px-3 py-2 rounded-lg border border-border">
          <div className="flex items-center gap-1.5">
            <MapPin className="w-3.5 h-3.5 text-accent-red" />
            <span>GPS: {vehicle.lat?.toFixed(5)}, {vehicle.lon?.toFixed(5)}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Compass className="w-3.5 h-3.5 text-accent-blue" />
            <span>Heading: {vehicle.heading ?? 0.0}°</span>
          </div>
        </div>

        {/* Historical charts */}
        <div className="border border-border rounded-xl p-3 bg-surface-2">
          <h4 className="text-xs font-semibold text-text-muted mb-2 uppercase tracking-wider">
            Telemetry Time-Series Trends
          </h4>
          <div className="h-[240px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={formattedHistory}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="time" stroke="#9ca3af" fontSize={10} />
                <YAxis yAxisId="left" stroke="#9ca3af" fontSize={10} domain={['auto', 'auto']} />
                <YAxis yAxisId="right" orientation="right" stroke="#10b981" fontSize={10} domain={[0, 100]} />
                <Tooltip contentStyle={{ backgroundColor: '#1f2937', borderColor: '#374151', fontSize: '11px' }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line yAxisId="left" type="monotone" dataKey="pack_temp" stroke="#f59e0b" name="Pack Temp (°C)" dot={false} strokeWidth={2} />
                <Line yAxisId="left" type="monotone" dataKey="motor_temp" stroke="#ef4444" name="Motor Temp (°C)" dot={false} strokeWidth={2} />
                <Line yAxisId="right" type="monotone" dataKey="soc" stroke="#10b981" name="SoC (%)" dot={false} strokeWidth={2} />
                <Line yAxisId="left" type="monotone" dataKey="energy_consumption" stroke="#8b5cf6" name="Energy (kWh/km)" dot={false} strokeWidth={1.5} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Scenario Injection for this vehicle */}
        <div className="bg-surface-2 p-3.5 rounded-xl border border-border space-y-2">
          <h3 className="font-semibold text-sm">Inject Fault Scenario into {vehicle.id}</h3>
          <div className="flex gap-2">
            <select
              value={scenario}
              onChange={(e) => setScenario(e.target.value)}
              className="flex-1 bg-surface border border-border rounded-md px-3 py-1.5 text-xs focus:outline-none focus:border-accent-blue"
            >
              <optgroup label="Physical Scenarios">
                <option value="normal">Normal Operation</option>
                <option value="battery_overheat">Battery Overheat</option>
                <option value="motor_overheat">Motor Overheat</option>
                <option value="low_battery">Rapid Battery Drain</option>
                <option value="energy_spike">Energy Spike</option>
              </optgroup>
              <optgroup label="IoT Sensor Faults">
                <option value="sensor_offline">Sensor Offline</option>
                <option value="sensor_invalid">Sensor Invalid Data</option>
                <option value="sensor_corrupted">Sensor Corrupted Data</option>
                <option value="sensor_delayed">Sensor Delayed Data</option>
              </optgroup>
            </select>
            <button
              onClick={handleInject}
              disabled={injecting}
              className="bg-accent-blue hover:bg-blue-600 text-white px-3 py-1.5 rounded-md text-xs font-semibold transition-colors disabled:opacity-50"
            >
              {injecting ? 'Applying...' : 'Apply'}
            </button>
          </div>
        </div>

        {/* Vehicle Alerts */}
        <div className="space-y-2">
          <h3 className="font-semibold text-sm">Active & Recent Alerts</h3>
          <div className="space-y-2">
            {alerts.length === 0 ? (
              <div className="text-xs text-text-muted bg-surface-2/40 p-3 rounded-lg border border-border text-center">
                No active alerts for this vehicle.
              </div>
            ) : (
              alerts.slice(0, 5).map(a => (
                <div key={a.id} className="bg-surface-2 p-3 rounded-lg text-xs flex flex-col gap-1 border border-border">
                  <div className="flex items-center justify-between">
                    <Badge variant={a.alert_type === 'CRITICAL' ? 'critical' : 'warning'}>{a.rule}</Badge>
                    <span className="text-[10px] text-text-muted">
                      {a.created_at ? new Date(a.created_at).toLocaleTimeString() : ''}
                    </span>
                  </div>
                  <span className="text-text-primary font-medium">{a.message}</span>
                  {a.recommended_action && (
                    <span className="text-text-muted italic text-[11px]">Action: {a.recommended_action}</span>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
