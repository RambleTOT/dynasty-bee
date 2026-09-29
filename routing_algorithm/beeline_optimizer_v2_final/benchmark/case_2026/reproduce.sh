#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"
export PYTHONPATH="$(cd ../.. && pwd)${PYTHONPATH:+:$PYTHONPATH}"
PYTHON_BIN="${PYTHON_BIN:-python3}"
mkdir -p reports/rebuilt reports/reproduced reports/reproduced_model

echo '[1/7] Rebuild and verify the case and synthetic-ML inputs'
"$PYTHON_BIN" scripts/verify_input_data.py > reports/reproduced/inputs.log

echo '[2/7] Recalculate published metrics from the reference run outputs'
"$PYTHON_BIN" scripts/rebuild_metrics.py > reports/reproduced/rebuilt.log

echo '[3/7] Replay the historical assignment under the documented model'
"$PYTHON_BIN" scripts/evaluate_real_dispatcher.py > reports/reproduced/dispatcher.log

echo '[4/7] Retrain the synthetic demonstration ML model'
"$PYTHON_BIN" scripts/train_ml_risk.py reports/reproduced/synthetic_ml_history.csv \
  --out reports/reproduced_model --origin SYNTHETIC_DEMO_NOT_BEELINE \
  > reports/reproduced/ml_training.log

echo '[5/7] Run algorithm tests'
BEE_METRICS_MODEL_DIR="$PWD/reports/reproduced_model" \
BEE_METRICS_HISTORY_CSV="$PWD/reports/reproduced/synthetic_ml_history.csv" \
  "$PYTHON_BIN" -m pytest -q tests > reports/reproduced/pytest.log

echo '[6/7] Run the case, small-exact, urgent and synthetic-ML benchmarks'
"$PYTHON_BIN" scripts/benchmark_submission.py \
  --case-root data/raw_case/beeline_case_csv \
  --model-dir reports/reproduced_model \
  --out reports/reproduced/full_solver > reports/reproduced/full_solver.log

echo '[7/7] Verify the published numbers and rerun invariants'
"$PYTHON_BIN" scripts/verify_reproduction.py --full
tail -n 2 reports/reproduced/pytest.log
