document.addEventListener("DOMContentLoaded", async () => {
    // --- 定数と状態管理 ---
    const HANDS = ["north", "east", "south", "west"];
    const SUITS = { spades: "♠", hearts: "♥", diamonds: "♦", clubs: "♣" };
    const SUIT_KEYS = Object.keys(SUITS);
    const SUIT_COLORS = {
        spades: "suit-spades",
        hearts: "suit-hearts",
        diamonds: "suit-diamonds",
        clubs: "suit-clubs",
    };
    const RANKS = ["A", "K", "Q", "J", "T", "9", "8", "7", "6", "5", "4", "3", "2"];
    let activeMobileHand = null;
    let translations = {};

    // --- エレメント参照 ---
    const getEl = (id) => document.getElementById(id);
    const pbnInputDesktop = getEl("pbnInputDesktop");
    const pbnInputMobile = getEl("pbnInputMobile");
    const simulationsInputDesktop = getEl("simulationsInputDesktop");
    const simulationsInputMobile = getEl("simulationsInputMobile");
    const analyzeBtnDesktop = getEl("analyzeBtnDesktop");
    const analyzeBtnMobile = getEl("analyzeBtnMobile");
    const resultsContainer = getEl("resultsContainer");
    const mobileHandPreviews = getEl("mobile-hand-previews");
    const mobileHandEditor = getEl("mobile-hand-editor");
    const mobileEditorTitle = getEl("mobile-editor-title");
    const mobileEditorContent = getEl("mobile-editor-content");
    const mobileEditorClose = getEl("mobile-editor-close");
    const solveLeadBtn = getEl("solveLeadBtn");
    const solveLeadBtnMobile = getEl("solveLeadBtnMobile");
    const leadResultsContainer = getEl("leadResultsContainer");
    const globalSpinner = getEl("global-spinner");
    const globalError = getEl("global-error");
    const ddsAnalysisSection = getEl("dds-analysis-section");
    const leadAnalysisSection = getEl("lead-analysis-section");
    const leaderSelect = getEl("lead-leader");
    const leaderSelectMobile = getEl("lead-leader-mobile");
    const leadMobileAllHandsContainer = getEl("lead-mobile-all-hands-container");

    const directionMap = { N: "north", S: "south", E: "east", W: "west" };

    // --- 多言語対応 (I18n) ---
    async function setLanguage(lang) {
        try {
            const response = await fetch(`lang/${lang}.json`);
            if (!response.ok) throw new Error("Language file not found");
            translations = await response.json();
            document.documentElement.lang = lang;
            localStorage.setItem("userLanguage", lang);
            updateAllText();
        } catch (error) {
            console.error("Could not set language:", error);
            if (lang !== "ja") await setLanguage("ja");
        }
    }

    function updateAllText() {
        document.querySelectorAll("[data-i18n]").forEach((el) => {
            const key = el.getAttribute("data-i18n");
            if (translations[key]) el.textContent = translations[key];
        });
        document.querySelectorAll("[data-i18n-html]").forEach((el) => {
            const key = el.getAttribute("data-i18n-html");
            if (translations[key]) el.innerHTML = translations[key];
        });
        document.querySelectorAll("[data-i18n-attr]").forEach((el) => {
            const attrs = el.getAttribute("data-i18n-attr").split(";");
            attrs.forEach((attr) => {
                const [attrName, key] = attr.split(":");
                if (translations[key.trim()])
                    el.setAttribute(attrName.trim(), translations[key.trim()]);
            });
        });
        document.querySelectorAll("[data-lang]").forEach((btn) => {
            btn.classList.toggle("active", btn.dataset.lang === document.documentElement.lang);
        });
        const helpIcon = getEl("help-icon");
        if (helpIcon) {
            const existingPopover = bootstrap.Popover.getInstance(helpIcon);
            if (existingPopover) existingPopover.dispose();
            const popoverContent = `<p>${translations.helpIntro || ""}</p><strong>${
                translations.featuresTitle || ""
            }</strong><ul><li>${translations.featureDD || ""}</li><li>${
                translations.featureSD || ""
            }</li><li>${translations.featureLead || ""}</li><li>${
                translations.featurePBN || ""
            }</li><li>${translations.featureUI || ""}</li></ul><strong>${
                translations.whatIsDDTitle || ""
            }</strong><p>${translations.whatIsDDText || ""}</p>`;
            new bootstrap.Popover(helpIcon, {
                title: translations.helpTitle || "Help",
                content: popoverContent,
                html: true,
                trigger: "focus",
                placement: "bottom",
                customClass: "wide-popover",
            });
        }
    }

    // --- UIモード管理 ---
    function setAnalysisMode(mode) {
        ddsAnalysisSection.classList.toggle(
            "d-none",
            mode !== "doubleDummy" && mode !== "singleDummy"
        );
        leadAnalysisSection.classList.toggle("d-none", mode !== "leadSolver");

        if (mode === "leadSolver") {
            renderLeadSolverUI();
        } else {
            const isSingleDummy = mode === "singleDummy";
            getEl("simulations-container-desktop").classList.toggle("d-none", !isSingleDummy);
            getEl("simulations-container-mobile").classList.toggle("d-none", !isSingleDummy);
            [
                "east-container",
                "west-container",
                "mobile-preview-east",
                "mobile-preview-west",
            ].forEach((id) => {
                getEl(id)?.classList.toggle("d-none", isSingleDummy);
            });
            if (isSingleDummy) {
                ["east", "west"].forEach((hand) =>
                    document
                        .querySelectorAll(`#${hand}-container .card-rank.selected`)
                        .forEach((card) => card.classList.remove("selected"))
                );
                document
                    .querySelectorAll(".card-rank.disabled")
                    .forEach((card) => card.classList.remove("disabled"));
                if (pbnInputDesktop) handlePbnInput(pbnInputDesktop.value);
            }
        }
        updatePbnAndSync();
        updateCardCounts();
        clearResultsAndErrors();
    }

    function renderLeadSolverUI() {
        const leader = directionMap[leaderSelect.value];
        leadMobileAllHandsContainer.innerHTML = "";

        HANDS.forEach((player) => {
            const isLeader = player === leader;
            const desktopContainer = getEl(`lead-${player}-container`);

            if (isLeader) {
                if (!desktopContainer.querySelector(".card-rank"))
                    createCardSelector(player, desktopContainer, "lead");
            } else {
                if (!desktopContainer.querySelector(`#hcp-${player}`)) {
                    desktopContainer.innerHTML = createConditionInputsHTML(player, false);
                }
            }

            const mobilePlayerContainer = document.createElement("div");
            mobilePlayerContainer.id = `lead-mobile-${player}-container`;
            mobilePlayerContainer.className = "hand-container mb-3 p-2 border rounded";
            if (isLeader) {
                createCardSelector(player, mobilePlayerContainer, "lead-mobile");
            } else {
                mobilePlayerContainer.innerHTML = createConditionInputsHTML(player, true);
            }
            leadMobileAllHandsContainer.appendChild(mobilePlayerContainer);
        });

        // syncLeadUIState();
    }

    function syncLeadUIState() {
        const leader = directionMap[leaderSelect.value];
        const allSelected = new Set();

        HANDS.forEach((player) => {
            const isLeader = player === leader;
            if (isLeader) {
                const desktopCards = getEl(`lead-${player}-container`).querySelectorAll(
                    ".card-rank"
                );
                desktopCards.forEach((dCard) => {
                    if (dCard.classList.contains("selected")) {
                        allSelected.add(`${dCard.dataset.suit}-${dCard.dataset.rank}`);
                    }
                });
            } else {
                // SUIT_KEYS.forEach((suit) => {
                //     const dInput = getEl(`shape-${player}-${suit}`);
                //     const mInput = getEl(`shape-${player}-${suit}-mobile`);
                //     if (dInput && mInput) mInput.value = dInput.value;
                // });
                // const dHcp = getEl(`hcp-${player}`);
                // const mHcp = getEl(`hcp-${player}-mobile`);
                // if (dHcp && mHcp) mHcp.value = dHcp.value;
            }
        });

        ["lead", "lead-mobile"].forEach((prefix) => {
            const container = getEl(`${prefix}-${leader}-container`);
            if (container) {
                container.querySelectorAll(".card-rank").forEach((card) => {
                    const cardID = `${card.dataset.suit}-${card.dataset.rank}`;
                    const isSelected = allSelected.has(cardID);
                    card.classList.toggle("selected", isSelected);
                    card.classList.toggle(
                        "disabled",
                        isSelected && !card.classList.contains("selected")
                    );
                });
            }
        });

        updateAllCardCounts("lead");
        updateAllCardCounts("lead-mobile");
    }

    function clearResultsAndErrors() {
        resultsContainer.innerHTML = "";
        leadResultsContainer.innerHTML = "";
        globalError.classList.add("d-none");
    }

    // --- UI生成 ---
    function createCardSelector(hand, container, prefix = "") {
        if (!container) return;
        container.innerHTML = "";
        const titleWrapper = document.createElement("div");
        titleWrapper.className = "d-flex align-items-center justify-content-center";
        titleWrapper.innerHTML = `<h5 class="hand-title m-0">${
            translations[hand.toLowerCase()] || hand
        }</h5><span id="${
            prefix ? `${prefix}-` : ""
        }${hand}-card-count" class="card-count"></span>`;
        container.appendChild(titleWrapper);
        Object.entries(SUITS).forEach(([suit, symbol]) => {
            const suitGroup = document.createElement("div");
            suitGroup.className = "input-group input-group-sm mb-1";
            const cardContainer = document.createElement("div");
            cardContainer.className =
                "form-control d-flex justify-content-start align-items-center flex-wrap";
            RANKS.forEach((rank) => {
                cardContainer.innerHTML += `<span class="card-rank" data-hand="${hand}" data-suit="${suit}" data-rank="${rank}" data-prefix="${prefix}">${rank}</span>`;
            });
            suitGroup.innerHTML = `<span class="input-group-text suit-symbol ${SUIT_COLORS[suit]}">${symbol}</span>`;
            suitGroup.appendChild(cardContainer);
            container.appendChild(suitGroup);
        });
    }

    function createConditionInputsHTML(player, isMobile) {
        const idSuffix = isMobile ? "-mobile" : "";
        const title = `<h5 class="text-capitalize text-center">${
            translations[player] || player
        }</h5>`;

        const shapeInputs = SUIT_KEYS.map(
            (suit) => `
            <div class="input-group input-group-sm mb-1 shape-input-group">
                <span class="input-group-text suit-symbol ${SUIT_COLORS[suit]}">${SUITS[suit]}</span>
                <input type="text" class="form-control" id="shape-${player}-${suit}${idSuffix}" value="0-13">
            </div>
        `
        ).join("");

        return `
            ${title}
            <label class="form-label small" data-i18n="shapeRange">${
                translations.shapeRange || "Shape Range"
            }</label>
            ${shapeInputs}
            <div class="mt-2">
                <label for="hcp-${player}${idSuffix}" class="form-label small" data-i18n="hcp">${
            translations.hcp || "HCP"
        }</label>
                <input type="text" class="form-control form-control-sm" id="hcp-${player}${idSuffix}" value="0-37">
            </div>`;
    }

    function createMobilePreview(container, hand) {
        if (!container) return;
        const preview = document.createElement("div");
        preview.id = `mobile-preview-${hand}`;
        preview.className = "mobile-preview";
        preview.dataset.hand = hand;
        preview.innerHTML = `
            <div class="mobile-preview-title">${translations[hand.toLowerCase()] || hand}</div>
            <div class="mobile-preview-cards"></div>
            <div class="mobile-preview-count"></div>`;
        container.appendChild(preview);
    }

    function updateAllCardCounts(prefix = "") {
        const fullPrefix = prefix ? `${prefix}-` : "";
        HANDS.forEach((hand) => {
            const handContainer = getEl(`${fullPrefix}${hand}-container`);
            if (!handContainer) return;
            const count = handContainer.querySelectorAll(`.card-rank.selected`).length;
            console.log(`${fullPrefix}${hand}-card-count`);

            if (getEl(`${fullPrefix}${hand}-card-count`)) {
                getEl(`${fullPrefix}${hand}-card-count`).classList.toggle("valid", count === 13);
                getEl(`${fullPrefix}${hand}-card-count`).textContent = `(${count}/13)`;
            }

            const mobilePreview = getEl(`mobile-preview-${hand}`);
            if (mobilePreview) {
                mobilePreview.classList.toggle("hand-complete", count === 13);
                mobilePreview.querySelector(".mobile-preview-count").textContent = `(${count}/13)`;
                mobilePreview.querySelector(".mobile-preview-cards").innerHTML = Object.keys(SUITS)
                    .map((suit) => {
                        const selectedRanks = Array.from(
                            handContainer.querySelectorAll(
                                `.card-rank.selected[data-suit="${suit}"]`
                            )
                        )
                            .sort(
                                (a, b) =>
                                    RANKS.indexOf(a.dataset.rank) - RANKS.indexOf(b.dataset.rank)
                            )
                            .map((el) => el.dataset.rank)
                            .join(" ");
                        return `<div><span class="${SUIT_COLORS[suit]}">${SUITS[suit]}</span> ${
                            selectedRanks || "-"
                        }</div>`;
                    })
                    .join("");
            }
        });
    }

    // --- PBNとカード枚数更新 ---
    function updatePbnAndSync() {
        if (!getEl("north-container")) return;
        const pbnOrder = ["north", "east", "south", "west"];
        const handStrings = pbnOrder.map((hand) => {
            const handContainer = getEl(`${hand}-container`);
            if (getEl("singleDummyToggle").checked && (hand === "east" || hand === "west"))
                return "..";
            return Object.keys(SUITS)
                .map(
                    (suit) =>
                        Array.from(
                            handContainer.querySelectorAll(
                                `.card-rank.selected[data-suit="${suit}"]`
                            )
                        )
                            .sort(
                                (a, b) =>
                                    RANKS.indexOf(a.dataset.rank) - RANKS.indexOf(b.dataset.rank)
                            )
                            .map((el) => el.dataset.rank)
                            .join("") || "-"
                )
                .join(".");
        });
        const pbnString = `N:${handStrings.join(" ")}`;
        if (pbnInputDesktop) pbnInputDesktop.value = pbnString;
        if (pbnInputMobile) pbnInputMobile.value = pbnString;
    }

    function updateCardCounts() {
        HANDS.forEach((hand) => {
            const handContainer = getEl(`${hand}-container`);
            if (!handContainer) return;
            const count = handContainer.querySelectorAll(`.card-rank.selected`).length;
            getEl(`${hand}-card-count`)?.classList.toggle("valid", count === 13);

            const mobilePreview = getEl(`mobile-preview-${hand}`);
            if (mobilePreview) {
                mobilePreview.classList.toggle("hand-complete", count === 13);
                mobilePreview.querySelector(".mobile-preview-count").textContent = `(${count}/13)`;
                mobilePreview.querySelector(".mobile-preview-cards").innerHTML = Object.keys(SUITS)
                    .map((suit) => {
                        const selectedRanks = Array.from(
                            handContainer.querySelectorAll(
                                `.card-rank.selected[data-suit="${suit}"]`
                            )
                        )
                            .sort(
                                (a, b) =>
                                    RANKS.indexOf(a.dataset.rank) - RANKS.indexOf(b.dataset.rank)
                            )
                            .map((el) => el.dataset.rank)
                            .join(" ");
                        return `<div><span class="${SUIT_COLORS[suit]}">${SUITS[suit]}</span> ${
                            selectedRanks || "-"
                        }</div>`;
                    })
                    .join("");
            }
        });
    }

    function attemptAutoComplete() {
        if (getEl("singleDummyToggle").checked) return;
        const selectedCards = document.querySelectorAll(
            "#dds-analysis-section .card-rank.selected"
        );
        if (selectedCards.length !== 39) return;
        const incompleteHand = HANDS.find(
            (hand) =>
                getEl(`${hand}-container`).querySelectorAll(".card-rank.selected").length < 13
        );
        if (incompleteHand) {
            document
                .querySelectorAll(
                    `#${incompleteHand}-container .card-rank:not(.selected):not(.disabled)`
                )
                .forEach((cardEl) => cardEl.classList.add("selected"));
            updatePbnAndSync();
            updateCardCounts();
        }
    }

    // --- モバイルエディタ (DDS/SD用) ---
    function openMobileEditor(hand) {
        if (activeMobileHand) closeMobileEditor();
        activeMobileHand = hand;
        const handContainer = getEl(`${hand}-container`);
        const placeholder = document.createElement("div");
        placeholder.id = `${hand}-placeholder`;
        handContainer.parentNode.insertBefore(placeholder, handContainer);
        mobileEditorContent.appendChild(handContainer);
        mobileEditorTitle.textContent = (translations.editHandTitle || "Edit {hand}").replace(
            "{hand}",
            translations[hand.toLowerCase()] || hand
        );
        mobileHandEditor.classList.remove("d-none");
        getEl(`mobile-preview-${hand}`).classList.add("active-editor");
    }

    function closeMobileEditor() {
        if (!activeMobileHand) return;
        const handContainer = mobileEditorContent.querySelector(".hand-container");
        const placeholder = getEl(`${activeMobileHand}-placeholder`);
        if (handContainer && placeholder) {
            placeholder.parentNode.insertBefore(handContainer, placeholder);
            placeholder.remove();
        }
        mobileHandEditor.classList.add("d-none");
        getEl(`mobile-preview-${activeMobileHand}`).classList.remove("active-editor");
        activeMobileHand = null;
        updateCardCounts();
    }

    // --- API通信と結果表示 ---
    function handleCardClick(target) {
        if (target.classList.contains("disabled")) return;

        const { prefix } = target.dataset;
        const isSelected = target.classList.contains("selected");
        console.log(isSelected);

        const isMobile = prefix.includes("mobile");

        const masterPrefix = prefix == "" ? "" : prefix + "-";
        const masterContainer = getEl(`${masterPrefix}${target.dataset.hand}-container`);
        console.log(`${masterPrefix}${target.dataset.hand}-container`);

        if (!isSelected && masterContainer.querySelectorAll(".card-rank.selected").length >= 13) {
            const countEl = target.closest(".hand-container").querySelector(".card-count");
            if (countEl) {
                countEl.classList.add("flash-warning");
                setTimeout(() => countEl.classList.remove("flash-warning"), 300);
            }
            return;
        }

        const allCardsSelector = `[data-suit="${target.dataset.suit}"][data-rank="${target.dataset.rank}"]`;
        const section = prefix ? "lead-analysis-section" : "dds-analysis-section";
        console.log(`#${section} ${allCardsSelector}`);

        // document
        //     .querySelectorAll(`#${section} ${allCardsSelector}`)
        //     .forEach((card) => card.classList.toggle("selected", !isSelected));

        document.querySelectorAll(`#${section} ${allCardsSelector}`).forEach((card) => {
            if (card === target || prefix) {
                console.log(!isSelected);

                card.classList.toggle("selected", !isSelected);
            } else if (!prefix) {
                card.classList.toggle("disabled", !isSelected);
            }
        });

        updateAllCardCounts(prefix);
        if (!prefix) {
            updatePbnAndSync();
            attemptAutoComplete();
        } else {
            // syncLeadUIState();
        }
    }

    function runDDSAnalysis() {
        const pbn = pbnInputDesktop.value.trim();
        if (!pbn) return showError(translations.pbnEmptyError || "PBN input is empty.");
        clearResultsAndErrors();
        globalSpinner.classList.remove("d-none");
        if (getEl("singleDummyToggle").checked) {
            runSingleDummyAnalysis(pbn, parseInt(simulationsInputDesktop.value, 10) || 1000);
        } else {
            runDoubleDummyAnalysis(pbn);
        }
    }

    function fetchAPI(url, body) {
        return fetch(
            `https://bridge-analyzer-backend-668564208605.asia-northeast1.run.app/api/${url}`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            }
        )
            .then((response) => {
                globalSpinner.classList.add("d-none");
                if (!response.ok)
                    return response.json().then((err) => {
                        throw new Error(err.error || `Server error: ${response.status}`);
                    });
                return response.json();
            })
            .then((data) => {
                if (data.error) throw new Error(data.error);
                return data;
            })
            .catch((error) => {
                showError(`Analysis failed: ${error.message}`);
                return null;
            });
    }

    async function runDoubleDummyAnalysis(pbn) {
        const data = await fetchAPI("analyse", { pbn });
        if (data) displayDoubleDummyResults(data.tricks);
    }

    async function runSingleDummyAnalysis(pbn, simulations) {
        const pbnParts = pbn.substring(2).split(" ");
        const ns_pbn = `N:${pbnParts[0]} .. ${pbnParts[2]} .`;
        const data = await fetchAPI("analyse_single_dummy", { pbn: ns_pbn, simulations });
        if (data) displaySingleDummyDistribution(data.trick_distribution, data.simulations_run);
    }

    async function runLeadAnalysis() {
        clearResultsAndErrors();
        const isMobile = window.innerWidth < 992;
        const leader = directionMap[(isMobile ? leaderSelectMobile : leaderSelect).value];
        const leaderHandContainer = getEl(`lead-${isMobile ? "mobile-" : ""}${leader}-container`);
        if (leaderHandContainer.querySelectorAll(".card-rank.selected").length !== 13) {
            return showError(
                translations.leader13CardsError || "Leader must have 13 cards selected."
            );
        }
        const leaderHandPbn = Object.keys(SUITS)
            .map(
                (suit) =>
                    Array.from(
                        leaderHandContainer.querySelectorAll(
                            `.card-rank.selected[data-suit="${suit}"]`
                        )
                    )
                        .sort(
                            (a, b) => RANKS.indexOf(a.dataset.rank) - RANKS.indexOf(b.dataset.rank)
                        )
                        .map((el) => el.dataset.rank)
                        .join("") || "-"
            )
            .join(".");

        const getVal = (id) => getEl(id + (isMobile ? "-mobile" : ""))?.value;
        const requestData = {
            leader_hand_pbn: leaderHandPbn,
            shapes: {},
            hcp: {},
            contract: getVal(`lead-contract`),
            leader: (isMobile ? leaderSelectMobile : leaderSelect).value,
            simulations: parseInt(getVal(`lead-simulations`), 10) || 100,
            advanced_tcl: getVal(`advanced-tcl`) || "",
        };
        let valid = true;
        HANDS.forEach((p) => {
            if (p !== leader) {
                const shapeValues = SUIT_KEYS.map((suit) => getVal(`shape-${p}-${suit}`));
                const hcp = getVal(`hcp-${p}`);
                console.log(`${p}:${shapeValues},${hcp}`);

                if (shapeValues.every((v) => v) && hcp) {
                    requestData.shapes[p] = shapeValues.join(",");
                    requestData.hcp[p] = hcp;
                } else {
                    showError(`Could not find conditions for player ${p}`);
                    valid = false;
                }
            }
        });
        if (!valid) return;

        globalSpinner.classList.remove("d-none");
        const data = await fetchAPI("solve_lead", requestData);
        if (data) displayLeadResults(data.leads);
    }

    // --- 結果表示 ---
    function displayDoubleDummyResults(tricks) {
        if (!tricks || !translations.hand) return;
        const table = `<table class="table table-bordered table-striped table-sm">
            <thead><tr><th>${translations.hand}</th><th>NT</th><th><span class="${
            SUIT_COLORS.spades
        }">♠</span></th><th><span class="${SUIT_COLORS.hearts}">♥</span></th><th><span class="${
            SUIT_COLORS.diamonds
        }">♦</span></th><th><span class="${SUIT_COLORS.clubs}">♣</span></th></tr></thead>
            <tbody>${["North", "South", "East", "West"]
                .map(
                    (hand) => `
                <tr><td class="fw-bold">${translations[hand.toLowerCase()]}</td>${[
                        "No-Trump",
                        "Spades",
                        "Hearts",
                        "Diamonds",
                        "Clubs",
                    ]
                        .map(
                            (suit) => `
                    <td>${tricks[suit] ? tricks[suit][hand] : "-"}</td>`
                        )
                        .join("")}</tr>`
                )
                .join("")}
            </tbody></table>`;
        resultsContainer.innerHTML = `<h5>${translations.resultsTitleDD}</h5>${table}`;
    }

    function displaySingleDummyDistribution(distribution, simulationsRun) {
        if (!distribution) return;
        resultsContainer.innerHTML = `<h5>${(translations.resultsTitleSD || "").replace(
            "{simulations}",
            simulationsRun
        )}</h5>`;
        const suitOrder = ["No-Trump", "Spades", "Hearts", "Diamonds", "Clubs"];
        const suitSymbols = {
            "No-Trump": "NT",
            Spades: "♠",
            Hearts: "♥",
            Diamonds: "♦",
            Clubs: "♣",
        };
        suitOrder.forEach((suit) => {
            if (!distribution[suit]) return;
            const northPercentages = distribution[suit]["North"];
            const southPercentages = distribution[suit]["South"];
            const visibleTricks = Array.from({ length: 14 }, (_, i) => i).filter(
                (i) => (northPercentages[i] || 0) > 0.01 || (southPercentages[i] || 0) > 0.01
            );
            if (visibleTricks.length === 0) return;
            let tableHTML = `<h6 class="mt-4"><span class="${
                SUIT_COLORS[suit.toLowerCase()] || ""
            }">${suitSymbols[suit]}</span> ${suit}</h6>
                <div class="table-responsive"><table class="table table-bordered table-sm text-center">
                <thead><tr><th>N/S</th>${visibleTricks.map((i) => `<th>${i}</th>`).join("")}
                <th class="table-info">${translations.game || "Game"}</th><th class="table-info">${
                translations.smallSlam || "S.Slam"
            }</th><th class="table-info">${
                translations.grandSlam || "G.Slam"
            }</th></tr></thead><tbody>`;
            ["North", "South"].forEach((hand) => {
                const percentages = distribution[suit][hand];
                tableHTML += `<tr><td class="fw-bold">${hand.charAt(0)}</td>`;
                visibleTricks.forEach((i) => {
                    const pct = percentages[i] || 0;
                    tableHTML += `<td style="background-color: ${
                        pct > 0 ? `rgba(13, 110, 253, ${pct / 100})` : ""
                    }" class="${pct > 40 ? "text-white" : ""}">${
                        pct < 0.1 ? "-" : pct.toFixed(1)
                    }</td>`;
                });
                const tricksNeeded = {
                    game: suit === "No-Trump" ? 9 : /Spades|Hearts/.test(suit) ? 10 : 11,
                    smallSlam: 12,
                    grandSlam: 13,
                };
                const gameMake = percentages.slice(tricksNeeded.game).reduce((a, b) => a + b, 0);
                const smallSlamMake = percentages
                    .slice(tricksNeeded.smallSlam)
                    .reduce((a, b) => a + b, 0);
                tableHTML += `<td class="table-info">${gameMake.toFixed(
                    1
                )}%</td><td class="table-info">${smallSlamMake.toFixed(
                    1
                )}%</td><td class="table-info">${(percentages[13] || 0).toFixed(1)}%</td></tr>`;
            });
            resultsContainer.innerHTML += `${tableHTML}</tbody></table></div>`;
        });
    }

    function displayLeadResults(leads) {
        if (!leads || leads.length === 0) return;

        const sortedLeads = [...leads].sort((a, b) => b.tricks - a.tricks);

        const tableHeader = `
            <thead>
                <tr>
                    <th style="width: 10%;">${translations.card || "Card"}</th>
                    <th style="width: 10%;">${translations.expectedTricks || "Avg Tricks"}</th>
                    <th style="width: 10%;">${translations.setPercentage || "Set %"}</th>
                    <th style="width: 70%;">${
                        translations.trickDistribution || "Trick Distribution (0-13)"
                    }</th>
                </tr>
            </thead>`;

        const tableBody = sortedLeads
            .map((lead) => {
                const suitChar = lead.card.charAt(0).toUpperCase();
                const rank = lead.card.charAt(1).toUpperCase();
                const suitName = { S: "spades", H: "hearts", D: "diamonds", C: "clubs" }[suitChar];

                const perOfTrick = lead.per_of_trick || [];
                let sum = 0;
                perOfTrick.forEach((v) => (sum += v));
                console.log(perOfTrick, sum);

                const distributionText = perOfTrick
                    .map((p, i) => {
                        // 確率が0より大きい場合のみ表示
                        if (p > 0) {
                            return `<span class="me-2" style="white-space: nowrap;"><b>${i}</b>:${(
                                (p / sum) *
                                100
                            ).toFixed()}%</span>`;
                        }
                        return "";
                    })
                    .join(" ");

                return `
                <tr>
                    <td class="fw-bold fs-5"><span class="${SUIT_COLORS[suitName]}">${
                    SUITS[suitName]
                }</span> ${rank}</td>
                    <td class="text-end">${lead.tricks.toFixed(2)}</td>
                    <td class="text-end">${lead.per_of_set.toFixed(1)}%</td>
                    <td>
                        <div class="d-flex flex-wrap" style="font-size: 0.75rem; letter-spacing: -0.5px;">
                           ${distributionText}
                        </div>
                    </td>
                </tr>`;
            })
            .join("");

        leadResultsContainer.innerHTML = `
            <div class="col-12 col-lg-10">
                <h5 class="text-center">${translations.optimalLeads}</h5>
                <div class="table-responsive">
                    <table class="table table-sm table-striped align-middle">
                        ${tableHeader}
                        <tbody>${tableBody}</tbody>
                    </table>
                </div>
            </div>`;
    }

    function showError(message) {
        globalError.textContent = message;
        globalError.classList.remove("d-none");
    }

    // --- イベントリスナー設定 ---
    function setupEventListeners() {
        document
            .querySelectorAll('input[name="mainMode"]')
            .forEach((radio) =>
                radio.addEventListener("change", (e) =>
                    setAnalysisMode(e.target.id.replace("Toggle", ""))
                )
            );
        document
            .querySelectorAll("[data-lang]")
            .forEach((button) =>
                button.addEventListener("click", (e) => setLanguage(e.target.dataset.lang))
            );
        document.body.addEventListener("click", (e) => {
            if (e.target.matches(".card-rank")) handleCardClick(e.target);
            const mobilePreview = e.target.closest(".mobile-preview");
            if (mobilePreview && ddsAnalysisSection.contains(mobilePreview)) {
                openMobileEditor(mobilePreview.dataset.hand);
            }
        });

        const syncInputs = (source, dest) => (dest.value = source.value);
        pbnInputDesktop.addEventListener("input", () =>
            syncInputs(pbnInputDesktop, pbnInputMobile)
        );
        pbnInputMobile.addEventListener("input", () =>
            syncInputs(pbnInputMobile, pbnInputDesktop)
        );
        simulationsInputDesktop.addEventListener("input", () =>
            syncInputs(simulationsInputDesktop, simulationsInputMobile)
        );
        simulationsInputMobile.addEventListener("input", () =>
            syncInputs(simulationsInputMobile, simulationsInputDesktop)
        );

        const leadControlIds = ["contract", "declarer", "vul", "simulations"];
        leadControlIds.forEach((id) => {
            const desktopEl = getEl(`lead-${id}`);
            const mobileEl = getEl(`lead-${id}-mobile`);
            desktopEl?.addEventListener("input", () => syncInputs(desktopEl, mobileEl));
            mobileEl?.addEventListener("input", () => syncInputs(mobileEl, desktopEl));
        });

        HANDS.forEach((player) => {
            const syncConditionInputs = (type, suits = false) => {
                if (suits) {
                    SUIT_KEYS.forEach((suit) => {
                        const d = getEl(`${type}-${player}-${suit}`);
                        const m = getEl(`${type}-${player}-${suit}-mobile`);
                        d?.addEventListener("input", () => (m.value = d.value));
                        m?.addEventListener("input", () => (d.value = m.value));
                    });
                } else {
                    const d = getEl(`${type}-${player}`);
                    const m = getEl(`${type}-${player}-mobile`);
                    d?.addEventListener("input", () => (m.value = d.value));
                    m?.addEventListener("input", () => (d.value = m.value));
                }
            };
            syncConditionInputs("shape", true);
            syncConditionInputs("hcp");
        });

        const syncAndRender = (source, dest) => {
            dest.value = source.value;
            renderLeadSolverUI();
        };
        leaderSelect.addEventListener("change", () =>
            syncAndRender(leaderSelect, leaderSelectMobile)
        );
        leaderSelectMobile.addEventListener("change", () =>
            syncAndRender(leaderSelectMobile, leaderSelect)
        );

        analyzeBtnDesktop.addEventListener("click", runDDSAnalysis);
        analyzeBtnMobile.addEventListener("click", runDDSAnalysis);
        solveLeadBtn.addEventListener("click", runLeadAnalysis);
        solveLeadBtnMobile.addEventListener("click", runLeadAnalysis);
        mobileEditorClose.addEventListener("click", closeMobileEditor);
    }

    // --- 初期化処理 ---
    async function initialize() {
        const userLang =
            localStorage.getItem("userLanguage") ||
            (navigator.language.startsWith("ja") ? "ja" : "en");
        await setLanguage(userLang);

        HANDS.forEach((hand) => {
            createCardSelector(hand, getEl(`${hand}-container`));
            createMobilePreview(mobileHandPreviews, hand);
        });

        const placeInGrid = (parent, childId, area) => (getEl(childId).style.gridArea = area);
        placeInGrid(mobileHandPreviews, "mobile-preview-north", "1 / 2");
        placeInGrid(mobileHandPreviews, "mobile-preview-west", "2 / 1");
        placeInGrid(mobileHandPreviews, "mobile-preview-east", "2 / 3");
        placeInGrid(mobileHandPreviews, "mobile-preview-south", "3 / 2");

        setupEventListeners();
        setAnalysisMode("doubleDummy");
    }

    initialize();
});
