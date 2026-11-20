"""
anomaly.py
==========
Backward-compatible facade redirecting to the modular backend/anomaly package.
"""

from anomaly.engine import AnomalyEngine, AnomalyResult
from anomaly.thresholds import ThresholdEvaluator
from anomaly.patterns import PatternEvaluator
from anomaly.communication import CommunicationEvaluator

__all__ = [
    "AnomalyEngine",
    "AnomalyResult",
    "ThresholdEvaluator",
    "PatternEvaluator",
    "CommunicationEvaluator",
]
