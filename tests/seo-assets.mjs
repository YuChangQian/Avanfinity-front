import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outDir = await mkdtemp(path.join(tmpdir(), "avanfinity-seo-"));
const origin = "https://www.avanfinity.com";
const previousOrigin = process.env.PUBLIC_ORIGIN;

try {
  process.env.PUBLIC_ORIGIN = origin;
  await build({ root, configFile: path.join(root, "vite.config.ts"), logLevel: "silent", build: { outDir, emptyOutDir: true } });

  const robots = await readFile(path.join(outDir, "robots.txt"), "utf8");
  assert.match(robots, /^Allow: \/api\/features$/m);
  assert.match(robots, /^Disallow: \/api\/$/m);
  assert.doesNotMatch(robots, /^Disallow: \/$/m);
  assert.match(robots, new RegExp(`^Sitemap: ${origin}/sitemap\\.xml$`, "m"));

  const sitemap = await readFile(path.join(outDir, "sitemap.xml"), "utf8");
  for (const url of [
    `${origin}/register`, `${origin}/register?lang=en`,
    `${origin}/cdk/redeem`, `${origin}/cdk/redeem?lang=en`,
  ]) assert.ok(sitemap.includes(`<loc>${url}</loc>`), `missing sitemap URL ${url}`);
  assert.equal((sitemap.match(/<url>/g) ?? []).length, 4);
  assert.ok(!sitemap.includes("/login") && !sitemap.includes("/admin"));

  const manifest = JSON.parse(await readFile(path.join(outDir, "manifest.webmanifest"), "utf8"));
  assert.equal(manifest.icons[0].src, "/favicon.svg");
  await stat(path.join(outDir, "favicon.svg"));
  console.log("SEO build assets verified");
} finally {
  if (previousOrigin === undefined) delete process.env.PUBLIC_ORIGIN;
  else process.env.PUBLIC_ORIGIN = previousOrigin;
  await rm(outDir, { recursive: true, force: true });
}
