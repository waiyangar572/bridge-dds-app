from __future__ import annotations

from abc import ABC
from dataclasses import dataclass
import re
from typing import Literal


Player = Literal["N", "S", "E", "W"]
Suit = Literal["S", "H", "D", "C"]

__all__ = [
    "AndEvent",
    "BaseEvent",
    "CardHoldingEvent",
    "HcpEvent",
    "NotEvent",
    "Player",
    "Suit",
    "SuitLengthEvent",
]

VALID_PLAYERS = frozenset(("N", "S", "E", "W"))
VALID_SUITS = frozenset(("S", "H", "D", "C"))
VALID_RANKS = frozenset(("A", "K", "Q", "J", "T", "9", "8", "7", "6", "5", "4", "3", "2"))
CARD_RE = re.compile(r"^[SHDC][AKQJT98765432]$")


class BaseEvent(ABC):
    """Base class for immutable event AST nodes."""

    def __and__(self, other: BaseEvent) -> AndEvent:
        if not isinstance(other, BaseEvent):
            return NotImplemented
        return AndEvent.of(self, other)

    def __rand__(self, other: BaseEvent) -> AndEvent:
        if not isinstance(other, BaseEvent):
            return NotImplemented
        return AndEvent.of(other, self)

    def __invert__(self) -> NotEvent:
        return NotEvent(self)

    def __or__(self, other: BaseEvent) -> NotEvent:
        if not isinstance(other, BaseEvent):
            return NotImplemented
        return ~(~self & ~other)

    def __ror__(self, other: BaseEvent) -> NotEvent:
        if not isinstance(other, BaseEvent):
            return NotImplemented
        return ~(~other & ~self)


@dataclass(frozen=True, slots=True)
class SuitLengthEvent(BaseEvent):
    """The player's suit length is between min_length and max_length."""

    player: Player
    suit: Suit
    min_length: int
    max_length: int

    def __post_init__(self) -> None:
        _validate_player(self.player)
        _validate_suit(self.suit)
        _validate_range(self.min_length, self.max_length, lower=0, upper=13, name="suit length")


@dataclass(frozen=True, slots=True)
class HcpEvent(BaseEvent):
    """The player's high-card points are between min_hcp and max_hcp."""

    player: Player
    min_hcp: int
    max_hcp: int

    def __post_init__(self) -> None:
        _validate_player(self.player)
        _validate_range(self.min_hcp, self.max_hcp, lower=0, upper=37, name="HCP")


@dataclass(frozen=True, slots=True)
class CardHoldingEvent(BaseEvent):
    """The player holds exactly the specified card."""

    player: Player
    card: str

    def __post_init__(self) -> None:
        _validate_player(self.player)
        _validate_card(self.card)


@dataclass(frozen=True, slots=True)
class AndEvent(BaseEvent):
    """Logical conjunction of child events."""

    children: tuple[BaseEvent, ...]

    @classmethod
    def of(cls, *events: BaseEvent) -> AndEvent:
        flattened: list[BaseEvent] = []
        for event in events:
            if not isinstance(event, BaseEvent):
                raise TypeError(f"AndEvent children must be BaseEvent instances: {event!r}")
            if isinstance(event, AndEvent):
                flattened.extend(event.children)
            else:
                flattened.append(event)
        return cls(tuple(flattened))

    def __post_init__(self) -> None:
        if len(self.children) < 2:
            raise ValueError("AndEvent requires at least two child events")
        for child in self.children:
            if not isinstance(child, BaseEvent):
                raise TypeError(f"AndEvent child must be a BaseEvent instance: {child!r}")


@dataclass(frozen=True, slots=True)
class NotEvent(BaseEvent):
    """Logical negation of a single child event."""

    child: BaseEvent

    def __post_init__(self) -> None:
        if not isinstance(self.child, BaseEvent):
            raise TypeError(f"NotEvent child must be a BaseEvent instance: {self.child!r}")


def _validate_player(player: str) -> None:
    if player not in VALID_PLAYERS:
        raise ValueError(f"player must be one of {sorted(VALID_PLAYERS)}: {player!r}")


def _validate_suit(suit: str) -> None:
    if suit not in VALID_SUITS:
        raise ValueError(f"suit must be one of {sorted(VALID_SUITS)}: {suit!r}")


def _validate_range(min_value: int, max_value: int, *, lower: int, upper: int, name: str) -> None:
    if not isinstance(min_value, int) or not isinstance(max_value, int):
        raise TypeError(f"{name} bounds must be integers")
    if min_value < lower or max_value > upper:
        raise ValueError(f"{name} bounds must be between {lower} and {upper}")
    if min_value > max_value:
        raise ValueError(f"{name} min must be less than or equal to max")


def _validate_card(card: str) -> None:
    if not isinstance(card, str) or not CARD_RE.match(card):
        raise ValueError("card must use bridge notation such as 'SA' or 'H2'")
