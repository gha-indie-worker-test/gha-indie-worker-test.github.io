// @ts-check
// Mirrors the conventions of gha-indie-worker/gha-indie-worker.github.io's
// astro.config.mjs: site from PUBLIC_SITE_URL, static output, trailing slashes
// always, directory build format, and no `base` option. Same Astro major (7.x).
import { defineConfig } from "astro/config";

const site = process.env.PUBLIC_SITE_URL ?? "https://gha-indie-worker-test.github.io";

export default defineConfig({
  site,
  output: "static",
  trailingSlash: "always",
  build: {
    format: "directory",
  },
});
