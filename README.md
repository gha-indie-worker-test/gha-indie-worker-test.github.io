# gha-indie-worker-test.github.io — OWLS pilot harness

An Astro site in the isolated test organization that exercises the OWLS
shared-WASM-loader mechanism end to end, so the production marketing site does
not have to guess.

It is a **mechanism harness**, not a benchmark and not a product.

## What this proves

Everything here runs for real in a browser and can be checked by anyone:

1. **A build can turn a release manifest into resource hints with zero
   JavaScript.** `src/lib/prepare.mjs` reads `public/releases/pilot.json` at
   build time and `src/pages/index.astro` renders `<link rel="preconnect">`,
   `<link rel="dns-prefetch">` and `<link rel="prefetch">` into `<head>`. No
   script is required for that tier.

2. **A release-v1 manifest can describe a real artifact truthfully.**
   `public/releases/pilot.json` carries the actual SHA-256 and byte length of
   `public/fixtures/add.wasm`, and `tools/verify-fixture.mjs` fails CI if they
   ever drift apart.

3. **The fixture is reproducible.** `tools/make-fixture.mjs` hand-assembles the
   WebAssembly binary from the spec's section format — no toolchain, no
   dependencies — and CI regenerates it and fails if the bytes differ from the
   committed file.

4. **Activation works from a verified manifest.** `src/pages/app/index.astro`
   fetches the module, verifies its SHA-256 with `crypto.subtle` **against the
   digest from the manifest**, then `WebAssembly.compile`, then
   `WebAssembly.instantiate`, then calls `add(2, 3)` and asserts the result is
   `5`. The page shows PASS or FAIL.

5. **Preparation and activation are genuinely separate.** The entry page fetches
   bytes and throws them away. It never compiles, instantiates or imports
   anything. Only the application page activates.

6. **The four scenarios can be told apart.** `src/lib/measure.mjs` labels each
   run cold-entry / prefetched-entry / repeat-entry / same-document, and reports
   `transferSize` alongside explicit verify/compile/instantiate timings.

## What this does NOT prove

Read this section before quoting any number from this harness.

- **It is not a performance result.** The fixture is **41 bytes**. Every duration
  the page reports is dominated by scheduling noise. The timings show that a step
  *ran*, not that it was fast. **No baseline is stored or compared against
  anywhere in this repository, because none has been measured.**

- **It does not prove a CDN or edge cache hit.** There is no CDN here.
  `transferSize === 0` is a *browser-reported hint* that this browser did not go
  to the network. It is not proof, and it says nothing about GitHub's edge.

- **The reuse measured here is SAME-ORIGIN, which is weaker than the production
  case.** Both pages are served from `gha-indie-worker-test.github.io`. The
  production scenario is `gha-indie-worker.github.io` →
  `user.gha-indie-worker.github.io`: **same-site, cross-origin**, because
  `github.io` is on the Public Suffix List and both share the registrable domain
  `gha-indie-worker.github.io`. This test organization has exactly one Pages
  origin and cannot create a second, so **the cross-origin hop is not exercised
  here at all.** The same-origin result is necessary evidence, not sufficient.

- **`transferSize` would not even be readable in the production case.** For a
  cross-origin resource with no `Timing-Allow-Origin` response header,
  `transferSize` is reported as `0` *whether or not it came from cache*. GitHub
  Pages does not set that header. So on the real marketing-site → user-app hop,
  a `0` is indistinguishable from a cache hit and **must not be read as one**.

- **No response headers are exercised.** GitHub Pages does not let a repository
  set them. So there is **no `Link:` header tier and no CSP tier here**, and
  neither has been tested anywhere. Correct `Access-Control-Allow-Origin`,
  `Content-Type: application/wasm`, and `Cache-Control` on the asset origin are
  assumptions this harness cannot verify.

- **It is not a real application.** `add(i32, i32) -> i32` is not a workload. No
  wasm-bindgen glue, no Leptos, no Dioxus, and no framework build is involved.

- **There is no Flutter here.** `gha-indie-worker-flutter` has no `web/`
  directory on any branch, so no Flutter web build exists to prepare.

- **The intent tier is ON here and OFF in production.** Do not read this repo as
  evidence about the production site's default behaviour.

- **`src/lib/prepare.mjs` and `src/lib/intent.mjs` are copies** of the production
  site's files (differing only in the origin allowlist). Nothing checks them for
  drift automatically. If you change one, change both.

## How to run it

Requires Node ≥ 22.22.1 and network access to the npm registry.

```sh
npm install          # see the note about package-lock.json below
npm run fixture      # regenerate public/fixtures/add.wasm; prints sha256 + length
npm run verify       # re-derive and diff against public/releases/pilot.json
npm run dev          # http://localhost:4321/
```

The dependency-free checks need no install at all:

```sh
node tools/make-fixture.mjs
node tools/verify-fixture.mjs
node tools/validate-releases.mjs
```

### Walking the four scenarios

Open DevTools → Network, and disable any "disable cache" setting.

| Scenario | Steps |
|---|---|
| **cold-entry** | New tab, cleared cache → go straight to `/app/` |
| **prefetched-entry** | New tab → open `/` → hover "Open the application page" until the status line says preparation started → follow the link |
| **repeat-entry** | From `/app/`, navigate away and back to `/app/` in the same tab |
| **same-document** | On `/app/`, press "Activate again" without navigating |

Each run prints a table on the page and `console.table`s the same rows. The
scenario label is what *the harness did*; `transferSize` is what *the browser
reports*. Read them together — neither alone is the answer.

### `package-lock.json`

There is none yet. It could not be generated where this pilot was authored (the
npm registry was unreachable), and a hand-written lockfile would have been a
fabricated dependency tree. Run `npm install` once, commit the lockfile, and
switch `.github/workflows/pages.yml` from `npm install` to
`npm ci --ignore-scripts --no-audit --no-fund` to match the production workflow.

## Isolation

`.github/test-org-isolation.json` declares `production_connectivity_enabled:
false` and `outbound_send_enabled: false`. This repository holds no secrets, no
credentials and no service accounts, and no workflow here consumes a secret.
There are therefore no secret names at all, and no identifier anywhere in the
repository carries any of the organization's forbidden secret-name fragments
(production, personal-access-token, deploy-key, cross-organization-write).

The one HTTP(S) host named anywhere in the repository is
`gha-indie-worker-test.github.io` — this repository's own Pages origin. It
appears because the OWLS release-v1 contract requires each asset to declare a
canonical absolute `https://` URL, so a relative path or a synthetic `.invalid`
host is not permitted there. The manifest is declared and explained in
`.github/test-org-isolation.json`; see the `declared_http_hosts` block, which
also records the correct remedy if the static isolation scanner flags it.

## Layout

```
astro.config.mjs                 Astro 7.2.9, static, trailingSlash "always"
public/fixtures/add.wasm         41-byte committed fixture (reproducible)
public/releases/pilot.json       OWLS release-v1 manifest for that fixture
src/lib/prepare.mjs              build-time manifest reader/validator/hints
src/lib/intent.mjs               intent preparation (fetch only, never executes)
src/lib/measure.mjs              scenario labelling and reporting
src/pages/index.astro            entry page: hints + intent preparation
src/pages/app/index.astro        application page: verify, compile, instantiate
tools/make-fixture.mjs           hand-assembles the WebAssembly module
tools/verify-fixture.mjs         fails on any fixture/manifest drift
tools/validate-releases.mjs      validates every manifest, pre-install
```
