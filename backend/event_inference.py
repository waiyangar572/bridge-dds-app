from __future__ import annotations

from dataclasses import replace
from itertools import permutations

try:
    from .event_probability import (
        EvaluationState,
        calc_card_holding_prob,
        calc_hcp_prob,
        calc_shape_pattern_prob,
        calc_suit_length_prob,
    )
    from .events import (
        AndEvent,
        BaseEvent,
        CardHoldingEvent,
        HcpEvent,
        NotEvent,
        ShapePatternEvent,
        SuitLengthEvent,
    )
except ImportError:
    from event_probability import (
        EvaluationState,
        calc_card_holding_prob,
        calc_hcp_prob,
        calc_shape_pattern_prob,
        calc_suit_length_prob,
    )
    from events import (
        AndEvent,
        BaseEvent,
        CardHoldingEvent,
        HcpEvent,
        NotEvent,
        ShapePatternEvent,
        SuitLengthEvent,
    )


__all__ = [
    "apply_event",
    "calculate_conditional_prob",
    "event_level",
    "sort_events_by_level",
]


def event_level(event: BaseEvent | None) -> int:
    """Return the evaluation level: Card=1, SuitLength=2, HCP=3."""

    if event is None:
        return 0
    if isinstance(event, CardHoldingEvent):
        return 1
    if isinstance(event, SuitLengthEvent):
        return 2
    if isinstance(event, ShapePatternEvent):
        return 2
    if isinstance(event, HcpEvent):
        return 3
    if isinstance(event, AndEvent):
        return max(event_level(child) for child in event.children)
    if isinstance(event, NotEvent):
        return event_level(event.child)
    raise TypeError(f"unknown event type: {event!r}")


def sort_events_by_level(events: tuple[BaseEvent, ...] | list[BaseEvent]) -> list[BaseEvent]:
    """Sort events so lower-level constraints are established first."""

    return sorted(events, key=event_level)


def calculate_conditional_prob(
    target: BaseEvent,
    constraint: BaseEvent | None = None,
    state: EvaluationState | None = None,
) -> float:
    """Calculate P(target | constraint) with chain rule and Bayes' theorem."""

    current_state = state if state is not None else EvaluationState()

    if _contains_shape_pattern(constraint):
        # Law of conditional probability for an ambiguous shape constraint:
        # P(B | A) = P(B & A) / P(A)
        denominator = calculate_conditional_prob(constraint, None, current_state)
        if denominator == 0:
            raise ZeroDivisionError("constraint has probability 0; conditional probability is undefined")
        numerator = calculate_conditional_prob(AndEvent.of(target, constraint), None, current_state)
        return numerator / denominator

    if isinstance(target, NotEvent):
        # Complement rule:
        # P(~B | A) = 1 - P(B | A)
        return 1.0 - calculate_conditional_prob(target.child, constraint, current_state)

    if isinstance(target, AndEvent):
        return _calculate_and_target_prob(target, constraint, current_state)

    if _is_atomic(target):
        target_lvl = event_level(target)
        constraint_lvl = event_level(constraint)

        if constraint_lvl <= target_lvl:
            # Base case:
            # Once all constraints are at this event's level or lower, materialize
            # them into EvaluationState and call the phase-2 combinatorial kernel.
            constrained_state = apply_event(current_state, constraint)
            return _calculate_atomic_prob(target, constrained_state)

        # Bayes' theorem for order inversion:
        # P(B | A) = P(A | B) * P(B) / P(A)
        numerator_left = calculate_conditional_prob(constraint, target, current_state)
        numerator_right = calculate_conditional_prob(target, None, current_state)
        denominator = calculate_conditional_prob(constraint, None, current_state)
        if denominator == 0:
            raise ZeroDivisionError("constraint has probability 0; conditional probability is undefined")
        return numerator_left * numerator_right / denominator

    raise TypeError(f"unsupported target event: {target!r}")


def apply_event(state: EvaluationState, event: BaseEvent | None) -> EvaluationState:
    """Return a new state with an already-occurred event reflected."""

    next_state = _clone_state(state)
    if event is None:
        return next_state

    if isinstance(event, AndEvent):
        for child in sort_events_by_level(list(event.children)):
            next_state = apply_event(next_state, child)
        return next_state

    if isinstance(event, CardHoldingEvent):
        next_state.assign_card(event)
        return next_state

    if isinstance(event, SuitLengthEvent):
        if event.min_length != event.max_length:
            raise ValueError(
                "only exact SuitLengthEvent constraints can be materialized into EvaluationState"
            )
        next_state.set_suit_length(event)
        return next_state

    if isinstance(event, ShapePatternEvent):
        raise NotImplementedError("ambiguous shape patterns cannot be materialized into EvaluationState")

    if isinstance(event, HcpEvent):
        # HCP constraints are level-3 facts. The phase-2 EvaluationState does not
        # yet store HCP intervals; calc_hcp_prob is currently a placeholder.
        return next_state

    if isinstance(event, NotEvent):
        raise NotImplementedError("negated constraints cannot be materialized into EvaluationState yet")

    raise TypeError(f"unsupported event: {event!r}")


def _calculate_and_target_prob(
    target: AndEvent,
    constraint: BaseEvent | None,
    state: EvaluationState,
) -> float:
    ordered_children = sort_events_by_level(list(target.children))
    first = ordered_children[0]
    rest = ordered_children[1:]

    if isinstance(first, ShapePatternEvent):
        # Ambiguous shape expansion:
        # P((E1 or E2 or ... or En) & R | A)
        #   = sum_i P(Ei & R | A)
        # The exact suit assignments Ei are mutually exclusive.
        total = 0.0
        for exact_shape in _shape_pattern_exact_events(first):
            expanded_children = [exact_shape, *rest]
            expanded_target = (
                expanded_children[0]
                if len(expanded_children) == 1
                else AndEvent.of(*expanded_children)
            )
            total += calculate_conditional_prob(expanded_target, constraint, state)
        return total

    # Chain rule:
    # P(b1 & b2 & ... & bn | A)
    #   = P(b1 | A) * P(b2 & ... & bn | A & b1)
    first_prob = calculate_conditional_prob(first, constraint, state)
    if first_prob == 0:
        return 0.0

    next_state = apply_event(state, first)
    if not rest:
        return first_prob

    remaining_target = rest[0] if len(rest) == 1 else AndEvent.of(*rest)
    remaining_prob = calculate_conditional_prob(remaining_target, constraint, next_state)
    return first_prob * remaining_prob


def _calculate_atomic_prob(target: BaseEvent, state: EvaluationState) -> float:
    if isinstance(target, CardHoldingEvent):
        return calc_card_holding_prob(target, state)
    if isinstance(target, SuitLengthEvent):
        return calc_suit_length_prob(target, state)
    if isinstance(target, ShapePatternEvent):
        return calc_shape_pattern_prob(target, state)
    if isinstance(target, HcpEvent):
        return calc_hcp_prob(target, state)
    raise TypeError(f"expected an atomic event: {target!r}")


def _clone_state(state: EvaluationState) -> EvaluationState:
    return replace(
        state,
        vacant_spaces=dict(state.vacant_spaces),
        known_cards={player: list(cards) for player, cards in state.known_cards.items()},
        known_suit_lengths={
            player: dict(lengths) for player, lengths in state.known_suit_lengths.items()
        },
    )


def _is_atomic(event: BaseEvent) -> bool:
    return isinstance(event, (CardHoldingEvent, SuitLengthEvent, ShapePatternEvent, HcpEvent))


def _contains_shape_pattern(event: BaseEvent | None) -> bool:
    if event is None:
        return False
    if isinstance(event, ShapePatternEvent):
        return True
    if isinstance(event, AndEvent):
        return any(_contains_shape_pattern(child) for child in event.children)
    if isinstance(event, NotEvent):
        return _contains_shape_pattern(event.child)
    return False


def _shape_pattern_exact_events(event: ShapePatternEvent) -> list[AndEvent]:
    exact_events = []
    for lengths in sorted(set(permutations(event.lengths))):
        exact_events.append(
            AndEvent.of(
                SuitLengthEvent(event.player, "S", lengths[0], lengths[0]),
                SuitLengthEvent(event.player, "H", lengths[1], lengths[1]),
                SuitLengthEvent(event.player, "D", lengths[2], lengths[2]),
                SuitLengthEvent(event.player, "C", lengths[3], lengths[3]),
            )
        )
    return exact_events
