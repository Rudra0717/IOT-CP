import React, { useState } from 'react';
import { Alert } from '@/types/fleet';
import { Card } from './ui/Card';
import { Badge } from './ui/Badge';
import { Search, CheckCircle, Check, ShieldAlert, Filter } from 'lucide-react';

interface AlertCenterProps {
  alerts: Alert[];
  onAcknowledge: (id: number) => void;
  onResolve?: (id: number) => void;
  onSelectVehicle?: (vehicleId: string) => void;
}

function formatTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export default function AlertCenter({ alerts, onAcknowledge, onResolve, onSelectVehicle }: AlertCenterProps) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'ACK' | 'RESOLVED'>('ALL');
  const [severityFilter, setSeverityFilter] = useState<'ALL' | 'CRITICAL' | 'WARNING'>('ALL');
  const [ruleFilter, setRuleFilter] = useState('ALL');
  const [loadingIds, setLoadingIds] = useState<Record<number, boolean>>({});

  // Unique rules present in current alerts
  const uniqueRules = Array.from(new Set(alerts.map(a => a.rule).filter(Boolean)));

  const filtered = alerts.filter(a => {
    const matchSearch =
      a.vehicle_id.toLowerCase().includes(search.toLowerCase()) ||
      a.message.toLowerCase().includes(search.toLowerCase()) ||
      (a.device_id && a.device_id.toLowerCase().includes(search.toLowerCase()));

    const matchStatus =
      statusFilter === 'ALL' ||
      (statusFilter === 'ACTIVE' && a.is_active && !a.acknowledged) ||
      (statusFilter === 'ACK' && a.acknowledged && a.is_active) ||
      (statusFilter === 'RESOLVED' && !a.is_active);

    const matchSeverity =
      severityFilter === 'ALL' || a.alert_type === severityFilter;

    const matchRule =
      ruleFilter === 'ALL' || a.rule === ruleFilter;

    return matchSearch && matchStatus && matchSeverity && matchRule;
  });

  const handleAck = async (id: number) => {
    setLoadingIds(prev => ({ ...prev, [id]: true }));
    try {
      await onAcknowledge(id);
    } finally {
      setLoadingIds(prev => ({ ...prev, [id]: false }));
    }
  };

  const handleResolve = async (id: number) => {
    if (!onResolve) return;
    setLoadingIds(prev => ({ ...prev, [id]: true }));
    try {
      await onResolve(id);
    } finally {
      setLoadingIds(prev => ({ ...prev, [id]: false }));
    }
  };

  return (
    <Card className="flex flex-col h-[400px] lg:h-[500px]">
      {/* Header & Search */}
      <div className="p-3.5 border-b border-border space-y-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-accent-red" />
            <h3 className="font-bold text-base">Alert & Anomaly Center</h3>
          </div>
          <span className="text-xs px-2 py-0.5 rounded-full bg-surface-2 border border-border text-text-muted">
            {filtered.length} alerts
          </span>
        </div>

        {/* Search & Rule Filter */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
            <input
              type="text"
              placeholder="Search vehicle, rule, or action..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-surface-2 border border-border rounded-md pl-8 pr-2.5 py-1 text-xs focus:outline-none focus:border-accent-blue"
            />
          </div>
          <select
            value={ruleFilter}
            onChange={(e) => setRuleFilter(e.target.value)}
            className="bg-surface-2 border border-border rounded-md px-2 py-1 text-xs focus:outline-none focus:border-accent-blue"
          >
            <option value="ALL">All Rules</option>
            {uniqueRules.map(r => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </div>

        {/* Status and Severity tab pills */}
        <div className="flex items-center justify-between gap-1 text-[11px] overflow-x-auto">
          <div className="flex gap-1">
            {(['ALL', 'ACTIVE', 'ACK', 'RESOLVED'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setStatusFilter(tab)}
                className={`px-2 py-0.5 rounded-md font-medium transition-colors ${
                  statusFilter === tab
                    ? 'bg-accent-blue text-white'
                    : 'text-text-muted hover:text-text-primary hover:bg-surface-2'
                }`}
              >
                {tab === 'ACK' ? 'Ack' : tab.charAt(0) + tab.slice(1).toLowerCase()}
              </button>
            ))}
          </div>
          <div className="flex gap-1 border-l border-border pl-2">
            {(['ALL', 'CRITICAL', 'WARNING'] as const).map(sev => (
              <button
                key={sev}
                onClick={() => setSeverityFilter(sev)}
                className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                  severityFilter === sev
                    ? sev === 'CRITICAL' ? 'bg-accent-red text-white' : sev === 'WARNING' ? 'bg-accent-yellow text-black' : 'bg-surface-2 text-white'
                    : 'text-text-muted hover:text-text-primary'
                }`}
              >
                {sev}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Alert list body */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {filtered.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-text-muted text-xs gap-1.5">
            <CheckCircle className="w-8 h-8 text-accent-green/60" />
            <span>No alerts match your filter criteria.</span>
          </div>
        ) : (
          filtered.map((alert, idx) => {
            const isLoading = !!loadingIds[alert.id];
            const isCritical = alert.alert_type === 'CRITICAL';
            const isResolved = !alert.is_active;

            return (
              <div
                key={alert.id ?? `alert-${idx}`}
                className={`p-3 rounded-lg border text-xs flex flex-col gap-1.5 transition-all ${
                  isResolved
                    ? 'bg-surface-2/40 border-border opacity-60'
                    : isCritical
                    ? 'bg-accent-red/10 border-accent-red/30'
                    : 'bg-accent-yellow/10 border-accent-yellow/30'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <span className="font-bold text-text-primary">{alert.vehicle_id}</span>
                    <Badge variant={isCritical ? 'critical' : 'warning'}>
                      {alert.rule}
                    </Badge>
                    {isResolved && (
                      <span className="text-[10px] text-accent-green px-1.5 py-0.2 rounded border border-accent-green/40">
                        Resolved
                      </span>
                    )}
                  </div>
                  <span className="text-[10px] text-text-muted">{formatTime(alert.created_at)}</span>
                </div>

                <p className="text-text-primary font-medium">{alert.message}</p>

                {alert.recommended_action && (
                  <p className="text-[11px] text-text-muted italic bg-surface/50 px-2 py-1 rounded border border-border/50">
                    <strong className="text-text-primary not-italic">Action: </strong>
                    {alert.recommended_action}
                  </p>
                )}

                {/* Actions: View EV, Acknowledge & Resolve */}
                <div className="flex items-center justify-between gap-2 pt-1 border-t border-border/40">
                  {onSelectVehicle ? (
                    <button
                      type="button"
                      onClick={() => onSelectVehicle(alert.vehicle_id)}
                      className="text-[10px] font-mono font-bold text-accent-blue hover:underline uppercase"
                    >
                      VIEW EV →
                    </button>
                  ) : <div />}

                  <div className="flex items-center gap-2">
                    {!alert.acknowledged && !isResolved && (
                      <button
                        onClick={() => handleAck(alert.id)}
                        disabled={isLoading}
                        className="inline-flex items-center gap-1 text-[11px] font-semibold text-accent-blue hover:text-blue-400 transition-colors disabled:opacity-50"
                      >
                        <Check className="w-3.5 h-3.5" />
                        {isLoading ? 'Saving...' : 'Acknowledge'}
                      </button>
                    )}
                    {alert.acknowledged && !isResolved && (
                      <span className="text-[10px] text-accent-green font-medium">Acknowledged</span>
                    )}
                    {!isResolved && onResolve && (
                      <button
                        onClick={() => handleResolve(alert.id)}
                        disabled={isLoading}
                        className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-400 hover:text-emerald-300 transition-colors disabled:opacity-50"
                      >
                        <CheckCircle className="w-3 h-3" />
                        Resolve
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </Card>
  );
}
