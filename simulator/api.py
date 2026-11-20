"""
api.py
======
FastAPI control plane server for the EV Fleet Simulator.
Exposes endpoints to scale the fleet, configure publish intervals,
inject driving/sensor scenarios, and control simulation lifecycle (start, pause, resume, stop).
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Optional, List
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

if TYPE_CHECKING:
    from simulator import FleetOrchestrator

logger = logging.getLogger("simulator.api")


# ---------------------------------------------------------------------------
# Request / Response schemas
# ---------------------------------------------------------------------------

class ScenarioRequest(BaseModel):
    vehicle_id: str = Field(
        ...,
        description='Vehicle ID to target, e.g. "EV-001", or "all" to target every vehicle.',
    )
    scenario: str = Field(
        ...,
        description=(
            "Scenario name. Valid values: normal, battery_overheat, motor_overheat, "
            "low_battery, energy_spike, sensor_offline, sensor_invalid, "
            "sensor_corrupted, sensor_delayed."
        ),
    )


class ScaleRequest(BaseModel):
    fleet_size: int = Field(
        ...,
        ge=1,
        le=500,
        description="Desired total number of vehicles in the fleet (1–500).",
    )


class IntervalRequest(BaseModel):
    interval: float = Field(
        ...,
        ge=0.5,
        le=60.0,
        description="New publish interval in seconds (0.5–60.0).",
    )


class UnifiedConfigRequest(BaseModel):
    fleet_size: Optional[int] = Field(None, ge=1, le=500)
    interval: Optional[float] = Field(None, ge=0.5, le=60.0)
    scenario: Optional[str] = None
    vehicle_id: Optional[str] = "all"
    vehicle_type: Optional[str] = None
    battery_capacity_kwh: Optional[float] = None
    action: Optional[str] = None  # "start" | "pause" | "resume" | "stop"


# ---------------------------------------------------------------------------
# App factory
# ---------------------------------------------------------------------------

def create_app(orchestrator: "FleetOrchestrator") -> FastAPI:
    app = FastAPI(
        title="EV Fleet Simulator — Control API",
        description="Real-time control plane for EV Fleet Telemetry & Simulation Platform.",
        version="2.0.0",
        docs_url="/docs",
        redoc_url="/redoc",
    )

    # ----------------------------------------------------------------
    # Simulation Lifecycle Endpoints
    # ----------------------------------------------------------------

    @app.post("/simulation/start", summary="Start simulation", tags=["Simulation"])
    async def sim_start() -> dict:
        state = orchestrator.start_sim()
        return {"ok": True, "state": state}

    @app.post("/simulation/pause", summary="Pause simulation", tags=["Simulation"])
    async def sim_pause() -> dict:
        state = orchestrator.pause_sim()
        return {"ok": True, "state": state}

    @app.post("/simulation/resume", summary="Resume simulation", tags=["Simulation"])
    async def sim_resume() -> dict:
        state = orchestrator.resume_sim()
        return {"ok": True, "state": state}

    @app.post("/simulation/stop", summary="Stop simulation", tags=["Simulation"])
    async def sim_stop() -> dict:
        state = orchestrator.stop_sim()
        return {"ok": True, "state": state}

    @app.get("/simulation/status", summary="Get simulation state & stats", tags=["Simulation"])
    async def get_simulation_status() -> dict:
        return {
            "state": orchestrator.state.value,
            "fleet_id": orchestrator.fleet_id,
            "fleet_size": len(orchestrator.vehicles),
            "publish_interval_s": orchestrator.publish_interval,
            "vehicles_count": len(orchestrator.vehicles),
        }

    # ----------------------------------------------------------------
    # GET /status
    # ----------------------------------------------------------------

    @app.get("/status", summary="Fleet status", tags=["Fleet"])
    async def get_status() -> dict:
        vehicles = [v.get_state_summary() for v in orchestrator.vehicles.values()]
        return {
            "state": orchestrator.state.value,
            "fleet_id": orchestrator.fleet_id,
            "fleet_size": len(vehicles),
            "publish_interval_s": orchestrator.publish_interval,
            "vehicles": vehicles,
        }

    # ----------------------------------------------------------------
    # POST /control/scenario
    # ----------------------------------------------------------------

    @app.post("/control/scenario", summary="Inject scenario", tags=["Control"])
    async def post_scenario(req: ScenarioRequest) -> dict:
        from scenarios import SCENARIOS

        if req.scenario not in SCENARIOS:
            raise HTTPException(
                status_code=422,
                detail=f"Unknown scenario '{req.scenario}'. Valid options: {list(SCENARIOS.keys())}",
            )

        targeted: list[str] = []

        if req.vehicle_id.lower() == "all":
            for v in orchestrator.vehicles.values():
                v.set_scenario(req.scenario)
                targeted.append(v.vehicle_id)
        else:
            vehicle = orchestrator.vehicles.get(req.vehicle_id)
            if vehicle is None:
                raise HTTPException(
                    status_code=404,
                    detail=f"Vehicle '{req.vehicle_id}' not found in fleet.",
                )
            vehicle.set_scenario(req.scenario)
            targeted.append(vehicle.vehicle_id)

        logger.info("Scenario '%s' injected into %d vehicle(s)", req.scenario, len(targeted))
        return {
            "ok": True,
            "scenario": req.scenario,
            "targeted_count": len(targeted),
            "targeted": targeted,
        }

    # ----------------------------------------------------------------
    # POST /control/scale
    # ----------------------------------------------------------------

    @app.post("/control/scale", summary="Scale fleet size", tags=["Control"])
    async def post_scale(req: ScaleRequest) -> dict:
        current_size = len(orchestrator.vehicles)
        await orchestrator.scale(req.fleet_size)
        new_size = len(orchestrator.vehicles)
        return {
            "ok": True,
            "previous_size": current_size,
            "new_size": new_size,
        }

    # ----------------------------------------------------------------
    # POST /control/interval
    # ----------------------------------------------------------------

    @app.post("/control/interval", summary="Change publish interval", tags=["Control"])
    async def post_interval(req: IntervalRequest) -> dict:
        old = orchestrator.publish_interval
        orchestrator.publish_interval = req.interval
        for dev in orchestrator.devices.values():
            dev.publish_interval = req.interval
            dev.vehicle.interval = req.interval
        return {
            "ok": True,
            "previous_interval_s": old,
            "new_interval_s": req.interval,
        }

    # ----------------------------------------------------------------
    # POST /configure (Unified Endpoint)
    # ----------------------------------------------------------------

    @app.post("/configure", summary="Unified configuration", tags=["Control"])
    async def post_configure(req: UnifiedConfigRequest) -> dict:
        from scenarios import SCENARIOS

        results: dict = {"ok": True, "state": orchestrator.state.value}

        # Lifecycle control action
        if req.action:
            act = req.action.lower()
            if act == "start":
                results["state"] = orchestrator.start_sim()
            elif act == "pause":
                results["state"] = orchestrator.pause_sim()
            elif act == "resume":
                results["state"] = orchestrator.resume_sim()
            elif act == "stop":
                results["state"] = orchestrator.stop_sim()

        # Fleet size scaling
        if req.fleet_size is not None:
            cur = len(orchestrator.vehicles)
            await orchestrator.scale(req.fleet_size)
            results["fleet_size"] = {"previous": cur, "new": len(orchestrator.vehicles)}

        # Publish interval
        if req.interval is not None:
            old_int = orchestrator.publish_interval
            orchestrator.publish_interval = req.interval
            for dev in orchestrator.devices.values():
                dev.publish_interval = req.interval
                dev.vehicle.interval = req.interval
            results["interval"] = {"previous": old_int, "new": req.interval}

        # Vehicle type & battery capacity customization
        if req.vehicle_type or req.battery_capacity_kwh:
            targets = (
                list(orchestrator.vehicles.values())
                if (not req.vehicle_id or req.vehicle_id.lower() == "all")
                else [orchestrator.vehicles.get(req.vehicle_id)]
            )
            for v in targets:
                if v:
                    if req.vehicle_type:
                        v.vehicle_type = req.vehicle_type
                    if req.battery_capacity_kwh:
                        v.battery_capacity_kwh = req.battery_capacity_kwh
                        v.battery_capacity_ah = (req.battery_capacity_kwh * 1000.0) / 48.0
            results["specs_updated"] = True

        # Scenario injection
        if req.scenario is not None:
            if req.scenario not in SCENARIOS:
                raise HTTPException(
                    status_code=422,
                    detail=f"Unknown scenario '{req.scenario}'. Valid: {list(SCENARIOS.keys())}",
                )
            targeted: list[str] = []
            vid = req.vehicle_id or "all"
            if vid.lower() == "all":
                for v in orchestrator.vehicles.values():
                    v.set_scenario(req.scenario)
                    targeted.append(v.vehicle_id)
            else:
                vehicle = orchestrator.vehicles.get(vid)
                if vehicle is None:
                    raise HTTPException(status_code=404, detail=f"Vehicle '{vid}' not found.")
                vehicle.set_scenario(req.scenario)
                targeted.append(vehicle.vehicle_id)
            results["scenario"] = {"name": req.scenario, "targeted": targeted}

        return results

    # ----------------------------------------------------------------
    # GET /health
    # ----------------------------------------------------------------

    @app.get("/health", include_in_schema=False)
    async def health() -> dict:
        return {
            "status": "ok",
            "state": orchestrator.state.value,
            "fleet_size": len(orchestrator.vehicles),
        }

    return app
