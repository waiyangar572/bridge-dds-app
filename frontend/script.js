document.addEventListener("DOMContentLoaded", () => {
    // --- Constants and State ---
    const HANDS = ["north", "east", "south", "west"];
    const SUITS = { spades: "♠", hearts: "♥", diamonds: "♦", clubs: "♣" };
    const SUIT_COLORS = {
        spades: "suit-spades",
        hearts: "suit-hearts",
        diamonds: "suit-diamonds",
        clubs: "suit-clubs",
    };
    const RANKS = ["A", "K", "Q", "J", "T", "9", "8", "7", "6", "5", "4", "3", "2"];

    let activeMobileHand = null;
    let analysisMode = "double"; // 'double' or 'single'
    let translations = {};

    // --- I18n (Internationalization) ---
    async function setLanguage(lang) {
        try {
            const response = await fetch(`lang/${lang}.json`);
            if (!response.ok) {
                throw new Error("Language file not found");
            }
            translations = await response.json();
            console.log(translations);

            document.documentElement.lang = lang;
            localStorage.setItem("userLanguage", lang);

            // Update all static text
            document.querySelectorAll("[data-i18n]").forEach((el) => {
                const key = el.getAttribute("data-i18n");
                if (translations[key]) {
                    el.textContent = translations[key];
                }
            });

            // Update text in HTML tags
            document.querySelectorAll("[data-i18n-html]").forEach((el) => {
                const key = el.getAttribute("data-i18n-html");
                if (translations[key]) {
                    el.innerHTML = translations[key];
                }
            });

            // Update attributes like meta description
            document.querySelectorAll("[data-i18n-attr]").forEach((el) => {
                const attrs = el.getAttribute("data-i18n-attr").split(";");
                attrs.forEach((attr) => {
                    const [attrName, key] = attr.split(":");
                    if (translations[key.trim()]) {
                        el.setAttribute(attrName.trim(), translations[key.trim()]);
                    }
                });
            });

            // Highlight active language button
            document.querySelectorAll("[data-lang]").forEach((btn) => {
                btn.classList.toggle("active", btn.dataset.lang === lang);
            });
        } catch (error) {
            console.error("Could not set language:", error);
            // Fallback to Japanese if English file fails
            if (lang !== "ja") await setLanguage("ja");
        }
    }

    // --- Element References ---
    const pbnInputDesktop = document.getElementById("pbnInputDesktop");
    const pbnInputMobile = document.getElementById("pbnInputMobile");
    const simulationsInputDesktop = document.getElementById("simulationsInputDesktop");
    const simulationsInputMobile = document.getElementById("simulationsInputMobile");

    const analyzeBtnDesktop = document.getElementById("analyzeBtnDesktop");
    const analyzeBtnMobile = document.getElementById("analyzeBtnMobile");

    const resultsContainer = document.getElementById("resultsContainer");
    const loadingSpinner = document.getElementById("loadingSpinner");
    const errorAlert = document.getElementById("errorAlert");

    // Mobile UI elements
    const mobileHandPreviews = document.getElementById("mobile-hand-previews");
    const mobileHandEditor = document.getElementById("mobile-hand-editor");
    const mobileEditorTitle = document.getElementById("mobile-editor-title");
    const mobileEditorContent = document.getElementById("mobile-editor-content");
    const mobileEditorClose = document.getElementById("mobile-editor-close");

    // Analysis mode buttons
    const doubleDummyRadio = document.getElementById("doubleDummy");
    const singleDummyRadio = document.getElementById("singleDummy");

    // --- UI Generation ---
    function createCardSelector(hand, container) {
        // ... (この関数に変更はありません)
        const uiFragment = document.createDocumentFragment();
        const titleWrapper = document.createElement("div");
        titleWrapper.className = "d-flex align-items-center justify-content-center";
        const handTitle = document.createElement("h5");
        handTitle.className = "hand-title m-0";
        handTitle.textContent = hand;
        const cardCount = document.createElement("span");
        cardCount.id = `${hand}-card-count`;
        cardCount.className = "card-count";
        titleWrapper.appendChild(handTitle);
        titleWrapper.appendChild(cardCount);
        uiFragment.appendChild(titleWrapper);

        Object.entries(SUITS).forEach(([suit, symbol]) => {
            const suitGroup = document.createElement("div");
            suitGroup.className = "input-group input-group-sm mb-1";
            const suitSymbol = document.createElement("span");
            suitSymbol.className = `input-group-text suit-symbol ${SUIT_COLORS[suit]}`;
            suitSymbol.innerHTML = symbol;
            suitGroup.appendChild(suitSymbol);
            const cardContainer = document.createElement("div");
            cardContainer.className =
                "form-control d-flex justify-content-start align-items-center flex-wrap";
            RANKS.forEach((rank) => {
                const cardEl = document.createElement("span");
                cardEl.className = "card-rank";
                cardEl.dataset.hand = hand;
                cardEl.dataset.suit = suit;
                cardEl.dataset.rank = rank;
                cardEl.textContent = rank;
                cardContainer.appendChild(cardEl);
            });
            suitGroup.appendChild(cardContainer);
            uiFragment.appendChild(suitGroup);
        });
        container.innerHTML = ""; // Clear before appending
        container.appendChild(uiFragment);
    }

    function createDesktopUI() {
        HANDS.forEach((hand) => {
            const handContainer = document.getElementById(`${hand}-container`);
            if (handContainer) {
                createCardSelector(hand, handContainer);
            }
        });
    }

    function createMobileUI() {
        // ... (この関数に変更はありません)
        HANDS.forEach((hand) => {
            const preview = document.createElement("div");
            preview.id = `mobile-preview-${hand}`;
            preview.className = "mobile-preview";
            preview.dataset.hand = hand;

            const title = document.createElement("div");
            title.className = "mobile-preview-title";
            title.textContent = hand;

            const cards = document.createElement("div");
            cards.id = `mobile-preview-cards-${hand}`;
            cards.className = "mobile-preview-cards";

            const count = document.createElement("div");
            count.id = `mobile-preview-count-${hand}`;
            count.className = "mobile-preview-count";
            count.textContent = "(0/13)";

            preview.appendChild(title);
            preview.appendChild(cards);
            preview.appendChild(count);
            mobileHandPreviews.appendChild(preview);
        });
    }

    // --- PBN and Count Update ---
    function updatePbnAndSync() {
        // ... (この関数に変更はありません)
        const pbnOrder = ["north", "east", "south", "west"];
        const handStrings = pbnOrder.map((hand) => {
            if (analysisMode === "single" && (hand === "east" || hand === "west")) {
                return "..";
            }
            const handContainer = document.getElementById(`${hand}-container`);
            return Object.keys(SUITS)
                .map((suit) => {
                    const selectedRanks = Array.from(
                        handContainer.querySelectorAll(`.card-rank.selected[data-suit="${suit}"]`)
                    );
                    selectedRanks.sort(
                        (a, b) => RANKS.indexOf(a.dataset.rank) - RANKS.indexOf(b.dataset.rank)
                    );
                    return selectedRanks.map((el) => el.dataset.rank).join("") || "-";
                })
                .join(".");
        });
        const pbnString = `N:${handStrings.join(" ")}`;
        pbnInputDesktop.value = pbnString;
        pbnInputMobile.value = pbnString;
    }

    function updateCardCounts() {
        // ... (この関数に変更はありません)
        HANDS.forEach((hand) => {
            const handContainer = document.getElementById(`${hand}-container`);
            const count = handContainer.querySelectorAll(`.card-rank.selected`).length;

            const countEl = handContainer.querySelector(".card-count");
            if (countEl) {
                countEl.textContent = `(${count}/13)`;
                countEl.classList.toggle("valid", count === 13);
                countEl.classList.toggle("invalid", count !== 13);
            }
            handContainer.classList.toggle("hand-complete", count === 13);

            const mobilePreview = document.getElementById(`mobile-preview-${hand}`);
            const mobilePreviewCount = document.getElementById(`mobile-preview-count-${hand}`);
            const mobilePreviewCards = document.getElementById(`mobile-preview-cards-${hand}`);
            if (mobilePreview) {
                mobilePreview.classList.toggle("hand-complete", count === 13);
                mobilePreviewCount.textContent = `(${count}/13)`;
                mobilePreviewCount.classList.toggle("valid", count === 13);
                mobilePreviewCount.classList.toggle("invalid", count !== 13);

                const cardString = Object.keys(SUITS)
                    .map((suit) => {
                        const selectedRanks = Array.from(
                            handContainer.querySelectorAll(
                                `.card-rank.selected[data-suit="${suit}"]`
                            )
                        );
                        if (selectedRanks.length === 0)
                            return `<div><span class="${SUIT_COLORS[suit]}">${SUITS[suit]}</span> -</div>`;
                        selectedRanks.sort(
                            (a, b) => RANKS.indexOf(a.dataset.rank) - RANKS.indexOf(b.dataset.rank)
                        );
                        const rankString = selectedRanks.map((el) => el.dataset.rank).join(" ");
                        return `<div><span class="${SUIT_COLORS[suit]}">${SUITS[suit]}</span> ${rankString}</div>`;
                    })
                    .join("");
                mobilePreviewCards.innerHTML = cardString;
            }
        });
    }

    // --- Autocomplete Logic ---
    function attemptAutoComplete() {
        // ... (この関数に変更はありません)
        if (analysisMode === "single") return; // Do not autocomplete in single dummy mode

        const selectedCards = document.querySelectorAll(".card-rank.selected");
        if (selectedCards.length !== 39) return;

        const incompleteHand = HANDS.find(
            (hand) =>
                document
                    .getElementById(`${hand}-container`)
                    .querySelectorAll(".card-rank.selected").length < 13
        );
        if (!incompleteHand) return;

        const incompleteHandContainer = document.getElementById(`${incompleteHand}-container`);
        const unselectedInHand = incompleteHandContainer.querySelectorAll(
            ".card-rank:not(.selected)"
        );

        unselectedInHand.forEach((cardEl) => {
            if (!cardEl.classList.contains("disabled")) {
                cardEl.classList.add("selected");
            }
        });

        updatePbnAndSync();
        updateCardCounts();
    }

    // --- Mobile Editor ---
    function openMobileEditor(hand) {
        if (activeMobileHand === hand) {
            closeMobileEditor();
            return;
        }
        if (activeMobileHand) {
            closeMobileEditor();
        }

        activeMobileHand = hand;
        const handContainer = document.getElementById(`${hand}-container`);
        const placeholder = document.createElement("div");
        placeholder.id = `${hand}-placeholder`;

        if (handContainer) {
            handContainer.replaceWith(placeholder);
            mobileEditorContent.appendChild(handContainer);
        }

        mobileEditorTitle.textContent = translations.editHandTitle.replace("{hand}", hand);
        mobileHandEditor.classList.remove("d-none");
        const activePreview = document.getElementById(`mobile-preview-${hand}`);
        if (activePreview) {
            activePreview.classList.add("active-editor");
        }
    }

    function closeMobileEditor() {
        if (!activeMobileHand) return;

        const handContainer = mobileEditorContent.querySelector(".hand-container");
        const placeholder = document.getElementById(`${activeMobileHand}-placeholder`);

        if (handContainer && placeholder) {
            placeholder.replaceWith(handContainer);
        }

        mobileHandEditor.classList.add("d-none");
        const activePreview = document.getElementById(`mobile-preview-${activeMobileHand}`);
        if (activePreview) {
            activePreview.classList.remove("active-editor");
        }
        activeMobileHand = null;
    }

    // --- Event Handlers ---
    function handleCardClick(target) {
        if (target.classList.contains("disabled")) return;

        const hand = target.dataset.hand;
        const handContainer = document.getElementById(`${hand}-container`);

        if (!target.classList.contains("selected")) {
            const currentCount = handContainer.querySelectorAll(".card-rank.selected").length;
            if (currentCount >= 13) {
                const countEl = handContainer.querySelector(".card-count");
                if (countEl) {
                    countEl.classList.add("flash-warning");
                    setTimeout(() => countEl.classList.remove("flash-warning"), 300);
                }
                return;
            }
        }

        target.classList.toggle("selected");
        const isSelected = target.classList.contains("selected");
        const { suit, rank } = target.dataset;

        HANDS.forEach((otherHand) => {
            if (otherHand !== hand) {
                const otherHandContainer = document.getElementById(`${otherHand}-container`);
                const otherCard = otherHandContainer.querySelector(
                    `.card-rank[data-suit="${suit}"][data-rank="${rank}"]`
                );
                if (otherCard) otherCard.classList.toggle("disabled", isSelected);
            }
        });

        updatePbnAndSync();
        updateCardCounts();
        attemptAutoComplete();
    }

    function syncPbnInputs(source, destination) {
        destination.value = source.value;
        handlePbnInput(source.value);
    }

    function handlePbnInput(pbnString) {
        // ... (この関数に変更はありません)
        if (!pbnString.startsWith("N:")) return;

        document.querySelectorAll(".card-rank").forEach((el) => {
            el.classList.remove("selected", "disabled");
        });

        const handsData = pbnString.substring(2).split(" ");
        if (handsData.length !== 4) return;

        const pbnOrder = ["north", "east", "south", "west"];
        const suitOrder = ["spades", "hearts", "diamonds", "clubs"];
        const allSelectedCards = new Set();

        handsData.forEach((handData, handIndex) => {
            const currentHand = pbnOrder[handIndex];
            const handContainer = document.getElementById(currentHand + "-container");
            const suits = handData.split(".");

            suits.forEach((suitData, suitIndex) => {
                const currentSuit = suitOrder[suitIndex];
                const ranks = suitData.toUpperCase().split("");

                ranks.forEach((rank) => {
                    if (rank === "-" || !handContainer) return;
                    const cardEl = handContainer.querySelector(
                        `.card-rank[data-suit="${currentSuit}"][data-rank="${rank}"]`
                    );
                    if (cardEl) {
                        cardEl.classList.add("selected");
                        allSelectedCards.add(`${currentSuit}-${rank}`);
                    }
                });
            });
        });

        HANDS.forEach((hand) => {
            const handContainer = document.getElementById(`${hand}-container`);
            if (!handContainer) return;
            RANKS.forEach((rank) => {
                Object.keys(SUITS).forEach((suit) => {
                    if (allSelectedCards.has(`${suit}-${rank}`)) {
                        const cardInOtherHand = handContainer.querySelector(
                            `.card-rank[data-suit="${suit}"][data-rank="${rank}"]:not(.selected)`
                        );
                        if (cardInOtherHand) {
                            cardInOtherHand.classList.add("disabled");
                        }
                    }
                });
            });
        });

        updateCardCounts();
        updatePbnAndSync();
    }

    function runAnalysis() {
        const pbn = pbnInputDesktop.value.trim();
        if (!pbn) {
            showError(translations.pbnEmptyError || "PBN input is empty.");
            return;
        }

        resultsContainer.innerHTML = "";
        errorAlert.classList.add("d-none");
        loadingSpinner.classList.remove("d-none");

        if (analysisMode === "double") {
            runDoubleDummyAnalysis(pbn);
        } else {
            const simulations = parseInt(simulationsInputDesktop.value, 10) || 1000;
            runSingleDummyAnalysis(pbn, simulations);
        }
    }

    function runDoubleDummyAnalysis(pbn) {
        // ... (この関数に変更はありません)
        fetch("https://bridge-analyzer-backend-668564208605.asia-northeast1.run.app/api/analyse", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ pbn: pbn }),
        })
            .then((response) => {
                if (!response.ok) {
                    return response.json().then((err) => {
                        throw new Error(err.error || `サーバーエラー: ${response.status}`);
                    });
                }
                return response.json();
            })
            .then((data) => {
                loadingSpinner.classList.add("d-none");
                if (data.error) {
                    throw new Error(data.error);
                }
                displayDoubleDummyResults(data.tricks);
            })
            .catch((error) => {
                loadingSpinner.classList.add("d-none");
                showError(`分析中にエラーが発生しました: ${error.message}`);
                console.error("Error:", error);
            });
    }

    function runSingleDummyAnalysis(pbn, simulations) {
        const pbnParts = pbn.substring(2).split(" ");
        const ns_pbn = `N:${pbnParts[0]} .. ${pbnParts[2]} .`;

        fetch(
            "https://bridge-analyzer-backend-668564208605.asia-northeast1.run.app/api/analyse_single_dummy",
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ pbn: ns_pbn, simulations: simulations }),
            }
        )
            .then((response) => {
                if (!response.ok) {
                    return response.json().then((err) => {
                        throw new Error(err.error || `Server error: ${response.status}`);
                    });
                }
                return response.json();
            })
            .then((data) => {
                loadingSpinner.classList.add("d-none");
                if (data.error) {
                    throw new Error(data.error);
                }
                displaySingleDummyResults(data.average_tricks, data.simulations_run);
            })
            .catch((error) => {
                loadingSpinner.classList.add("d-none");
                showError(`分析中にエラーが発生しました: ${error.message}`);
                console.error("Error:", error);
            });
    }

    document.querySelectorAll("[data-lang]").forEach((button) => {
        button.addEventListener("click", (e) => {
            setLanguage(e.target.dataset.lang);
        });
    });

    // --- Attach Event Listeners ---
    document.body.addEventListener("click", (e) => {
        if (e.target.matches(".card-rank")) {
            handleCardClick(e.target);
        }
    });

    mobileHandPreviews.addEventListener("click", (e) => {
        const preview = e.target.closest(".mobile-preview");
        if (preview && !preview.classList.contains("d-none")) {
            openMobileEditor(preview.dataset.hand);
        }
    });

    mobileEditorClose.addEventListener("click", closeMobileEditor);
    pbnInputDesktop.addEventListener("input", () =>
        syncPbnInputs(pbnInputDesktop, pbnInputMobile)
    );
    pbnInputMobile.addEventListener("input", () => syncPbnInputs(pbnInputMobile, pbnInputDesktop));
    simulationsInputDesktop.addEventListener("input", () => {
        simulationsInputMobile.value = simulationsInputDesktop.value;
    });
    simulationsInputMobile.addEventListener("input", () => {
        simulationsInputDesktop.value = simulationsInputMobile.value;
    });

    analyzeBtnDesktop.addEventListener("click", runAnalysis);
    analyzeBtnMobile.addEventListener("click", runAnalysis);

    doubleDummyRadio.addEventListener("change", () => setAnalysisMode("double"));
    singleDummyRadio.addEventListener("change", () => setAnalysisMode("single"));

    // --- UI Helper Functions ---
    function setAnalysisMode(mode) {
        analysisMode = mode;
        const eastContainer = document.getElementById("east-container");
        const westContainer = document.getElementById("west-container");
        const eastPreview = document.getElementById("mobile-preview-east");
        const westPreview = document.getElementById("mobile-preview-west");

        const simsContainerDesktop = document.getElementById("simulations-container-desktop");
        const simsContainerMobile = document.getElementById("simulations-container-mobile");

        const isSingleDummy = mode === "single";

        // Toggle visibility for E/W hands
        [eastContainer, westContainer, eastPreview, westPreview].forEach((el) => {
            if (el) el.classList.toggle("d-none", isSingleDummy);
        });

        // Toggle visibility for simulations input
        [simsContainerDesktop, simsContainerMobile].forEach((el) => {
            if (el) el.classList.toggle("d-none", !isSingleDummy);
        });

        // Clear E/W selections if switching to single dummy
        if (isSingleDummy) {
            ["east", "west"].forEach((hand) => {
                document
                    .getElementById(`${hand}-container`)
                    .querySelectorAll(".card-rank.selected")
                    .forEach((card) => {
                        card.classList.remove("selected");
                    });
            });
            // Re-enable all cards for N/S that might have been disabled by E/W's selections
            document
                .querySelectorAll(".card-rank.disabled")
                .forEach((card) => card.classList.remove("disabled"));
            handlePbnInput(pbnInputDesktop.value); // Re-process PBN to set disabled state correctly
        }

        updatePbnAndSync();
        updateCardCounts();
    }

    function displayDoubleDummyResults(tricks) {
        // ... (この関数に変更はありません)
        if (!tricks || Object.keys(tricks).length === 0) return;
        const table = document.createElement("table");
        table.className = "table table-bordered table-striped table-sm";
        const thead = document.createElement("thead");
        thead.innerHTML = `<tr>
                            <th>Hand</th>
                            <th>NT</th>
                            <th><span class="${SUIT_COLORS.spades}">${SUITS.spades}</span></th>
                            <th><span class="${SUIT_COLORS.hearts}">${SUITS.hearts}</span></th>
                            <th><span class="${SUIT_COLORS.diamonds}">${SUITS.diamonds}</span></th>
                            <th><span class="${SUIT_COLORS.clubs}">${SUITS.clubs}</span></th>
                           </tr>`;
        table.appendChild(thead);
        const tbody = document.createElement("tbody");
        const handOrder = ["North", "East", "South", "West"];
        const suitOrder = ["No-Trump", "Spades", "Hearts", "Diamonds", "Clubs"];
        handOrder.forEach((hand) => {
            const row = document.createElement("tr");
            let rowHtml = `<td class="fw-bold">${translations[hand.toLowerCase()]}</td>`;
            suitOrder.forEach((suit) => {
                const trickCount = tricks[suit] ? tricks[suit][hand] : "-";
                rowHtml += `<td>${trickCount}</td>`;
            });
            row.innerHTML = rowHtml;
            tbody.appendChild(row);
        });
        table.appendChild(tbody);
        resultsContainer.innerHTML = `<h5 data-i18n="resultsTitleDD">${translations.resultsTitleDD}</h5>`;
        resultsContainer.appendChild(table);
    }

    function displaySingleDummyResults(avgTricks, simulationsRun) {
        if (!avgTricks) return;
        const table = document.createElement("table");
        table.className = "table table-bordered table-striped table-sm";
        const thead = document.createElement("thead");
        thead.innerHTML = `<tr>
                            <th>Hand</th>
                            <th>NT</th>
                            <th><span class="${SUIT_COLORS.spades}">${SUITS.spades}</span></th>
                            <th><span class="${SUIT_COLORS.hearts}">${SUITS.hearts}</span></th>
                            <th><span class="${SUIT_COLORS.diamonds}">${SUITS.diamonds}</span></th>
                            <th><span class="${SUIT_COLORS.clubs}">${SUITS.clubs}</span></th>
                           </tr>`;
        table.appendChild(thead);
        const tbody = document.createElement("tbody");
        const handOrder = ["North", "South"];
        const suitOrder = ["No-Trump", "Spades", "Hearts", "Diamonds", "Clubs"];

        handOrder.forEach((hand) => {
            const row = document.createElement("tr");
            let rowHtml = `<td class="fw-bold">${hand}</td>`;
            suitOrder.forEach((suit) => {
                // Format to 2 decimal places
                const trickCount =
                    avgTricks[suit] && avgTricks[suit][hand] !== undefined
                        ? avgTricks[suit][hand].toFixed(2)
                        : "-";
                rowHtml += `<td>${trickCount}</td>`;
            });
            row.innerHTML = rowHtml;
            tbody.appendChild(row);
        });
        table.appendChild(tbody);
        resultsContainer.innerHTML = `<h5>${translations.resultsTitleSD.replace(
            "{simulations}",
            simulationsRun
        )}</h5>`;
        resultsContainer.appendChild(table);
    }

    function showError(message) {
        errorAlert.textContent = message;
        errorAlert.classList.remove("d-none");
    }

    // --- Initialisation ---
    async function initialize() {
        const userLang =
            localStorage.getItem("userLanguage") ||
            (navigator.language.startsWith("ja") ? "ja" : "en");
        await setLanguage(userLang);

        createDesktopUI();
        createMobileUI();
        updatePbnAndSync();
        updateCardCounts();
        setAnalysisMode("double"); // Initial state
    }

    initialize();
});
