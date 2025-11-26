transposition_table = {};

///
/// declarer は ns
///
function solveDoubleDummy(
    northHand,
    eastHand,
    southHand,
    westHand,
    startPlayer = "south",
    entries = [Infinity, Infinity]
) {
    // return alphaBetaSearch(
    //     initState(northHand, eastHand, southHand, westHand, startPlayer, entries),
    //     -Infinity,
    //     Infinity
    // );

    currentStates = [initState(northHand, eastHand, southHand, westHand, startPlayer, entries)];
    transposition_table = {};
    newStates = [];

    while (!currentStates.every((state) => isGameOver(state))) {
        console.log(`----------------------------  ${currentStates.length} --------`);
        for (const currentState of currentStates) {
            while (!isGameOver(currentState)) {
                player = currentState.currentPlayer;
                isDeclarer = player == "north" || player == "south";

                legalMoves = getLegalMoves(currentState);

                console.log(`${player}の手番`);

                alpha = -Infinity;
                beta = Infinity;

                branch_results = [];
                for (const move of legalMoves) {
                    newState = applyMove(currentState, move);
                    [value, _] = alphaBetaSearch(currentState, alpha, beta);
                    branch_results.push([value, move]);

                    if (isDeclarer) {
                        alpha = Math.max(alpha, value);
                    } else {
                        beta = Math.min(beta, value);
                    }

                    if (alpha > beta) {
                        break;
                    }
                }

                let bestValue;
                const valueArray = branch_results.map((v) => v[0]);
                if (isDeclarer) {
                    bestValue = Math.max(...valueArray);
                } else {
                    bestValue = Math.min(...valueArray);
                }
                const bestMoves = branch_results.filter((v) => v[0] == bestValue);

                console.log(`bestMove is ${bestMoves}`);
                for (bestMove of bestMoves) {
                    newStates.push(applyMove(currentState, bestMove));
                    if (currentState.playedCards.length % 4 == 3) {
                        console.log(`${newStates[-1].currentPlayer} gets a trick.`);
                    }
                }
            }
        }
        currentStates = newStates;
    }

    console.log();
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
        return [calcTricks(state), []];
    }
    if (state.playedCards.length % 4 == 0) {
        if (calcTricks(state) + Math.max(state.north.length, state.south.length) < alpha) {
            return [alpha, []];
        }
    }

    state_hash = JSON.stringify([state, alpha, beta]);
    if (state_hash in transposition_table) {
        return transposition_table[state_hash];
    }

    currentPlayer = state.currentPlayer;
    isDeclarer = currentPlayer == "north" || currentPlayer == "south";

    if (!state.isLeader) {
        if (isDeclarer) {
            bestValue = -Infinity;
            bestMove = [];

            legal_moves = getLegalMoves(state);

            for (move of legal_moves) {
                newState = applyMove(state, move);
                [value, followingBestMoves] = alphaBetaSearch(newState, alpha, beta);
                if (bestValue < value) {
                    bestValue = value;
                    bestMove = [move];
                } else if (bestValue == value) {
                    bestMove.push(move);
                }

                alpha = Math.max(alpha, bestValue);

                if (alpha >= beta) {
                    break;
                }
            }

            console.log(state, Math.max(bestValue, calcTricks(state)), bestMoves);
            transposition_table[state_hash] = [Math.max(bestValue, calcTricks(state)), bestMoves];
            return [Math.max(bestValue, calcTricks(state)), bestMoves];
        } else {
            bestValue = Infinity;
            bestMoves = [];

            legal_moves = getLegalMoves(state);

            for (const move of legal_moves) {
                newState = applyMove(state, move);

                [value, followingBestMoves] = alphaBetaSearch(newState, alpha, beta);
                if (bestValue > value) {
                    bestValue = value;
                    bestMove = [move];
                } else if (bestMove == value) {
                    bestMove.push(move);
                }
                beta = Math.min(beta, bestValue);

                if (alpha >= beta) {
                    break;
                }
            }
            console.log(
                state,
                Math.min(
                    bestValue,
                    calcTricks(state) + Math.max(state.north.length, state.south.length)
                ),
                bestMoves
            );
            transposition_table[state_hash] = [
                Math.min(
                    bestValue,
                    calcTricks(state) + Math.max(state.north.length, state.south.length)
                ),
                bestMoves,
            ];
            return transposition_table[state_hash];
        }
    } else {
        bestValue = -Infinity;
        bestMoves = [];

        for (const player of ["north", "south"]) {
            if (state.currentPlayer != player) {
                if (state[player + "Entry"] <= 0) {
                    continue;
                }
                state[player + "Entry"] -= 1;
            }
            if (state[player].length == 0) {
                continue;
            }
            newState = copyState(state);
            newState.isLeader = false;
            newState.currentPlayer = player;
            const [value, followingBestMoves] = alphaBetaSearch(newState, alpha, beta);
            if (bestValue < value) {
                bestValue = value;
                bestMoves = [...followingBestMoves];
            }
        }

        console.log(state, Math.max(bestValue, calcTricks(state)), bestMoves);
        transposition_table[state_hash] = [Math.max(bestValue, calcTricks(state)), bestMoves];
        return [Math.max(bestValue, calcTricks(state)), bestMoves];
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
        isLeader: true,
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
        isLeader: state.isLeader,
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

        newState.currentPlayer = wonPlayer;
        newState.isLeader = true;
    } else {
        newState.currentPlayer = numToPlayer(playerToNum[state.currentPlayer] + 1);
        newState.isLeader = false;
    }

    return newState;
}
function getWonPlayer(currentTrickCards) {
    const cards = currentTrickCards.map((v) => v[1]);
    const maxCard = Math.max(...cards);
    return currentTrickCards[cards.indexOf(maxCard)][0];
}

function solveSingleDummy(
    northHand,
    southHand,
    startPlayer = "south",
    entries = (Infinity, Infinity)
) {}

function calcProbability(numFit, numEast, numEastKnown = 0, numWestKnown = 0) {
    const numEW = 13 - numFit;
    const numWest = numEW - numEast;
    const numUnknown = 26 - numEastKnown - numWestKnown;
    if (numEast + numEastKnown > 13 || numWest + numWestKnown > 13 || numUnknown < numEW) {
        return 0;
    }
    return (
        binomial(numUnknown - numEW, 13 - numEast - numEastKnown) /
        binomial(numUnknown, 13 - numEastKnown)
    );
}
function calcAllProbability(numFit, numEastKnown = 0, numWestKnown = 0) {
    const numEW = 13 - numFit;
    const numUnknown = 26 - numEastKnown - numWestKnown;

    probabilities = new Array(numEW + 1);
    for (let e = 0; e <= numEW; e++) {
        const w = numEW - e;
        if (e + numEastKnown > 13 || w + numWestKnown > 13) {
            probabilities[e] = 0;
        }
        probabilities[e] =
            (binomial(numEW, e) * binomial(numUnknown - numEW, 13 - e - numEastKnown)) /
            binomial(numUnknown, 13 - numEastKnown);
    }

    return probabilities;
}
function factorial(num) {
    var counter = 1;
    for (var i = 2; i <= num; i++) counter = counter * i;
    return counter;
}
function binomial(n, k) {
    if (k > n) {
        return 0;
    }
    if (2 * k > n) {
        k = n - k;
    }
    let denominator = 1;
    let numerator = 1;
    for (let i = 1; i <= k; i++) {
        denominator *= i;
        numerator *= n - i + 1;
    }
    return numerator / denominator;
}
