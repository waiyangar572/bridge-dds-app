document.addEventListener("DOMContentLoaded", () => {
    // --- Constants ---
    const API_BASE = "https://bridge-analyzer-backend-338315263430.asia-northeast1.run.app/api";
    const SITE_ORIGIN = "https://bridge-analyzer.web.app";
    const DEFAULT_OG_IMAGE = `${SITE_ORIGIN}/favicon-96x96.png`;
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
    let qdropFlippedGroups = new Set();
    let qdropSelectedFitByGroup = { "8": "44", "9": "54" };

    const NAV_KEYS = ["double", "single", "lead", "probability"];
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
        "/probability": {
            type: "tool",
            metaKey: "probability",
            tab: "probability",
            nav: "probability",
            viewId: "view-probability",
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
        setNodeText("#nav-probability", tr("nav.probability", "Probability"));
        setNodeText("#mob-nav-double", tr("nav.double", "Double Dummy"));
        setNodeText("#mob-nav-single", tr("nav.single", "Single Dummy"));
        setNodeText("#mob-nav-lead", tr("nav.lead", "Opening Lead"));
        setNodeText("#mob-nav-probability", tr("nav.probability", "Probability"));
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
        setNodeText("#probability-title", tr("probability.title", "Probability Quick Check"));
        setNodeText(
            "#probability-lead",
            tr("probability.lead", "Frequently used bridge probabilities at a glance."),
        );
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
                "Tap a holding inside the 8/9-card fit card to flip and view its line comparison.",
            ),
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
            "Double Dummy Solver",
            "Single Dummy Solver",
            "Opening Lead Analyzer",
            "Probability Table",
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
        updateProbabilityQDropResult();
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

    function setJsonLd(routePath, title, description, canonicalUrl) {
        const route = ROUTES[routePath] || ROUTES[DEFAULT_ROUTE];
        let script = document.getElementById("seo-json-ld");
        if (!script) {
            script = document.createElement("script");
            script.id = "seo-json-ld";
            script.type = "application/ld+json";
            document.head.appendChild(script);
        }

        const type = route.type === "tool" ? "SoftwareApplication" : "WebPage";
        const jsonLd =
            type === "SoftwareApplication"
                ? {
                      "@context": "https://schema.org",
                      "@type": "SoftwareApplication",
                      name: title,
                      applicationCategory: "GameApplication",
                      operatingSystem: "Web",
                      description,
                      url: canonicalUrl,
                      inLanguage: currentLanguage,
                      offers: {
                          "@type": "Offer",
                          price: "0",
                          priceCurrency: "USD",
                      },
                      isAccessibleForFree: true,
                      browserRequirements: "Requires JavaScript. Works on modern browsers.",
                  }
                : {
                      "@context": "https://schema.org",
                      "@type": "WebPage",
                      name: title,
                      description,
                      url: canonicalUrl,
                      inLanguage: currentLanguage,
                      isPartOf: {
                          "@type": "WebSite",
                          name: "Bridge Solver",
                          url: `${SITE_ORIGIN}/`,
                      },
                  };

        script.textContent = JSON.stringify(jsonLd);
    }

    function setSeoMeta(routePath) {
        const route = ROUTES[routePath] || ROUTES[DEFAULT_ROUTE];
        const title = tr(`meta.${route.metaKey}.title`, "Bridge Solver");
        const description = tr(
            `meta.${route.metaKey}.description`,
            "Contract bridge analysis tools.",
        );
        const localizedPath = buildLocalizedPath(currentLanguage, route.path || routePath);
        const canonicalUrl = `${SITE_ORIGIN}${localizedPath}`;

        setMeta(title, description);
        upsertLink("canonical", canonicalUrl);
        upsertMetaByName(
            "robots",
            "index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1",
        );
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
        setJsonLd(route.path || routePath, title, description, canonicalUrl);
        setAlternateLinks(routePath);
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
        if (ROUTES[normalizedPath]) return { ...ROUTES[normalizedPath], path: normalizedPath };
        return { ...ROUTES[DEFAULT_ROUTE], path: DEFAULT_ROUTE };
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

        const activeKey = route.type === "tool" ? route.tab : route.nav;
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
        const routePath = ROUTES[parsed.routePath] ? parsed.routePath : DEFAULT_ROUTE;
        await setLanguage(preferredLang, { persist: false, refreshUI: false });
        applyTranslations();

        const expectedPath = buildLocalizedPath(preferredLang, routePath);
        if (normalizePath(window.location.pathname) !== normalizePath(expectedPath)) {
            history.replaceState({}, "", expectedPath);
        }
        navigateTo(routePath, false);

        window.addEventListener("popstate", async () => {
            const popParsed = parseLocalizedPath(window.location.pathname);
            const popLang = popParsed.lang || getPreferredLanguage();
            const popRoutePath = ROUTES[popParsed.routePath] ? popParsed.routePath : DEFAULT_ROUTE;
            if (popLang !== currentLanguage) {
                await setLanguage(popLang, { persist: false, refreshUI: true });
            }
            navigateTo(popRoutePath, false);
        });
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
        const otherHand = hand === "north" ? "south" : "north";

        // 1. If I already have it, remove it
        if (sdState[hand].includes(cardId)) {
            sdState[hand] = sdState[hand].filter((c) => c !== cardId);
        }
        // 2. If opponent has it, steal it (remove from them, add to me)
        else if (sdState[otherHand].includes(cardId)) {
            if (sdState[hand].length >= 13) {
                showToast(tr("toasts.limit13", "You can assign up to 13 cards per hand."));
                return;
            }
            sdState[otherHand] = sdState[otherHand].filter((c) => c !== cardId);
            sdState[hand].push(cardId);
        }
        // 3. Else, just add it
        else {
            if (sdState[hand].length >= 13) {
                showToast(tr("toasts.limit13", "You can assign up to 13 cards per hand."));
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
        } else {
            if (leadState[hand].length >= 13) {
                showToast(tr("toasts.limit13", "You can assign up to 13 cards per hand."));
                return;
            }
            leadState[hand].push(cardId);
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

    function computeQLineProbability(missing, model) {
        const states = buildQMissingStates(missing);
        const isQDrop = (state) => state.qLen <= 2;
        const isOnsideFourZero = (state) => state.side === "onside" && state.qLen === missing;

        const win = states.reduce((sum, state) => {
            let ok = false;
            if (model === "44-optimal") {
                ok = state.side === "onside" || (state.side === "offside" && state.qLen === 1);
            } else if (model === "53-optimal") {
                ok =
                    (state.side === "onside" && state.qLen <= 4) ||
                    (state.side === "offside" && state.qLen === 1);
            } else if (model === "62-double-finesse") {
                ok = state.side === "onside" && state.qLen <= 4;
            } else if (model == "62-cash-and-finesse") {
                ok =
                    (state.side === "onside" && state.qLen <= 3) ||
                    (state.side === "offside" && state.qLen === 1);
            } else if (model === "9fit-ak-drop-or-onside-40") {
                ok = isQDrop(state) || isOnsideFourZero(state);
            } else if (model === "9fit-drop-only") {
                ok = isQDrop(state);
            } else if (model === "drop-only") {
                ok = isQDrop(state);
            } else if (model === "onside-only") {
                ok = state.side === "onside";
            }
            return ok ? sum + state.p : sum;
        }, 0);

        return win * 100;
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
                probability: computeQLineProbability(5, "44-optimal"),
            },
            {
                key: "53",
                fit: tr("probability.qdrop.fit53", "5-3 fit"),
                line: tr(
                    "probability.qdrop.line53",
                    "Cash one top honor then finesse. Even with onside Q, a 5-0 break cannot all-win.",
                ),
                probability: computeQLineProbability(5, "53-optimal"),
            },
            {
                key: "62",
                fit: tr("probability.qdrop.fit62", "6-2 fit"),
                line: tr(
                    "probability.qdrop.line62",
                    "Do not cash on Q side; take two finesses. All-win when onside Q is 4 or fewer.",
                ),
                probability: computeQLineProbability(5, "62-double-finesse"),
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
                probability: computeQLineProbability(4, "9fit-ak-drop-or-onside-40"),
            },
            {
                key: "63",
                fit: tr("probability.qdrop.fit63", "6-3 fit"),
                line: tr(
                    "probability.qdrop.line63",
                    "Cash A and K. Win on Q-drop or onside 4-0 only.",
                ),
                probability: computeQLineProbability(4, "9fit-ak-drop-or-onside-40"),
            },
            {
                key: "72",
                fit: tr("probability.qdrop.fit72", "7-2 fit"),
                line: tr("probability.qdrop.line72", "Play for Q-drop only."),
                probability: computeQLineProbability(4, "9fit-drop-only"),
            },
        ];

        return { rows8, rows9 };
    }

    function getQDropComparisonRows(fitKey) {
        if (!fitKey) return null;
        const bestTag = tr("probability.qdrop.bestTag", "Best");
        const make = (lineKey, fallback, missing, model, isBest = false) => ({
            line: `${tr(lineKey, fallback)}${
                isBest
                    ? ` <span class="ml-2 inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">${bestTag}</span>`
                    : ""
            }`,
            probability: computeQLineProbability(missing, model),
        });

        if (fitKey === "44") {
            return {
                fit: tr("probability.qdrop.fit44", "4-4 fit"),
                rows: [
                    make(
                        "probability.qdrop.line44",
                        "Cash A then finesse.",
                        5,
                        "44-optimal",
                        true,
                    ),
                    make(
                        "probability.qdrop.compareLineFinesseFirst",
                        "Take finesse first.",
                        5,
                        "onside-only",
                    ),
                    make(
                        "probability.qdrop.compareLineCashAK",
                        "Cash AK and play for drop.",
                        5,
                        "drop-only",
                    ),
                ],
            };
        }
        if (fitKey === "53") {
            return {
                fit: tr("probability.qdrop.fit53", "5-3 fit"),
                rows: [
                    make(
                        "probability.qdrop.line53",
                        "Cash A then finesse.",
                        5,
                        "53-optimal",
                        true,
                    ),
                    make(
                        "probability.qdrop.compareLineDoubleFinesse",
                        "Take two finesses.",
                        5,
                        "62-double-finesse",
                    ),
                    make(
                        "probability.qdrop.compareLineCashAK",
                        "Cash AK and play for drop.",
                        5,
                        "drop-only",
                    ),
                ],
            };
        }
        if (fitKey === "62") {
            return {
                fit: tr("probability.qdrop.fit62", "6-2 fit"),
                rows: [
                    make(
                        "probability.qdrop.line62",
                        "Do not cash on Q side; take two finesses.",
                        5,
                        "62-double-finesse",
                        true,
                    ),
                    make(
                        "probability.qdrop.compareLineCashAThenFinesse",
                        "Cash A then finesse.",
                        5,
                        "62-cash-and-finesse",
                    ),
                    make(
                        "probability.qdrop.compareLineCashAK",
                        "Cash AK and play for drop.",
                        5,
                        "drop-only",
                    ),
                ],
            };
        }
        if (fitKey === "54") {
            return {
                fit: tr("probability.qdrop.fit54", "5-4 fit"),
                rows: [
                    make(
                        "probability.qdrop.line54",
                        "Cash A and K.",
                        4,
                        "9fit-ak-drop-or-onside-40",
                        true,
                    ),
                    make(
                        "probability.qdrop.compareLineCashAK",
                        "Cash AK and play for drop.",
                        4,
                        "drop-only",
                    ),
                    make(
                        "probability.qdrop.compareLineFinesseFirst",
                        "Take finesse first.",
                        4,
                        "onside-only",
                    ),
                ],
            };
        }
        if (fitKey === "63") {
            return {
                fit: tr("probability.qdrop.fit63", "6-3 fit"),
                rows: [
                    make(
                        "probability.qdrop.line63",
                        "Cash A and K.",
                        4,
                        "9fit-ak-drop-or-onside-40",
                        true,
                    ),
                    make(
                        "probability.qdrop.compareLineCashAK",
                        "Cash AK and play for drop.",
                        4,
                        "drop-only",
                    ),
                    make(
                        "probability.qdrop.compareLineFinesseFirst",
                        "Take finesse first.",
                        4,
                        "onside-only",
                    ),
                ],
            };
        }
        if (fitKey === "72") {
            return {
                fit: tr("probability.qdrop.fit72", "7-2 fit"),
                rows: [
                    make(
                        "probability.qdrop.line72",
                        "Play for Q-drop only.",
                        4,
                        "9fit-drop-only",
                        true,
                    ),
                    make(
                        "probability.qdrop.compareLineFinesseFirst",
                        "Take finesse first.",
                        4,
                        "onside-only",
                    ),
                ],
            };
        }
        return null;
    }

    function getQDropCompareMarkup(fitKey) {
        const comparison = getQDropComparisonRows(fitKey);
        if (!comparison) return { fit: "", rowsHtml: "" };
        const bestProbability = Math.max(...comparison.rows.map((cmp) => cmp.probability));
        const rowsHtml = comparison.rows
            .map((cmp) => {
                const diff = bestProbability - cmp.probability;
                return `
                <li class="qdrop-card-compare-row">
                    <div class="qdrop-card-compare-line">${cmp.line}</div>
                    <div class="qdrop-card-compare-meta">
                        <span class="qdrop-card-compare-prob">${cmp.probability.toFixed(2)}%</span>
                        <span class="qdrop-card-compare-diff ${diff <= 0.005 ? "is-best" : ""}">${
                            diff <= 0.005 ? "±0.00pt" : `-${diff.toFixed(2)}pt`
                        }</span>
                    </div>
                </li>
            `;
            })
            .join("");
        return { fit: comparison.fit, rowsHtml };
    }

    function updateProbabilityQDropResult() {
        const container = document.getElementById("prob-finesse-result");
        if (!container) return;

        const { rows8, rows9 } = getQDropBestRows();
        const renderGroupCard = (groupKey, title, rows) => {
            const defaultFitKey = rows[0]?.key || "";
            const selectedFitKey = rows.some((row) => row.key === qdropSelectedFitByGroup[groupKey])
                ? qdropSelectedFitByGroup[groupKey]
                : defaultFitKey;
            qdropSelectedFitByGroup[groupKey] = selectedFitKey;
            const selectedRow = rows.find((row) => row.key === selectedFitKey) || rows[0];
            const compareContent = getQDropCompareMarkup(selectedFitKey);
            const fitOptions = rows
                .map(
                    (row) => `
                <button
                    type="button"
                    data-qdrop-fit-option="${row.key}"
                    data-qdrop-group="${groupKey}"
                    class="qdrop-fit-option ${row.key === selectedFitKey ? "is-active" : ""}">
                    <span class="qdrop-fit-option-head">
                        <span>${row.fit}</span>
                        <span>${row.probability.toFixed(2)}%</span>
                    </span>
                    <span class="qdrop-fit-option-line">${row.line}</span>
                </button>
            `,
                )
                .join("");
            const flipped = qdropFlippedGroups.has(groupKey);
            return `
            <div class="qdrop-group-block">
                <div class="result-meta-label mb-1">${title}</div>
                <div
                    class="qdrop-fit-card qdrop-group-card ${flipped ? "is-flipped" : ""}"
                    data-qdrop-group-card="${groupKey}"
                    aria-pressed="${flipped ? "true" : "false"}">
                    <div class="qdrop-fit-card-inner">
                        <div class="qdrop-fit-card-face qdrop-fit-card-front">
                            <div class="qdrop-fit-card-head">
                                <span class="qdrop-fit-card-group-title">${title}</span>
                                <span class="qdrop-fit-card-caret">${flipped ? "◀" : "▶"}</span>
                            </div>
                            <span class="qdrop-fit-card-label">${tr(
                                "probability.qdrop.bestPlayLine",
                                "Best play line by fit",
                            )}</span>
                            <div class="qdrop-fit-option-list">${fitOptions}</div>
                        </div>
                        <div class="qdrop-fit-card-face qdrop-fit-card-back">
                            <div class="qdrop-fit-card-head">
                                <div class="qdrop-fit-card-back-title">${tr(
                                    "probability.qdrop.compareResultTitle",
                                    "Comparison for {fit}",
                                    { fit: compareContent.fit || selectedRow.fit },
                                )}</div>
                            </div>
                            <ul class="qdrop-card-compare-list">${compareContent.rowsHtml}</ul>
                        </div>
                    </div>
                </div>
            </div>
            `;
        };

        container.innerHTML = `
            <div class="qdrop-card-grid">
                ${renderGroupCard("8", tr("probability.qdrop.group8Title", "8-card fit group"), rows8)}
                ${renderGroupCard("9", tr("probability.qdrop.group9Title", "9-card fit group"), rows9)}
            </div>
            <div class="text-xs text-slate-500 mt-2">${tr(
                "probability.qdrop.note",
                "Assumption: Q is missing. Each row shows all-win probability for its stated play line.",
            )}</div>
        `;
    }

    function initProbabilityUI() {
        updateProbabilitySuitResult();
        updateProbabilityQDropResult();
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
        const currentOwner = findCardOwner(ddState, cardId);
        if (currentOwner === hand) {
            ddState[hand] = ddState[hand].filter((c) => c !== cardId);
        } else if (currentOwner) {
            if (ddState[hand].length >= 13) {
                showToast(tr("toasts.already13", "This hand already has 13 cards."));
                return;
            }
            ddState[currentOwner] = ddState[currentOwner].filter((c) => c !== cardId);
            ddState[hand].push(cardId);
        } else {
            if (ddState[hand].length >= 13) {
                showToast(tr("toasts.limit13", "You can assign up to 13 cards per hand."));
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
                        if (sdState[hand].length > 0) {
                            throw new Error(
                                tr("toasts.handNeed13", "{hand} must contain exactly 13 cards.", {
                                    hand: tr(`terms.${hand}`, hand),
                                }),
                            );
                        }
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

        const qdropResult = document.getElementById("prob-finesse-result");
        if (qdropResult) {
            qdropResult.addEventListener("click", (event) => {
                const target = event.target;
                if (!(target instanceof Element)) return;
                const option = target.closest("[data-qdrop-fit-option]");
                if (option instanceof HTMLElement) {
                    const fitKey = option.getAttribute("data-qdrop-fit-option") || "";
                    const groupKey = option.getAttribute("data-qdrop-group") || "";
                    if (!fitKey || !groupKey) return;

                    qdropSelectedFitByGroup[groupKey] = fitKey;
                    qdropFlippedGroups.add(groupKey);
                    const card = option.closest("[data-qdrop-group-card]");
                    if (!(card instanceof HTMLElement)) return;

                    card.querySelectorAll("[data-qdrop-fit-option]").forEach((btn) => {
                        btn.classList.toggle(
                            "is-active",
                            btn.getAttribute("data-qdrop-fit-option") === fitKey,
                        );
                    });
                    const compareContent = getQDropCompareMarkup(fitKey);
                    const backTitle = card.querySelector(".qdrop-fit-card-back-title");
                    if (backTitle) {
                        backTitle.textContent = tr(
                            "probability.qdrop.compareResultTitle",
                            "Comparison for {fit}",
                            { fit: compareContent.fit },
                        );
                    }
                    const compareList = card.querySelector(".qdrop-card-compare-list");
                    if (compareList) compareList.innerHTML = compareContent.rowsHtml;

                    card.classList.add("is-flipped");
                    card.setAttribute("aria-pressed", "true");
                    const caret = card.querySelector(".qdrop-fit-card-caret");
                    if (caret) caret.textContent = "◀";
                    return;
                }

                const groupCard = target.closest("[data-qdrop-group-card]");
                if (groupCard instanceof HTMLElement && groupCard.classList.contains("is-flipped")) {
                    const groupCardKey = groupCard.getAttribute("data-qdrop-group-card") || "";
                    if (groupCardKey) qdropFlippedGroups.delete(groupCardKey);
                    groupCard.classList.remove("is-flipped");
                    groupCard.setAttribute("aria-pressed", "false");
                    const groupCaret = groupCard.querySelector(".qdrop-fit-card-caret");
                    if (groupCaret) groupCaret.textContent = "▶";
                }
            });
        }
    }
});
