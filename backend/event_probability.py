from __future__ import annotations

from dataclasses import dataclass, field
from itertools import product
from math import comb, factorial
from typing import Any, Mapping

try:
    from .events import (
        CardHoldingEvent,
        HcpEvent,
        Player,
        ShapePatternEvent,
        Suit,
        SuitLengthEvent,
        VALID_PLAYERS,
        VALID_SUITS,
    )
except ImportError:
    from events import (
        CardHoldingEvent,
        HcpEvent,
        Player,
        ShapePatternEvent,
        Suit,
        SuitLengthEvent,
        VALID_PLAYERS,
        VALID_SUITS,
    )


PLAYERS: tuple[Player, ...] = ("N", "S", "E", "W")
SUITS: tuple[Suit, ...] = ("S", "H", "D", "C")
RANKS: tuple[str, ...] = ("A", "K", "Q", "J", "T", "9", "8", "7", "6", "5", "4", "3", "2")
HONOR_RANKS: tuple[str, ...] = ("A", "K", "Q", "J")
HCP_VALUES: dict[str, int] = {"A": 4, "K": 3, "Q": 2, "J": 1}
FULL_DECK: frozenset[str] = frozenset(f"{suit}{rank}" for suit in SUITS for rank in RANKS)

__all__ = [
    "EvaluationState",
    "FULL_DECK",
    "HCP_VALUES",
    "HONOR_RANKS",
    "PLAYERS",
    "RANKS",
    "SUITS",
    "calc_card_holding_prob",
    "calc_hcp_prob",
    "calc_shape_pattern_prob",
    "calc_suit_length_prob",
    "evaluate_single_suit",
]


@dataclass(slots=True)
class EvaluationState:
    """Known local constraints at the current event-evaluation phase."""

    vacant_spaces: dict[Player, int] = field(
        default_factory=lambda: {player: 13 for player in PLAYERS}
    )
    known_cards: dict[Player, list[str]] = field(
        default_factory=lambda: {player: [] for player in PLAYERS}
    )
    known_suit_lengths: dict[Player, dict[Suit, int]] = field(
        default_factory=lambda: {player: {} for player in PLAYERS}
    )

    def __post_init__(self) -> None:
        self.vacant_spaces = {player: self.vacant_spaces.get(player, 13) for player in PLAYERS}
        self.known_cards = {player: list(self.known_cards.get(player, [])) for player in PLAYERS}
        self.known_suit_lengths = {
            player: dict(self.known_suit_lengths.get(player, {})) for player in PLAYERS
        }
        self._validate()

    @property
    def known_card_count(self) -> int:
        return sum(len(cards) for cards in self.known_cards.values())

    @property
    def remaining_card_count(self) -> int:
        """Number of concrete cards not assigned to a specific player yet."""

        return 52 - self.known_card_count

    @property
    def remaining_unassigned_card_count(self) -> int:
        """Cards not assigned and not reserved by exact suit-length constraints."""

        return self.remaining_card_count - self.unknown_suit_allocation_count()

    def remaining_suit_count(self, suit: Suit) -> int:
        """Cards of a suit not assigned and not reserved by exact suit lengths."""

        self._validate_suit(suit)
        known_specific = sum(1 for cards in self.known_cards.values() for card in cards if card[0] == suit)
        reserved_unknown = self.unknown_suit_allocation_count(suit=suit)
        return 13 - known_specific - reserved_unknown

    def card_owner(self, card: str) -> Player | None:
        self._validate_card(card)
        for player, cards in self.known_cards.items():
            if card in cards:
                return player
        return None

    def known_suit_count(self, player: Player, suit: Suit) -> int:
        self._validate_player(player)
        self._validate_suit(suit)
        return sum(1 for card in self.known_cards[player] if card[0] == suit)

    def known_suit_length(self, player: Player, suit: Suit) -> int | None:
        self._validate_player(player)
        self._validate_suit(suit)
        return self.known_suit_lengths[player].get(suit)

    def unknown_suit_allocation_count(
        self,
        *,
        player: Player | None = None,
        suit: Suit | None = None,
    ) -> int:
        """Count suit-constrained but not card-identified slots."""

        players = (player,) if player is not None else PLAYERS
        suits = (suit,) if suit is not None else SUITS
        total = 0
        for current_player in players:
            self._validate_player(current_player)
            for current_suit in suits:
                self._validate_suit(current_suit)
                exact_length = self.known_suit_lengths[current_player].get(current_suit)
                if exact_length is None:
                    continue
                known_specific = self.known_suit_count(current_player, current_suit)
                total += exact_length - known_specific
        return total

    def free_spaces_excluding_known_suits(
        self,
        player: Player,
        *,
        exclude_suit: Suit | None = None,
    ) -> int:
        self._validate_player(player)
        reserved = 0
        for suit in SUITS:
            if suit == exclude_suit:
                continue
            reserved += self.unknown_suit_allocation_count(player=player, suit=suit)
        return self.vacant_spaces[player] - reserved

    def assign_card(self, event: CardHoldingEvent) -> None:
        """Apply a known card placement to the state."""

        owner = self.card_owner(event.card)
        if owner == event.player:
            return
        if owner is not None:
            raise ValueError(f"{event.card} is already assigned to {owner}")
        if self.vacant_spaces[event.player] <= 0:
            raise ValueError(f"{event.player} has no vacant spaces")
        self.known_cards[event.player].append(event.card)
        self.vacant_spaces[event.player] -= 1
        self._validate()

    def set_suit_length(self, event: SuitLengthEvent) -> None:
        """Apply an exact suit-length constraint to the state."""

        if event.min_length != event.max_length:
            raise ValueError("EvaluationState stores only exact suit-length constraints")
        known_specific = self.known_suit_count(event.player, event.suit)
        if event.min_length < known_specific:
            raise ValueError("exact suit length cannot be smaller than known specific cards")
        if event.min_length > known_specific + self.vacant_spaces[event.player]:
            raise ValueError("exact suit length exceeds the player's available spaces")
        self.known_suit_lengths[event.player][event.suit] = event.min_length
        self._validate()

    def _validate(self) -> None:
        seen_cards: set[str] = set()
        for player in PLAYERS:
            self._validate_player(player)
            vacant = self.vacant_spaces[player]
            if not isinstance(vacant, int) or vacant < 0 or vacant > 13:
                raise ValueError(f"invalid vacant spaces for {player}: {vacant!r}")
            if vacant + len(self.known_cards[player]) != 13:
                raise ValueError(f"known cards and vacant spaces do not add to 13 for {player}")
            for card in self.known_cards[player]:
                self._validate_card(card)
                if card in seen_cards:
                    raise ValueError(f"card assigned more than once: {card}")
                seen_cards.add(card)
            self._validate_suit_lengths(player, self.known_suit_lengths[player])
        if self.remaining_unassigned_card_count < 0:
            raise ValueError("known constraints reserve more cards than remain in the deck")
        for suit in SUITS:
            if self.remaining_suit_count(suit) < 0:
                raise ValueError(f"known constraints reserve too many {suit} cards")

    def _validate_suit_lengths(self, player: Player, lengths: Mapping[Suit, int]) -> None:
        reserved_unknown_total = 0
        for suit, exact_length in lengths.items():
            self._validate_suit(suit)
            if not isinstance(exact_length, int) or exact_length < 0 or exact_length > 13:
                raise ValueError(f"invalid exact suit length: {exact_length!r}")
            known_specific = self.known_suit_count(player, suit)
            if exact_length < known_specific:
                raise ValueError("exact suit length cannot be smaller than known specific cards")
            reserved_unknown_total += exact_length - known_specific
        if reserved_unknown_total > self.vacant_spaces[player]:
            raise ValueError(f"known suit lengths exceed vacant spaces for {player}")

    @staticmethod
    def _validate_player(player: str) -> None:
        if player not in VALID_PLAYERS:
            raise ValueError(f"player must be one of {sorted(VALID_PLAYERS)}: {player!r}")

    @staticmethod
    def _validate_suit(suit: str) -> None:
        if suit not in VALID_SUITS:
            raise ValueError(f"suit must be one of {sorted(VALID_SUITS)}: {suit!r}")

    @staticmethod
    def _validate_card(card: str) -> None:
        if card not in FULL_DECK:
            raise ValueError(f"invalid card: {card!r}")


def calc_card_holding_prob(target: CardHoldingEvent, state: EvaluationState) -> float:
    """Probability that target.player holds target.card under known card placements."""

    owner = state.card_owner(target.card)
    if owner == target.player:
        return 1.0
    if owner is not None:
        return 0.0
    if state.remaining_card_count == 0:
        return 0.0
    return state.vacant_spaces[target.player] / state.remaining_card_count


def calc_suit_length_prob(target: SuitLengthEvent, state: EvaluationState) -> float:
    """Probability of a suit-length range using the hypergeometric distribution."""

    exact_length = state.known_suit_length(target.player, target.suit)
    if exact_length is not None:
        return float(target.min_length <= exact_length <= target.max_length)

    known_in_target_suit = state.known_suit_count(target.player, target.suit)
    min_unknown_needed = target.min_length - known_in_target_suit
    max_unknown_needed = target.max_length - known_in_target_suit

    draws = state.free_spaces_excluding_known_suits(target.player, exclude_suit=target.suit)
    candidate_suits = _candidate_suits_for_player_draw(target.player, target.suit, state)
    successes = state.remaining_suit_count(target.suit)
    population = sum(state.remaining_suit_count(suit) for suit in candidate_suits)
    failures = population - successes

    denominator = _comb(population, draws)
    if denominator == 0:
        return 0.0

    numerator = 0
    for unknown_suit_cards in range(min_unknown_needed, max_unknown_needed + 1):
        # Hypergeometric term:
        # choose x remaining cards from the target suit, then fill the other
        # player slots from all non-target-suit remaining cards.
        numerator += _comb(successes, unknown_suit_cards) * _comb(
            failures,
            draws - unknown_suit_cards,
        )
    return numerator / denominator


def calc_shape_pattern_prob(target: ShapePatternEvent, state: EvaluationState) -> float:
    """Probability of an unordered bridge shape such as 4-4-3-2.

    A pattern like 4-4-3-2 means any suit assignment with those lengths, not
    specifically S=4,H=4,D=3,C=2. The exact suit assignments are mutually
    exclusive, so the total probability is the sum over unique permutations.
    """

    total = 0.0
    for lengths in sorted(set(_permutations(target.lengths))):
        trial_state = _clone_state(state)
        probability = 1.0
        for suit, length in zip(SUITS, lengths):
            event = SuitLengthEvent(target.player, suit, length, length)
            event_probability = calc_suit_length_prob(event, trial_state)
            if event_probability == 0:
                probability = 0.0
                break
            probability *= event_probability
            trial_state.set_suit_length(event)
        total += probability
    return total


def evaluate_single_suit(suit: Suit, state: EvaluationState) -> list[dict[str, Any]]:
    """Enumerate valid honor placements and spot-card weights for one suit.

    For one suit, only four cards carry HCP: A, K, Q, J. Each honor can be
    assigned to one of four players, so the exhaustive search has at most
    4^4 = 256 patterns. For each valid honor pattern, the remaining nine spot
    cards are indistinguishable for HCP but distinguishable as actual cards.

    If no spot cards are already known, the number of suit deals matching the
    pattern is the multinomial coefficient:

        9! / (s_N! * s_S! * s_E! * s_W!)

    where s_X = length_X - honor_count_X.
    """

    EvaluationState._validate_suit(suit)
    lengths = _required_suit_lengths(suit, state)
    known_spots = {
        player: sum(1 for card in state.known_cards[player] if card[0] == suit and card[1] not in HCP_VALUES)
        for player in PLAYERS
    }
    remaining_spot_count = 9 - sum(known_spots.values())
    results: list[dict[str, Any]] = []

    for owners in product(PLAYERS, repeat=len(HONOR_RANKS)):
        hcp_gained: dict[Player, int] = {player: 0 for player in PLAYERS}
        honor_counts: dict[Player, int] = {player: 0 for player in PLAYERS}
        conflicts_with_known_card = False

        for rank, owner in zip(HONOR_RANKS, owners):
            card = f"{suit}{rank}"
            known_owner = state.card_owner(card)
            if known_owner is not None and known_owner != owner:
                conflicts_with_known_card = True
                break
            hcp_gained[owner] += HCP_VALUES[rank]
            honor_counts[owner] += 1

        if conflicts_with_known_card:
            continue

        unknown_spots_needed: dict[Player, int] = {}
        for player in PLAYERS:
            # Total suit length = honors in this pattern + all spot cards.
            # Therefore spot cards needed by player X are:
            #     s_X = length_X - h_X
            spot_total = lengths[player] - honor_counts[player]
            unknown_spots = spot_total - known_spots[player]
            if spot_total < 0 or unknown_spots < 0:
                break
            unknown_spots_needed[player] = unknown_spots
        else:
            if sum(unknown_spots_needed.values()) != remaining_spot_count:
                continue

            # Known spot cards are fixed. The remaining distinguishable spot
            # cards contribute:
            #     remaining_spots! / product(unknown_s_X!)
            # This reduces to the requested 9! / product(s_X!) formula when no
            # spot cards have already been assigned in state.known_cards.
            weight = factorial(remaining_spot_count)
            for player in PLAYERS:
                weight //= factorial(unknown_spots_needed[player])
            results.append({"hcp_gained": hcp_gained, "weight": weight})

    return results


def calc_hcp_prob(target: HcpEvent, state: EvaluationState) -> float:
    """Calculate HCP probability by suit-by-suit convolution DP."""

    if not _has_complete_exact_suit_lengths(state):
        return _calc_hcp_prob_without_shape(target, state)

    suit_options = [evaluate_single_suit(suit, state) for suit in SUITS]
    if any(len(options) == 0 for options in suit_options):
        return 0.0

    # DP key tracks only the target player's HCP total, not the full
    # (N,S,E,W) vector. For one target player the state space is just 0..40.
    dp: dict[int, int] = {0: 1}
    for options in suit_options:
        dp_next: dict[int, int] = {}
        for current_hcp, current_weight in dp.items():
            for option in options:
                hcp_gained = option["hcp_gained"][target.player]
                suit_weight = option["weight"]
                next_hcp = current_hcp + hcp_gained
                # Convolution step:
                # dp_next[h + x] += dp[h] * W_suit(x)
                dp_next[next_hcp] = dp_next.get(next_hcp, 0) + current_weight * suit_weight
        dp = dp_next

    denominator = sum(dp.values())
    if denominator == 0:
        return 0.0
    numerator = sum(
        weight
        for hcp, weight in dp.items()
        if target.min_hcp <= hcp <= target.max_hcp
    )
    return numerator / denominator


def _comb(n: int, k: int) -> int:
    if k < 0 or n < 0 or k > n:
        return 0
    return comb(n, k)


def _candidate_suits_for_player_draw(
    player: Player,
    target_suit: Suit,
    state: EvaluationState,
) -> tuple[Suit, ...]:
    candidate_suits = []
    for suit in SUITS:
        if suit == target_suit or state.known_suit_length(player, suit) is None:
            candidate_suits.append(suit)
    return tuple(candidate_suits)


def _clone_state(state: EvaluationState) -> EvaluationState:
    return EvaluationState(
        vacant_spaces=dict(state.vacant_spaces),
        known_cards={player: list(cards) for player, cards in state.known_cards.items()},
        known_suit_lengths={
            player: dict(lengths) for player, lengths in state.known_suit_lengths.items()
        },
    )


def _permutations(lengths: tuple[int, int, int, int]):
    if len(lengths) <= 1:
        yield lengths
        return
    for index, value in enumerate(lengths):
        rest = lengths[:index] + lengths[index + 1 :]
        for suffix in _permutations(rest):
            yield (value,) + suffix


def _required_suit_lengths(suit: Suit, state: EvaluationState) -> dict[Player, int]:
    lengths: dict[Player, int] = {}
    for player in PLAYERS:
        length = state.known_suit_length(player, suit)
        if length is None:
            raise ValueError(f"HCP calculation requires exact {suit} length for {player}")
        lengths[player] = length
    if sum(lengths.values()) != 13:
        raise ValueError(f"exact {suit} lengths must sum to 13")
    return lengths


def _has_complete_exact_suit_lengths(state: EvaluationState) -> bool:
    for suit in SUITS:
        lengths = [state.known_suit_length(player, suit) for player in PLAYERS]
        if any(length is None for length in lengths):
            return False
        if sum(length for length in lengths if length is not None) != 13:
            return False
    return True


def _calc_hcp_prob_without_shape(target: HcpEvent, state: EvaluationState) -> float:
    """Exact HCP DP when no shape constraints have been materialized."""

    known_target_hcp = sum(
        HCP_VALUES.get(card[1], 0) for card in state.known_cards[target.player]
    )
    needed_cards = state.vacant_spaces[target.player]
    assigned_cards = {card for cards in state.known_cards.values() for card in cards}
    remaining_cards = [card for card in FULL_DECK if card not in assigned_cards]

    # DP over the remaining concrete deck:
    # dp[cards_taken][hcp] = number of ways to choose cards_taken cards
    # producing hcp additional points for target.player.
    dp: list[dict[int, int]] = [{0: 1}] + [dict() for _ in range(needed_cards)]
    for card in remaining_cards:
        points = HCP_VALUES.get(card[1], 0)
        for count in range(needed_cards - 1, -1, -1):
            for hcp, ways in list(dp[count].items()):
                next_count = count + 1
                if next_count > needed_cards:
                    continue
                next_hcp = hcp + points
                dp[next_count][next_hcp] = dp[next_count].get(next_hcp, 0) + ways

    distribution = dp[needed_cards]
    denominator = sum(distribution.values())
    if denominator == 0:
        return 0.0
    numerator = sum(
        ways
        for hcp, ways in distribution.items()
        if target.min_hcp <= known_target_hcp + hcp <= target.max_hcp
    )
    return numerator / denominator
