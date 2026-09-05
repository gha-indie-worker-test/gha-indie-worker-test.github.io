#!/usr/bin/env node
// Validates every OWLS release manifest under public/releases/ through the exact
// code path the Astro build uses, and asserts the pilot manifest actually asks
// for preparation. Zero dependencies, so CI runs it before installing anything.
import process from "node:process";
import { collectHints, DEFAULT_ORIGINS } from "../src/lib/prepare.mjs";

try {
  const result = collectHints();
  process.stdout.write(`${JSON.stringify({ allowed_origins: [...DEFAULT_ORIGINS], ...result }, null, 2)}\n`);
  if (result.links.length === 0) {
    process.stderr.write(
      "expected public/releases/pilot.json to request preparation, but no hints were produced\n",
    );
    process.exit(1);
  }
  process.stdout.write(`${result.links.length} hint(s) from ${result.sources.join(", ")}\n`);
} catch (error) {
  process.stderr.write(`release manifest validation failed: ${error.message}\n`);
  process.exit(1);
}
