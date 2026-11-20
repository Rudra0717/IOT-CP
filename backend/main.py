"""
main.py
=======
FastAPI application entry point for the EV Fleet Telemetry Backend.
Wired with SQLite, MQTT ingestion, TelemetryProcessor, AnomalyEngine, and WebSocket streaming.
"""

import asyncio
import logging
import os
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from anomaly import AnomalyEngine
from database import SessionLocal, init_db
from telemetry_processor import TelemetryProcessor
from mqtt_client import MQTTIngestionClient
from routes import alerts, simulation, vehicles
from websocket_manager import manager

# ---------------------------------------------------------------------------
# Bootstrap
# ---------------------------------------------------------------------------

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("main")


# ---------------------------------------------------------------------------
# Application lifespan (startup / shutdown)
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    # ── Startup ────────────────────────────────────────────────────────────
    logger.info("Initialising database and running migrations …")
    init_db()

    loop = asyncio.get_event_loop()

    publish_interval = float(os.getenv("PUBLISH_INTERVAL", "3"))
    anomaly_engine = AnomalyEngine(interval=publish_interval)

    telemetry_processor = TelemetryProcessor(
        anomaly_engine=anomaly_engine,
        ws_manager=manager,
        db_session_factory=SessionLocal,
    )

    mqtt = MQTTIngestionClient(
        broker=os.getenv("MQTT_BROKER", "localhost"),
        port=int(os.getenv("MQTT_PORT", "1883")),
        telemetry_processor=telemetry_processor,
        loop=loop,
    )
    mqtt.start()

    app.state.anomaly_engine = anomaly_engine
    app.state.telemetry_processor = telemetry_processor

    # Background task: periodic heartbeat miss scanner with dynamic interval adaptation
    async def heartbeat_loop() -> None:
        while True:
            current_interval = getattr(anomaly_engine, "interval", publish_interval)
            await asyncio.sleep(max(2.0, current_interval))
            try:
                misses = anomaly_engine.check_heartbeats()
                for miss in misses:
                    logger.warning(
                        "Heartbeat miss detected: vehicle=%s elapsed=%ss",
                        miss.get("vehicle_id"), miss.get("value"),
                    )
                    await manager.broadcast("NEW_ALERT", miss)
            except Exception as exc:
                logger.error("Error in heartbeat check loop: %s", exc)

    heartbeat_task = asyncio.create_task(heartbeat_loop())
    logger.info("EV Fleet Backend 2.0 started successfully.")

    yield  # ── Application is running ────────────────────────────────────

    # ── Shutdown ───────────────────────────────────────────────────────────
    heartbeat_task.cancel()
    logger.info("Shutting down MQTT client …")
    mqtt.stop()
    logger.info("EV Fleet Backend stopped.")


# ---------------------------------------------------------------------------
# FastAPI application
# ---------------------------------------------------------------------------

app = FastAPI(
    title="EV Fleet Telemetry Backend",
    description="Real-time telemetry ingestion, schema validation, anomaly detection, and WebSocket streaming.",
    version="2.0.0",
    lifespan=lifespan,
)

# ── CORS ───────────────────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=True,
)

# ── Routers ─────────────────────────────────────────────────────────────────
app.include_router(vehicles.router)
app.include_router(alerts.router)
app.include_router(simulation.router)


# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------

@app.get("/api/health", tags=["health"], summary="Service health check")
def health() -> dict:
    return {"status": "ok", "service": "ev-fleet-backend", "version": "2.0.0"}


# ---------------------------------------------------------------------------
# WebSocket endpoint
# ---------------------------------------------------------------------------

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    """
    Real-time WebSocket streaming endpoint.

    Events:
    - ``VEHICLE_TELEMETRY`` – live vehicle telemetry payload
    - ``NEW_ALERT``         – newly triggered or updated active alert
    - ``ALERT_RESOLVED``    – auto-resolved alert
    - ``FLEET_UPDATE``      – aggregated fleet summary KPIs
    """
    await manager.connect(websocket)
    logger.info("New WebSocket client connected. Active: %d", manager.connection_count)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)
        logger.info("WebSocket disconnected. Active: %d", manager.connection_count)
    except Exception as exc:
        logger.error("WebSocket error: %s", exc)
        manager.disconnect(websocket)
