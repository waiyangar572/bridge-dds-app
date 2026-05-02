from __future__ import annotations

import math
from dataclasses import dataclass, field
from fractions import Fraction
from functools import lru_cache
from typing import Dict, Iterable, Iterator, Mapping, Sequence, Tuple

HANDS: Tuple[str, ...] = ("north", "south", "east", "west")
HAND_INDEX = {hand: idx for idx, hand in enumerate(HANDS)}

SUITS: Tuple[str, ...] = ("S", "H", "D", "C")
SUIT_INDEX = {suit: idx for idx, suit in enumerate(SUITS)}

HONORS: Tuple[str, ...] = ("A", "K", "Q", "J")
HCP = {"A": 4, "K": 3, "Q": 2, "J": 1}
RANKS = "AKQJT98765432"

HONOR_CARDS: Tuple[str, ...] = tuple(suit + rank for suit in SUITS for rank in HONORS)
HONOR_INDEX = {card: idx for idx, card in enumerate(HONOR_CARDS)}


class Comb:
    """Cached exact nCr / multinomial utilities."""

    @staticmethod
    @lru_cache(maxsize=None)
    def ncr(n: int, r: int) -> int:
        if r < 0 or r > n:
            return 0
        return math.comb(n, r)

    @staticmethod
    def multinomial(total: int, parts: Sequence[int]) -> int:
        if total < 0 or any(part < 0 for part in parts) or sum(parts) != total:
            return 0
        ways = 1
        remaining = total
        for part in parts[:-1]:
            ways *= Comb.ncr(remaining, part)
            remaining -= part
        return ways


@dataclass(frozen=True)
class HandCondition:
    """One hand's constraints.

    `full_hand` means all 13 cards are fixed. Otherwise, `required_cards`,
    HCP range, shape min/max, and honor-card exclusions can be combined freely.
    Spot cards are grouped by suit after known-card removal; forbidden spot-card
    constraints are intentionally rejected because grouped spots are not
    individually distinguishable in this exact state space.
    """

    full_hand: Tuple[str, ...] = ()
    required_cards: Tuple[str, ...] = ()
    forbidden_cards: Tuple[str, ...] = ()
    shape_min: Tuple[int, int, int, int] = (0, 0, 0, 0)
    shape_max: Tuple[int, int, int, int] = (13, 13, 13, 13)
    hcp_min: int = 0
    hcp_max: int = 37

    @staticmethod
    def any() -> "HandCondition":
        return HandCondition()

    @staticmethod
    def feature(
        *,
        required_cards: Iterable[str] = (),
        forbidden_cards: Iterable[str] = (),
        shape_min: Sequence[int] = (0, 0, 0, 0),
        shape_max: Sequence[int] = (13, 13, 13, 13),
        hcp_min: int = 0,
        hcp_max: int = 37,
    ) -> "HandCondition":
        return HandCondition(
            required_cards=tuple(normalize_card(card) for card in required_cards),
            forbidden_cards=tuple(normalize_card(card) for card in forbidden_cards),
            shape_min=tuple(int(v) for v in shape_min),  # type: ignore[arg-type]
            shape_max=tuple(int(v) for v in shape_max),  # type: ignore[arg-type]
            hcp_min=int(hcp_min),
            hcp_max=int(hcp_max),
        )

    @staticmethod
    def hand(cards: Iterable[str]) -> "HandCondition":
        normalized = tuple(normalize_card(card) for card in cards)
        if len(normalized) != 13:
            raise ValueError("full_hand requires exactly 13 cards")
        suit_counts = [0, 0, 0, 0]
        hcp = 0
        for card in normalized:
            suit_counts[SUIT_INDEX[card[0]]] += 1
            hcp += HCP.get(card[1], 0)
        return HandCondition(
            full_hand=normalized,
            required_cards=normalized,
            shape_min=tuple(suit_counts),
            shape_max=tuple(suit_counts),
            hcp_min=hcp,
            hcp_max=hcp,
        )


@dataclass(frozen=True)
class State:
    """Hashable DP state.

    Honors are represented by a 16-bit mask. Spots are represented only by
    remaining suit counts, which is the key compression that avoids enumerating
    the full 5.36e28 deal space.
    """

    vacant_spaces: Tuple[int, int, int, int] = (13, 13, 13, 13)
    remaining_honors: int = (1 << 16) - 1
    remaining_spots: Tuple[int, int, int, int] = (9, 9, 9, 9)
    hcp: Tuple[int, int, int, int] = (0, 0, 0, 0)
    suit_counts: Tuple[int, ...] = (0,) * 16

    def suit_count(self, hand_idx: int, suit_idx: int) -> int:
        return self.suit_counts[hand_idx * 4 + suit_idx]


@dataclass(frozen=True)
class Event:
    """Base class for target/evidence events."""


@dataclass(frozen=True)
class CardInHand(Event):
    card: str
    hand: str


@dataclass(frozen=True)
class HcpRange(Event):
    hand: str
    minimum: int
    maximum: int


@dataclass(frozen=True)
class SuitCountRange(Event):
    hand: str
    suit: str
    minimum: int
    maximum: int


@dataclass(frozen=True)
class ShapePattern(Event):
    hand: str
    shape: Tuple[int, int, int, int]


@dataclass(frozen=True)
class AndEvent(Event):
    events: Tuple[Event, ...]


@dataclass(frozen=True)
class OrEvent(Event):
    events: Tuple[Event, ...]


@dataclass(frozen=True)
class _RuntimeCondition:
    owner_by_card: Tuple[int, ...]
    forbidden_mask_by_hand: Tuple[int, int, int, int]
    shape_min: Tuple[Tuple[int, int, int, int], ...]
    shape_max: Tuple[Tuple[int, int, int, int], ...]
    shape_patterns: Tuple[Tuple[int, int, int, int] | None, ...]
    hcp_min: Tuple[int, int, int, int]
    hcp_max: Tuple[int, int, int, int]


class ProbabilityEngine:
    """Exact probability engine based on memoized top-down state transitions."""

    def __init__(self, conditions: Mapping[str, HandCondition] | None = None) -> None:
        print("Initializing ProbabilityEngine with conditions:", conditions)
        base = {hand: HandCondition.any() for hand in HANDS}
        if conditions:
            for hand, condition in conditions.items():
                hand_idx = HAND_INDEX[_normalize_hand(hand)]
                base[HANDS[hand_idx]] = condition
        self.conditions = base
        self._runtime, self.initial_state = self._build_initial_state(base)

    def calculate_probability(
        self,
        target_events: Event | Sequence[Event],
        constraints: Mapping[str, HandCondition] | None = None,
    ) -> Fraction:
        """Return P(target_events | engine conditions and optional constraints)."""
        if constraints:
            combined = dict(self.conditions)
            combined.update({_normalize_hand(k): v for k, v in constraints.items()})
            return ProbabilityEngine(combined).calculate_probability(target_events)

        target = _as_event(target_events)
        denominator = self._count_completions(self.initial_state, self._runtime)
        if denominator == 0:
            return Fraction(0, 1)

        numerator = self._count_event(self.initial_state, self._runtime, target)
        return Fraction(numerator, denominator)

    def compare(self, events: Mapping[str, Event]) -> Dict[str, Fraction]:
        return {name: self.calculate_probability(event) for name, event in events.items()}

    def _build_initial_state(
        self,
        conditions: Mapping[str, HandCondition],
    ) -> Tuple[_RuntimeCondition, State]:
        owner_by_card = [-1] * 16
        forbidden = [0, 0, 0, 0]
        shape_min = [conditions[hand].shape_min for hand in HANDS]
        shape_max = [conditions[hand].shape_max for hand in HANDS]
        hcp_min = [conditions[hand].hcp_min for hand in HANDS]
        hcp_max = [conditions[hand].hcp_max for hand in HANDS]

        for hand_idx, hand in enumerate(HANDS):
            condition = conditions[hand]
            _validate_condition(condition)
            for card in condition.required_cards:
                if is_honor(card):
                    card_idx = HONOR_INDEX[card]
                    if owner_by_card[card_idx] not in {-1, hand_idx}:
                        raise ValueError(f"Conflicting required owner for {card}")
                    owner_by_card[card_idx] = hand_idx
            for card in condition.forbidden_cards:
                if not is_honor(card):
                    raise ValueError("Forbidden spot cards are not supported by grouped spot states.")
                forbidden[hand_idx] |= 1 << HONOR_INDEX[card]

        runtime = _RuntimeCondition(
            owner_by_card=tuple(owner_by_card),
            forbidden_mask_by_hand=tuple(forbidden),
            shape_min=tuple(shape_min),
            shape_max=tuple(shape_max),
            shape_patterns=(None, None, None, None),
            hcp_min=tuple(hcp_min),  # type: ignore[arg-type]
            hcp_max=tuple(hcp_max),  # type: ignore[arg-type]
        )

        state = State()
        for hand_idx, hand in enumerate(HANDS):
            for card in conditions[hand].required_cards:
                state = self._assign_card(state, hand_idx, card)
        if not self._state_can_satisfy(state, runtime):
            return runtime, State(vacant_spaces=(-1, -1, -1, -1))
        return runtime, state

    def _runtime_with_event(self, runtime: _RuntimeCondition, event: Event) -> _RuntimeCondition:
        owner_by_card = list(runtime.owner_by_card)
        shape_min = [list(row) for row in runtime.shape_min]
        shape_max = [list(row) for row in runtime.shape_max]
        shape_patterns = list(runtime.shape_patterns)
        hcp_min = list(runtime.hcp_min)
        hcp_max = list(runtime.hcp_max)

        for atom in _flatten_and(event):
            if isinstance(atom, CardInHand):
                card = normalize_card(atom.card)
                if not is_honor(card):
                    continue
                if is_honor(card):
                    card_idx = HONOR_INDEX[card]
                    hand_idx = HAND_INDEX[_normalize_hand(atom.hand)]
                    if owner_by_card[card_idx] not in {-1, hand_idx}:
                        return _impossible_runtime()
                    owner_by_card[card_idx] = hand_idx
            elif isinstance(atom, HcpRange):
                hand_idx = HAND_INDEX[_normalize_hand(atom.hand)]
                hcp_min[hand_idx] = max(hcp_min[hand_idx], int(atom.minimum))
                hcp_max[hand_idx] = min(hcp_max[hand_idx], int(atom.maximum))
            elif isinstance(atom, SuitCountRange):
                hand_idx = HAND_INDEX[_normalize_hand(atom.hand)]
                suit_idx = SUIT_INDEX[atom.suit.strip().upper()[0]]
                shape_min[hand_idx][suit_idx] = max(shape_min[hand_idx][suit_idx], int(atom.minimum))
                shape_max[hand_idx][suit_idx] = min(shape_max[hand_idx][suit_idx], int(atom.maximum))
            elif isinstance(atom, ShapePattern):
                hand_idx = HAND_INDEX[_normalize_hand(atom.hand)]
                shape_patterns[hand_idx] = tuple(sorted(atom.shape, reverse=True))
            else:
                raise ValueError("Only conjunctions of atomic events can be pushed into DP constraints.")

        return _RuntimeCondition(
            owner_by_card=tuple(owner_by_card),
            forbidden_mask_by_hand=runtime.forbidden_mask_by_hand,
            shape_min=tuple(tuple(row) for row in shape_min),
            shape_max=tuple(tuple(row) for row in shape_max),
            shape_patterns=tuple(shape_patterns),  # type: ignore[arg-type]
            hcp_min=tuple(hcp_min),  # type: ignore[arg-type]
            hcp_max=tuple(hcp_max),  # type: ignore[arg-type]
        )

    def _count_event(self, state: State, runtime: _RuntimeCondition, event: Event) -> int:
        conjunctions = _event_to_conjunctions(event)
        if not conjunctions:
            return 0
        if len(conjunctions) == 1:
            conjunction = AndEvent(conjunctions[0])
            event_runtime = self._runtime_with_event(runtime, conjunction)
            event_state = self._apply_spot_card_events(state, conjunction)
            return self._count_completions(event_state, event_runtime)
        return self._count_union(state, runtime, tuple(AndEvent(conj) for conj in conjunctions))

    def _apply_spot_card_events(self, state: State, event: Event) -> State:
        next_state = state
        for atom in _flatten_and(event):
            if isinstance(atom, CardInHand):
                card = normalize_card(atom.card)
                if not is_honor(card):
                    next_state = self._assign_card(next_state, HAND_INDEX[_normalize_hand(atom.hand)], card)
        return next_state

    def _count_union(
        self,
        state: State,
        runtime: _RuntimeCondition,
        events: Sequence[Event],
    ) -> int:
        total = 0
        event_count = len(events)
        for mask in range(1, 1 << event_count):
            subset = tuple(events[idx] for idx in range(event_count) if mask & (1 << idx))
            intersection = AndEvent(subset)
            ways = self._count_event(state, runtime, intersection)
            if mask.bit_count() % 2:
                total += ways
            else:
                total -= ways
        return total

    @lru_cache(maxsize=None)
    def _count_completions(self, state: State, runtime: _RuntimeCondition) -> int:
        if min(state.vacant_spaces) < 0:
            return 0
        if not self._state_can_satisfy(state, runtime):
            return 0

        if _has_no_shape_constraints(runtime):
            return self._count_hcp_only_compact(
                state.vacant_spaces,
                state.remaining_honors,
                state.remaining_spots,
                state.hcp,
                runtime,
            )

        tracked_suits = _constrained_suits(runtime, state.vacant_spaces)
        if not tracked_suits:
            return self._count_hcp_only_compact(
                state.vacant_spaces,
                state.remaining_honors,
                state.remaining_spots,
                state.hcp,
                runtime,
            )
        tracked_counts = tuple(
            state.suit_count(hand_idx, suit_idx)
            for hand_idx in range(4)
            for suit_idx in tracked_suits
        )
        return self._count_tracked_suits_compact(
            state.vacant_spaces,
            state.remaining_honors,
            state.remaining_spots,
            state.hcp,
            tracked_counts,
            tracked_suits,
            runtime,
        )

        honor_idx = _first_remaining_honor(state.remaining_honors)
        if honor_idx >= 0:
            card = HONOR_CARDS[honor_idx]
            required_owner = runtime.owner_by_card[honor_idx]
            total = 0
            owners = (required_owner,) if required_owner >= 0 else range(4)
            for hand_idx in owners:
                if state.vacant_spaces[hand_idx] <= 0:
                    continue
                if runtime.forbidden_mask_by_hand[hand_idx] & (1 << honor_idx):
                    continue
                next_state = self._assign_honor(state, hand_idx, honor_idx)
                total += self._count_completions(next_state, runtime)
            return total

        return self._count_spots(state, runtime, 0)

    @lru_cache(maxsize=None)
    def _count_hcp_only_compact(
        self,
        vacant_spaces: Tuple[int, int, int, int],
        remaining_honors: int,
        remaining_spots: Tuple[int, int, int, int],
        hcp: Tuple[int, int, int, int],
        runtime: _RuntimeCondition,
    ) -> int:
        if min(vacant_spaces) < 0:
            return 0
        remaining_points = sum(
            HCP[HONOR_CARDS[idx][1]]
            for idx in range(16)
            if remaining_honors & (1 << idx)
        )
        for hand_idx in range(4):
            if hcp[hand_idx] > runtime.hcp_max[hand_idx]:
                return 0
            if hcp[hand_idx] + remaining_points < runtime.hcp_min[hand_idx]:
                return 0

        honor_idx = _first_remaining_honor(remaining_honors)
        if honor_idx >= 0:
            card = HONOR_CARDS[honor_idx]
            required_owner = runtime.owner_by_card[honor_idx]
            total = 0
            owners = (required_owner,) if required_owner >= 0 else range(4)
            for hand_idx in owners:
                if vacant_spaces[hand_idx] <= 0:
                    continue
                if runtime.forbidden_mask_by_hand[hand_idx] & (1 << honor_idx):
                    continue
                next_vacant = list(vacant_spaces)
                next_hcp = list(hcp)
                next_vacant[hand_idx] -= 1
                if _hand_hcp_constrained(runtime, hand_idx):
                    next_hcp[hand_idx] += HCP[card[1]]
                total += self._count_hcp_only_compact(
                    tuple(next_vacant),  # type: ignore[arg-type]
                    remaining_honors ^ (1 << honor_idx),
                    remaining_spots,
                    tuple(next_hcp),  # type: ignore[arg-type]
                    runtime,
                )
            return total

        total_spots = sum(remaining_spots)
        if sum(vacant_spaces) != total_spots:
            return 0
        for hand_idx in range(4):
            if not (runtime.hcp_min[hand_idx] <= hcp[hand_idx] <= runtime.hcp_max[hand_idx]):
                return 0
        return Comb.multinomial(total_spots, vacant_spaces)

    @lru_cache(maxsize=None)
    def _count_spots(self, state: State, runtime: _RuntimeCondition, suit_idx: int) -> int:
        if suit_idx == 4:
            if any(state.vacant_spaces):
                return 0
            return 1 if self._state_satisfies_final(state, runtime) else 0

        spots_left = state.remaining_spots[suit_idx]
        total = 0
        for alloc in _spot_allocations(state.vacant_spaces, spots_left):
            next_state = self._assign_spots(state, suit_idx, alloc)
            if not self._state_can_satisfy(next_state, runtime):
                continue
            ways = Comb.multinomial(spots_left, alloc)
            total += ways * self._count_spots(next_state, runtime, suit_idx + 1)
        return total

    @lru_cache(maxsize=None)
    def _count_tracked_suits_compact(
        self,
        vacant_spaces: Tuple[int, int, int, int],
        remaining_honors: int,
        remaining_spots: Tuple[int, int, int, int],
        hcp: Tuple[int, int, int, int],
        tracked_counts: Tuple[int, ...],
        tracked_suits: Tuple[int, ...],
        runtime: _RuntimeCondition,
    ) -> int:
        if not _compact_state_can_satisfy(
            vacant_spaces,
            remaining_honors,
            remaining_spots,
            hcp,
            tracked_counts,
            tracked_suits,
            runtime,
        ):
            return 0

        honor_idx = _first_structural_honor(remaining_honors, tracked_suits, runtime)
        if honor_idx >= 0:
            card = HONOR_CARDS[honor_idx]
            suit_idx = SUIT_INDEX[card[0]]
            required_owner = runtime.owner_by_card[honor_idx]
            total = 0
            owners = (required_owner,) if required_owner >= 0 else range(4)
            for hand_idx in owners:
                if vacant_spaces[hand_idx] <= 0:
                    continue
                if runtime.forbidden_mask_by_hand[hand_idx] & (1 << honor_idx):
                    continue
                next_vacant = list(vacant_spaces)
                next_hcp = list(hcp)
                next_counts = list(tracked_counts)
                next_vacant[hand_idx] -= 1
                if _hand_hcp_constrained(runtime, hand_idx):
                    next_hcp[hand_idx] += HCP[card[1]]
                if suit_idx in tracked_suits:
                    pos = hand_idx * len(tracked_suits) + tracked_suits.index(suit_idx)
                    next_counts[pos] += 1
                total += self._count_tracked_suits_compact(
                    tuple(next_vacant),  # type: ignore[arg-type]
                    remaining_honors ^ (1 << honor_idx),
                    remaining_spots,
                    tuple(next_hcp),  # type: ignore[arg-type]
                    tuple(next_counts),
                    tracked_suits,
                    runtime,
                )
            return total

        free_counts = _free_honor_point_counts(remaining_honors)
        return self._count_free_honors_grouped(
            vacant_spaces,
            free_counts,
            remaining_spots,
            hcp,
            tracked_counts,
            tracked_suits,
            runtime,
            0,
        )

    @lru_cache(maxsize=None)
    def _count_free_honors_grouped(
        self,
        vacant_spaces: Tuple[int, int, int, int],
        point_counts: Tuple[int, int, int, int],
        remaining_spots: Tuple[int, int, int, int],
        hcp: Tuple[int, int, int, int],
        tracked_counts: Tuple[int, ...],
        tracked_suits: Tuple[int, ...],
        runtime: _RuntimeCondition,
        point_pos: int,
    ) -> int:
        if point_pos == 4:
            return self._count_tracked_spots_compact(
                vacant_spaces,
                remaining_spots,
                hcp,
                tracked_counts,
                tracked_suits,
                runtime,
                0,
            )

        points = (4, 3, 2, 1)[point_pos]
        card_count = point_counts[point_pos]
        if card_count == 0:
            return self._count_free_honors_grouped(
                vacant_spaces,
                point_counts,
                remaining_spots,
                hcp,
                tracked_counts,
                tracked_suits,
                runtime,
                point_pos + 1,
            )

        total = 0
        for alloc in _spot_allocations(vacant_spaces, card_count):
            next_vacant = tuple(vacant_spaces[idx] - alloc[idx] for idx in range(4))
            next_hcp = tuple(
                hcp[idx] + points * alloc[idx] if _hand_hcp_constrained(runtime, idx) else hcp[idx]
                for idx in range(4)
            )
            if not _compact_state_can_satisfy(
                next_vacant,  # type: ignore[arg-type]
                0,
                remaining_spots,
                next_hcp,  # type: ignore[arg-type]
                tracked_counts,
                tracked_suits,
                runtime,
            ):
                continue
            ways = Comb.multinomial(card_count, alloc)
            total += ways * self._count_free_honors_grouped(
                next_vacant,  # type: ignore[arg-type]
                point_counts,
                remaining_spots,
                next_hcp,  # type: ignore[arg-type]
                tracked_counts,
                tracked_suits,
                runtime,
                point_pos + 1,
            )
        return total

    @lru_cache(maxsize=None)
    def _count_tracked_spots_compact(
        self,
        vacant_spaces: Tuple[int, int, int, int],
        remaining_spots: Tuple[int, int, int, int],
        hcp: Tuple[int, int, int, int],
        tracked_counts: Tuple[int, ...],
        tracked_suits: Tuple[int, ...],
        runtime: _RuntimeCondition,
        tracked_pos: int,
    ) -> int:
        if tracked_pos == len(tracked_suits):
            if not _compact_final_satisfies(hcp, tracked_counts, tracked_suits, runtime):
                return 0
            untracked_spots = sum(
                remaining_spots[suit_idx]
                for suit_idx in range(4)
                if suit_idx not in tracked_suits
            )
            if sum(vacant_spaces) != untracked_spots:
                return 0
            return Comb.multinomial(untracked_spots, vacant_spaces)

        suit_idx = tracked_suits[tracked_pos]
        total = 0
        for alloc in _spot_allocations(vacant_spaces, remaining_spots[suit_idx]):
            next_vacant = tuple(vacant_spaces[idx] - alloc[idx] for idx in range(4))
            next_counts = list(tracked_counts)
            for hand_idx, count in enumerate(alloc):
                next_counts[hand_idx * len(tracked_suits) + tracked_pos] += count
            if not _compact_state_can_satisfy(
                next_vacant,  # type: ignore[arg-type]
                0,
                remaining_spots,
                hcp,
                tuple(next_counts),
                tracked_suits,
                runtime,
            ):
                continue
            ways = Comb.multinomial(remaining_spots[suit_idx], alloc)
            total += ways * self._count_tracked_spots_compact(
                next_vacant,  # type: ignore[arg-type]
                remaining_spots,
                hcp,
                tuple(next_counts),
                tracked_suits,
                runtime,
                tracked_pos + 1,
            )
        return total

    def _assign_card(self, state: State, hand_idx: int, card: str) -> State:
        if is_honor(card):
            return self._assign_honor(state, hand_idx, HONOR_INDEX[card])
        suit_idx = SUIT_INDEX[card[0]]
        if state.remaining_spots[suit_idx] <= 0:
            raise ValueError(f"Spot card bucket exhausted for {card}")
        return self._assign_spots(state, suit_idx, tuple(1 if idx == hand_idx else 0 for idx in range(4)))

    def _assign_honor(self, state: State, hand_idx: int, honor_idx: int) -> State:
        bit = 1 << honor_idx
        if not state.remaining_honors & bit:
            raise ValueError(f"Honor already assigned: {HONOR_CARDS[honor_idx]}")
        card = HONOR_CARDS[honor_idx]
        suit_idx = SUIT_INDEX[card[0]]
        rank = card[1]
        return _replace_state(
            state,
            hand_idx=hand_idx,
            suit_idx=suit_idx,
            card_count=1,
            hcp_add=HCP[rank],
            remaining_honors=state.remaining_honors ^ bit,
        )

    def _assign_spots(self, state: State, suit_idx: int, alloc: Sequence[int]) -> State:
        if sum(alloc) > state.remaining_spots[suit_idx]:
            raise ValueError("Spot allocation exceeds remaining cards")
        vacant = list(state.vacant_spaces)
        suit_counts = list(state.suit_counts)
        for hand_idx, count in enumerate(alloc):
            vacant[hand_idx] -= count
            suit_counts[hand_idx * 4 + suit_idx] += count
        spots = list(state.remaining_spots)
        spots[suit_idx] -= sum(alloc)
        return State(
            vacant_spaces=tuple(vacant),  # type: ignore[arg-type]
            remaining_honors=state.remaining_honors,
            remaining_spots=tuple(spots),  # type: ignore[arg-type]
            hcp=state.hcp,
            suit_counts=tuple(suit_counts),
        )

    def _state_can_satisfy(self, state: State, runtime: _RuntimeCondition) -> bool:
        if min(state.vacant_spaces) < 0:
            return False
        remaining_hcp = _remaining_hcp_by_points(state.remaining_honors)
        total_remaining_hcp = sum(point * count for point, count in remaining_hcp.items())
        for hand_idx in range(4):
            if state.hcp[hand_idx] > runtime.hcp_max[hand_idx]:
                return False
            if state.hcp[hand_idx] + total_remaining_hcp < runtime.hcp_min[hand_idx]:
                return False
            for suit_idx in range(4):
                current = state.suit_count(hand_idx, suit_idx)
                if current > runtime.shape_max[hand_idx][suit_idx]:
                    return False
                max_extra = min(state.vacant_spaces[hand_idx], _remaining_suit_cards(state, suit_idx))
                if current + max_extra < runtime.shape_min[hand_idx][suit_idx]:
                    return False
        return True

    def _state_satisfies_final(self, state: State, runtime: _RuntimeCondition) -> bool:
        for hand_idx in range(4):
            if not (runtime.hcp_min[hand_idx] <= state.hcp[hand_idx] <= runtime.hcp_max[hand_idx]):
                return False
            for suit_idx in range(4):
                count = state.suit_count(hand_idx, suit_idx)
                if not (runtime.shape_min[hand_idx][suit_idx] <= count <= runtime.shape_max[hand_idx][suit_idx]):
                    return False
            pattern = runtime.shape_patterns[hand_idx]
            if pattern is not None:
                counts = [state.suit_count(hand_idx, suit_idx) for suit_idx in range(4)]
                if tuple(sorted(counts, reverse=True)) != pattern:
                    return False
        return True


def spade_split_event(east_count: int, west_count: int) -> AndEvent:
    return AndEvent(
        (
            SuitCountRange("east", "S", east_count, east_count),
            SuitCountRange("west", "S", west_count, west_count),
        )
    )


def example_compare_ew_spade_splits() -> Dict[str, Fraction]:
    engine = ProbabilityEngine(
        {
            "north": HandCondition.feature(
                required_cards=("SA",),
                hcp_min=15,
                hcp_max=17,
            )
        }
    )
    return engine.compare(
        {
            "E/W spades 3-3": spade_split_event(3, 3),
            "E/W spades 4-2": OrEvent(
                (
                    spade_split_event(4, 2),
                    spade_split_event(2, 4),
                )
            ),
        }
    )


def normalize_card(raw: str) -> str:
    token = str(raw).strip().upper().replace("10", "T")
    if len(token) != 2 or token[0] not in SUIT_INDEX or token[1] not in RANKS:
        raise ValueError(f"Invalid card notation: {raw}")
    return token


def is_honor(card: str) -> bool:
    return normalize_card(card)[1] in HONORS


def _normalize_hand(raw: str) -> str:
    hand = str(raw).strip().lower()
    if hand in HAND_INDEX:
        return hand
    aliases = {"n": "north", "s": "south", "e": "east", "w": "west"}
    if hand in aliases:
        return aliases[hand]
    raise ValueError(f"Unknown hand: {raw}")


def _as_event(events: Event | Sequence[Event]) -> Event:
    if isinstance(events, Event):
        return events
    return AndEvent(tuple(events))


def _event_to_conjunctions(event: Event) -> Tuple[Tuple[Event, ...], ...]:
    if isinstance(event, OrEvent):
        parts: list[Tuple[Event, ...]] = []
        for child in event.events:
            parts.extend(_event_to_conjunctions(child))
        return tuple(parts)
    if isinstance(event, AndEvent):
        conjunctions: Tuple[Tuple[Event, ...], ...] = ((),)
        for child in event.events:
            child_conjunctions = _event_to_conjunctions(child)
            next_conjunctions = []
            for left in conjunctions:
                for right in child_conjunctions:
                    next_conjunctions.append(left + right)
            conjunctions = tuple(next_conjunctions)
        return conjunctions
    return ((event,),)


def _flatten_and(event: Event) -> Tuple[Event, ...]:
    if isinstance(event, AndEvent):
        atoms: list[Event] = []
        for child in event.events:
            atoms.extend(_flatten_and(child))
        return tuple(atoms)
    if isinstance(event, OrEvent):
        raise ValueError("OrEvent must be evaluated by inclusion/exclusion at the caller level.")
    return (event,)


def _first_remaining_honor(mask: int) -> int:
    if mask == 0:
        return -1
    return (mask & -mask).bit_length() - 1


def _first_structural_honor(
    mask: int,
    tracked_suits: Sequence[int],
    runtime: _RuntimeCondition,
) -> int:
    for idx, card in enumerate(HONOR_CARDS):
        if not mask & (1 << idx):
            continue
        suit_idx = SUIT_INDEX[card[0]]
        if suit_idx in tracked_suits:
            return idx
        if runtime.owner_by_card[idx] != -1:
            return idx
        if any(runtime.forbidden_mask_by_hand[hand_idx] & (1 << idx) for hand_idx in range(4)):
            return idx
    return -1


def _free_honor_point_counts(mask: int) -> Tuple[int, int, int, int]:
    counts = [0, 0, 0, 0]
    point_pos = {4: 0, 3: 1, 2: 2, 1: 3}
    for idx, card in enumerate(HONOR_CARDS):
        if mask & (1 << idx):
            counts[point_pos[HCP[card[1]]]] += 1
    return tuple(counts)  # type: ignore[return-value]


def _remaining_hcp_by_points(mask: int) -> Dict[int, int]:
    counts = {4: 0, 3: 0, 2: 0, 1: 0}
    for idx, card in enumerate(HONOR_CARDS):
        if mask & (1 << idx):
            counts[HCP[card[1]]] += 1
    return counts


def _remaining_suit_cards(state: State, suit_idx: int) -> int:
    honors = 0
    for rank in HONORS:
        card_idx = HONOR_INDEX[SUITS[suit_idx] + rank]
        if state.remaining_honors & (1 << card_idx):
            honors += 1
    return honors + state.remaining_spots[suit_idx]


def _has_no_shape_constraints(runtime: _RuntimeCondition) -> bool:
    if any(pattern is not None for pattern in runtime.shape_patterns):
        return False
    return all(
        runtime.shape_min[hand_idx][suit_idx] == 0
        and runtime.shape_max[hand_idx][suit_idx] == 13
        for hand_idx in range(4)
        for suit_idx in range(4)
    )


def _hand_hcp_constrained(runtime: _RuntimeCondition, hand_idx: int) -> bool:
    return runtime.hcp_min[hand_idx] != 0 or runtime.hcp_max[hand_idx] != 37


def _constrained_suits(
    runtime: _RuntimeCondition,
    vacant_spaces: Sequence[int] = (13, 13, 13, 13),
) -> Tuple[int, ...]:
    suits = []
    for suit_idx in range(4):
        if any(
            (
                runtime.shape_patterns[hand_idx] is not None
                or vacant_spaces[hand_idx] > 0
            )
            and (
                runtime.shape_min[hand_idx][suit_idx] != 0
                or runtime.shape_max[hand_idx][suit_idx] != 13
                or runtime.shape_patterns[hand_idx] is not None
            )
            for hand_idx in range(4)
        ):
            suits.append(suit_idx)
    return tuple(suits)


def _compact_state_can_satisfy(
    vacant_spaces: Sequence[int],
    remaining_honors: int,
    remaining_spots: Sequence[int],
    hcp: Sequence[int],
    tracked_counts: Sequence[int],
    tracked_suits: Sequence[int],
    runtime: _RuntimeCondition,
) -> bool:
    if min(vacant_spaces) < 0:
        return False
    remaining_points = sum(
        HCP[HONOR_CARDS[idx][1]]
        for idx in range(16)
        if remaining_honors & (1 << idx)
    )
    tracked_width = len(tracked_suits)
    for hand_idx in range(4):
        if hcp[hand_idx] > runtime.hcp_max[hand_idx]:
            return False
        if hcp[hand_idx] + remaining_points < runtime.hcp_min[hand_idx]:
            return False
        for pos, suit_idx in enumerate(tracked_suits):
            current = tracked_counts[hand_idx * tracked_width + pos]
            if current > runtime.shape_max[hand_idx][suit_idx]:
                return False
            remaining_in_suit = remaining_spots[suit_idx] + sum(
                1
                for rank in HONORS
                if remaining_honors & (1 << HONOR_INDEX[SUITS[suit_idx] + rank])
            )
            if current + min(vacant_spaces[hand_idx], remaining_in_suit) < runtime.shape_min[hand_idx][suit_idx]:
                return False
    return True


def _compact_final_satisfies(
    hcp: Sequence[int],
    tracked_counts: Sequence[int],
    tracked_suits: Sequence[int],
    runtime: _RuntimeCondition,
) -> bool:
    tracked_width = len(tracked_suits)
    for hand_idx in range(4):
        if not (runtime.hcp_min[hand_idx] <= hcp[hand_idx] <= runtime.hcp_max[hand_idx]):
            return False
        for pos, suit_idx in enumerate(tracked_suits):
            count = tracked_counts[hand_idx * tracked_width + pos]
            if not (runtime.shape_min[hand_idx][suit_idx] <= count <= runtime.shape_max[hand_idx][suit_idx]):
                return False
        pattern = runtime.shape_patterns[hand_idx]
        if pattern is not None:
            if len(tracked_suits) != 4:
                return False
            counts = [
                tracked_counts[hand_idx * tracked_width + tracked_suits.index(suit_idx)]
                for suit_idx in range(4)
            ]
            if tuple(sorted(counts, reverse=True)) != pattern:
                return False
    return True


def _spot_allocations(vacant_spaces: Sequence[int], total: int) -> Iterator[Tuple[int, int, int, int]]:
    for north in range(min(vacant_spaces[0], total) + 1):
        rem_n = total - north
        for south in range(min(vacant_spaces[1], rem_n) + 1):
            rem_ns = rem_n - south
            low_east = max(0, rem_ns - vacant_spaces[3])
            high_east = min(vacant_spaces[2], rem_ns)
            for east in range(low_east, high_east + 1):
                west = rem_ns - east
                if west <= vacant_spaces[3]:
                    yield north, south, east, west


def _replace_state(
    state: State,
    *,
    hand_idx: int,
    suit_idx: int,
    card_count: int,
    hcp_add: int,
    remaining_honors: int,
) -> State:
    vacant = list(state.vacant_spaces)
    hcp = list(state.hcp)
    suit_counts = list(state.suit_counts)
    vacant[hand_idx] -= card_count
    hcp[hand_idx] += hcp_add
    suit_counts[hand_idx * 4 + suit_idx] += card_count
    return State(
        vacant_spaces=tuple(vacant),  # type: ignore[arg-type]
        remaining_honors=remaining_honors,
        remaining_spots=state.remaining_spots,
        hcp=tuple(hcp),  # type: ignore[arg-type]
        suit_counts=tuple(suit_counts),
    )


def _validate_condition(condition: HandCondition) -> None:
    if len(condition.shape_min) != 4 or len(condition.shape_max) != 4:
        raise ValueError("shape_min and shape_max must have four suit entries")
    if not 0 <= condition.hcp_min <= condition.hcp_max <= 37:
        raise ValueError("Invalid HCP range")
    for min_len, max_len in zip(condition.shape_min, condition.shape_max):
        if not 0 <= min_len <= max_len <= 13:
            raise ValueError("Invalid shape range")
    cards = tuple(normalize_card(card) for card in condition.required_cards)
    if len(set(cards)) != len(cards):
        raise ValueError("Duplicate required card")
    if condition.full_hand and set(condition.full_hand) != set(condition.required_cards):
        raise ValueError("full_hand and required_cards are inconsistent")


def _impossible_runtime() -> _RuntimeCondition:
    return _RuntimeCondition(
        owner_by_card=tuple([-2] * 16),
        forbidden_mask_by_hand=(0, 0, 0, 0),
        shape_min=((14, 14, 14, 14),) * 4,
        shape_max=((0, 0, 0, 0),) * 4,
        shape_patterns=(None, None, None, None),
        hcp_min=(38, 38, 38, 38),
        hcp_max=(0, 0, 0, 0),
    )
