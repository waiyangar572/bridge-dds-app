document.addEventListener("DOMContentLoaded", () => {
    // --- Constants ---
    const API_BASE = "https://bridge-analyzer-backend-668564208605.asia-northeast1.run.app/api";
    const SUITS = [
        { id: "s", label: "♠", color: "suit-s", name: "Spades" },
        { id: "h", label: "♥", color: "suit-h", name: "Hearts" },
        { id: "d", label: "♦", color: "suit-d", name: "Diamonds" },
        { id: "c", label: "♣", color: "suit-c", name: "Clubs" },
    ];
    const RANKS = ["A", "K", "Q", "J", "T", "9", "8", "7", "6", "5", "4", "3", "2"];
    const HANDS = ["north", "west", "east", "south"];
    const DIRECTION_MAP = { North: "north", South: "south", East: "east", West: "west" };

    // --- State ---
    let currentTab = "double";
    let activeMobileHand = "north";
    // State for Double Dummy
    let ddState = { north: [], south: [], east: [], west: [] };
    // State for Lead Solver
    let leadState = { north: [], south: [], east: [], west: [] };
    // State for Single Dummy
    let sdState = { north: [], south: [] }; // Only N/S allow hand input
    let sdModes = { north: "hand", south: "hand" }; // 'hand' or 'feature'

    // --- Init ---
    lucide.createIcons();
    initDoubleDummyUI();
    initSingleDummyUI();
    initLeadSolverUI();
    setupEventListeners();

    // --- Tab Switching ---
    function switchTab(tabName) {
        currentTab = tabName;
        // Hide views
        ["double", "single", "lead"].forEach((t) => {
            document.getElementById("view-" + t).classList.add("hidden");
            const navBtn = document.getElementById("nav-" + t);
            if (navBtn) {
                navBtn.classList.replace("tab-active", "tab-inactive");
                navBtn.classList.remove("text-indigo-600", "border-indigo-600");
            }
        });

        // Show View
        document.getElementById("view-" + tabName).classList.remove("hidden");

        // Update Nav
        const activeNav = document.getElementById("nav-" + tabName);
        if (activeNav) {
            activeNav.classList.replace("tab-inactive", "tab-active");
            activeNav.classList.add("text-indigo-600", "border-indigo-600");
        }

        // Mobile Keyboard Logic
        const kb = document.getElementById("mobile-keyboard");
        if (tabName === "double") {
            if (window.innerWidth < 768) kb.classList.remove("translate-y-full");
        } else {
            kb.classList.add("translate-y-full");
        }
    }

    // --- Double Dummy Logic ---
    function initDoubleDummyUI() {
        renderCardInterface("container", toggleCardDD, ddState);
        renderMobileKeyboard();
        updateDDUI();
        setMobileActive("north");
    }

    // --- Single Dummy Logic ---
    function initSingleDummyUI() {
        renderCardInterface("sd-container", toggleCardSD, sdState, ["north", "south"]);
        updateSDUI();
        // Set default modes
        updateSDModeUI("north");
        updateSDModeUI("south");
    }

    function toggleSDMode(hand, mode) {
        sdModes[hand] = mode;
        updateSDModeUI(hand);
    }

    function updateSDModeUI(hand) {
        const mode = sdModes[hand];
        const panel = document.getElementById(`sd-mode-${mode}-${hand}`);
        const otherMode = mode === "hand" ? "feature" : "hand";
        const otherPanel = document.getElementById(`sd-mode-${otherMode}-${hand}`);

        if (panel) panel.classList.remove("hidden");
        if (otherPanel) otherPanel.classList.add("hidden");

        // Update Toggle Buttons Style
        const btns = document.querySelectorAll(`.sd-mode-switch[data-hand="${hand}"]`);
        btns.forEach((btn) => {
            if (btn.dataset.mode === mode) {
                btn.classList.add("bg-white", "text-indigo-600", "shadow-sm");
                btn.classList.remove("text-slate-500", "hover:text-slate-700");
            } else {
                btn.classList.remove("bg-white", "text-indigo-600", "shadow-sm");
                btn.classList.add("text-slate-500", "hover:text-slate-700");
            }
        });
    }

    function toggleCardSD(hand, cardId) {
        if (sdState[hand].includes(cardId)) {
            sdState[hand] = sdState[hand].filter((c) => c !== cardId);
        } else {
            if (sdState[hand].length >= 13) {
                showToast("13枚制限です");
                return;
            }
            sdState[hand].push(cardId);
        }
        updateSDUI();
    }

    function updateSDUI() {
        updateCardUI("sd-container", sdState, ["north", "south"]);
    }

    // --- Lead Solver Logic ---
    function initLeadSolverUI() {
        renderCardInterface("lead-container", toggleCardLead, leadState);
        updateLeadUI();
        updateLeadModeUI();
    }

    function updateLeadModeUI() {
        const leader = document.getElementById("lead-leader").value.toLowerCase(); // 'west', etc.

        HANDS.forEach((hand) => {
            const panel = document.getElementById(`lead-panel-${hand}`);
            const cardSelector = panel.querySelector(".lead-card-selector");
            const featureInput = panel.querySelector(".lead-feature-input");

            if (hand === leader) {
                cardSelector.classList.remove("hidden");
                featureInput.classList.add("hidden");
                panel.classList.add("border-indigo-300", "bg-indigo-50");
                panel.classList.remove("bg-white", "border-slate-200");
            } else {
                cardSelector.classList.add("hidden");
                featureInput.classList.remove("hidden");
                panel.classList.remove("border-indigo-300", "bg-indigo-50");
                panel.classList.add("bg-white", "border-slate-200");
            }
        });

        const mapping = { west: "South", east: "North", north: "East", south: "West" };
        document.getElementById("lead-declarer-display").innerText =
            mapping[leader] + " (自動設定)";
    }

    function toggleCardLead(hand, cardId) {
        if (leadState[hand].includes(cardId)) {
            leadState[hand] = leadState[hand].filter((c) => c !== cardId);
        } else {
            if (leadState[hand].length >= 13) {
                showToast("13枚制限です");
                return;
            }
            leadState[hand].push(cardId);
        }
        updateLeadUI();
    }

    function updateLeadUI() {
        updateCardUI("lead-container", leadState);
    }

    // --- Shared Card Rendering ---
    function renderCardInterface(
        containerPrefix,
        toggleCallback,
        stateObj,
        handsToRender = HANDS
    ) {
        handsToRender.forEach((hand) => {
            const container = document.getElementById(`${containerPrefix}-${hand}`);
            if (!container) return;
            container.innerHTML = "";

            SUITS.forEach((suit) => {
                const row = document.createElement("div");
                row.className = "flex items-center gap-1";

                const icon = document.createElement("div");
                icon.className = `w-5 font-bold ${suit.color} flex-shrink-0 text-center text-sm`;
                icon.innerHTML = suit.label;
                row.appendChild(icon);

                const btnWrapper = document.createElement("div");
                btnWrapper.className = "flex flex-wrap gap-0.5 flex-1";

                RANKS.forEach((rank) => {
                    const cardId = suit.id + rank;
                    const btn = document.createElement("div");
                    btn.id = `btn-${containerPrefix}-${hand}-${cardId}`;
                    btn.innerText = rank;
                    btn.className = "pc-rank-btn flex";
                    btn.onclick = (e) => {
                        e.stopPropagation();
                        toggleCallback(hand, cardId);
                    };
                    btnWrapper.appendChild(btn);
                });

                row.appendChild(btnWrapper);
                container.appendChild(row);
            });
        });
    }

    function updateCardUI(containerPrefix, stateObj, handsToRender = HANDS) {
        handsToRender.forEach((hand) => {
            // Update Badges
            // DD
            const ddBadge = document.querySelector(`#hand-${hand} .count-badge`);
            if (ddBadge && containerPrefix === "container") {
                ddBadge.innerText = stateObj[hand].length;
                if (stateObj[hand].length === 13)
                    ddBadge.classList.replace("bg-slate-400", "bg-emerald-500");
                else ddBadge.classList.replace("bg-emerald-500", "bg-slate-400");
            }
            // SD
            const sdBadge = document.querySelector(`#sd-mode-hand-${hand} .sd-count-badge`);
            if (sdBadge && containerPrefix === "sd-container") {
                sdBadge.innerText = `${stateObj[hand].length} / 13`;
                if (stateObj[hand].length === 13)
                    sdBadge.classList.replace("bg-slate-400", "bg-emerald-500");
                else sdBadge.classList.replace("bg-emerald-500", "bg-slate-400");
            }
            // Lead
            const leadBadge = document.querySelector(`#lead-panel-${hand} .lead-count-badge`);
            if (leadBadge && containerPrefix === "lead-container") {
                leadBadge.innerText = `${stateObj[hand].length} / 13`;
                if (stateObj[hand].length === 13)
                    leadBadge.classList.replace("bg-slate-400", "bg-emerald-500");
                else leadBadge.classList.replace("bg-emerald-500", "bg-slate-400");
            }

            const myCards = stateObj[hand];
            SUITS.forEach((suit) => {
                RANKS.forEach((rank) => {
                    const cardId = suit.id + rank;
                    const btn = document.getElementById(
                        `btn-${containerPrefix}-${hand}-${cardId}`
                    );
                    if (!btn) return;

                    btn.classList.remove("selected", "taken");
                    if (myCards.includes(cardId)) {
                        btn.classList.add("selected");
                    } else if (containerPrefix === "container") {
                        // For DD, show taken
                        if (findCardOwner(stateObj, cardId)) btn.classList.add("taken");
                    }
                });
            });
        });
    }

    // --- DD State Logic ---
    function toggleCardDD(hand, cardId) {
        const currentOwner = findCardOwner(ddState, cardId);
        if (currentOwner === hand) {
            ddState[hand] = ddState[hand].filter((c) => c !== cardId);
        } else if (currentOwner) {
            if (ddState[hand].length >= 13) {
                showToast("このハンドは既に13枚です");
                return;
            }
            ddState[currentOwner] = ddState[currentOwner].filter((c) => c !== cardId);
            ddState[hand].push(cardId);
        } else {
            if (ddState[hand].length >= 13) {
                showToast("13枚制限です");
                return;
            }
            ddState[hand].push(cardId);
        }
        updateDDUI();
    }

    function findCardOwner(stateObj, cardId) {
        for (let h of HANDS) if (stateObj[h].includes(cardId)) return h;
        return null;
    }

    function updateDDUI() {
        let total = 0;
        HANDS.forEach((h) => (total += ddState[h].length));
        document.getElementById("total-count").innerText = total;
        updateCardUI("container", ddState);

        HANDS.forEach((hand) => {
            SUITS.forEach((suit) => {
                const mobCards = ddState[hand]
                    .filter((c) => c.startsWith(suit.id))
                    .sort((a, b) => RANKS.indexOf(a.substr(1)) - RANKS.indexOf(b.substr(1)))
                    .map((c) => c.substr(1))
                    .join("");
                const mobText = document.getElementById(`mobile-text-${hand}-${suit.id}`);
                if (mobText) mobText.innerText = mobCards;
            });
        });

        SUITS.forEach((suit) => {
            RANKS.forEach((rank) => {
                const cardId = suit.id + rank;
                const mobBtn = document.getElementById(`mob-btn-${cardId}`);
                if (!mobBtn) return;
                const owner = findCardOwner(ddState, cardId);
                mobBtn.className =
                    "w-8 h-10 border rounded shadow-sm font-medium shrink-0 transition-colors ";
                if (owner === activeMobileHand)
                    mobBtn.classList.add("bg-indigo-600", "text-white", "border-indigo-600");
                else if (owner)
                    mobBtn.classList.add("bg-slate-100", "text-slate-300", "border-slate-100");
                else mobBtn.classList.add("bg-white", "text-slate-800", "border-slate-200");
            });
        });
    }

    function renderMobileKeyboard() {
        SUITS.forEach((suit) => {
            const container = document.getElementById(`mobile-keys-${suit.id}`);
            if (!container) return;
            const label = document.createElement("div");
            label.className = `w-8 h-10 flex items-center justify-center font-bold ${suit.color} bg-slate-50 border border-slate-200 rounded shrink-0 text-sm`;
            label.innerHTML = suit.label;
            container.appendChild(label);

            RANKS.forEach((rank) => {
                const cardId = suit.id + rank;
                const btn = document.createElement("button");
                btn.id = `mob-btn-${cardId}`;
                btn.innerText = rank;
                btn.className =
                    "w-8 h-10 bg-white border border-slate-200 rounded shadow-sm font-medium active:bg-slate-100 shrink-0 text-slate-700 transition-colors";
                btn.onclick = () => toggleCardDD(activeMobileHand, cardId);
                container.appendChild(btn);
            });
        });
    }

    function setMobileActive(hand) {
        activeMobileHand = hand;
        document.getElementById("mobile-active-label").innerText = `Editing: ${hand}`;
        HANDS.forEach((h) => {
            const el = document.getElementById(`hand-${h}`);
            if (!el) return;
            if (h === hand) {
                el.classList.add("hand-card-mobile-active");
                el.classList.remove("border-transparent");
            } else {
                el.classList.remove("hand-card-mobile-active");
                el.classList.add("border-transparent");
            }
        });
        updateDDUI();
    }

    function generatePBN(stateObj, isSingleDummy = false) {
        const handsOrder = ["north", "east", "south", "west"];
        const parts = [];
        handsOrder.forEach((hand) => {
            if (isSingleDummy && (hand === "east" || hand === "west")) {
                parts.push("...");
                return;
            }
            const handCards = stateObj[hand];
            const suitsStr = SUITS.map((suit) => {
                const cardsInSuit = handCards
                    .filter((c) => c.startsWith(suit.id))
                    .map((c) => c.substr(1))
                    .sort((a, b) => RANKS.indexOf(a) - RANKS.indexOf(b))
                    .join("");
                return cardsInSuit || "";
            }).join(".");
            parts.push(suitsStr);
        });
        return `N:${parts.join(" ")}`;
    }

    // --- API Calls ---
    async function runDoubleDummy() {
        let total = 0;
        HANDS.forEach((h) => (total += ddState[h].length));
        if (total !== 52) {
            showToast("カードが52枚選択されていません");
            return;
        }

        setLoading(true);
        try {
            const pbn = generatePBN(ddState);
            const res = await fetch(`${API_BASE}/analyse`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ pbn }),
            });
            const data = await res.json();
            if (data.error) throw new Error(data.error);
            renderDDResults(data.tricks);
        } catch (e) {
            showToast("Error: " + e.message);
        } finally {
            setLoading(false);
        }
    }

    async function runSingleDummy() {
        setLoading(true);
        try {
            // Build TCL
            const tclParts = [];
            // Build PBN Parts (For hand inputs)
            const pbnParts = { north: ".", south: ".", east: ".", west: "." };

            // Loop all hands to build constraints or PBN
            ["north", "south", "east", "west"].forEach((hand) => {
                // If it's N/S and mode is Hand
                if ((hand === "north" || hand === "south") && sdModes[hand] === "hand") {
                    // Build PBN part for this hand
                    if (sdState[hand].length === 13) {
                        const suitsStr = SUITS.map((suit) => {
                            return sdState[hand]
                                .filter((c) => c.startsWith(suit.id))
                                .map((c) => c.substr(1))
                                .sort((a, b) => RANKS.indexOf(a) - RANKS.indexOf(b))
                                .join("");
                        }).join(".");
                        pbnParts[hand] = suitsStr;
                    } else {
                        // If not 13 cards, treat as constraint? Or just fail?
                        // Let's assume user wants full hand if selected.
                        if (sdState[hand].length > 0)
                            throw new Error(`${hand}の手札が13枚ではありません`);
                        // if 0, treat as empty (unknown)
                    }
                } else {
                    // Feature Mode
                    const minH = document.getElementById(`sd-${hand}-hcp-min`).value || 0;
                    const maxH = document.getElementById(`sd-${hand}-hcp-max`).value || 37;
                    tclParts.push(`[hcp ${hand}] >= ${minH}`);
                    tclParts.push(`[hcp ${hand}] <= ${maxH}`);

                    const s = document.getElementById(`sd-${hand}-s`).value;
                    const h = document.getElementById(`sd-${hand}-h`).value;
                    const d = document.getElementById(`sd-${hand}-d`).value;
                    const c = document.getElementById(`sd-${hand}-c`).value;

                    const parseRange = (val, suitName) => {
                        if (!val) return;
                        if (val.includes("-")) {
                            const [min, max] = val.split("-");
                            tclParts.push(`[${suitName} ${hand}] >= ${min || 0}`);
                            tclParts.push(`[${suitName} ${hand}] <= ${max || 13}`);
                        } else {
                            tclParts.push(`[${suitName} ${hand}] == ${val}`);
                        }
                    };
                    parseRange(s, "spades");
                    parseRange(h, "hearts");
                    parseRange(d, "diamonds");
                    parseRange(c, "clubs");

                    const preset = document.getElementById(`sd-${hand}-preset`).value;
                    if (preset === "balanced") tclParts.push(`[balanced ${hand}]`);
                    if (preset === "semibalanced") tclParts.push(`[semibalanced ${hand}]`);
                    if (preset === "unbalanced")
                        tclParts.push(`!([balanced ${hand}] || [semibalanced ${hand}])`);
                }
            });

            const tclStr = `reject unless { ${tclParts.join(" && ")} }`;
            const finalPBN = `N:${pbnParts.north} ${pbnParts.east} ${pbnParts.south} ${pbnParts.west}`;

            const res = await fetch(`${API_BASE}/analyse_single_dummy`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    pbn: finalPBN,
                    advanced_tcl: tclStr,
                    simulations: 100,
                }),
            });
            const data = await res.json();
            if (data.error) throw new Error(data.error);
            renderSDResults(data.trick_distribution, data.simulations_run);
        } catch (e) {
            showToast("Error: " + e.message);
        } finally {
            setLoading(false);
        }
    }

    async function runLeadSolver() {
        const leader = document.getElementById("lead-leader").value;
        const leaderKey = leader.toLowerCase();

        const leaderCards = leadState[leaderKey];
        if (leaderCards.length !== 13) {
            showToast(`${leader}の手札は13枚である必要があります (現在: ${leaderCards.length}枚)`);
            return;
        }

        const suitsStr = SUITS.map((suit) => {
            const cardsInSuit = leaderCards
                .filter((c) => c.startsWith(suit.id))
                .map((c) => c.substr(1))
                .sort((a, b) => RANKS.indexOf(a) - RANKS.indexOf(b))
                .join("");
            return cardsInSuit || "";
        }).join(".");

        const level = document.getElementById("lead-level").value;
        const suit = document.getElementById("lead-suit").value;

        const requestData = {
            leader_hand_pbn: suitsStr,
            leader: leader[0],
            contract: `${level}${suit}`,
            shapes: {},
            hcp: {},
            shapePreset: {},
            simulations: 100,
        };

        HANDS.forEach((h) => {
            if (h !== leaderKey) {
                const minH = document.getElementById(`lead-${h}-hcp-min`).value || 0;
                const maxH = document.getElementById(`lead-${h}-hcp-max`).value || 37;
                requestData.hcp[h] = `${minH}-${maxH}`;

                const sVal = document.getElementById(`lead-${h}-s`).value || "0-13";
                const hVal = document.getElementById(`lead-${h}-h`).value || "0-13";
                const dVal = document.getElementById(`lead-${h}-d`).value || "0-13";
                const cVal = document.getElementById(`lead-${h}-c`).value || "0-13";
                requestData.shapes[h] = `${sVal},${hVal},${dVal},${cVal}`;

                const preset = document.getElementById(`lead-${h}-preset`).value;
                requestData.shapePreset[h] = preset === "any" ? "" : preset;
            }
        });

        setLoading(true);
        try {
            const res = await fetch(`${API_BASE}/solve_lead`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(requestData),
            });
            const data = await res.json();
            if (data.error) throw new Error(data.error);
            renderLeadResults(data.leads, data.simulations_run);
        } catch (e) {
            showToast("Error: " + e.message);
        } finally {
            setLoading(false);
        }
    }

    // --- Rendering Results ---
    function renderDDResults(tricks) {
        const tbody = document.getElementById("result-body-double");
        tbody.innerHTML = "";
        ["North", "South", "East", "West"].forEach((player) => {
            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td class="font-bold text-slate-700 bg-slate-50">${player}</td>
                <td class="font-bold text-indigo-700 bg-indigo-50">${tricks["No-Trump"][player]}</td>
                <td>${tricks["Spades"][player]}</td>
                <td>${tricks["Hearts"][player]}</td>
                <td>${tricks["Diamonds"][player]}</td>
                <td>${tricks["Clubs"][player]}</td>
            `;
            tbody.appendChild(tr);
        });
        document.getElementById("result-double").classList.remove("hidden");
        document.getElementById("result-double").scrollIntoView({ behavior: "smooth" });
    }

    function renderSDResults(distribution, count) {
        const container = document.getElementById("result-single-content");
        document.getElementById("sd-sim-count").innerText = `Samples: ${count}`;
        container.innerHTML = "";

        Object.keys(distribution).forEach((suit) => {
            const dist = distribution[suit];
            const div = document.createElement("div");
            div.innerHTML = `<h5 class="font-bold text-slate-700 mb-2">${suit}</h5>`;

            const table = document.createElement("table");
            table.className = "w-full result-table text-xs border";
            let headHtml = "<thead><tr><th>Pl</th>";
            for (let i = 0; i <= 13; i++) headHtml += `<th>${i}</th>`;
            headHtml += "</tr></thead>";

            let bodyHtml = "<tbody>";
            ["North", "South"].forEach((pl) => {
                bodyHtml += `<tr><td class="font-bold">${pl[0]}</td>`;
                dist[pl].forEach((pct, i) => {
                    const bg =
                        pct > 50 ? "bg-emerald-500 text-white" : pct > 10 ? "bg-emerald-100" : "";
                    bodyHtml += `<td class="${bg}">${pct > 0 ? Math.round(pct) : "."}</td>`;
                });
                bodyHtml += "</tr>";
            });
            bodyHtml += "</tbody>";

            table.innerHTML = headHtml + bodyHtml;
            div.appendChild(table);
            container.appendChild(div);
        });

        document.getElementById("result-single").classList.remove("hidden");
        document.getElementById("result-single").scrollIntoView({ behavior: "smooth" });
    }

    function renderLeadResults(leads, count) {
        const container = document.getElementById("result-lead-content");
        document.getElementById("lead-sim-count").innerText = count;
        container.innerHTML = "";

        leads.sort((a, b) => b.tricks - a.tricks);

        leads.forEach((lead) => {
            const suitChar = lead.card[0];
            const rankChar = lead.card[1];
            const suitInfo = SUITS.find((s) => s.name[0] === suitChar) || {
                color: "text-black",
                label: suitChar,
            };

            let barHtml =
                '<div class="h-6 w-full bg-slate-100 rounded-full flex overflow-hidden font-bold text-white text-[10px] leading-6 mt-2">';
            const colors = [
                "bg-slate-300",
                "bg-orange-200",
                "bg-orange-300",
                "bg-orange-400",
                "bg-orange-500",
                "bg-orange-600",
            ];

            const dist = lead.per_of_trick;
            const total = dist.reduce((a, b) => a + b, 0);

            dist.forEach((count, tricks) => {
                if (count === 0) return;
                const pct = (count / total) * 100;
                if (pct < 3) return;
                const colorClass = tricks === 0 ? colors[0] : colors[Math.min(tricks, 5)];
                barHtml += `<div style="width: ${pct}%" class="${colorClass} text-center shadow-[inset_-1px_0_0_rgba(0,0,0,0.1)]" title="${tricks} Tricks: ${Math.round(
                    pct
                )}%">${tricks}</div>`;
            });
            barHtml += "</div>";

            const row = document.createElement("div");
            row.className = "group border-b border-slate-100 pb-4 last:border-0";
            row.innerHTML = `
                <div class="flex justify-between items-end mb-1">
                    <div class="flex items-baseline gap-2">
                        <span class="font-bold text-xl ${suitInfo.color} w-8">${
                suitInfo.label
            }${rankChar}</span>
                        <span class="text-xs font-bold text-slate-400">Exp: ${lead.tricks.toFixed(
                            2
                        )}</span>
                    </div>
                    <div class="text-xs text-orange-600 font-bold">Set: ${lead.per_of_set.toFixed(
                        1
                    )}%</div>
                </div>
                ${barHtml}
            `;
            container.appendChild(row);
        });

        document.getElementById("result-lead").classList.remove("hidden");
        document.getElementById("result-lead").scrollIntoView({ behavior: "smooth" });
    }

    // --- Helpers ---
    function showToast(msg) {
        const el = document.getElementById("toast");
        document.getElementById("toast-msg").innerText = msg;
        el.classList.remove("translate-x-full", "opacity-0");
        setTimeout(() => el.classList.add("translate-x-full", "opacity-0"), 3000);
    }

    function setLoading(isLoading) {
        const el = document.getElementById("loading-overlay");
        if (isLoading) el.classList.remove("hidden");
        else el.classList.add("hidden");
    }

    function setupEventListeners() {
        // Tabs
        document.getElementById("nav-double").onclick = () => switchTab("double");
        document.getElementById("nav-single").onclick = () => switchTab("single");
        document.getElementById("nav-lead").onclick = () => switchTab("lead");

        // Mobile Nav
        document.getElementById("mobile-menu-btn").onclick = () => {
            document.getElementById("mobile-nav").classList.toggle("hidden");
        };
        document.getElementById("mob-nav-double").onclick = () => switchTab("double");
        document.getElementById("mob-nav-single").onclick = () => switchTab("single");
        document.getElementById("mob-nav-lead").onclick = () => switchTab("lead");

        // Mobile Hand Focus
        HANDS.forEach((h) => {
            const el = document.getElementById(`hand-${h}`);
            if (el) el.onclick = () => setMobileActive(h);
        });

        // SD Mode Switches
        document.querySelectorAll(".sd-mode-switch").forEach((btn) => {
            btn.onclick = (e) => toggleSDMode(e.target.dataset.hand, e.target.dataset.mode);
        });

        // Run Buttons
        document.getElementById("btn-run-double").onclick = runDoubleDummy;
        document.getElementById("btn-run-single").onclick = runSingleDummy;
        document.getElementById("btn-run-lead").onclick = runLeadSolver;

        // Lead UI Update Event
        document.getElementById("lead-leader").onchange = updateLeadModeUI;
    }
});
