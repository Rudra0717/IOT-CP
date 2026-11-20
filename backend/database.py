"""
database.py
===========
SQLAlchemy ORM models, session management, and time-series storage for EV SENSE.
"""

import os
import json
import logging
from datetime import datetime
from typing import Optional, Any

from sqlalchemy import (
    create_engine, Column, String, Float, Integer,
    DateTime, Boolean, Text, ForeignKey, Index, text
)
from sqlalchemy.orm import declarative_base, sessionmaker, Session

logger = logging.getLogger(__name__)

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:////app/data/fleet.db")

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False},
    pool_pre_ping=True,
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


# ---------------------------------------------------------------------------
# ORM Models
# ---------------------------------------------------------------------------

class Vehicle(Base):
    """Represents current live state of an Electric Vehicle."""
    __tablename__ = "vehicles"

    id                            = Column(String, primary_key=True, index=True)
    fleet_id                      = Column(String, index=True, nullable=True)
    device_id                     = Column(String, index=True, nullable=True)
    vehicle_type                  = Column(String, default="delivery_ev")
    battery_capacity_kwh          = Column(Float, default=4.8)
    status                        = Column(String, default="IDLE")
    soc                           = Column(Float, nullable=True)
    voltage                       = Column(Float, nullable=True)
    pack_temp                     = Column(Float, nullable=True)
    motor_temp                    = Column(Float, nullable=True)
    current                       = Column(Float, nullable=True)
    speed                         = Column(Float, nullable=True)
    lat                           = Column(Float, nullable=True)
    lon                           = Column(Float, nullable=True)
    heading                       = Column(Float, default=0.0)
    energy_consumption_kwh_per_km = Column(Float, default=0.0)
    charging                      = Column(Boolean, default=False)
    odometer                      = Column(Float, default=0.0)
    scenario                      = Column(String, default="normal")
    last_seen                     = Column(DateTime, nullable=True)
    is_online                     = Column(Boolean, default=True)
    created_at                    = Column(DateTime, default=datetime.utcnow)


class TelemetrySnapshot(Base):
    """Historical time-series telemetry records."""
    __tablename__ = "telemetry_snapshots"

    id                 = Column(Integer, primary_key=True, autoincrement=True)
    vehicle_id         = Column(String, ForeignKey("vehicles.id"), index=True)
    fleet_id           = Column(String, index=True, nullable=True)
    device_id          = Column(String, index=True, nullable=True)
    timestamp          = Column(DateTime, default=datetime.utcnow, index=True)
    soc                = Column(Float, nullable=True)
    voltage            = Column(Float, nullable=True)
    pack_temp          = Column(Float, nullable=True)
    motor_temp         = Column(Float, nullable=True)
    current            = Column(Float, nullable=True)
    speed              = Column(Float, nullable=True)
    lat                = Column(Float, nullable=True)
    lon                = Column(Float, nullable=True)
    heading            = Column(Float, default=0.0)
    energy_consumption = Column(Float, default=0.0)
    charging           = Column(Boolean, default=False)
    online             = Column(Boolean, default=True)
    status             = Column(String, nullable=True)
    scenario           = Column(String, nullable=True)
    raw_payload        = Column(Text, nullable=True)

    __table_args__ = (
        Index("idx_vehicle_ts", "vehicle_id", "timestamp"),
        Index("idx_fleet_ts", "fleet_id", "timestamp"),
        Index("idx_device_ts", "device_id", "timestamp"),
    )


class Alert(Base):
    """Persistent anomaly alerts with lifecycle tracking."""
    __tablename__ = "alerts"

    id                 = Column(Integer, primary_key=True, autoincrement=True)
    vehicle_id         = Column(String, index=True)
    fleet_id           = Column(String, nullable=True)
    device_id          = Column(String, nullable=True)
    alert_type         = Column(String)  # 'WARNING' | 'CRITICAL'
    rule               = Column(String)  # Anomaly type / rule name
    message            = Column(String)
    value              = Column(Float, nullable=True)
    threshold          = Column(Float, nullable=True)
    recommended_action = Column(String, nullable=True)
    is_active          = Column(Boolean, default=True)
    acknowledged       = Column(Boolean, default=False)
    created_at         = Column(DateTime, default=datetime.utcnow, index=True)
    resolved_at        = Column(DateTime, nullable=True)

    __table_args__ = (
        Index("idx_alert_active_vehicle", "vehicle_id", "is_active", "rule"),
    )


# ---------------------------------------------------------------------------
# Non-destructive SQLite Migration Helper
# ---------------------------------------------------------------------------

def _run_sqlite_column_migrations() -> None:
    """Ensure newly introduced columns exist in SQLite without altering existing tables destructively."""
    with engine.connect() as conn:
        def get_existing_columns(table_name: str) -> set[str]:
            res = conn.execute(text(f"PRAGMA table_info({table_name})")).fetchall()
            return {row[1] for row in res}

        # Check vehicles table
        try:
            veh_cols = get_existing_columns("vehicles")
            new_veh_cols = {
                "device_id": "VARCHAR",
                "vehicle_type": "VARCHAR DEFAULT 'delivery_ev'",
                "battery_capacity_kwh": "FLOAT DEFAULT 4.8",
                "heading": "FLOAT DEFAULT 0.0",
                "energy_consumption_kwh_per_km": "FLOAT DEFAULT 0.0",
                "charging": "BOOLEAN DEFAULT 0",
            }
            for col_name, col_type in new_veh_cols.items():
                if col_name not in veh_cols:
                    conn.execute(text(f"ALTER TABLE vehicles ADD COLUMN {col_name} {col_type}"))
                    logger.info("Migrated table 'vehicles' -> added column '%s'", col_name)

            # Check telemetry_snapshots table
            snap_cols = get_existing_columns("telemetry_snapshots")
            new_snap_cols = {
                "device_id": "VARCHAR",
                "heading": "FLOAT DEFAULT 0.0",
                "energy_consumption": "FLOAT DEFAULT 0.0",
                "charging": "BOOLEAN DEFAULT 0",
                "online": "BOOLEAN DEFAULT 1",
                "scenario": "VARCHAR",
            }
            for col_name, col_type in new_snap_cols.items():
                if col_name not in snap_cols:
                    conn.execute(text(f"ALTER TABLE telemetry_snapshots ADD COLUMN {col_name} {col_type}"))
                    logger.info("Migrated table 'telemetry_snapshots' -> added column '%s'", col_name)

            # Check alerts table
            alert_cols = get_existing_columns("alerts")
            new_alert_cols = {
                "device_id": "VARCHAR",
                "recommended_action": "VARCHAR",
            }
            for col_name, col_type in new_alert_cols.items():
                if col_name not in alert_cols:
                    conn.execute(text(f"ALTER TABLE alerts ADD COLUMN {col_name} {col_type}"))
                    logger.info("Migrated table 'alerts' -> added column '%s'", col_name)

            conn.commit()
        except Exception as exc:
            logger.warning("Column migration check encountered: %s", exc)


def init_db() -> None:
    """Create all tables, run safe column migrations, and archive legacy alerts."""
    Base.metadata.create_all(bind=engine)
    if "sqlite" in DATABASE_URL:
        _run_sqlite_column_migrations()
        try:
            with engine.connect() as conn:
                conn.execute(
                    text("UPDATE alerts SET is_active = 0, resolved_at = CURRENT_TIMESTAMP WHERE is_active = 1 AND created_at < datetime('now', '-15 minutes')")
                )
                conn.commit()
                logger.info("Archived stale legacy alerts in database.")
        except Exception as exc:
            logger.warning("Could not archive stale active alerts: %s", exc)


def get_db():
    """FastAPI dependency yielding a DB session."""
    db: Session = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def upsert_vehicle(db: Session, payload: dict[str, Any]) -> Vehicle:
    """Insert or update Vehicle current state record from normalized payload."""
    vehicle_id = payload.get("vehicle_id") or payload.get("id")
    if not vehicle_id:
        raise ValueError("payload must contain 'vehicle_id'")

    vehicle: Optional[Vehicle] = db.query(Vehicle).filter(Vehicle.id == vehicle_id).first()

    if vehicle is None:
        vehicle = Vehicle(id=vehicle_id, created_at=datetime.utcnow())
        db.add(vehicle)

    # Set all updated fields
    vehicle.fleet_id = payload.get("fleet_id", vehicle.fleet_id)
    vehicle.device_id = payload.get("device_id") or f"ESP32-{vehicle_id}"
    if payload.get("vehicle_type"):
        vehicle.vehicle_type = payload["vehicle_type"]
    if payload.get("battery_capacity_kwh"):
        vehicle.battery_capacity_kwh = payload["battery_capacity_kwh"]

    vehicle.status = payload.get("status") or payload.get("vehicle_status") or vehicle.status
    if payload.get("battery_soc") is not None:
        vehicle.soc = payload["battery_soc"]
    elif payload.get("soc") is not None:
        vehicle.soc = payload["soc"]

    if payload.get("battery_voltage") is not None:
        vehicle.voltage = payload["battery_voltage"]
    elif payload.get("voltage") is not None:
        vehicle.voltage = payload["voltage"]

    if payload.get("battery_temperature") is not None:
        vehicle.pack_temp = payload["battery_temperature"]
    elif payload.get("pack_temp") is not None:
        vehicle.pack_temp = payload["pack_temp"]

    if payload.get("motor_temperature") is not None:
        vehicle.motor_temp = payload["motor_temperature"]
    elif payload.get("motor_temp") is not None:
        vehicle.motor_temp = payload["motor_temp"]

    if payload.get("battery_current") is not None:
        vehicle.current = payload["battery_current"]
    elif payload.get("current") is not None:
        vehicle.current = payload["current"]

    if payload.get("speed") is not None:
        vehicle.speed = payload["speed"]
    if payload.get("latitude") is not None:
        vehicle.lat = payload["latitude"]
    elif payload.get("lat") is not None:
        vehicle.lat = payload["lat"]

    if payload.get("longitude") is not None:
        vehicle.lon = payload["longitude"]
    elif payload.get("lon") is not None:
        vehicle.lon = payload["lon"]

    if payload.get("heading") is not None:
        vehicle.heading = payload["heading"]
    if payload.get("energy_consumption_kwh_per_km") is not None:
        vehicle.energy_consumption_kwh_per_km = payload["energy_consumption_kwh_per_km"]

    vehicle.charging = bool(payload.get("charging", vehicle.status == "CHARGING"))
    if payload.get("odometer_km") is not None:
        vehicle.odometer = payload["odometer_km"]
    elif payload.get("odometer") is not None:
        vehicle.odometer = payload["odometer"]

    if payload.get("scenario"):
        vehicle.scenario = payload["scenario"]

    vehicle.last_seen = payload.get("_dt") or datetime.utcnow()
    vehicle.is_online = bool(payload.get("online", True))

    db.commit()
    db.refresh(vehicle)
    return vehicle


def insert_snapshot(db: Session, payload: dict[str, Any]) -> TelemetrySnapshot:
    """Insert an immutable historical time-series snapshot record."""
    vehicle_id = payload.get("vehicle_id") or payload.get("id")

    # Safe JSON serialization of payload without internal datetime objects
    safe_copy = {k: v for k, v in payload.items() if not k.startswith("_")}

    ts = payload.get("_dt") or datetime.utcnow()

    snapshot = TelemetrySnapshot(
        vehicle_id=vehicle_id,
        fleet_id=payload.get("fleet_id"),
        device_id=payload.get("device_id") or f"ESP32-{vehicle_id}",
        timestamp=ts,
        soc=payload.get("battery_soc") if payload.get("battery_soc") is not None else payload.get("soc"),
        voltage=payload.get("battery_voltage") if payload.get("battery_voltage") is not None else payload.get("voltage"),
        pack_temp=payload.get("battery_temperature") if payload.get("battery_temperature") is not None else payload.get("pack_temp"),
        motor_temp=payload.get("motor_temperature") if payload.get("motor_temperature") is not None else payload.get("motor_temp"),
        current=payload.get("battery_current") if payload.get("battery_current") is not None else payload.get("current"),
        speed=payload.get("speed"),
        lat=payload.get("latitude") if payload.get("latitude") is not None else payload.get("lat"),
        lon=payload.get("longitude") if payload.get("longitude") is not None else payload.get("lon"),
        heading=payload.get("heading", 0.0),
        energy_consumption=payload.get("energy_consumption_kwh_per_km", 0.0),
        charging=bool(payload.get("charging", False)),
        online=bool(payload.get("online", True)),
        status=payload.get("vehicle_status") or payload.get("status"),
        scenario=payload.get("scenario"),
        raw_payload=json.dumps(safe_copy),
    )
    db.add(snapshot)
    db.commit()
    db.refresh(snapshot)
    return snapshot
