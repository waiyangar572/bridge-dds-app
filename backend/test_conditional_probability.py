import unittest
from math import comb

try:
    from .conditional_probability import calculate_conditional_probability
except ImportError:
    from conditional_probability import calculate_conditional_probability


class ConditionalProbabilityApiAdapterTest(unittest.TestCase):
    def test_default_hcp_query_payload_returns_result(self) -> None:
        payload_constraints = {
            hand: {
                "mode": "feature",
                "knownCards": [],
                "hcp": {"min": 0, "max": 37},
                "suitRanges": [{"min": 0, "max": 13} for _ in range(4)],
            }
            for hand in ("north", "east", "south", "west")
        }
        payload_queries = [
            {
                "name": "North 10-12 HCP",
                "join": "single",
                "a": {"hand": "north", "type": "hcp", "value": "10-12"},
                "b": {"hand": "", "type": "", "value": ""},
            }
        ]

        response = calculate_conditional_probability(payload_constraints, payload_queries)

        self.assertEqual(response["engine"], "event-inference")
        self.assertEqual(len(response["results"]), 1)
        self.assertGreater(response["results"][0]["probability"], 0.0)
        self.assertLess(response["results"][0]["probability"], 1.0)

    def test_card_query_with_known_card_constraint(self) -> None:
        payload_constraints = {
            hand: {
                "mode": "feature",
                "knownCards": ["SA"] if hand == "north" else [],
                "hcp": {"min": 0, "max": 37},
                "suitRanges": [{"min": 0, "max": 13} for _ in range(4)],
            }
            for hand in ("north", "east", "south", "west")
        }
        payload_queries = [
            {
                "name": "North has SA",
                "join": "single",
                "a": {"hand": "north", "type": "card", "value": "SA"},
                "b": {"hand": "", "type": "", "value": ""},
            }
        ]

        response = calculate_conditional_probability(payload_constraints, payload_queries)

        self.assertEqual(response["results"][0]["probability"], 1.0)

    def test_shape_pattern_query_treats_4432_as_unordered_shape(self) -> None:
        payload_constraints = {
            hand: {
                "mode": "feature",
                "knownCards": [],
                "hcp": {"min": 0, "max": 37},
                "suitRanges": [{"min": 0, "max": 13} for _ in range(4)],
            }
            for hand in ("north", "east", "south", "west")
        }
        payload_queries = [
            {
                "name": "North 4-4-3-2",
                "join": "single",
                "a": {"hand": "north", "type": "shape", "value": "4-4-3-2"},
                "b": {"hand": "", "type": "", "value": ""},
            }
        ]

        response = calculate_conditional_probability(payload_constraints, payload_queries)

        fixed = comb(13, 4) * comb(13, 4) * comb(13, 3) * comb(13, 2) / comb(52, 13)
        self.assertAlmostEqual(response["results"][0]["probability"], 12 * fixed)


if __name__ == "__main__":
    unittest.main()
