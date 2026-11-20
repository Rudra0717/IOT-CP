export type VehicleStatus = 'IDLE' | 'DRIVING' | 'CHARGING' | 'FAULT';
export type AlertType = 'WARNING' | 'CRITICAL';
export type AlertRule =
  | 'LOW_SOC'
  | 'PACK_OVERHEAT'
  | 'MOTOR_OVERHEAT'
  | 'VOLTAGE_SAG'
  | 'HEARTBEAT_MISS'
  | 'ABNORMAL_ENERGY_CONSUMPTION'
  | 'RAPID_TEMP_RISE'
  | 'SUDDEN_VOLTAGE_DROP'
  | 'ERRATIC_GPS'
  | 'INVALID_SENSOR_VALUE'
  | 'CORRUPTED_SENSOR_VALUE'
  | 'STALE_TELEMETRY'
  | string;

export type ScenarioName =
  | 'normal'
  | 'battery_overheat'
  | 'motor_overheat'
  | 'low_battery'
  | 'energy_spike'
  | 'sensor_offline'
  | 'sensor_invalid'
  | 'sensor_corrupted'
  | 'sensor_delayed';

export type SimulationState = 'RUNNING' | 'PAUSED' | 'STOPPED';

export interface Vehicle {
  id: string;
  vehicle_id?: string;
  fleet_id: string;
  device_id?: string;
  vehicle_type?: string;
  battery_capacity_kwh?: number;
  status: VehicleStatus;
  vehicle_status?: VehicleStatus;
  soc: number;
  battery_soc?: number;
  voltage: number;
  battery_voltage?: number;
  pack_temp: number;
  battery_temperature?: number;
  motor_temp: number;
  motor_temperature?: number;
  current: number;
  battery_current?: number;
  speed: number;
  lat: number;
  latitude?: number;
  lon: number;
  longitude?: number;
  heading?: number;
  energy_consumption_kwh_per_km?: number;
  charging?: boolean;
  odometer: number;
  odometer_km?: number;
  scenario: string;
  last_seen: string;
  is_online: boolean;
  online?: boolean;
}

export interface TelemetryPoint {
  timestamp: string | number;
  soc: number;
  voltage: number;
  pack_temp: number;
  motor_temp: number;
  current: number;
  speed: number;
  lat?: number;
  latitude?: number;
  lon?: number;
  longitude?: number;
  energy_consumption?: number;
  heading?: number;
}

export interface Alert {
  id: number;
  vehicle_id: string;
  fleet_id: string;
  device_id?: string;
  alert_type: AlertType;
  rule: AlertRule;
  message: string;
  value: number;
  threshold: number;
  recommended_action?: string;
  is_active: boolean;
  acknowledged: boolean;
  created_at: string;
  resolved_at: string | null;
}

export interface FleetSummary {
  total: number;
  online: number;
  offline?: number;
  charging: number;
  idle: number;
  driving: number;
  fault: number;
  warnings: number;
  criticals: number;
  average_soc?: number;
  simulation_state?: SimulationState;
}

export interface WSMessage {
  event: 'FLEET_UPDATE' | 'VEHICLE_TELEMETRY' | 'NEW_ALERT' | 'ALERT_RESOLVED' | 'SIMULATION_STATUS';
  data: any;
}
