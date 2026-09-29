"""Живые обновления (§38): одноразовые билеты, соединения и рассылка событий.

Реализация в памяти процесса: один воркер uvicorn, последовательность общая,
буфер последних событий для ``since``. При нескольких воркерах нужен LISTEN/NOTIFY
Postgres — вынесено за скобки этой задачи.
"""
from __future__ import annotations

import asyncio
import logging
import secrets
import time
from collections import deque
from dataclasses import dataclass
from typing import Any

logger = logging.getLogger(__name__)

_MAX_CONNECTIONS_PER_USER = 5
_TICKET_TTL_SECONDS = 30.0


@dataclass
class _Ticket:
    """Одноразовый билет на подключение к сокету."""

    user: dict[str, Any]
    expires_at: float
    used: bool = False


class RealtimeHub:
    """Хаб сокетов: билеты, соединения, буфер событий."""

    def __init__(self) -> None:
        self._tickets: dict[str, _Ticket] = {}
        self._connections: dict[str, list[dict[str, Any]]] = {}
        self._seq = 0
        self._buffer: deque[dict[str, Any]] = deque(maxlen=1000)
        self._loop: asyncio.AbstractEventLoop | None = None

    # --- loop --------------------------------------------------------------
    def bind_loop(self, loop: asyncio.AbstractEventLoop | None = None) -> None:
        """Запоминает событийный цикл для публикации из синхронных ручек."""
        if loop is not None:
            self._loop = loop
            return
        try:
            self._loop = asyncio.get_running_loop()
        except RuntimeError:  # pragma: no cover — вне цикла
            self._loop = None

    # --- билеты ------------------------------------------------------------
    def issue_ticket(self, user: dict[str, Any]) -> str:
        now = time.time()
        # Чистим просроченные билеты, чтобы память не росла.
        for token, ticket in list(self._tickets.items()):
            if ticket.expires_at < now or ticket.used:
                self._tickets.pop(token, None)
        token = secrets.token_urlsafe(32)
        self._tickets[token] = _Ticket(user=dict(user), expires_at=now + _TICKET_TTL_SECONDS)
        return token

    def consume_ticket(self, token: str | None) -> dict[str, Any] | None:
        if not token:
            return None
        ticket = self._tickets.get(token)
        if ticket is None or ticket.used or ticket.expires_at < time.time():
            return None
        ticket.used = True
        self._tickets.pop(token, None)
        return ticket.user

    # --- соединения --------------------------------------------------------
    def register(self, user: dict[str, Any], queue: asyncio.Queue) -> bool:
        user_id = str(user.get("id") or user.get("login") or "?")
        connections = self._connections.setdefault(user_id, [])
        if len(connections) >= _MAX_CONNECTIONS_PER_USER:
            return False
        connections.append({"user": user, "queue": queue})
        return True

    def unregister(self, user_id: str, queue: asyncio.Queue) -> None:
        connections = self._connections.get(user_id)
        if not connections:
            return
        self._connections[user_id] = [c for c in connections if c["queue"] is not queue]
        if not self._connections[user_id]:
            self._connections.pop(user_id, None)

    @property
    def seq(self) -> int:
        return self._seq

    def oldest_seq(self) -> int:
        return self._buffer[0]["seq"] if self._buffer else 0

    def events_since(self, since: int) -> list[dict[str, Any]]:
        return [event for event in self._buffer if event["seq"] > since]

    # --- публикация --------------------------------------------------------
    def publish(
        self,
        kind: str,
        *,
        region_id: str | None = None,
        date: str | None = None,
        data: dict[str, Any] | None = None,
        actor: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        self._seq += 1
        from app.core.timeutils import now

        event = {
            "type": "event",
            "seq": self._seq,
            "id": secrets.token_hex(8),
            "kind": kind,
            "at": now().isoformat(),
            "region_id": region_id,
            "date": date,
            "actor": actor,
            "data": data or {},
        }
        self._buffer.append(event)
        self._dispatch(event)
        return event

    def _matches(self, user: dict[str, Any], event: dict[str, Any]) -> bool:
        role = user.get("role")
        regions = set(user.get("region_ids") or [])
        region_id = event.get("region_id")
        if role == "dispatcher":
            return not regions or region_id in regions or region_id is None
        if role == "operator":
            return event["kind"].startswith(("booking.", "request.")) or event["kind"].startswith("plan.")
        if role == "engineer":
            engineer_id = user.get("engineer_id")
            data = event.get("data") or {}
            if event["kind"] in {"engineer.route_changed", "engineer.action"}:
                return data.get("engineer_id") == engineer_id
            if event["kind"] in {"plan.published", "clock.changed", "request.status_changed"}:
                return (not regions or region_id in regions) and data.get("engineer_id") in {None, engineer_id}
            return False
        return False

    def _dispatch(self, event: dict[str, Any]) -> None:
        if self._loop is None:
            return
        for connections in list(self._connections.values()):
            for connection in connections:
                if not self._matches(connection["user"], event):
                    continue
                try:
                    self._loop.call_soon_threadsafe(connection["queue"].put_nowait, event)
                except Exception:  # noqa: BLE001 — мёртвое соединение не должно мешать
                    continue


#: Единственный хаб процесса.
hub = RealtimeHub()
