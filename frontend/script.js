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
    let activeMobileHand = "north";
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

    const NAV_KEYS = ["double", "single", "lead"];
    const VIEW_IDS = ["view-double", "view-single", "view-lead", "view-privacy", "view-about", "view-contact"];
    const ROUTES = {
        "/double-dummy": {
            type: "tool",
            metaKey: "double-dummy",
            tab: "double",
            nav: "double",
            viewId: "view-double"
        },
        "/single-dummy": {
            type: "tool",
            metaKey: "single-dummy",
            tab: "single",
            nav: "single",
            viewId: "view-single"
        },
        "/opening-lead": {
            type: "tool",
            metaKey: "opening-lead",
            tab: "lead",
            nav: "lead",
            viewId: "view-lead"
        },
        "/privacy": {
            type: "page",
            metaKey: "privacy",
            viewId: "view-privacy"
        },
        "/about": {
            type: "page",
            metaKey: "about",
            viewId: "view-about"
        },
        "/contact": {
            type: "page",
            metaKey: "contact",
            viewId: "view-contact"
        }
    };

    // --- Init ---
    lucide.createIcons();
    if (document.getElementById("view-double")) {
        initDoubleDummyUI();
        initSingleDummyUI();
        initLeadSolverUI();
    }
    initShapePresetMajorToggles();
    setupEventListeners();
    bootstrapApp();

    function getNestedValue(obj, path) {
        return path.split(".").reduce((acc, key) => (acc && acc[key] !== undefined ? acc[key] : undefined), obj);
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
            { id: "lang-ja-mobile", active: !isEn }
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
        setNodeText("#mob-nav-double", tr("nav.double", "Double Dummy"));
        setNodeText("#mob-nav-single", tr("nav.single", "Single Dummy"));
        setNodeText("#mob-nav-lead", tr("nav.lead", "Opening Lead"));
        setNodeText("#btn-run-double-text", tr("buttons.analyze", "Analyze"));
        setNodeText("#btn-run-single-text", tr("buttons.analyze", "Analyze"));
        setNodeText("#btn-run-lead-text", tr("buttons.analyze", "Analyze"));
        setNodeText("#mobile-analyze-text", tr("buttons.mobileAnalyze", "Analyze"));
        setNodeText("#mobile-active-label", `${tr("ui.editing", "Editing")}: ${tr("terms.north", "North")}`);
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

        setNodeTexts("#view-double section h3, #view-single section h3, #view-lead section h3", [
            currentLanguage === "ja" ? "このツールについて (Overview)" : "About this tool (Overview)",
            currentLanguage === "ja" ? "このツールについて (Overview)" : "About this tool (Overview)",
            currentLanguage === "ja" ? "このツールについて (Overview)" : "About this tool (Overview)"
        ]);
        setNodeTexts("#view-double section h4, #view-single section h4, #view-lead section h4", [
            currentLanguage === "ja" ? "使い方 (How to use)" : "How to use",
            currentLanguage === "ja" ? "用語解説 (Glossary)" : "Glossary",
            currentLanguage === "ja" ? "使い方 (How to use)" : "How to use",
            currentLanguage === "ja" ? "用語解説 (Glossary)" : "Glossary",
            currentLanguage === "ja" ? "使い方 (How to use)" : "How to use",
            currentLanguage === "ja" ? "用語解説 (Glossary)" : "Glossary"
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
            tr("footer.privacy", "Privacy Policy"),
            tr("footer.about", "About Us"),
            tr("footer.contact", "Contact")
        ]);

        document.querySelectorAll('option[value="any"]').forEach((el) => (el.textContent = tr("select.any", "Any")));
        document.querySelectorAll('option[value="balanced"]').forEach((el) => (el.textContent = tr("select.balanced", "Balanced")));
        document.querySelectorAll('option[value="semiBalanced"]').forEach((el) => (el.textContent = tr("select.semiBalanced", "Semi-balanced")));
        document.querySelectorAll('option[value="unbalanced"]').forEach((el) => (el.textContent = tr("select.unbalanced", "Unbalanced")));
        document.querySelectorAll(".shape-major-label").forEach((el) => (el.textContent = tr("select.fiveCardMajor", "5-card major")));
        document.querySelectorAll('.shape-major-btn[data-allow="yes"]').forEach((el) => (el.textContent = tr("select.yes", "Yes")));
        document.querySelectorAll('.shape-major-btn[data-allow="no"]').forEach((el) => (el.textContent = tr("select.no", "No")));
        setNodeText("#glossary-double-term-1", tr("glossaryTerms.double1", "Double Dummy"));
        setNodeText("#glossary-single-term-1", tr("glossaryTerms.single1", "Balanced Hand"));
        setNodeText("#glossary-single-term-2", tr("glossaryTerms.single2", "Semi-balanced Hand"));
        setNodeText("#glossary-lead-term-1", tr("glossaryTerms.lead1", "Balanced Hand"));
        setNodeText("#glossary-lead-term-2", tr("glossaryTerms.lead2", "Semi-balanced Hand"));
        setNodeText("#glossary-lead-term-3", tr("glossaryTerms.lead3", "Set Probability"));
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
                          priceCurrency: "USD"
                      },
                      isAccessibleForFree: true,
                      browserRequirements: "Requires JavaScript. Works on modern browsers."
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
                          url: `${SITE_ORIGIN}/`
                      }
                  };

        script.textContent = JSON.stringify(jsonLd);
    }

    function setSeoMeta(routePath) {
        const route = ROUTES[routePath] || ROUTES[DEFAULT_ROUTE];
        const title = tr(`meta.${route.metaKey}.title`, "Bridge Solver");
        const description = tr(`meta.${route.metaKey}.description`, "Contract bridge analysis tools.");
        const localizedPath = buildLocalizedPath(currentLanguage, route.path || routePath);
        const canonicalUrl = `${SITE_ORIGIN}${localizedPath}`;

        setMeta(title, description);
        upsertLink("canonical", canonicalUrl);
        upsertMetaByName("robots", "index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1");
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
        document.querySelectorAll('link[rel="alternate"][data-hreflang="true"]').forEach((node) => node.remove());
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
        ["double", "single", "lead"].forEach((t) => {
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

        // Mobile Keyboard Logic
        const kb = document.getElementById("mobile-keyboard");
        if (tabName === "double") {
            if (window.innerWidth < 768 && kb) kb.classList.remove("translate-y-full");
        } else {
            if (kb) kb.classList.add("translate-y-full");
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
                hasLangPrefix: true
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

        const kb = document.getElementById("mobile-keyboard");
        if (route.type !== "tool" || route.tab !== "double") {
            if (kb) kb.classList.add("translate-y-full");
        }
    }

    function navigateTo(path, pushHistory = true) {
        const route = getRoute(path);
        const localizedPath = buildLocalizedPath(currentLanguage, route.path);
        if (pushHistory && normalizePath(window.location.pathname) !== normalizePath(localizedPath)) {
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
        const presetSelects = document.querySelectorAll('select[id^="sd-"][id$="-preset"], select[id^="lead-"][id$="-preset"]');

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
        // renderMobileKeyboard();
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
            south: tr("terms.west", "West")
        };
        document.getElementById("lead-declarer-display").innerText =
            tr("ui.declarerAuto", "{declarer} (auto)", { declarer: mapping[leader] });
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
                        `btn-${containerPrefix}-${hand}-${cardId}`
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

    // function renderMobileKeyboard() {
    //     SUITS.forEach((suit) => {
    //         const container = document.getElementById(`mobile-keys-${suit.id}`);
    //         if (!container) return;
    //         const label = document.createElement("div");
    //         label.className = `w-8 h-10 flex items-center justify-center font-bold ${suit.color} bg-slate-50 border border-slate-200 rounded shrink-0 text-sm`;
    //         label.innerHTML = suit.label;
    //         container.appendChild(label);

    //         RANKS.forEach((rank) => {
    //             const cardId = suit.id + rank;
    //             const btn = document.createElement("button");
    //             btn.id = `mob-btn-${cardId}`;
    //             btn.innerText = rank;
    //             btn.className =
    //                 "w-8 h-10 bg-white border border-slate-200 rounded shadow-sm font-medium active:bg-slate-100 shrink-0 text-slate-700 transition-colors";
    //             btn.onclick = () => toggleCardDD(activeMobileHand, cardId);
    //             container.appendChild(btn);
    //         });
    //     });
    // }

    function setMobileActive(hand) {
        activeMobileHand = hand;
        document.getElementById("mobile-active-label").innerText = `${tr("ui.editing", "Editing")}: ${tr(
            `terms.${hand}`,
            hand
        )}`;
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
                                    hand: tr(`terms.${hand}`, hand)
                                })
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
                tr("toasts.leaderNeed13", "{leader}'s hand must contain exactly 13 cards (current: {count}).", {
                    leader,
                    count: leaderCards.length
                })
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
            renderLeadResults(data.leads, data.simulations_run);
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
        document.getElementById("sd-sim-count").innerText = `${tr("ui.samples", "Samples")}: ${count}`;
        container.innerHTML = "";

        const suitOrder = ["No-Trump", "Spades", "Hearts", "Diamonds", "Clubs"];

        suitOrder.forEach((suit) => {
            if (!distribution[suit]) return;

            const distData = distribution[suit];
            const card = document.createElement("div");
            card.className = "bg-white border border-slate-200 rounded-lg p-4 mb-4 shadow-sm";

            const suitInfo = SUITS.find((s) => s.name === suit) || {
                color: "text-indigo-600",
                label: "NT",
            };
            const suitLabel = suit === "No-Trump" ? "NT" : suitInfo.label;
            const suitColor = suit === "No-Trump" ? "text-indigo-700" : suitInfo.color;

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
                            <span class="font-bold text-sm text-slate-700 w-12">${playerLabel}</span>
                            <span class="text-xs font-bold text-slate-500">${tr("ui.avg", "Avg")}: <span class="text-indigo-600 text-sm">${exp.toFixed(
                                2
                            )}</span></span>
                        </div>
                        <div class="flex gap-3 text-xs font-medium">
                            <span class="bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded border border-emerald-100">${tr(
                                "ui.game",
                                "Game"
                            )}: ${Math.round(
                                gameProb
                            )}%</span>
                            <span class="bg-purple-50 text-purple-700 px-2 py-0.5 rounded border border-purple-100">${tr(
                                "ui.smallSlam",
                                "Small Slam"
                            )}: ${Math.round(
                                slamProb
                            )}%</span>
                            <span class="bg-purple-50 text-purple-700 px-2 py-0.5 rounded border border-purple-100">${tr(
                                "ui.grandSlam",
                                "Grand Slam"
                            )}: ${Math.round(
                                grandSlamProb
                            )}%</span>
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

        leads.sort((a, b) => b.tricks - a.tricks);

        leads.forEach((lead) => {
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
            row.className = "bg-slate-50 border border-slate-200 rounded-lg p-3 mb-3";
            row.innerHTML = `
                <div class="flex justify-between items-end mb-2">
                    <div class="flex items-baseline gap-2">
                        <span class="font-bold text-2xl ${
                            suitInfo.color
                        } w-10 text-center bg-white border border-slate-200 rounded shadow-sm h-10 leading-10">${
                suitInfo.label
            }${rankChar}</span>
                        <div class="flex flex-col">
                            <span class="text-[10px] text-slate-400 uppercase font-bold">${tr(
                                "ui.expTricks",
                                "Exp Tricks"
                            )}</span>
                            <span class="text-lg font-bold text-slate-700 leading-none">${lead.tricks.toFixed(
                                2
                            )}</span>
                        </div>
                    </div>
                    <div class="text-right">
                        <span class="text-[10px] text-slate-400 uppercase font-bold block">${tr(
                            "ui.setProb",
                            "Set Prob"
                        )}</span>
                        <span class="text-sm font-bold text-orange-600">${lead.per_of_set.toFixed(
                            1
                        )}%</span>
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
        const runDoubleBtn = document.getElementById("btn-run-double");
        const runSingleBtn = document.getElementById("btn-run-single");
        const runLeadBtn = document.getElementById("btn-run-lead");
        if (runDoubleBtn) runDoubleBtn.onclick = runDoubleDummy;
        if (runSingleBtn) runSingleBtn.onclick = runSingleDummy;
        if (runLeadBtn) runLeadBtn.onclick = runLeadSolver;

        // Lead UI Update Event
        const leadLeader = document.getElementById("lead-leader");
        if (leadLeader) leadLeader.onchange = updateLeadModeUI;
    }
});
