# EV Sense — EV Fleet Telemetry & Simulation Platform

> Real-time IoT telemetry ingestion, sensor emulation, time-series storage, anomaly detection, and interactive operations dashboard for electric vehicle fleets. Powered by MQTT, FastAPI, SQLite, and Next.js 14, fully containerised with Docker Compose.

---

## Architecture Overview

**EV Sense** is designed as a modular, layered IoT telemetry architecture:

```
[Virtual EV Physics] ──► [Virtual Sensors] ──► [Virtual ESP32 Edge Node]
                                                        │ (MQTT QoS 1)
                                                        ▼
                                              [Eclipse Mosquitto Broker]
                                                        │
                                                        ▼
                                              [Telemetry Processor]
                                             ┌──────────┴──────────┐
                                             ▼                     ▼
                                    [Data Validation]     [Time-Series SQLite]
                                             │
                                             ▼
                                    [Anomaly Engine]
                              (Thresholds, Patterns, Comm)
                                             │
                                             ▼
                                   [Stateful Alert Cache]
                              (Deduplication & Auto-Resolution)
                                             │
                                             ▼
                                [WebSocket & REST Layer]
                                             │
                                             ▼
                              [Next.js 14 Dark Dashboard]
```

### Layer Breakdown

1. **Virtual EV Physics Layer (`simulator/vehicle.py`):**
   - Emulates commercial delivery EVs (`vehicle_type: delivery_ev`, 4.8 kWh 48V battery pack).
   - Computes realistic physics: circular city routes in New Delhi with waypoint interpolation, dynamic heading ($0^\circ - 360^\circ$), velocity, acceleration, battery internal resistance voltage sag ($V = 48.0 - (1 - \text{SoC}/100) \times 4.0$), and electrical energy consumption ($\text{kWh/km}$).
   - Finite State Machine: `IDLE`, `DRIVING`, `CHARGING`, and `FAULT`.

2. **Virtual Sensor Layer (`simulator/sensors.py`):**
   - Independent physical sensor emulators: `BatterySoCSensor`, `BatteryVoltageSensor`, `BatteryTempSensor`, `MotorTempSensor`, `GPSSensor`, `SpeedSensor`, and `CurrentEnergySensor`.
   - Injects realistic analog noise, calibration offsets, and fault injection hooks.

3. **Virtual ESP32 Edge Emulator (`simulator/virtual_esp32.py`):**
   - Models edge microcontroller nodes (`ESP32-EV-xxx`).
   - Polls virtual sensors, formats canonical JSON telemetry payloads, and implements network pacing, transient dropout, and sensor corruptions.

4. **MQTT Transport (`mosquitto`):**
   - Eclipse Mosquitto 2.x broker providing MQTT (TCP port `1883`) and WebSockets (port `9001`).
   - Publishes to `fleet/{fleet_id}/ev/{vehicle_id}/telemetry` and subscribes to `fleet/{fleet_id}/ev/{vehicle_id}/control`.

5. **Telemetry Processing & Validation (`backend/validation.py` & `backend/telemetry_processor.py`):**
   - Decoupled ingestion pipeline. Validates data types, ISO-8601 UTC timestamps, freshness ($> 60\text{s}$ lag detection), and physical bounds.
   - Non-crashing validation issues (`INVALID_SENSOR_VALUE`, `CORRUPTED_SENSOR_VALUE`, `STALE_TELEMETRY`) are flagged and passed to the anomaly engine.

6. **Time-Series SQLite Storage (`backend/database.py`):**
   - Stores current vehicle states in `vehicles` table and historical time-series entries in `telemetry_snapshots` with composite indexes (`idx_vehicle_ts`, `idx_fleet_ts`, `idx_device_ts`).
   - Automatic non-destructive column migrations without data loss.

7. **Modular Anomaly Engine (`backend/anomaly/`):**
   - **Thresholds:** Low SoC ($<15\%$ Warning, $<5\%$ Critical), Pack Overheat ($>45^\circ\text{C}$ Warning, $>55^\circ\text{C}$ Critical), Motor Overheat ($>75^\circ\text{C}$ Warning, $>85^\circ\text{C}$ Critical), Voltage Sag ($<44\text{V}$ under load), Abnormal Energy ($>0.45$ Warning, $>1.0\text{ kWh/km}$ Critical).
   - **Temporal Patterns:** Rapid pack temperature rise ($+4^\circ\text{C}$ in sliding window), sudden voltage drop ($-3\text{V}$ from moving avg), erratic GPS jumps.
   - **Communication Health:** Missed heartbeat detection ($\Delta t > 2 \times \text{interval}$).
   - **Stateful Deduplication & Auto-Resolution:** Ongoing anomalies update active alert records rather than flooding duplicates; alerts auto-resolve when telemetry conditions normalize.

8. **Real-Time Next.js Dashboard (`frontend/`):**
   - Next.js 14 (App Router) + Tailwind CSS (dark theme) + React-Leaflet + Recharts.
   - Live KPI cards, dark Leaflet map, sortable/filterable vehicle table, vehicle telemetry charts drawer, Alert Center with action pills, and Fleet Configuration modal with simulation lifecycle controls.

---

## Services & Ports

| Service | Technology | Internal Port | Host Port | Health Check |
|---|---|---|---|---|
| `mosquitto` | Eclipse Mosquitto 2.x | `1883`, `9001` | `1883`, `9001` | TCP port probe |
| `simulator` | Python 3.11 + Paho-MQTT + FastAPI | `8001` | `8001` | `GET http://localhost:8001/health` |
| `backend` | Python 3.11 + FastAPI + SQLAlchemy | `8000` | `8000` | `GET http://localhost:8000/api/health` |
| `frontend` | Node.js 20 + Next.js 14 | `3000` | `3000` | HTTP 200 on port 3000 |

---

## Quick Start

### 1. Prerequisites
- **Docker Desktop** (version 24.0+) with Docker Compose v2.
- In PowerShell on Windows, ensure Docker is available in your PATH:
  ```powershell
  $env:PATH = "$env:LOCALAPPDATA\Programs\DockerDesktop\resources\bin;$env:PATH"
  ```

### 2. Start the Complete Stack
From the project root directory:

```bash
docker compose up -d
```
*(or run `.\start.ps1` in PowerShell / `start.bat` in CMD)*

When executed, the project automatically displays the live service status table:

```
=======================================================================================================================================
Service                          Endpoint                               Status           Description
---------------------------------------------------------------------------------------------------------------------------------------
Frontend Web Laboratory          http://localhost:3000                  HTTP 200 OK      Virtual EV Fleet Grid & Interactive Deep Inspector
FastAPI Backend                  http://localhost:8000/api/health       HTTP 200 OK      Telemetry processing, SQLite DB, Anomaly engine
Interactive API Docs (Swagger)   http://localhost:8000/docs             HTTP 200 OK      Full API exploration & testing
Simulator Control API            http://localhost:8001/status           HTTP 200 OK      Edge telemetry orchestrator & physics engine
MQTT Broker (Mosquitto)          localhost:1883 / ws:9001               Healthy          Real-time IoT message broker
=======================================================================================================================================
```

### 3. Check Service Health
```bash
docker compose ps
```

### 4. View Container Logs
```bash
docker compose logs -f backend
docker compose logs -f simulator
```

### 5. Stop the Platform
```bash
docker compose down
```

---

## Scenario Injection & Simulation Controls

The platform supports runtime fault injection and simulation lifecycle management via the dashboard or REST APIs:

### Fault Scenarios

| Scenario Name | Description | Injected Behavior | Detected Anomalies |
|---|---|---|---|
| `normal` | Standard delivery driving | Normal physics & sensor noise | None (auto-resolves active faults) |
| `battery_overheat` | Thermal runaway simulation | Pack temperature spikes $55^\circ - 70^\circ\text{C}$ | `PACK_OVERHEAT`, `RAPID_TEMP_RISE` |
| `motor_overheat` | Traction motor overload | Motor temperature spikes $90^\circ - 110^\circ\text{C}$ | `MOTOR_OVERHEAT` |
| `low_battery` | Sudden battery exhaustion | SoC drains rapidly to $3\% - 12\%$ | `LOW_SOC` |
| `energy_spike` | Contactor / Inverter surge | Current spike + severe voltage sag | `VOLTAGE_SAG`, `ABNORMAL_ENERGY_CONSUMPTION` |
| `sensor_offline` | Edge node communication loss | ESP32 drops MQTT telemetry transmission | `HEARTBEAT_MISS` (after $2\times$ interval) |
| `sensor_invalid` | Out-of-bounds analog sensor | Emits out-of-range sensor values (e.g. SoC 145%) | `INVALID_SENSOR_VALUE` |
| `sensor_corrupted` | Frame serialization corruption | Corrupts data types with non-numeric strings | `CORRUPTED_SENSOR_VALUE` |
| `sensor_delayed` | High network transmission lag | Telemetry timestamps lagged by $>60\text{s}$ | `STALE_TELEMETRY` |

---

## REST API Reference

### Simulation Lifecycle & Configuration (`/api/simulation`)

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/simulation/status` | Current engine state (`RUNNING`, `PAUSED`, `STOPPED`), fleet size, and interval |
| `POST` | `/api/simulation/start` | Start or restart simulation engine |
| `POST` | `/api/simulation/pause` | Pause vehicle state updates and telemetry publishing |
| `POST` | `/api/simulation/resume` | Resume simulation from paused state |
| `POST` | `/api/simulation/stop` | Stop all virtual vehicle tasks |
| `POST` | `/api/simulation/configure` | Unified configuration: scale fleet size (10–100), change interval (1–30s), or inject fault scenario |

#### Example: Inject a Fault Scenario via cURL
```bash
curl -X POST http://localhost:8000/api/simulation/configure \
  -H "Content-Type: application/json" \
  -d '{"vehicle_id": "EV-001", "scenario": "battery_overheat"}'
```

#### Example: Scale Fleet to 25 Vehicles
```bash
curl -X POST http://localhost:8000/api/simulation/configure \
  -H "Content-Type: application/json" \
  -d '{"fleet_size": 25}'
```

### Vehicles & Telemetry (`/api/vehicles`)

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/vehicles/` | List all vehicles with live status, battery, speed, and GPS |
| `GET` | `/api/vehicles/{id}` | Detailed telemetry and specification for a single vehicle |
| `GET` | `/api/vehicles/{id}/history` | Time-series telemetry snapshots (`?limit=100`) |
| `GET` | `/api/vehicles/{id}/stats` | Aggregate stats: min/max/avg voltage, temperatures, and energy |

### Alert Center (`/api/alerts`)

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/alerts/` | List alerts with filters: `is_active`, `vehicle_id`, `rule`, `severity` |
| `POST` | `/api/alerts/{id}/acknowledge` | Acknowledge active alert |
| `POST` | `/api/alerts/{id}/resolve` | Manually resolve active alert |

### WebSocket Endpoint (`/ws`)

Connect to `ws://localhost:8000/ws` to receive live streaming JSON events:
- `VEHICLE_TELEMETRY` — Canonical telemetry payload for each vehicle tick.
- `NEW_ALERT` — Newly triggered or updated active anomaly alert.
- `ALERT_RESOLVED` — Auto-resolved or operator-resolved alert event.
- `FLEET_UPDATE` — Aggregated fleet health KPIs (online, charging, driving, warnings, criticals).

---

## Canonical Telemetry JSON Schema

```json
{
  "vehicle_id": "EV-001",
  "fleet_id": "fleet_001",
  "device_id": "ESP32-EV-001",
  "vehicle_type": "delivery_ev",
  "battery_capacity_kwh": 4.8,
  "timestamp": "2026-09-28T07:03:39.586627Z",
  "battery_soc": 98.46,
  "battery_voltage": 47.94,
  "battery_current": 32.59,
  "battery_temperature": 58.35,
  "motor_temperature": 88.77,
  "latitude": 28.631516,
  "longitude": 77.197010,
  "speed": 41.17,
  "heading": 145.8,
  "energy_consumption_kwh_per_km": 0.050,
  "odometer_km": 3995.38,
  "charging": false,
  "online": true,
  "vehicle_status": "DRIVING",
  "scenario": "normal"
}
```

---

## Automated Tests

Unit tests are included for both simulator and backend services:

### 1. Run Simulator Unit Tests
```bash
python -m unittest simulator/tests/test_simulator.py
```
*Tests VirtualEV physics, heading calculations, fault state transitions, virtual sensors, and VirtualESP32 telemetry generation.*

### 2. Run Backend Unit Tests
```bash
python -m unittest backend/tests/test_backend.py
```
*Tests schema validation, corrupted/invalid sensor handling, stale detection, threshold anomalies, temporal pattern evaluation, heartbeat tracking, alert deduplication, and database persistence.*

### 3. Verify Frontend Production Build
```bash
cd frontend
npm run build
```