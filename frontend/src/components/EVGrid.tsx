'use client';

import React, { useState } from 'react';
import { Vehicle, Alert } from '@/types/fleet';
import EVCard from './EVCard';
import { Search, Filter, Cpu, Layers } from 'lucide-react';

interface EVGridProps {
  vehicles: Vehicle[];
  alerts: Alert[];
  onSelectVehicle: (vehicle: Vehicle) => void;
}

export default function EVGrid({ vehicles, alerts, onSelectVehicle }: EVGridProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'ALERT' | 'OFFLINE'>('ALL');

  // Map active alerts per vehicle
  const activeAlertsByVehicle = React.useMemo(() => {
    const map = new Map<string, Alert>();
    alerts.forEach((a) => {
      if (a.is_active) {
        // Prefer critical over warning
        const existing = map.get(a.vehicle_id);
        if (!existing || (existing.alert_type !== 'CRITICAL' && a.alert_type === 'CRITICAL')) {
          map.set(a.vehicle_id, a);
        }
      }
    });
    return map;
  }, [alerts]);

  // Filter vehicles
  const filteredVehicles = vehicles.filter((v) => {
    const matchesSearch =
      v.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (v.device_id && v.device_id.toLowerCase().includes(searchTerm.toLowerCase())) ||
      v.scenario.toLowerCase().includes(searchTerm.toLowerCase());

    const hasAlert = activeAlertsByVehicle.has(v.id);
    const isOnline = v.online ?? v.is_online ?? true;

    if (!matchesSearch) return false;
    if (statusFilter === 'ALERT') return hasAlert;
    if (statusFilter === 'OFFLINE') return !isOnline;
    if (statusFilter === 'ACTIVE') return isOnline && !hasAlert;
    return true;
  });

  return (
    <div className="flex flex-col gap-4">
      {/* Search & Filter Sub-Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-surface/60 border border-border/70 rounded-xl p-3 backdrop-blur-sm">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-surface-2 flex items-center justify-center text-accent-blue">
            <Layers className="w-3.5 h-3.5" />
          </div>
          <div>
            <span className="text-xs font-semibold uppercase tracking-wider text-text-primary">
              Virtual EV Fleet Workspace
            </span>
            <span className="text-xs font-mono text-text-muted ml-2">
              ({filteredVehicles.length} of {vehicles.length} active nodes)
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* Search box */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
            <input
              type="text"
              placeholder="Search EV ID or scenario..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="bg-surface-2 text-xs text-text-primary pl-8 pr-3 py-1.5 rounded-lg border border-border/80 focus:outline-none focus:border-accent-blue transition-colors w-44 sm:w-56"
            />
          </div>

          {/* Filter Pills */}
          <div className="flex items-center gap-1 bg-surface-2 p-0.5 rounded-lg border border-border/80">
            {(['ALL', 'ACTIVE', 'ALERT', 'OFFLINE'] as const).map((filter) => (
              <button
                key={filter}
                type="button"
                onClick={() => setStatusFilter(filter)}
                className={`text-[11px] px-2.5 py-1 rounded-md font-medium transition-colors ${
                  statusFilter === filter
                    ? 'bg-accent-blue text-white shadow-sm'
                    : 'text-text-muted hover:text-text-primary'
                }`}
              >
                {filter}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Responsive Grid */}
      {filteredVehicles.length === 0 ? (
        <div className="bg-surface/50 border border-border/60 rounded-xl p-12 flex flex-col items-center justify-center text-center gap-3">
          <Cpu className="w-10 h-10 text-text-muted opacity-40 animate-pulse" />
          <h3 className="text-sm font-semibold text-text-primary">No Virtual EVs Found</h3>
          <p className="text-xs text-text-muted max-w-sm">
            {vehicles.length === 0
              ? 'Simulation is stopped or no vehicles configured. Increase fleet size or press Start.'
              : 'No vehicles match your active search and filter criteria.'}
          </p>
        </div>
      ) : (
        <div
          className={`grid gap-4.5 ${
            filteredVehicles.length === 1
              ? 'grid-cols-1 max-w-md mx-auto w-full'
              : filteredVehicles.length === 2
              ? 'grid-cols-1 sm:grid-cols-2 max-w-3xl mx-auto w-full'
              : filteredVehicles.length <= 4
              ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4'
              : 'grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5'
          }`}
        >
          {filteredVehicles.map((vehicle) => {
            const activeAlert = activeAlertsByVehicle.get(vehicle.id);
            return (
              <EVCard
                key={vehicle.id}
                vehicle={vehicle}
                onSelect={onSelectVehicle}
                hasActiveAlert={Boolean(activeAlert)}
                alertType={activeAlert?.alert_type}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
