"""
vehicles.py
===========
Vehicle state, history, latest telemetry, and statistics endpoints.
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import func
from datetime import datetime
from typing import Optional, List

from database import get_db, Vehicle, TelemetrySnapshot

router = APIRouter(prefix="/api/vehicles", tags=["vehicles"])

ONLINE_THRESHOLD_SECONDS = 10


def _vehicle_to_dict(v: Vehicle) -> dict:
    """Convert a Vehicle ORM object to a JSON-serialisable dict."""
    now = datetime.utcnow()
    is_online = (
        v.last_seen is not None
        and (now - v.last_seen).total_seconds() < ONLINE_THRESHOLD_SECONDS
    )
    return {
        "id":                            v.id,
        "vehicle_id":                    v.id,
        "fleet_id":                      v.fleet_id,
        "device_id":                     v.device_id or f"ESP32-{v.id}",
        "vehicle_type":                  v.vehicle_type or "delivery_ev",
        "battery_capacity_kwh":          v.battery_capacity_kwh or 4.8,
        "status":                        v.status,
        "vehicle_status":                v.status,
        "soc":                           v.soc,
        "battery_soc":                   v.soc,
        "voltage":                       v.voltage,
        "battery_voltage":               v.voltage,
        "pack_temp":                     v.pack_temp,
        "battery_temperature":           v.pack_temp,
        "motor_temp":                    v.motor_temp,
        "motor_temperature":             v.motor_temp,
        "current":                       v.current,
        "battery_current":               v.current,
        "speed":                         v.speed,
        "lat":                           v.lat,
        "latitude":                      v.lat,
        "lon":                           v.lon,
        "longitude":                     v.lon,
        "heading":                       v.heading or 0.0,
        "energy_consumption_kwh_per_km": v.energy_consumption_kwh_per_km or 0.0,
        "charging":                      bool(v.charging),
        "odometer":                      v.odometer,
        "odometer_km":                   v.odometer,
        "scenario":                      v.scenario,
        "last_seen":                     v.last_seen.isoformat() if v.last_seen else None,
        "is_online":                     is_online,
        "online":                        is_online,
        "created_at":                    v.created_at.isoformat() if v.created_at else None,
    }


def _snapshot_to_dict(s: TelemetrySnapshot) -> dict:
    """Convert a TelemetrySnapshot ORM object to a JSON-serialisable dict."""
    return {
        "id":                 s.id,
        "vehicle_id":         s.vehicle_id,
        "fleet_id":           s.fleet_id,
        "device_id":          s.device_id,
        "timestamp":          s.timestamp.isoformat() if s.timestamp else None,
        "soc":                s.soc,
        "battery_soc":        s.soc,
        "voltage":            s.voltage,
        "battery_voltage":    s.voltage,
        "pack_temp":          s.pack_temp,
        "battery_temperature":s.pack_temp,
        "motor_temp":         s.motor_temp,
        "motor_temperature":  s.motor_temp,
        "current":            s.current,
        "battery_current":    s.current,
        "speed":              s.speed,
        "lat":                s.lat,
        "latitude":           s.lat,
        "lon":                s.lon,
        "longitude":          s.lon,
        "heading":            s.heading or 0.0,
        "energy_consumption": s.energy_consumption or 0.0,
        "energy_consumption_kwh_per_km": s.energy_consumption or 0.0,
        "charging":           bool(s.charging),
        "online":             bool(s.online),
        "status":             s.status,
        "scenario":           s.scenario,
    }


@router.get("/", summary="List all vehicles")
def list_vehicles(
    fleet_id: Optional[str] = Query(None, description="Filter by fleet ID"),
    db: Session = Depends(get_db),
) -> List[dict]:
    q = db.query(Vehicle)
    if fleet_id:
        q = q.filter(Vehicle.fleet_id == fleet_id)
    vehicles = q.order_by(Vehicle.id).all()
    return [_vehicle_to_dict(v) for v in vehicles]


@router.get("/{vehicle_id}", summary="Get a single vehicle")
def get_vehicle(vehicle_id: str, db: Session = Depends(get_db)) -> dict:
    vehicle = db.query(Vehicle).filter(Vehicle.id == vehicle_id).first()
    if not vehicle:
        raise HTTPException(status_code=404, detail=f"Vehicle '{vehicle_id}' not found")
    return _vehicle_to_dict(vehicle)


@router.get("/{vehicle_id}/history", summary="Get telemetry history for a vehicle")
def get_vehicle_history(
    vehicle_id: str,
    limit: int = Query(100, ge=1, le=1000, description="Maximum number of records to return"),
    db: Session = Depends(get_db),
) -> List[dict]:
    vehicle = db.query(Vehicle).filter(Vehicle.id == vehicle_id).first()
    if not vehicle:
        raise HTTPException(status_code=404, detail=f"Vehicle '{vehicle_id}' not found")

    snapshots = (
        db.query(TelemetrySnapshot)
        .filter(TelemetrySnapshot.vehicle_id == vehicle_id)
        .order_by(TelemetrySnapshot.timestamp.desc())
        .limit(limit)
        .all()
    )
    snapshots.reverse()
    return [_snapshot_to_dict(s) for s in snapshots]


@router.get("/{vehicle_id}/telemetry", summary="Get latest telemetry reading for a vehicle")
def get_latest_telemetry(vehicle_id: str, db: Session = Depends(get_db)) -> dict:
    snapshot = (
        db.query(TelemetrySnapshot)
        .filter(TelemetrySnapshot.vehicle_id == vehicle_id)
        .order_by(TelemetrySnapshot.timestamp.desc())
        .first()
    )
    if not snapshot:
        vehicle = db.query(Vehicle).filter(Vehicle.id == vehicle_id).first()
        if not vehicle:
            raise HTTPException(status_code=404, detail=f"Vehicle '{vehicle_id}' not found")
        return _vehicle_to_dict(vehicle)
    return _snapshot_to_dict(snapshot)


@router.get("/{vehicle_id}/stats", summary="Get aggregate telemetry statistics for a vehicle")
def get_vehicle_stats(vehicle_id: str, db: Session = Depends(get_db)) -> dict:
    vehicle = db.query(Vehicle).filter(Vehicle.id == vehicle_id).first()
    if not vehicle:
        raise HTTPException(status_code=404, detail=f"Vehicle '{vehicle_id}' not found")

    stats = (
        db.query(
            func.min(TelemetrySnapshot.voltage).label("min_voltage"),
            func.max(TelemetrySnapshot.voltage).label("max_voltage"),
            func.avg(TelemetrySnapshot.voltage).label("avg_voltage"),
            func.min(TelemetrySnapshot.pack_temp).label("min_pack_temp"),
            func.max(TelemetrySnapshot.pack_temp).label("max_pack_temp"),
            func.avg(TelemetrySnapshot.pack_temp).label("avg_pack_temp"),
            func.max(TelemetrySnapshot.motor_temp).label("max_motor_temp"),
            func.avg(TelemetrySnapshot.motor_temp).label("avg_motor_temp"),
            func.avg(TelemetrySnapshot.energy_consumption).label("avg_energy_consumption"),
            func.count(TelemetrySnapshot.id).label("total_snapshots"),
        )
        .filter(TelemetrySnapshot.vehicle_id == vehicle_id)
        .first()
    )

    return {
        "vehicle_id": vehicle_id,
        "total_records": stats.total_snapshots if stats else 0,
        "voltage": {
            "min": round(stats.min_voltage, 2) if stats and stats.min_voltage else None,
            "max": round(stats.max_voltage, 2) if stats and stats.max_voltage else None,
            "avg": round(stats.avg_voltage, 2) if stats and stats.avg_voltage else None,
        },
        "pack_temp": {
            "min": round(stats.min_pack_temp, 1) if stats and stats.min_pack_temp else None,
            "max": round(stats.max_pack_temp, 1) if stats and stats.max_pack_temp else None,
            "avg": round(stats.avg_pack_temp, 1) if stats and stats.avg_pack_temp else None,
        },
        "motor_temp": {
            "max": round(stats.max_motor_temp, 1) if stats and stats.max_motor_temp else None,
            "avg": round(stats.avg_motor_temp, 1) if stats and stats.avg_motor_temp else None,
        },
        "avg_energy_consumption_kwh_per_km": (
            round(stats.avg_energy_consumption, 3) if stats and stats.avg_energy_consumption else 0.0
        ),
        "odometer_km": round(vehicle.odometer, 2),
    }
