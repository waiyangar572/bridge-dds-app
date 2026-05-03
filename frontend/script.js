document.addEventListener("DOMContentLoaded", () => {
    window.__PRERENDER_READY__ = false;

    // --- Constants ---
    const API_BASE = "https://bridge-analyzer-backend-338315263430.asia-northeast1.run.app/api";

    const SITE_ORIGIN = "https://bridge-solver.waiyangar.com";
    const DEFAULT_OG_IMAGE = `${SITE_ORIGIN}/favicon-96x96.png`;
    const WEBSITE_NAME = "Bridge Solver";
    const SUPPORTED_LANGS = ["en", "ja"];
    const DEFAULT_ROUTE = "/double-dummy";
    const LANGUAGE_STORAGE_KEY = "bridge_solver_lang";
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
    // State for Double Dummy
    let ddState = { north: [], south: [], east: [], west: [] };
    // State for Lead Solver
    let leadState = { north: [], south: [], east: [], west: [] };
    // State for Single Dummy
    let sdState = { north: [], south: [] }; // Only N/S allow hand input
    let sdModes = { north: "hand", south: "hand" }; // 'hand' or 'feature'
    let currentLanguage = "en";
    let translations = {};
    let currentRoutePath = DEFAULT_ROUTE;
    let leadSortMode = "tricks";
    let latestLeadResults = [];
    let latestLeadCount = 0;
    let referenceViewTab = "probability";
    const IMP_SCALE_ROWS = [
        { min: 0, max: 10, imp: 0 },
        { min: 20, max: 40, imp: 1 },
        { min: 50, max: 80, imp: 2 },
        { min: 90, max: 120, imp: 3 },
        { min: 130, max: 160, imp: 4 },
        { min: 170, max: 210, imp: 5 },
        { min: 220, max: 260, imp: 6 },
        { min: 270, max: 310, imp: 7 },
        { min: 320, max: 360, imp: 8 },
        { min: 370, max: 420, imp: 9 },
        { min: 430, max: 490, imp: 10 },
        { min: 500, max: 590, imp: 11 },
        { min: 600, max: 740, imp: 12 },
        { min: 750, max: 890, imp: 13 },
        { min: 900, max: 1090, imp: 14 },
        { min: 1100, max: 1290, imp: 15 },
        { min: 1300, max: 1490, imp: 16 },
        { min: 1500, max: 1740, imp: 17 },
        { min: 1750, max: 1990, imp: 18 },
        { min: 2000, max: 2240, imp: 19 },
        { min: 2250, max: 2490, imp: 20 },
        { min: 2500, max: 2990, imp: 21 },
        { min: 3000, max: 3490, imp: 22 },
        { min: 3500, max: 3990, imp: 23 },
        { min: 4000, max: null, imp: 24 },
    ];
    let vpBoardCount = 16;

    const NAV_KEYS = ["double", "single", "lead", "solver", "probability"];
    const VIEW_IDS = [
        "view-double",
        "view-single",
        "view-lead",
        "view-probability",
        "view-privacy",
        "view-about",
        "view-contact",
    ];
    const ROUTES = {
        "/double-dummy": {
            type: "tool",
            metaKey: "double-dummy",
            tab: "double",
            nav: "double",
            viewId: "view-double",
        },
        "/single-dummy": {
            type: "tool",
            metaKey: "single-dummy",
            tab: "single",
            nav: "single",
            viewId: "view-single",
        },
        "/opening-lead": {
            type: "tool",
            metaKey: "opening-lead",
            tab: "lead",
            nav: "lead",
            viewId: "view-lead",
        },
        "/reference/probability": {
            type: "tool",
            metaKey: "probability",
            tab: "probability",
            nav: "probability",
            viewId: "view-probability",
            referenceTab: "probability",
        },
        "/reference/imp": {
            type: "tool",
            metaKey: "imp",
            tab: "probability",
            nav: "probability",
            viewId: "view-probability",
            referenceTab: "imp",
        },
        "/probability-solver": {
            type: "tool",
            metaKey: "probability-solver",
            tab: "probability",
            nav: "solver",
            viewId: "view-probability",
            probabilityMode: "solver",
        },
        "/reference/vp": {
            type: "tool",
            metaKey: "vp",
            tab: "probability",
            nav: "probability",
            viewId: "view-probability",
            referenceTab: "vp",
        },
        "/probability": {
            path: "/reference/probability",
            type: "tool",
            metaKey: "probability",
            tab: "probability",
            nav: "probability",
            viewId: "view-probability",
            referenceTab: "probability",
        },
        "/privacy": {
            type: "page",
            metaKey: "privacy",
            viewId: "view-privacy",
        },
        "/about": {
            type: "page",
            metaKey: "about",
            viewId: "view-about",
        },
        "/contact": {
            type: "page",
            metaKey: "contact",
            viewId: "view-contact",
        },
    };

    // --- Init ---
    lucide.createIcons();
    if (document.getElementById("view-double")) {
        initDoubleDummyUI();
        initSingleDummyUI();
        initLeadSolverUI();
        initProbabilityUI();
    }
    initShapePresetMajorToggles();
    setupEventListeners();
    bootstrapApp();

    function markPrerenderReady() {
        window.__PRERENDER_READY__ = true;
        document.documentElement.dataset.prerenderReady = "true";
        window.dispatchEvent(new Event("bridge:route-ready"));
    }

    function getNestedValue(obj, path) {
        return path
            .split(".")
            .reduce((acc, key) => (acc && acc[key] !== undefined ? acc[key] : undefined), obj);
    }

    function tr(key, fallback = "", vars = {}) {
        let value = getNestedValue(translations, key);
        if (value === undefined) value = fallback || key;
        if (typeof value !== "string") return value;
        return value.replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? vars[k] : `{${k}}`));
    }

    function detectBrowserLanguage() {
        const browserLang = (navigator.language || "en").toLowerCase();
        return browserLang.startsWith("ja") ? "ja" : "en";
    }

    function getStoredLanguage() {
        const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
        if (SUPPORTED_LANGS.includes(stored)) return stored;
        return null;
    }

    function getPreferredLanguage() {
        return getStoredLanguage() || detectBrowserLanguage();
    }

    async function loadTranslations(lang) {
        const normalized = SUPPORTED_LANGS.includes(lang) ? lang : "en";
        const res = await fetch(`/locales/${normalized}.json`, { cache: "no-cache" });
        if (!res.ok) throw new Error(`Locale file not found: ${normalized}`);
        return res.json();
    }

    function updateLanguageSwitcherUI() {
        const isEn = currentLanguage === "en";
        const ids = [
            { id: "lang-en", active: isEn },
            { id: "lang-ja", active: !isEn },
            { id: "lang-en-mobile", active: isEn },
            { id: "lang-ja-mobile", active: !isEn },
        ];
        ids.forEach(({ id, active }) => {
            const btn = document.getElementById(id);
            if (!btn) return;
            btn.classList.toggle("bg-indigo-600", active);
            btn.classList.toggle("text-white", active);
            btn.classList.toggle("text-slate-600", !active);
        });
    }

    function setNodeText(selector, text) {
        const node = document.querySelector(selector);
        if (!node) return;
        node.textContent = text;
    }

    function setNodeTexts(selector, texts = []) {
        const nodes = document.querySelectorAll(selector);
        nodes.forEach((node, idx) => {
            if (texts[idx] !== undefined) node.textContent = texts[idx];
        });
    }

    function applyTranslations() {
        document.documentElement.lang = currentLanguage;
        updateLanguageSwitcherUI();

        setNodeText("#site-title", tr("site.title", "Bridge Solver"));
        setNodeText("#nav-double", tr("nav.double", "Double Dummy"));
        setNodeText("#nav-single", tr("nav.single", "Single Dummy"));
        setNodeText("#nav-lead", tr("nav.lead", "Opening Lead"));
        setNodeText("#nav-solver", tr("nav.solver", "Probability Solver"));
        setNodeText("#nav-probability", tr("nav.probability", "Reference"));
        setNodeText("#mob-nav-double", tr("nav.double", "Double Dummy"));
        setNodeText("#mob-nav-single", tr("nav.single", "Single Dummy"));
        setNodeText("#mob-nav-lead", tr("nav.lead", "Opening Lead"));
        setNodeText("#mob-nav-solver", tr("nav.solver", "Probability Solver"));
        setNodeText("#mob-nav-probability", tr("nav.probability", "Reference"));
        setNodeText("#btn-run-double-text", tr("buttons.analyze", "Analyze"));
        setNodeText("#btn-run-single-text", tr("buttons.analyze", "Analyze"));
        setNodeText("#btn-run-lead-text", tr("buttons.analyze", "Analyze"));
        setNodeText("#mobile-analyze-text", tr("buttons.mobileAnalyze", "Analyze"));
        setNodeText("#loading-label", currentLanguage === "ja" ? "解析中..." : "Analyzing...");
        setNodeText("#result-double h3", tr("result.doubleTitle", "Double Dummy Result"));
        setNodeText("#result-single h3", tr("result.singleTitle", "Expected Tricks (N/S)"));
        setNodeText("#result-lead h3", tr("result.leadTitle", "Trick Distribution by Lead"));
        setNodeText("#lead-basic-title", tr("ui.leadBasicTitle", "Basic Settings"));
        setNodeText("#lead-leader-label", tr("ui.leadLeader", "Opening Leader"));
        setNodeText("#lead-contract-label", tr("ui.contract", "Contract"));
        setNodeText("#lead-declarer-label", tr("ui.declarer", "Declarer"));
        setNodeText("#lead-simulations-label", tr("ui.simulations", "Simulations"));
        setNodeText("#lead-advanced-tcl-label", tr("ui.advancedTcl", "Advanced TCL (Optional)"));
        setNodeText("#lead-sort-label", tr("ui.sortBy", "Sort"));
        setNodeText("#lead-sort-tricks", tr("ui.expTricks", "Exp Tricks"));
        setNodeText("#lead-sort-setprob", tr("ui.setProb", "Set Prob"));
        setNodeText("#probability-title", tr("probability.title", "Bridge Reference"));
        setNodeText(
            "#probability-lead",
            tr("probability.lead", "Switch between probability, IMP, and VP quick references."),
        );
        setNodeText(
            "#reference-tab-probability",
            tr("probability.tabs.probability", "Probability Table"),
        );
        setNodeText("#reference-tab-imp", tr("probability.tabs.imp", "IMP Scale"));
        setNodeText("#reference-tab-vp", tr("probability.tabs.vp", "VP Scale"));
        setNodeText(
            "#prob-suit-title",
            tr("probability.suit.title", "Suit distribution probability"),
        );
        setNodeText(
            "#prob-suit-help",
            tr(
                "probability.suit.help",
                "Shows opponent split probabilities grouped by fit length.",
            ),
        );
        setNodeText(
            "#prob-hcp-title",
            tr("probability.hcp.title", "HCP distribution probability"),
        );
        setNodeText(
            "#prob-hcp-help",
            tr(
                "probability.hcp.help",
                "Shows the probability for each HCP total in a random 13-card hand.",
            ),
        );
        setNodeText(
            "#prob-shape-title",
            tr("probability.shape.title", "Shape distribution probability"),
        );
        setNodeText(
            "#prob-shape-help",
            tr(
                "probability.shape.help",
                "Shows suit-order-independent shape probabilities for a random 13-card hand.",
            ),
        );
        setNodeText(
            "#prob-finesse-title",
            tr("probability.qdrop.title", "Q-drop cashing probability"),
        );
        setNodeText(
            "#prob-finesse-help",
            tr(
                "probability.qdrop.help",
                "Probability of taking all tricks by cashing when Q is missing.",
            ),
        );
        setNodeText(
            "#prob-qdrop-click-hint",
            tr(
                "probability.qdrop.compareHint",
                "Click a fit row to open line comparison in a dialog.",
            ),
        );
        setNodeText("#imp-title", tr("probability.imp.title", "IMP scale"));
        setNodeText("#imp-help", tr("probability.imp.help", "Convert score difference to IMPs."));
        setNodeText("#vp-title", tr("probability.vp.title", "VP scale"));
        setNodeText(
            "#vp-help",
            tr("probability.vp.help", "Check VP pair values by individual IMP difference."),
        );
        setNodeText("#vp-boards-label", tr("probability.vp.boardsLabel", "Boards"));
        setNodeText(
            "#cond-compare-title",
            tr("probability.conditional.compareEvents", "Compare events"),
        );
        setNodeText("#cond-add-query", tr("probability.conditional.add", "Add"));
        setNodeText(
            "#cond-run",
            tr("probability.conditional.calculateExact", "Calculate exact probability"),
        );

        setNodeTexts("#view-double section h3, #view-single section h3, #view-lead section h3", [
            currentLanguage === "ja"
                ? "このツールについて (Overview)"
                : "About this tool (Overview)",
            currentLanguage === "ja"
                ? "このツールについて (Overview)"
                : "About this tool (Overview)",
            currentLanguage === "ja"
                ? "このツールについて (Overview)"
                : "About this tool (Overview)",
        ]);
        setNodeTexts("#view-double section h4, #view-single section h4, #view-lead section h4", [
            currentLanguage === "ja" ? "使い方 (How to use)" : "How to use",
            currentLanguage === "ja" ? "用語解説 (Glossary)" : "Glossary",
            currentLanguage === "ja" ? "使い方 (How to use)" : "How to use",
            currentLanguage === "ja" ? "用語解説 (Glossary)" : "Glossary",
            currentLanguage === "ja" ? "使い方 (How to use)" : "How to use",
            currentLanguage === "ja" ? "用語解説 (Glossary)" : "Glossary",
        ]);
        setNodeText("#view-double section p", tr("content.double.overview", ""));
        setNodeTexts("#view-double section ol li", tr("content.double.how", []));
        setNodeTexts("#view-double section dl dd", tr("content.double.glossary", []));
        setNodeText("#view-single section p", tr("content.single.overview", ""));
        setNodeTexts("#view-single section ol li", tr("content.single.how", []));
        setNodeTexts("#view-single section dl dd", tr("content.single.glossary", []));
        setNodeText("#view-lead section p", tr("content.lead.overview", ""));
        setNodeTexts("#view-lead section ol li", tr("content.lead.how", []));
        setNodeTexts("#view-lead section dl dd", tr("content.lead.glossary", []));
        setNodeTexts("#view-privacy .space-y-4 p", tr("content.privacy", []));
        setNodeTexts("#view-about .space-y-4 p", tr("content.about", []));

        setNodeText("#view-privacy h2", tr("pages.privacyTitle", "Privacy Policy"));
        setNodeText("#view-about h2", tr("pages.aboutTitle", "About Us"));
        setNodeText("#view-contact h2", tr("pages.contactTitle", "Contact"));
        setNodeText("#view-contact p.text-sm", tr("pages.contactLead", ""));
        setNodeText("#view-contact a", tr("pages.contactButton", ""));
        setNodeText("#view-contact p.text-xs", tr("pages.contactNote", ""));

        setNodeText("footer h4:nth-of-type(1)", tr("footer.tools", "Tools"));
        setNodeText("footer h4:nth-of-type(2)", tr("footer.info", "Information"));
        setNodeText("footer .text-sm.leading-relaxed", tr("footer.description", ""));
        setNodeTexts("footer .space-y-2.text-sm a", [
            tr("nav.double", "Double Dummy"),
            tr("nav.single", "Single Dummy"),
            tr("nav.lead", "Opening Lead"),
            tr("nav.probability", "Reference"),
            tr("footer.privacy", "Privacy Policy"),
            tr("footer.about", "About Us"),
            tr("footer.contact", "Contact"),
        ]);

        document
            .querySelectorAll('option[value="any"]')
            .forEach((el) => (el.textContent = tr("select.any", "Any")));
        document
            .querySelectorAll('option[value="balanced"]')
            .forEach((el) => (el.textContent = tr("select.balanced", "Balanced")));
        document
            .querySelectorAll('option[value="semiBalanced"]')
            .forEach((el) => (el.textContent = tr("select.semiBalanced", "Semi-balanced")));
        document
            .querySelectorAll('option[value="unbalanced"]')
            .forEach((el) => (el.textContent = tr("select.unbalanced", "Unbalanced")));
        document
            .querySelectorAll(".shape-major-label")
            .forEach((el) => (el.textContent = tr("select.fiveCardMajor", "5-card major")));
        document
            .querySelectorAll('.shape-major-btn[data-allow="yes"]')
            .forEach((el) => (el.textContent = tr("select.yes", "Yes")));
        document
            .querySelectorAll('.shape-major-btn[data-allow="no"]')
            .forEach((el) => (el.textContent = tr("select.no", "No")));
        setNodeText("#glossary-double-term-1", tr("glossaryTerms.double1", "Double Dummy"));
        setNodeText("#glossary-single-term-1", tr("glossaryTerms.single1", "Balanced Hand"));
        setNodeText("#glossary-single-term-2", tr("glossaryTerms.single2", "Semi-balanced Hand"));
        setNodeText("#glossary-lead-term-1", tr("glossaryTerms.lead1", "Balanced Hand"));
        setNodeText("#glossary-lead-term-2", tr("glossaryTerms.lead2", "Semi-balanced Hand"));
        setNodeText("#glossary-lead-term-3", tr("glossaryTerms.lead3", "Set Probability"));

        updateProbabilitySuitResult();
        updateProbabilityHcpResult();
        updateProbabilityShapeResult();
        updateProbabilityQDropResult();
        updateImpScaleResult();
        setVpBoardCount(vpBoardCount);
        updateReferenceTabUI();
    }

    function upsertLink(rel, href, attrs = {}) {
        let link = document.querySelector(`link[rel="${rel}"][data-seo="${rel}"]`);
        if (!link) {
            link = document.createElement("link");
            link.rel = rel;
            link.dataset.seo = rel;
            document.head.appendChild(link);
        }
        link.href = href;
        Object.entries(attrs).forEach(([key, value]) => {
            link.setAttribute(key, value);
        });
    }

    function upsertMetaByName(name, content) {
        let meta = document.querySelector(`meta[name="${name}"]`);
        if (!meta) {
            meta = document.createElement("meta");
            meta.setAttribute("name", name);
            document.head.appendChild(meta);
        }
        meta.setAttribute("content", content);
    }

    function upsertMetaByProperty(property, content) {
        let meta = document.querySelector(`meta[property="${property}"]`);
        if (!meta) {
            meta = document.createElement("meta");
            meta.setAttribute("property", property);
            document.head.appendChild(meta);
        }
        meta.setAttribute("content", content);
    }

    function getSchemaPageType(route) {
        if (route.metaKey === "about") return "AboutPage";
        if (route.metaKey === "contact") return "ContactPage";
        if (route.metaKey === "privacy") return "PrivacyPolicy";
        if (
            route.metaKey === "probability" ||
            route.metaKey === "probability-solver" ||
            route.metaKey === "imp" ||
            route.metaKey === "vp"
        ) {
            return "CollectionPage";
        }
        return "WebPage";
    }

    function getRouteLabel(route) {
        if (route.metaKey === "double-dummy") return tr("nav.double", "Double Dummy");
        if (route.metaKey === "single-dummy") return tr("nav.single", "Single Dummy");
        if (route.metaKey === "opening-lead") return tr("nav.lead", "Opening Lead");
        if (route.metaKey === "probability") {
            return tr("probability.tabs.probability", "Probability Table");
        }
        if (route.metaKey === "probability-solver") {
            return tr("probability.conditional.title", "Conditional probability");
        }
        if (route.metaKey === "imp") return tr("probability.tabs.imp", "IMP Scale");
        if (route.metaKey === "vp") return tr("probability.tabs.vp", "VP Scale");
        if (route.metaKey === "privacy") return tr("pages.privacyTitle", "Privacy Policy");
        if (route.metaKey === "about") return tr("pages.aboutTitle", "About Us");
        if (route.metaKey === "contact") return tr("pages.contactTitle", "Contact");
        return WEBSITE_NAME;
    }

    function buildBreadcrumbList(route, canonicalUrl) {
        const itemListElement = [
            {
                "@type": "ListItem",
                position: 1,
                name: WEBSITE_NAME,
                item: `${SITE_ORIGIN}${buildLocalizedPath(currentLanguage, DEFAULT_ROUTE)}`,
            },
        ];

        if (route.path !== DEFAULT_ROUTE) {
            itemListElement.push({
                "@type": "ListItem",
                position: 2,
                name: getRouteLabel(route),
                item: canonicalUrl,
            });
        }

        return {
            "@type": "BreadcrumbList",
            "@id": `${canonicalUrl}#breadcrumb`,
            itemListElement,
        };
    }

    function setJsonLd(routePath, title, description, canonicalUrl, keywords = "") {
        const route = ROUTES[routePath] || ROUTES[DEFAULT_ROUTE];
        let script = document.getElementById("seo-json-ld");
        if (!script) {
            script = document.createElement("script");
            script.id = "seo-json-ld";
            script.type = "application/ld+json";
            document.head.appendChild(script);
        }

        const websiteId = `${SITE_ORIGIN}/#website`;
        const webpageId = `${canonicalUrl}#webpage`;
        const graph = [
            {
                "@type": "WebSite",
                "@id": websiteId,
                name: WEBSITE_NAME,
                url: `${SITE_ORIGIN}/`,
                inLanguage: currentLanguage,
            },
            {
                "@type": getSchemaPageType(route),
                "@id": webpageId,
                url: canonicalUrl,
                name: title,
                description,
                inLanguage: currentLanguage,
                isPartOf: { "@id": websiteId },
                breadcrumb: { "@id": `${canonicalUrl}#breadcrumb` },
                keywords,
            },
            buildBreadcrumbList(route, canonicalUrl),
        ];

        if (route.type === "tool") {
            graph.push({
                "@type": "SoftwareApplication",
                "@id": `${canonicalUrl}#software`,
                name: title,
                description,
                url: canonicalUrl,
                inLanguage: currentLanguage,
                applicationCategory: "GameApplication",
                applicationSubCategory: "Bridge analysis tool",
                operatingSystem: "Web",
                offers: {
                    "@type": "Offer",
                    price: "0",
                    priceCurrency: "USD",
                },
                isAccessibleForFree: true,
                browserRequirements: "Requires JavaScript. Works on modern browsers.",
            });
            graph[1].mainEntity = { "@id": `${canonicalUrl}#software` };
        }

        script.textContent = JSON.stringify({
            "@context": "https://schema.org",
            "@graph": graph,
        });
    }

    function setSeoMeta(routePath) {
        const route = ROUTES[routePath] || ROUTES[DEFAULT_ROUTE];
        const title = tr(`meta.${route.metaKey}.title`, "Bridge Solver");
        const description = tr(
            `meta.${route.metaKey}.description`,
            "Contract bridge analysis tools.",
        );
        const keywords = tr(
            `meta.${route.metaKey}.keywords`,
            "bridge solver, contract bridge, double dummy, single dummy, opening lead, probability table, IMP scale, VP scale",
        );
        const localizedPath = buildLocalizedPath(currentLanguage, route.path || routePath);
        const canonicalUrl = `${SITE_ORIGIN}${localizedPath}`;

        setMeta(title, description);
        upsertLink("canonical", canonicalUrl);
        upsertMetaByName(
            "robots",
            "index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1",
        );
        upsertMetaByName("keywords", keywords);
        upsertMetaByProperty("og:title", title);
        upsertMetaByProperty("og:description", description);
        upsertMetaByProperty("og:type", "website");
        upsertMetaByProperty("og:url", canonicalUrl);
        upsertMetaByProperty("og:image", DEFAULT_OG_IMAGE);
        upsertMetaByProperty("og:locale", currentLanguage === "ja" ? "ja_JP" : "en_US");
        upsertMetaByProperty("og:locale:alternate", currentLanguage === "ja" ? "en_US" : "ja_JP");
        upsertMetaByName("twitter:card", "summary_large_image");
        upsertMetaByName("twitter:title", title);
        upsertMetaByName("twitter:description", description);
        upsertMetaByName("twitter:image", DEFAULT_OG_IMAGE);
        upsertMetaByProperty("og:site_name", WEBSITE_NAME);
        setJsonLd(route.path || routePath, title, description, canonicalUrl, keywords);
        setAlternateLinks(route.path || routePath);
    }

    function setAlternateLinks(routePath) {
        document
            .querySelectorAll('link[rel="alternate"][data-hreflang="true"]')
            .forEach((node) => node.remove());
        const head = document.head;
        ["en", "ja"].forEach((lang) => {
            const link = document.createElement("link");
            link.rel = "alternate";
            link.hreflang = lang;
            link.href = `${SITE_ORIGIN}${buildLocalizedPath(lang, routePath)}`;
            link.dataset.hreflang = "true";
            head.appendChild(link);
        });
        const xDefault = document.createElement("link");
        xDefault.rel = "alternate";
        xDefault.hreflang = "x-default";
        xDefault.href = `${SITE_ORIGIN}${buildLocalizedPath("en", routePath)}`;
        xDefault.dataset.hreflang = "true";
        head.appendChild(xDefault);
    }

    async function setLanguage(lang, { persist = true, refreshUI = true } = {}) {
        const normalized = SUPPORTED_LANGS.includes(lang) ? lang : "en";
        currentLanguage = normalized;
        translations = await loadTranslations(normalized);
        if (persist) localStorage.setItem(LANGUAGE_STORAGE_KEY, normalized);
        if (refreshUI) {
            applyTranslations();
            setSeoMeta(currentRoutePath);
        }
    }

    window.getLanguage = getPreferredLanguage;
    window.loadLanguage = async (lang) => {
        await setLanguage(lang, { persist: true, refreshUI: true });
    };
    window.setupLanguageSwitcher = () => {};

    // --- Tab Switching ---
    function switchTab(tabName) {
        currentTab = tabName;
        // Hide tool views
        ["double", "single", "lead", "probability"].forEach((t) => {
            const view = document.getElementById("view-" + t);
            if (view) view.classList.add("hidden");

            const navBtn = document.getElementById("nav-" + t);
            if (navBtn) {
                navBtn.classList.replace("tab-active", "tab-inactive");
                navBtn.classList.remove("text-indigo-600", "border-indigo-600");
            }

            // Mobile Nav Reset
            const mobNavBtn = document.getElementById("mob-nav-" + t);
            if (mobNavBtn) {
                mobNavBtn.classList.remove("text-indigo-600");
                mobNavBtn.classList.add("text-slate-600");
            }
        });

        // Show View
        const activeView = document.getElementById("view-" + tabName);
        if (activeView) activeView.classList.remove("hidden");

        // Update Nav
        const activeNav = document.getElementById("nav-" + tabName);
        if (activeNav) {
            activeNav.classList.replace("tab-inactive", "tab-active");
            activeNav.classList.add("text-indigo-600", "border-indigo-600");
        }

        // Update Mobile Nav
        const activeMobNav = document.getElementById("mob-nav-" + tabName);
        if (activeMobNav) {
            activeMobNav.classList.remove("text-slate-600");
            activeMobNav.classList.add("text-indigo-600");
        }
    }

    function setMeta(title, description) {
        document.title = title;
        let metaDescription = document.querySelector('meta[name="description"]');
        if (!metaDescription) {
            metaDescription = document.createElement("meta");
            metaDescription.setAttribute("name", "description");
            document.head.appendChild(metaDescription);
        }
        metaDescription.setAttribute("content", description);
    }

    function normalizePath(path) {
        if (!path) return "/";
        return path.endsWith("/") && path !== "/" ? path.slice(0, -1) : path;
    }

    function buildLocalizedPath(lang, routePath) {
        const basePath = routePath === "/" ? DEFAULT_ROUTE : routePath;
        return `/${lang}${basePath}`;
    }

    function parseLocalizedPath(pathname) {
        const normalized = normalizePath(pathname);
        const parts = normalized.split("/").filter(Boolean);
        if (parts.length === 0) {
            return { lang: null, routePath: DEFAULT_ROUTE, hasLangPrefix: false };
        }
        const maybeLang = parts[0];
        if (SUPPORTED_LANGS.includes(maybeLang)) {
            const routePath = "/" + parts.slice(1).join("/");
            return {
                lang: maybeLang,
                routePath: routePath === "/" || routePath === "" ? DEFAULT_ROUTE : routePath,
                hasLangPrefix: true,
            };
        }
        return { lang: null, routePath: normalized, hasLangPrefix: false };
    }

    function getRoute(pathname) {
        const normalizedPath = normalizePath(pathname);
        if (ROUTES[normalizedPath]) {
            const route = ROUTES[normalizedPath];
            return { ...route, path: route.path || normalizedPath };
        }
        return { ...ROUTES[DEFAULT_ROUTE], path: DEFAULT_ROUTE };
    }

    function getReferenceTabRoute(tabName) {
        if (tabName === "imp") return "/reference/imp";
        if (tabName === "vp") return "/reference/vp";
        return "/reference/probability";
    }

    function showView(viewId) {
        VIEW_IDS.forEach((id) => {
            const el = document.getElementById(id);
            if (!el) return;
            if (id === viewId) el.classList.remove("hidden");
            else el.classList.add("hidden");
        });
    }

    function applyNavState(route) {
        NAV_KEYS.forEach((key) => {
            const nav = document.getElementById(`nav-${key}`);
            if (nav) {
                nav.classList.replace("tab-active", "tab-inactive");
                nav.classList.remove("text-indigo-600", "border-indigo-600");
            }

            const mobNav = document.getElementById(`mob-nav-${key}`);
            if (mobNav) {
                mobNav.classList.remove("text-indigo-600");
                mobNav.classList.add("text-slate-600");
            }
        });

        const activeKey = route.type === "tool" ? route.nav || route.tab : route.nav;
        if (!activeKey) return;

        const activeNav = document.getElementById(`nav-${activeKey}`);
        if (activeNav) {
            activeNav.classList.replace("tab-inactive", "tab-active");
            activeNav.classList.add("text-indigo-600", "border-indigo-600");
        }

        const activeMobNav = document.getElementById(`mob-nav-${activeKey}`);
        if (activeMobNav) {
            activeMobNav.classList.remove("text-slate-600");
            activeMobNav.classList.add("text-indigo-600");
        }
    }

    function renderRoute(route) {
        currentRoutePath = route.path;
        if (route.type === "tool") {
            showView(route.viewId);
            switchTab(route.tab);
            applyNavState(route);
            if (route.viewId === "view-probability") {
                if (route.probabilityMode === "solver") showProbabilitySolver();
                else setReferenceTab(route.referenceTab || "probability");
            }
        } else {
            applyNavState(route);
            showView(route.viewId);
        }
        setSeoMeta(route.path);
    }

    function navigateTo(path, pushHistory = true) {
        const route = getRoute(path);
        const localizedPath = buildLocalizedPath(currentLanguage, route.path);
        if (
            pushHistory &&
            normalizePath(window.location.pathname) !== normalizePath(localizedPath)
        ) {
            history.pushState({}, "", localizedPath);
        }
        renderRoute(route);
    }

    async function bootstrapApp() {
        const parsed = parseLocalizedPath(window.location.pathname);
        const preferredLang = parsed.lang || getPreferredLanguage();
        const requestedRoutePath = ROUTES[parsed.routePath] ? parsed.routePath : DEFAULT_ROUTE;
        const routePath = getRoute(requestedRoutePath).path;
        await setLanguage(preferredLang, { persist: false, refreshUI: false });
        applyTranslations();

        const expectedPath = buildLocalizedPath(preferredLang, routePath);
        if (normalizePath(window.location.pathname) !== normalizePath(expectedPath)) {
            history.replaceState({}, "", expectedPath);
        }
        navigateTo(routePath, false);
        markPrerenderReady();

        window.addEventListener("popstate", async () => {
            const popParsed = parseLocalizedPath(window.location.pathname);
            const popLang = popParsed.lang || getPreferredLanguage();
            const popRequestedRoutePath = ROUTES[popParsed.routePath]
                ? popParsed.routePath
                : DEFAULT_ROUTE;
            const popRoutePath = getRoute(popRequestedRoutePath).path;
            if (popLang !== currentLanguage) {
                await setLanguage(popLang, { persist: false, refreshUI: true });
            }
            navigateTo(popRoutePath, false);
            markPrerenderReady();
        });
    }

    function triggerAnimation(elementId, animationClass, duration) {
        const el = document.getElementById(elementId);
        if (el) {
            // アニメーションをリセットして再再生できるようにする
            el.classList.remove(animationClass);
            void el.offsetWidth; // リフローを強制
            el.classList.add(animationClass);

            // アニメーション終了後にクラスを削除
            setTimeout(() => {
                el.classList.remove(animationClass);
            }, duration);
        }
    }

    function getShapePresetValue(selectId) {
        const select = document.getElementById(selectId);
        if (!select) return "any";
        if (select.value !== "balanced") return select.value;
        return select.dataset.allowFiveMajor === "no" ? "balanced-without-major" : "balanced";
    }

    function updateShapeMajorToggleUI(select) {
        const toggle = document.querySelector(`.shape-major-toggle[data-for="${select.id}"]`);
        if (!toggle) return;

        const showToggle = select.value === "balanced";
        toggle.classList.toggle("hidden", !showToggle);
        if (!showToggle) return;

        const allowValue = select.dataset.allowFiveMajor === "no" ? "no" : "yes";
        const yesBtn = toggle.querySelector('.shape-major-btn[data-allow="yes"]');
        const noBtn = toggle.querySelector('.shape-major-btn[data-allow="no"]');

        if (yesBtn) {
            yesBtn.classList.toggle("shape-major-btn-active", allowValue === "yes");
            yesBtn.classList.toggle("shape-major-btn-inactive", allowValue !== "yes");
        }
        if (noBtn) {
            noBtn.classList.toggle("shape-major-btn-active", allowValue === "no");
            noBtn.classList.toggle("shape-major-btn-inactive", allowValue !== "no");
        }
    }

    function initShapePresetMajorToggles() {
        const presetSelects = document.querySelectorAll(
            'select[id^="sd-"][id$="-preset"], select[id^="lead-"][id$="-preset"]',
        );

        presetSelects.forEach((select) => {
            if (!select.dataset.allowFiveMajor) {
                select.dataset.allowFiveMajor = "yes";
            }

            const legacyOption = select.querySelector('option[value="balanced-without-major"]');
            if (legacyOption) legacyOption.remove();

            let toggle = document.querySelector(`.shape-major-toggle[data-for="${select.id}"]`);
            if (!toggle) {
                toggle = document.createElement("div");
                toggle.className = "shape-major-toggle hidden mt-2";
                toggle.dataset.for = select.id;
                toggle.innerHTML = `
                    <div class="flex items-center justify-between gap-2 rounded border border-slate-200 bg-slate-50 px-2 py-1.5">
                        <span class="shape-major-label text-[11px] font-semibold text-slate-600">5-card major</span>
                        <div class="flex items-center gap-1">
                            <button type="button" class="shape-major-btn px-2 py-1 text-[11px] font-semibold rounded border" data-allow="yes">Yes</button>
                            <button type="button" class="shape-major-btn px-2 py-1 text-[11px] font-semibold rounded border" data-allow="no">No</button>
                        </div>
                    </div>
                `;
                select.insertAdjacentElement("afterend", toggle);
            }

            if (!select.dataset.majorToggleBound) {
                select.addEventListener("change", () => updateShapeMajorToggleUI(select));
                select.dataset.majorToggleBound = "true";
            }

            if (!toggle.dataset.clickBound) {
                toggle.addEventListener("click", (event) => {
                    const btn = event.target.closest(".shape-major-btn");
                    if (!btn) return;
                    select.dataset.allowFiveMajor = btn.dataset.allow === "no" ? "no" : "yes";
                    updateShapeMajorToggleUI(select);
                });
                toggle.dataset.clickBound = "true";
            }

            updateShapeMajorToggleUI(select);
        });
    }

    // --- Double Dummy Logic ---
    function initDoubleDummyUI() {
        renderCardInterface("container", toggleCardDD, ddState);
        updateDDUI();
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
        if (sdModes[hand] == "hand" && mode == "feature") {
            sdState[hand] = [];
            updateSDUI();
        }
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
                btn.classList.add("sd-mode-switch-active");
                btn.classList.remove("sd-mode-switch-inactive");
            } else {
                btn.classList.remove("sd-mode-switch-active");
                btn.classList.add("sd-mode-switch-inactive");
            }
        });
    }

    function toggleCardSD(hand, cardId) {
        // Single Dummy Hand Toggle with Ownership Check (N vs S)
        const btnId = `btn-sd-container-${hand}-${cardId}`;
        const otherHand = hand === "north" ? "south" : "north";

        // 1. If I already have it, remove it
        if (sdState[hand].includes(cardId)) {
            sdState[hand] = sdState[hand].filter((c) => c !== cardId);
            triggerAnimation(btnId, "pop-animation", 150);
        }
        // 2. If opponent has it, steal it (remove from them, add to me)
        else if (sdState[otherHand].includes(cardId)) {
            triggerAnimation(btnId, "shake-animation", 300);
            return;
        }
        // 3. Else, just add it
        else {
            if (sdState[hand].length >= 13) {
                showToast(tr("toasts.limit13", "You can assign up to 13 cards per hand."));
                triggerAnimation(btnId, "shake-animation", 300);
                return;
            }
            sdState[hand].push(cardId);
            triggerAnimation(btnId, "pop-animation", 150);
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
        const leadSelect = document.getElementById("lead-leader");
        if (!leadSelect) return;
        const leader = leadSelect.value.toLowerCase(); // 'west', etc.

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

        const mapping = {
            west: tr("terms.south", "South"),
            east: tr("terms.north", "North"),
            north: tr("terms.east", "East"),
            south: tr("terms.west", "West"),
        };
        document.getElementById("lead-declarer-display").innerText = tr(
            "ui.declarerAuto",
            "{declarer} (auto)",
            { declarer: mapping[leader] },
        );
    }

    function toggleCardLead(hand, cardId) {
        if (leadState[hand].includes(cardId)) {
            leadState[hand] = leadState[hand].filter((c) => c !== cardId);
            triggerAnimation(btnId, "pop-animation", 150);
        } else {
            if (leadState[hand].length >= 13) {
                showToast(tr("toasts.limit13", "You can assign up to 13 cards per hand."));
                triggerAnimation(btnId, "shake-animation", 300);
                return;
            }
            leadState[hand].push(cardId);
            triggerAnimation(btnId, "pop-animation", 150);
        }
        updateLeadUI();
    }

    function updateLeadUI() {
        updateCardUI("lead-container", leadState);
    }

    // --- Probability Quick Check ---
    function combination(n, r) {
        if (r < 0 || r > n) return 0;
        const k = Math.min(r, n - r);
        let num = 1;
        let den = 1;
        for (let i = 1; i <= k; i++) {
            num *= n - (k - i);
            den *= i;
        }
        return num / den;
    }

    function computeFitDistributionFromPartnership() {
        const fitDenominator = combination(52, 26);
        const oppDenominator = combination(26, 13);
        const groups = [];

        for (let fitLength = 6; fitLength <= 11; fitLength++) {
            const fitProbabilityRaw =
                (combination(13, fitLength) * combination(39, 26 - fitLength)) / fitDenominator;
            const oppSuitCards = 13 - fitLength;
            const splitMap = new Map();

            for (
                let left = Math.max(0, oppSuitCards - 13);
                left <= Math.min(13, oppSuitCards);
                left++
            ) {
                const right = oppSuitCards - left;
                const splitRaw =
                    (combination(oppSuitCards, left) * combination(26 - oppSuitCards, 13 - left)) /
                    oppDenominator;
                const high = Math.max(left, right);
                const low = Math.min(left, right);
                const key = `${high}-${low}`;
                splitMap.set(key, (splitMap.get(key) || 0) + splitRaw);
            }

            const splits = Array.from(splitMap.entries())
                .map(([split, raw]) => ({
                    split,
                    conditionalProbability: raw * 100,
                    overallProbability: raw * fitProbabilityRaw * 100,
                }))
                .sort((a, b) => b.conditionalProbability - a.conditionalProbability);

            groups.push({
                fitLength,
                fitProbability: fitProbabilityRaw * 100,
                splits,
            });
        }
        return groups.sort((a, b) => a.fitLength - b.fitLength);
    }

    function updateProbabilitySuitResult() {
        const container = document.getElementById("prob-suit-result");
        if (!container) return;

        const groups = computeFitDistributionFromPartnership();
        const headerSplit = tr("probability.suit.oppSplit", "Opp split");
        const headerProb = tr("probability.suit.probability", "Probability");

        const sections = groups
            .map((group) => {
                const heading = tr(
                    "probability.suit.fitHeading",
                    "Fit {fit} cards (overall {prob}%)",
                    {
                        fit: group.fitLength,
                        prob: group.fitProbability.toFixed(2),
                    },
                );
                const rows = group.splits
                    .map(
                        (splitRow) =>
                            `<tr><td class="text-left font-semibold">${splitRow.split}</td><td>${splitRow.conditionalProbability.toFixed(2)}%</td></tr>`,
                    )
                    .join("");
                return `
                    <div class="mb-4 last:mb-0">
                        <div class="result-meta-label mb-1">${heading}</div>
                        <table class="w-full result-table">
                            <thead><tr><th class="text-left">${headerSplit}</th><th>${headerProb}</th></tr></thead>
                            <tbody>${rows}</tbody>
                        </table>
                    </div>
                `;
            })
            .join("");

        container.innerHTML = `
            <div class="text-xs text-slate-500 mb-2">${tr("probability.suit.note", "Fit lengths shown: 6 to 13 cards.")}</div>
            ${sections}
        `;
    }

    function computeHcpDistribution() {
        const groups = [
            { points: 4, count: 4 },
            { points: 3, count: 4 },
            { points: 2, count: 4 },
            { points: 1, count: 4 },
            { points: 0, count: 36 },
        ];
        const dp = Array.from({ length: 14 }, () => new Map());
        dp[0].set(0, 1);

        groups.forEach(({ points, count }) => {
            const next = Array.from({ length: 14 }, () => new Map());
            for (let cards = 0; cards <= 13; cards++) {
                dp[cards].forEach((ways, hcp) => {
                    const maxTake = Math.min(count, 13 - cards);
                    for (let take = 0; take <= maxTake; take++) {
                        const nextCards = cards + take;
                        const nextHcp = hcp + points * take;
                        const nextWays = ways * combination(count, take);
                        next[nextCards].set(
                            nextHcp,
                            (next[nextCards].get(nextHcp) || 0) + nextWays,
                        );
                    }
                });
            }
            for (let cards = 0; cards <= 13; cards++) {
                dp[cards] = next[cards];
            }
        });

        const denominator = combination(52, 13);
        const rows = Array.from(dp[13].entries())
            .map(([hcp, ways]) => ({
                hcp,
                probability: (ways / denominator) * 100,
            }))
            .sort((a, b) => a.hcp - b.hcp);
        let atLeast = 0;
        return rows
            .slice()
            .reverse()
            .map((row) => {
                atLeast += row.probability;
                return { ...row, atLeast };
            })
            .reverse();
    }

    function updateProbabilityHcpResult() {
        const container = document.getElementById("prob-hcp-result");
        if (!container) return;

        const rows = computeHcpDistribution();
        const chunkCount = 3;
        const chunkSize = Math.ceil(rows.length / chunkCount);
        const chunks = Array.from({ length: chunkCount }, (_, index) =>
            rows.slice(index * chunkSize, (index + 1) * chunkSize),
        ).filter((chunk) => chunk.length > 0);

        const columnsHtml = chunks
            .map((chunk) => {
                const body = chunk
                    .map(
                        (row) =>
                            `<tr><td class="text-left font-semibold">${row.hcp}</td><td>${row.probability.toFixed(3)}%</td><td>${row.atLeast.toFixed(2)}%</td></tr>`,
                    )
                    .join("");
                return `<table class="w-full result-table">
                    <thead>
                        <tr>
                            <th class="text-left">${tr("probability.hcp.hcp", "HCP")}</th>
                            <th>${tr("probability.hcp.probability", "Probability")}</th>
                            <th>${tr("probability.hcp.atLeast", "At least")}</th>
                        </tr>
                    </thead>
                    <tbody>${body}</tbody>
                </table>`;
            })
            .join("");

        container.innerHTML = `
            <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-12">${columnsHtml}</div>
            <div class="text-xs text-slate-500 mt-2">${tr(
                "probability.hcp.note",
                "Calculated from all 13-card hands using A=4, K=3, Q=2, J=1.",
            )}</div>
        `;
    }

    function getUniquePermutationCount(values) {
        const counts = new Map();
        values.forEach((value) => counts.set(value, (counts.get(value) || 0) + 1));
        return (
            factorial(values.length) /
            Array.from(counts.values()).reduce((acc, count) => acc * factorial(count), 1)
        );
    }

    function factorial(n) {
        let result = 1;
        for (let i = 2; i <= n; i++) result *= i;
        return result;
    }

    function computeShapeDistribution() {
        const denominator = combination(52, 13);
        const shapes = [];

        for (let a = 13; a >= 0; a--) {
            for (let b = Math.min(a, 13 - a); b >= 0; b--) {
                for (let c = Math.min(b, 13 - a - b); c >= 0; c--) {
                    const d = 13 - a - b - c;
                    if (d < 0 || d > c) continue;
                    const lengths = [a, b, c, d];
                    const suitChoices = lengths.reduce(
                        (acc, length) => acc * combination(13, length),
                        1,
                    );
                    const permutations = getUniquePermutationCount(lengths);
                    shapes.push({
                        shape: lengths.join("-"),
                        probability: (suitChoices * permutations * 100) / denominator,
                    });
                }
            }
        }

        return shapes.sort((a, b) => {
            const left = a.shape.split("-").map(Number);
            const right = b.shape.split("-").map(Number);
            for (let i = 0; i < left.length; i++) {
                if (left[i] !== right[i]) return left[i] - right[i];
            }
            return 0;
        });
    }

    function updateProbabilityShapeResult() {
        const container = document.getElementById("prob-shape-result");
        if (!container) return;

        const rows = computeShapeDistribution();
        const chunkCount = 3;
        const chunkSize = Math.ceil(rows.length / chunkCount);
        const chunks = Array.from({ length: chunkCount }, (_, index) =>
            rows.slice(index * chunkSize, (index + 1) * chunkSize),
        ).filter((chunk) => chunk.length > 0);

        const columnsHtml = chunks
            .map((chunk) => {
                const body = chunk
                    .map(
                        (row) =>
                            `<tr><td class="text-left font-semibold">${row.shape}</td><td>${row.probability.toFixed(3)}%</td></tr>`,
                    )
                    .join("");
                return `<table class="w-full result-table">
                    <thead>
                        <tr>
                            <th class="text-left">${tr("probability.shape.shape", "Shape")}</th>
                            <th>${tr("probability.shape.probability", "Probability")}</th>
                        </tr>
                    </thead>
                    <tbody>${body}</tbody>
                </table>`;
            })
            .join("");

        container.innerHTML = `
            <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-12">${columnsHtml}</div>
            <div class="text-xs text-slate-500 mt-2">${tr(
                "probability.shape.note",
                "Suit order is ignored; for example, 5332 and 3532 are grouped as 5332.",
            )}</div>
        `;
    }

    function setProbabilitySectionOpen(toggle, isOpen) {
        const targetId = toggle.dataset.probSectionToggle;
        if (!targetId) return;
        const target = document.getElementById(targetId);
        if (!target) return;
        toggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
        target.classList.toggle("hidden", !isOpen);
    }

    function initProbabilitySectionToggles() {
        document.querySelectorAll("[data-prob-section-toggle]").forEach((toggle) => {
            if (!(toggle instanceof HTMLElement)) return;
            const isOpen = toggle.getAttribute("aria-expanded") !== "false";
            setProbabilitySectionOpen(toggle, isOpen);
        });
    }

    function updateReferenceTabUI() {
        const probabilityTab = document.getElementById("reference-tab-probability");
        const impTab = document.getElementById("reference-tab-imp");
        const vpTab = document.getElementById("reference-tab-vp");
        const referenceTabs = document.getElementById("reference-tabs");
        const probabilityPanel = document.getElementById("reference-panel-probability");
        const impPanel = document.getElementById("reference-panel-imp");
        const vpPanel = document.getElementById("reference-panel-vp");
        const solverContent = document.getElementById("probability-solver-content");

        if (referenceTabs) referenceTabs.classList.remove("hidden");
        if (solverContent) solverContent.classList.add("hidden");
        if (probabilityTab) {
            const isActive = referenceViewTab === "probability";
            probabilityTab.classList.toggle("is-active", isActive);
            probabilityTab.setAttribute("aria-selected", isActive ? "true" : "false");
        }
        if (impTab) {
            const isActive = referenceViewTab === "imp";
            impTab.classList.toggle("is-active", isActive);
            impTab.setAttribute("aria-selected", isActive ? "true" : "false");
        }
        if (vpTab) {
            const isActive = referenceViewTab === "vp";
            vpTab.classList.toggle("is-active", isActive);
            vpTab.setAttribute("aria-selected", isActive ? "true" : "false");
        }
        if (probabilityPanel)
            probabilityPanel.classList.toggle("hidden", referenceViewTab !== "probability");
        if (impPanel) impPanel.classList.toggle("hidden", referenceViewTab !== "imp");
        if (vpPanel) vpPanel.classList.toggle("hidden", referenceViewTab !== "vp");

        setNodeText("#probability-title", tr("probability.title", "Bridge Reference"));
        setNodeText(
            "#probability-lead",
            tr("probability.lead", "Switch between probability, IMP, and VP quick references."),
        );
    }

    function setReferenceTab(tabName) {
        referenceViewTab = ["probability", "imp", "vp"].includes(tabName)
            ? tabName
            : "probability";
        updateReferenceTabUI();
    }

    function showProbabilitySolver() {
        const referenceTabs = document.getElementById("reference-tabs");
        const probabilityPanel = document.getElementById("reference-panel-probability");
        const impPanel = document.getElementById("reference-panel-imp");
        const vpPanel = document.getElementById("reference-panel-vp");
        const solverContent = document.getElementById("probability-solver-content");

        if (referenceTabs) referenceTabs.classList.add("hidden");
        if (probabilityPanel) probabilityPanel.classList.add("hidden");
        if (impPanel) impPanel.classList.add("hidden");
        if (vpPanel) vpPanel.classList.add("hidden");
        if (solverContent) solverContent.classList.remove("hidden");

        initConditionalProbabilityUI({ resetQueries: true });
        setNodeText(
            "#probability-title",
            tr("probability.conditional.title", "Probability Solver"),
        );
        setNodeText(
            "#probability-lead",
            tr(
                "probability.conditional.help",
                "Calculate exact combinatorial probabilities from known cards, HCP, and suit-length ranges.",
            ),
        );
    }

    function updateImpScaleResult() {
        const container = document.getElementById("imp-result");
        if (!container) return;
        const totalColumns = 3;
        const chunkSize = Math.ceil(IMP_SCALE_ROWS.length / totalColumns);
        const chunks = Array.from({ length: totalColumns }, (_, index) =>
            IMP_SCALE_ROWS.slice(index * chunkSize, (index + 1) * chunkSize),
        ).filter((chunk) => chunk.length > 0);
        const columnsHtml = chunks
            .map((chunk) => {
                const rows = chunk
                    .map((row) => {
                        const rangeLabel =
                            row.max === null
                                ? tr("probability.imp.rangeOver", "{min}+", { min: row.min })
                                : tr("probability.imp.range", "{min}-{max}", {
                                      min: row.min,
                                      max: row.max,
                                  });
                        return `<tr><td class="text-left font-semibold">${rangeLabel}</td><td>${row.imp}</td></tr>`;
                    })
                    .join("");
                return `
                <table class="w-full result-table">
                    <thead>
                        <tr>
                            <th class="text-left">${tr("probability.imp.scoreDiff", "Score diff (absolute)")}</th>
                            <th>${tr("probability.imp.imps", "IMPs")}</th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            `;
            })
            .join("");

        container.innerHTML = `
            <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-12">${columnsHtml}</div>
            <div class="text-xs text-slate-500 mt-2">${tr(
                "probability.imp.note",
                "Use absolute score difference, then apply sign by result direction.",
            )}</div>
        `;
    }

    function normalizeVpBoardCount(value) {
        const parsed = Number.parseInt(value, 10);
        if (Number.isNaN(parsed)) return vpBoardCount;
        return Math.max(1, Math.min(128, parsed));
    }

    // VP formula from plan.md
    function calcVp(openImp, closedImp, numOfBoard) {
        const diff = Math.abs(openImp - closedImp);
        const tau = (Math.sqrt(5) - 1) / 2;
        const b = 15 * Math.sqrt(numOfBoard);
        let vp = 10 + 10 * ((1 - Math.pow(tau, (3 * diff) / b)) / (1 - Math.pow(tau, 3)));
        let antiVp = 0;

        if (diff > b) {
            vp = 20.0;
            antiVp = 0.0;
        } else {
            vp = Math.round(vp * 100) / 100;
            antiVp = Math.round((20 - vp) * 100) / 100;
        }

        if (openImp > closedImp) return [vp, antiVp];
        return [antiVp, vp];
    }

    function setVpBoardCount(nextValue) {
        vpBoardCount = normalizeVpBoardCount(nextValue);
        const input = document.getElementById("vp-boards-input");
        if (input) input.value = String(vpBoardCount);
        document.querySelectorAll("[data-vp-boards]").forEach((btn) => {
            if (!(btn instanceof HTMLElement)) return;
            const preset = Number.parseInt(btn.dataset.vpBoards || "", 10);
            btn.classList.toggle("is-active", preset === vpBoardCount);
        });
        updateVpScaleResult();
    }

    function updateVpScaleResult() {
        const container = document.getElementById("vp-result");
        if (!container) return;
        const boards = normalizeVpBoardCount(vpBoardCount);
        if (boards !== vpBoardCount) vpBoardCount = boards;
        const capImp = Math.floor(15 * Math.sqrt(boards)) + 1;
        const rows = Array.from({ length: capImp + 1 }, (_, imp) => {
            const [winnerVp, loserVp] = calcVp(imp, 0, boards);
            return {
                imp,
                pair: `${winnerVp.toFixed(2)}-${loserVp.toFixed(2)}`,
            };
        });
        const chunkCount = 4;
        const chunkSize = Math.ceil(rows.length / chunkCount);
        const chunks = Array.from({ length: chunkCount }, (_, index) =>
            rows.slice(index * chunkSize, (index + 1) * chunkSize),
        ).filter((chunk) => chunk.length > 0);

        const columnsHtml = chunks
            .map((chunk) => {
                const body = chunk
                    .map(
                        (row) => `
                    <tr>
                        <td class="text-left font-semibold">${row.imp}</td>
                        <td>${row.pair}</td>
                    </tr>
                `,
                    )
                    .join("");
                return `
                <table class="w-full result-table">
                    <thead>
                        <tr>
                            <th class="text-left">${tr("probability.vp.impValue", "IMP")}</th>
                            <th>${tr("probability.vp.vpPair", "VP (both sides)")}</th>
                        </tr>
                    </thead>
                    <tbody>${body}</tbody>
                </table>
            `;
            })
            .join("");

        container.innerHTML = `
            <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-12">${columnsHtml}</div>
            <div class="text-xs text-slate-500 mt-2">${tr(
                "probability.vp.note",
                "For {boards} boards, {cap} IMP and above is fixed at 20.00-0.00.",
                { boards, cap: capImp },
            )}</div>
        `;
    }

    /**
     * ディフェンスの1スートについてありえるカード配置の組み合わせ数を与える関数
     * * @param {number} missing ディフェンス側のカードの枚数
     * @param {string[]} honors 特に持っているかを気にしたいカードの配列 (例: ['K', 'Q'])
     * @returns {Array} {E: State, W: State, combination: number} の配列
     */
    function getSuitDistributions(missing, honors, knownCounts = {}) {
        const results = [];
        const numHonors = honors.length;
        const spotCards = missing - numHonors; // 指定されたオナー以外のカード（スモールカード）の枚数
        const EastKnownCount = isNaN(knownCounts.east) ? 0 : knownCounts.east;
        const WestKnownCount = isNaN(knownCounts.west) ? 0 : knownCounts.west;
        const denominatorEast = combination(
            26 - EastKnownCount - WestKnownCount,
            13 - EastKnownCount,
        );

        // オナーの分配パターンは 2^(オナーの枚数) 通り
        const totalHonorCombos = 1 << numHonors;

        // Eastの持つ枚数(0枚 〜 missing枚)でループ
        for (let lengthE = 0; lengthE <= missing; lengthE++) {
            let lengthW = missing - lengthE;

            // オナーの分配パターンでループ (ビットマスクを使用)
            for (let mask = 0; mask < totalHonorCombos; mask++) {
                let stateE = { length: lengthE };
                let stateW = { length: lengthW };
                let honorsCountE = 0;

                // 各オナーがEastとWestのどちらにあるかを割り当て
                for (let i = 0; i < numHonors; i++) {
                    const honor = honors[i];
                    // i番目のビットが立っていればEastがそのオナーを持つと判定
                    if ((mask & (1 << i)) !== 0) {
                        stateE[honor] = true;
                        stateW[honor] = false;
                        honorsCountE++;
                    } else {
                        stateE[honor] = false;
                        stateW[honor] = true;
                    }
                }

                // Eastがこのオナー配置を満たすために必要なスモールカードの枚数
                let spotsNeededE = lengthE - honorsCountE;

                // 必要なスモールカードの枚数が物理的に可能（0枚以上、全体のスモールカード枚数以下）な場合のみ計算
                if (spotsNeededE >= 0 && spotsNeededE <= spotCards) {
                    // 組み合わせ数 = (全体のスモールカード) C (Eastが必要なスモールカード)
                    let prob =
                        (combination(spotCards, spotsNeededE) *
                            combination(
                                26 - EastKnownCount - WestKnownCount - missing,
                                13 - EastKnownCount - lengthE,
                            )) /
                        denominatorEast;

                    results.push({
                        E: stateE,
                        W: stateW,
                        prob: prob,
                    });
                }
            }
        }

        return results;
    }
    function buildQMissingStates(missing) {
        const states = [];
        const denominator = combination(26, 13);
        for (let qLen = 1; qLen <= missing; qLen++) {
            const onsideProb =
                (combination(missing - 1, qLen - 1) * combination(26 - missing, 13 - qLen)) /
                denominator;
            if (onsideProb > 0) states.push({ side: "onside", qLen, p: onsideProb });

            const onsideWithoutQ = missing - qLen;
            const offsideProb =
                (combination(missing - 1, onsideWithoutQ) *
                    combination(26 - missing, 13 - onsideWithoutQ)) /
                denominator;
            if (offsideProb > 0) states.push({ side: "offside", qLen, p: offsideProb });
        }
        return states;
    }

    function computeQLineProbability(missing, model, knownCounts = {}) {
        // const states = buildQMissingStates(missing);
        // const isQDrop = (state) => state.qLen <= 2;
        // const isOnsideFourZero = (state) => state.side === "onside" && state.qLen === missing;

        // const win = states.reduce((sum, state) => {
        //     let ok = false;
        //     if (model === "44-optimal") {
        //         ok = state.side === "onside" || (state.side === "offside" && state.qLen === 1);
        //     } else if (model === "53-optimal") {
        //         ok =
        //             (state.side === "onside" && state.qLen <= 4) ||
        //             (state.side === "offside" && state.qLen === 1);
        //     } else if (model === "62-double-finesse") {
        //         ok = state.side === "onside" && state.qLen <= 4;
        //     } else if (model == "62-cash-and-finesse") {
        //         ok =
        //             (state.side === "onside" && state.qLen <= 3) ||
        //             (state.side === "offside" && state.qLen === 1);
        //     } else if (model === "9fit-ak-drop-or-onside-40") {
        //         ok = isQDrop(state) || isOnsideFourZero(state);
        //     } else if (model === "9fit-drop-only") {
        //         ok = isQDrop(state);
        //     } else if (model === "drop-only") {
        //         ok = isQDrop(state);
        //     } else if (model === "onside-only") {
        //         ok = state.side === "onside";
        //     }
        //     return ok ? sum + state.p : sum;
        // }, 0);

        // return win * 100;
        const states = getSuitDistributions(missing, ["Q"], knownCounts);

        const totalProb = states.reduce((sum, state) => sum + state.prob, 0);
        if (totalProb <= 0) return 0;

        const win = states.reduce((sum, state) => {
            return model(state) ? sum + state.prob : sum;
        }, 0);

        return win / totalProb;
    }

    function getQDropBestRows() {
        const rows8 = [
            {
                key: "44",
                fit: tr("probability.qdrop.fit44", "4-4 fit"),
                line: tr(
                    "probability.qdrop.line44",
                    "Cash A then finesse. Covers offside singleton Q and onside Q.",
                ),
                probability: computeQLineProbability(
                    5,
                    (state) => state.E["Q"] || state.W.length == 1,
                ),
            },
            {
                key: "53",
                fit: tr("probability.qdrop.fit53", "5-3 fit"),
                line: tr(
                    "probability.qdrop.line53",
                    "Cash one top honor then finesse. Even with onside Q, a 5-0 break cannot all-win.",
                ),
                probability: computeQLineProbability(
                    5,
                    (state) =>
                        (state.E["Q"] && state.E.length < 5) ||
                        (state.W["Q"] && state.W.length == 1),
                ),
            },
            {
                key: "62",
                fit: tr("probability.qdrop.fit62", "6-2 fit"),
                line: tr(
                    "probability.qdrop.line62",
                    "Do not cash on Q side; take two finesses. All-win when onside Q is 4 or fewer.",
                ),
                probability: computeQLineProbability(
                    5,
                    (state) => state.E["Q"] && state.E.length < 5,
                ),
            },
        ];

        const rows9 = [
            {
                key: "54",
                fit: tr("probability.qdrop.fit54", "5-4 fit"),
                line: tr(
                    "probability.qdrop.line54",
                    "Cash A and K. Win on Q-drop or onside 4-0 only.",
                ),
                probability: computeQLineProbability(
                    4,
                    (state) =>
                        (state.E["Q"] && (state.E.length == 4 || state.E.length < 3)) ||
                        (state.W["Q"] && state.W.length < 3),
                ),
            },
            {
                key: "63",
                fit: tr("probability.qdrop.fit63", "6-3 fit"),
                line: tr(
                    "probability.qdrop.line63",
                    "Cash A and K. Win on Q-drop or onside 4-0 only.",
                ),
                probability: computeQLineProbability(
                    4,
                    (state) =>
                        (state.E["Q"] && (state.E.length == 4 || state.E.length < 3)) ||
                        (state.W["Q"] && state.W.length < 3),
                ),
            },
            {
                key: "72",
                fit: tr("probability.qdrop.fit72", "7-2 fit"),
                line: tr("probability.qdrop.line72", "Play for Q-drop only."),
                probability: computeQLineProbability(
                    4,
                    (state) =>
                        (state.E["Q"] && state.E.length < 3) ||
                        (state.W["Q"] && state.W.length < 3),
                ),
            },
        ];

        return { rows8, rows9 };
    }

    function getQDropComparisonRows(fitKey, knownCounts = {}) {
        if (!fitKey) return null;
        const make = (lineKey, fallback, missing, model) => ({
            line: tr(lineKey, fallback),
            probability: computeQLineProbability(missing, model, knownCounts),
        });

        if (fitKey === "44") {
            return {
                fit: tr("probability.qdrop.fit44", "4-4 fit"),
                missing: 5,
                rows: [
                    make(
                        "probability.qdrop.line44",
                        "Cash A then finesse.",
                        5,
                        (state) => state.E["Q"] || state.W.length == 1,
                    ),
                    make(
                        "probability.qdrop.compareLineFinesseFirst",
                        "Take finesse first.",
                        5,
                        (state) => state.E["Q"],
                    ),
                    make(
                        "probability.qdrop.compareLineCashAK",
                        "Cash AK and play for drop.",
                        5,
                        (state) =>
                            (state.E["Q"] && state.E.length < 3) ||
                            (state.W["Q"] && state.W.length < 3),
                    ),
                ],
            };
        }
        if (fitKey === "53") {
            return {
                fit: tr("probability.qdrop.fit53", "5-3 fit"),
                missing: 5,
                rows: [
                    make(
                        "probability.qdrop.line53",
                        "Cash A then finesse.",
                        5,
                        (state) =>
                            (state.E["Q"] && state.E.length < 5) ||
                            (state.W["Q"] && state.W.length == 1),
                    ),
                    make(
                        "probability.qdrop.compareLineDoubleFinesse",
                        "Take two finesses.",
                        5,
                        (state) => state.E["Q"],
                    ),
                    make(
                        "probability.qdrop.compareLineCashAK",
                        "Cash AK and play for drop.",
                        5,
                        (state) =>
                            (state.E["Q"] && state.E.length < 3) ||
                            (state.W["Q"] && state.W.length < 3),
                    ),
                ],
            };
        }
        if (fitKey === "62") {
            return {
                fit: tr("probability.qdrop.fit62", "6-2 fit"),
                missing: 5,
                rows: [
                    make(
                        "probability.qdrop.line62",
                        "Do not cash on Q side; take two finesses.",
                        5,
                        (state) => state.E["Q"] && state.E.length < 5,
                    ),
                    make(
                        "probability.qdrop.compareLineCashAThenFinesse",
                        "Cash A then finesse.",
                        5,
                        (state) =>
                            (state.E["Q"] && state.E.length < 4) ||
                            (state.W["Q"] && state.W.length == 1),
                    ),
                    make(
                        "probability.qdrop.compareLineCashAK",
                        "Cash AK and play for drop.",
                        5,
                        (state) =>
                            (state.E["Q"] && state.E.length < 3) ||
                            (state.W["Q"] && state.W.length < 3),
                    ),
                ],
            };
        }
        if (fitKey === "54") {
            return {
                fit: tr("probability.qdrop.fit54", "5-4 fit"),
                missing: 4,
                rows: [
                    make(
                        "probability.qdrop.line54",
                        "Cash A and K.",
                        4,
                        (state) =>
                            (state.E["Q"] && (state.E.length == 4 || state.E.length < 3)) ||
                            (state.W["Q"] && state.W.length < 3),
                    ),
                    make(
                        "probability.qdrop.compareLineCashAThenFinesse",
                        "Cash A then finesse.",
                        4,
                        (state) => state.E["Q"] || state.W.length == 1,
                    ),
                    make(
                        "probability.qdrop.compareLineCashAK",
                        "Cash AK and play for drop.",
                        4,
                        (state) =>
                            (state.E["Q"] && state.E.length < 3) ||
                            (state.W["Q"] && state.W.length < 3),
                    ),
                    make(
                        "probability.qdrop.compareLineFinesseFirst",
                        "Take finesse first.",
                        4,
                        (state) => state.E["Q"],
                    ),
                ],
            };
        }
        if (fitKey === "63") {
            return {
                fit: tr("probability.qdrop.fit63", "6-3 fit"),
                missing: 4,
                rows: [
                    make(
                        "probability.qdrop.line63",
                        "Cash A and K.",
                        4,
                        (state) =>
                            (state.E["Q"] && (state.E.length == 4 || state.E.length < 3)) ||
                            (state.W["Q"] && state.W.length < 3),
                    ),
                    make(
                        "probability.qdrop.compareLineCashAThenFinesse",
                        "Cash A then finesse.",
                        4,
                        (state) =>
                            (state.E["Q"] && state.E.length < 5) ||
                            (state.W["Q"] && state.W.length == 1),
                    ),
                    make(
                        "probability.qdrop.compareLineCashAK",
                        "Cash AK and play for drop.",
                        4,
                        (state) =>
                            (state.E["Q"] && state.E.length < 3) ||
                            (state.W["Q"] && state.W.length < 3),
                    ),
                    make(
                        "probability.qdrop.compareLineFinesseFirst",
                        "Take finesse first.",
                        4,
                        (state) => state.E["Q"],
                    ),
                ],
            };
        }
        if (fitKey === "72") {
            return {
                fit: tr("probability.qdrop.fit72", "7-2 fit"),
                missing: 4,
                rows: [
                    make(
                        "probability.qdrop.line72",
                        "Play for Q-drop only.",
                        4,
                        (state) =>
                            (state.E["Q"] && state.E.length < 3) ||
                            (state.W["Q"] && state.W.length < 3),
                    ),
                    make(
                        "probability.qdrop.compareLineFinesseFirst",
                        "Take finesse first.",
                        4,
                        (state) => state.E["Q"],
                    ),
                    make(
                        "probability.qdrop.compareLineCashAThenFinesse",
                        "Cash A then finesse.",
                        4,
                        (state) =>
                            (state.E["Q"] && state.E.length < 4) ||
                            (state.W["Q"] && state.W.length == 1),
                    ),
                ],
            };
        }
        return null;
    }

    function updateProbabilityQDropResult() {
        const container = document.getElementById("prob-finesse-result");
        if (!container) return;

        const { rows8, rows9 } = getQDropBestRows();
        const renderBody = (rows) =>
            rows
                .map((row) => {
                    return `
                    <tr>
                        <td class="text-left font-semibold">
                            <button
                                type="button"
                                data-qdrop-fit="${row.key}"
                                class="qdrop-fit-toggle">
                                ${row.fit}
                            </button>
                        </td>
                        <td class="text-left">${row.line}</td>
                        <td>${(row.probability * 100).toFixed(2)}%</td>
                    </tr>
                `;
                })
                .join("");

        const body8 = renderBody(rows8);
        const body9 = renderBody(rows9);

        container.innerHTML = `
            <div class="mb-4">
                <div class="result-meta-label mb-1">${tr("probability.qdrop.group8Title", "8-card fit group")}</div>
                <table class="w-full result-table">
                    <thead>
                        <tr>
                            <th class="text-left min-w-20">${tr("probability.qdrop.fit", "Fit")}</th>
                            <th class="text-left">${tr("probability.qdrop.playLine", "Play line")}</th>
                            <th>${tr("probability.qdrop.success", "All-win probability")}</th>
                        </tr>
                    </thead>
                    <tbody>${body8}</tbody>
                </table>
            </div>
            <div>
                <div class="result-meta-label mb-1">${tr("probability.qdrop.group9Title", "9-card fit group")}</div>
                <table class="w-full result-table">
                    <thead>
                        <tr>
                            <th class="text-left min-w-20">${tr("probability.qdrop.fit", "Fit")}</th>
                            <th class="text-left">${tr("probability.qdrop.playLine", "Play line")}</th>
                            <th>${tr("probability.qdrop.success", "All-win probability")}</th>
                        </tr>
                    </thead>
                    <tbody>${body9}</tbody>
                </table>
            </div>
            <div class="text-xs text-slate-500 mt-2">${tr(
                "probability.qdrop.note",
                "Assumption: Q is missing. Each row shows all-win probability for its stated play line.",
            )}</div>
            <div id="qdrop-compare-dialog" class="qdrop-dialog hidden" aria-hidden="true">
                <div class="qdrop-dialog-backdrop" data-qdrop-dialog-close="true"></div>
                <div class="qdrop-dialog-panel" role="dialog" aria-modal="true" aria-labelledby="qdrop-dialog-title">
                    <div class="qdrop-dialog-handle" data-qdrop-drag-handle="true" aria-hidden="true"></div>
                    <div class="flex items-center justify-between mb-2">
                        <div id="qdrop-dialog-title" class="text-sm font-semibold text-slate-700"></div>
                        <button type="button" data-qdrop-dialog-close="true" class="qdrop-dialog-close" aria-label="Close">×</button>
                    </div>
                    <div class="qdrop-dialog-controls mb-2">
                        <label class="qdrop-dialog-field">
                            <span class="qdrop-dialog-field-label">${tr("probability.qdrop.knownEast", "E known")}</span>
                            <input
                                id="qdrop-known-east"
                                class="qdrop-dialog-input"
                                type="number"
                                inputmode="numeric"
                                min="0"
                                step="1"
                                value="0" />
                        </label>
                        <label class="qdrop-dialog-field">
                            <span class="qdrop-dialog-field-label">${tr("probability.qdrop.knownWest", "W known")}</span>
                            <input
                                id="qdrop-known-west"
                                class="qdrop-dialog-input"
                                type="number"
                                inputmode="numeric"
                                min="0"
                                step="1"
                                value="0" />
                        </label>
                    </div>
                    <div id="qdrop-dialog-note" class="qdrop-dialog-note text-xs text-slate-500 mb-3"></div>
                    <table class="w-full result-table">
                        <thead>
                            <tr>
                                <th class="text-left">${tr("probability.qdrop.playLine", "Play line")}</th>
                                <th>${tr("probability.qdrop.success", "All-win probability")}</th>
                            </tr>
                        </thead>
                        <tbody id="qdrop-dialog-body"></tbody>
                    </table>
                </div>
            </div>
        `;
    }

    function setQDropDialogOpen(isOpen) {
        const dialog = document.getElementById("qdrop-compare-dialog");
        if (!dialog) return;
        const panel = dialog.querySelector(".qdrop-dialog-panel");
        dialog.classList.toggle("hidden", !isOpen);
        dialog.setAttribute("aria-hidden", isOpen ? "false" : "true");
        if (panel instanceof HTMLElement) {
            panel.classList.remove("is-dragging");
            panel.style.transform = "";
        }
    }

    const qdropSheetDragState = {
        active: false,
        startY: 0,
        currentOffset: 0,
    };

    const qdropDialogState = {
        fitKey: "",
        east: "0",
        west: "0",
    };

    function normalizeKnownCount(rawValue) {
        const normalized = String(rawValue ?? "").trim();
        if (normalized === "") return null;
        const value = Number.parseInt(normalized, 10);
        if (!Number.isFinite(value)) return null;
        return Math.max(0, value);
    }

    function getQDropKnownCounts(missing) {
        return {
            east: normalizeKnownCount(qdropDialogState.east),
            west: normalizeKnownCount(qdropDialogState.west),
        };
    }

    function getQDropKnownCountsMessage(missing, knownCounts) {
        if (knownCounts.east == null && knownCounts.west == null) {
            return tr(
                "probability.qdrop.knownHint",
                "Leave blank to use the unconditional probability table.",
            );
        }
        if (
            knownCounts.east != null &&
            knownCounts.west != null &&
            knownCounts.east + knownCounts.west + missing > 26
        ) {
            const side = 26 - missing;
            return tr(
                "probability.qdrop.knownInvalid",
                "The total number of known E and W cards must be {side} or fewer.",
                { side },
            );
        }
        return tr(
            "probability.qdrop.knownApplied",
            "Showing conditional probabilities for the specified E/W suit lengths.",
        );
    }

    function renderQDropComparisonDialog() {
        if (!qdropDialogState.fitKey) return;
        const titleEl = document.getElementById("qdrop-dialog-title");
        const bodyEl = document.getElementById("qdrop-dialog-body");
        const eastInput = document.getElementById("qdrop-known-east");
        const westInput = document.getElementById("qdrop-known-west");
        const noteEl = document.getElementById("qdrop-dialog-note");
        if (!titleEl || !bodyEl || !eastInput || !westInput || !noteEl) return;

        const baseComparison = getQDropComparisonRows(qdropDialogState.fitKey);
        if (!baseComparison) return;
        const knownCounts = getQDropKnownCounts(baseComparison.missing);
        const comparison = getQDropComparisonRows(qdropDialogState.fitKey, knownCounts);
        if (!comparison) return;
        const bestTag = tr("probability.qdrop.bestTag", "Best");
        const bestProbability = comparison.rows.reduce(
            (max, row) => Math.max(max, row.probability),
            Number.NEGATIVE_INFINITY,
        );
        const bestThreshold = 1e-9;

        titleEl.textContent = tr("probability.qdrop.compareResultTitle", "Comparison for {fit}", {
            fit: comparison.fit,
        });
        eastInput.value = qdropDialogState.east;
        westInput.value = qdropDialogState.west;
        eastInput.max = String(13);
        westInput.max = String(13);
        noteEl.textContent = getQDropKnownCountsMessage(comparison.missing, knownCounts);
        noteEl.classList.toggle(
            "text-amber-600",
            knownCounts.east != null &&
                knownCounts.west != null &&
                knownCounts.east + knownCounts.west + comparison.missing > 26,
        );
        noteEl.classList.toggle(
            "text-slate-500",
            !(
                knownCounts.east != null &&
                knownCounts.west != null &&
                knownCounts.east + knownCounts.west + comparison.missing > 26
            ),
        );
        bodyEl.innerHTML = comparison.rows
            .map(
                (cmp) => `
            <tr>
                <td class="text-left">${cmp.line}${
                    Math.abs(cmp.probability - bestProbability) <= bestThreshold
                        ? ` <span class="ml-2 inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">${bestTag}</span>`
                        : ""
                }</td>
                <td>${(cmp.probability * 100).toFixed(2)}%</td>
            </tr>
        `,
            )
            .join("");
    }

    function bindQDropDialogInputs() {
        const dialog = document.getElementById("qdrop-compare-dialog");
        if (!dialog || dialog.dataset.inputsBound === "true") return;
        const eastInput = document.getElementById("qdrop-known-east");
        const westInput = document.getElementById("qdrop-known-west");
        if (!(eastInput instanceof HTMLInputElement) || !(westInput instanceof HTMLInputElement))
            return;

        const handleInput = () => {
            qdropDialogState.east = eastInput.value;
            qdropDialogState.west = westInput.value;
            renderQDropComparisonDialog();
        };

        eastInput.addEventListener("input", handleInput);
        westInput.addEventListener("input", handleInput);
        dialog.dataset.inputsBound = "true";
    }

    function resetQDropSheetDrag(panel) {
        qdropSheetDragState.active = false;
        qdropSheetDragState.startY = 0;
        qdropSheetDragState.currentOffset = 0;
        if (!(panel instanceof HTMLElement)) return;
        panel.classList.remove("is-dragging");
        panel.style.transform = "";
    }

    function bindQDropSheetSwipe() {
        const dialog = document.getElementById("qdrop-compare-dialog");
        if (!dialog || dialog.dataset.swipeBound === "true") return;
        const panel = dialog.querySelector(".qdrop-dialog-panel");
        const handle = dialog.querySelector("[data-qdrop-drag-handle]");
        if (!(panel instanceof HTMLElement) || !(handle instanceof HTMLElement)) return;

        const closeThreshold = () => Math.min(160, Math.max(72, panel.offsetHeight * 0.2));

        handle.addEventListener(
            "touchstart",
            (event) => {
                if (window.innerWidth > 640) return;
                const touch = event.touches[0];
                if (!touch) return;
                qdropSheetDragState.active = true;
                qdropSheetDragState.startY = touch.clientY;
                qdropSheetDragState.currentOffset = 0;
                panel.classList.add("is-dragging");
            },
            { passive: true },
        );

        handle.addEventListener(
            "touchmove",
            (event) => {
                if (!qdropSheetDragState.active) return;
                const touch = event.touches[0];
                if (!touch) return;
                const deltaY = touch.clientY - qdropSheetDragState.startY;
                if (deltaY <= 0) {
                    qdropSheetDragState.currentOffset = 0;
                    panel.style.transform = "";
                    return;
                }
                qdropSheetDragState.currentOffset = deltaY;
                panel.style.transform = `translateY(${deltaY}px)`;
                event.preventDefault();
            },
            { passive: false },
        );

        const finishDrag = () => {
            if (!qdropSheetDragState.active) return;
            const shouldClose = qdropSheetDragState.currentOffset > closeThreshold();
            resetQDropSheetDrag(panel);
            if (shouldClose) setQDropDialogOpen(false);
        };

        handle.addEventListener("touchend", finishDrag);
        handle.addEventListener("touchcancel", () => resetQDropSheetDrag(panel));
        dialog.dataset.swipeBound = "true";
    }

    function openQDropComparisonDialog(fitKey) {
        const comparison = getQDropComparisonRows(fitKey);
        if (!comparison) return;
        qdropDialogState.fitKey = fitKey;
        qdropDialogState.east = "0";
        qdropDialogState.west = "0";
        bindQDropDialogInputs();
        renderQDropComparisonDialog();
        bindQDropSheetSwipe();
        setQDropDialogOpen(true);
    }

    function initProbabilityUI() {
        updateProbabilitySuitResult();
        updateProbabilityHcpResult();
        updateProbabilityShapeResult();
        updateProbabilityQDropResult();
        initConditionalProbabilityUI();
        updateImpScaleResult();
        setVpBoardCount(vpBoardCount);
        initProbabilitySectionToggles();
        updateReferenceTabUI();
    }

    function cardIdFromText(value) {
        const text = String(value || "")
            .trim()
            .toUpperCase();
        if (!text) return "";
        const negated = text.startsWith("-");
        const cardText = negated ? text.slice(1) : text;
        const suitMap = { S: "s", H: "h", D: "d", C: "c", "♠": "s", "♥": "h", "♦": "d", "♣": "c" };
        const suit = suitMap[cardText[0]];
        const rank = cardText.slice(1).replace("10", "T");
        const card = suit && RANKS.includes(rank) ? suit + rank : "";
        return card ? `${negated ? "-" : ""}${card}` : "";
    }

    function parseCardsText(value) {
        return String(value || "")
            .split(/[\s,]+/)
            .map(cardIdFromText)
            .filter(Boolean);
    }

    function rangeFromInputs(prefix, fallbackMin, fallbackMax) {
        const min = Number.parseInt(document.getElementById(`${prefix}-min`)?.value, 10);
        const max = Number.parseInt(document.getElementById(`${prefix}-max`)?.value, 10);
        return {
            min: Number.isNaN(min) ? fallbackMin : min,
            max: Number.isNaN(max) ? fallbackMax : max,
        };
    }

    function initConditionalProbabilityUI({ resetQueries = false } = {}) {
        renderConditionalHandPanels();
        const queryContainer = document.getElementById("cond-queries");
        if (resetQueries && queryContainer) queryContainer.innerHTML = "";
        if (
            queryContainer &&
            queryContainer.querySelector("[data-cond-query]") &&
            !queryContainer.querySelector("[data-cond-root]")
        ) {
            queryContainer.innerHTML = "";
        }
        if (document.querySelectorAll("[data-cond-query]").length === 0) addConditionalQuery();
    }

    function renderConditionalHandPanels() {
        const container = document.getElementById("cond-hands");
        if (!container) return;
        container.innerHTML = HANDS.map((hand) => {
            const label = tr(`terms.${hand}`, hand);
            return `
                <div class="space-y-3 border-slate-200 pb-4">
                <div class="bg-white border border-slate-200 rounded-lg p-3 space-y-3">
                    <div class="flex items-center justify-between gap-2 mb-3">
                        <h4 class="font-bold text-slate-900">${label}</h4>
                        <select id="cond-${hand}-mode" class="p-2 border rounded text-xs font-bold">
                            <option value="feature">${tr("probability.conditional.modeFeature", "Feature")}</option>
                            <option value="hand">${tr("probability.conditional.modeHand", "Full hand")}</option>
                        </select>
                    </div>
                        <div class="grid grid-cols-2 gap-2">
                            <label class="text-xs font-semibold text-slate-500 uppercase">${tr("probability.conditional.hcpMin", "HCP min")}
                                <input id="cond-${hand}-hcp-min" type="number" min="0" max="37" value="0" class="block w-full p-2 border rounded text-sm mt-1" />
                            </label>
                            <label class="text-xs font-semibold text-slate-500 uppercase">${tr("probability.conditional.hcpMax", "HCP max")}
                                <input id="cond-${hand}-hcp-max" type="number" min="0" max="37" value="37" class="block w-full p-2 border rounded text-sm mt-1" />
                            </label>
                        </div>
                        <div>
                            <label class="text-xs font-semibold text-slate-500 uppercase">${tr("probability.conditional.suitRanges", "Suit length ranges")}</label>
                            <div class="grid grid-cols-4 gap-2 mt-1">
                                ${SUITS.map(
                                    (suit) => `
                                    <div>
                                        <div class="${suit.color} text-center font-bold">${suit.label}</div>
                                        <input id="cond-${hand}-${suit.id}-min" type="number" min="0" max="13" value="0" class="w-full p-1 border rounded text-xs text-center mb-1" />
                                        <input id="cond-${hand}-${suit.id}-max" type="number" min="0" max="13" value="13" class="w-full p-1 border rounded text-xs text-center" />
                                    </div>`,
                                ).join("")}
                            </div>
                        </div>
                        <label class="text-xs font-semibold text-slate-500 uppercase">${tr("probability.conditional.knownCards", "Known cards")}</label>
                        <input id="cond-${hand}-cards" class="w-full p-2 border rounded text-sm" placeholder="SA HK -DQ C2" />
                        </div>
                </div>`;
        }).join("");
    }

    function conditionInputHtml(prefix) {
        return `
            <select data-cond-field="${prefix}-hand" class="p-2 border rounded text-sm">
                ${HANDS.map((hand) => `<option value="${hand}">${tr(`terms.${hand}`, hand)}</option>`).join("")}
            </select>
            <select data-cond-field="${prefix}-type" class="p-2 border rounded text-sm cond-query-type-selector">
                <option value="hcp">${tr("probability.conditional.typeHcp", "HCP range")}</option>
                <option value="shape">${tr("probability.conditional.typeShape", "Shape")}</option>
                <option value="card">${tr("probability.conditional.typeCard", "Has specific card")}</option>
            </select>
            <input data-cond-field="${prefix}-value" class="p-2 border rounded text-sm cond-query-input" placeholder="10-12" />
        `;
    }

    function updateConditionalConditionPlaceholders(root = document) {
        root.querySelectorAll(".cond-query-type-selector").forEach((select) => {
            const input = select
                .closest("[data-cond-condition]")
                ?.querySelector(".cond-query-input");
            if (!input) return;
            const placeholder =
                select.value === "hcp"
                    ? "10-12"
                    : select.value === "shape"
                      ? "4-4-3-2 / S5H4"
                      : "-SA SK SQ -SJ";
            input.setAttribute("placeholder", placeholder);
        });
    }

    function conditionalConditionRowHtml(index) {
        return `
            <div data-cond-condition class="grid grid-cols-1 md:grid-cols-[1fr_1fr_1fr_auto] gap-2 items-center">
                ${conditionInputHtml(`condition-${index}`)}
                <button type="button" class="cond-remove-condition text-sm text-slate-500 hover:text-red-600">${tr("probability.conditional.remove", "Remove")}</button>
            </div>
        `;
    }

    function conditionalGroupHtml(isRoot = false) {
        return `
            <div data-cond-group class="${isRoot ? "space-y-2" : "space-y-2 border-l-2 border-slate-200 pl-3 py-2"}">
                <div class="flex flex-wrap items-center gap-2">
                    <select data-cond-group-op class="p-2 border rounded text-sm">
                        <option value="and">${tr("probability.conditional.joinAnd", "AND")}</option>
                        <option value="or">${tr("probability.conditional.joinOr", "OR")}</option>
                    </select>
                    <button type="button" data-cond-add-condition class="text-sm font-semibold text-blue-700 hover:text-blue-900">${tr("probability.conditional.addCondition", "Add condition")}</button>
                    <button type="button" data-cond-add-group class="text-sm font-semibold text-blue-700 hover:text-blue-900">${tr("probability.conditional.addGroup", "Add group")}</button>
                    ${isRoot ? "" : `<button type="button" data-cond-remove-group class="text-sm text-slate-500 hover:text-red-600">${tr("probability.conditional.remove", "Remove")}</button>`}
                </div>
                <div data-cond-group-children class="space-y-2"></div>
            </div>
        `;
    }

    function addConditionalCondition(row, group) {
        const list = group.querySelector(":scope > [data-cond-group-children]");
        if (!list) return null;
        const index = Number.parseInt(row.dataset.condConditionCount || "0", 10);
        row.dataset.condConditionCount = String(index + 1);
        list.insertAdjacentHTML("beforeend", conditionalConditionRowHtml(index));
        updateConditionalConditionPlaceholders(list);
        updateConditionalQueryControls(row);
        return list.lastElementChild;
    }

    function addConditionalGroup(row, parentGroup) {
        const list = parentGroup.querySelector(":scope > [data-cond-group-children]");
        if (!list) return null;
        list.insertAdjacentHTML("beforeend", conditionalGroupHtml(false));
        const group = list.lastElementChild;
        addConditionalCondition(row, group);
        updateConditionalQueryControls(row);
        return group;
    }

    function updateConditionalQueryControls(row) {
        row.querySelectorAll("[data-cond-group]").forEach((group) => {
            const childCount =
                group.querySelector(":scope > [data-cond-group-children]")?.children.length || 0;
            const opSelect = group.querySelector(":scope > div > [data-cond-group-op]");
            if (opSelect) opSelect.classList.toggle("hidden", childCount <= 1);
        });
    }

    function copyConditionalControlValues(source, target) {
        const sourceControls = source.querySelectorAll("input, select, textarea");
        const targetControls = target.querySelectorAll("input, select, textarea");
        sourceControls.forEach((sourceControl, index) => {
            const targetControl = targetControls[index];
            if (!targetControl) return;
            targetControl.value = sourceControl.value;
            if (sourceControl instanceof HTMLDetailsElement && targetControl instanceof HTMLDetailsElement) {
                targetControl.open = sourceControl.open;
            }
        });
    }

    function duplicateConditionalQuery(sourceRow) {
        const targetRow = addConditionalQuery();
        if (!targetRow) return;
        const sourceRoot = sourceRow.querySelector("[data-cond-root]");
        const targetRoot = targetRow.querySelector("[data-cond-root]");
        if (sourceRoot && targetRoot) {
            targetRoot.innerHTML = sourceRoot.innerHTML;
        }
        copyConditionalControlValues(sourceRow, targetRow);
        const conditionCount = targetRow.querySelectorAll("[data-cond-condition]").length;
        targetRow.dataset.condConditionCount = String(conditionCount);
        updateConditionalConditionPlaceholders(targetRow);
        updateConditionalQueryControls(targetRow);
    }

    function addConditionalQuery() {
        const container = document.getElementById("cond-queries");
        if (!container) return null;
        const row = document.createElement("div");
        row.className = "space-y-2 border-slate-200 pb-3";
        row.dataset.condQuery = "true";
        row.dataset.condConditionCount = "0";
        row.innerHTML = `
        <div class="bg-white border border-slate-200 rounded-lg p-3 space-y-3">
            <div>
                <input data-cond-field="name" class="p-2 border rounded text-sm" placeholder="${tr("probability.conditional.labelPlaceholder", "Label")}" />
            </div>
            <div data-cond-root>${conditionalGroupHtml(true)}</div>
            <div class="flex flex-wrap items-center gap-3">
                <details class="text-sm text-slate-600">
                    <summary class="cursor-pointer font-semibold text-slate-500">${tr("probability.conditional.advancedEvent", "Advanced nested event")}</summary>
                    <textarea data-cond-field="event-json" class="mt-2 w-full min-w-[280px] p-2 border rounded text-xs font-mono" rows="5" placeholder='{"op":"and","conditions":[{"hand":"north","type":"shape","value":"4-4-3-2"},{"op":"or","conditions":[{"hand":"north","type":"hcp","value":"10-12"},{"hand":"north","type":"card","value":"SA"}]}]}'></textarea>
                </details>
            </div>
            <div class="border-t border-slate-100 pt-2 space-y-2">
                <div class="flex justify-end">
                    <button type="button" class="cond-duplicate-query text-sm font-semibold text-blue-700 hover:text-blue-900">${tr("probability.conditional.duplicate", "Duplicate")}</button>
                </div>
                <div class="flex justify-center">
                    <button type="button" class="cond-remove-query text-sm text-slate-500 hover:text-red-600 border border-slate-300 rounded px-3 py-1.5">${tr("probability.conditional.remove", "Remove")}</button>
                </div>
            </div>
            </div>
        `;
        container.appendChild(row);
        const rootGroup = row.querySelector("[data-cond-group]");
        addConditionalCondition(row, rootGroup);
        row.addEventListener("click", (event) => {
            const duplicateQueryButton = event.target.closest(".cond-duplicate-query");
            if (duplicateQueryButton) {
                duplicateConditionalQuery(row);
                return;
            }
            const removeQueryButton = event.target.closest(".cond-remove-query");
            if (removeQueryButton) {
                row.remove();
                return;
            }
            const addConditionButton = event.target.closest("[data-cond-add-condition]");
            if (addConditionButton) {
                const group = addConditionButton.closest("[data-cond-group]");
                if (group) addConditionalCondition(row, group);
                return;
            }
            const addGroupButton = event.target.closest("[data-cond-add-group]");
            if (addGroupButton) {
                const group = addGroupButton.closest("[data-cond-group]");
                if (group) addConditionalGroup(row, group);
                return;
            }
            const removeGroupButton = event.target.closest("[data-cond-remove-group]");
            if (removeGroupButton) {
                const group = removeGroupButton.closest("[data-cond-group]");
                if (group && !group.closest("[data-cond-root]")?.isSameNode(group.parentElement)) {
                    group.remove();
                    updateConditionalQueryControls(row);
                }
                return;
            }
            const removeConditionButton = event.target.closest(".cond-remove-condition");
            if (removeConditionButton) {
                const condition = removeConditionButton.closest("[data-cond-condition]");
                const group = removeConditionButton.closest("[data-cond-group]");
                const siblingCount =
                    group?.querySelector(":scope > [data-cond-group-children]")?.children.length ||
                    0;
                if (condition && siblingCount > 1) {
                    condition.remove();
                }
                updateConditionalQueryControls(row);
            }
        });
        row.addEventListener("change", (event) => {
            if (!event.target.classList.contains("cond-query-type-selector")) return;
            updateConditionalConditionPlaceholders(row);
        });
        if (container.children.length === 1) {
            row.querySelector('[data-cond-field="name"]').value = tr(
                "probability.conditional.defaultQueryName",
                "North 10-12 HCP",
            );
            row.querySelector('[data-cond-field="condition-0-hand"]').value = "north";
            row.querySelector('[data-cond-field="condition-0-type"]').value = "hcp";
            row.querySelector('[data-cond-field="condition-0-value"]').value = "10-12";
        }
        updateConditionalQueryControls(row);
        return row;
    }

    function readConditionalBase() {
        const seen = new Set();
        const constraints = {};
        for (const hand of HANDS) {
            const cards = parseCardsText(document.getElementById(`cond-${hand}-cards`)?.value);
            for (const card of cards) {
                if (card.startsWith("-")) continue;
                if (seen.has(card))
                    throw new Error(
                        tr(
                            "probability.conditional.duplicateCard",
                            "Duplicate known card: {card}",
                            {
                                card: card.toUpperCase(),
                            },
                        ),
                    );
                seen.add(card);
            }
            const positiveCards = cards.filter((card) => !card.startsWith("-"));
            constraints[hand] = {
                mode: document.getElementById(`cond-${hand}-mode`)?.value || "feature",
                knownCards: cards,
                hcp: rangeFromInputs(`cond-${hand}-hcp`, 0, 37),
                suitRanges: SUITS.map((suit) => rangeFromInputs(`cond-${hand}-${suit.id}`, 0, 13)),
            };
            if (constraints[hand].mode === "hand" && positiveCards.length !== 13) {
                throw new Error(
                    tr(
                        "probability.conditional.fullHandNeeds13",
                        "{hand} full hand needs 13 cards.",
                        { hand: tr(`terms.${hand}`, hand) },
                    ),
                );
            }
            if (positiveCards.length > 13)
                throw new Error(
                    tr(
                        "probability.conditional.moreThan13",
                        "{hand} has more than 13 known cards.",
                        { hand: tr(`terms.${hand}`, hand) },
                    ),
                );
        }
        return constraints;
    }

    function handMatchesBase(cards, constraint) {
        if (constraint.mode === "hand") return cards.length === 13;
        const hcp = handHcp(cards);
        if (hcp < constraint.hcp.min || hcp > constraint.hcp.max) return false;
        const counts = handSuitCounts(cards);
        return counts.every(
            (count, index) =>
                count >= constraint.suitRanges[index].min &&
                count <= constraint.suitRanges[index].max,
        );
    }

    function readConditionalQueries() {
        const queries = Array.from(document.querySelectorAll("[data-cond-query]")).map((row, index) => {
            const get = (name) => row.querySelector(`[data-cond-field="${name}"]`)?.value || "";
            const advancedEventJson = get("event-json").trim();
            if (advancedEventJson) {
                let event;
                try {
                    event = JSON.parse(advancedEventJson);
                } catch (error) {
                    throw new Error(
                        tr(
                            "probability.conditional.invalidEventJson",
                            "Invalid advanced event JSON.",
                        ),
                    );
                }
                return {
                    name:
                        get("name") ||
                        tr("probability.conditional.queryFallback", "Query {number}", {
                            number: index + 1,
                        }),
                    event,
                };
            }
            const rootGroup = row.querySelector("[data-cond-root] > [data-cond-group]");
            const event = rootGroup
                ? readConditionalEventGroup(rootGroup)
                : readLegacyConditionalEvent(row);
            return {
                name:
                    get("name") ||
                    tr("probability.conditional.queryFallback", "Query {number}", {
                        number: index + 1,
                    }),
                event,
            };
        });
        return queries;
    }

    function readLegacyConditionalEvent(row) {
        const get = (name) => row.querySelector(`[data-cond-field="${name}"]`)?.value || "";
        const first = {
            hand: get("a-hand"),
            type: get("a-type"),
            value: get("a-value").trim(),
        };
        const second = {
            hand: get("b-hand"),
            type: get("b-type"),
            value: get("b-value").trim(),
        };
        const conditions = [first, second].filter((condition) => condition.value);
        if (conditions.length === 0) {
            throw new Error(tr("probability.conditional.emptyQuery", "Query has no conditions."));
        }
        if (conditions.length === 1) return conditions[0];
        return {
            op: get("join") === "or" ? "or" : "and",
            conditions,
        };
    }

    function readConditionalEventGroup(group) {
        if (!group) {
            throw new Error(tr("probability.conditional.emptyQuery", "Query has no conditions."));
        }
        const children = Array.from(
            group.querySelector(":scope > [data-cond-group-children]")?.children || [],
        )
            .map((child) => {
                if (child.matches("[data-cond-condition]")) return readConditionalCondition(child);
                if (child.matches("[data-cond-group]")) return readConditionalEventGroup(child);
                return null;
            })
            .filter(Boolean);
        if (children.length === 0) {
            throw new Error(tr("probability.conditional.emptyQuery", "Query has no conditions."));
        }
        if (children.length === 1) return children[0];
        const op = group.querySelector(":scope > div > [data-cond-group-op]")?.value || "and";
        return { op, conditions: children };
    }

    function readConditionalCondition(condition) {
        const field = (suffix) =>
            condition.querySelector(`[data-cond-field$="-${suffix}"]`)?.value || "";
        const atom = {
            hand: field("hand"),
            type: field("type"),
            value: field("value").trim(),
        };
        if (!atom.value) return null;
        if (!atom.hand || !atom.type) {
            throw new Error(
                tr(
                    "probability.conditional.incompleteCondition",
                    "Please complete every condition.",
                ),
            );
        }
        return atom;
    }

    async function runConditionalExact() {
        const status = document.getElementById("cond-status");
        const result = document.getElementById("cond-result");
        if (status)
            status.textContent = tr("probability.conditional.counting", "Counting exact deals...");
        if (result) result.innerHTML = "";
        try {
            const constraints = readConditionalBase();
            const queries = readConditionalQueries();
            if (queries.length === 0) {
                throw new Error(tr("probability.conditional.emptyQuery", "Query has no conditions."));
            }
            console.log({
                constraints,
                queries,
            });

            const response = await fetch(`${API_BASE}/conditional_probability`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    constraints,
                    queries,
                }),
            });
            const data = await response.json();
            if (!response.ok || data.error) {
                throw new Error(data.error || `Request failed: ${response.status}`);
            }

            const denominator = String(data.denominator || "0");
            const engineName = data.engine ? ` (${data.engine})` : "";
            if (status)
                status.textContent = tr(
                    "probability.conditional.counted",
                    "Exact deals counted: {denominator}{engine}",
                    {
                        denominator,
                        engine: engineName,
                    },
                );
            if (!result) return;
            if (denominator === "0") {
                result.innerHTML = `<div class="text-sm text-red-600">${tr("probability.conditional.noDeals", "No deals match the known conditions.")}</div>`;
                return;
            }

            const rows = Array.isArray(data.results) ? data.results : [];
            if (rows.length === 0) {
                result.innerHTML = `<div class="text-sm text-red-600">${tr("probability.conditional.noResults", "No query results were returned.")}</div>`;
                return;
            }
            result.innerHTML = `
                <table class="w-full result-table">
                    <thead><tr><th class="text-left">${tr("probability.conditional.event", "Event")}</th><th>${tr("probability.conditional.probability", "Probability")}</th><th>${tr("probability.conditional.exactFraction", "Exact fraction")}</th></tr></thead>
                    <tbody>
                        ${rows
                            .map((entry, index) => {
                                const probability = Number(entry?.probability);
                                const pct = Number.isFinite(probability) ? probability * 100 : 0;
                                const numerator = String(entry?.numerator ?? "0");
                                const fraction = String(
                                    entry?.fraction ?? `${numerator}/${denominator}`,
                                );
                                const name = String(
                                    entry?.name ||
                                        tr(
                                            "probability.conditional.queryFallback",
                                            "Query {number}",
                                            {
                                                number: index + 1,
                                            },
                                        ),
                                );
                                return `<tr><td class="text-left font-semibold">${name}</td><td>${pct.toFixed(4)}%</td><td>${fraction}</td></tr>`;
                            })
                            .join("")}
                    </tbody>
                </table>`;
        } catch (error) {
            if (status) status.textContent = "";
            const message = error instanceof Error ? error.message : String(error);
            if (result) result.innerHTML = `<div class="text-sm text-red-600">${message}</div>`;
        }
    }

    // --- Shared Card Rendering ---
    function renderCardInterface(
        containerPrefix,
        toggleCallback,
        stateObj,
        handsToRender = HANDS,
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
            const ddBadge = document.querySelector(`#hand-${hand} .count-badge`);
            if (ddBadge && containerPrefix === "container") {
                ddBadge.innerText = stateObj[hand].length;
                if (stateObj[hand].length === 13)
                    ddBadge.classList.replace("bg-slate-400", "bg-emerald-500");
                else ddBadge.classList.replace("bg-emerald-500", "bg-slate-400");
            }
            const sdBadge = document.querySelector(`#sd-mode-hand-${hand} .sd-count-badge`);
            if (sdBadge && containerPrefix === "sd-container") {
                sdBadge.innerText = `${stateObj[hand].length} / 13`;
                if (stateObj[hand].length === 13)
                    sdBadge.classList.replace("bg-slate-400", "bg-emerald-500");
                else sdBadge.classList.replace("bg-emerald-500", "bg-slate-400");
            }
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
                        `btn-${containerPrefix}-${hand}-${cardId}`,
                    );
                    if (!btn) return;

                    btn.classList.remove("selected", "taken");
                    if (myCards.includes(cardId)) {
                        btn.classList.add("selected");
                    } else {
                        // Logic to show 'taken' grey out
                        if (containerPrefix === "container") {
                            // Double Dummy: Check any other hand
                            if (findCardOwner(stateObj, cardId)) btn.classList.add("taken");
                        } else if (containerPrefix === "sd-container") {
                            // Single Dummy: Check opponent (N vs S)
                            const other = hand === "north" ? "south" : "north";
                            if (stateObj[other].includes(cardId)) btn.classList.add("taken");
                        }
                    }
                });
            });
        });
    }

    // --- DD State Logic ---
    function toggleCardDD(hand, cardId) {
        const btnId = `btn-container-${hand}-${cardId}`;
        const currentOwner = findCardOwner(ddState, cardId);
        if (currentOwner === hand) {
            ddState[hand] = ddState[hand].filter((c) => c !== cardId);
            triggerAnimation(btnId, "pop-animation", 150);
        } else if (currentOwner) {
            triggerAnimation(btnId, "shake-animation", 300);
            return;
        } else {
            if (ddState[hand].length >= 13) {
                showToast(tr("toasts.limit13", "You can assign up to 13 cards per hand."));
                triggerAnimation(btnId, "shake-animation", 300);
                return;
            }
            ddState[hand].push(cardId);
            triggerAnimation(btnId, "pop-animation", 150);
            checkAndAutoFillDD();
        }
        updateDDUI();
    }
    function checkAndAutoFillDD() {
        const hands = ["north", "south", "east", "west"];
        // 13枚ちょうど持っているハンドをカウント
        const fullHands = hands.filter((h) => ddState[h].length === 13);

        // 3人が確定し、かつ1人がまだ13枚未満の場合のみ実行
        if (fullHands.length === 3) {
            const emptyHand = hands.find((h) => ddState[h].length == 0);
            if (!emptyHand) return;

            // 全52枚のリストを作成
            const allPossibleCards = [];
            SUITS.forEach((suit) => {
                RANKS.forEach((rank) => {
                    allPossibleCards.push(suit.id + rank);
                });
            });

            // 現在どこかのハンドに割り当てられているカードをすべて取得
            const assignedCards = new Set();
            hands.forEach((h) => {
                ddState[h].forEach((c) => assignedCards.add(c));
            });

            // まだ誰にも持たれていないカードを抽出
            const remainingCards = allPossibleCards.filter((c) => !assignedCards.has(c));

            // 残りのカードがちょうど、最後の一人の不足分（13枚にするために必要な枚数）なら自動入力
            if (remainingCards.length > 0) {
                ddState[emptyHand] = [...ddState[emptyHand], ...remainingCards];
                updateDDUI();

                // 完了通知（必要に応じて）
                const handName = tr(`terms.${emptyHand}`, emptyHand);
                showToast(
                    currentLanguage === "ja"
                        ? `${handName}の残りのハンドを自動入力しました`
                        : `Automatically filled the rest of ${handName}'s hand.`,
                );
            }
        }
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
    }

    function convertPBNHand(handCards) {
        return SUITS.map((suit) => {
            const cardsInSuit = handCards
                .filter((c) => c.startsWith(suit.id))
                .map((c) => c.substr(1))
                .sort((a, b) => RANKS.indexOf(a) - RANKS.indexOf(b))
                .join("");
            return cardsInSuit || "";
        }).join(".");
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
            const suitsStr = convertPBNHand(handCards);
            parts.push(suitsStr);
        });
        return `N:${parts.join(" ")}`;
    }

    // --- API Calls ---
    async function runDoubleDummy() {
        let total = 0;
        HANDS.forEach((h) => (total += ddState[h].length));
        if (total !== 52) {
            showToast(tr("toasts.cards52", "All 52 cards must be assigned before analysis."));
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
            showToast(tr("toasts.errorPrefix", "Error: ") + e.message);
        } finally {
            setLoading(false);
        }
    }

    async function runSingleDummy() {
        setLoading(true);
        try {
            const tclParts = [];
            const pbnParts = { north: "...", south: "...", east: "...", west: "..." };

            const requestData = {
                pbn: "",
                advanced_tcl: "",
                shapes: {},
                hcp: {},
                shapePreset: {},
                simulations: 1000,
            };
            const simulations = parseInt(document.getElementById("sd-simulations").value) || 1000;
            const advancedTclInput = document.getElementById("sd-advanced-tcl").value;
            requestData.simulations = simulations;
            requestData.advanced_tcl = advancedTclInput;

            ["north", "south", "east", "west"].forEach((hand) => {
                if ((hand === "north" || hand === "south") && sdModes[hand] === "hand") {
                    if (sdState[hand].length > 0) {
                        const suitsStr = SUITS.map((suit) => {
                            return sdState[hand]
                                .filter((c) => c.startsWith(suit.id))
                                .map((c) => c.substr(1))
                                .sort((a, b) => RANKS.indexOf(a) - RANKS.indexOf(b))
                                .join("");
                        }).join(".");
                        pbnParts[hand] = suitsStr;
                    }
                } else {
                    const minH = document.getElementById(`sd-${hand}-hcp-min`).value || 0;
                    const maxH = document.getElementById(`sd-${hand}-hcp-max`).value || 37;
                    requestData.hcp[hand] = `${minH}-${maxH}`;

                    const sVal = document.getElementById(`sd-${hand}-s`).value || "0-13";
                    const hVal = document.getElementById(`sd-${hand}-h`).value || "0-13";
                    const dVal = document.getElementById(`sd-${hand}-d`).value || "0-13";
                    const cVal = document.getElementById(`sd-${hand}-c`).value || "0-13";
                    requestData.shapes[hand] = `${sVal},${hVal},${dVal},${cVal}`;

                    const preset = getShapePresetValue(`sd-${hand}-preset`);
                    requestData.shapePreset[hand] = preset;
                }
            });

            // const tclStr = `reject unless { ${tclParts.join(" && ")} }`;
            const finalPBN = `N:${pbnParts.north} ${pbnParts.east} ${pbnParts.south} ${pbnParts.west}`;
            requestData.pbn = finalPBN;

            console.log(requestData);

            const res = await fetch(`${API_BASE}/analyse_single_dummy`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(requestData),
            });
            const data = await res.json();
            console.log(data);
            if (data.error) throw new Error(data.error);
            renderSDResults(data.trick_distribution, data.simulations_run);
        } catch (e) {
            showToast(tr("toasts.errorPrefix", "Error: ") + e.message);
        } finally {
            setLoading(false);
        }
    }

    async function runLeadSolver() {
        const leader = document.getElementById("lead-leader").value;
        const leaderKey = leader.toLowerCase();

        const leaderCards = leadState[leaderKey];
        if (leaderCards.length !== 13) {
            showToast(
                tr(
                    "toasts.leaderNeed13",
                    "{leader}'s hand must contain exactly 13 cards (current: {count}).",
                    {
                        leader,
                        count: leaderCards.length,
                    },
                ),
            );
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

        const contractText = document.getElementById("lead-contract").value.trim().toUpperCase();
        if (!contractText) {
            showToast(tr("toasts.inputContract", "Enter a contract (e.g. 3NT)."));
            return;
        }
        const simulations = parseInt(document.getElementById("lead-simulations").value) || 100;
        const advancedTcl = document.getElementById("lead-advanced-tcl").value;

        const requestData = {
            leader_hand_pbn: suitsStr,
            leader: leader[0],
            contract: contractText,
            shapes: {},
            hcp: {},
            shapePreset: {},
            simulations: simulations,
            advanced_tcl: advancedTcl,
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

                const preset = getShapePresetValue(`lead-${h}-preset`);
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
            latestLeadResults = Array.isArray(data.leads) ? data.leads : [];
            latestLeadCount = simulations;
            renderLeadResults(latestLeadResults, simulations);
        } catch (e) {
            showToast(tr("toasts.errorPrefix", "Error: ") + e.message);
        } finally {
            setLoading(false);
        }
    }

    // --- Shared Helper for Distribution Table ---
    function createDistributionTable(dist) {
        // dist: array of 14 numbers (percentages)
        let tableHtml = '<table class="dist-table"><thead><tr>';
        for (let i = 0; i <= 13; i++) tableHtml += `<th>${i}</th>`;
        tableHtml += "</tr></thead><tbody><tr>";

        dist.forEach((pct) => {
            let cls = "";
            if (pct > 0) cls = "has-val";
            if (pct >= 20) cls = "high-val";
            tableHtml += `<td class="${cls}">${pct > 0 ? pct.toFixed(1) : ""}</td>`;
        });

        tableHtml += "</tr></tbody></table>";
        return tableHtml;
    }

    // --- Rendering Results ---
    function renderDDResults(tricks) {
        const tbody = document.getElementById("result-body-double");
        tbody.innerHTML = "";
        ["North", "South", "East", "West"].forEach((player) => {
            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td class="font-bold text-slate-700 bg-slate-50">${player}</td>
                <td class="font-bold text-slate-900 bg-slate-50">${tricks["No-Trump"][player]}</td>
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
        document.getElementById("sd-sim-count").innerText =
            `${tr("ui.samples", "Samples")}: ${count}`;
        container.innerHTML = "";

        const suitOrder = ["No-Trump", "Spades", "Hearts", "Diamonds", "Clubs"];

        suitOrder.forEach((suit) => {
            if (!distribution[suit]) return;

            const distData = distribution[suit];
            const card = document.createElement("div");
            card.className = "result-analysis-card mb-4";

            const suitInfo = SUITS.find((s) => s.name === suit) || {
                color: "suit-nt",
                label: "NT",
            };
            const suitLabel = suit === "No-Trump" ? "NT" : suitInfo.label;
            const suitColor = suit === "No-Trump" ? "suit-nt" : suitInfo.color;

            let html = `<h5 class="font-bold text-lg mb-3 flex items-center gap-2 ${suitColor}"><span class="text-xl">${suitLabel}</span> ${suit}</h5>`;

            ["North", "South"].forEach((player) => {
                const playerLabel = tr(`terms.${player.toLowerCase()}`, player);
                const dist = distData[player]; // Array of percentages
                const exp = dist.reduce((sum, pct, i) => sum + i * pct, 0) / 100;

                const gameTricks =
                    suit === "No-Trump" ? 9 : suit === "Spades" || suit === "Hearts" ? 10 : 11;
                const getProb = (min) =>
                    dist.reduce((sum, pct, i) => (i >= min ? sum + pct : sum), 0);

                const gameProb = getProb(gameTricks);
                const slamProb = getProb(12);
                const grandSlamProb = getProb(13);

                html += `<div class="mb-4 last:mb-0">
                    <div class="flex flex-wrap justify-between items-end mb-2 gap-2">
                        <div class="flex items-baseline gap-2">
                            <span class="result-player-label w-12">${playerLabel}</span>
                            <span class="result-meta-label">${tr("ui.avg", "Avg")}: <span class="result-avg-value">${exp.toFixed(
                                2,
                            )}</span></span>
                        </div>
                        <div class="flex gap-3 text-xs font-medium">
                            <span class="result-pill result-pill-game">${tr(
                                "ui.game",
                                "Game",
                            )}: ${Math.round(gameProb)}%</span>
                            <span class="result-pill result-pill-slam">${tr(
                                "ui.smallSlam",
                                "Small Slam",
                            )}: ${Math.round(slamProb)}%</span>
                            <span class="result-pill result-pill-slam">${tr(
                                "ui.grandSlam",
                                "Grand Slam",
                            )}: ${Math.round(grandSlamProb)}%</span>
                        </div>
                    </div>
                    ${createDistributionTable(dist)}
                </div>`;
            });

            card.innerHTML = html;
            container.appendChild(card);
        });

        document.getElementById("result-single").classList.remove("hidden");
        document.getElementById("result-single").scrollIntoView({ behavior: "smooth" });
    }

    function renderLeadResults(leads, count) {
        const container = document.getElementById("result-lead-content");
        document.getElementById("lead-sim-count").innerText = count;
        container.innerHTML = "";

        const sortedLeads = [...leads].sort((a, b) => {
            if (leadSortMode === "setprob") return b.per_of_set - a.per_of_set;
            return b.tricks - a.tricks;
        });

        sortedLeads.forEach((lead) => {
            const suitChar = lead.card[0];
            const rankChar = lead.card[1];
            const suitInfo = SUITS.find((s) => s.name[0] === suitChar) || {
                color: "text-black",
                label: suitChar,
            };

            // Normalize to percentages
            let dist = lead.per_of_trick;
            const total = dist.reduce((a, b) => a + b, 0);
            if (total > 0) {
                dist = dist.map((v) => (v / total) * 100);
            }

            const row = document.createElement("div");
            row.className = "result-analysis-card mb-3";
            row.innerHTML = `
                <div class="flex justify-between items-end mb-2">
                    <div class="flex items-baseline gap-2">
                        <span class="font-bold ${
                            suitInfo.color
                        } w-12 px-2 text-center bg-white border border-slate-200 rounded shadow-sm h-10 inline-flex items-center justify-center leading-none">
                            <span class="text-2xl">${suitInfo.label}</span><span class="text-xl">${rankChar}</span>
                        </span>
                        <div class="flex flex-col">
                            <span class="result-meta-label">${tr(
                                "ui.expTricks",
                                "Exp Tricks",
                            )}</span>
                            <span class="result-value-primary leading-none">${lead.tricks.toFixed(
                                2,
                            )}</span>
                        </div>
                    </div>
                    <div class="text-right">
                        <span class="result-meta-label block">${tr(
                            "ui.setProb",
                            "Set Prob",
                        )}</span>
                        <span class="result-value-accent">${lead.per_of_set.toFixed(1)}%</span>
                    </div>
                </div>
                ${createDistributionTable(dist)}
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
        // Mobile Nav
        const mobileNav = document.getElementById("mobile-nav");
        const mobileMenuBtn = document.getElementById("mobile-menu-btn");
        if (mobileMenuBtn && mobileNav) {
            mobileMenuBtn.onclick = () => {
                mobileNav.classList.toggle("hidden");
            };
        }

        document.addEventListener("click", (e) => {
            const routeTarget = e.target.closest("[data-route]");
            if (!routeTarget) return;
            const route = routeTarget.dataset.route;
            if (!route) return;
            e.preventDefault();
            navigateTo(route);
            if (mobileNav) mobileNav.classList.add("hidden");
        });

        const switchers = ["lang-en", "lang-ja", "lang-en-mobile", "lang-ja-mobile"];
        switchers.forEach((id) => {
            const btn = document.getElementById(id);
            if (!btn) return;
            btn.addEventListener("click", async () => {
                const nextLang = id.includes("ja") ? "ja" : "en";
                if (nextLang === currentLanguage) return;
                await setLanguage(nextLang, { persist: true, refreshUI: true });
                const localizedPath = buildLocalizedPath(nextLang, currentRoutePath);
                history.pushState({}, "", localizedPath);
                navigateTo(currentRoutePath, false);
            });
        });

        // SD Mode Switches
        document.querySelectorAll(".sd-mode-switch").forEach((btn) => {
            btn.onclick = (e) => toggleSDMode(e.target.dataset.hand, e.target.dataset.mode);
        });

        // Run Buttons
        const runDoubleBtn = document.getElementById("btn-run-double");
        const runSingleBtn = document.getElementById("btn-run-single");
        const runLeadBtn = document.getElementById("btn-run-lead");
        if (runDoubleBtn) runDoubleBtn.onclick = runDoubleDummy;
        if (runSingleBtn) runSingleBtn.onclick = runSingleDummy;
        if (runLeadBtn) runLeadBtn.onclick = runLeadSolver;

        // Lead UI Update Event
        const leadLeader = document.getElementById("lead-leader");
        if (leadLeader) leadLeader.onchange = updateLeadModeUI;

        const leadSort = document.getElementById("lead-sort");
        if (leadSort) {
            leadSort.value = leadSortMode;
            leadSort.addEventListener("change", () => {
                leadSortMode = leadSort.value === "setprob" ? "setprob" : "tricks";
                if (latestLeadResults.length > 0) {
                    renderLeadResults(latestLeadResults, latestLeadCount);
                }
            });
        }

        document.querySelectorAll("[data-reference-tab]").forEach((btn) => {
            btn.addEventListener("click", () => {
                if (!(btn instanceof HTMLElement)) return;
                navigateTo(getReferenceTabRoute(btn.dataset.referenceTab || "probability"));
            });
        });

        document.querySelectorAll("[data-prob-section-toggle]").forEach((btn) => {
            btn.addEventListener("click", () => {
                if (!(btn instanceof HTMLElement)) return;
                const isOpen = btn.getAttribute("aria-expanded") === "true";
                setProbabilitySectionOpen(btn, !isOpen);
            });
        });

        const condAddQuery = document.getElementById("cond-add-query");
        if (condAddQuery) condAddQuery.addEventListener("click", () => addConditionalQuery());
        const condRun = document.getElementById("cond-run");
        if (condRun) condRun.addEventListener("click", runConditionalExact);

        const vpBoardsInput = document.getElementById("vp-boards-input");
        if (vpBoardsInput) {
            vpBoardsInput.addEventListener("change", () => setVpBoardCount(vpBoardsInput.value));
            vpBoardsInput.addEventListener("blur", () => setVpBoardCount(vpBoardsInput.value));
            vpBoardsInput.addEventListener("keydown", (event) => {
                if (event.key !== "Enter") return;
                setVpBoardCount(vpBoardsInput.value);
            });
        }

        document.querySelectorAll("[data-vp-boards]").forEach((btn) => {
            btn.addEventListener("click", () => {
                if (!(btn instanceof HTMLElement)) return;
                setVpBoardCount(btn.dataset.vpBoards || "");
            });
        });

        const qdropResult = document.getElementById("prob-finesse-result");
        if (qdropResult) {
            qdropResult.addEventListener("click", (event) => {
                const target = event.target;
                if (!(target instanceof Element)) return;
                const close = target.closest("[data-qdrop-dialog-close]");
                if (close) {
                    setQDropDialogOpen(false);
                    return;
                }
                const toggle = target.closest("[data-qdrop-fit]");
                if (!toggle) return;
                const nextFit = toggle.getAttribute("data-qdrop-fit") || "";
                if (!nextFit) return;
                openQDropComparisonDialog(nextFit);
            });
        }

        document.addEventListener("keydown", (event) => {
            if (event.key !== "Escape") return;
            const dialog = document.getElementById("qdrop-compare-dialog");
            if (!dialog || dialog.classList.contains("hidden")) return;
            setQDropDialogOpen(false);
        });
    }
});
