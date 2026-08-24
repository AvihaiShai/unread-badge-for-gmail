"use strict";

const api = globalThis.browser ?? globalThis.chrome;
const { readCountFromStream, normalizeAccounts, configKey } = globalThis.UBG;

const GMAIL_ORIGIN = "https://mail.google.com/*";

const DEFAULTS = {
  accounts: "0",
  label: "",
  interval: 1,
  reuseTab: true
};

const LIMITS = {
  minInterval: 1,
  maxInterval: 120,
  maxAccounts: 5,
  maxAccountIndex: 99,
  maxLabelLength: 100,
  fetchTimeoutMs: 15000,
  maxBodyBytes: 65536
};

const COLORS = {
  unread: "#B31412",
  idle:   "#5f6368",
  error:  "#b06000",
  stale:  "#8a6d3b"
};

const BADGE_TEXT_COLOR = "#ffffff";

const ALARM = "gmail-check";
const NAME = "Unread Badge for Gmail\u2122";

const PERMISSION_TITLE =
  `${NAME} — permission needed.\nClick to grant access to mail.google.com`;

const PERMISSION_BADGE = Object.freeze({
  text: "!",
  color: COLORS.error,
  title: PERMISSION_TITLE
});

/**
 * Keys written by earlier builds that nothing reads any more. `lastCount` was
 * persisted but never read back; leaving it on upgraded profiles would make
 * PRIVACY.md's storage disclosure wrong for those users.
 */
const LEGACY_KEYS = ["lastCount"];

/* ------------------------------------------------------------------ */
/* settings                                                            */
/* ------------------------------------------------------------------ */

async function getSettings() {
  const stored = await api.storage.local.get(DEFAULTS);
  const s = { ...DEFAULTS, ...stored };

  const n = Number(s.interval);
  s.interval = Number.isFinite(n)
    ? Math.min(LIMITS.maxInterval, Math.max(LIMITS.minInterval, n))
    : DEFAULTS.interval;

  // Defensive normalization: storage may hold values the options UI would
  // reject (older version, sync, manual edit), including duplicates such as
  // "0,0" or "0,00" that would otherwise sum one mailbox twice.
  s.accounts = normalizeAccounts(s.accounts, {
    maxAccounts: LIMITS.maxAccounts,
    maxIndex: LIMITS.maxAccountIndex
  });
  if (s.accounts.length === 0) s.accounts = ["0"];

  s.label = String(s.label || "").slice(0, LIMITS.maxLabelLength);
  s.reuseTab = s.reuseTab !== false;
  return s;
}

/* ------------------------------------------------------------------ */
/* generation                                                          */
/* ------------------------------------------------------------------ */

/**
 * Generation counter. Bumped whenever the permission state or the
 * configuration changes. A run that started under an older generation is not
 * allowed to write a badge or a status: its result describes a world that no
 * longer exists.
 */
let generation = 0;

function isCurrent(gen) {
  return gen === undefined || gen === generation;
}

/* ------------------------------------------------------------------ */
/* mutation funnel                                                     */
/* ------------------------------------------------------------------ */

/**
 * Every background-owned badge and storage write goes through here.
 *
 * Two properties are enforced, and only these two:
 *
 *   1. No write is *initiated* under a superseded generation. The generation
 *      is re-read immediately before each individual external API call, not
 *      once per commit, so a supersession landing between two calls of the
 *      same commit stops the remaining ones.
 *
 *   2. Mutations are strictly serialized in enqueue order. A commit enqueued
 *      after another cannot interleave with it or overtake it.
 *
 * Together these give the guarantee that matters: after supersession the old
 * generation initiates no further writes, and because the superseding
 * generation enqueues its own commit behind whatever is already queued, that
 * commit runs afterwards — and, PROVIDED ITS BROWSER API CALLS SUCCEED, its
 * values are the ones left in place.
 *
 * That proviso is not boilerplate. Badge ops below are `soft`: a failing
 * action.set* call is logged and the rest of its group skipped, so a browser
 * that refuses a badge call leaves the previous generation's text on screen
 * until some later write succeeds. Storage ops are hard and propagate. Nothing
 * here retries or otherwise recovers, so the ownership claim is conditional on
 * those mutations succeeding and is stated that way in README.md and
 * PUBLISHING.md.
 *
 * What is NOT claimed: a call already handed to the browser cannot be recalled.
 * If setBadgeText was issued a microsecond before revocation, that text was
 * shown. The queue does not undo it; it guarantees the current generation's
 * write runs afterwards and (again, if it succeeds) overwrites it.
 */
let mutationChain = Promise.resolve();

const NOOP = () => {};

/** Run `task` once every previously enqueued mutation has settled. */
function enqueue(task) {
  const run = mutationChain.then(task, task);
  // Swallowed on the chain only, so one failed commit cannot wedge the queue.
  // The caller still sees the rejection through `run`.
  mutationChain = run.then(NOOP, NOOP);
  return run;
}

/**
 * Apply an ordered list of single external API mutations under generation
 * `gen`, re-checking the generation immediately before each one.
 *
 * `soft` ops mirror the old setBadge() behaviour: a failing badge call is
 * logged rather than thrown and the rest of its group is skipped, because a
 * half-written badge is worse than a stale one. Storage ops are hard and
 * propagate to the caller.
 */
async function applyMutations(gen, ops) {
  const result = { writes: 0, superseded: false, applied: [] };
  const skipped = new Set();

  for (const op of ops) {
    if (op.group && skipped.has(op.group)) continue;
    if (!isCurrent(gen)) {
      result.superseded = true;
      return result;
    }
    try {
      await op.run();
      result.writes++;
      result.applied.push(op.label);
    } catch (e) {
      if (!op.soft) throw e;
      console.warn(`mutation failed: ${op.label}`, e);
      if (op.group) skipped.add(op.group);
    }
  }
  return result;
}

/* --- op builders: each `run` is exactly one external API call --- */

function badgeOps(badge) {
  const ops = [
    { label: "action.setBadgeText", group: "badge", soft: true,
      run: () => api.action.setBadgeText({ text: badge.text }) },
    { label: "action.setBadgeBackgroundColor", group: "badge", soft: true,
      run: () => api.action.setBadgeBackgroundColor({ color: badge.color }) }
  ];
  if (api.action.setBadgeTextColor) {
    ops.push({ label: "action.setBadgeTextColor", group: "badge", soft: true,
      run: () => api.action.setBadgeTextColor({ color: BADGE_TEXT_COLOR }) });
  }
  ops.push({ label: "action.setTitle", group: "badge", soft: true,
    run: () => api.action.setTitle({ title: badge.title }) });
  return ops;
}

/**
 * `lastCheck` is stamped when the write drains, not when the commit was built,
 * so the stored time is when this state was recorded rather than when it was
 * computed.
 */
function statusOp(status, extra) {
  return {
    label: "storage.set:status",
    soft: false,
    run: () => api.storage.local.set({ status, lastCheck: Date.now(), ...(extra || {}) })
  };
}

function lastGoodSetOp(good) {
  return {
    label: "storage.set:lastGood",
    soft: false,
    run: () => api.storage.local.set({ lastGood: good })
  };
}

function lastGoodRemoveOp() {
  return {
    label: "storage.remove:lastGood",
    soft: false,
    run: () => api.storage.local.remove("lastGood")
  };
}

/**
 * Enqueue one commit. Ops run in the order given: lastGood first, so a
 * successful total is durable before the badge advertises it; then the badge;
 * then the status the options page reads.
 */
function commitState({ gen, badge, status, extra, good, cleanup }) {
  const ops = [];
  if (good) ops.push(lastGoodSetOp(good));
  if (cleanup) ops.push(...cleanup);
  if (badge) ops.push(...badgeOps(badge));
  if (status) ops.push(statusOp(status, extra));
  return enqueue(() => applyMutations(gen, ops));
}

/**
 * One-shot removal of keys no generation owns. Serialized like everything
 * else, but deliberately not generation-guarded: nothing writes `lastCount`
 * any more, so no generation can be superseded with respect to it, and
 * skipping the cleanup would leave the storage disclosure inaccurate.
 */
function purgeLegacyKeys() {
  return enqueue(() => api.storage.local.remove(LEGACY_KEYS));
}

/* ------------------------------------------------------------------ */
/* feed                                                                */
/* ------------------------------------------------------------------ */

function feedUrl(account, label) {
  const base = `https://mail.google.com/mail/u/${account}/feed/atom`;
  return label ? `${base}/${encodeURIComponent(label)}` : base;
}

function feedError(kind, message) {
  const err = new Error(message || kind);
  err.kind = kind;   // auth | http | network | timeout | parse
  return err;
}

/**
 * Read the response only as far as the unread count.
 *
 * The scanner matches the integer out of a bounded sliding window and drops
 * that window as soon as the count is found, so no <entry> element is ever
 * parsed into a document, retained, displayed or transmitted. What this does
 * NOT claim: chunk boundaries are arbitrary and the network may already have
 * delivered bytes that follow the count. Cancelling the reader stops the
 * extension requesting more; it cannot un-deliver what is already in flight.
 *
 * There is no res.text() fallback. ReadableStream response bodies are
 * available throughout the supported range (Firefox desktop 140+), and a
 * fallback that reads the whole document would contradict the paragraph above.
 */
async function readCount(res, limitBytes) {
  if (!res.body || typeof res.body.getReader !== "function") {
    throw feedError("network", "response body is not readable as a stream");
  }
  return await readCountFromStream(res.body, { maxBytes: limitBytes });
}

/**
 * In-flight aborts, so a permission or configuration change can cancel work
 * started under the previous state instead of letting it finish and write.
 */
const activeControllers = new Set();

function abortActiveRequests() {
  for (const c of Array.from(activeControllers)) {
    try { c.abort(); } catch (_) { /* already aborted */ }
  }
  activeControllers.clear();
}

async function fetchCount(account, label) {
  const controller = new AbortController();
  activeControllers.add(controller);
  // The timer must outlive the body read: fetch() resolves on headers, and a
  // stalled body would otherwise hang forever past the advertised timeout.
  const timer = setTimeout(() => controller.abort(), LIMITS.fetchTimeoutMs);

  try {
    let res;
    try {
      res = await fetch(feedUrl(account, label), {
        credentials: "include",
        cache: "no-store",
        redirect: "follow",
        signal: controller.signal,
        headers: { "Cache-Control": "no-cache", "Pragma": "no-cache" }
      });
    } catch (e) {
      throw e && e.name === "AbortError"
        ? feedError("timeout", "timed out waiting for response headers")
        : feedError("network", String(e && e.message));
    }

    if (res.status === 401 || res.status === 403) throw feedError("auth", `HTTP ${res.status}`);
    if (!res.ok) throw feedError("http", `HTTP ${res.status}`);

    let redirected = false;
    try { redirected = !new URL(res.url).pathname.includes("/feed/atom"); } catch (_) {}
    const looksLikeHtml = (res.headers.get("content-type") || "").toLowerCase().includes("html");

    let body;
    try {
      body = await readCount(res, LIMITS.maxBodyBytes);
    } catch (e) {
      if (e && e.kind) throw e;
      throw e && e.name === "AbortError"
        ? feedError("timeout", "timed out reading response body")
        : feedError("network", String(e && e.message));
    }

    if (body.count === null) {
      if (redirected || looksLikeHtml) throw feedError("auth", "redirected to a non-feed page");
      throw feedError("parse", body.truncated ? "no fullcount within byte limit" : "no fullcount in feed");
    }
    return body.count;
  } finally {
    clearTimeout(timer);
    activeControllers.delete(controller);
  }
}

/* ------------------------------------------------------------------ */
/* state helpers                                                       */
/* ------------------------------------------------------------------ */

const SUPERSEDED = { status: "superseded", count: null };

/**
 * The last complete total, keyed by configuration. Live state: it is what
 * keeps the badge from dropping to a misleadingly low number when one of
 * several mailboxes is briefly unreachable. The key comparison is what stops a
 * total gathered under one account/label set being shown under another.
 */
async function readGoodTotal(key) {
  const { lastGood } = await api.storage.local.get({ lastGood: null });
  return lastGood && lastGood.key === key && Number.isInteger(lastGood.total)
    ? lastGood.total
    : null;
}

function formatCount(n) {
  if (n > 9999) return "9k+";
  if (n > 999) return "999+";
  return String(n);
}

/* ------------------------------------------------------------------ */
/* main check                                                          */
/* ------------------------------------------------------------------ */

let inFlight = null;
let queued = false;

/** All callers during an active check await that same operation. */
function check() {
  if (inFlight) return inFlight;
  inFlight = runCheck().finally(() => {
    inFlight = null;
    if (queued) { queued = false; check(); }
  });
  return inFlight;
}

/**
 * The state a check was based on has changed.
 *
 * MUST be called synchronously, before any await in the handler that observed
 * the change: a run started under the old state can otherwise reach its commit
 * during that await and enqueue under a generation that still looks current.
 */
function invalidateNow() {
  generation++;
  abortActiveRequests();
}

/** Exactly one fresh check, after the current operation settles. */
function recheck() {
  if (inFlight) queued = true;
  else check();
}

function invalidate() {
  invalidateNow();
  recheck();
}

async function runCheck() {
  const gen = generation;

  /** Enqueue this run's writes; report whether they were still wanted. */
  const commit = async (badge, status, count, extra, good) => {
    const res = await commitState({ gen, badge, status, extra, good });
    if (res.superseded) return SUPERSEDED;
    return {
      status,
      count: Number.isInteger(count) ? count : null,
      ...(extra || {})
    };
  };

  try {
    const granted = await api.permissions.contains({ origins: [GMAIL_ORIGIN] });
    if (!granted) {
      return await commit(PERMISSION_BADGE, "permission", null);
    }

    const { accounts, label } = await getSettings();
    const key = configKey(accounts, label);

    // Parallel: five sequential 15s timeouts would take 75s, longer than the
    // default polling interval. Order is preserved for the tooltip.
    const results = await Promise.allSettled(
      accounts.map((acct) => fetchCount(acct, label))
    );

    if (gen !== generation) return SUPERSEDED;

    let sum = 0;
    let ok = 0;
    const kinds = [];
    const lines = results.map((r, i) => {
      const acct = accounts[i];
      if (r.status === "fulfilled") {
        sum += r.value; ok++;
        return `Account ${acct}: ${r.value} unread`;
      }
      const kind = (r.reason && r.reason.kind) || "error";
      kinds.push(kind);
      return `Account ${acct}: unavailable (${kind})`;
    });
    const detail = lines.join("\n");

    if (ok === 0) {
      const allAuth = kinds.length > 0 && kinds.every((k) => k === "auth");
      const headline = allAuth
        ? `${NAME} — not signed in.\nClick to open Gmail and sign in.`
        : `${NAME} — couldn't reach Gmail.\nClick to open Gmail.`;
      return await commit({ text: "?", color: COLORS.error, title: `${headline}\n${detail}` },
        allAuth ? "auth" : "error", null);
    }

    if (ok < accounts.length) {
      const cached = await readGoodTotal(key);
      const usingCache = cached !== null;
      const shown = usingCache ? cached : sum;
      const note = usingCache ? "showing last known total" : "showing partial total";
      return await commit(
        {
          text: shown > 0 ? formatCount(shown) : "",
          color: COLORS.stale,
          title: `${NAME} — ${accounts.length - ok} account(s) unavailable, ${note}.\n${detail}`
        },
        "partial",
        shown,
        { partialSource: usingCache ? "cached" : "partial" }
      );
    }

    return await commit(
      {
        text: sum > 0 ? formatCount(sum) : "",
        color: sum > 0 ? COLORS.unread : COLORS.idle,
        title: `Gmail — ${detail}`
      },
      "ok", sum, null, { key, total: sum }
    );
  } catch (e) {
    console.error("check failed", e);
    if (gen !== generation) return SUPERSEDED;
    return await commit(
      { text: "?", color: COLORS.error, title: `${NAME} — error. Click to open Gmail.` },
      "error", null
    );
  }
}

/* ------------------------------------------------------------------ */
/* scheduling                                                          */
/* ------------------------------------------------------------------ */

async function rescheduleAlarm() {
  const { interval } = await getSettings();
  await api.alarms.clear(ALARM);
  api.alarms.create(ALARM, { periodInMinutes: interval, delayInMinutes: interval });
}

api.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) check();
});

api.runtime.onInstalled.addListener(async () => {
  await purgeLegacyKeys();
  await rescheduleAlarm();
  check();
});

api.runtime.onStartup.addListener(async () => {
  await rescheduleAlarm();
  check();
});

api.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (!changes.accounts && !changes.label && !changes.interval) return;

  // Synchronous, before the awaits below. A configuration change invalidates a
  // run in progress for the same reason a permission change does: its result
  // describes the previous configuration.
  invalidateNow();
  const gen = generation;

  return (async () => {
    if (changes.accounts || changes.label) {
      // Guarded like every other write. If a further change supersedes this
      // one the removal is skipped, which is harmless: readGoodTotal()
      // compares the stored key against the current configuration, so a total
      // left behind under an old key is never shown.
      await commitState({ gen, cleanup: [lastGoodRemoveOp()] });
    }
    if (changes.interval) await rescheduleAlarm();
    recheck();
  })();
});

api.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === "check-now") return check();
});

/**
 * Permission changes are not "please check again" — they invalidate whatever
 * is running. Calling check() alone would return the in-flight promise, which
 * still holds the old permission state and could restore a numeric badge over
 * a revocation.
 */
if (api.permissions.onRemoved) {
  api.permissions.onRemoved.addListener((removed) => {
    if (removed && Array.isArray(removed.origins) && removed.origins.length === 0) return;
    invalidateNow();                       // synchronous, before any await
    const gen = generation;
    return (async () => {
      // Reflect the revocation now rather than after the queued check settles.
      // Enqueued behind any commit already in the queue, so it runs last.
      await commitState({ gen, badge: PERMISSION_BADGE, status: "permission" });
      recheck();
    })();
  });
}
if (api.permissions.onAdded) {
  api.permissions.onAdded.addListener(() => invalidate());
}

/* ------------------------------------------------------------------ */
/* toolbar click                                                       */
/* ------------------------------------------------------------------ */

async function openGmail() {
  const { accounts, reuseTab } = await getSettings();
  const accountBase = `https://mail.google.com/mail/u/${accounts[0]}/`;

  if (reuseTab) {
    const tabs = await api.tabs.query({});
    // Without the host permission tab URLs are not visible and `url` is
    // undefined; the guard makes that fall through to opening a new tab.
    const existing = tabs.find(
      (t) => typeof t.url === "string" && t.url.startsWith(accountBase)
    );
    if (existing) {
      await api.tabs.update(existing.id, { active: true });
      try { await api.windows.update(existing.windowId, { focused: true }); } catch (_) {}
      return;
    }
  }
  await api.tabs.create({ url: accountBase });
}

async function handleClick(permissionPromise) {
  let granted = false;
  try { granted = await permissionPromise; } catch (_) { granted = false; }

  // Resolve the prompt before touching tabs: focusing or opening a tab while
  // the prompt is up can dismiss it, and tab URLs are not visible without the
  // host permission, which would defeat reuseTab.
  if (!granted) {
    await commitState({ gen: generation, badge: PERMISSION_BADGE, status: "permission" });
  }

  await openGmail();               // must happen on grant, denial and dismissal

  // Check immediately rather than on a DOM timer. Timers do not survive event
  // page suspension, so a setTimeout here was not a reliable refresh. If the
  // user still has to sign in, the one-minute alarm picks it up.
  if (granted) await check();
}

api.action.onClicked.addListener(() => {
  // Must be invoked synchronously: awaiting anything first discards user-action
  // status and the request silently fails. With optional_host_permissions this
  // is the only place the Gmail origin is ever requested.
  let permissionPromise;
  try {
    permissionPromise = api.permissions.request({ origins: [GMAIL_ORIGIN] });
  } catch (e) {
    permissionPromise = Promise.resolve(false);
  }
  permissionPromise.catch(() => {});
  // Returned so the browser can keep the event page alive for the async work
  // where it honours that; the awaits above do not depend on it.
  return handleClick(permissionPromise);
});

check();

/* Test surface. `module` does not exist in the extension's background scope. */
if (typeof module === "object" && module.exports) {
  module.exports = {
    check,
    recheck,
    invalidate,
    invalidateNow,
    getGeneration: () => generation,
    /** Resolves when every enqueued mutation has drained. */
    mutationsSettled: () => mutationChain,
    /** The funnel itself, so its ordering guarantee can be tested directly. */
    commitState,
    DEFAULTS,
    LIMITS,
    COLORS,
    PERMISSION_TITLE,
    GMAIL_ORIGIN,
    LEGACY_KEYS
  };
}
