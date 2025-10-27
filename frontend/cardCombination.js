///
/// declarer は ns
///
function solveDoubleDummy(
    northHand,
    eastHand,
    southHand,
    westHand,
    startPlayer = "south",
    entries = (Infinity, Infinity)
) {
    return alphaBetaSearch(
        initState(northHand, eastHand, southHand, westHand, startPlayer, entries),
        -Infinity,
        Infinity
    );
}

/**
 *
 * @param {Map<string, string>} state
 * @param {number} alpha
 * @param {number} beta
 * @returns {number}
 */
function alphaBetaSearch(state, alpha, beta) {
    if (isGameOver(state)) {
        console.log(`NS get ${calcTricks(state)} tricks.`);
        return calcTricks(state);
    }
    if (state.playedCards.length % 4 == 0) {
        if (calcTricks(state) + Math.max(state.north.length, state.south.length) < alpha) {
            return alpha;
        }
    }

    currentPlayer = state.currentPlayer;
    isDeclarer = currentPlayer == "north" || currentPlayer == "south";

    if (isDeclarer) {
        bestValue = -Infinity;

        legal_moves = getLegalMoves(state);

        for (move of legal_moves) {
            newState = applyMove(state, move);
            value = alphaBetaSearch(newState, alpha, beta);
            bestValue = Math.max(bestValue, value);

            alpha = Math.max(alpha, bestValue);

            if (alpha >= beta) {
                break;
            }
        }

        console.log(state, bestValue);
        return bestValue;
    } else if (state.currentPlayer != "defense") {
        bestValue = Infinity;

        legal_moves = getLegalMoves(state);

        for (const move of legal_moves) {
            newState = applyMove(state, move);

            value = alphaBetaSearch(newState, alpha, beta);
            bestValue = Math.min(bestValue, value);
            beta = Math.min(beta, bestValue);

            if (alpha >= beta) {
                break;
            }
        }
        console.log(state, bestValue);
        return bestValue;
    } else {
        bestValue = -Infinity;

        for (const player of ["north", "south"]) {
            if (state[player + "Entry"] <= 0) {
                break;
            }
            state[player + "Entry"] -= 1;
            newState = copyState(state);
            newState.currentPlayer = player;
            const value = alphaBetaSearch(newState, alpha, beta);
            bestValue = Math.max(bestValue, value);
        }

        console.log(state, bestValue);
        return bestValue;
    }
}
function initState(northHand, eastHand, southHand, westHand, startPlayer, entries) {
    return {
        north: northHand,
        south: southHand,
        east: eastHand,
        west: westHand,
        northEntry: entries[0],
        southEntry: entries[1],
        currentPlayer: startPlayer,
        playedCards: [],
    };
}
function copyState(state) {
    console.log(state);

    return {
        north: [...state.north],
        south: [...state.south],
        east: [...state.east],
        west: [...state.west],
        northEntry: state.northEntry,
        southEntry: state.southEntry,
        currentPlayer: state.currentPlayer,
        playedCards: [...state.playedCards],
    };
}
function isGameOver(state) {
    return state.playedCards.length % 4 == 0 && state.north.length == 0 && state.south.length == 0;
}
function calcTricks(state) {
    let trick = 0;
    for (let i = 0; i < state.playedCards.length; i += 4) {
        const currentTrickCards = state.playedCards.slice(i, i + 4);
        const wonPlayer = getWonPlayer(currentTrickCards);
        if (wonPlayer == "north" || wonPlayer == "south") {
            trick++;
        }
    }
    return trick;
}
function getLegalMoves(state) {
    currentHand = state[state.currentPlayer];

    if (currentHand.length == 0) {
        return [-1];
    }

    const legalMoves = [];
    for (const card of currentHand) {
        if (!currentHand.includes(card + 1)) {
            legalMoves.push(card);
        }
    }
    return legalMoves;
}
function applyMove(state, move) {
    const playerToNum = { north: 0, east: 1, south: 2, west: 3 };
    const numToPlayer = (num) => {
        const dict = { 0: "north", 1: "east", 2: "south", 3: "west" };
        return dict[num % 4];
    };

    newState = copyState(state);
    newState[newState.currentPlayer] = state[newState.currentPlayer].filter(
        (card) => card != move
    );
    newState.playedCards.push([state.currentPlayer, move]);

    if (newState.playedCards.length % 4 == 0) {
        const currentTrickCards = newState.playedCards.slice(-4);
        const wonPlayer = getWonPlayer(currentTrickCards);

        if (wonPlayer == "north" || wonPlayer == "south") {
            newState.currentPlayer = wonPlayer;
        } else {
            newState.currentPlayer = "defense";
        }
    } else {
        newState.currentPlayer = numToPlayer(playerToNum[state.currentPlayer] + 1);
    }

    return newState;
}
function getWonPlayer(currentTrickCards) {
    const cards = currentTrickCards.map((v) => v[1]);
    const maxCard = Math.max(...cards);
    return currentTrickCards[cards.indexOf(maxCard)][0];
}
