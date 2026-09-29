"""Необязательный эталонный решатель на OR-Tools — для сравнения или стартового плана.

В поставке не запускается: ortools ставится отдельно. Маршруты открытые
(возвращаться не нужно). Каждый план от OR-Tools проверяется независимым валидатором.
"""
from .evaluate import Evaluator, baseline
from .validation import validate_plan


def ortools_seed(instance, seconds=15.0):
    try:
        from ortools.constraint_solver import pywrapcp, routing_enums_pb2
    except ImportError as exc:
        raise RuntimeError('Optional dependency missing: pip install ortools') from exc
    ev = Evaluator(instance)
    a = ev.a
    n, k_count = len(instance.tasks), len(instance.engineers)
    if n == 0:
        return [() for _ in instance.engineers]
    sink = n+k_count
    manager = pywrapcp.RoutingIndexManager(sink+1, k_count, list(range(n, sink)), [sink]*k_count)
    routing = pywrapcp.RoutingModel(manager)
    time_callbacks = []
    for k in range(k_count):
        def node(raw):
            if raw < n:
                return int(a.nodes[raw])
            return int(a.starts[raw-n]) if raw < sink else -1
        def travel_callback(fi, ti, owner=k):
            f, t = manager.IndexToNode(fi), manager.IndexToNode(ti)
            service = int(a.service[owner, f]) if f < n else 0
            return service if t == sink else service+int(a.travel[owner, node(f), node(t)])
        def distance_callback(fi, ti, owner=k):
            f, t = manager.IndexToNode(fi), manager.IndexToNode(ti)
            return 0 if t == sink else int(a.distance[owner, node(f), node(t)])
        time_callbacks.append(routing.RegisterTransitCallback(travel_callback))
        routing.SetArcCostEvaluatorOfVehicle(routing.RegisterTransitCallback(distance_callback), k)
        routing.SetFixedCostOfVehicle(0 if a.used[k] else int(a.fleet_weight), k)
    horizon = max(int(a.shift_end.max()), int(a.closing.max(initial=0)), 1)
    routing.AddDimensionWithVehicleTransits(time_callbacks, horizon, horizon, False, 'Time')
    dimension = routing.GetDimensionOrDie('Time')
    for k in range(k_count):
        dimension.CumulVar(routing.Start(k)).SetRange(int(a.shift_start[k]), int(a.shift_start[k]))
        dimension.CumulVar(routing.End(k)).SetRange(0, int(a.shift_end[k]))
    for i in range(n):
        index = manager.NodeToIndex(i)
        opening, closing = int(a.opening[i]), int(a.closing[i])
        if opening <= closing:
            dimension.CumulVar(index).SetRange(opening, closing)
        else:
            routing.solver().Add(routing.ActiveVar(index) == 0)
        penalty = int(a.missing_weight + a.urgent_weight*a.urgent[i])
        if penalty*n >= 2**62:
            raise ValueError('OR-Tools objective would exceed safe int64 range; use the sequential master')
        routing.AddDisjunction([index], penalty)
        allowed = [k for k in range(k_count) if a.allowed[k, i]]
        if allowed:
            routing.SetAllowedVehiclesForIndex(allowed, index)
        else:
            routing.solver().Add(routing.ActiveVar(index) == 0)
    for k, prefix in enumerate(a.locked):
        prev = routing.Start(k)
        for i in prefix:
            nxt = manager.NodeToIndex(i)
            routing.solver().Add(routing.NextVar(prev) == nxt)
            routing.solver().Add(routing.ActiveVar(nxt) == 1)
            prev = nxt
    params = pywrapcp.DefaultRoutingSearchParameters()
    params.first_solution_strategy = routing_enums_pb2.FirstSolutionStrategy.PARALLEL_CHEAPEST_INSERTION
    params.local_search_metaheuristic = routing_enums_pb2.LocalSearchMetaheuristic.GUIDED_LOCAL_SEARCH
    params.time_limit.FromMilliseconds(max(1, int(seconds*1000)))
    assignment = routing.SolveWithParameters(params)
    if assignment is None:
        return baseline(instance)
    routes = []
    for k in range(k_count):
        route = []
        index = routing.Start(k)
        while not routing.IsEnd(index):
            raw = manager.IndexToNode(index)
            if raw < n:
                route.append(raw)
            index = assignment.Value(routing.NextVar(index))
        routes.append(tuple(route))
    validate_plan(instance, routes)
    return routes
