from dispatch.demo import synthetic_instance
from dispatch.operations import plan, extend, check_constraints
from dispatch.production import ProductionConfig


def test_extend_returns_resource_curve():
    ins = synthetic_instance(8, 3, 777, 'mixed')
    result = plan(ins, ProductionConfig(seed=1, total_seconds=.4, warm_iterations=20, master_seconds=.1))
    curve = extend(ins, result.report, max_extra=1)
    assert curve[0]['k'] == 0
    assert len(curve) >= 1
    assert 0 <= curve[0]['coverage'] <= 100


def test_validator_reports_duplicate_and_not_only_generic_exception():
    ins = synthetic_instance(4, 2, 778, 'mixed')
    routes = [(0,), (0,)]
    v = check_constraints(ins, routes)
    assert any(x['code'] == 'DUPLICATE' for x in v)
