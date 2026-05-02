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

    def test_shape_pattern_and_hcp_query_does_not_raise(self) -> None:
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
                "name": "North 4-4-3-2 and 10-12",
                "join": "and",
                "a": {"hand": "north", "type": "shape", "value": "4-4-3-2"},
                "b": {"hand": "north", "type": "hcp", "value": "10-12"},
            }
        ]

        response = calculate_conditional_probability(payload_constraints, payload_queries)

        self.assertGreaterEqual(response["results"][0]["probability"], 0.0)
        self.assertLessEqual(response["results"][0]["probability"], 1.0)

    def test_shape_pattern_and_hcp_query_is_not_independent_product(self) -> None:
        payload_constraints = {
            hand: {
                "mode": "feature",
                "knownCards": [],
                "hcp": {"min": 0, "max": 37},
                "suitRanges": [{"min": 0, "max": 13} for _ in range(4)],
            }
            for hand in ("north", "east", "south", "west")
        }
        shape_query = {
            "name": "North 4-4-3-2",
            "join": "single",
            "a": {"hand": "north", "type": "shape", "value": "4-4-3-2"},
            "b": {"hand": "", "type": "", "value": ""},
        }
        hcp_query = {
            "name": "North 10-12",
            "join": "single",
            "a": {"hand": "north", "type": "hcp", "value": "10-12"},
            "b": {"hand": "", "type": "", "value": ""},
        }
        joint_query = {
            "name": "North 4-4-3-2 and 10-12",
            "join": "and",
            "a": {"hand": "north", "type": "shape", "value": "4-4-3-2"},
            "b": {"hand": "north", "type": "hcp", "value": "10-12"},
        }

        response = calculate_conditional_probability(
            payload_constraints,
            [shape_query, hcp_query, joint_query],
        )

        shape_prob = response["results"][0]["probability"]
        hcp_prob = response["results"][1]["probability"]
        joint_prob = response["results"][2]["probability"]
        self.assertNotAlmostEqual(joint_prob, shape_prob * hcp_prob)

    def test_nested_compound_query_supports_more_than_two_conditions(self) -> None:
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
                "name": "Complex nested",
                "event": {
                    "op": "and",
                    "conditions": [
                        {"hand": "north", "type": "shape", "value": "4-4-3-2"},
                        {
                            "op": "or",
                            "conditions": [
                                {"hand": "north", "type": "hcp", "value": "10-12"},
                                {"hand": "north", "type": "card", "value": "SA"},
                                {"hand": "north", "type": "card", "value": "SK"},
                            ],
                        },
                    ],
                },
            }
        ]

        response = calculate_conditional_probability(payload_constraints, payload_queries)

        self.assertGreaterEqual(response["results"][0]["probability"], 0.0)
        self.assertLessEqual(response["results"][0]["probability"], 1.0)


if __name__ == "__main__":
    unittest.main()
