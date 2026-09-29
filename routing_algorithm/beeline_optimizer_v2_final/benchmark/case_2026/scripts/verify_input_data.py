#!/usr/bin/env python3
"""Regenerate model inputs and verify their hashes against the committed manifest."""
from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
from pathlib import Path


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--root', default=Path(__file__).resolve().parents[1], type=Path)
    args = ap.parse_args()
    root = args.root.resolve()
    generated = root / 'reports/reproduced'
    generated.mkdir(parents=True, exist_ok=True)

    subprocess.run([
        sys.executable, str(root / 'scripts/prepare_case_data.py'),
        '--case-root', str(root / 'data/raw_case/beeline_case_csv'),
        '--out', str(generated / 'prepared'), '--seed', '42',
    ], check=True, cwd=root, stdout=subprocess.DEVNULL)
    subprocess.run([
        sys.executable, str(root / 'scripts/generate_synthetic_history.py'),
        '--rows', '12000', '--seed', '42',
        '--out', str(generated / 'synthetic_ml_history.csv'),
    ], check=True, cwd=root, stdout=subprocess.DEVNULL)

    expected = json.loads((root / 'EXPECTED_INPUT_SHA256.json').read_text(encoding='utf-8'))
    failures = []
    for relative, digest in expected.items():
        actual = root / relative
        if not actual.is_file() or hashlib.sha256(actual.read_bytes()).hexdigest() != digest:
            failures.append(relative)
    if failures:
        raise SystemExit('INPUT DATA MISMATCH: ' + ', '.join(failures))
    print(f'INPUT DATA REPRODUCTION OK ({len(expected)} files; case seed=42; ML seed=42)')


if __name__ == '__main__':
    main()
