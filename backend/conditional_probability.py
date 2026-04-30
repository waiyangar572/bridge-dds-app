from __future__ import annotations

import math
import re
from dataclasses import dataclass
from typing import Dict, List, Set, Tuple

HANDS: Tuple[str, ...] = ("north", "south", "east", "west")
HAND_INDEX = {hand: idx for idx, hand in enumerate(HANDS)}

SUITS: Tuple[str, ...] = ("S", "H", "D", "C")
SUIT_INDEX = {suit: idx for idx, suit in enumerate(SUITS)}

HONORS: Tuple[str, ...] = ("A", "K", "Q", "J")
BUCKET_RANKS: Tuple[str, ...] = ("A", "K", "Q", "J", "x")
RANK_POINTS = {"A": 4, "K": 3, "Q": 2, "J": 1, "x": 0}

POINT_ORDER_DESC = (4, 3, 2, 1, 0)
POINT_ORDER_ASC = (0, 1, 2, 3, 4)


@dataclass(frozen=True)
class HandConstraint:
    mode: str
    known_cards: Tuple[str, ...]
    hcp: Tuple[int, int]
    suit_ranges: Tuple[Tuple[int, int], ...]


@dataclass(frozen=True)
class QueryAtom:
    kind: str
    hand_idx: int = -1
    min_value: int = 0
    max_value: int = 0
    shape: Tuple[int, int, int, int] = (0, 0, 0, 0)
    suit_idx: int = -1
    rank: str = ""


@dataclass(frozen=True)
class Query:
    name: str
    join: str
    a: QueryAtom
    b: QueryAtom


def calculate_conditional_probability(
    constraints_payload: Dict[str, dict],
    queries_payload: List[dict],
) -> dict:
    constraints = _normalize_constraints(constraints_payload or {})

    known_cards_by_hand = [set() for _ in HANDS]
    known_owner: Dict[str, int] = {}
    known_hcp = [0, 0, 0, 0]
    known_suit_counts = [[0, 0, 0, 0] for _ in HANDS]
    known_rank_presence = [{rank: False for rank in HONORS} for _ in HANDS]

    bucket_defs = _bucket_definitions()
    bucket_counts = _initial_bucket_counts()

    for hand_idx, hand in enumerate(HANDS):
        for raw_card in constraints[hand].known_cards:
            card = _normalize_card(raw_card)
            if card in known_owner:
                raise ValueError(f"Duplicate known card: {card}")
            known_owner[card] = hand_idx
            known_cards_by_hand[hand_idx].add(card)

            suit_idx = SUIT_INDEX[card[0]]
            rank = card[1]
            known_hcp[hand_idx] += _card_hcp(rank)
            known_suit_counts[hand_idx][suit_idx] += 1
            if rank in HONORS:
                known_rank_presence[hand_idx][rank] = True

            bucket_idx = _bucket_index_for_card(card)
            bucket_counts[bucket_idx] -= 1
            if bucket_counts[bucket_idx] < 0:
                raise ValueError(f"Invalid known cards for bucket count: {card}")

    remaining_needs = [13 - len(known_cards_by_hand[idx]) for idx in range(4)]
    if any(need < 0 for need in remaining_needs):
        raise ValueError("Each hand must have at most 13 known cards.")
    if sum(remaining_needs) != sum(bucket_counts):
        raise ValueError("Known cards are inconsistent with a 52-card deck.")

    hcp_constraints: List[Tuple[int, int, int]] = []
    suit_constraints: List[Tuple[int, int, int, int]] = []
    tracked_hcp_hands: Set[int] = set()
    tracked_suit_fields: Set[Tuple[int, int]] = set()
    tracked_specific_cards: Set[Tuple[int, int, str]] = set()
    tracked_rank_presence: Set[Tuple[int, str]] = set()

    for hand_idx, hand in enumerate(HANDS):
        constraint = constraints[hand]
        if constraint.mode == "hand":
            if len(constraint.known_cards) != 13:
                raise ValueError(f"{hand} full hand mode requires exactly 13 known cards.")
            continue

        hcp_min, hcp_max = constraint.hcp
        if not (0 <= hcp_min <= hcp_max <= 37):
            raise ValueError(f"Invalid HCP range for {hand}: {hcp_min}-{hcp_max}")
        if (hcp_min, hcp_max) != (0, 37):
            hcp_constraints.append((hand_idx, hcp_min, hcp_max))
            tracked_hcp_hands.add(hand_idx)

        for suit_idx, (suit_min, suit_max) in enumerate(constraint.suit_ranges):
            if not (0 <= suit_min <= suit_max <= 13):
                raise ValueError(
                    f"Invalid suit range for {hand} {SUITS[suit_idx]}: {suit_min}-{suit_max}"
                )
            if (suit_min, suit_max) != (0, 13):
                suit_constraints.append((hand_idx, suit_idx, suit_min, suit_max))
                tracked_suit_fields.add((hand_idx, suit_idx))

    queries = _compile_queries(
        queries_payload or [],
        tracked_hcp_hands,
        tracked_suit_fields,
        tracked_specific_cards,
        tracked_rank_presence,
    )

    suit_pressure = [0, 0, 0, 0]
    for _, suit_idx, min_v, max_v in suit_constraints:
        suit_pressure[suit_idx] += 13 - (max_v - min_v)

    bucket_order = sorted(
        range(len(bucket_defs)),
        key=lambda idx: _bucket_priority(
            bucket_defs[idx][0],
            bucket_defs[idx][1],
            bucket_counts[idx],
            suit_pressure,
        ),
    )
    ordered_bucket_defs = [bucket_defs[idx] for idx in bucket_order]
    ordered_bucket_counts = [bucket_counts[idx] for idx in bucket_order]
    bucket_count = len(ordered_bucket_defs)

    hcp_order = sorted(tracked_hcp_hands)
    suit_order = sorted(tracked_suit_fields)
    specific_order = sorted(tracked_specific_cards)
    rank_order = sorted(tracked_rank_presence)

    base_offset = 3  # rem_n, rem_s, rem_e
    hcp_state_idx = {
        hand_idx: base_offset + pos for pos, hand_idx in enumerate(hcp_order)
    }
    suit_state_idx = {
        key: base_offset + len(hcp_order) + pos
        for pos, key in enumerate(suit_order)
    }
    specific_offset = base_offset + len(hcp_order) + len(suit_order)
    specific_state_idx = {
        key: specific_offset + pos for pos, key in enumerate(specific_order)
    }
    rank_offset = specific_offset + len(specific_order)
    rank_state_idx = {
        key: rank_offset + pos for pos, key in enumerate(rank_order)
    }

    state_initial = [remaining_needs[0], remaining_needs[1], remaining_needs[2]]
    state_initial.extend(known_hcp[hand_idx] for hand_idx in hcp_order)
    state_initial.extend(
        known_suit_counts[hand_idx][suit_idx] for hand_idx, suit_idx in suit_order
    )
    for hand_idx, suit_idx, rank in specific_order:
        card = SUITS[suit_idx] + rank
        state_initial.append(1 if card in known_cards_by_hand[hand_idx] else 0)
    for hand_idx, rank in rank_order:
        state_initial.append(1 if known_rank_presence[hand_idx][rank] else 0)
    initial_state = tuple(state_initial)

    remaining_total = [0] * (bucket_count + 1)
    remaining_suits = [[0, 0, 0, 0] for _ in range(bucket_count + 1)]
    remaining_points = [[0, 0, 0, 0, 0] for _ in range(bucket_count + 1)]
    point_to_idx = {4: 0, 3: 1, 2: 2, 1: 3, 0: 4}

    for idx in range(bucket_count - 1, -1, -1):
        suit_idx, _, points = ordered_bucket_defs[idx]
        amount = ordered_bucket_counts[idx]
        remaining_total[idx] = remaining_total[idx + 1] + amount
        for suit in range(4):
            remaining_suits[idx][suit] = remaining_suits[idx + 1][suit]
        remaining_suits[idx][suit_idx] += amount
        for p_idx in range(5):
            remaining_points[idx][p_idx] = remaining_points[idx + 1][p_idx]
        remaining_points[idx][point_to_idx[points]] += amount

    hcp_constraints_idx = [
        (hand_idx, min_v, max_v, hcp_state_idx[hand_idx])
        for hand_idx, min_v, max_v in hcp_constraints
    ]
    suit_constraints_idx = [
        (hand_idx, suit_idx, min_v, max_v, suit_state_idx[(hand_idx, suit_idx)])
        for hand_idx, suit_idx, min_v, max_v in suit_constraints
    ]

    hcp_field_per_hand = [hcp_state_idx.get(hand_idx, -1) for hand_idx in range(4)]
    suit_field_per_hand = [
        [suit_state_idx.get((hand_idx, suit_idx), -1) for suit_idx in range(4)]
        for hand_idx in range(4)
    ]

    bucket_specific_fields: List[List[int]] = []
    bucket_rank_fields: List[List[int]] = []
    for suit_idx, rank, _ in ordered_bucket_defs:
        if rank in HONORS:
            bucket_specific_fields.append(
                [
                    specific_state_idx.get((hand_idx, suit_idx, rank), -1)
                    for hand_idx in range(4)
                ]
            )
            bucket_rank_fields.append(
                [rank_state_idx.get((hand_idx, rank), -1) for hand_idx in range(4)]
            )
        else:
            bucket_specific_fields.append([-1, -1, -1, -1])
            bucket_rank_fields.append([-1, -1, -1, -1])

    def get_hcp(hand_idx: int, state: Tuple[int, ...]) -> int:
        field_idx = hcp_state_idx.get(hand_idx)
        if field_idx is None:
            return known_hcp[hand_idx]
        return state[field_idx]

    def get_suit_count(hand_idx: int, suit_idx: int, state: Tuple[int, ...]) -> int:
        field_idx = suit_state_idx.get((hand_idx, suit_idx))
        if field_idx is None:
            return known_suit_counts[hand_idx][suit_idx]
        return state[field_idx]

    def has_specific_card(hand_idx: int, suit_idx: int, rank: str, state: Tuple[int, ...]) -> bool:
        field_idx = specific_state_idx.get((hand_idx, suit_idx, rank))
        if field_idx is None:
            return (SUITS[suit_idx] + rank) in known_cards_by_hand[hand_idx]
        return state[field_idx] == 1

    def has_rank(hand_idx: int, rank: str, state: Tuple[int, ...]) -> bool:
        field_idx = rank_state_idx.get((hand_idx, rank))
        if field_idx is None:
            return known_rank_presence[hand_idx][rank]
        return state[field_idx] == 1

    def hcp_bounds(rem_cards: int, point_counts: List[int]) -> Tuple[int, int]:
        if rem_cards <= 0:
            return 0, 0
        count_by_points = {
            4: point_counts[0],
            3: point_counts[1],
            2: point_counts[2],
            1: point_counts[3],
            0: point_counts[4],
        }

        max_add = 0
        take = rem_cards
        for point in POINT_ORDER_DESC:
            if take == 0:
                break
            amount = min(take, count_by_points[point])
            max_add += amount * point
            take -= amount

        min_add = 0
        take = rem_cards
        for point in POINT_ORDER_ASC:
            if take == 0:
                break
            amount = min(take, count_by_points[point])
            min_add += amount * point
            take -= amount
        return min_add, max_add

    def violates_pruning(next_state: Tuple[int, ...], next_layer_idx: int) -> bool:
        rem_n, rem_s, rem_e = next_state[0], next_state[1], next_state[2]
        if rem_n < 0 or rem_s < 0 or rem_e < 0:
            return True

        rem_total = remaining_total[next_layer_idx]
        rem_w = rem_total - rem_n - rem_s - rem_e
        if rem_w < 0:
            return True
        rem_by_hand = (rem_n, rem_s, rem_e, rem_w)

        point_counts = remaining_points[next_layer_idx]
        for hand_idx, min_hcp, max_hcp, state_idx in hcp_constraints_idx:
            current = next_state[state_idx]
            min_add, max_add = hcp_bounds(rem_by_hand[hand_idx], point_counts)
            if current + min_add > max_hcp or current + max_add < min_hcp:
                return True

        for hand_idx, suit_idx, min_len, max_len, state_idx in suit_constraints_idx:
            current = next_state[state_idx]
            hand_remaining = rem_by_hand[hand_idx]
            suit_remaining = remaining_suits[next_layer_idx][suit_idx]
            non_suit_remaining = rem_total - suit_remaining
            min_possible = current + max(0, hand_remaining - non_suit_remaining)
            max_possible = current + min(hand_remaining, suit_remaining)
            if min_possible > max_len or max_possible < min_len:
                return True

        return False

    def base_constraints_satisfied(state: Tuple[int, ...]) -> bool:
        for _, min_hcp, max_hcp, state_idx in hcp_constraints_idx:
            value = state[state_idx]
            if value < min_hcp or value > max_hcp:
                return False
        for _, _, min_len, max_len, state_idx in suit_constraints_idx:
            value = state[state_idx]
            if value < min_len or value > max_len:
                return False
        return True

    def atom_matches(atom: QueryAtom, state: Tuple[int, ...]) -> bool:
        if atom.kind == "always_false":
            return False
        if atom.kind == "hcp":
            hcp = get_hcp(atom.hand_idx, state)
            return atom.min_value <= hcp <= atom.max_value
        if atom.kind == "shape":
            counts = [get_suit_count(atom.hand_idx, suit_idx, state) for suit_idx in range(4)]
            counts.sort(reverse=True)
            return tuple(counts) == atom.shape
        if atom.kind == "specific_card":
            return has_specific_card(atom.hand_idx, atom.suit_idx, atom.rank, state)
        if atom.kind == "rank_presence":
            return has_rank(atom.hand_idx, atom.rank, state)
        return False

    def query_matches(query: Query, state: Tuple[int, ...]) -> bool:
        first = atom_matches(query.a, state)
        if query.join == "single":
            return first
        second = atom_matches(query.b, state)
        if query.join == "or":
            return first or second
        return first and second

    dp_prev: Dict[Tuple[int, ...], int] = {initial_state: 1}

    for layer_idx, cards_in_bucket in enumerate(ordered_bucket_counts):
        suit_idx, _, points = ordered_bucket_defs[layer_idx]
        specific_fields = bucket_specific_fields[layer_idx]
        rank_fields = bucket_rank_fields[layer_idx]
        dp_curr: Dict[Tuple[int, ...], int] = {}

        if cards_in_bucket == 0:
            for state, ways in dp_prev.items():
                if violates_pruning(state, layer_idx + 1):
                    continue
                dp_curr[state] = dp_curr.get(state, 0) + ways
            dp_prev = dp_curr
            if not dp_prev:
                break
            continue

        rem_total_before = remaining_total[layer_idx]
        for state, ways in dp_prev.items():
            rem_n, rem_s, rem_e = state[0], state[1], state[2]
            rem_w = rem_total_before - rem_n - rem_s - rem_e
            if rem_w < 0:
                continue

            max_n = min(cards_in_bucket, rem_n)
            for n_take in range(max_n + 1):
                rem_after_n = cards_in_bucket - n_take
                max_s = min(rem_after_n, rem_s)
                for s_take in range(max_s + 1):
                    rem_after_ns = rem_after_n - s_take
                    max_e = min(rem_after_ns, rem_e)
                    min_e = max(0, rem_after_ns - rem_w)
                    for e_take in range(min_e, max_e + 1):
                        w_take = rem_after_ns - e_take
                        counts = (n_take, s_take, e_take, w_take)

                        next_rem_n = rem_n - n_take
                        next_rem_s = rem_s - s_take
                        next_rem_e = rem_e - e_take

                        next_state = state
                        state_mut = None

                        for hand_idx, allocated in enumerate(counts):
                            if allocated == 0:
                                continue
                            need_update = (
                                (points > 0 and hcp_field_per_hand[hand_idx] != -1)
                                or suit_field_per_hand[hand_idx][suit_idx] != -1
                                or specific_fields[hand_idx] != -1
                                or rank_fields[hand_idx] != -1
                            )
                            if need_update:
                                if state_mut is None:
                                    state_mut = list(state)
                                    state_mut[0] = next_rem_n
                                    state_mut[1] = next_rem_s
                                    state_mut[2] = next_rem_e
                                hcp_idx = hcp_field_per_hand[hand_idx]
                                if points > 0 and hcp_idx != -1:
                                    state_mut[hcp_idx] += points * allocated

                                suit_idx_field = suit_field_per_hand[hand_idx][suit_idx]
                                if suit_idx_field != -1:
                                    state_mut[suit_idx_field] += allocated

                                specific_idx = specific_fields[hand_idx]
                                if specific_idx != -1:
                                    state_mut[specific_idx] = 1

                                rank_idx = rank_fields[hand_idx]
                                if rank_idx != -1:
                                    state_mut[rank_idx] = 1

                        if state_mut is None:
                            next_state = (next_rem_n, next_rem_s, next_rem_e, *state[3:])
                        else:
                            next_state = tuple(state_mut)

                        if violates_pruning(next_state, layer_idx + 1):
                            continue

                        transition_count = (
                            math.comb(cards_in_bucket, n_take)
                            * math.comb(cards_in_bucket - n_take, s_take)
                            * math.comb(cards_in_bucket - n_take - s_take, e_take)
                        )
                        add = ways * transition_count
                        dp_curr[next_state] = dp_curr.get(next_state, 0) + add

        dp_prev = dp_curr
        if not dp_prev:
            break

    denominator = 0
    numerators = [0 for _ in queries]
    for state, ways in dp_prev.items():
        if state[0] != 0 or state[1] != 0 or state[2] != 0:
            continue
        if not base_constraints_satisfied(state):
            continue
        denominator += ways
        for idx, query in enumerate(queries):
            if query_matches(query, state):
                numerators[idx] += ways

    results = []
    for idx, query in enumerate(queries):
        numerator = numerators[idx]
        probability = 0.0 if denominator == 0 else numerator / denominator
        results.append(
            {
                "name": query.name,
                "numerator": str(numerator),
                "probability": probability,
            }
        )

    return {"denominator": str(denominator), "results": results}


def _bucket_priority(
    suit_idx: int,
    rank: str,
    count: int,
    suit_pressure: List[int],
) -> Tuple[int, int, int, int, int, int]:
    is_honor = 1 if rank in HONORS else 0
    points = RANK_POINTS[rank]
    rank_order = BUCKET_RANKS.index(rank)
    return (
        -is_honor,  # honor first
        -suit_pressure[suit_idx],  # strict suit first
        -points,  # A,K,Q,J order inside honors
        -count,  # denser bucket first
        suit_idx,
        rank_order,
    )


def _compile_queries(
    queries_payload: List[dict],
    tracked_hcp_hands: Set[int],
    tracked_suit_fields: Set[Tuple[int, int]],
    tracked_specific_cards: Set[Tuple[int, int, str]],
    tracked_rank_presence: Set[Tuple[int, str]],
) -> List[Query]:
    queries: List[Query] = []
    for idx, raw_query in enumerate(queries_payload):
        name = str(raw_query.get("name") or f"Query {idx + 1}")
        join = str(raw_query.get("join") or "single").strip().lower()
        if join not in {"single", "and", "or"}:
            join = "single"

        atom_a = _parse_atom(raw_query.get("a") or {})
        atom_b = _parse_atom(raw_query.get("b") or {})

        for atom in (atom_a, atom_b):
            if atom.kind == "hcp":
                tracked_hcp_hands.add(atom.hand_idx)
            elif atom.kind == "shape":
                for suit_idx in range(4):
                    tracked_suit_fields.add((atom.hand_idx, suit_idx))
            elif atom.kind == "specific_card":
                tracked_specific_cards.add((atom.hand_idx, atom.suit_idx, atom.rank))
            elif atom.kind == "rank_presence":
                tracked_rank_presence.add((atom.hand_idx, atom.rank))

        queries.append(Query(name=name, join=join, a=atom_a, b=atom_b))
    return queries


def _parse_atom(atom_payload: dict) -> QueryAtom:
    hand_name = str(atom_payload.get("hand") or "").strip().lower()
    hand_idx = HAND_INDEX.get(hand_name)
    atom_type = str(atom_payload.get("type") or "").strip().lower()
    value = str(atom_payload.get("value") or "").strip()

    if hand_idx is None:
        return QueryAtom(kind="always_false")

    if atom_type == "hcp":
        hcp_range = _parse_int_range(value, 0, 37)
        if hcp_range is None:
            return QueryAtom(kind="always_false")
        return QueryAtom(
            kind="hcp",
            hand_idx=hand_idx,
            min_value=hcp_range[0],
            max_value=hcp_range[1],
        )

    if atom_type == "shape":
        shape = _parse_shape(value)
        if shape is None:
            return QueryAtom(kind="always_false")
        return QueryAtom(kind="shape", hand_idx=hand_idx, shape=shape)

    if atom_type == "card":
        parsed_card = _try_parse_card(value)
        if parsed_card:
            suit_idx = SUIT_INDEX[parsed_card[0]]
            rank = parsed_card[1]
            if rank not in HONORS:
                raise ValueError(
                    "Small-card target queries are not supported by the 20-bucket model. "
                    "Use A/K/Q/J or honor rank queries."
                )
            return QueryAtom(
                kind="specific_card",
                hand_idx=hand_idx,
                suit_idx=suit_idx,
                rank=rank,
            )
        rank = value.strip().upper().replace("10", "T")
        if rank in HONORS:
            return QueryAtom(kind="rank_presence", hand_idx=hand_idx, rank=rank)
        return QueryAtom(kind="always_false")

    return QueryAtom(kind="always_false")


def _normalize_constraints(payload: Dict[str, dict]) -> Dict[str, HandConstraint]:
    normalized: Dict[str, HandConstraint] = {}
    for hand in HANDS:
        raw = payload.get(hand, {})
        mode = str(raw.get("mode") or "feature").strip().lower()
        if mode not in {"feature", "hand"}:
            raise ValueError(f"Unknown mode for {hand}: {mode}")

        raw_known = raw.get("knownCards") or []
        if not isinstance(raw_known, list):
            raise ValueError(f"knownCards for {hand} must be a list.")
        known_cards = tuple(_normalize_card(card) for card in raw_known)
        if len(known_cards) > 13:
            raise ValueError(f"{hand} has more than 13 known cards.")

        raw_hcp = raw.get("hcp") or {"min": 0, "max": 37}
        hcp_min = _read_int(raw_hcp.get("min"), 0)
        hcp_max = _read_int(raw_hcp.get("max"), 37)

        raw_suits = raw.get("suitRanges") or []
        suit_ranges: List[Tuple[int, int]] = []
        for suit_idx in range(4):
            suit_raw = raw_suits[suit_idx] if suit_idx < len(raw_suits) else {}
            min_v = _read_int(suit_raw.get("min"), 0)
            max_v = _read_int(suit_raw.get("max"), 13)
            suit_ranges.append((min_v, max_v))

        normalized[hand] = HandConstraint(
            mode=mode,
            known_cards=known_cards,
            hcp=(hcp_min, hcp_max),
            suit_ranges=tuple(suit_ranges),
        )
    return normalized


def _read_int(value: object, default: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _parse_int_range(value: str, minimum: int, maximum: int) -> Tuple[int, int] | None:
    parts = [part for part in re.split(r"[-,\s]+", value.strip()) if part]
    if not parts:
        return None
    try:
        left = int(parts[0])
        right = int(parts[1]) if len(parts) > 1 else left
    except ValueError:
        return None
    if left > right:
        left, right = right, left
    if left < minimum or right > maximum:
        return None
    return left, right


def _parse_shape(value: str) -> Tuple[int, int, int, int] | None:
    nums = [int(part) for part in re.findall(r"\d+", value)]
    if len(nums) != 4 or sum(nums) != 13:
        return None
    nums.sort(reverse=True)
    return nums[0], nums[1], nums[2], nums[3]


def _try_parse_card(raw: str) -> str | None:
    token = str(raw or "").strip().upper().replace("10", "T")
    if len(token) != 2:
        return None
    suit = token[0]
    rank = token[1]
    if suit not in SUIT_INDEX or rank not in "AKQJT98765432":
        return None
    return suit + rank


def _normalize_card(raw: object) -> str:
    card = _try_parse_card(str(raw))
    if not card:
        raise ValueError(f"Invalid card notation: {raw}")
    return card


def _bucket_index_for_card(card: str) -> int:
    suit_idx = SUIT_INDEX[card[0]]
    rank = card[1]
    bucket_rank = rank if rank in HONORS else "x"
    rank_pos = BUCKET_RANKS.index(bucket_rank)
    return suit_idx * 5 + rank_pos


def _bucket_definitions() -> List[Tuple[int, str, int]]:
    buckets: List[Tuple[int, str, int]] = []
    for suit_idx in range(4):
        for rank in BUCKET_RANKS:
            buckets.append((suit_idx, rank, RANK_POINTS[rank]))
    return buckets


def _initial_bucket_counts() -> List[int]:
    counts: List[int] = []
    for _ in range(4):
        counts.extend([1, 1, 1, 1, 9])
    return counts


def _card_hcp(rank: str) -> int:
    if rank == "A":
        return 4
    if rank == "K":
        return 3
    if rank == "Q":
        return 2
    if rank == "J":
        return 1
    return 0
