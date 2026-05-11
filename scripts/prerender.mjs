#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const frontendDir = path.join(repoRoot, "frontend");
const manifestPath = path.join(frontendDir, "prerender-routes.json");
const shellHtmlPath = path.join(frontendDir, "index.html");
const spaShellHtmlPath = path.join(frontendDir, "spa-shell.html");

const MIME_TYPES = {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".ico": "image/x-icon",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".manifest": "application/manifest+json; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".txt": "text/plain; charset=utf-8",
    ".webmanifest": "application/manifest+json; charset=utf-8",
    ".xml": "application/xml; charset=utf-8",
};

const PRERENDER_BLOCKED_HOSTS = [
    "adm.shinobi.jp",
    "sync.shinobi.jp",
    "dmp.im-apps.net",
    "pagead2.googlesyndication.com",
    "googleads.g.doubleclick.net",
    "googlesyndication.com",
    "googletagservices.com",
    "doubleclick.net",
    "criteo.com",
    "adtrafficquality.google",
    "www.google.com",
];

function normalizeRoute(routePath) {
    if (!routePath) return "/";
    const trimmed = routePath.trim();
    if (trimmed === "/") return "/";
    return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
}

function resolveModuleCandidate(candidate) {
    try {
        return require(candidate);
    } catch {
        return null;
    }
}

function getPlaywrightSearchPaths() {
    const candidates = [];
    const envPaths = [
        process.env.CODEX_NODE_MODULES,
        process.env.CODEX_BUNDLED_NODE_MODULES,
        process.env.NODE_PATH,
    ].filter(Boolean);

    for (const envPath of envPaths) {
        for (const entry of String(envPath).split(path.delimiter)) {
            if (entry) candidates.push(path.join(entry, "playwright"));
        }
    }

    const execDir = path.dirname(process.execPath);
    candidates.push(path.join(execDir, "..", "node_modules", "playwright"));
    candidates.push(path.join(execDir, "..", "..", "node_modules", "playwright"));

    return candidates;
}

function loadPlaywright() {
    const direct = resolveModuleCandidate("playwright");
    if (direct) return direct;

    for (const candidate of getPlaywrightSearchPaths()) {
        const resolved = resolveModuleCandidate(candidate);
        if (resolved) return resolved;
    }

    throw new Error(
        "Playwright was not found. Install it locally or run this script with the bundled Codex Node runtime.",
    );
}

async function readManifest() {
    const raw = await fs.readFile(manifestPath, "utf8");
    return JSON.parse(raw);
}

function buildRouteList(manifest) {
    const requestedRoutes = process.argv.slice(2).map(normalizeRoute);
    const routes = manifest.routes.map(normalizeRoute);
    if (requestedRoutes.length === 0) return routes;

    const routeSet = new Set(routes);
    const missing = requestedRoutes.filter((route) => !routeSet.has(route));
    if (missing.length > 0) {
        throw new Error(`Routes not found in manifest: ${missing.join(", ")}`);
    }

    return requestedRoutes;
}

function routeToOutputPath(routePath) {
    const normalized = normalizeRoute(routePath);
    if (normalized === "/") {
        return path.join(frontendDir, "index.prerendered.html");
    }
    const relativeRoute = normalized.replace(/^\//, "");
    return path.join(frontendDir, relativeRoute, "index.html");
}

async function ensureOutputDirectory(filePath) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
}

async function writeSpaShell() {
    const shellHtml = await fs.readFile(shellHtmlPath, "utf8");
    await fs.writeFile(spaShellHtmlPath, shellHtml, "utf8");
}

function safeJoin(baseDir, requestPath) {
    const targetPath = path.join(baseDir, requestPath.replace(/^\//, ""));
    const resolvedBase = path.resolve(baseDir);
    const resolvedTarget = path.resolve(targetPath);
    if (!resolvedTarget.startsWith(resolvedBase)) return null;
    return resolvedTarget;
}

function shouldBlockPrerenderRequest(requestUrl) {
    let hostname = "";
    try {
        hostname = new URL(requestUrl).hostname;
    } catch {
        return false;
    }

    return PRERENDER_BLOCKED_HOSTS.some(
        (blockedHost) => hostname === blockedHost || hostname.endsWith(`.${blockedHost}`),
    );
}

async function configurePrerenderNetwork(page) {
    await page.route("**/*", async (route) => {
        const request = route.request();
        if (shouldBlockPrerenderRequest(request.url())) {
            await route.abort();
            return;
        }
        await route.continue();
    });
}

async function createPrerenderServer(manifestRoutes) {
    const routeSet = new Set(manifestRoutes.map(normalizeRoute));
    const shellHtml = await fs.readFile(shellHtmlPath);

    const server = http.createServer(async (req, res) => {
        const url = new URL(req.url || "/", "http://127.0.0.1");
        const pathname = normalizeRoute(url.pathname);

        try {
            if (routeSet.has(pathname)) {
                res.writeHead(200, { "Content-Type": MIME_TYPES[".html"] });
                res.end(shellHtml);
                return;
            }

            const resolvedPath = safeJoin(frontendDir, url.pathname);
            if (!resolvedPath) {
                res.writeHead(403);
                res.end("Forbidden");
                return;
            }

            const stats = await fs.stat(resolvedPath).catch(() => null);
            if (stats?.isDirectory()) {
                const indexPath = path.join(resolvedPath, "index.html");
                const indexStats = await fs.stat(indexPath).catch(() => null);
                if (indexStats?.isFile()) {
                    const body = await fs.readFile(indexPath);
                    res.writeHead(200, { "Content-Type": MIME_TYPES[".html"] });
                    res.end(body);
                    return;
                }
            }

            if (stats?.isFile()) {
                const ext = path.extname(resolvedPath).toLowerCase();
                const body = await fs.readFile(resolvedPath);
                res.writeHead(200, {
                    "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
                });
                res.end(body);
                return;
            }

            res.writeHead(404);
            res.end("Not Found");
        } catch (error) {
            res.writeHead(500);
            res.end(`Server error: ${error.message}`);
        }
    });

    await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
    });

    const address = server.address();
    if (!address || typeof address === "string") {
        throw new Error("Could not determine prerender server address.");
    }

    return {
        baseUrl: `http://127.0.0.1:${address.port}`,
        close: () =>
            new Promise((resolve, reject) => {
                server.close((error) => (error ? reject(error) : resolve()));
            }),
    };
}

async function waitForRouteReady(page, routePath) {
    await page.waitForFunction(
        (expectedPath) => {
            const routeToExpectedState = (path) => {
                const route = path.replace(/^\/(?:en|ja)(?=\/)/, "") || "/double-dummy";
                if (route === "/single-dummy") return { viewId: "view-single" };
                if (route === "/opening-lead") return { viewId: "view-lead" };
                if (route === "/probability-solver") {
                    return { viewId: "view-probability", visiblePanelId: "probability-solver-content" };
                }
                if (route === "/reference/imp") {
                    return { viewId: "view-probability", visiblePanelId: "reference-panel-imp" };
                }
                if (route === "/reference/vp") {
                    return { viewId: "view-probability", visiblePanelId: "reference-panel-vp" };
                }
                if (route === "/reference/probability") {
                    return { viewId: "view-probability", visiblePanelId: "reference-panel-probability" };
                }
                if (route === "/privacy") return { viewId: "view-privacy" };
                if (route === "/about") return { viewId: "view-about" };
                if (route === "/contact") return { viewId: "view-contact" };
                return { viewId: "view-double" };
            };
            const isVisible = (id) => {
                const el = document.getElementById(id);
                return !!el && !el.classList.contains("hidden");
            };
            const isHidden = (id) => {
                const el = document.getElementById(id);
                return !el || el.classList.contains("hidden");
            };
            const canonical = document.querySelector('link[rel="canonical"]');
            if (!canonical) return false;
            const canonicalPath = new URL(canonical.href).pathname.replace(/\/$/, "");
            const currentPath = window.location.pathname.replace(/\/$/, "");
            const targetPath = expectedPath.replace(/\/$/, "");
            const expectedState = routeToExpectedState(targetPath);
            const viewIds = [
                "view-double",
                "view-single",
                "view-lead",
                "view-probability",
                "view-privacy",
                "view-about",
                "view-contact",
            ];
            const routeViewReady =
                isVisible(expectedState.viewId) &&
                viewIds
                    .filter((id) => id !== expectedState.viewId)
                    .every((id) => isHidden(id));
            const panelReady =
                !expectedState.visiblePanelId || isVisible(expectedState.visiblePanelId);
            return (
                window.__PRERENDER_READY__ === true &&
                canonicalPath === targetPath &&
                currentPath === targetPath &&
                routeViewReady &&
                panelReady
            );
        },
        routePath,
        { timeout: 30000 },
    );
    await page.waitForTimeout(500);
}

function getPrerenderRouteState(routePath) {
    const route = normalizeRoute(routePath).replace(/^\/(?:en|ja)(?=\/)/, "") || "/double-dummy";
    if (route === "/single-dummy") return { viewId: "view-single" };
    if (route === "/opening-lead") return { viewId: "view-lead" };
    if (route === "/probability-solver") {
        return { viewId: "view-probability", visiblePanelId: "probability-solver-content" };
    }
    if (route === "/reference/imp") {
        return { viewId: "view-probability", visiblePanelId: "reference-panel-imp" };
    }
    if (route === "/reference/vp") {
        return { viewId: "view-probability", visiblePanelId: "reference-panel-vp" };
    }
    if (route === "/reference/probability") {
        return { viewId: "view-probability", visiblePanelId: "reference-panel-probability" };
    }
    if (route === "/privacy") return { viewId: "view-privacy" };
    if (route === "/about") return { viewId: "view-about" };
    if (route === "/contact") return { viewId: "view-contact" };
    return { viewId: "view-double" };
}

async function pruneInactivePrerenderContent(page, routePath) {
    const routeState = getPrerenderRouteState(routePath);
    await page.evaluate(({ viewId, visiblePanelId }) => {
        const viewIds = [
            "view-double",
            "view-single",
            "view-lead",
            "view-probability",
            "view-privacy",
            "view-about",
            "view-contact",
        ];
        viewIds.forEach((id) => {
            if (id === viewId) return;
            document.getElementById(id)?.remove();
        });

        const panelIds = [
            "probability-solver-content",
            "reference-panel-probability",
            "reference-panel-imp",
            "reference-panel-vp",
        ];
        panelIds.forEach((id) => {
            if (id === visiblePanelId) return;
            document.getElementById(id)?.remove();
        });

        document.documentElement.dataset.prerenderView = viewId;
        if (visiblePanelId) document.documentElement.dataset.prerenderPanel = visiblePanelId;
    }, routeState);
}

function removeNoScriptFallback(html) {
    return html.replace(/<noscript\b[\s\S]*?<\/noscript>/gi, "");
}

async function captureRoute(page, baseUrl, routePath) {
    const url = `${baseUrl}${routePath}`;
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await waitForRouteReady(page, routePath);
    await pruneInactivePrerenderContent(page, routePath);

    let html = removeNoScriptFallback(await page.content());
    if (!html.toLowerCase().startsWith("<!doctype html>")) {
        html = `<!doctype html>\n${html}`;
    }
    return html;
}

async function main() {
    const manifest = await readManifest();
    const routes = buildRouteList(manifest);
    await writeSpaShell();
    const playwright = loadPlaywright();
    const server = await createPrerenderServer(routes);
    const browser = await playwright.chromium.launch({ headless: true });
    const page = await browser.newPage({
        viewport: { width: 1440, height: 1600 },
    });
    await configurePrerenderNetwork(page);

    try {
        for (const routePath of routes) {
            const outputPath = routeToOutputPath(routePath);
            const html = await captureRoute(page, server.baseUrl, routePath);
            await ensureOutputDirectory(outputPath);
            await fs.writeFile(outputPath, html, "utf8");
            console.log(`Prerendered ${routePath} -> ${path.relative(repoRoot, outputPath)}`);
        }
    } finally {
        await page.close().catch(() => {});
        await browser.close().catch(() => {});
        await server.close().catch(() => {});
    }
}

main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
});
