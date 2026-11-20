from fastapi import WebSocket
from typing import List
import json
import logging

logger = logging.getLogger(__name__)


class ConnectionManager:
    """
    Manages all active WebSocket connections and provides a broadcast helper.

    Usage
    -----
    - Call ``await manager.connect(websocket)`` in the WS endpoint handler.
    - Call ``manager.disconnect(websocket)`` on disconnect / error.
    - Call ``await manager.broadcast(event_type, data)`` from anywhere to push
      updates to all connected clients.

    Message format sent to clients::

        {"event": "<event_type>", "data": { ... }}
    """

    def __init__(self) -> None:
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket) -> None:
        """Accept the WebSocket handshake and register the connection."""
        await websocket.accept()
        self.active_connections.append(websocket)
        logger.info(
            "WebSocket connected. Total connections: %d",
            len(self.active_connections),
        )

    def disconnect(self, websocket: WebSocket) -> None:
        """Remove a WebSocket from the active pool (idempotent)."""
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
        logger.info(
            "WebSocket disconnected. Remaining connections: %d",
            len(self.active_connections),
        )

    async def broadcast(self, event_type: str, data: dict) -> None:
        """
        Serialize ``data`` and push it to every connected client.

        Dead connections (those that raise on ``send_text``) are silently
        removed from the pool after the broadcast loop completes.
        """
        message = json.dumps({"event": event_type, "data": data}, default=str)
        dead: List[WebSocket] = []

        for ws in list(self.active_connections):
            try:
                await ws.send_text(message)
            except Exception as exc:
                logger.debug("Broadcast failed for a connection: %s", exc)
                dead.append(ws)

        for ws in dead:
            self.disconnect(ws)

    async def send_personal(self, websocket: WebSocket, event_type: str, data: dict) -> None:
        """Send a message to a single specific WebSocket connection."""
        message = json.dumps({"event": event_type, "data": data}, default=str)
        try:
            await websocket.send_text(message)
        except Exception as exc:
            logger.debug("Personal send failed: %s", exc)
            self.disconnect(websocket)

    @property
    def connection_count(self) -> int:
        """Return the number of currently active WebSocket connections."""
        return len(self.active_connections)


# Singleton shared across the application
manager = ConnectionManager()
