import { useState, useEffect, useCallback } from 'react';
import { useWebSocket } from './useWebSocket';
import { Vehicle, Alert, FleetSummary, TelemetryPoint, SimulationState } from '@/types/fleet';

const API_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';
const WS_URL = (process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:8000') + '/ws';

/** Map backend FLEET_UPDATE payload → FleetSummary shape */
function mapFleetSummary(data: Record<string, any>, currentSimState: SimulationState = 'RUNNING'): FleetSummary {
  return {
    total:            data.total_vehicles ?? data.total ?? 0,
    online:           data.online ?? 0,
    offline:          data.offline ?? 0,
    charging:         data.charging ?? 0,
    idle:             data.idle ?? 0,
    driving:          data.driving ?? 0,
    fault:            data.fault ?? 0,
    warnings:         data.warnings ?? 0,
    criticals:        data.criticals ?? 0,
    average_soc:      data.average_soc ?? 0,
    simulation_state: (data.simulation_state || data.state || currentSimState) as SimulationState,
  };
}

export function useFleetData() {
  const { isConnected, lastMessage } = useWebSocket(WS_URL);
  const [vehiclesMap, setVehiclesMap] = useState<Record<string, Vehicle>>({});
  const [simulationState, setSimulationState] = useState<SimulationState>('RUNNING');
  const [fleetSummary, setFleetSummary] = useState<FleetSummary>({
    total: 0, online: 0, offline: 0, charging: 0, idle: 0, driving: 0, fault: 0, warnings: 0, criticals: 0, simulation_state: 'RUNNING'
  });
  const [alerts, setAlerts] = useState<Alert[]>([]);

  const fetchInitialData = useCallback(async () => {
    try {
      const [vehRes, alertsRes, simRes] = await Promise.all([
        fetch(`${API_URL}/api/vehicles`),
        fetch(`${API_URL}/api/alerts`),
        fetch(`${API_URL}/api/simulation/status`).catch(() => null),
      ]);

      let activeLimit = 20;
      if (simRes && simRes.ok) {
        const simData = await simRes.json();
        const state = (simData.state || 'RUNNING') as SimulationState;
        setSimulationState(state);
        if (typeof simData.fleet_size === 'number') {
          activeLimit = simData.fleet_size;
        }
        setFleetSummary(prev => ({ ...prev, simulation_state: state, total: simData.fleet_size ?? prev.total }));
      }

      if (vehRes && vehRes.ok) {
        const data: Vehicle[] = await vehRes.json();
        const map: Record<string, Vehicle> = {};
        data.forEach(v => {
          const num = parseInt(v.id.replace(/\D/g, ''), 10);
          if (isNaN(num) || num <= activeLimit) {
            map[v.id] = v;
          }
        });
        setVehiclesMap(map);
      }

      if (alertsRes && alertsRes.ok) {
        const data: Alert[] = await alertsRes.json();
        setAlerts(data);
      }
    } catch (e) {
      console.error('Error fetching initial data', e);
    }
  }, []);

  useEffect(() => {
    fetchInitialData();
  }, [fetchInitialData]);

  useEffect(() => {
    if (!lastMessage) return;
    const { event, data } = lastMessage;

    switch (event) {
      case 'VEHICLE_TELEMETRY': {
        const key = data.vehicle_id || data.id;
        if (key) {
          setVehiclesMap(prev => ({
            ...prev,
            [key]: {
              ...(prev[key] || {}),
              ...data,
              id: key,
              soc: data.battery_soc ?? data.soc,
              voltage: data.battery_voltage ?? data.voltage,
              pack_temp: data.battery_temperature ?? data.pack_temp,
              motor_temp: data.motor_temperature ?? data.motor_temp,
              current: data.battery_current ?? data.current,
              lat: data.latitude ?? data.lat,
              lon: data.longitude ?? data.lon,
              status: data.vehicle_status ?? data.status,
              is_online: data.online ?? true,
            } as Vehicle,
          }));
        }
        break;
      }
      case 'FLEET_UPDATE':
        setFleetSummary(mapFleetSummary(data, simulationState));
        break;
      case 'NEW_ALERT': {
        const alertObj = data as Alert;
        setAlerts(prev => {
          const existingIdx = prev.findIndex(a => a.id === alertObj.id);
          if (existingIdx >= 0) {
            const updated = [...prev];
            updated[existingIdx] = alertObj;
            return updated;
          }
          return [alertObj, ...prev.slice(0, 499)];
        });
        break;
      }
      case 'ALERT_RESOLVED': {
        const resolved = data as Alert;
        setAlerts(prev => prev.map(a => a.id === resolved.id ? { ...a, is_active: false, resolved_at: resolved.resolved_at } : a));
        break;
      }
      case 'SIMULATION_STATUS': {
        const state = (data.state || data) as SimulationState;
        setSimulationState(state);
        setFleetSummary(prev => ({ ...prev, simulation_state: state }));
        break;
      }
    }
  }, [lastMessage, simulationState]);

  const fetchVehicleHistory = async (vehicleId: string): Promise<TelemetryPoint[]> => {
    try {
      const res = await fetch(`${API_URL}/api/vehicles/${vehicleId}/history`);
      if (res.ok) return await res.json();
      return [];
    } catch (e) {
      console.error('Error fetching vehicle history', e);
      return [];
    }
  };

  const acknowledgeAlert = async (alertId: number) => {
    try {
      const res = await fetch(`${API_URL}/api/alerts/${alertId}/acknowledge`, { method: 'POST' });
      if (res.ok) {
        setAlerts(prev => prev.map(a => a.id === alertId ? { ...a, acknowledged: true } : a));
      }
    } catch (e) {
      console.error('Error acknowledging alert', e);
    }
  };

  const resolveAlert = async (alertId: number) => {
    try {
      const res = await fetch(`${API_URL}/api/alerts/${alertId}/resolve`, { method: 'POST' });
      if (res.ok) {
        setAlerts(prev => prev.map(a => a.id === alertId ? { ...a, is_active: false, resolved_at: new Date().toISOString() } : a));
      }
    } catch (e) {
      console.error('Error resolving alert', e);
    }
  };

  const controlSimulation = async (action: 'start' | 'pause' | 'resume' | 'stop') => {
    try {
      const res = await fetch(`${API_URL}/api/simulation/${action}`, { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        const nextState = (data.state || (action === 'pause' ? 'PAUSED' : action === 'stop' ? 'STOPPED' : 'RUNNING')) as SimulationState;
        setSimulationState(nextState);
        setFleetSummary(prev => ({ ...prev, simulation_state: nextState }));
      }
    } catch (e) {
      console.error(`Error sending simulation ${action}`, e);
    }
  };

  const scaleFleet = async (newSize: number) => {
    try {
      const res = await fetch(`${API_URL}/api/simulation/configure`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fleet_size: newSize }),
      });
      if (res.ok) {
        // Instantly prune local vehicle cards to match the newly requested size
        setVehiclesMap(prev => {
          const next: Record<string, Vehicle> = {};
          Object.entries(prev).forEach(([id, v]) => {
            const num = parseInt(id.replace(/\D/g, ''), 10);
            if (isNaN(num) || num <= newSize) {
              next[id] = v;
            }
          });
          return next;
        });
        setFleetSummary(prev => ({ ...prev, total: newSize }));
        // Allow simulator a brief moment to adjust tasks, then refresh
        await new Promise(r => setTimeout(r, 400));
        await fetchInitialData();
      }
    } catch (e) {
      console.error('Error scaling fleet', e);
    }
  };

  const changeInterval = async (newInterval: number) => {
    try {
      await fetch(`${API_URL}/api/simulation/configure`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ interval: newInterval }),
      });
    } catch (e) {
      console.error('Error changing interval', e);
    }
  };

  const injectScenario = async (vehicleId: string, scenario: string) => {
    try {
      // Optimistically update local state so the UI reacts with zero latency
      setVehiclesMap((prev) => {
        if (vehicleId.toLowerCase() === 'all') {
          const next = { ...prev };
          Object.keys(next).forEach((k) => {
            next[k] = { ...next[k], scenario };
          });
          return next;
        } else if (prev[vehicleId]) {
          return {
            ...prev,
            [vehicleId]: { ...prev[vehicleId], scenario },
          };
        }
        return prev;
      });

      const res = await fetch(`${API_URL}/api/simulation/configure`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vehicle_id: vehicleId, scenario }),
      });

      if (res.ok) {
        // Re-sync alerts and latest vehicle data after a short tick
        setTimeout(() => {
          fetchInitialData();
        }, 400);
      }
    } catch (e) {
      console.error('Error injecting scenario', e);
      throw e;
    }
  };

  // Sort vehicles in natural ascending numerical order (EV-001, EV-002, ...)
  const sortedVehicles = Object.values(vehiclesMap).sort((a, b) =>
    a.id.localeCompare(b.id, undefined, { numeric: true })
  );

  return {
    vehicles: sortedVehicles,
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
    refreshData: fetchInitialData,
  };
}
