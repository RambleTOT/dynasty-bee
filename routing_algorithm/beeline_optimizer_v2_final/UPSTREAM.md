# Внешний алгоритм (vendored)

Пакет `dispatch/` в этом каталоге — внешний планировщик команды,
интегрированный в API как «algorithm``.

- Репозиторий: `git@github.com:kirill3005/beeline-dispatch-optimizer.git`
- Коммит: `a257594c88a88e964661aaffcf849f2e5a4eb908`
- Скопирован: 28.09.2026

Архитектура: жадная вставка по приоритетам → ALNS → MILP-сборка из пула
маршрутов (`master.py`) → независимый валидатор (`validation.py`).
Бэкенд-интерфейс — `dispatch.operations` / `dispatch.contracts`; API-адаптер
бэкенда (`backend/app/services/algorithm_adapter.py`) вызывает
`solve_production` и `replan_production`, строит матрицы сам.

Правки внешнего кода не вносятся: адаптер согласует форматы.
