"""
simulation.py
=============
Proxies simulation lifecycle, configuration, and status requests to the simulator service.
"""

import logging
from typing import Optional

import httpx
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

router = APIRouter(prefix="/api/simulation", tags=["simulation"])
logger = logging.getLogger(__name__)

SIMULATOR_URL = "http://simulator:8001"
HTTP_TIMEOUT  = 10.0  # seconds


class ConfigureRequest(BaseModel):
    fleet_size:           Optional[int]   = None
    interval:             Optional[float] = None
    scenario:             Optional[str]   = None
    vehicle_id:           Optional[str]   = "all"
    vehicle_type:         Optional[str]   = None
    battery_capacity_kwh: Optional[float] = None
    action:               Optional[str]   = None


async def _proxy_get(path: str) -> dict:
    url = f"{SIMULATOR_URL}{path}"
    try:
        async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            return resp.json()
    except httpx.ConnectError as exc:
        logger.error("Simulator unreachable at %s: %s", url, exc)
        raise HTTPException(
            status_code=503,
            detail="Simulator service is unavailable. Make sure the container is running.",
        )
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=exc.response.status_code, detail=exc.response.text)
    except Exception as exc:
        logger.error("Unexpected error proxying GET %s: %s", url, exc)
        raise HTTPException(status_code=500, detail=str(exc))


async def _proxy_post(path: str, body: Optional[dict] = None) -> dict:
    url = f"{SIMULATOR_URL}{path}"
    try:
        async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as client:
            resp = await client.post(url, json=body or {})
            resp.raise_for_status()
            return resp.json()
    except httpx.ConnectError as exc:
        logger.error("Simulator unreachable at %s: %s", url, exc)
        raise HTTPException(
            status_code=503,
            detail="Simulator service is unavailable. Make sure the container is running.",
        )
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=exc.response.status_code, detail=exc.response.text)
    except Exception as exc:
        logger.error("Unexpected error proxying POST %s: %s", url, exc)
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/configure", summary="Configure the EV fleet simulator")
async def configure_simulation(req: ConfigureRequest, request: Request) -> dict:
    body = {k: v for k, v in req.model_dump().items() if v is not None}
    res = await _proxy_post("/configure", body)

    # Synchronize backend heartbeat / communication anomaly detector interval
    if req.interval is not None and req.interval > 0:
        engine = getattr(request.app.state, "anomaly_engine", None)
        if engine:
            engine.set_interval(req.interval)
            logger.info("Synchronized backend AnomalyEngine heartbeat interval to %.1fs", req.interval)

    # Immediately synchronize scenario in database and broadcast to UI clients
    if req.scenario is not None:
        try:
            from database import SessionLocal, Vehicle
            from websocket_manager import manager
            db = SessionLocal()
            try:
                vid = req.vehicle_id or "all"
                if vid.lower() == "all":
                    db.query(Vehicle).update({Vehicle.scenario: req.scenario})
                    vehicles = db.query(Vehicle).all()
                    for v in vehicles:
                        await manager.broadcast("VEHICLE_TELEMETRY", {
                            "vehicle_id": v.id,
                            "id": v.id,
                            "scenario": req.scenario,
                        })
                else:
                    veh = db.query(Vehicle).filter(Vehicle.id == vid).first()
                    if veh:
                        veh.scenario = req.scenario
                        await manager.broadcast("VEHICLE_TELEMETRY", {
                            "vehicle_id": veh.id,
                            "id": veh.id,
                            "scenario": req.scenario,
                        })
                db.commit()
            finally:
                db.close()
        except Exception as e:
            logger.warning("Could not immediately update vehicle scenario in DB: %s", e)

    return res


@router.get("/status", summary="Get simulator status")
async def get_simulation_status() -> dict:
    return await _proxy_get("/simulation/status")


@router.post("/start", summary="Start simulation")
async def start_simulation() -> dict:
    return await _proxy_post("/simulation/start")


@router.post("/pause", summary="Pause simulation")
async def pause_simulation() -> dict:
    return await _proxy_post("/simulation/pause")


@router.post("/resume", summary="Resume simulation")
async def resume_simulation() -> dict:
    return await _proxy_post("/simulation/resume")


@router.post("/stop", summary="Stop simulation")
async def stop_simulation() -> dict:
    return await _proxy_post("/simulation/stop")


@router.get("/config", summary="Get current simulation configuration")
async def get_simulation_config() -> dict:
    status = await _proxy_get("/simulation/status")
    return {
        "fleet_size": status.get("fleet_size"),
        "publish_interval": status.get("publish_interval_s"),
        "state": status.get("state"),
        "fleet_id": status.get("fleet_id"),
    }
