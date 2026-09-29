"""Репозиторий: изолирует сервисы от деталей хранения.

Все обращения к БД идут через этот класс, что упрощает тестирование и
потенциальную замену хранилища.
"""
from __future__ import annotations

from sqlalchemy import delete, func, or_, select
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from app.storage.models import EngineerAction, Event, GeocodeCache, Plan, RegionRecord, Scenario, User

class Repository:
    """Набор операций чтения/записи над сценариями, планами и событиями."""

    def __init__(self, session: Session) -> None:
        self.session = session

    # --- Кэш геокодера -----------------------------------------------------
    def get_geocode(self, address: str) -> GeocodeCache | None:
        """Координаты адреса из кэша (если уже геокодировали)."""
        return self.session.scalars(
            select(GeocodeCache).where(GeocodeCache.address == address)
        ).first()

    def upsert_geocode(
        self, address: str, latitude: float, longitude: float, provider: str
    ) -> GeocodeCache:
        """Сохраняет координаты адреса в кэш (обновляет существующую запись)."""
        record = self.get_geocode(address)
        if record is None:
            record = GeocodeCache(
                address=address, latitude=latitude, longitude=longitude, provider=provider
            )
            self.session.add(record)
        else:
            record.latitude = latitude
            record.longitude = longitude
            record.provider = provider
        self.session.commit()
        return record

    # --- Сценарии ----------------------------------------------------------
    def create_scenario(
        self,
        engineers: list[dict],
        requests: list[dict],
        name: str = "Сценарий",
        description: str | None = None,
        scenario_metadata: dict | None = None,
    ) -> Scenario:
        """Сохраняет новый входной сценарий."""
        scenario = Scenario(
            name=name,
            description=description,
            engineers=engineers,
            requests=requests,
            scenario_metadata=scenario_metadata or {},
        )
        self.session.add(scenario)
        self.session.flush()
        return scenario

    def get_scenario(self, scenario_id: str) -> Scenario | None:
        """Возвращает сценарий по идентификатору или ``None``."""
        return self.session.get(Scenario, scenario_id)

    def list_scenarios(self, limit: int = 50) -> list[Scenario]:
        """Возвращает последние загруженные сценарии."""
        stmt = select(Scenario).order_by(Scenario.created_at.desc()).limit(limit)
        return list(self.session.scalars(stmt))

    def find_scenarios(
        self,
        *,
        region_id: str | None = None,
        date: str | None = None,
        source: str | None = None,
        limit: int = 50,
    ) -> list[Scenario]:
        """Ищет сценарии по метаданным (region_id/date/source)."""
        scenarios = self.list_scenarios(limit=max(limit, 200))
        result: list[Scenario] = []
        for scenario in scenarios:
            meta = scenario.scenario_metadata or {}
            if region_id and meta.get("region_id") != region_id:
                continue
            if date and meta.get("date") != date:
                continue
            if source and meta.get("source") != source:
                continue
            result.append(scenario)
            if len(result) >= limit:
                break
        return result

    def update_scenario(self, scenario: Scenario) -> Scenario:
        """Сохраняет изменения сценария (например, метаданные/инженеров/заявок).

        JSON-поля помечаем изменёнными принудительно: при мутации вложенных
        словарей на месте (через поверхностную копию) SQLAlchemy иначе считает
        значение прежним и не делает UPDATE.
        """
        for field in ("engineers", "requests", "scenario_metadata"):
            flag_modified(scenario, field)
        self.session.add(scenario)
        self.session.commit()
        return scenario

    def save_plan(self, plan: Plan) -> Plan:
        """Сохраняет изменения плана (вложенные JSON-поля результата)."""
        for field in ("result", "input_payload", "metrics", "algorithm_meta"):
            flag_modified(plan, field)
        self.session.add(plan)
        self.session.commit()
        return plan

    # --- Нажатия инженеров -------------------------------------------------
    def create_engineer_action(
        self,
        engineer_id: str,
        action: str,
        *,
        scenario_id: str | None = None,
        request_id: str | None = None,
        at: str | None = None,
        payload: dict | None = None,
        result_event_id: str | None = None,
    ) -> EngineerAction:
        """Сохраняет нажатие инженера."""
        record = EngineerAction(
            engineer_id=engineer_id,
            scenario_id=scenario_id,
            request_id=request_id,
            action=action,
            at=at,
            payload=payload or {},
            result_event_id=result_event_id,
        )
        self.session.add(record)
        self.session.commit()
        return record

    def list_engineer_actions(
        self, engineer_id: str | None = None, limit: int = 100
    ) -> list[EngineerAction]:
        """История нажатий инженера (или всех)."""
        stmt = select(EngineerAction).order_by(EngineerAction.created_at.desc()).limit(limit)
        if engineer_id:
            stmt = stmt.where(EngineerAction.engineer_id == engineer_id)
        return list(self.session.scalars(stmt))

    # --- Свои участки (§14) -----------------------------------------------
    def list_region_records(self) -> list[RegionRecord]:
        """Свои участки в порядке создания."""
        return list(self.session.scalars(select(RegionRecord).order_by(RegionRecord.created_at)))

    def get_region_record(self, region_id: str) -> RegionRecord | None:
        return self.session.get(RegionRecord, region_id)

    def find_region_by_name(self, name_key: str) -> RegionRecord | None:
        return self.session.scalars(select(RegionRecord).where(RegionRecord.name_key == name_key)).first()

    def save_region_record(self, record: RegionRecord) -> RegionRecord:
        """Создаёт или обновляет участок; JSON-поля помечаем изменёнными."""
        from datetime import datetime, timezone

        record.updated_at = datetime.now(timezone.utc)
        self.session.add(record)
        flag_modified(record, "norms")
        flag_modified(record, "roster")
        self.session.commit()
        return record

    # --- Пользователи ------------------------------------------------------
    def get_user_by_login(self, login: str) -> User | None:
        """Возвращает пользователя по логину."""
        return self.session.scalars(select(User).where(User.login == login)).first()

    def get_user(self, user_id: str) -> User | None:
        """Возвращает пользователя по ID."""
        return self.session.get(User, user_id)

    def list_users(self, role: str | None = None, limit: int = 200) -> list[User]:
        """Возвращает пользователей (опционально — по роли)."""
        stmt = select(User).order_by(User.login).limit(limit)
        if role:
            stmt = stmt.where(User.role == role)
        return list(self.session.scalars(stmt))

    def create_user(
        self,
        login: str,
        name: str,
        role: str,
        password_hash: str,
        region_ids: list[str] | None = None,
        engineer_id: str | None = None,
    ) -> User:
        """Создаёт пользователя."""
        user = User(
            login=login,
            name=name,
            role=role,
            password_hash=password_hash,
            region_ids=region_ids or [],
            engineer_id=engineer_id,
        )
        self.session.add(user)
        self.session.commit()
        return user

    # --- Планы -------------------------------------------------------------
    def create_plan(
        self,
        scenario_id: str | None,
        input_payload: dict,
        result: dict,
        metrics: dict,
        algorithm_meta: dict,
        kind: str = "optimized",
        parent_plan_id: str | None = None,
        status: str = "completed",
    ) -> Plan:
        """Сохраняет результат работы алгоритма."""
        plan = Plan(
            scenario_id=scenario_id,
            parent_plan_id=parent_plan_id,
            kind=kind,
            status=status,
            input_payload=input_payload,
            result=result,
            metrics=metrics,
            algorithm_meta=algorithm_meta,
        )
        self.session.add(plan)
        self.session.flush()
        return plan

    def get_plan(self, plan_id: str) -> Plan | None:
        """Возвращает план по идентификатору или ``None``."""
        return self.session.get(Plan, plan_id)

    def latest_plan(self, scenario_id: str | None = None, kind: str | None = None) -> Plan | None:
        """Возвращает самый свежий план (опционально — по сценарию и типу)."""
        stmt = select(Plan).order_by(Plan.created_at.desc())
        if scenario_id:
            stmt = stmt.where(Plan.scenario_id == scenario_id)
        if kind:
            stmt = stmt.where(Plan.kind == kind)
        return self.session.scalars(stmt.limit(1)).first()

    def list_plans(self, scenario_id: str | None = None, limit: int = 50) -> list[Plan]:
        """Возвращает список планов (опционально — по сценарию)."""
        stmt = select(Plan).order_by(Plan.created_at.desc()).limit(limit)
        if scenario_id:
            stmt = stmt.where(Plan.scenario_id == scenario_id)
        return list(self.session.scalars(stmt))

    def child_plans(self, parent_plan_id: str, limit: int = 100) -> list[Plan]:
        """Возвращает производные версии плана (по ``parent_plan_id``)."""
        stmt = (
            select(Plan)
            .where(Plan.parent_plan_id == parent_plan_id)
            .order_by(Plan.created_at.desc())
            .limit(limit)
        )
        return list(self.session.scalars(stmt))

    def set_plan_status(self, plan_id: str, status: str) -> Plan | None:
        """Меняет статус версии плана (proposed/applied/rejected)."""
        plan = self.session.get(Plan, plan_id)
        if plan is None:
            return None
        plan.status = status
        self.session.commit()
        return plan

    def active_plan_for_scenario(self, scenario_id: str) -> Plan | None:
        """Возвращает действующий план сценария (applied или completed)."""
        stmt = (
            select(Plan)
            .where(Plan.scenario_id == scenario_id)
            .where(Plan.status.in_(["applied", "completed"]))
            .order_by(Plan.created_at.desc())
            .limit(1)
        )
        return self.session.scalars(stmt).first()

    # --- События -----------------------------------------------------------
    def create_event(
        self,
        event_type: str,
        payload: dict,
        plan_id: str | None = None,
        scenario_id: str | None = None,
        result_plan_id: str | None = None,
    ) -> Event:
        """Сохраняет событие перепланирования."""
        event = Event(
            plan_id=plan_id,
            scenario_id=scenario_id,
            event_type=event_type,
            payload=payload,
            result_plan_id=result_plan_id,
        )
        self.session.add(event)
        self.session.flush()
        return event

    def list_events(self, plan_id: str | None = None, limit: int = 50) -> list[Event]:
        """Возвращает историю событий (опционально — по исходному плану)."""
        stmt = select(Event).order_by(Event.created_at.desc()).limit(limit)
        if plan_id:
            stmt = stmt.where(Event.plan_id == plan_id)
        return list(self.session.scalars(stmt))

    def get_event(self, event_id: str) -> Event | None:
        """Возвращает событие по идентификатору."""
        return self.session.get(Event, event_id)

    # --- Удаление ----------------------------------------------------------
    def _descendant_plan_ids(self, plan_ids: set[str]) -> set[str]:
        """Дополняет набор планов всеми их потомками по ``parent_plan_id``."""
        collected = set(plan_ids)
        frontier = set(plan_ids)
        while frontier:
            stmt = select(Plan.id).where(Plan.parent_plan_id.in_(frontier))
            children = {plan_id for plan_id in self.session.scalars(stmt)} - collected
            if not children:
                break
            collected |= children
            frontier = children
        return collected

    def _related_scenario_ids(self, scenario_id: str) -> tuple[set[str], set[str]]:
        """Собирает сценарии и планы, связанные с исходным сценарием.

        Учитываются планы самого сценария, все производные планы
        (``parent_plan_id``) и сценарии-версии, созданные перепланированием.
        """
        scenario_ids = {scenario_id}
        plan_ids: set[str] = set()
        while True:
            condition = Plan.scenario_id.in_(scenario_ids)
            if plan_ids:
                condition = or_(condition, Plan.parent_plan_id.in_(plan_ids))
            rows = list(self.session.execute(select(Plan.id, Plan.scenario_id).where(condition)))
            new_plan_ids = {plan_id for plan_id, _ in rows} - plan_ids
            if not new_plan_ids:
                break
            plan_ids |= new_plan_ids
            scenario_ids |= {scenario_id for _, scenario_id in rows if scenario_id}
        return scenario_ids, plan_ids

    def delete_scenario(self, scenario_id: str) -> bool:
        """Удаляет сценарий вместе со связанными планами и событиями."""
        if self.session.get(Scenario, scenario_id) is None:
            return False
        scenario_ids, plan_ids = self._related_scenario_ids(scenario_id)
        if plan_ids:
            self.session.execute(
                delete(Event).where(
                    or_(Event.plan_id.in_(plan_ids), Event.scenario_id.in_(scenario_ids))
                )
            )
        else:
            self.session.execute(delete(Event).where(Event.scenario_id.in_(scenario_ids)))
        self.session.execute(delete(Plan).where(Plan.id.in_(plan_ids)))
        self.session.execute(delete(Scenario).where(Scenario.id.in_(scenario_ids)))
        self.session.commit()
        return True

    def clear_day(self, region_id: str, date: str) -> dict[str, int]:
        """Удаляет день целиком: сценарии, версии, планы, события, действия (п. 37)."""
        scenarios = [
            item
            for item in self.list_scenarios(limit=2000)
            if (item.scenario_metadata or {}).get("region_id") == region_id
            and (item.scenario_metadata or {}).get("date") == date
        ]
        scenario_ids: set[str] = set()
        plan_ids: set[str] = set()
        for scenario in scenarios:
            sids, pids = self._related_scenario_ids(scenario.id)
            scenario_ids |= sids
            plan_ids |= pids

        def _count(model, condition) -> int:
            return int(self.session.scalar(select(func.count()).select_from(model).where(condition)) or 0)

        if plan_ids:
            event_condition = or_(Event.plan_id.in_(plan_ids), Event.scenario_id.in_(scenario_ids))
        else:
            event_condition = Event.scenario_id.in_(scenario_ids)
        action_condition = EngineerAction.scenario_id.in_(scenario_ids)
        counts = {
            "scenarios": len(scenario_ids),
            "plans": len(plan_ids),
            "events": _count(Event, event_condition) if scenario_ids else 0,
            "engineer_actions": _count(EngineerAction, action_condition) if scenario_ids else 0,
        }
        if scenario_ids:
            self.session.execute(delete(Event).where(event_condition))
            self.session.execute(delete(EngineerAction).where(action_condition))
        self.session.execute(delete(Plan).where(Plan.id.in_(plan_ids)))
        self.session.execute(delete(Scenario).where(Scenario.id.in_(scenario_ids)))
        self.session.commit()
        return counts

    def delete_all_scenarios(self) -> int:
        """Удаляет все сценарии, планы и события. Возвращает число сценариев."""
        count = self.session.scalar(select(func.count()).select_from(Scenario)) or 0
        self.session.execute(delete(Event))
        self.session.execute(delete(Plan))
        self.session.execute(delete(Scenario))
        self.session.commit()
        return int(count)

    def delete_plan(self, plan_id: str) -> bool:
        """Удаляет план вместе с производными планами и их событиями."""
        if self.session.get(Plan, plan_id) is None:
            return False
        plan_ids = self._descendant_plan_ids({plan_id})
        self.session.execute(delete(Event).where(Event.plan_id.in_(plan_ids)))
        self.session.execute(delete(Plan).where(Plan.id.in_(plan_ids)))
        self.session.commit()
        return True

    def delete_all_plans(self) -> int:
        """Удаляет все планы и связанные с ними события. Возвращает число планов."""
        count = self.session.scalar(select(func.count()).select_from(Plan)) or 0
        self.session.execute(delete(Event))
        self.session.execute(delete(Plan))
        self.session.commit()
        return int(count)

    def delete_event(self, event_id: str) -> bool:
        """Удаляет событие по идентификатору."""
        event = self.session.get(Event, event_id)
        if event is None:
            return False
        self.session.delete(event)
        self.session.commit()
        return True

    def delete_all_events(self) -> int:
        """Удаляет все события. Возвращает число удалённых записей."""
        count = self.session.scalar(select(func.count()).select_from(Event)) or 0
        self.session.execute(delete(Event))
        self.session.commit()
        return int(count)
