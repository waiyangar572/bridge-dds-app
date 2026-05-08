#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const frontendDir = path.join(repoRoot, "frontend");
const manifestPath = path.join(frontendDir, "prerender-routes.json");
const scriptPath = path.join(frontendDir, "script.js");
const shellHtmlPath = path.join(frontendDir, "index.html");
const localesDir = path.join(frontendDir, "locales");

const SITE_TITLE = "Bridge Solver";
const SITE_DESCRIPTION =
    "Contract bridge analysis tools: Double Dummy, Single Dummy, Opening Lead, and reference tables for probability, IMP, and VP scales.";

function normalizeRoute(routePath) {
    if (!routePath) return "/";
    const trimmed = routePath.trim();
    if (trimmed === "/") return "/";
    return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
}

function routeToOutputPath(routePath) {
    const normalized = normalizeRoute(routePath);
    if (normalized === "/") {
        return path.join(frontendDir, "index.prerendered.html");
    }
    const relativeRoute = normalized.replace(/^\//, "");
    return path.join(frontendDir, relativeRoute, "index.html");
}

function getRouteLanguage(routePath) {
    const match = normalizeRoute(routePath).match(/^\/(en|ja)(?:\/|$)/);
    return match?.[1] || "en";
}

function getMetaKey(routePath) {
    const routeWithoutLang = normalizeRoute(routePath).replace(/^\/(?:en|ja)(?=\/)/, "");
    if (routeWithoutLang === "/reference/probability") return "probability";
    if (routeWithoutLang === "/reference/imp") return "imp";
    if (routeWithoutLang === "/reference/vp") return "vp";
    return routeWithoutLang.replace(/^\//, "") || "double-dummy";
}

function getPriority(routePath) {
    const metaKey = getMetaKey(routePath);
    return ["privacy", "about", "contact"].includes(metaKey) ? "0.5" : "0.8";
}

function escapeXml(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&apos;");
}

function formatTokyoIso(date) {
    const tokyo = new Date(date.getTime() + 9 * 60 * 60 * 1000);
    const pad = (value) => String(value).padStart(2, "0");
    return [
        tokyo.getUTCFullYear(),
        "-",
        pad(tokyo.getUTCMonth() + 1),
        "-",
        pad(tokyo.getUTCDate()),
        "T",
        pad(tokyo.getUTCHours()),
        ":",
        pad(tokyo.getUTCMinutes()),
        ":",
        pad(tokyo.getUTCSeconds()),
        "+09:00",
    ].join("");
}

async function readJson(filePath) {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function statMtime(filePath) {
    const stats = await fs.stat(filePath).catch(() => null);
    return stats?.mtime || null;
}

async function getLatestMtime(filePaths) {
    const mtimes = await Promise.all(filePaths.map(statMtime));
    const existingMtimes = mtimes.filter(Boolean);
    if (existingMtimes.length === 0) return new Date();
    return existingMtimes.reduce((latest, current) =>
        current.getTime() > latest.getTime() ? current : latest,
    );
}

function getRouteMeta(routePath, locales) {
    const lang = getRouteLanguage(routePath);
    const metaKey = getMetaKey(routePath);
    const locale = locales[lang] || locales.en;
    const meta = locale?.meta?.[metaKey] || {};
    const title = meta.title || SITE_TITLE;
    const description = meta.description || SITE_DESCRIPTION;
    return { lang, title, description };
}

function buildSitemap(entries) {
    const urls = entries
        .map(
            (entry) => `  <url>
    <loc>${escapeXml(entry.url)}</loc>
    <lastmod>${entry.lastmod}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>${entry.priority}</priority>
  </url>`,
        )
        .join("\n");

    return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
}

function buildRss(entries, baseUrl, updated) {
    const items = entries
        .map(
            (entry) => `    <item>
      <title>${escapeXml(entry.title)}</title>
      <link>${escapeXml(entry.url)}</link>
      <guid isPermaLink="true">${escapeXml(entry.url)}</guid>
      <description>${escapeXml(entry.description)}</description>
      <pubDate>${entry.mtime.toUTCString()}</pubDate>
    </item>`,
        )
        .join("\n");

    return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${escapeXml(SITE_TITLE)}</title>
    <link>${escapeXml(baseUrl)}</link>
    <description>${escapeXml(SITE_DESCRIPTION)}</description>
    <language>en</language>
    <lastBuildDate>${updated.toUTCString()}</lastBuildDate>
${items}
  </channel>
</rss>
`;
}

function buildAtom(entries, baseUrl, updated) {
    const entriesXml = entries
        .map(
            (entry) => `  <entry>
    <title>${escapeXml(entry.title)}</title>
    <link href="${escapeXml(entry.url)}" />
    <id>${escapeXml(entry.url)}</id>
    <updated>${entry.mtime.toISOString()}</updated>
    <summary>${escapeXml(entry.description)}</summary>
  </entry>`,
        )
        .join("\n");

    return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>${escapeXml(SITE_TITLE)}</title>
  <link href="${escapeXml(baseUrl)}" />
  <link rel="self" href="${escapeXml(`${baseUrl}/atom.xml`)}" />
  <id>${escapeXml(baseUrl)}</id>
  <updated>${updated.toISOString()}</updated>
${entriesXml}
</feed>
`;
}

async function main() {
    const manifest = await readJson(manifestPath);
    const locales = {
        en: await readJson(path.join(localesDir, "en.json")),
        ja: await readJson(path.join(localesDir, "ja.json")),
    };

    const baseUrl = manifest.baseUrl.replace(/\/$/, "");
    const entries = await Promise.all(
        manifest.routes.map(async (routePath) => {
            const normalizedRoute = normalizeRoute(routePath);
            const lang = getRouteLanguage(normalizedRoute);
            const outputPath = routeToOutputPath(normalizedRoute);
            const mtime = await getLatestMtime([
                outputPath,
                shellHtmlPath,
                scriptPath,
                manifestPath,
                path.join(localesDir, `${lang}.json`),
            ]);
            return {
                ...getRouteMeta(normalizedRoute, locales),
                routePath: normalizedRoute,
                url: `${baseUrl}${normalizedRoute}`,
                priority: getPriority(normalizedRoute),
                mtime,
                lastmod: formatTokyoIso(mtime),
            };
        }),
    );

    const latestUpdate = entries.reduce(
        (latest, entry) => (entry.mtime.getTime() > latest.getTime() ? entry.mtime : latest),
        entries[0]?.mtime || new Date(),
    );

    await fs.writeFile(path.join(frontendDir, "sitemap.xml"), buildSitemap(entries), "utf8");
    await fs.writeFile(path.join(frontendDir, "rss.xml"), buildRss(entries, baseUrl, latestUpdate), "utf8");
    await fs.writeFile(path.join(frontendDir, "atom.xml"), buildAtom(entries, baseUrl, latestUpdate), "utf8");

    console.log(`Generated ${path.relative(repoRoot, path.join(frontendDir, "sitemap.xml"))}`);
    console.log(`Generated ${path.relative(repoRoot, path.join(frontendDir, "rss.xml"))}`);
    console.log(`Generated ${path.relative(repoRoot, path.join(frontendDir, "atom.xml"))}`);
}

main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
});
