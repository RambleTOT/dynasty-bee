"""Почему заявку получил именно этот инженер и куда ещё её можно было бы поставить."""
from .evaluate import Evaluator


def explain_task(instance, routes, task_id):
    """Объяснение по одной заявке.

    Для назначенной: кто выполняет, расписание и простые альтернативы — перенос этой
    одной заявки к другому инженеру без перестройки остальных маршрутов.
    Для неназначенной: код причины.
    """
    ev = Evaluator(instance)
    original = ev.key(routes)
    ids = {t.id: i for i, t in enumerate(instance.tasks)}
    if task_id not in ids:
        raise ValueError('Unknown task')
    i = ids[task_id]
    owners = [k for k, r in enumerate(routes) if i in r]
    if not owners:
        return ev.explain_unassigned(i, routes)

    k = owners[0]
    task = instance.tasks[i]
    engineer = instance.engineers[k]
    row = next(x for x in ev.schedule(k, routes[k]) if x['task_id'] == task_id)
    result = {
        'task_id': task_id,
        'engineer_id': engineer.id,
        'required_skill': task.skill,
        'engineer_skills': list(engineer.skills),
        'required_transport': task.transport,
        'engineer_transport': engineer.transport,
        'schedule': row,
        'locked': i in ev.a.locked[k],
        'text': (f'Заявку выполняет {engineer.id}: навык и транспорт подходят, '
                 f'начало в {row["start"]} — внутри окна, все работы укладываются в смену.'),
        'counterfactual_scope': 'Only single-job moves into the other CURRENT routes; '
                                'not a global optimality/causality proof.',
    }
    if result['locked']:
        result['local_alternatives'] = []
        result['counterfactual_note'] = 'Назначение зафиксировано диспетчером.'
        return result

    reduced = tuple(t for t in routes[k] if t != i)
    if not ev.route(k, reduced)[0]:
        result['local_alternatives'] = []
        result['counterfactual_note'] = ('Без этой заявки маршрут становится недопустимым '
                                         '(матрица времени не метрическая).')
        return result

    alternatives = []
    for owner in range(len(routes)):
        if owner == k:
            continue
        pos, *_ = ev.insert(owner, routes[owner], i)
        if pos < 0:
            continue
        candidate = list(routes)
        candidate[k] = reduced
        candidate[owner] = routes[owner][:pos] + (i,) + routes[owner][pos:]
        key = ev.key(candidate)
        # key = (аварии, подключения, остальное, инженеры, метры, штраф)
        alternatives.append({
            'engineer_id': instance.engineers[owner].id,
            'position': int(pos),
            'objective': list(key),
            'delta_engineers': key[3] - original[3],
            'delta_distance_km': (key[4] - original[4]) / 1000,
            'improves_lexicographic_objective': key < original,
        })
    result['local_alternatives'] = sorted(alternatives, key=lambda x: x['objective'])
    result['counterfactual_note'] = ('Если одиночный перенос не помогает, это не значит, '
                                     'что нельзя перестроить несколько маршрутов сразу.')
    return result
