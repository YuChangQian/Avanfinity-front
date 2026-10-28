import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { stylePreviewPlugin } from "./vite.style-preview";

function configuredPublicOrigin() {
  const value = (process.env.PUBLIC_ORIGIN ?? process.env.VITE_PUBLIC_ORIGIN ?? "").trim();
  if (!value) return "";
  const url = new URL(value);
  const loopbackHttp = url.protocol === "http:" && ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
  if ((!loopbackHttp && url.protocol !== "https:") || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("PUBLIC_ORIGIN must be an HTTPS origin without credentials, path, query, or fragment");
  }
  return url.origin;
}

function seoAssets(origin: string): Plugin {
  return {
    name: "avanfinity-seo-assets",
    apply: "build",
    generateBundle() {
      const sitemap = origin ? `\nSitemap: ${origin}/sitemap.xml` : "";
      this.emitFile({
        type: "asset",
        fileName: "robots.txt",
        source: `User-agent: *\nAllow: /api/features\nDisallow: /api/${sitemap}\n`,
      });
      if (origin) this.emitFile({
        type: "asset",
        fileName: "sitemap.xml",
        source: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${origin}/register</loc></url>\n  <url><loc>${origin}/register?lang=en</loc></url>\n  <url><loc>${origin}/cdk/redeem</loc></url>\n  <url><loc>${origin}/cdk/redeem?lang=en</loc></url>\n</urlset>\n`,
      });
    },
  };
}

export default defineConfig(() => {
  const publicOrigin = configuredPublicOrigin();
  return {
    plugins: [
      react(),
      tailwindcss(),
      seoAssets(publicOrigin),
      ...(process.env.VITE_STYLE_PREVIEW === "1" ? [stylePreviewPlugin()] : []),
    ],
    build: { manifest: "asset-manifest.json" },
    define: { __PUBLIC_ORIGIN__: JSON.stringify(publicOrigin) },
    resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
    server: {
      port: 5173,
      strictPort: true,
      fs: {
        allow: [
          path.resolve(__dirname),
        ],
      },
      proxy: {
        "/api": {
          target: process.env.VITE_API_TARGET ?? "http://127.0.0.1:8080",
          changeOrigin: false,
        },
      },
    },
  };
});
