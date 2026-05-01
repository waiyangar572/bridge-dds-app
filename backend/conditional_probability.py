from __future__ import annotations

import math
import re
from dataclasses import dataclass
from typing import Dict, Iterable, Iterator, List, Mapping, Sequence, Set, Tuple

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
    known_state = _known_state_from_constraints(constraints)

    tracked_hcp_hands: Set[int] = set()
    tracked_suit_fields: Set[Tuple[int, int]] = set()
    tracked_specific_cards: Set[Tuple[int, int, str]] = set()
    tracked_rank_presence: Set[Tuple[int, str]] = set()
    queries = _compile_queries(
        queries_payload or [],
        tracked_hcp_hands,
        tracked_suit_fields,
        tracked_specific_cards,
        tracked_rank_presence,
    )

    atom_specs = _query_atom_specs(queries, known_state)
    hcp_ranges = _effective_hcp_ranges(constraints, known_state["known_hcp"])
    for hand_idx, hand in enumerate(HANDS):
        constraint = constraints[hand]
        if constraint.mode == "hand" or constraint.hcp != (0, 37):
            tracked_hcp_hands.add(hand_idx)
    tracked_hcp_mask = tuple(hand_idx in tracked_hcp_hands for hand_idx in range(4))

    if not queries and _is_unrestricted_problem(constraints, known_state):
        return {
            "denominator": str(math.factorial(52) // (math.factorial(13) ** 4)),
            "results": [],
        }

    if _can_use_hcp_only_count(constraints, known_state, queries):
        return _count_hcp_only(constraints, queries)

    if not _needs_hcp_or_honor_detail(constraints, queries):
        return _count_shape_only(constraints, known_state, queries, atom_specs)

    denominator = 0
    numerators = [0 for _ in queries]
    option_cache: Dict[Tuple[int, Tuple[int, int, int, int]], Dict[Tuple[Tuple[int, int, int, int], int], int]] = {}

    for matrix in generate_shape_matrices(None, constraints):
        columns = [tuple(matrix[hand_idx][suit_idx] for hand_idx in range(4)) for suit_idx in range(4)]
        suit_options: List[Dict[Tuple[Tuple[int, int, int, int], int], int]] = []
        for suit_idx, counts_4 in enumerate(columns):
            cache_key = (suit_idx, counts_4)
            options = option_cache.get(cache_key)
            if options is None:
                options = _suit_option_counts(
                    suit_idx,
                    counts_4,
                    known_state["suit_inventory"][suit_idx],
                    atom_specs,
                )
                if not all(tracked_hcp_mask):
                    options = _project_hcp_options(options, tracked_hcp_mask)
                option_cache[cache_key] = options
            if not options:
                suit_options = []
                break
            suit_options.append(options)
        if not suit_options:
            continue

        combined: Dict[Tuple[Tuple[int, int, int, int], int], int] = {
            ((0, 0, 0, 0), known_state["initial_query_mask"]): 1
        }
        for suit_idx, options in enumerate(suit_options):
            next_combined: Dict[Tuple[Tuple[int, int, int, int], int], int] = {}
            suits_left = 3 - suit_idx
            for (hcp_acc, mask_acc), acc_ways in combined.items():
                for (hcp_add, mask_add), add_ways in options.items():
                    next_hcp = tuple(hcp_acc[idx] + hcp_add[idx] for idx in range(4))
                    if _violates_partial_hcp(next_hcp, suits_left, hcp_ranges, known_state["known_hcp"]):
                        continue
                    key = (next_hcp, mask_acc | mask_add)
                    next_combined[key] = next_combined.get(key, 0) + acc_ways * add_ways
            combined = next_combined
            if not combined:
                break

        total_suit_counts = tuple(
            tuple(
                known_state["known_suit_counts"][hand_idx][suit_idx] + matrix[hand_idx][suit_idx]
                for suit_idx in range(4)
            )
            for hand_idx in range(4)
        )

        for (unknown_hcp, mask), ways in combined.items():
            total_hcp = tuple(
                known_state["known_hcp"][hand_idx] + unknown_hcp[hand_idx]
                for hand_idx in range(4)
            )
            if not _hcp_in_ranges(total_hcp, hcp_ranges):
                continue
            denominator += ways
            for idx, query in enumerate(queries):
                if _query_matches(query, total_hcp, total_suit_counts, mask, atom_specs):
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


def generate_shape_matrices(
    known_cards: object = None,
    constraints: Mapping[str, object] | None = None,
) -> Iterator[Tuple[Tuple[int, int, int, int], ...]]:
    """Yield 4x4 unknown-card shape matrices in N,S,E,W x S,H,D,C order.

    Rows sum to each hand's remaining card need, columns sum to each suit's
    remaining cards, and every generated row respects the hand's total suit
    length ranges after known cards are added back in.
    """
    normalized = _coerce_constraints(constraints or {})
    known_state = _known_state_from_constraints(normalized, known_cards)
    remaining_needs = known_state["remaining_needs"]
    remaining_suits = known_state["remaining_suits"]
    known_suit_counts = known_state["known_suit_counts"]

    row_bounds: List[List[Tuple[int, int]]] = []
    for hand_idx, hand in enumerate(HANDS):
        constraint = normalized[hand]
        bounds: List[Tuple[int, int]] = []
        if constraint.mode == "hand":
            if remaining_needs[hand_idx] != 0:
                raise ValueError(f"{hand} full hand mode requires exactly 13 known cards.")
            bounds = [(0, 0) for _ in SUITS]
        else:
            for suit_idx, (min_len, max_len) in enumerate(constraint.suit_ranges):
                if not (0 <= min_len <= max_len <= 13):
                    raise ValueError(
                        f"Invalid suit range for {hand} {SUITS[suit_idx]}: {min_len}-{max_len}"
                    )
                known_len = known_suit_counts[hand_idx][suit_idx]
                lo = max(0, min_len - known_len)
                hi = max_len - known_len
                if hi < lo:
                    return
                bounds.append((lo, min(hi, remaining_suits[suit_idx])))
        row_bounds.append(bounds)

    matrix: List[List[int]] = [[0, 0, 0, 0] for _ in HANDS]
    suffix_col_min = [[0, 0, 0, 0] for _ in range(5)]
    suffix_col_max = [[0, 0, 0, 0] for _ in range(5)]
    suffix_need = [0] * 5
    suffix_row_min = [0] * 4
    suffix_row_max = [0] * 4
    for row_idx in range(3, -1, -1):
        suffix_need[row_idx] = suffix_need[row_idx + 1] + remaining_needs[row_idx]
        suffix_row_min[row_idx] = sum(lo for lo, _ in row_bounds[row_idx])
        suffix_row_max[row_idx] = sum(hi for _, hi in row_bounds[row_idx])
        for suit_idx in range(4):
            suffix_col_min[row_idx][suit_idx] = (
                suffix_col_min[row_idx + 1][suit_idx] + row_bounds[row_idx][suit_idx][0]
            )
            suffix_col_max[row_idx][suit_idx] = (
                suffix_col_max[row_idx + 1][suit_idx] + row_bounds[row_idx][suit_idx][1]
            )

    def feasible_tail(row_idx: int, col_remaining: Sequence[int]) -> bool:
        if suffix_need[row_idx] != sum(col_remaining):
            return False
        for suit_idx, col_left in enumerate(col_remaining):
            if col_left < suffix_col_min[row_idx][suit_idx] or col_left > suffix_col_max[row_idx][suit_idx]:
                return False
        for pos in range(row_idx, 4):
            if remaining_needs[pos] < suffix_row_min[pos] or remaining_needs[pos] > suffix_row_max[pos]:
                return False
        return True

    def backtrack(row_idx: int, col_remaining: Tuple[int, int, int, int]) -> Iterator[Tuple[Tuple[int, int, int, int], ...]]:
        if row_idx == 3:
            row = col_remaining
            if sum(row) != remaining_needs[row_idx]:
                return
            for suit_idx, value in enumerate(row):
                lo, hi = row_bounds[row_idx][suit_idx]
                if value < lo or value > hi:
                    return
            matrix[row_idx] = list(row)
            yield tuple(tuple(row_values) for row_values in matrix)
            return
        if not feasible_tail(row_idx, col_remaining):
            return

        for row in _bounded_row_allocations(remaining_needs[row_idx], col_remaining, row_bounds[row_idx]):
            next_cols = tuple(col_remaining[suit_idx] - row[suit_idx] for suit_idx in range(4))
            if not feasible_tail(row_idx + 1, next_cols):
                continue
            matrix[row_idx] = list(row)
            yield from backtrack(row_idx + 1, next_cols)

    yield from backtrack(0, tuple(remaining_suits))


def suit_combinations(
    suit: str,
    counts_4: Sequence[int],
    hcps_4: Sequence[int],
) -> int:
    """Return exact combinations for one complete suit with no known cards removed."""
    suit_idx = SUIT_INDEX[str(suit).strip().upper()[0]]
    options = _suit_option_counts(
        suit_idx,
        tuple(int(v) for v in counts_4),
        {"A": 1, "K": 1, "Q": 1, "J": 1, "x": 9},
        [],
    )
    target_hcp = tuple(int(v) for v in hcps_4)
    return sum(ways for (hcp, _), ways in options.items() if hcp == target_hcp)


def _bounded_row_allocations(
    row_sum: int,
    col_caps: Sequence[int],
    bounds: Sequence[Tuple[int, int]],
) -> Iterator[Tuple[int, int, int, int]]:
    row = [0, 0, 0, 0]

    def rec(suit_idx: int, remaining: int) -> Iterator[Tuple[int, int, int, int]]:
        if suit_idx == 4:
            if remaining == 0:
                yield tuple(row)
            return
        tail_min = sum(bounds[idx][0] for idx in range(suit_idx + 1, 4))
        tail_max = sum(min(bounds[idx][1], col_caps[idx]) for idx in range(suit_idx + 1, 4))
        lo = max(bounds[suit_idx][0], remaining - tail_max)
        hi = min(bounds[suit_idx][1], col_caps[suit_idx], remaining - tail_min)
        for value in range(lo, hi + 1):
            row[suit_idx] = value
            yield from rec(suit_idx + 1, remaining - value)

    yield from rec(0, row_sum)


def _suit_option_counts(
    suit_idx: int,
    counts_4: Sequence[int],
    inventory: Mapping[str, int],
    atom_specs: Sequence[dict],
) -> Dict[Tuple[Tuple[int, int, int, int], int], int]:
    counts = tuple(int(value) for value in counts_4)
    if any(value < 0 for value in counts) or sum(counts) != sum(inventory.values()):
        return {}

    honors = [rank for rank in HONORS if inventory.get(rank, 0)]
    small_count = int(inventory.get("x", 0))
    results: Dict[Tuple[Tuple[int, int, int, int], int], int] = {}
    hcp = [0, 0, 0, 0]
    honor_counts = [0, 0, 0, 0]

    def rec(rank_idx: int, mask: int) -> None:
        if rank_idx == len(honors):
            small_needs = [counts[idx] - honor_counts[idx] for idx in range(4)]
            if any(value < 0 for value in small_needs) or sum(small_needs) != small_count:
                return
            ways = _multinomial_count(small_count, small_needs)
            if ways == 0:
                return
            key = (tuple(hcp), mask)
            results[key] = results.get(key, 0) + ways
            return

        rank = honors[rank_idx]
        points = RANK_POINTS[rank]
        for hand_idx in range(4):
            if honor_counts[hand_idx] >= counts[hand_idx]:
                continue
            next_mask = mask | _mask_for_assignment(atom_specs, hand_idx, suit_idx, rank)
            honor_counts[hand_idx] += 1
            hcp[hand_idx] += points
            rec(rank_idx + 1, next_mask)
            hcp[hand_idx] -= points
            honor_counts[hand_idx] -= 1

    rec(0, 0)
    return results


def _multinomial_count(total: int, parts: Sequence[int]) -> int:
    if total < 0 or any(part < 0 for part in parts) or sum(parts) != total:
        return 0
    ways = 1
    remaining = total
    for part in parts[:-1]:
        ways *= math.comb(remaining, part)
        remaining -= part
    return ways


def _project_hcp_options(
    options: Mapping[Tuple[Tuple[int, int, int, int], int], int],
    tracked_hcp_mask: Sequence[bool],
) -> Dict[Tuple[Tuple[int, int, int, int], int], int]:
    projected: Dict[Tuple[Tuple[int, int, int, int], int], int] = {}
    for (hcp, mask), ways in options.items():
        next_hcp = tuple(hcp[idx] if tracked_hcp_mask[idx] else 0 for idx in range(4))
        key = (next_hcp, mask)
        projected[key] = projected.get(key, 0) + ways
    return projected


def _count_shape_only(
    constraints: Mapping[str, HandConstraint],
    known_state: dict,
    queries: Sequence[Query],
    atom_specs: Sequence[dict],
) -> dict:
    denominator = 0
    numerators = [0 for _ in queries]
    suit_way_cache: Dict[Tuple[int, Tuple[int, int, int, int]], int] = {}

    for matrix in generate_shape_matrices(None, constraints):
        total_suit_counts = tuple(
            tuple(
                known_state["known_suit_counts"][hand_idx][suit_idx] + matrix[hand_idx][suit_idx]
                for suit_idx in range(4)
            )
            for hand_idx in range(4)
        )
        ways = 1
        for suit_idx in range(4):
            counts_4 = tuple(matrix[hand_idx][suit_idx] for hand_idx in range(4))
            key = (suit_idx, counts_4)
            suit_ways = suit_way_cache.get(key)
            if suit_ways is None:
                total = sum(known_state["suit_inventory"][suit_idx].values())
                suit_ways = _multinomial_count(total, counts_4)
                suit_way_cache[key] = suit_ways
            ways *= suit_ways

        denominator += ways
        for idx, query in enumerate(queries):
            if _query_matches(query, (0, 0, 0, 0), total_suit_counts, 0, atom_specs):
                numerators[idx] += ways

    results = []
    for idx, query in enumerate(queries):
        numerator = numerators[idx]
        results.append(
            {
                "name": query.name,
                "numerator": str(numerator),
                "probability": 0.0 if denominator == 0 else numerator / denominator,
            }
        )
    return {"denominator": str(denominator), "results": results}


def _can_use_hcp_only_count(
    constraints: Mapping[str, HandConstraint],
    known_state: dict,
    queries: Sequence[Query],
) -> bool:
    if any(known_state["known_cards_by_hand"][hand_idx] for hand_idx in range(4)):
        return False
    for hand in HANDS:
        constraint = constraints[hand]
        if constraint.mode != "feature":
            return False
        if any(suit_range != (0, 13) for suit_range in constraint.suit_ranges):
            return False
    for query in queries:
        for atom in (query.a, query.b):
            if atom.kind not in {"hcp", "always_false"}:
                return False
    return True


def _count_hcp_only(
    constraints: Mapping[str, HandConstraint],
    queries: Sequence[Query],
) -> dict:
    hcp_ranges = tuple(constraints[hand].hcp for hand in HANDS)
    denominator = 0
    numerators = [0 for _ in queries]

    states: Dict[Tuple[Tuple[int, int, int, int], Tuple[int, int, int, int]], int] = {
        ((0, 0, 0, 0), (0, 0, 0, 0)): 1
    }
    for points in (4, 3, 2, 1):
        next_states: Dict[Tuple[Tuple[int, int, int, int], Tuple[int, int, int, int]], int] = {}
        for (honor_counts, hcps), ways in states.items():
            for alloc in _bounded_row_allocations(4, (4, 4, 4, 4), ((0, 4), (0, 4), (0, 4), (0, 4))):
                next_counts = tuple(honor_counts[idx] + alloc[idx] for idx in range(4))
                if any(count > 13 for count in next_counts):
                    continue
                next_hcps = tuple(hcps[idx] + points * alloc[idx] for idx in range(4))
                if any(next_hcps[idx] > hcp_ranges[idx][1] for idx in range(4)):
                    continue
                key = (next_counts, next_hcps)
                next_states[key] = next_states.get(key, 0) + ways * _multinomial_count(4, alloc)
        states = next_states

    for (honor_counts, hcps), ways in states.items():
        small_needs = tuple(13 - count for count in honor_counts)
        if any(value < 0 for value in small_needs) or sum(small_needs) != 36:
            continue
        if not _hcp_in_ranges(hcps, hcp_ranges):
            continue
        total_ways = ways * _multinomial_count(36, small_needs)
        denominator += total_ways
        for idx, query in enumerate(queries):
            if _query_matches(query, hcps, ((0, 0, 0, 0),) * 4, 0, []):
                numerators[idx] += total_ways

    results = []
    for idx, query in enumerate(queries):
        numerator = numerators[idx]
        results.append(
            {
                "name": query.name,
                "numerator": str(numerator),
                "probability": 0.0 if denominator == 0 else numerator / denominator,
            }
        )
    return {"denominator": str(denominator), "results": results}


def _needs_hcp_or_honor_detail(
    constraints: Mapping[str, HandConstraint],
    queries: Sequence[Query],
) -> bool:
    for hand in HANDS:
        constraint = constraints[hand]
        if constraint.mode != "hand" and constraint.hcp != (0, 37):
            return True
    for query in queries:
        for atom in (query.a, query.b):
            if atom.kind in {"hcp", "specific_card", "rank_presence"}:
                return True
    return False


def _coerce_constraints(constraints: Mapping[str, object]) -> Dict[str, HandConstraint]:
    if all(isinstance(constraints.get(hand), HandConstraint) for hand in HANDS):
        return {hand: constraints[hand] for hand in HANDS}  # type: ignore[return-value]
    return _normalize_constraints(constraints)  # type: ignore[arg-type]


def _known_state_from_constraints(
    constraints: Mapping[str, HandConstraint],
    known_cards_override: object = None,
) -> dict:
    known_cards_by_hand = [set() for _ in HANDS]
    source = _known_cards_source(constraints, known_cards_override)
    for hand_idx, hand in enumerate(HANDS):
        for raw_card in source[hand_idx]:
            known_cards_by_hand[hand_idx].add(_normalize_card(raw_card))

    known_owner: Dict[str, int] = {}
    known_hcp = [0, 0, 0, 0]
    known_suit_counts = [[0, 0, 0, 0] for _ in HANDS]
    known_rank_presence = [{rank: False for rank in HONORS} for _ in HANDS]
    suit_inventory = [
        {"A": 1, "K": 1, "Q": 1, "J": 1, "x": 9}
        for _ in SUITS
    ]

    for hand_idx in range(4):
        for card in known_cards_by_hand[hand_idx]:
            if card in known_owner:
                raise ValueError(f"Duplicate known card: {card}")
            known_owner[card] = hand_idx
            suit_idx = SUIT_INDEX[card[0]]
            rank = card[1]
            known_hcp[hand_idx] += _card_hcp(rank)
            known_suit_counts[hand_idx][suit_idx] += 1
            if rank in HONORS:
                known_rank_presence[hand_idx][rank] = True
                suit_inventory[suit_idx][rank] -= 1
            else:
                suit_inventory[suit_idx]["x"] -= 1
            if min(suit_inventory[suit_idx].values()) < 0:
                raise ValueError(f"Invalid known cards for suit inventory: {card}")

    remaining_needs = [13 - len(known_cards_by_hand[idx]) for idx in range(4)]
    if any(need < 0 for need in remaining_needs):
        raise ValueError("Each hand must have at most 13 known cards.")

    remaining_suits = [sum(suit_inventory[suit_idx].values()) for suit_idx in range(4)]
    if sum(remaining_needs) != sum(remaining_suits):
        raise ValueError("Known cards are inconsistent with a 52-card deck.")

    return {
        "known_cards_by_hand": known_cards_by_hand,
        "known_hcp": known_hcp,
        "known_suit_counts": known_suit_counts,
        "known_rank_presence": known_rank_presence,
        "known_owner": known_owner,
        "remaining_needs": remaining_needs,
        "remaining_suits": remaining_suits,
        "suit_inventory": suit_inventory,
        "initial_query_mask": 0,
    }


def _known_cards_source(
    constraints: Mapping[str, HandConstraint],
    known_cards_override: object,
) -> List[List[object]]:
    if known_cards_override is None:
        return [list(constraints[hand].known_cards) for hand in HANDS]
    if isinstance(known_cards_override, Mapping):
        return [
            list(
                known_cards_override.get(hand, [])
                or known_cards_override.get(hand.capitalize(), [])
                or known_cards_override.get(hand[0].upper(), [])
            )
            for hand in HANDS
        ]
    if isinstance(known_cards_override, Sequence) and not isinstance(known_cards_override, (str, bytes)):
        values = list(known_cards_override)
        if len(values) == 4 and all(
            isinstance(value, Iterable) and not isinstance(value, (str, bytes))
            for value in values
        ):
            return [list(value) for value in values]
    raise ValueError("known_cards must be omitted, a hand->cards mapping, or a 4-list of card lists.")


def _query_atom_specs(queries: Sequence[Query], known_state: dict) -> List[dict]:
    specs: List[dict] = []
    seen: Dict[Tuple[str, int, int, str], int] = {}
    initial_mask = 0
    known_cards_by_hand = known_state["known_cards_by_hand"]
    known_rank_presence = known_state["known_rank_presence"]

    for query in queries:
        for atom in (query.a, query.b):
            if atom.kind == "specific_card":
                key = (atom.kind, atom.hand_idx, atom.suit_idx, atom.rank)
                if key not in seen:
                    seen[key] = len(specs)
                    specs.append(
                        {
                            "kind": atom.kind,
                            "hand_idx": atom.hand_idx,
                            "suit_idx": atom.suit_idx,
                            "rank": atom.rank,
                        }
                    )
                if SUITS[atom.suit_idx] + atom.rank in known_cards_by_hand[atom.hand_idx]:
                    initial_mask |= 1 << seen[key]
            elif atom.kind == "rank_presence":
                key = (atom.kind, atom.hand_idx, -1, atom.rank)
                if key not in seen:
                    seen[key] = len(specs)
                    specs.append(
                        {
                            "kind": atom.kind,
                            "hand_idx": atom.hand_idx,
                            "suit_idx": -1,
                            "rank": atom.rank,
                        }
                    )
                if known_rank_presence[atom.hand_idx][atom.rank]:
                    initial_mask |= 1 << seen[key]

    for bit, spec in enumerate(specs):
        spec["bit"] = bit
    known_state["initial_query_mask"] = initial_mask
    return specs


def _mask_for_assignment(
    atom_specs: Sequence[dict],
    hand_idx: int,
    suit_idx: int,
    rank: str,
) -> int:
    mask = 0
    for spec in atom_specs:
        if spec["hand_idx"] != hand_idx or spec["rank"] != rank:
            continue
        if spec["kind"] == "specific_card" and spec["suit_idx"] != suit_idx:
            continue
        mask |= 1 << spec["bit"]
    return mask


def _effective_hcp_ranges(
    constraints: Mapping[str, HandConstraint],
    known_hcp: Sequence[int],
) -> Tuple[Tuple[int, int], ...]:
    ranges: List[Tuple[int, int]] = []
    for hand_idx, hand in enumerate(HANDS):
        constraint = constraints[hand]
        if constraint.mode == "hand":
            ranges.append((known_hcp[hand_idx], known_hcp[hand_idx]))
            continue
        min_hcp, max_hcp = constraint.hcp
        if not (0 <= min_hcp <= max_hcp <= 37):
            raise ValueError(f"Invalid HCP range for {hand}: {min_hcp}-{max_hcp}")
        ranges.append((min_hcp, max_hcp))
    return tuple(ranges)


def _violates_partial_hcp(
    unknown_hcp: Sequence[int],
    suits_left: int,
    hcp_ranges: Sequence[Tuple[int, int]],
    known_hcp: Sequence[int],
) -> bool:
    max_remaining = 10 * suits_left
    for hand_idx, current in enumerate(unknown_hcp):
        min_total, max_total = hcp_ranges[hand_idx]
        current_total = known_hcp[hand_idx] + current
        if current_total > max_total:
            return True
        if current_total + max_remaining < min_total:
            return True
    return False


def _hcp_in_ranges(
    total_hcp: Sequence[int],
    hcp_ranges: Sequence[Tuple[int, int]],
) -> bool:
    for hand_idx, value in enumerate(total_hcp):
        min_hcp, max_hcp = hcp_ranges[hand_idx]
        if value < min_hcp or value > max_hcp:
            return False
    return True


def _query_matches(
    query: Query,
    total_hcp: Sequence[int],
    total_suit_counts: Sequence[Sequence[int]],
    mask: int,
    atom_specs: Sequence[dict],
) -> bool:
    first = _atom_matches(query.a, total_hcp, total_suit_counts, mask, atom_specs)
    if query.join == "single":
        return first
    second = _atom_matches(query.b, total_hcp, total_suit_counts, mask, atom_specs)
    if query.join == "or":
        return first or second
    return first and second


def _atom_matches(
    atom: QueryAtom,
    total_hcp: Sequence[int],
    total_suit_counts: Sequence[Sequence[int]],
    mask: int,
    atom_specs: Sequence[dict],
) -> bool:
    if atom.kind == "always_false":
        return False
    if atom.kind == "hcp":
        return atom.min_value <= total_hcp[atom.hand_idx] <= atom.max_value
    if atom.kind == "shape":
        counts = sorted(total_suit_counts[atom.hand_idx], reverse=True)
        return tuple(counts) == atom.shape
    if atom.kind == "specific_card":
        bit = _find_atom_bit(atom_specs, atom.kind, atom.hand_idx, atom.suit_idx, atom.rank)
        return bit >= 0 and bool(mask & (1 << bit))
    if atom.kind == "rank_presence":
        bit = _find_atom_bit(atom_specs, atom.kind, atom.hand_idx, -1, atom.rank)
        return bit >= 0 and bool(mask & (1 << bit))
    return False


def _find_atom_bit(
    atom_specs: Sequence[dict],
    kind: str,
    hand_idx: int,
    suit_idx: int,
    rank: str,
) -> int:
    for spec in atom_specs:
        if (
            spec["kind"] == kind
            and spec["hand_idx"] == hand_idx
            and spec["suit_idx"] == suit_idx
            and spec["rank"] == rank
        ):
            return spec["bit"]
    return -1


def _is_unrestricted_problem(
    constraints: Mapping[str, HandConstraint],
    known_state: dict,
) -> bool:
    if any(known_state["known_cards_by_hand"][hand_idx] for hand_idx in range(4)):
        return False
    for hand in HANDS:
        constraint = constraints[hand]
        if constraint.mode != "feature":
            return False
        if constraint.hcp != (0, 37):
            return False
        if any(suit_range != (0, 13) for suit_range in constraint.suit_ranges):
            return False
    return True


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
