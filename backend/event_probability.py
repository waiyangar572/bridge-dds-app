from __future__ import annotations

from dataclasses import dataclass, field
from math import comb
from typing import Mapping

try:
    from .events import (
        CardHoldingEvent,
        HcpEvent,
        Player,
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
        Suit,
        SuitLengthEvent,
        VALID_PLAYERS,
        VALID_SUITS,
    )


PLAYERS: tuple[Player, ...] = ("N", "S", "E", "W")
SUITS: tuple[Suit, ...] = ("S", "H", "D", "C")
RANKS: tuple[str, ...] = ("A", "K", "Q", "J", "T", "9", "8", "7", "6", "5", "4", "3", "2")
FULL_DECK: frozenset[str] = frozenset(f"{suit}{rank}" for suit in SUITS for rank in RANKS)

__all__ = [
    "EvaluationState",
    "FULL_DECK",
    "PLAYERS",
    "RANKS",
    "SUITS",
    "calc_card_holding_prob",
    "calc_hcp_prob",
    "calc_suit_length_prob",
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
    successes = state.remaining_suit_count(target.suit)
    population = state.remaining_unassigned_card_count
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


def calc_hcp_prob(target: HcpEvent, state: EvaluationState) -> float:
    """Placeholder for phase-3 HCP calculation."""

    # Future implementation:
    # At this phase, card placements and exact shape constraints are already
    # reflected in EvaluationState. The precise HCP probability should enumerate
    # honor-card allocation patterns within the remaining shape buckets and use
    # dynamic programming over multinomial coefficients to sum the patterns whose
    # point total falls in target.min_hcp..target.max_hcp.
    return 1.0


def _comb(n: int, k: int) -> int:
    if k < 0 or n < 0 or k > n:
        return 0
    return comb(n, k)
