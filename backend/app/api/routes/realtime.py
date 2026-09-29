"""WebSocket-обновления: билет и соединение (§38)."""
from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter, Depends, Query, WebSocket, WebSocketDisconnect

from app.api.deps import get_current_user
from app.realtime.hub import hub

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/realtime", tags=["Realtime"])


@router.post(
    "/ticket",
    summary="Билет для подключения к сокету (§38)",
)
def create_ticket(user=Depends(get_current_user)) -> dict:
    """Выдаёт одноразовый короткоживущий билет для WebSocket."""
    token = hub.issue_ticket(user.as_dict())
    return {"ticket": token, "expires_in": 30}


@router.websocket("/ws")
async def realtime_ws(
    websocket: WebSocket,
    ticket: str = Query(..., description="Билет из POST /realtime/ticket"),
    since: int = Query(0, ge=0, description="Последний полученный seq"),
) -> None:
    """Сокет событий. Билет одноразовый; токен в адресе не передаём."""
    user = hub.consume_ticket(ticket)
    if user is None:
        await websocket.close(code=4401)
        return
    await websocket.accept()
    hub.bind_loop()
    queue: asyncio.Queue = asyncio.Queue()
    user_id = str(user.get("id") or user.get("login") or "?")
    if not hub.register(user, queue):
        await websocket.send_json({"type": "error", "code": "TOO_MANY", "message": "Слишком много соединений"})
        await websocket.close(code=4429)
        return
    oldest = hub.oldest_seq()
    # since больше текущего seq — сервер перезапускался и считает заново: пропущенного не повторить (п. 38)
    resumed = since == 0 or (since <= hub.seq and (oldest == 0 or since >= oldest - 1))
    await websocket.send_json({"type": "hello", "protocol": 1, "seq": hub.seq, "resumed": resumed})
    if not resumed:
        await websocket.send_json({"type": "resync"})
    else:
        for event in hub.events_since(since):
            await websocket.send_json(event)
    try:
        while True:
            try:
                event = await asyncio.wait_for(queue.get(), timeout=25.0)
                await websocket.send_json(event)
            except asyncio.TimeoutError:
                await websocket.send_json({"type": "ping"})
    except WebSocketDisconnect:
        pass
    except Exception as exc:  # noqa: BLE001 — соединение закрылось
        logger.debug("Сокет %s закрыт: %s", user_id, exc)
    finally:
        hub.unregister(user_id, queue)
