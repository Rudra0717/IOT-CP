import React, { useState } from 'react';
import { Vehicle } from '@/types/fleet';
import { Card } from './ui/Card';
import { Badge } from './ui/Badge';
import { Search } from 'lucide-react';

interface VehicleTableProps {
  vehicles: Vehicle[];
  onVehicleSelect: (v: Vehicle) => void;
}

export default function VehicleTable({ vehicles, onVehicleSelect }: VehicleTableProps) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');

  const filtered = vehicles.filter(v => {
    const matchSearch =
      v.id.toLowerCase().includes(search.toLowerCase()) ||
      (v.device_id && v.device_id.toLowerCase().includes(search.toLowerCase()));
    const matchStatus = statusFilter === 'ALL' || v.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const getSocColor = (soc: number) => {
    if (soc > 50) return 'bg-accent-green';
    if (soc >= 15) return 'bg-accent-yellow';
    return 'bg-accent-red';
  };

  const getStatusVariant = (status: string, isOnline: boolean): any => {
    if (!isOnline) return 'muted';
    switch (status) {
      case 'DRIVING': return 'success';
      case 'CHARGING': return 'info';
      case 'FAULT': return 'critical';
      default: return 'muted';
    }
  };

  return (
    <Card className="flex flex-col w-full h-full min-h-[400px]">
      <div className="p-4 border-b border-border flex flex-col sm:flex-row justify-between items-center gap-4">
        <div className="flex items-center gap-2">
          <h3 className="font-bold text-lg">Vehicle Fleet</h3>
          <span className="text-xs px-2 py-0.5 rounded-full bg-surface-2 border border-border text-text-muted">
            {filtered.length} nodes
          </span>
        </div>
        <div className="flex items-center gap-3 w-full sm:w-auto">
          <div className="relative flex-1 sm:flex-none">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
            <input
              type="text"
              placeholder="Search ID or Device..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full sm:w-56 bg-surface-2 border border-border rounded-md pl-9 pr-3 py-1.5 text-sm focus:outline-none focus:border-accent-blue"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-surface-2 border border-border rounded-md px-3 py-1.5 text-sm focus:outline-none focus:border-accent-blue"
          >
            <option value="ALL">All Status</option>
            <option value="IDLE">Idle</option>
            <option value="DRIVING">Driving</option>
            <option value="CHARGING">Charging</option>
            <option value="FAULT">Fault</option>
          </select>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm whitespace-nowrap">
          <thead className="bg-surface-2 text-text-muted text-xs uppercase">
            <tr>
              <th className="px-4 py-3 font-semibold">Vehicle / Device</th>
              <th className="px-4 py-3 font-semibold">Status</th>
              <th className="px-4 py-3 font-semibold min-w-[140px]">SoC %</th>
              <th className="px-4 py-3 font-semibold">Speed</th>
              <th className="px-4 py-3 font-semibold">Pack Temp</th>
              <th className="px-4 py-3 font-semibold">Motor Temp</th>
              <th className="px-4 py-3 font-semibold">Voltage</th>
              <th className="px-4 py-3 font-semibold">Energy (kWh/km)</th>
              <th className="px-4 py-3 font-semibold">Scenario</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filtered.map(v => (
              <tr
                key={v.id}
                onClick={() => onVehicleSelect(v)}
                className="hover:bg-surface-2/50 cursor-pointer transition-colors"
              >
                <td className="px-4 py-3">
                  <div className="font-semibold text-text-primary">{v.id}</div>
                  <div className="text-xs text-text-muted">{v.device_id || `ESP32-${v.id}`}</div>
                </td>
                <td className="px-4 py-3">
                  <Badge variant={getStatusVariant(v.status, v.is_online)}>{v.is_online ? v.status : 'OFFLINE'}</Badge>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="w-8 font-medium">{(v.soc ?? v.battery_soc ?? 0).toFixed(1)}%</span>
                    <div className="h-2 w-20 bg-surface-2 rounded-full overflow-hidden">
                      <div className={`h-full ${getSocColor(v.soc ?? v.battery_soc ?? 0)}`} style={{ width: `${Math.min(100, Math.max(0, v.soc ?? v.battery_soc ?? 0))}%` }} />
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3">{v.speed.toFixed(1)} km/h</td>
                <td className="px-4 py-3">{(v.pack_temp ?? v.battery_temperature ?? 0).toFixed(1)} °C</td>
                <td className="px-4 py-3">{(v.motor_temp ?? v.motor_temperature ?? 0).toFixed(1)} °C</td>
                <td className="px-4 py-3">{(v.voltage ?? v.battery_voltage ?? 0).toFixed(1)} V</td>
                <td className="px-4 py-3">
                  <span className={(v.energy_consumption_kwh_per_km || 0) > 0.45 ? 'text-accent-yellow font-bold' : 'text-text-primary'}>
                    {(v.energy_consumption_kwh_per_km || 0).toFixed(3)}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className="text-xs px-2 py-0.5 rounded bg-surface border border-border text-text-muted">
                    {v.scenario || 'normal'}
                  </span>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-text-muted">No vehicles matching filter.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
