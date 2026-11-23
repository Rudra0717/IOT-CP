'use client';

import React, { useEffect, useState } from 'react';
import { MapContainer, TileLayer, CircleMarker, Popup, Polyline, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { Vehicle } from '@/types/fleet';
import { Layers, Key, Check, RotateCcw, X, MapPin } from 'lucide-react';

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

type LayerMode = 'dark' | 'standard' | 'satellite' | 'navigation' | 'carto';

/**
 * Controller to ensure map size updates when container or tabs transition
 */
function MapResizer() {
  const map = useMap();

  useEffect(() => {
    map.invalidateSize();
    const t1 = setTimeout(() => map.invalidateSize(), 100);
    const t2 = setTimeout(() => map.invalidateSize(), 300);
    const t3 = setTimeout(() => map.invalidateSize(), 800);

    const onResize = () => map.invalidateSize();
    window.addEventListener('resize', onResize);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      window.removeEventListener('resize', onResize);
    };
  }, [map]);

  return null;
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
  // Layer and API Key management state
  const [activeLayer, setActiveLayer] = useState<LayerMode>('dark');
  const [apiKey, setApiKey] = useState<string>('');
  const [customUrl, setCustomUrl] = useState<string>('');
  const [tempApiKey, setTempApiKey] = useState<string>('');
  const [tempCustomUrl, setTempCustomUrl] = useState<string>('');
  const [showConfigModal, setShowConfigModal] = useState<boolean>(false);
  const [savedSuccess, setSavedSuccess] = useState<boolean>(false);

  // Load saved preferences from localStorage on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const savedLayer = localStorage.getItem('ev_sense_map_layer') as LayerMode | null;
      if (savedLayer) setActiveLayer(savedLayer);

      const savedKey =
        localStorage.getItem('ev_sense_map_api_key') ||
        process.env.NEXT_PUBLIC_MAP_API_KEY ||
        '';
      setApiKey(savedKey);
      setTempApiKey(savedKey);

      const savedUrl =
        localStorage.getItem('ev_sense_map_tile_url') ||
        process.env.NEXT_PUBLIC_MAP_TILE_URL ||
        '';
      setCustomUrl(savedUrl);
      setTempCustomUrl(savedUrl);
    }
  }, []);

  const handleSelectLayer = (layer: LayerMode) => {
    setActiveLayer(layer);
    if (typeof window !== 'undefined') {
      localStorage.setItem('ev_sense_map_layer', layer);
    }
  };

  const handleSaveConfig = (e: React.FormEvent) => {
    e.preventDefault();
    setApiKey(tempApiKey.trim());
    setCustomUrl(tempCustomUrl.trim());
    if (typeof window !== 'undefined') {
      localStorage.setItem('ev_sense_map_api_key', tempApiKey.trim());
      localStorage.setItem('ev_sense_map_tile_url', tempCustomUrl.trim());
    }
    setSavedSuccess(true);
    setTimeout(() => {
      setSavedSuccess(false);
      setShowConfigModal(false);
    }, 1200);
  };

  const handleResetToFree = () => {
    setTempApiKey('');
    setTempCustomUrl('');
    setApiKey('');
    setCustomUrl('');
    setActiveLayer('dark');
    if (typeof window !== 'undefined') {
      localStorage.removeItem('ev_sense_map_api_key');
      localStorage.removeItem('ev_sense_map_tile_url');
      localStorage.setItem('ev_sense_map_layer', 'dark');
    }
    setShowConfigModal(false);
  };

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
  const primaryLat = primaryVehicle ? (primaryVehicle.lat ?? primaryVehicle.latitude) : undefined;
  const primaryLon = primaryVehicle ? (primaryVehicle.lon ?? primaryVehicle.longitude) : undefined;
  const initialCenter: [number, number] =
    primaryLat !== undefined && primaryLon !== undefined && !isNaN(primaryLat) && !isNaN(primaryLon)
      ? [primaryLat, primaryLon]
      : defaultCenter;

  const currentZoom = vehicles.length === 1 ? 15 : 13;

  // Compute active tile configuration based on selected layer and user settings
  const getTileConfig = () => {
    // If a custom URL is configured and active
    if (customUrl) {
      return {
        url: customUrl,
        attribution: '&copy; Custom Tile Service &copy; OpenStreetMap contributors',
        className: '',
        maxZoom: 19,
      };
    }

    switch (activeLayer) {
      case 'standard':
        return {
          url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
          className: '',
          maxZoom: 19,
        };

      case 'satellite':
        return {
          url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
          attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP',
          className: '',
          maxZoom: 18,
        };

      case 'navigation':
        return {
          url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
          attribution: 'Tiles &copy; Esri &mdash; Source: Esri, DeLorme, NAVTEQ, USGS, TomTom',
          className: '',
          maxZoom: 19,
        };

      case 'carto':
        return {
          url: apiKey
            ? `https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png?api_key=${apiKey}`
            : 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
          subdomains: ['a', 'b', 'c', 'd'],
          className: '',
          maxZoom: 19,
        };

      case 'dark':
      default:
        // Free OpenStreetMap with high-contrast CSS dark laboratory styling (No API Key Required, No Watermarks)
        return {
          url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors (Dark Mode)',
          className: 'map-tiles',
          maxZoom: 19,
        };
    }
  };

  const tileConfig = getTileConfig();

  return (
    <div className="h-full w-full min-h-[300px] rounded-xl overflow-hidden border border-border relative">
      {/* ── Top-Right Map Controls Toolbar ── */}
      <div className="absolute top-3 right-3 z-[1000] flex items-center gap-1.5 bg-surface/90 backdrop-blur-md p-1.5 rounded-lg border border-border/80 shadow-lg text-[11px]">
        <button
          type="button"
          onClick={() => handleSelectLayer('dark')}
          className={`px-2.5 py-1 rounded font-medium transition-all ${
            activeLayer === 'dark' && !customUrl
              ? 'bg-accent-blue text-white shadow-sm'
              : 'text-text-muted hover:text-text-primary hover:bg-surface-2'
          }`}
          title="100% Free OpenStreetMap with High-Contrast Dark Lab Filter (No API Key Required)"
        >
          🌙 Dark Lab
        </button>

        <button
          type="button"
          onClick={() => handleSelectLayer('standard')}
          className={`px-2.5 py-1 rounded font-medium transition-all ${
            activeLayer === 'standard' && !customUrl
              ? 'bg-accent-blue text-white shadow-sm'
              : 'text-text-muted hover:text-text-primary hover:bg-surface-2'
          }`}
          title="Free Detailed OpenStreetMap Standard Tiles"
        >
          🗺️ OSM
        </button>

        <button
          type="button"
          onClick={() => handleSelectLayer('satellite')}
          className={`px-2.5 py-1 rounded font-medium transition-all ${
            activeLayer === 'satellite' && !customUrl
              ? 'bg-accent-blue text-white shadow-sm'
              : 'text-text-muted hover:text-text-primary hover:bg-surface-2'
          }`}
          title="High-Resolution Esri Satellite Imagery"
        >
          🛰️ Satellite
        </button>

        <button
          type="button"
          onClick={() => handleSelectLayer('navigation')}
          className={`px-2.5 py-1 rounded font-medium transition-all ${
            activeLayer === 'navigation' && !customUrl
              ? 'bg-accent-blue text-white shadow-sm'
              : 'text-text-muted hover:text-text-primary hover:bg-surface-2'
          }`}
          title="Esri World Street Navigation Map"
        >
          🛣️ Street
        </button>

        <div className="w-[1px] h-4 bg-border/80 mx-0.5" />

        <button
          type="button"
          onClick={() => setShowConfigModal(true)}
          className={`flex items-center gap-1 px-2 py-1 rounded font-mono text-[10px] transition-all border ${
            apiKey || customUrl
              ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40'
              : 'bg-surface-2 text-text-muted hover:text-text-primary border-border/60'
          }`}
          title="Configure Map Tile API Key or Custom Tile URL"
        >
          <Key className="w-3 h-3" />
          <span>{apiKey ? 'API Key Active' : 'Map API'}</span>
        </button>
      </div>

      {/* ── Optional Map API Key Configuration Modal ── */}
      {showConfigModal && (
        <div className="absolute inset-0 z-[1100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-surface border border-border rounded-xl max-w-md w-full p-5 shadow-2xl flex flex-col gap-4 text-xs">
            <div className="flex items-center justify-between border-b border-border/60 pb-3">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-accent-blue/15 border border-accent-blue/30 flex items-center justify-center text-accent-blue">
                  <Key className="w-3.5 h-3.5" />
                </div>
                <div>
                  <h4 className="font-semibold text-text-primary">Map Tile API & Key Settings</h4>
                  <p className="text-[10px] text-text-muted">
                    Configure custom tile provider or CARTO API credentials
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowConfigModal(false)}
                className="text-text-muted hover:text-text-primary p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveConfig} className="flex flex-col gap-3">
              <div>
                <label className="block text-[11px] font-medium text-text-primary mb-1">
                  CARTO / Tile Provider API Key
                </label>
                <input
                  type="text"
                  value={tempApiKey}
                  onChange={(e) => setTempApiKey(e.target.value)}
                  placeholder="e.g. default_public or your carto key"
                  className="w-full px-3 py-2 bg-surface-2 border border-border rounded-lg text-text-primary font-mono text-xs focus:outline-none focus:border-accent-blue"
                />
                <span className="text-[10px] text-text-muted mt-1 block">
                  CARTO basemaps require an API key to remove watermark. Leave blank to use our 100% free OSM & Esri providers.
                </span>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-text-primary mb-1">
                  Custom Tile Layer URL Template (Optional)
                </label>
                <input
                  type="text"
                  value={tempCustomUrl}
                  onChange={(e) => setTempCustomUrl(e.target.value)}
                  placeholder="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  className="w-full px-3 py-2 bg-surface-2 border border-border rounded-lg text-text-primary font-mono text-xs focus:outline-none focus:border-accent-blue"
                />
                <span className="text-[10px] text-text-muted mt-1 block">
                  Supports standard XYZ tile URL patterns with &#123;z&#125;, &#123;x&#125;, &#123;y&#125; variables.
                </span>
              </div>

              {savedSuccess && (
                <div className="p-2 rounded bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-[11px] flex items-center gap-1.5">
                  <Check className="w-3.5 h-3.5" /> Map configuration saved successfully!
                </div>
              )}

              <div className="flex items-center justify-between pt-2 border-t border-border/60">
                <button
                  type="button"
                  onClick={handleResetToFree}
                  className="text-text-muted hover:text-accent-red flex items-center gap-1 text-[11px] transition-colors"
                >
                  <RotateCcw className="w-3 h-3" /> Reset to Free OSM
                </button>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowConfigModal(false)}
                    className="px-3 py-1.5 rounded-lg border border-border hover:bg-surface-2 text-text-muted hover:text-text-primary"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-1.5 rounded-lg bg-accent-blue text-white font-medium hover:bg-accent-blue/90 shadow-sm"
                  >
                    Apply & Save
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── React Leaflet Map Container ── */}
      <MapContainer
        center={initialCenter}
        zoom={currentZoom}
        style={{ height: '100%', width: '100%', minHeight: '280px' }}
        scrollWheelZoom={true}
      >
        {/* Dynamic Map Size Invalidator (prevents blank maps in hidden tabs) */}
        <MapResizer />

        {/* Dynamic Center Controller */}
        <MapController
          center={initialCenter}
          zoom={currentZoom}
          autoCenter={autoCenter}
        />

        {/* Dynamic Tile Layer with unique key to force remount on switch */}
        <TileLayer
          key={`${activeLayer}-${tileConfig.url}-${apiKey}-${customUrl}`}
          attribution={tileConfig.attribution}
          url={tileConfig.url}
          subdomains={tileConfig.subdomains ?? ['a', 'b', 'c']}
          maxZoom={tileConfig.maxZoom ?? 19}
          className={tileConfig.className}
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
