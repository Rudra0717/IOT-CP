'use client';

import React, { useEffect } from 'react';
import { MapContainer, TileLayer, CircleMarker, Popup, Polyline, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { Vehicle } from '@/types/fleet';

// Fix for default marker icons in Next.js
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

interface FleetMapProps {
  vehicles: Vehicle[];
  onVehicleClick?: (v: Vehicle) => void;
  trail?: Array<[number, number]>;
  autoCenter?: boolean;
}

/**
 * Controller to smoothly pan/center the Leaflet map as vehicle telemetry updates
 */
function MapController({
  center,
  zoom,
  autoCenter,
}: {
  center: [number, number];
  zoom?: number;
  autoCenter?: boolean;
}) {
  const map = useMap();

  useEffect(() => {
    if (autoCenter && center && !isNaN(center[0]) && !isNaN(center[1])) {
      map.setView(center, zoom ?? map.getZoom(), { animate: true });
    }
  }, [center, zoom, autoCenter, map]);

  return null;
}

export default function FleetMap({
  vehicles,
  onVehicleClick,
  trail,
  autoCenter = true,
}: FleetMapProps) {
  const getStatusColor = (status: string, isOnline: boolean, scenario?: string) => {
    if (!isOnline) return '#4b5563'; // dark gray
    if (scenario && scenario !== 'normal') return '#f97316'; // warning orange for active scenario
    switch (status) {
      case 'DRIVING':
        return '#10b981'; // emerald
      case 'CHARGING':
        return '#3b82f6'; // blue
      case 'FAULT':
        return '#ef4444'; // red
      default:
        return '#9ca3af'; // idle gray
    }
  };

  // Determine initial center
  const defaultCenter: [number, number] = [28.6139, 77.2090]; // New Delhi
  const primaryVehicle = vehicles[0];
  const initialCenter: [number, number] =
    primaryVehicle && !isNaN(primaryVehicle.lat) && !isNaN(primaryVehicle.lon)
      ? [primaryVehicle.lat, primaryVehicle.lon]
      : defaultCenter;

  const currentZoom = vehicles.length === 1 ? 15 : 13;

  return (
    <div className="h-full w-full min-h-[300px] rounded-xl overflow-hidden border border-border relative">
      <MapContainer
        center={initialCenter}
        zoom={currentZoom}
        style={{ height: '100%', width: '100%' }}
        scrollWheelZoom={true}
      >
        {/* Dynamic Map Controller */}
        <MapController
          center={initialCenter}
          zoom={currentZoom}
          autoCenter={autoCenter}
        />

        {/* Free Dark Matter TileLayer without any API Key requirements */}
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
          url={
            process.env.NEXT_PUBLIC_MAP_TILE_URL ||
            'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
          }
          subdomains={['a', 'b', 'c', 'd']}
          maxZoom={19}
        />

        {/* Historical Route / Trail Polyline if available */}
        {trail && trail.length > 1 && (
          <Polyline
            positions={trail}
            pathOptions={{
              color: '#38bdf8',
              weight: 3.5,
              opacity: 0.8,
              dashArray: '4, 6',
            }}
          />
        )}

        {/* Vehicle Markers */}
        {vehicles.map((v) => {
          const lat = v.lat ?? v.latitude ?? 28.6139;
          const lon = v.lon ?? v.longitude ?? 77.2090;
          if (isNaN(lat) || isNaN(lon)) return null;

          const isFaulty = v.status === 'FAULT' || (v.scenario && v.scenario !== 'normal');
          const color = getStatusColor(v.status, v.is_online ?? true, v.scenario);

          return (
            <React.Fragment key={v.id}>
              {/* Outer pulsing ring for faults/scenarios */}
              {isFaulty && (
                <CircleMarker
                  center={[lat, lon]}
                  radius={16}
                  pathOptions={{
                    fillColor: color,
                    fillOpacity: 0.25,
                    color: color,
                    weight: 1.5,
                  }}
                />
              )}

              {/* Core Vehicle Marker */}
              <CircleMarker
                center={[lat, lon]}
                radius={vehicles.length === 1 ? 10 : 7}
                pathOptions={{
                  fillColor: color,
                  color: '#ffffff',
                  weight: 2,
                  fillOpacity: 0.95,
                }}
                eventHandlers={{
                  click: () => onVehicleClick?.(v),
                }}
              >
                <Popup>
                  <div className="p-1.5 min-w-[180px] font-sans text-xs bg-gray-900 text-gray-100 rounded">
                    <div className="flex items-center justify-between border-b border-gray-700 pb-1.5 mb-2">
                      <span className="font-mono font-bold text-sm text-sky-400">{v.id}</span>
                      <span
                        className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold"
                        style={{ backgroundColor: color + '33', color: color }}
                      >
                        {v.status}
                      </span>
                    </div>

                    <div className="flex flex-col gap-1 text-[11px] text-gray-300">
                      {v.scenario && v.scenario !== 'normal' && (
                        <div className="flex justify-between text-amber-400 font-bold bg-amber-950/40 px-1 py-0.5 rounded">
                          <span>Scenario:</span>
                          <span className="uppercase font-mono">{v.scenario.replace(/_/g, ' ')}</span>
                        </div>
                      )}
                      <div className="flex justify-between">
                        <span className="text-gray-400">Battery SoC:</span>
                        <span className="font-mono font-semibold text-emerald-400">
                          {(v.soc ?? v.battery_soc ?? 0).toFixed(1)}%
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-400">Speed:</span>
                        <span className="font-mono font-semibold">
                          {(v.speed ?? 0).toFixed(1)} km/h
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-400">Pack Temp:</span>
                        <span className="font-mono font-semibold text-orange-400">
                          {(v.pack_temp ?? v.battery_temperature ?? 30).toFixed(1)}°C
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-400">Coordinates:</span>
                        <span className="font-mono text-[10px]">
                          {lat.toFixed(4)}°N, {lon.toFixed(4)}°E
                        </span>
                      </div>
                    </div>
                  </div>
                </Popup>
              </CircleMarker>
            </React.Fragment>
          );
        })}
      </MapContainer>
    </div>
  );
}
