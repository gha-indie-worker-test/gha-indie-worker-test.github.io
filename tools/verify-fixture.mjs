#!/usr/bin/env node
// Re-derives the fixture's sha256 and byte length from the committed bytes and
// diffs them against every asset in public/releases/pilot.json that points at
// that file. Exits non-zero on any drift.
//
// This is the guard that keeps the manifest honest: a manifest whose sha256 does
// not describe the bytes actually served is worse than no manifest, because a
// loader that verifies digests will reject the asset at activation time.
//
// Zero dependencies. Run directly: `node tools/verify-fixture.mjs`.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST = "public/releases/pilot.json";
const FIXTURE = "public/fixtures/add.wasm";
// Every asset URL whose path resolves to FIXTURE must match the real bytes.
const FIXTURE_ASSET_ROUTE = "/fixtures/add.wasm";

const problems = [];
const note = (message) => problems.push(message);

function read(relative) {
  try {
    return readFileSync(path.join(root, relative));
  } catch (error) {
    note(`${relative}: cannot read (${error.code ?? error.message})`);
    return null;
  }
}

const bytes = read(FIXTURE);
const manifestRaw = read(MANIFEST);

let manifest = null;
if (manifestRaw) {
  try {
    manifest = JSON.parse(manifestRaw.toString("utf8"));
  } catch (error) {
    note(`${MANIFEST}: not valid JSON (${error.message})`);
  }
}

if (bytes && manifest) {
  const actual = {
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };

  const assets = Array.isArray(manifest.assets) ? manifest.assets : [];
  if (assets.length === 0) note(`${MANIFEST}: has no assets array`);

  const matching = assets.filter((a) => {
    try {
      return new URL(a.url).pathname === FIXTURE_ASSET_ROUTE;
    } catch {
      return false;
    }
  });

  if (matching.length === 0) {
    note(`${MANIFEST}: no asset URL resolves to ${FIXTURE_ASSET_ROUTE}; nothing describes the committed fixture`);
  }

  for (const asset of matching) {
    if (asset.bytes !== actual.bytes)
      note(`${MANIFEST}: asset ${asset.id}: bytes is ${asset.bytes}, fixture is ${actual.bytes}`);
    if (asset.sha256 !== actual.sha256)
      note(
        `${MANIFEST}: asset ${asset.id}: sha256 is\n    ${asset.sha256}\n  fixture is\n    ${actual.sha256}`,
      );
    if (asset.kind !== "wasm") note(`${MANIFEST}: asset ${asset.id}: kind is ${asset.kind}, expected "wasm"`);
  }

  // The manifest declares raw-wasm; prove the committed bytes really are a
  // WebAssembly module that exports the function the app page calls.
  try {
    const instance = await WebAssembly.instantiate(await WebAssembly.compile(bytes), {});
    const add = instance.exports.add;
    if (typeof add !== "function") note(`${FIXTURE}: does not export a callable "add"`);
    else if (add(2, 3) !== 5) note(`${FIXTURE}: add(2,3) returned ${add(2, 3)}, expected 5`);
  } catch (error) {
    note(`${FIXTURE}: is not a loadable WebAssembly module (${error.message})`);
  }

  if (problems.length === 0) {
    process.stdout.write(
      `${JSON.stringify({ fixture: FIXTURE, manifest: MANIFEST, ...actual, assets_checked: matching.length, add_2_3: 5 }, null, 2)}\n`,
    );
    process.stdout.write("fixture and manifest agree\n");
  }
}

if (problems.length > 0) {
  process.stderr.write(`fixture verification FAILED:\n  - ${problems.join("\n  - ")}\n`);
  process.exit(1);
}
