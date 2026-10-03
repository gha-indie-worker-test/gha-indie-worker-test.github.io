// Measurement for the OWLS pilot harness. Zero dependencies, browser only.
//
// WHAT IT MEASURES
// Four scenarios the pilot must keep apart:
//   cold-entry         first arrival at the app page in this tab, no preparation
//   prefetched-entry   arrival after the marketing page prepared the asset
//   repeat-entry       a later navigation to the app page in the same tab
//   same-document      re-activation without navigating (button on the app page)
//
// HOW SCENARIOS ARE DECIDED, AND WHY THAT IS A LIMITATION
// The browser does not tell a page why it has a resource. So the scenario label
// is SELF-REPORTED: the marketing page writes a sessionStorage breadcrumb when
// it issues preparation, and the app page counts its own visits. The label
// records what the harness *did*, not what the browser's cache actually did.
// The cache signal below is the independent evidence; the label is context.
//
// THE CACHE SIGNAL, AND ITS EXACT MEANING
// PerformanceResourceTiming.transferSize is the bytes taken off the network,
// including headers. A cache hit reports 0. So `transferSize === 0` alongside a
// non-zero decodedBodySize is the conventional "served from cache" signal.
//
// It is a BROWSER-REPORTED HINT, NOT PROOF:
//   * It says nothing about a CDN. There is no CDN here. GitHub Pages fronts
//     this with its own edge, and a 0 here does not mean an edge hit; it means
//     this browser did not go to the network.
//   * A 304 revalidation can report a small non-zero transferSize while still
//     reusing the body. Non-zero does not prove a full download.
//   * MOST IMPORTANT FOR THE LIVE CROSS-ORIGIN CASE: for a cross-origin resource
//     without a `Timing-Allow-Origin` response header, transferSize is reported
//     as 0 REGARDLESS of whether it came from cache. GitHub Pages does not set
//     Timing-Allow-Origin. This harness is same-origin, so the number is
//     meaningful here — but the same measurement on the production
//     marketing-site -> user-app hop would be indistinguishable from a cache
//     hit and MUST NOT be read as one.
//
// NO BASELINE NUMBERS ARE BUILT IN. Nothing here compares against a stored
// "expected" figure, because none has been measured. The fixture is 41 bytes;
// every duration below is dominated by scheduling noise and is evidence that a
// step HAPPENED, not evidence that it was fast.

const VISITS_KEY = "owls.pilot.appVisits";
const PREPARED_KEY = "owls.pilot.prepared";

const store = {
  get(key) {
    try {
      return sessionStorage.getItem(key);
    } catch {
      return null; // private mode, or storage blocked
    }
  },
  set(key, value) {
    try {
      sessionStorage.setItem(key, value);
    } catch {
      /* measurement must never break the page */
    }
  },
};

/** Called by the marketing page when it issues intent preparation. */
export function recordPreparation(href) {
  store.set(PREPARED_KEY, JSON.stringify({ href, at: Date.now() }));
}

/** Reads and clears the marketing page's breadcrumb. */
function takePreparation() {
  const raw = store.get(PREPARED_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Classifies this activation. `sameDocument` is true when the app page
 * re-activates without a navigation.
 */
export function classify({ sameDocument = false } = {}) {
  if (sameDocument) return "same-document";
  const visits = Number(store.get(VISITS_KEY) ?? "0") + 1;
  store.set(VISITS_KEY, String(visits));
  const prepared = takePreparation();
  if (visits > 1) return "repeat-entry";
  return prepared ? "prefetched-entry" : "cold-entry";
}

/** The navigation type the browser reports, for cross-checking the label. */
export function navigationType() {
  const [nav] = performance.getEntriesByType("navigation");
  return nav?.type ?? "unknown";
}

/**
 * Resource timing for one URL, or null if the browser exposed no entry.
 * Takes the LAST entry, which is this document's most recent request for it.
 */
export function resourceTiming(url) {
  const entries = performance.getEntriesByType("resource").filter((e) => e.name === url);
  const entry = entries[entries.length - 1];
  if (!entry) return null;
  return {
    transferSize: entry.transferSize,
    encodedBodySize: entry.encodedBodySize,
    decodedBodySize: entry.decodedBodySize,
    duration: round(entry.duration),
    // Deliberately a tri-state. "unknown" is the honest answer when the browser
    // gave us nothing to distinguish a cache hit from an opaque-timing zero.
    cacheReuseHint:
      entry.transferSize === 0 && entry.decodedBodySize > 0
        ? "likely-reused"
        : entry.transferSize > 0
          ? "went-to-network"
          : "unknown",
  };
}

const round = (n) => (typeof n === "number" ? Math.round(n * 1000) / 1000 : n);

/** Times one async step and returns [result, milliseconds]. */
export async function step(name, fn) {
  const start = performance.now();
  const value = await fn();
  const ms = round(performance.now() - start);
  performance.measure?.(`owls:${name}`, { start, end: performance.now() });
  return [value, ms];
}

/**
 * Renders one run into `target` as a table, and console.table()s the same rows.
 * `run` is the object built by src/pages/app/index.astro.
 */
export function report(target, run) {
  const rows = [
    ["scenario", run.scenario],
    ["navigation type (browser-reported)", run.navigationType],
    ["asset", run.url],
    ["declared bytes", run.declaredBytes],
    ["received bytes", run.receivedBytes],
    ["sha256 verified", run.digestOk ? "yes" : "NO — MISMATCH"],
    ["add(2,3)", `${run.result} ${run.result === 5 ? "(correct)" : "(WRONG, expected 5)"}`],
    ["fetch ms", run.timings.fetch],
    ["verify ms (crypto.subtle sha-256)", run.timings.verify],
    ["compile ms (WebAssembly.compile)", run.timings.compile],
    ["instantiate ms (WebAssembly.instantiate)", run.timings.instantiate],
    ["call ms", run.timings.call],
    ["total ms", run.timings.total],
    ["transferSize", run.timing ? run.timing.transferSize : "no resource entry"],
    ["decodedBodySize", run.timing ? run.timing.decodedBodySize : "no resource entry"],
    ["resource duration ms", run.timing ? run.timing.duration : "no resource entry"],
    ["cache reuse hint", run.timing ? run.timing.cacheReuseHint : "unknown"],
  ];

  console.table(rows.map(([metric, value]) => ({ metric, value })));

  const table = document.createElement("table");
  const body = document.createElement("tbody");
  for (const [metric, value] of rows) {
    const tr = document.createElement("tr");
    const th = document.createElement("th");
    th.scope = "row";
    th.textContent = metric;
    const td = document.createElement("td");
    td.textContent = String(value);
    tr.append(th, td);
    body.append(tr);
  }
  table.append(body);

  const caption = document.createElement("p");
  caption.className = "caveat";
  caption.textContent =
    "Durations are for a 41-byte module and are dominated by scheduling noise. " +
    "They show that each step ran; they are not a performance result. " +
    "transferSize is a browser hint, not proof of a CDN or edge cache hit.";

  target.replaceChildren(table, caption);
}
