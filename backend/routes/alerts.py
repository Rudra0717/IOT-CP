"""
alerts.py
=========
Alert management endpoints: listing, filtering, acknowledging, and resolving alerts.
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from datetime import datetime
from typing import Optional, List

from database import get_db, Alert

router = APIRouter(prefix="/api/alerts", tags=["alerts"])


def _alert_to_dict(a: Alert) -> dict:
    """Convert an Alert ORM object to a JSON-serialisable dict."""
    return {
        "id":                 a.id,
        "vehicle_id":         a.vehicle_id,
        "fleet_id":           a.fleet_id,
        "device_id":          a.device_id,
        "alert_type":         a.alert_type,
        "rule":               a.rule,
        "message":            a.message,
        "value":              a.value,
        "threshold":          a.threshold,
        "recommended_action": a.recommended_action,
        "is_active":          a.is_active,
        "acknowledged":       a.acknowledged,
        "created_at":         a.created_at.isoformat() if a.created_at else None,
        "resolved_at":        a.resolved_at.isoformat() if a.resolved_at else None,
    }


@router.get("/", summary="List alerts with comprehensive filters")
def list_alerts(
    vehicle_id: Optional[str] = Query(None, description="Filter by vehicle ID"),
    severity: Optional[str] = Query(None, description="Filter by severity ('WARNING' or 'CRITICAL')"),
    anomaly_type: Optional[str] = Query(None, description="Filter by anomaly rule name"),
    status: Optional[str] = Query(None, description="Filter by status: 'active', 'acknowledged', 'resolved', 'all'"),
    is_active: Optional[bool] = Query(None, description="Filter by active boolean status"),
    start_time: Optional[datetime] = Query(None, description="Filter alerts after timestamp"),
    end_time: Optional[datetime] = Query(None, description="Filter alerts before timestamp"),
    limit: int = Query(200, ge=1, le=1000, description="Maximum number of records to return"),
    db: Session = Depends(get_db),
) -> List[dict]:
    """
    Return filtered alerts ordered by ``created_at`` descending (newest first).
    Supports filtering by vehicle, severity, anomaly rule, status, and time range.
    """
    q = db.query(Alert)

    if vehicle_id:
        q = q.filter(Alert.vehicle_id == vehicle_id)

    if severity:
        q = q.filter(Alert.alert_type == severity.upper())

    if anomaly_type:
        q = q.filter(Alert.rule == anomaly_type.upper())

    # Status filter
    if status:
        st = status.lower()
        if st == "active":
            q = q.filter(Alert.is_active == True)
        elif st == "acknowledged":
            q = q.filter(Alert.acknowledged == True)
        elif st == "resolved":
            q = q.filter(Alert.is_active == False)
    elif is_active is not None:
        q = q.filter(Alert.is_active == is_active)

    if start_time:
        q = q.filter(Alert.created_at >= start_time)
    if end_time:
        q = q.filter(Alert.created_at <= end_time)

    alerts = q.order_by(Alert.created_at.desc()).limit(limit).all()
    return [_alert_to_dict(a) for a in alerts]


@router.post("/{alert_id}/acknowledge", summary="Acknowledge an alert")
def acknowledge_alert(alert_id: int, db: Session = Depends(get_db)) -> dict:
    """Mark an alert as acknowledged."""
    alert: Optional[Alert] = db.query(Alert).filter(Alert.id == alert_id).first()
    if not alert:
        raise HTTPException(status_code=404, detail=f"Alert {alert_id} not found")

    alert.acknowledged = True
    db.commit()
    db.refresh(alert)
    return _alert_to_dict(alert)


@router.post("/{alert_id}/resolve", summary="Resolve an alert")
def resolve_alert(alert_id: int, db: Session = Depends(get_db)) -> dict:
    """Mark an alert as resolved (is_active=False, resolved_at=now)."""
    alert: Optional[Alert] = db.query(Alert).filter(Alert.id == alert_id).first()
    if not alert:
        raise HTTPException(status_code=404, detail=f"Alert {alert_id} not found")

    alert.is_active   = False
    alert.resolved_at = datetime.utcnow()
    db.commit()
    db.refresh(alert)
    return _alert_to_dict(alert)
