import unittest
from math import comb

try:
    from .event_probability import (
        EvaluationState,
        calc_card_holding_prob,
        calc_suit_length_prob,
    )
    from .events import CardHoldingEvent, SuitLengthEvent
except ImportError:
    from event_probability import (
        EvaluationState,
        calc_card_holding_prob,
        calc_suit_length_prob,
    )
    from events import CardHoldingEvent, SuitLengthEvent


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


if __name__ == "__main__":
    unittest.main()
