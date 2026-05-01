from conditional_probability import (
    generate_shape_matrices,
    suit_combinations,
    calculate_conditional_probability,
)

constraints = {
    "north": {
        "knownCards": ["SA"],
        "hcp": {"min": 12, "max": 14},
        "suitRanges": [
            {"min": 5, "max": 5},  # spades
            {"min": 3, "max": 5},
            {"min": 2, "max": 4},
            {"min": 2, "max": 4},
        ],
    }
}

first_matrix = next(generate_shape_matrices(None, constraints))
print(first_matrix)

# 1スート内で、Sを [N,S,E,W] = [4,3,3,3] に配り、
# HCPを [4,3,2,1] にする厳密組み合わせ数
print(suit_combinations("S", [4, 3, 3, 3], [4, 3, 2, 1]))

result = calculate_conditional_probability(
    constraints,
    [
        {
            "name": "North has 12-14 HCP",
            "a": {"hand": "north", "type": "hcp", "value": "12-14"},
        }
    ],
)
print(result)
