"""Планировщик выездных инженеров для кейса «Билайн Бизнес».

Основной вход для бэкенда — dispatch.operations (plan, baseline_fifo, handle_urgent и др.).
"""
from .evaluate import Evaluator, baseline
from .hybrid import HybridConfig, solve_hybrid
from .hybrid_v2 import HybridV2Config, solve_hybrid_v2
from .model import Engineer, Instance, Task
from .production import ProductionConfig, solve_production
from .search import SearchConfig, solve

__all__ = ['Instance', 'Task', 'Engineer', 'Evaluator', 'baseline', 'solve', 'SearchConfig',
           'solve_hybrid', 'HybridConfig', 'solve_hybrid_v2', 'HybridV2Config',
           'solve_production', 'ProductionConfig']
