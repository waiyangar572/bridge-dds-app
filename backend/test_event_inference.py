import unittest

try:
    from .event_inference import (
        apply_event,
        calculate_conditional_prob,
        event_level,
        sort_events_by_level,
    )
    from .event_probability import EvaluationState, calc_suit_length_prob
    from .events import AndEvent, CardHoldingEvent, HcpEvent, SuitLengthEvent
except ImportError:
    from event_inference import (
        apply_event,
        calculate_conditional_prob,
        event_level,
        sort_events_by_level,
    )
    from event_probability import EvaluationState, calc_suit_length_prob
    from events import AndEvent, CardHoldingEvent, HcpEvent, SuitLengthEvent


class EventInferenceTest(unittest.TestCase):
    def test_event_level_and_sorting(self) -> None:
        card = CardHoldingEvent("N", "SA")
        suit = SuitLengthEvent("N", "S", 5, 13)
        hcp = HcpEvent("N", 15, 17)

        self.assertEqual(event_level(card), 1)
        self.assertEqual(event_level(suit), 2)
        self.assertEqual(event_level(hcp), 3)
        self.assertEqual(event_level(AndEvent.of(hcp, card, suit)), 3)
        self.assertEqual(sort_events_by_level([hcp, suit, card]), [card, suit, hcp])

    def test_apply_event_returns_new_state(self) -> None:
        state = EvaluationState()

        next_state = apply_event(state, CardHoldingEvent("N", "SA"))

        self.assertEqual(state.vacant_spaces["N"], 13)
        self.assertEqual(next_state.vacant_spaces["N"], 12)
        self.assertEqual(next_state.card_owner("SA"), "N")

    def test_chain_rule_for_and_target(self) -> None:
        target = CardHoldingEvent("N", "SA") & CardHoldingEvent("S", "HK")

        prob = calculate_conditional_prob(target, None, EvaluationState())

        self.assertAlmostEqual(prob, (13 / 52) * (13 / 51))

    def test_bayes_reroutes_card_target_under_suit_constraint(self) -> None:
        target = CardHoldingEvent("N", "SA")
        constraint = SuitLengthEvent("N", "S", 5, 13)
        initial_state = EvaluationState()

        prob = calculate_conditional_prob(target, constraint, initial_state)

        state_after_target = apply_event(initial_state, target)
        prob_constraint_given_target = calc_suit_length_prob(constraint, state_after_target)
        prob_target = calculate_conditional_prob(target, None, initial_state)
        prob_constraint = calculate_conditional_prob(constraint, None, initial_state)
        expected = prob_constraint_given_target * prob_target / prob_constraint

        self.assertAlmostEqual(prob, expected)


if __name__ == "__main__":
    unittest.main()
