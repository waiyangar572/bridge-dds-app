import unittest

try:
    from .event_inference import (
        apply_event,
        calculate_conditional_prob,
        event_level,
        sort_events_by_level,
    )
    from .event_probability import EvaluationState, calc_suit_length_prob
    from .events import AndEvent, CardHoldingEvent, HcpEvent, OrEvent, ShapePatternEvent, SuitLengthEvent
except ImportError:
    from event_inference import (
        apply_event,
        calculate_conditional_prob,
        event_level,
        sort_events_by_level,
    )
    from event_probability import EvaluationState, calc_suit_length_prob
    from events import AndEvent, CardHoldingEvent, HcpEvent, OrEvent, ShapePatternEvent, SuitLengthEvent


class EventInferenceTest(unittest.TestCase):
    def test_event_level_and_sorting(self) -> None:
        card = CardHoldingEvent("N", "SA")
        suit = SuitLengthEvent("N", "S", 5, 13)
        hcp = HcpEvent("N", 15, 17)

        self.assertEqual(event_level(card), 1)
        self.assertEqual(event_level(suit), 2)
        self.assertEqual(event_level(hcp), 3)
        self.assertEqual(event_level(AndEvent.of(hcp, card, suit)), 3)
        self.assertEqual(event_level(OrEvent.of(card, suit)), 2)
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

    def test_shape_pattern_and_hcp_does_not_materialize_ambiguous_shape(self) -> None:
        target = ShapePatternEvent("N", (4, 4, 3, 2)) & HcpEvent("N", 10, 12)

        prob = calculate_conditional_prob(target, None, EvaluationState())

        self.assertGreaterEqual(prob, 0.0)
        self.assertLessEqual(prob, 1.0)

    def test_hcp_under_shape_pattern_constraint_uses_ratio(self) -> None:
        target = HcpEvent("N", 10, 12)
        constraint = ShapePatternEvent("N", (4, 4, 3, 2))

        prob = calculate_conditional_prob(target, constraint, EvaluationState())

        self.assertGreaterEqual(prob, 0.0)
        self.assertLessEqual(prob, 1.0)

    def test_shape_and_hcp_is_not_computed_as_independent_product(self) -> None:
        shape = ShapePatternEvent("N", (4, 4, 3, 2))
        hcp = HcpEvent("N", 10, 12)
        state = EvaluationState()

        joint = calculate_conditional_prob(shape & hcp, None, state)
        independent_product = (
            calculate_conditional_prob(shape, None, state)
            * calculate_conditional_prob(hcp, None, state)
        )

        self.assertNotAlmostEqual(joint, independent_product)

    def test_or_event_uses_inclusion_exclusion(self) -> None:
        north_sa = CardHoldingEvent("N", "SA")
        north_sk = CardHoldingEvent("N", "SK")
        state = EvaluationState()

        prob = calculate_conditional_prob(OrEvent.of(north_sa, north_sk), None, state)

        expected = (13 / 52) + (13 / 52) - ((13 / 52) * (12 / 51))
        self.assertAlmostEqual(prob, expected)

    def test_hcp_under_suit_length_range_expands_to_exact_lengths(self) -> None:
        state = EvaluationState()
        target = HcpEvent("N", 10, 12)
        constraint = SuitLengthEvent("N", "S", 5, 6)

        prob = calculate_conditional_prob(target, constraint, state)

        denominator = calculate_conditional_prob(constraint, None, state)
        numerator = sum(
            calculate_conditional_prob(
                HcpEvent("N", 10, 12) & SuitLengthEvent("N", "S", length, length),
                None,
                state,
            )
            for length in (5, 6)
        )
        self.assertAlmostEqual(prob, numerator / denominator)


if __name__ == "__main__":
    unittest.main()
