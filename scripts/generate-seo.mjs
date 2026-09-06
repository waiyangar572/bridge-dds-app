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
const SUPPORTED_LANGUAGES = ["en", "ja"];
const DEFAULT_LANGUAGE = "en";
const DEFAULT_ROUTE = "/double-dummy";

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

function stripRouteLanguage(routePath) {
    return normalizeRoute(routePath).replace(/^\/(?:en|ja)(?=\/|$)/, "");
}

function getMetaKey(routePath) {
    const routeWithoutLang = stripRouteLanguage(routePath);
    if (routeWithoutLang === "" || routeWithoutLang === "/") return "home";
    if (routeWithoutLang.startsWith("/guide/")) {
        return `guide-${routeWithoutLang.slice("/guide/".length)}`;
    }
    if (routeWithoutLang === "/reference/probability") return "probability";
    if (routeWithoutLang === "/reference/imp") return "imp";
    if (routeWithoutLang === "/reference/vp") return "vp";
    return routeWithoutLang.replace(/^\//, "") || "double-dummy";
}

function getPriority(routePath) {
    const metaKey = getMetaKey(routePath);
    if (metaKey === "home") return "1.0";
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
        .map((entry) => {
            const alternateLinks = [
                ...entry.alternates.map(
                    (alternate) =>
                        `    <xhtml:link rel="alternate" hreflang="${alternate.lang}" href="${escapeXml(alternate.url)}" />`,
                ),
                `    <xhtml:link rel="alternate" hreflang="x-default" href="${escapeXml(entry.xDefaultUrl)}" />`,
            ].join("\n");

            return `  <url>
    <loc>${escapeXml(entry.url)}</loc>
${alternateLinks}
    <lastmod>${entry.lastmod}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>${entry.priority}</priority>
  </url>`;
        })
        .join("\n");

    return `<?xml version="1.0" encoding="UTF-8"?>
<urlset
  xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
  xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls}
</urlset>
`;
}

function buildLocalizedRoute(lang, unlocalizedRoute) {
    return `/${lang}${unlocalizedRoute}`;
}

function getAlternateEntries(routePath, baseUrl) {
    const unlocalizedRoute = stripRouteLanguage(routePath);
    return SUPPORTED_LANGUAGES.map((lang) => ({
        lang,
        url: `${baseUrl}${buildLocalizedRoute(lang, unlocalizedRoute)}`,
    }));
}

function buildRssAlternateLinks(entry) {
    return [
        ...entry.alternates.map(
            (alternate) =>
                `      <atom:link rel="alternate" hreflang="${alternate.lang}" type="text/html" href="${escapeXml(alternate.url)}" />`,
        ),
        `      <atom:link rel="alternate" hreflang="x-default" type="text/html" href="${escapeXml(entry.xDefaultUrl)}" />`,
    ].join("\n");
}

function buildAtomAlternateLinks(entry) {
    return [
        ...entry.alternates.map(
            (alternate) =>
                `    <link rel="alternate" hreflang="${alternate.lang}" type="text/html" href="${escapeXml(alternate.url)}" />`,
        ),
        `    <link rel="alternate" hreflang="x-default" type="text/html" href="${escapeXml(entry.xDefaultUrl)}" />`,
    ].join("\n");
}

function buildRss(entries, baseUrl, updated) {
    const defaultPageUrl = `${baseUrl}/${DEFAULT_LANGUAGE}`;
    const items = entries
        .map(
            (entry) => `    <item xml:lang="${entry.lang}">
      <title>${escapeXml(entry.title)}</title>
      <link>${escapeXml(entry.url)}</link>
      <guid isPermaLink="true">${escapeXml(entry.url)}</guid>
${buildRssAlternateLinks(entry)}
      <description>${escapeXml(entry.description)}</description>
      <pubDate>${entry.mtime.toUTCString()}</pubDate>
    </item>`,
        )
        .join("\n");

    return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(SITE_TITLE)}</title>
    <link>${escapeXml(defaultPageUrl)}</link>
    <description>${escapeXml(SITE_DESCRIPTION)}</description>
    <language>en-US</language>
    <atom:link href="${escapeXml(`${baseUrl}/rss.xml`)}" rel="self" type="application/rss+xml" />
    <atom:link href="${escapeXml(`${baseUrl}/atom.xml`)}" rel="alternate" type="application/atom+xml" />
    <lastBuildDate>${updated.toUTCString()}</lastBuildDate>
${items}
  </channel>
</rss>
`;
}

function buildAtom(entries, baseUrl, updated) {
    const defaultPageUrl = `${baseUrl}/${DEFAULT_LANGUAGE}`;
    const entriesXml = entries
        .map(
            (entry) => `  <entry xml:lang="${entry.lang}">
    <title>${escapeXml(entry.title)}</title>
${buildAtomAlternateLinks(entry)}
    <id>${escapeXml(entry.url)}</id>
    <updated>${entry.mtime.toISOString()}</updated>
    <summary>${escapeXml(entry.description)}</summary>
  </entry>`,
        )
        .join("\n");

    return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="${DEFAULT_LANGUAGE}">
  <title>${escapeXml(SITE_TITLE)}</title>
  <link rel="alternate" type="text/html" hreflang="${DEFAULT_LANGUAGE}" href="${escapeXml(defaultPageUrl)}" />
  <link rel="self" type="application/atom+xml" href="${escapeXml(`${baseUrl}/atom.xml`)}" />
  <link rel="alternate" type="application/rss+xml" href="${escapeXml(`${baseUrl}/rss.xml`)}" />
  <id>${escapeXml(`${baseUrl}/`)}</id>
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
                alternates: getAlternateEntries(normalizedRoute, baseUrl),
                xDefaultUrl: `${baseUrl}${buildLocalizedRoute(
                    DEFAULT_LANGUAGE,
                    stripRouteLanguage(normalizedRoute),
                )}`,
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
