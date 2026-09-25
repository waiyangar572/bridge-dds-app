import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const generatedFiles = ["frontend/sitemap.xml", "frontend/rss.xml", "frontend/atom.xml"];
const commitMessage = "chore(seo): regenerate sitemap and feeds";

function git(args) {
    return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" });
}

function main() {
    const changed = git(["status", "--porcelain", "--", ...generatedFiles]).trim();
    if (!changed) {
        console.log("SEO files unchanged; nothing to commit");
        return;
    }

    // Commit only the generated files so unrelated staged changes are left alone.
    git(["add", "--", ...generatedFiles]);
    git(["commit", "--quiet", "-m", commitMessage, "--only", "--", ...generatedFiles]);
    console.log(`Committed regenerated SEO files: ${git(["rev-parse", "--short", "HEAD"]).trim()}`);
}

try {
    main();
} catch (error) {
    // A failed commit must not block the deploy; the files can be committed by hand.
    console.warn(`Could not auto-commit SEO files: ${error.message}`);
}
