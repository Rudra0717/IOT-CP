import React from 'react';
import { Card } from './ui/Card';
import { Car, Wifi, Zap, Navigation, AlertTriangle, AlertOctagon, Activity, RadioTower } from 'lucide-react';
import { FleetSummary } from '@/types/fleet';

interface KPICardsProps {
  summary: FleetSummary;
}

export default function KPICards({ summary }: KPICardsProps) {
  const simState = summary.simulation_state || 'RUNNING';

  const getSimStateBadge = () => {
    switch (simState) {
      case 'RUNNING':
        return { text: 'RUNNING', color: 'text-accent-green', border: 'border-accent-green/40', dot: 'bg-accent-green animate-pulse' };
      case 'PAUSED':
        return { text: 'PAUSED', color: 'text-accent-yellow', border: 'border-accent-yellow/40', dot: 'bg-accent-yellow' };
      case 'STOPPED':
        return { text: 'STOPPED', color: 'text-accent-red', border: 'border-accent-red/40', dot: 'bg-accent-red' };
      default:
        return { text: simState, color: 'text-text-muted', border: 'border-border', dot: 'bg-gray-400' };
    }
  };

  const badge = getSimStateBadge();

  const cards = [
    { title: 'Total Fleet', value: summary.total, icon: Car, color: 'text-text-primary' },
    { title: 'Online', value: summary.online, icon: Wifi, color: 'text-accent-green' },
    { title: 'Charging', value: summary.charging, icon: Zap, color: 'text-accent-blue' },
    { title: 'Driving', value: summary.driving, icon: Navigation, color: 'text-cyan-400' },
    { title: 'Warnings', value: summary.warnings, icon: AlertTriangle, color: 'text-accent-yellow' },
    { title: 'Critical', value: summary.criticals, icon: AlertOctagon, color: 'text-accent-red', pulse: summary.criticals > 0 },
  ];

  return (
    <div className="space-y-3 mb-6">
      {/* Simulation status banner card */}
      <div className="flex items-center justify-between bg-surface-2/70 border border-border px-4 py-2 rounded-xl text-sm">
        <div className="flex items-center gap-3">
          <Activity className="w-4 h-4 text-accent-blue" />
          <span className="font-semibold text-text-primary">Simulation Engine:</span>
          <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold border ${badge.border} ${badge.color}`}>
            <span className={`w-2 h-2 rounded-full ${badge.dot}`} />
            {badge.text}
          </span>
        </div>
        <div className="flex items-center gap-4 text-xs text-text-muted">
          <span>Idle: <strong className="text-text-primary">{summary.idle}</strong></span>
          <span>Offline: <strong className="text-text-primary">{summary.offline ?? (summary.total - summary.online)}</strong></span>
          {summary.average_soc ? (
            <span>Avg SoC: <strong className="text-accent-green">{summary.average_soc}%</strong></span>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {cards.map((card, i) => {
          const Icon = card.icon;
          return (
            <Card key={i} className={`p-4 flex flex-col justify-center ${card.pulse ? 'border-accent-red/50 animate-pulse' : ''}`}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-text-muted font-medium">{card.title}</span>
                <Icon className={`w-5 h-5 ${card.color}`} />
              </div>
              <div className="text-2xl font-bold">{card.value}</div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
