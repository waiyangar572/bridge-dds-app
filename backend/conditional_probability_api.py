from __future__ import annotations

import re
from fractions import Fraction
from typing import Dict, Iterable, List, Mapping, Sequence, Tuple

try:
    from .exact_probability_engine import (
        AndEvent,
        CardInHand,
        Event,
        HandCondition,
        HcpRange,
        OrEvent,
        ProbabilityEngine,
        SuitCountRange,
    )
except ImportError:
    from exact_probability_engine import (
        AndEvent,
        CardInHand,
        Event,
        HandCondition,
        HcpRange,
        OrEvent,
        ProbabilityEngine,
        SuitCountRange,
    )

HANDS: Tuple[str, ...] = ("north", "south", "east", "west")
SUITS: Tuple[str, ...] = ("S", "H", "D", "C")
HONORS = {"A", "K", "Q", "J"}


def calculate_conditional_probability(
    constraints_payload: Dict[str, dict],
    queries_payload: List[dict],
) -> dict:
    conditions = _conditions_from_payload(constraints_payload or {})
    engine = ProbabilityEngine(conditions)
    denominator = engine._count_completions(engine.initial_state, engine._runtime)

    results = []
    for idx, raw_query in enumerate(queries_payload or []):
        name = str(raw_query.get("name") or f"Query {idx + 1}")
        event = _query_to_event(raw_query)
        numerator = engine._count_event(engine.initial_state, engine._runtime, event)
        probability = 0.0 if denominator == 0 else float(Fraction(numerator, denominator))
        results.append(
            {
                "name": name,
                "numerator": str(numerator),
                "probability": probability,
                "fraction": f"{numerator}/{denominator}" if denominator else "0/0",
            }
        )

    return {
        "denominator": str(denominator),
        "engine": "exact_probability_engine",
        "results": results,
    }


def _conditions_from_payload(payload: Mapping[str, dict]) -> Dict[str, HandCondition]:
    conditions: Dict[str, HandCondition] = {}
    for hand in HANDS:
        raw = payload.get(hand, {}) or {}
        known_cards = tuple(_normalize_card(card) for card in raw.get("knownCards", []) or [])
        mode = str(raw.get("mode") or "feature").lower()
        if mode == "hand":
            conditions[hand] = HandCondition.hand(known_cards)
            continue

        hcp = raw.get("hcp") or {}
        suit_ranges = raw.get("suitRanges") or []
        mins = []
        maxes = []
        for idx in range(4):
            suit_range = suit_ranges[idx] if idx < len(suit_ranges) else {}
            mins.append(_read_int(suit_range.get("min"), 0))
            maxes.append(_read_int(suit_range.get("max"), 13))
        conditions[hand] = HandCondition.feature(
            required_cards=known_cards,
            shape_min=mins,
            shape_max=maxes,
            hcp_min=_read_int(hcp.get("min"), 0),
            hcp_max=_read_int(hcp.get("max"), 37),
        )
    return conditions


def _query_to_event(raw_query: Mapping[str, object]) -> Event:
    join = str(raw_query.get("join") or "single").lower()
    first = _atom_to_event(raw_query.get("a") or {})
    if join == "single":
        return first
    second = _atom_to_event(raw_query.get("b") or {})
    if join == "or":
        return OrEvent((first, second))
    return AndEvent((first, second))


def _atom_to_event(raw_atom: object) -> Event:
    if not isinstance(raw_atom, Mapping):
        raise ValueError("Invalid query atom.")
    hand = _normalize_hand(str(raw_atom.get("hand") or ""))
    atom_type = str(raw_atom.get("type") or "").lower()
    value = str(raw_atom.get("value") or "").strip()

    if atom_type == "hcp":
        lo, hi = _parse_int_range(value, 0, 37)
        return HcpRange(hand, lo, hi)
    if atom_type == "card":
        token = value.strip().upper().replace("10", "T")
        if token in HONORS:
            raise ValueError("Rank-only queries are not enabled in the frontend endpoint yet. Use a specific card such as SA.")
        return CardInHand(_normalize_card(token), hand)
    if atom_type == "shape":
        raise ValueError(
            "Shape query events are not enabled in the exact frontend endpoint yet. "
            "Use the per-suit length ranges in the hand conditions instead."
        )

    raise ValueError(f"Unsupported query type: {atom_type}")


def _parse_int_range(value: str, minimum: int, maximum: int) -> Tuple[int, int]:
    parts = [part for part in re.split(r"[-,\s]+", value.strip()) if part]
    if not parts:
        raise ValueError("Range is empty.")
    left = int(parts[0])
    right = int(parts[1]) if len(parts) > 1 else left
    if left > right:
        left, right = right, left
    if left < minimum or right > maximum:
        raise ValueError(f"Range must be between {minimum} and {maximum}.")
    return left, right


def _parse_shape(value: str) -> Tuple[int, int, int, int]:
    nums = tuple(int(part) for part in re.findall(r"\d+", value))
    if len(nums) != 4 or sum(nums) != 13:
        raise ValueError("Shape must contain four suit lengths totaling 13.")
    return nums


def _normalize_card(raw: object) -> str:
    card = str(raw or "").strip().upper().replace("10", "T")
    if len(card) != 2 or card[0] not in SUITS or card[1] not in "AKQJT98765432":
        raise ValueError(f"Invalid card notation: {raw}")
    return card


def _normalize_hand(raw: str) -> str:
    hand = raw.strip().lower()
    aliases = {"n": "north", "s": "south", "e": "east", "w": "west"}
    hand = aliases.get(hand, hand)
    if hand not in HANDS:
        raise ValueError(f"Unknown hand: {raw}")
    return hand


def _read_int(value: object, default: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default
