from __future__ import annotations

from fractions import Fraction
import re
from typing import Any

try:
    from .event_inference import apply_event, calculate_conditional_prob
    from .event_probability import EvaluationState
    from .events import AndEvent, BaseEvent, CardHoldingEvent, HcpEvent, ShapePatternEvent, SuitLengthEvent
except ImportError:
    from event_inference import apply_event, calculate_conditional_prob
    from event_probability import EvaluationState
    from events import AndEvent, BaseEvent, CardHoldingEvent, HcpEvent, ShapePatternEvent, SuitLengthEvent


HAND_TO_PLAYER = {
    "north": "N",
    "south": "S",
    "east": "E",
    "west": "W",
    "n": "N",
    "s": "S",
    "e": "E",
    "w": "W",
}
SUIT_ORDER = ("S", "H", "D", "C")
SHAPE_TOKEN_RE = re.compile(r"([SHDC])\s*(\d+(?:\s*-\s*\d+)?)", re.IGNORECASE)


def calculate_conditional_probability(
    constraints: dict[str, Any],
    queries: list[dict[str, Any]],
) -> dict[str, Any]:
    """Compatibility layer for /api/conditional_probability.

    The frontend payload is translated into the Event AST introduced for the
    exact probability engine. Known card constraints and exact suit lengths are
    materialized into EvaluationState; query events are evaluated with the
    recursive inference engine.
    """

    state, constraint_event = _build_constraint_context(constraints)
    results = []
    for index, query in enumerate(queries):
        target = _query_to_event(query)
        probability = calculate_conditional_prob(target, constraint_event, state)
        fraction = Fraction(probability).limit_denominator(10**12)
        results.append(
            {
                "name": query.get("name") or f"Query {index + 1}",
                "probability": probability,
                "numerator": str(fraction.numerator),
                "fraction": f"{fraction.numerator}/{fraction.denominator}",
            }
        )

    return {
        "engine": "event-inference",
        "denominator": "varies",
        "results": results,
    }


def _build_constraint_context(
    constraints: dict[str, Any],
) -> tuple[EvaluationState, BaseEvent | None]:
    state = EvaluationState()
    event_constraints: list[BaseEvent] = []
    deferred_hcp_constraints: list[BaseEvent] = []

    for hand, raw_constraint in constraints.items():
        player = _parse_player(hand)
        constraint = raw_constraint or {}

        for card in constraint.get("knownCards", []) or []:
            state = apply_event(state, CardHoldingEvent(player, _normalize_card(card)))

        exact_suit_events = []
        for suit, range_data in zip(SUIT_ORDER, constraint.get("suitRanges", []) or []):
            min_len, max_len = _range_from_payload(range_data, 0, 13)
            if min_len == 0 and max_len == 13:
                continue
            event = SuitLengthEvent(player, suit, min_len, max_len)
            if min_len == max_len:
                exact_suit_events.append(event)
            else:
                event_constraints.append(event)

        for event in exact_suit_events:
            state = apply_event(state, event)

        hcp_min, hcp_max = _range_from_payload(constraint.get("hcp"), 0, 37)
        if hcp_min != 0 or hcp_max != 37:
            deferred_hcp_constraints.append(HcpEvent(player, hcp_min, hcp_max))

    all_constraints = event_constraints + deferred_hcp_constraints
    if not all_constraints:
        return state, None
    if len(all_constraints) == 1:
        return state, all_constraints[0]
    return state, AndEvent.of(*all_constraints)


def _query_to_event(query: dict[str, Any]) -> BaseEvent:
    join = (query.get("join") or "single").lower()
    first = _atom_to_event(query.get("a") or {})
    if join == "single":
        return first

    second = _atom_to_event(query.get("b") or {})
    if join == "and":
        return first & second
    if join == "or":
        return first | second
    raise ValueError(f"unsupported query join: {join!r}")


def _atom_to_event(atom: dict[str, Any]) -> BaseEvent:
    player = _parse_player(atom.get("hand"))
    event_type = (atom.get("type") or "").lower()
    value = str(atom.get("value") or "").strip()
    if not value:
        raise ValueError("query value is required")

    if event_type == "card":
        return CardHoldingEvent(player, _normalize_card(value))
    if event_type == "hcp":
        min_hcp, max_hcp = _parse_range_text(value, 0, 37)
        return HcpEvent(player, min_hcp, max_hcp)
    if event_type == "shape":
        return _shape_value_to_event(player, value)
    raise ValueError(f"unsupported query type: {event_type!r}")


def _shape_value_to_event(player: str, value: str) -> BaseEvent:
    normalized = value.upper().replace(" ", "")
    events: list[BaseEvent] = []

    if "-" in normalized and not any(suit in normalized for suit in SUIT_ORDER):
        parts = normalized.split("-")
        if len(parts) != 4:
            raise ValueError("shape pattern must have four parts, e.g. 4-3-3-3")
        return ShapePatternEvent(player, tuple(int(part) for part in parts))
    else:
        for suit, raw_range in SHAPE_TOKEN_RE.findall(normalized):
            min_len, max_len = _parse_range_text(raw_range, 0, 13)
            events.append(SuitLengthEvent(player, suit.upper(), min_len, max_len))

    if not events:
        raise ValueError(f"could not parse shape value: {value!r}")
    if len(events) == 1:
        return events[0]
    return AndEvent.of(*events)


def _parse_player(hand: Any) -> str:
    key = str(hand or "").strip().lower()
    try:
        return HAND_TO_PLAYER[key]
    except KeyError as exc:
        raise ValueError(f"unknown hand/player: {hand!r}") from exc


def _normalize_card(card: Any) -> str:
    normalized = str(card or "").strip().upper()
    if len(normalized) != 2:
        raise ValueError(f"invalid card: {card!r}")
    return normalized


def _range_from_payload(payload: Any, fallback_min: int, fallback_max: int) -> tuple[int, int]:
    if payload is None:
        return fallback_min, fallback_max
    if isinstance(payload, dict):
        return int(payload.get("min", fallback_min)), int(payload.get("max", fallback_max))
    return _parse_range_text(str(payload), fallback_min, fallback_max)


def _parse_range_text(text: str, fallback_min: int, fallback_max: int) -> tuple[int, int]:
    normalized = str(text or "").strip().replace(" ", "")
    if not normalized:
        return fallback_min, fallback_max
    if "-" not in normalized:
        value = int(normalized)
        return value, value
    left, right = normalized.split("-", 1)
    return int(left or fallback_min), int(right or fallback_max)
