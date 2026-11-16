from dataclasses import dataclass
from datetime import datetime, timezone
from math import isfinite
from pathlib import Path
from typing import Any, Optional

from .confidence import evaluate_confidence
from .document import Document, load_document
from .errors import KnowledgeError


SECONDS_PER_UNIT = {
    "second": 1.0,
    "minute": 60.0,
    "hour": 3600.0,
    "day": 86400.0,
}


@dataclass(frozen=True)
class Policy:
    time_unit: str
    alpha: float
    beta: float
    horizon: float
    connection_target: Optional[int] = None


@dataclass(frozen=True)
class Investment:
    confidence: float
    consistency: float
    connection: Optional[float] = None
    fulfilled: int = 0
    open: int = 0
    qualifying_links: int = 0

    @property
    def total(self) -> float:
        result = self.confidence * self.consistency
        return result if self.connection is None else result * self.connection


def connection_score(
    fulfilled: int, open_count: int, links: int, target: int
) -> float:
    if any(value < 0 for value in (fulfilled, open_count, links)):
        raise KnowledgeError("connection counts must be nonnegative")
    if target <= 0:
        raise KnowledgeError("investment.connection.target must be positive")
    coverage = (
        fulfilled / (fulfilled + open_count)
        if fulfilled + open_count else 1.0
    )
    breadth = (fulfilled + links) / (
        fulfilled + links + max(target - links, 0)
    )
    return coverage * breadth


def as_datetime(value: Any, field: str) -> datetime:
    if isinstance(value, datetime):
        result = value
    elif isinstance(value, str):
        try:
            result = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError as exc:
            raise KnowledgeError(
                f"{field}: invalid ISO 8601 datetime"
            ) from exc
    else:
        raise KnowledgeError(f"{field}: expected ISO 8601 datetime")
    if result.tzinfo is None:
        raise KnowledgeError(f"{field}: UTC offset is required")
    return result.astimezone(timezone.utc)


def load_policy(root: Path) -> Policy:
    index = load_document(root / "index.md")
    try:
        raw = index.metadata["investment"]["consistency"]
        model = raw["model"]
        unit = raw["time_unit"]
        alpha = float(raw["alpha"])
        beta = float(raw["beta"])
        horizon = float(raw["horizon"])
    except (KeyError, TypeError, ValueError) as exc:
        raise KnowledgeError(
            f"{index.path}: invalid investment.consistency policy"
        ) from exc
    if model != "gamma-poisson":
        raise KnowledgeError(
            f"{index.path}: unsupported consistency model: {model}"
        )
    if unit not in SECONDS_PER_UNIT:
        raise KnowledgeError(f"{index.path}: unsupported time_unit: {unit}")
    if any(
        not isfinite(value) or value <= 0 for value in (alpha, beta, horizon)
    ):
        raise KnowledgeError(
            f"{index.path}: alpha, beta, and horizon must be positive"
        )
    investment_policy = index.metadata["investment"]
    target = None
    if "connection" in investment_policy:
        connection = investment_policy["connection"]
        if not isinstance(connection, dict):
            raise KnowledgeError(
                f"{index.path}: investment.connection must be a mapping"
            )
        target = connection.get("target")
        if type(target) is not int or target <= 0:
            raise KnowledgeError(
                f"{index.path}: investment.connection.target must be "
                "a positive integer"
            )
    return Policy(unit, alpha, beta, horizon, target)


def history_inputs(
    document: Document, policy: Policy, as_of: datetime
) -> tuple:
    history = document.metadata.get("history")
    if not isinstance(history, dict):
        raise KnowledgeError(f"{document.path}: missing history mapping")
    start = as_datetime(
        history.get("created"), "history.created"
    )
    updates = history.get("updates")
    if not isinstance(updates, list):
        raise KnowledgeError(
            f"{document.path}: history.updates must be a list"
        )
    parsed = [
        as_datetime(value, f"history.updates[{i}]")
        for i, value in enumerate(updates)
    ]
    if parsed != sorted(parsed):
        raise KnowledgeError(
            f"{document.path}: history.updates must be ordered"
        )
    if any(value <= start for value in parsed):
        raise KnowledgeError(
            f"{document.path}: every update must follow history.created"
        )
    if as_of < start or any(value > as_of for value in parsed):
        raise KnowledgeError(
            f"{document.path}: history extends beyond evaluation time"
        )
    exposure = (
        (as_of - start).total_seconds() / SECONDS_PER_UNIT[policy.time_unit]
    )
    return len(parsed), exposure


def evaluate(root: Path, document: Document, as_of: datetime) -> Investment:
    if document.metadata.get("type") != "Concept":
        raise KnowledgeError(
            f"{document.path}: investment applies only to Concept documents"
        )
    policy = load_policy(root)
    updates, exposure = history_inputs(document, policy, as_of)
    consistency = (
        (policy.beta + exposure)
        / (policy.beta + exposure + policy.horizon)
    ) ** (policy.alpha + updates)
    confidence = evaluate_confidence(root, document).score(document)
    if policy.connection_target is None:
        return Investment(confidence, consistency)
    from .ontology import connection_counts

    fulfilled, open_count, links = connection_counts(root, document)
    connection = connection_score(
        fulfilled, open_count, links, policy.connection_target
    )
    return Investment(
        confidence, consistency, connection, fulfilled, open_count, links
    )
