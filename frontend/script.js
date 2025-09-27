document.addEventListener("DOMContentLoaded", async () => {
    // --- 定数と状態管理 ---
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
    let analysisMode = "double";
    let translations = {};

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

        // ▼ 追加: Popover（吹き出し）の処理
        const helpIcon = document.getElementById("help-icon");
        if (helpIcon) {
            // 既存のPopoverインスタンスがあれば破棄する（言語切り替え時に必須）
            const existingPopover = bootstrap.Popover.getInstance(helpIcon);
            if (existingPopover) {
                existingPopover.dispose();
            }

            // 翻訳されたテキストからPopoverのHTMLコンテンツを生成
            const popoverContent = `
                <p>${translations.helpIntro || ""}</p>
                <strong>${translations.featuresTitle || ""}</strong>
                <ul>
                    <li>${translations.featureDD || ""}</li>
                    <li>${translations.featureSD || ""}</li>
                    <li>${translations.featurePBN || ""}</li>
                    <li>${translations.featureUI || ""}</li>
                </ul>
                <strong>${translations.whatIsDDTitle || ""}</strong>
                <p>${translations.whatIsDDText || ""}</p>
            `;

            // Popoverを初期化
            new bootstrap.Popover(helpIcon, {
                title: translations.helpTitle || "Help",
                content: popoverContent,
                html: true, // HTMLコンテンツを許可
                trigger: "focus", // クリックで表示、外側をクリックで閉じる
                placement: "bottom",
            });
        }
    }

    // --- エレメント参照 ---
    const pbnInputDesktop = document.getElementById("pbnInputDesktop");
    const pbnInputMobile = document.getElementById("pbnInputMobile");
    const simulationsInputDesktop = document.getElementById("simulationsInputDesktop");
    const simulationsInputMobile = document.getElementById("simulationsInputMobile");
    const analyzeBtnDesktop = document.getElementById("analyzeBtnDesktop");
    const analyzeBtnMobile = document.getElementById("analyzeBtnMobile");
    const resultsContainer = document.getElementById("resultsContainer");
    const loadingSpinner = document.getElementById("loadingSpinner");
    const errorAlert = document.getElementById("errorAlert");
    const mobileHandPreviews = document.getElementById("mobile-hand-previews");
    const mobileHandEditor = document.getElementById("mobile-hand-editor");
    const mobileEditorTitle = document.getElementById("mobile-editor-title");
    const mobileEditorContent = document.getElementById("mobile-editor-content");
    const mobileEditorClose = document.getElementById("mobile-editor-close");
    const doubleDummyRadio = document.getElementById("doubleDummy");
    const singleDummyRadio = document.getElementById("singleDummy");

    // --- UI生成 ---
    function createCardSelector(hand, container) {
        const uiFragment = document.createDocumentFragment();
        const titleWrapper = document.createElement("div");
        titleWrapper.className = "d-flex align-items-center justify-content-center";
        const handTitle = document.createElement("h5");
        handTitle.className = "hand-title m-0";
        handTitle.textContent = (translations && translations[hand.toLowerCase()]) || hand;
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
        container.innerHTML = "";
        container.appendChild(uiFragment);
    }

    function createDesktopUI() {
        HANDS.forEach((hand) => {
            const container = document.getElementById(`${hand}-container`);
            if (container) createCardSelector(hand, container);
        });
    }

    function createMobileUI() {
        if (!mobileHandPreviews) return;
        mobileHandPreviews.innerHTML = "";
        HANDS.forEach((hand) => {
            const preview = document.createElement("div");
            preview.id = `mobile-preview-${hand}`;
            preview.className = "mobile-preview";
            preview.dataset.hand = hand;
            const title = document.createElement("div");
            title.className = "mobile-preview-title";
            title.textContent = (translations && translations[hand.toLowerCase()]) || hand;
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

    // --- PBNとカード枚数更新 ---
    function updatePbnAndSync() {
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
        HANDS.forEach((hand) => {
            const handContainer = document.getElementById(`${hand}-container`);
            if (!handContainer) return;

            const count = handContainer.querySelectorAll(`.card-rank.selected`).length;
            const countEl = handContainer.querySelector(".card-count");
            if (countEl) {
                countEl.textContent = `(${count}/13)`;
                countEl.classList.toggle("valid", count === 13);
                countEl.classList.toggle("invalid", count !== 13);
            }
            handContainer.classList.toggle("hand-complete", count === 13);

            const mobilePreview = document.getElementById(`mobile-preview-${hand}`);
            if (mobilePreview) {
                mobilePreview.classList.toggle("hand-complete", count === 13);
                const mobilePreviewCount = document.getElementById(`mobile-preview-count-${hand}`);
                if (mobilePreviewCount) mobilePreviewCount.textContent = `(${count}/13)`;

                const mobilePreviewCards = document.getElementById(`mobile-preview-cards-${hand}`);
                if (mobilePreviewCards) {
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
                                (a, b) =>
                                    RANKS.indexOf(a.dataset.rank) - RANKS.indexOf(b.dataset.rank)
                            );
                            const rankString = selectedRanks
                                .map((el) => el.dataset.rank)
                                .join(" ");
                            return `<div><span class="${SUIT_COLORS[suit]}">${SUITS[suit]}</span> ${rankString}</div>`;
                        })
                        .join("");
                    mobilePreviewCards.innerHTML = cardString;
                }
            }
        });
    }

    function attemptAutoComplete() {
        if (analysisMode === "single") return;
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
        incompleteHandContainer
            .querySelectorAll(".card-rank:not(.selected):not(.disabled)")
            .forEach((cardEl) => {
                cardEl.classList.add("selected");
            });
        updatePbnAndSync();
        updateCardCounts();
    }

    // --- モバイルエディタ ---
    function openMobileEditor(hand) {
        if (activeMobileHand === hand) {
            closeMobileEditor();
            return;
        }
        if (activeMobileHand) closeMobileEditor();
        activeMobileHand = hand;
        const handContainer = document.getElementById(`${hand}-container`);
        const placeholder = document.createElement("div");
        placeholder.id = `${hand}-placeholder`;
        if (handContainer) {
            handContainer.replaceWith(placeholder);
            mobileEditorContent.appendChild(handContainer);
        }
        if (translations.editHandTitle) {
            mobileEditorTitle.textContent = translations.editHandTitle.replace(
                "{hand}",
                translations[hand.toLowerCase()] || hand
            );
        }
        mobileHandEditor.classList.remove("d-none");
        const activePreview = document.getElementById(`mobile-preview-${hand}`);
        if (activePreview) activePreview.classList.add("active-editor");
    }

    function closeMobileEditor() {
        if (!activeMobileHand) return;
        const handContainer = mobileEditorContent.querySelector(".hand-container");
        const placeholder = document.getElementById(`${activeMobileHand}-placeholder`);
        if (handContainer && placeholder) placeholder.replaceWith(handContainer);
        mobileHandEditor.classList.add("d-none");
        const activePreview = document.getElementById(`mobile-preview-${activeMobileHand}`);
        if (activePreview) activePreview.classList.remove("active-editor");
        activeMobileHand = null;
    }

    // --- イベントハンドラ ---
    function handleCardClick(target) {
        if (target.classList.contains("disabled")) return;
        const hand = target.dataset.hand;
        const handContainer = document.getElementById(`${hand}-container`);
        if (!target.classList.contains("selected")) {
            if (handContainer.querySelectorAll(".card-rank.selected").length >= 13) {
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
                const otherCard = document.querySelector(
                    `#${otherHand}-container .card-rank[data-suit="${suit}"][data-rank="${rank}"]`
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
        if (!pbnString.startsWith("N:")) return;
        document
            .querySelectorAll(".card-rank")
            .forEach((el) => el.classList.remove("selected", "disabled"));
        const handsData = pbnString.substring(2).split(" ");
        if (handsData.length !== 4) return;
        const pbnOrder = ["north", "east", "south", "west"];
        const suitOrder = ["spades", "hearts", "diamonds", "clubs"];
        const allSelectedCards = new Set();
        handsData.forEach((handData, handIndex) => {
            const currentHand = pbnOrder[handIndex];
            const suits = handData.split(".");
            suits.forEach((suitData, suitIndex) => {
                const currentSuit = suitOrder[suitIndex];
                suitData
                    .toUpperCase()
                    .split("")
                    .forEach((rank) => {
                        if (rank === "-") return;
                        const cardEl = document.querySelector(
                            `#${currentHand}-container .card-rank[data-suit="${currentSuit}"][data-rank="${rank}"]`
                        );
                        if (cardEl) {
                            cardEl.classList.add("selected");
                            allSelectedCards.add(`${currentSuit}-${rank}`);
                        }
                    });
            });
        });
        document.querySelectorAll(".card-rank:not(.selected)").forEach((cardEl) => {
            if (allSelectedCards.has(`${cardEl.dataset.suit}-${cardEl.dataset.rank}`)) {
                cardEl.classList.add("disabled");
            }
        });
        updateCardCounts();
    }

    function runAnalysis() {
        const pbn = pbnInputDesktop.value.trim();
        if (!pbn) {
            showError((translations && translations.pbnEmptyError) || "PBN input is empty.");
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
        fetch("https://bridge-analyzer-backend-668564208605.asia-northeast1.run.app/api/analyse", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ pbn: pbn }),
        })
            .then((response) => {
                if (!response.ok)
                    return response.json().then((err) => {
                        throw new Error(err.error || `Server error: ${response.status}`);
                    });
                return response.json();
            })
            .then((data) => {
                loadingSpinner.classList.add("d-none");
                if (data.error) throw new Error(data.error);
                displayDoubleDummyResults(data.tricks);
            })
            .catch((error) => {
                loadingSpinner.classList.add("d-none");
                showError(`Analysis failed: ${error.message}`);
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
                if (!response.ok)
                    return response.json().then((err) => {
                        throw new Error(err.error || `Server error: ${response.status}`);
                    });
                return response.json();
            })
            .then((data) => {
                loadingSpinner.classList.add("d-none");
                if (data.error) throw new Error(data.error);
                displaySingleDummyResults(data.average_tricks, data.simulations_run);
            })
            .catch((error) => {
                loadingSpinner.classList.add("d-none");
                showError(`Analysis failed: ${error.message}`);
            });
    }

    // --- イベントリスナー設定 ---
    document.body.addEventListener("click", (e) => {
        if (e.target.matches(".card-rank")) handleCardClick(e.target);
    });
    mobileHandPreviews.addEventListener("click", (e) => {
        const preview = e.target.closest(".mobile-preview");
        if (preview && !preview.classList.contains("d-none"))
            openMobileEditor(preview.dataset.hand);
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
    document.querySelectorAll("[data-lang]").forEach((button) => {
        button.addEventListener("click", (e) => setLanguage(e.target.dataset.lang));
    });

    // --- UIヘルパー関数 ---
    function setAnalysisMode(mode) {
        analysisMode = mode;
        const isSingleDummy = mode === "single";
        ["east-container", "west-container", "mobile-preview-east", "mobile-preview-west"].forEach(
            (id) => {
                const el = document.getElementById(id);
                if (el) el.classList.toggle("d-none", isSingleDummy);
            }
        );
        ["simulations-container-desktop", "simulations-container-mobile"].forEach((id) => {
            const el = document.getElementById(id);
            if (el) el.classList.toggle("d-none", !isSingleDummy);
        });
        if (isSingleDummy) {
            ["east", "west"].forEach((hand) => {
                document
                    .querySelectorAll(`#${hand}-container .card-rank.selected`)
                    .forEach((card) => card.classList.remove("selected"));
            });
            document
                .querySelectorAll(".card-rank.disabled")
                .forEach((card) => card.classList.remove("disabled"));
            handlePbnInput(pbnInputDesktop.value);
        }
        updatePbnAndSync();
        updateCardCounts();
    }

    function displayDoubleDummyResults(tricks) {
        if (!tricks || !translations.hand) return;
        const table = document.createElement("table");
        table.className = "table table-bordered table-striped table-sm";
        const thead = document.createElement("thead");
        thead.innerHTML = `<tr><th>${translations.hand}</th><th>NT</th><th><span class="${SUIT_COLORS.spades}">♠</span></th><th><span class="${SUIT_COLORS.hearts}">♥</span></th><th><span class="${SUIT_COLORS.diamonds}">♦</span></th><th><span class="${SUIT_COLORS.clubs}">♣</span></th></tr>`;
        table.appendChild(thead);
        const tbody = document.createElement("tbody");
        ["North", "East", "South", "West"].forEach((hand) => {
            const row = document.createElement("tr");
            let rowHtml = `<td class="fw-bold">${translations[hand.toLowerCase()]}</td>`;
            ["No-Trump", "Spades", "Hearts", "Diamonds", "Clubs"].forEach((suit) => {
                rowHtml += `<td>${tricks[suit] ? tricks[suit][hand] : "-"}</td>`;
            });
            row.innerHTML = rowHtml;
            tbody.appendChild(row);
        });
        table.appendChild(tbody);
        resultsContainer.innerHTML = `<h5>${translations.resultsTitleDD}</h5>`;
        resultsContainer.appendChild(table);
    }

    function displaySingleDummyResults(avgTricks, simulationsRun) {
        if (!avgTricks || !translations.hand) return;
        const table = document.createElement("table");
        table.className = "table table-bordered table-striped table-sm";
        const thead = document.createElement("thead");
        thead.innerHTML = `<tr><th>${translations.hand}</th><th>NT</th><th><span class="${SUIT_COLORS.spades}">♠</span></th><th><span class="${SUIT_COLORS.hearts}">♥</span></th><th><span class="${SUIT_COLORS.diamonds}">♦</span></th><th><span class="${SUIT_COLORS.clubs}">♣</span></th></tr>`;
        table.appendChild(thead);
        const tbody = document.createElement("tbody");
        ["North", "South"].forEach((hand) => {
            const row = document.createElement("tr");
            let rowHtml = `<td class="fw-bold">${translations[hand.toLowerCase()]}</td>`;
            ["No-Trump", "Spades", "Hearts", "Diamonds", "Clubs"].forEach((suit) => {
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

    // --- 初期化処理 ---
    async function initialize() {
        const userLang =
            localStorage.getItem("userLanguage") ||
            (navigator.language.startsWith("ja") ? "ja" : "en");
        await setLanguage(userLang);
        createDesktopUI();
        createMobileUI();
        updatePbnAndSync();
        updateCardCounts();
        setAnalysisMode("double");
    }

    initialize();
});
