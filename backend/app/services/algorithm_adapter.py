"""Адаптер между API и существующим алгоритмом оптимизации.

Главный принцип — **не изменять алгоритм**. Адаптер выполняет всю работу по
согласованию форматов:

1. API присылает инженеров и заявки с координатами, временем ``HH:MM`` и
   названиями навыков/транспорта из справочника кейса.
2. Адаптер строит матрицы расстояний и времени в пути, узлы и ``Instance``.
3. Запускается существующий решатель (``solve_hybrid_v2`` или ``solve``).
4. Результат преобразуется в формат, удобный для API и карты.

Единицы измерения: координаты — градусы, время — ``HH:MM`` на границе API и
целые минуты внутри алгоритма, расстояние — километры на границе и целые метры
внутри алгоритма.
"""
from __future__ import annotations

import sys
import threading
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any

import numpy as np

from app.core.constants import normalize_priority, normalize_skill, normalize_transport
from app.schemas.validators import time_to_minutes
from app.services.geo import build_matrices, demo_geocode
from app.services.local_osrm import LocalOsrmClient
from app.services.ors_client import OpenRouteServiceClient


class AlgorithmError(RuntimeError):
    """Базовая ошибка при работе с алгоритмом."""


class AlgorithmNotFoundError(AlgorithmError):
    """Пакет алгоритма не найден по указанному пути."""


class AlgorithmExecutionError(AlgorithmError):
    """Ошибка во время выполнения алгоритма."""


@dataclass
class AdaptedProblem:
    """Согласованная с алгоритмом задача и сопутствующие данные для ответа API."""

    instance: Any  # dispatch.Instance
    engineers: list[dict[str, Any]]
    requests: list[dict[str, Any]]
    coordinates: dict[int, tuple[float, float]]
    engineer_node: dict[str, int]
    request_node: dict[str, int]
    node_kind: dict[int, str]
    road_factor: float
    matrix_sources: dict[str, str] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)

    @property
    def engineer_by_id(self) -> dict[str, dict[str, Any]]:
        """Индекс инженеров по ID."""
        return {item["id"]: item for item in self.engineers}

    @property
    def request_by_id(self) -> dict[str, dict[str, Any]]:
        """Индекс заявок по ID."""
        return {item["id"]: item for item in self.requests}

    @property
    def node_by_request(self) -> dict[str, int]:
        """Обратное отображение ID заявки в узел."""
        return dict(self.request_node)


@lru_cache(maxsize=8)
def _load_dispatch(algorithm_dir: str):
    """Импортирует пакет алгоритма ``dispatch`` из указанного каталога.

    Результат кэшируется, чтобы не добавлять путь и не импортировать тяжёлые
    зависимости повторно.
    """
    path = Path(algorithm_dir)
    if not (path / "dispatch" / "__init__.py").exists():
        raise AlgorithmNotFoundError(
            f"Пакет алгоритма не найден: ожидался {path / 'dispatch' / '__init__.py'}"
        )
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))
    try:
        import dispatch  # type: ignore
    except Exception as exc:  # noqa: BLE001 — нужен понятный текст ошибки для API
        raise AlgorithmNotFoundError(
            f"Не удалось импортировать алгоритм из {path}: {exc}"
        ) from exc
    return dispatch


def algorithm_available(algorithm_dir: str | Path) -> bool:
    """Проверяет, доступен ли пакет алгоритма (без падения)."""
    try:
        _load_dispatch(str(algorithm_dir))
        return True
    except AlgorithmNotFoundError:
        return False


class AlgorithmAdapter:
    """Преобразование форматов API ↔ алгоритм и запуск решателя."""

    #: Глобальная блокировка: решатель тяжёлый, не запускаем несколько оптимизаций
    #: одновременно в одном процессе.
    _solver_lock = threading.Lock()

    def __init__(
        self,
        algorithm_dir: str | Path,
        road_factor: float = 1.28,
        allow_demo_geocoding: bool = True,
        ors_client: OpenRouteServiceClient | None = None,
        local_osrm: LocalOsrmClient | None = None,
    ) -> None:
        self.algorithm_dir = str(algorithm_dir)
        self.road_factor = road_factor
        self.allow_demo_geocoding = allow_demo_geocoding
        self.ors_client = ors_client
        self.local_osrm = local_osrm

    # --- Подготовка входных данных ----------------------------------------
    def _normalize_engineer(self, raw: dict[str, Any]) -> tuple[dict[str, Any], tuple[float, float]]:
        """Приводит инженера к внутреннему нормализованному виду."""
        engineer_id = str(raw["id"])
        transport = normalize_transport(raw["transport"])
        skills = [normalize_skill(s) for s in raw.get("skills", [])]
        if not skills:
            raise AlgorithmExecutionError(f"У инженера {engineer_id} не указаны навыки")
        normalized = {
            "id": engineer_id,
            "name": raw.get("name") or engineer_id,
            "latitude": float(raw["latitude"]),
            "longitude": float(raw["longitude"]),
            "shift_start": raw["shift_start"],
            "shift_end": raw["shift_end"],
            "skills": list(dict.fromkeys(skills)),
            "transport": transport,
            "available": bool(raw.get("available", True)),
            "kit": dict(raw.get("kit") or {}),
            "skill_levels": {str(k): int(v) for k, v in (raw.get("skill_levels") or {}).items()},
            "start_kind": raw.get("start_kind", "office"),
            "available_until": raw.get("available_until"),
            "shift_status": raw.get("shift_status", "not_started"),
            "actual_transport": raw.get("actual_transport"),
        }
        return normalized, (normalized["latitude"], normalized["longitude"])

    def _normalize_request(
        self, raw: dict[str, Any]
    ) -> tuple[dict[str, Any], tuple[float, float], list[str]]:
        """Приводит заявку к внутреннему нормализованному виду.

        Возвращает заявку, координаты и список предупреждений (например, о
        демонстрационном геокодировании).
        """
        warnings: list[str] = []
        request_id = str(raw["id"])
        latitude = raw.get("latitude")
        longitude = raw.get("longitude")
        if latitude is None or longitude is None:
            address = raw.get("address")
            if not address:
                raise AlgorithmExecutionError(
                    f"У заявки {request_id} нет координат и адреса"
                )
            if not self.allow_demo_geocoding:
                raise AlgorithmExecutionError(
                    f"Заявке {request_id} нужны координаты: геокодирование отключено"
                )
            latitude, longitude = demo_geocode(str(address))
            warnings.append(
                f"Заявка {request_id}: координаты получены демонстрационным геокодером по адресу"
            )
        transport = raw.get("required_transport")
        skill_value = normalize_skill(raw["required_skill"])
        priority_value = normalize_priority(raw.get("priority"))
        # Ранг из условия кейса: 1 — авария, 2 — подключение, 3 — локальная/дозаказ.
        # Выводим из навыка/приоритета (у входных схем ранг по умолчанию мог быть 1).
        if priority_value == "urgent" or skill_value == "emergency":
            priority_rank = 1
        elif skill_value == "installation":
            priority_rank = 2
        else:
            priority_rank = 3
        normalized = {
            "id": request_id,
            "latitude": float(latitude),
            "longitude": float(longitude),
            "address": raw.get("address"),
            "duration_minutes": int(raw["duration_minutes"]),
            "window_start": raw["window_start"],
            "window_end": raw["window_end"],
            "priority": priority_value,
            "required_skill": skill_value,
            "required_transport": normalize_transport(transport) if transport else None,
            # release_time используется при перепланировании (мин. от начала суток).
            "release_time": int(raw.get("release_time", 0)),
            "min_skill_level": int(raw.get("min_skill_level", 1)),
            "required_tools": tuple(
                sorted(k for k, v in (raw.get("equipment") or {}).items() if int(v) > 0)
            ),
            "equipment": dict(raw.get("equipment") or {}),
            "type_bk": raw.get("type_bk"),
            "type_hd": raw.get("type_hd"),
            "district": raw.get("district"),
            "gigabit": bool(raw.get("gigabit", False)),
            "technology": raw.get("technology"),
            "priority_rank": priority_rank,
            "source": raw.get("source", "dispatcher"),
            "external_id": raw.get("external_id"),
            "dispatcher_engineer_id": raw.get("dispatcher_engineer_id")
            or raw.get("assigned_engineer"),
            "assigned_start": raw.get("assigned_start"),
            "client_window_locked": bool(raw.get("client_window_locked", False)),
        }
        return normalized, (normalized["latitude"], normalized["longitude"]), warnings

    def prepare_problem(
        self, engineers: list[dict[str, Any]], requests: list[dict[str, Any]]
    ) -> AdaptedProblem:
        """Строит ``Instance`` и сопутствующие данные из нормализованных словарей."""
        dispatch = _load_dispatch(self.algorithm_dir)

        if not engineers:
            raise AlgorithmExecutionError("Нужен хотя бы один инженер")
        if not requests:
            raise AlgorithmExecutionError("Нужна хотя бы одна заявка")

        # Уникальность идентификаторов.
        eng_ids = [str(e["id"]) for e in engineers]
        req_ids = [str(r["id"]) for r in requests]
        if len(eng_ids) != len(set(eng_ids)):
            raise AlgorithmExecutionError("Обнаружены дублирующиеся ID инженеров")
        if len(req_ids) != len(set(req_ids)):
            raise AlgorithmExecutionError("Обнаружены дублирующиеся ID заявок")

        # --- Узлы: сначала стартовые точки инженеров, затем точки заявок. ---
        coordinates: dict[int, tuple[float, float]] = {}
        engineer_node: dict[str, int] = {}
        request_node: dict[str, int] = {}
        node_kind: dict[int, str] = {}

        normalized_engineers: list[dict[str, Any]] = []
        for index, raw in enumerate(engineers):
            normalized, coords = self._normalize_engineer(raw)
            node = len(coordinates)
            coordinates[node] = coords
            engineer_node[normalized["id"]] = node
            node_kind[node] = "engineer_start"
            normalized_engineers.append(normalized)

        warnings: list[str] = []
        normalized_requests: list[dict[str, Any]] = []
        for raw in requests:
            normalized, coords, request_warnings = self._normalize_request(raw)
            node = len(coordinates)
            coordinates[node] = coords
            request_node[normalized["id"]] = node
            node_kind[node] = "request"
            normalized_requests.append(normalized)
            warnings.extend(request_warnings)

        # --- Матрицы расстояний и времени для всех транспортов инженеров. ---
        transports = {e["transport"] for e in normalized_engineers}
        ordered_nodes = [coordinates[i] for i in range(len(coordinates))]
        matrices = build_matrices(
            ordered_nodes,
            transports,
            self.road_factor,
            ors_client=self.ors_client,
            local_osrm=self.local_osrm,
        )
        distance_dict, travel_dict = matrices.distance_m, matrices.travel_minutes
        warnings.extend(matrices.warnings)

        # --- Задачи алгоритма. ---
        tasks = []
        for request in normalized_requests:
            tasks.append(
                dispatch.Task(
                    id=request["id"],
                    node=request_node[request["id"]],
                    duration=request["duration_minutes"],
                    window_start=time_to_minutes(request["window_start"]),
                    window_end=time_to_minutes(request["window_end"]),
                    skill=request["required_skill"],
                    transport=request["required_transport"],
                    urgent=request["priority"] == "urgent",
                    release_time=request["release_time"],
                    min_skill_level=request.get("min_skill_level", 1),
                    required_tools=tuple(request.get("required_tools", ())),
                    priority_rank=request.get("priority_rank", 3),
                    type_bk=request.get("type_bk"),
                    type_hd=request.get("type_hd"),
                )
            )

        # --- Инженеры алгоритма. ---
        algo_engineers = []
        for engineer in normalized_engineers:
            algo_engineers.append(
                dispatch.Engineer(
                    id=engineer["id"],
                    start_node=engineer_node[engineer["id"]],
                    shift_start=time_to_minutes(engineer["shift_start"]),
                    shift_end=time_to_minutes(engineer["shift_end"]),
                    skills=tuple(engineer["skills"]),
                    transport=engineer["transport"],
                    available=engineer["available"],
                    skill_levels=tuple(
                        sorted((str(k), int(v)) for k, v in engineer.get("skill_levels", {}).items())
                    ),
                    tools=tuple(
                        sorted(k for k, v in engineer.get("kit", {}).items() if int(v) > 0)
                    ),
                )
            )

        try:
            instance = dispatch.Instance(
                tasks=tasks,
                engineers=algo_engineers,
                travel_minutes={k: np.asarray(v, dtype=np.int64) for k, v in travel_dict.items()},
                distance_m={k: np.asarray(v, dtype=np.int64) for k, v in distance_dict.items()},
                metadata={
                    "road_factor": self.road_factor,
                    "source": "api_adapter",
                    "matrix_sources": matrices.sources,
                },
            )
            instance.validate()
        except ValueError as exc:
            raise AlgorithmExecutionError(f"Некорректные входные данные: {exc}") from exc

        return AdaptedProblem(
            instance=instance,
            engineers=normalized_engineers,
            requests=normalized_requests,
            coordinates=coordinates,
            engineer_node=engineer_node,
            request_node=request_node,
            node_kind=node_kind,
            road_factor=self.road_factor,
            matrix_sources=dict(matrices.sources),
            warnings=warnings,
        )

    # --- Запуск алгоритма --------------------------------------------------
    def run(
        self,
        problem: AdaptedProblem,
        *,
        solver: str = "hybrid_v2",
        seed: int = 42,
        total_seconds: float = 20.0,
        warm_start_seconds: float = 5.0,
        pre_master_seconds: float = 2.0,
        lex_cg_seconds: float = 9.0,
        final_mip_seconds: float = 4.0,
    ) -> Any:
        """Запускает основной решатель нового алгоритма.

        По умолчанию — ``solve_production`` (жадная вставка → ALNS → MILP-сборка
        из пула маршрутов → независимый валидатор). ``solver='alns'`` — чистый
        ALNS, ``solver='hybrid_v2'`` можно использовать для column generation.
        """
        dispatch = _load_dispatch(self.algorithm_dir)
        try:
            with self._solver_lock:
                if solver == "alns":
                    config = dispatch.SearchConfig(
                        seed=seed,
                        iterations=1200,
                        time_limit_seconds=total_seconds,
                        master_seconds=min(4.0, max(0.5, total_seconds * 0.3)),
                    )
                    return dispatch.solve(problem.instance, config)
                if solver == "hybrid_v2":
                    config = dispatch.ProductionConfig(
                        seed=seed,
                        total_seconds=total_seconds,
                        warm_iterations=max(200, int(total_seconds * 60)),
                        master_seconds=min(1.2, max(0.1, total_seconds * 0.2)),
                    )
                    return dispatch.solve_production(problem.instance, config)
                config = dispatch.HybridV2Config(
                    seed=seed,
                    total_seconds=total_seconds,
                    warm_start_seconds=warm_start_seconds,
                    pre_master_seconds=pre_master_seconds,
                    lex_cg_seconds=lex_cg_seconds,
                    final_mip_seconds=final_mip_seconds,
                )
                return dispatch.solve_hybrid_v2(problem.instance, config)
        except AlgorithmError:
            raise
        except Exception as exc:  # noqa: BLE001 — единая ошибка для API
            raise AlgorithmExecutionError(f"Ошибка выполнения алгоритма: {exc}") from exc

    # --- Базовый сценарий --------------------------------------------------
    def baseline_routes(self, problem: AdaptedProblem) -> list[tuple[int, ...]]:
        """Строит базовый план (порядок заявок, первый подходящий инженер)."""
        dispatch = _load_dispatch(self.algorithm_dir)
        try:
            return dispatch.baseline(problem.instance)
        except Exception as exc:  # noqa: BLE001
            raise AlgorithmExecutionError(f"Ошибка построения базового плана: {exc}") from exc

    # --- Отчёты и объяснения ----------------------------------------------
    def evaluator(self, problem: AdaptedProblem):
        """Создаёт ``Evaluator`` алгоритма для построения отчётов."""
        dispatch = _load_dispatch(self.algorithm_dir)
        return dispatch.Evaluator(problem.instance)

    def build_report(
        self, problem: AdaptedProblem, routes: list[tuple[int, ...]], metadata: dict | None = None
    ) -> dict:
        """Строит JSON-совместимый отчёт алгоритма по заданным маршрутам."""
        try:
            return self.evaluator(problem).report(routes, metadata)
        except Exception as exc:  # noqa: BLE001
            raise AlgorithmExecutionError(f"Ошибка построения отчёта: {exc}") from exc

    def plan_changes(
        self, previous_report: dict[str, Any], current_report: dict[str, Any]
    ) -> list[dict[str, Any]]:
        """Сравнивает два отчёта алгоритма и возвращает список изменений."""
        dispatch = _load_dispatch(self.algorithm_dir)
        try:
            from dispatch import replan as replan_module

            return replan_module.plan_changes(previous_report, current_report)
        except Exception as exc:  # noqa: BLE001
            raise AlgorithmExecutionError(f"Ошибка сравнения планов: {exc}") from exc

    def explain_task(
        self, problem: AdaptedProblem, routes: list[tuple[int, ...]], task_id: str
    ) -> dict[str, Any]:
        """Возвращает объяснение алгоритма по конкретной заявке."""
        dispatch = _load_dispatch(self.algorithm_dir)
        try:
            return dispatch.explain_task(problem.instance, routes, task_id)
        except Exception as exc:  # noqa: BLE001
            raise AlgorithmExecutionError(f"Ошибка объяснения заявки {task_id}: {exc}") from exc

    # --- Инкрементальное перепланирование ----------------------------------
    def engineer_state(
        self,
        engineer_id: str,
        start_node: int,
        available_at: int,
        *,
        used_today: bool = False,
        available: bool = True,
        committed_task_ids: tuple[str, ...] = (),
        locked_future_prefix: tuple[str, ...] = (),
        actually_travelled_m: int = 0,
    ):
        """Создаёт ``EngineerState`` алгоритма (телеметрия для rolling-horizon)."""
        _load_dispatch(self.algorithm_dir)
        from dispatch import replan as replan_module

        return replan_module.EngineerState(
            engineer_id=engineer_id,
            start_node=start_node,
            available_at=available_at,
            used_today=used_today,
            available=available,
            committed_task_ids=committed_task_ids,
            locked_future_prefix=locked_future_prefix,
            actually_travelled_m=actually_travelled_m,
        )

    def replan_residual(
        self,
        problem: AdaptedProblem,
        base_report: dict[str, Any],
        event_time: int,
        states: list[Any],
        completed_ids: set[str],
        cancelled_ids: set[str] | None = None,
        *,
        seed: int = 42,
        total_seconds: float = 5.0,
    ):
        """Считает остаточную задачу (freeze) и решает её.

        Возвращает ``(residual_instance, SolveResult)``. Отчёт решения
        содержит только будущие (незамороженные) заявки.
        """
        dispatch = _load_dispatch(self.algorithm_dir)
        from dispatch import replan as replan_module

        config = dispatch.ProductionConfig(
            seed=seed,
            total_seconds=max(0.3, total_seconds),
            warm_iterations=max(120, int(total_seconds * 60)),
            master_seconds=min(1.0, max(0.1, total_seconds * 0.25)),
        )
        try:
            with self._solver_lock:
                residual, result = replan_module.replan_production(
                    problem.instance,
                    base_report,
                    event_time,
                    states,
                    set(completed_ids),
                    set(cancelled_ids or ()),
                    production_config=config,
                )
            return residual, result
        except AlgorithmError:
            raise
        except Exception as exc:  # noqa: BLE001
            raise AlgorithmExecutionError(f"Ошибка перепланирования: {exc}") from exc

    def validate_routes(
        self, problem: AdaptedProblem, routes: list[tuple[int, ...]]
    ) -> tuple[int, ...]:
        """Независимо проверяет маршруты; возвращает лексикографический ключ."""
        _load_dispatch(self.algorithm_dir)
        from dispatch.validation import validate_plan

        try:
            return tuple(validate_plan(problem.instance, routes))
        except Exception as exc:  # noqa: BLE001
            raise AlgorithmExecutionError(f"План не проходит проверку: {exc}") from exc

    def insertion_options(
        self, problem: AdaptedProblem, routes: list[tuple[int, ...]], task_id: str
    ) -> list[dict[str, Any]]:
        """Возвращает допустимые вставки заявки в текущие маршруты."""
        ev = self.evaluator(problem)
        ids = {task.id: index for index, task in enumerate(problem.instance.tasks)}
        if task_id not in ids:
            raise AlgorithmExecutionError(f"Неизвестная заявка: {task_id}")
        task_index = ids[task_id]
        original = ev.key(routes)
        options: list[dict[str, Any]] = []
        for owner, route in enumerate(routes):
            if task_index in route:
                continue
            position, *_ = ev.insert(owner, route, task_index)
            if position < 0:
                continue
            candidate = list(routes)
            candidate[owner] = route[:position] + (task_index,) + route[position:]
            key = ev.key(candidate)
            options.append(
                {
                    "engineer_id": problem.instance.engineers[owner].id,
                    "position": int(position),
                    "objective": list(key),
                    # Новый целевой вектор: (rank1, rank2, rank3 без исполнителя,
                    # инженеры, метры, мягкий штраф).
                    "delta_engineers": key[3] - original[3],
                    "delta_distance_km": round((key[4] - original[4]) / 1000, 3),
                }
            )
        options.sort(key=lambda item: item["objective"])
        return options
