from __future__ import annotations

import itertools
import logging
import math
import re
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
        ShapePattern,
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
        ShapePattern,
        SuitCountRange,
    )

HANDS: Tuple[str, ...] = ("north", "south", "east", "west")
SUITS: Tuple[str, ...] = ("S", "H", "D", "C")
HONORS = {"A", "K", "Q", "J"}
logger = logging.getLogger("bridge_solver")


def calculate_conditional_probability(
    constraints_payload: Dict[str, dict],
    queries_payload: List[dict],
) -> dict:
    logger.info(
        "conditional_probability_calculate constraints=%s queries=%s",
        constraints_payload,
        queries_payload,
    )

    if _is_unrestricted_constraints(constraints_payload or {}):
        fast = _try_unrestricted_fast_path(queries_payload or [])
        if fast is not None:
            logger.info("conditional_probability_fast_path results=%s", fast)
            return fast

    conditions = _conditions_from_payload(constraints_payload or {})
    engine = ProbabilityEngine(conditions)
    denominator = engine._count_completions(
        engine.initial_state, engine._runtime
    )

    results = []
    for idx, raw_query in enumerate(queries_payload or []):
        name = str(raw_query.get("name") or f"Query {idx + 1}")
        event = _query_to_event(raw_query)
        numerator = engine._count_event(
            engine.initial_state, engine._runtime, event
        )
        results.append(_result_payload(name, numerator, denominator))

    logger.info("conditional_probability_results results=%s", results)
    return {
        "denominator": str(denominator),
        "engine": "exact_probability_engine",
        "results": results,
    }


def _try_unrestricted_fast_path(queries_payload: List[dict]) -> dict | None:
    hand_denominator = math.comb(52, 13)
    remaining_hands_multiplier = math.factorial(39) // (
        math.factorial(13) ** 3
    )
    denominator = hand_denominator * remaining_hands_multiplier
    results = []
    engine: ProbabilityEngine | None = None
    for idx, raw_query in enumerate(queries_payload):
        name = str(raw_query.get("name") or f"Query {idx + 1}")
        atom = raw_query.get("a") or {}
        is_fast_shape = (
            str(raw_query.get("join") or "single").lower() == "single"
            and isinstance(atom, Mapping)
            and str(atom.get("type") or "").lower() == "shape"
        )
        if is_fast_shape:
            numerator = (
                _unrestricted_shape_count(str(atom.get("value") or ""))
                * remaining_hands_multiplier
            )
        else:
            if engine is None:
                engine = ProbabilityEngine({})
            event = _query_to_event(raw_query)
            numerator = engine._count_event(
                engine.initial_state, engine._runtime, event
            )
        results.append(_result_payload(name, numerator, denominator))
    return {
        "denominator": str(denominator),
        "engine": "exact_probability_engine",
        "results": results,
    }


def _result_payload(name: str, numerator: int, denominator: int) -> dict:
    return {
        "name": name,
        "numerator": str(numerator),
        "probability": 0.0 if denominator == 0 else numerator / denominator,
        "fraction": f"{numerator}/{denominator}" if denominator else "0/0",
    }


def _unrestricted_shape_count(value: str) -> int:
    text = value.strip().upper().replace(" ", "")
    explicit = re.findall(r"([SHDC])\s*([0-9]{1,2})", text)
    if explicit:
        consumed = "".join(f"{suit}{length}" for suit, length in explicit)
        if consumed != text:
            raise ValueError("Shape must be like 4-3-3-2, S5, or S5H4.")
        seen_suits = set()
        specified_total = 0
        ways = 1
        for suit, raw_length in explicit:
            if suit in seen_suits:
                raise ValueError(f"Duplicate suit in shape query: {suit}")
            seen_suits.add(suit)
            length = int(raw_length)
            if not 0 <= length <= 13:
                raise ValueError("Suit length must be between 0 and 13.")
            specified_total += length
            ways *= math.comb(13, length)
        remaining_suits = 4 - len(seen_suits)
        remaining_cards = 13 - specified_total
        if remaining_cards < 0:
            return 0
        return ways * _ways_from_unspecified_suits(
            remaining_suits, remaining_cards
        )

    shape = tuple(sorted(_parse_shape(text), reverse=True))
    if sum(shape) != 13:
        return 0
    permutations = len(set(itertools.permutations(shape)))
    ways = permutations
    for length in shape:
        ways *= math.comb(13, length)
    return ways


def _ways_from_unspecified_suits(suit_count: int, card_count: int) -> int:
    if suit_count == 0:
        return 1 if card_count == 0 else 0
    total = 0
    for lengths in _bounded_compositions(card_count, suit_count, 13):
        ways = 1
        for length in lengths:
            ways *= math.comb(13, length)
        total += ways
    return total


def _bounded_compositions(
    total: int, parts: int, cap: int
) -> Iterable[Tuple[int, ...]]:
    if parts == 0:
        if total == 0:
            yield ()
        return
    if parts == 1:
        if 0 <= total <= cap:
            yield (total,)
        return
    lo = max(0, total - cap * (parts - 1))
    hi = min(cap, total)
    for first in range(lo, hi + 1):
        for rest in _bounded_compositions(total - first, parts - 1, cap):
            yield (first,) + rest


def _is_unrestricted_constraints(payload: Mapping[str, dict]) -> bool:
    for hand in HANDS:
        raw = payload.get(hand, {}) or {}
        if raw.get("knownCards"):
            return False
        if str(raw.get("mode") or "feature").lower() != "feature":
            return False
        hcp = raw.get("hcp") or {}
        if (
            _read_int(hcp.get("min"), 0) != 0
            or _read_int(hcp.get("max"), 37) != 37
        ):
            return False
        suit_ranges = raw.get("suitRanges") or []
        for idx in range(4):
            suit_range = suit_ranges[idx] if idx < len(suit_ranges) else {}
            if _read_int(suit_range.get("min"), 0) != 0:
                return False
            if _read_int(suit_range.get("max"), 13) != 13:
                return False
    return True


def _conditions_from_payload(
    payload: Mapping[str, dict],
) -> Dict[str, HandCondition]:
    conditions: Dict[str, HandCondition] = {}
    for hand in HANDS:
        raw = payload.get(hand, {}) or {}
        known_cards = tuple(
            _normalize_card(card) for card in raw.get("knownCards", []) or []
        )
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
            raise ValueError(
                "Rank-only queries are not enabled in the frontend endpoint yet. Use a specific card such as SA."
            )
        return CardInHand(_normalize_card(token), hand)
    if atom_type == "shape":
        return _parse_shape_event(hand, value)

    raise ValueError(f"Unsupported query type: {atom_type}")


def _parse_shape_event(hand: str, value: str) -> Event:
    text = value.strip().upper().replace(" ", "")
    explicit = re.findall(r"([SHDC])\s*([0-9]{1,2})", text)
    if explicit:
        consumed = "".join(f"{suit}{length}" for suit, length in explicit)
        if consumed != text:
            raise ValueError("Shape must be like 4-3-3-2, S5, or S5H4.")
        events = []
        seen_suits = set()
        for suit, raw_length in explicit:
            if suit in seen_suits:
                raise ValueError(f"Duplicate suit in shape query: {suit}")
            seen_suits.add(suit)
            length = int(raw_length)
            if not 0 <= length <= 13:
                raise ValueError("Suit length must be between 0 and 13.")
            events.append(SuitCountRange(hand, suit, length, length))
        return events[0] if len(events) == 1 else AndEvent(tuple(events))

    return ShapePattern(hand, tuple(sorted(_parse_shape(text), reverse=True)))


def _parse_int_range(
    value: str, minimum: int, maximum: int
) -> Tuple[int, int]:
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
    if len(nums) != 4:
        raise ValueError("Shape must contain four suit lengths.")
    if any(length < 0 or length > 13 for length in nums):
        raise ValueError("Each shape length must be between 0 and 13.")
    return nums


def _normalize_card(raw: object) -> str:
    card = str(raw or "").strip().upper().replace("10", "T")
    if (
        len(card) != 2
        or card[0] not in SUITS
        or card[1] not in "AKQJT98765432"
    ):
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
