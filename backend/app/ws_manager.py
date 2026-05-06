from __future__ import annotations

import asyncio
from collections import defaultdict

from fastapi import WebSocket


class WebSocketManager:
    def __init__(self) -> None:
        self._connections: dict[str, set[WebSocket]] = defaultdict(set)
        self._lock = asyncio.Lock()

    async def connect(self, room_id: str, websocket: WebSocket) -> None:
        await websocket.accept()
        async with self._lock:
            self._connections[room_id].add(websocket)

    async def disconnect(self, room_id: str, websocket: WebSocket) -> None:
        async with self._lock:
            if room_id in self._connections:
                self._connections[room_id].discard(websocket)
                if not self._connections[room_id]:
                    self._connections.pop(room_id, None)

    async def broadcast(self, room_id: str, payload: dict) -> None:
        async with self._lock:
            sockets = list(self._connections.get(room_id, set()))
        if not sockets:
            return
        to_remove = []
        for socket in sockets:
            try:
                await socket.send_json(payload)
            except Exception:
                to_remove.append(socket)
        if to_remove:
            async with self._lock:
                for socket in to_remove:
                    self._connections.get(room_id, set()).discard(socket)
