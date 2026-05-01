from __future__ import annotations

from fractions import Fraction

from exact_probability_engine import (
    AndEvent,
    CardInHand,
    HandCondition,
    HcpRange,
    OrEvent,
    ProbabilityEngine,
    SuitCountRange,
    example_compare_ew_spade_splits,
    spade_split_event,
)


def assert_fraction_close(value: Fraction, expected: Fraction) -> None:
    assert value == expected, f"expected {expected}, got {value}"


def test_single_honor_symmetry() -> None:
    assert_fraction_close(
        ProbabilityEngine().calculate_probability(CardInHand("SA", "north")),
        Fraction(1, 4),
    )


def test_single_spot_symmetry() -> None:
    assert_fraction_close(
        ProbabilityEngine().calculate_probability(CardInHand("S2", "north")),
        Fraction(1, 4),
    )


def test_conditioned_honor_query_with_hcp_range() -> None:
    engine = ProbabilityEngine(
        {
            "north": HandCondition.feature(
                required_cards=("SA",),
                hcp_min=15,
                hcp_max=17,
            )
        }
    )
    assert_fraction_close(
        engine.calculate_probability(CardInHand("SK", "north")),
        Fraction(53426508, 160825759),
    )


def test_and_event_specific_honors_and_hcp() -> None:
    event = AndEvent(
        (
            CardInHand("SA", "north"),
            CardInHand("HK", "north"),
            HcpRange("north", 15, 17),
        )
    )
    probability = ProbabilityEngine().calculate_probability(event)
    assert probability > 0
    assert probability < Fraction(1, 1)


def test_or_event_disjoint_cards() -> None:
    event = OrEvent((CardInHand("SA", "north"), CardInHand("SA", "east")))
    assert_fraction_close(ProbabilityEngine().calculate_probability(event), Fraction(1, 2))


def test_full_hand_implies_shape_and_hcp() -> None:
    north_hand = (
        "SA",
        "SK",
        "SQ",
        "SJ",
        "ST",
        "S9",
        "S8",
        "H2",
        "H3",
        "D2",
        "D3",
        "C2",
        "C3",
    )
    engine = ProbabilityEngine({"north": HandCondition.hand(north_hand)})
    assert_fraction_close(engine.calculate_probability(SuitCountRange("north", "S", 7, 7)), Fraction(1, 1))
    assert_fraction_close(engine.calculate_probability(HcpRange("north", 10, 10)), Fraction(1, 1))


def test_complex_spade_split_comparison_runs() -> None:
    result = example_compare_ew_spade_splits()
    assert result["E/W spades 3-3"] > 0
    assert result["E/W spades 4-2"] > result["E/W spades 3-3"]


def test_shape_and_hcp_intersection_runs() -> None:
    engine = ProbabilityEngine(
        {
            "north": HandCondition.feature(
                required_cards=("SA",),
                hcp_min=15,
                hcp_max=17,
            ),
            "east": HandCondition.feature(
                shape_min=(2, 0, 0, 0),
                shape_max=(4, 13, 13, 13),
            ),
            "west": HandCondition.feature(
                shape_min=(2, 0, 0, 0),
                shape_max=(4, 13, 13, 13),
            ),
        }
    )
    probability = engine.calculate_probability(
        AndEvent(
            (
                CardInHand("SK", "north"),
                SuitCountRange("east", "S", 3, 3),
                SuitCountRange("west", "S", 2, 4),
            )
        )
    )
    assert probability > 0
    assert probability < Fraction(1, 1)


if __name__ == "__main__":
    test_single_honor_symmetry()
    test_single_spot_symmetry()
    test_conditioned_honor_query_with_hcp_range()
    test_and_event_specific_honors_and_hcp()
    test_or_event_disjoint_cards()
    test_full_hand_implies_shape_and_hcp()
    test_complex_spade_split_comparison_runs()
    test_shape_and_hcp_intersection_runs()
    print("exact probability engine tests passed")
