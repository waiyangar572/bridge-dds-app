import unittest
from math import comb, factorial

try:
    from .event_probability import (
        EvaluationState,
        calc_card_holding_prob,
        calc_hcp_prob,
        calc_shape_pattern_prob,
        calc_suit_length_prob,
        evaluate_single_suit,
    )
    from .events import CardHoldingEvent, HcpEvent, ShapePatternEvent, SuitLengthEvent
except ImportError:
    from event_probability import (
        EvaluationState,
        calc_card_holding_prob,
        calc_hcp_prob,
        calc_shape_pattern_prob,
        calc_suit_length_prob,
        evaluate_single_suit,
    )
    from events import CardHoldingEvent, HcpEvent, ShapePatternEvent, SuitLengthEvent


class EventProbabilityTest(unittest.TestCase):
    def test_north_spade_ace_from_initial_state(self) -> None:
        state = EvaluationState()

        prob = calc_card_holding_prob(CardHoldingEvent("N", "SA"), state)

        self.assertAlmostEqual(prob, 13 / 52)

    def test_south_heart_king_after_north_has_spade_ace(self) -> None:
        state = EvaluationState()
        state.assign_card(CardHoldingEvent("N", "SA"))

        prob = calc_card_holding_prob(CardHoldingEvent("S", "HK"), state)

        self.assertEqual(state.remaining_card_count, 51)
        self.assertEqual(state.remaining_suit_count("S"), 12)
        self.assertEqual(state.vacant_spaces["N"], 12)
        self.assertAlmostEqual(prob, 13 / 51)

    def test_north_exactly_five_spades_after_spade_ace_and_king(self) -> None:
        state = EvaluationState()
        state.assign_card(CardHoldingEvent("N", "SA"))
        state.assign_card(CardHoldingEvent("N", "SK"))

        prob = calc_suit_length_prob(SuitLengthEvent("N", "S", 5, 5), state)

        expected = comb(11, 3) * comb(39, 8) / comb(50, 11)
        self.assertAlmostEqual(prob, expected)

    def test_fixed_suit_shape_uses_conditional_population_correctly(self) -> None:
        state = EvaluationState()
        events = [
            SuitLengthEvent("N", "S", 4, 4),
            SuitLengthEvent("N", "H", 4, 4),
            SuitLengthEvent("N", "D", 3, 3),
            SuitLengthEvent("N", "C", 2, 2),
        ]

        prob = 1.0
        for event in events:
            prob *= calc_suit_length_prob(event, state)
            state.set_suit_length(event)

        expected = comb(13, 4) * comb(13, 4) * comb(13, 3) * comb(13, 2) / comb(52, 13)
        self.assertAlmostEqual(prob, expected)

    def test_shape_pattern_sums_all_suit_permutations(self) -> None:
        prob = calc_shape_pattern_prob(ShapePatternEvent("N", (4, 4, 3, 2)), EvaluationState())

        fixed = comb(13, 4) * comb(13, 4) * comb(13, 3) * comb(13, 2) / comb(52, 13)
        self.assertAlmostEqual(prob, 12 * fixed)

    def test_single_suit_weights_sum_to_multinomial_count(self) -> None:
        state = EvaluationState()
        state.set_suit_length(SuitLengthEvent("N", "S", 4, 4))
        state.set_suit_length(SuitLengthEvent("S", "S", 3, 3))
        state.set_suit_length(SuitLengthEvent("E", "S", 3, 3))
        state.set_suit_length(SuitLengthEvent("W", "S", 3, 3))

        options = evaluate_single_suit("S", state)

        expected = factorial(13) // (factorial(4) * factorial(3) * factorial(3) * factorial(3))
        self.assertEqual(sum(option["weight"] for option in options), expected)

    def test_single_suit_respects_known_honor_cards(self) -> None:
        state = EvaluationState()
        for card in ("SA", "SK", "SQ", "SJ"):
            state.assign_card(CardHoldingEvent("N", card))
        state.set_suit_length(SuitLengthEvent("N", "S", 4, 4))
        state.set_suit_length(SuitLengthEvent("S", "S", 3, 3))
        state.set_suit_length(SuitLengthEvent("E", "S", 3, 3))
        state.set_suit_length(SuitLengthEvent("W", "S", 3, 3))

        options = evaluate_single_suit("S", state)

        self.assertEqual(len(options), 1)
        self.assertEqual(options[0]["hcp_gained"]["N"], 10)
        self.assertEqual(options[0]["weight"], factorial(9) // (factorial(3) ** 3))

    def test_hcp_dp_returns_zero_for_impossible_range_under_known_honors(self) -> None:
        state = _cyclic_complete_shape_state()
        for card in ("SA", "SK", "SQ", "SJ"):
            state.assign_card(CardHoldingEvent("N", card))

        prob = calc_hcp_prob(HcpEvent("N", 0, 9), state)

        self.assertEqual(prob, 0.0)

    def test_hcp_calc_does_not_require_complete_suit_lengths(self) -> None:
        state = EvaluationState()
        state.set_suit_length(SuitLengthEvent("N", "S", 5, 5))

        prob = calc_hcp_prob(HcpEvent("N", 10, 12), state)

        self.assertGreaterEqual(prob, 0.0)
        self.assertLessEqual(prob, 1.0)

def _cyclic_complete_shape_state() -> EvaluationState:
    state = EvaluationState()
    lengths = {
        "N": {"S": 4, "H": 3, "D": 3, "C": 3},
        "S": {"S": 3, "H": 4, "D": 3, "C": 3},
        "E": {"S": 3, "H": 3, "D": 4, "C": 3},
        "W": {"S": 3, "H": 3, "D": 3, "C": 4},
    }
    for player, suit_lengths in lengths.items():
        for suit, length in suit_lengths.items():
            state.set_suit_length(SuitLengthEvent(player, suit, length, length))
    return state


if __name__ == "__main__":
    unittest.main()
