"use strict";

const test = require("node:test");
const assert = require("node:assert");
const {
  loadBackground, settle, atomResponse, GMAIL_ORIGIN
} = require("./mock-browser.js");

/* ================================================================== */
/* A. The mutation funnel                                              */
/* ================================================================== */

/**
 * These drive `commitState` directly. The listener-level tests further down
 * cover the same guarantee through real events; these pin down the mechanism
 * with no scheduling ambiguity, so a regression names itself.
 */

test("a generation invalidated while still queued performs zero writes", async () => {
  const { browser, bg } = loadBackground({ origins: [GMAIL_ORIGIN], feeds: { "/u/0/": 3 } });
  await settle(bg);

  const hold = browser.__hold("action.setBadgeText");
  const gen = bg.getGeneration();
  const mark = browser.__log.length;

  // First commit occupies the queue and stalls after its first write.
  const first = bg.commitState({
    gen, badge: { text: "A", color: "#111111", title: "A" }, status: "a"
  });
  await hold.reached;

  // Second commit is enqueued behind it and has not started.
  const second = bg.commitState({
    gen, badge: { text: "B", color: "#222222", title: "B" }, status: "b"
  });

  bg.invalidateNow();                       // both are now stale
  hold.release();

  const r1 = await first;
  const r2 = await second;

  assert.strictEqual(r2.superseded, true);
  assert.strictEqual(r2.writes, 0, "a queued stale commit must not write at all");
  assert.deepStrictEqual(r2.applied, []);

  // Nothing from commit B reached the browser.
  assert.strictEqual(
    browser.__entries("action.setBadgeText", mark).filter((e) => e.text === "B").length,
    0
  );
  assert.strictEqual(
    browser.__statusWrites(mark).filter((e) => e.payload.status === "b").length,
    0
  );
  assert.ok(r1.writes >= 1);
});

test("a generation invalidated after its first write initiates no further writes", async () => {
  const { browser, bg } = loadBackground({ origins: [GMAIL_ORIGIN], feeds: { "/u/0/": 3 } });
  await settle(bg);

  const hold = browser.__hold("action.setBadgeText");
  const gen = bg.getGeneration();
  const mark = browser.__log.length;

  const commit = bg.commitState({
    gen, badge: { text: "A", color: "#111111", title: "A" }, status: "a"
  });
  await hold.reached;                       // setBadgeText("A") is already out

  bg.invalidateNow();
  hold.release();
  const res = await commit;

  assert.strictEqual(res.superseded, true);
  assert.strictEqual(res.writes, 1, "the already-issued write counts, and only it");
  assert.deepStrictEqual(res.applied, ["action.setBadgeText"]);

  // The issued write is visible — it cannot be recalled and we do not pretend
  // otherwise — but nothing after it in the same commit ran.
  assert.strictEqual(browser.__entries("action.setBadgeText", mark).length, 1);
  assert.strictEqual(browser.__entries("action.setBadgeBackgroundColor", mark).length, 0);
  assert.strictEqual(browser.__entries("action.setTitle", mark).length, 0);
  assert.strictEqual(browser.__statusWrites(mark).length, 0);
});

test("the current generation owns the final badge and storage state when its mutations succeed", async () => {
  const { browser, bg } = loadBackground({ origins: [GMAIL_ORIGIN], feeds: { "/u/0/": 3 } });
  await settle(bg);

  const hold = browser.__hold("action.setBadgeText");
  const stale = bg.getGeneration();
  const mark = browser.__log.length;

  const first = bg.commitState({
    gen: stale, badge: { text: "A", color: "#111111", title: "A" }, status: "a"
  });
  await hold.reached;

  const second = bg.commitState({
    gen: stale, badge: { text: "B", color: "#222222", title: "B" }, status: "b"
  });

  bg.invalidateNow();
  const current = bg.getGeneration();
  const third = bg.commitState({
    gen: current, badge: { text: "C", color: "#333333", title: "C" }, status: "c"
  });

  hold.release();
  await Promise.all([first, second, third]);
  await settle(bg);

  const r3 = await third;
  assert.strictEqual(r3.superseded, false);

  assert.strictEqual(browser.__lastBadgeText(mark), "C");
  assert.strictEqual(browser.__lastTitle(mark), "C");
  assert.strictEqual(browser.__lastStatus(mark).status, "c");
  assert.strictEqual(browser.__store.status, "c");
});

test("commits are serialized: a later commit cannot interleave with an earlier one", async () => {
  const { browser, bg } = loadBackground({ origins: [GMAIL_ORIGIN], feeds: { "/u/0/": 3 } });
  await settle(bg);

  const hold = browser.__hold("action.setBadgeText");
  const gen = bg.getGeneration();
  const mark = browser.__log.length;

  const first = bg.commitState({
    gen, badge: { text: "A", color: "#111111", title: "A" }, status: "a"
  });
  await hold.reached;
  const second = bg.commitState({
    gen, badge: { text: "B", color: "#222222", title: "B" }, status: "b"
  });
  hold.release();
  await Promise.all([first, second]);

  const texts = browser.__entries("action.setBadgeText", mark).map((e) => e.text);
  const titles = browser.__entries("action.setTitle", mark).map((e) => e.title);
  assert.deepStrictEqual(texts, ["A", "B"]);
  assert.deepStrictEqual(titles, ["A", "B"], "B's ops must all follow A's, never mix");

  const order = browser.__log.slice(mark).map((e) => e.label);
  const firstB = order.indexOf("action.setBadgeText", order.indexOf("action.setBadgeText") + 1);
  const lastAStatus = order.indexOf("storage.set");
  assert.ok(lastAStatus < firstB, "A's status write precedes B's first write");
});

test("a generation check happens before each individual API call, not once per commit", async () => {
  const { browser, bg } = loadBackground({ origins: [GMAIL_ORIGIN], feeds: { "/u/0/": 3 } });
  await settle(bg);

  // Hold on the *second* call of the commit rather than the first.
  const hold = browser.__hold("action.setBadgeBackgroundColor");
  const gen = bg.getGeneration();
  const mark = browser.__log.length;

  const commit = bg.commitState({
    gen, badge: { text: "A", color: "#111111", title: "A" }, status: "a"
  });
  await hold.reached;
  bg.invalidateNow();
  hold.release();
  const res = await commit;

  assert.strictEqual(res.superseded, true);
  assert.deepStrictEqual(res.applied, ["action.setBadgeText", "action.setBadgeBackgroundColor"]);
  assert.strictEqual(browser.__entries("action.setTitle", mark).length, 0,
    "supersession between calls two and three must stop call three");
});

/* ================================================================== */
/* B. Invalidation through real events                                 */
/* ================================================================== */

/**
 * These assert the *timing* contract rather than an outcome. Deferring the
 * generation bump by even one microtask leaves a window in which a run that
 * has just finished fetching still sees itself as current and commits a result
 * describing the previous world. Nothing observable afterwards distinguishes
 * that reliably, so the synchrony is asserted where it is decided: inside the
 * listener turn, with no await between the event and the check.
 */
test("permissions.onRemoved bumps the generation synchronously, before any await", async () => {
  const { browser, bg } = loadBackground({ origins: [GMAIL_ORIGIN], feeds: { "/u/0/": 7 } });
  await settle(bg);

  const before = bg.getGeneration();
  browser.__revoke([GMAIL_ORIGIN]);         // emit() calls the listener synchronously
  assert.strictEqual(bg.getGeneration(), before + 1,
    "the generation must be bumped before the listener yields");

  await settle(bg);
});

test("permissions.onAdded bumps the generation synchronously, before any await", async () => {
  const { browser, bg } = loadBackground({ origins: [], feeds: { "/u/0/": 7 } });
  await settle(bg);

  const before = bg.getGeneration();
  browser.__grant([GMAIL_ORIGIN]);
  assert.strictEqual(bg.getGeneration(), before + 1);

  await settle(bg);
});

test("storage.onChanged bumps the generation synchronously, before any await", async () => {
  const { browser, bg } = loadBackground({
    origins: [GMAIL_ORIGIN], storage: { accounts: "0" }, feeds: { "/u/0/": 7, "/u/1/": 9 }
  });
  await settle(bg);

  const before = bg.getGeneration();
  browser.__changed({ accounts: { oldValue: "0", newValue: "0,1" } }, "local");
  assert.strictEqual(bg.getGeneration(), before + 1);

  await settle(bg);
});

test("an unrelated storage change does not bump the generation", async () => {
  const { browser, bg } = loadBackground({ origins: [GMAIL_ORIGIN], feeds: { "/u/0/": 7 } });
  await settle(bg);

  const before = bg.getGeneration();
  browser.__changed({ status: { oldValue: "ok", newValue: "ok" } }, "local");
  browser.__changed({ accounts: { newValue: "0" } }, "sync");
  assert.strictEqual(bg.getGeneration(), before,
    "status writes and non-local areas must not invalidate anything");

  await settle(bg);
});

test("permission revocation during a commit leaves the badge revoked", async () => {
  const { browser, bg } = loadBackground({ origins: [GMAIL_ORIGIN], feeds: { "/u/0/": 12 } });
  await settle(bg);

  const mark = browser.__log.length;
  const hold = browser.__hold("action.setBadgeText");

  const running = bg.check();
  await hold.reached;                       // "12" has already been issued
  assert.strictEqual(browser.__lastBadgeText(mark), "12");

  browser.__revoke([GMAIL_ORIGIN]);         // invalidateNow runs synchronously
  hold.release();
  await running;
  await settle(bg);

  assert.strictEqual(browser.__lastBadgeText(mark), "!");
  assert.strictEqual(browser.__lastStatus(mark).status, "permission");
  assert.strictEqual(browser.__store.status, "permission");
});

test("an account change during a commit leaves the new configuration's result", async () => {
  const { browser, bg } = loadBackground({
    origins: [GMAIL_ORIGIN],
    storage: { accounts: "0" },
    feeds: { "/u/0/": 5, "/u/1/": 9 }
  });
  await settle(bg);

  const mark = browser.__log.length;
  const hold = browser.__hold("action.setBadgeText");

  const running = bg.check();
  await hold.reached;
  assert.strictEqual(browser.__lastBadgeText(mark), "5", "old configuration's write went out");

  await browser.storage.local.set({ accounts: "0,1" });
  hold.release();
  await running;
  await settle(bg);

  assert.strictEqual(browser.__lastBadgeText(mark), "14", "5 + 9 under the new configuration");
  assert.strictEqual(browser.__lastStatus(mark).status, "ok");
});

test("a check superseded before committing reports superseded and writes nothing", async () => {
  const { browser, bg } = loadBackground({ origins: [GMAIL_ORIGIN], feeds: { "/u/0/": 4 } });
  await settle(bg);

  const mark = browser.__log.length;

  // Invalidate while the request is still in flight, so runCheck's own
  // post-fetch generation check short-circuits before it reaches commitState.
  const running = bg.check();
  bg.invalidateNow();
  const res = await running;

  assert.strictEqual(res.status, "superseded");
  assert.strictEqual(res.count, null);
  assert.strictEqual(browser.__statusWrites(mark).filter((e) => e.payload.status === "ok").length, 0);
  await settle(bg);
});

/* ================================================================== */
/* C. Optional host permission                                         */
/* ================================================================== */

test("first run with the Gmail permission ungranted shows ! and makes no Atom-feed request", async () => {
  const { browser, bg } = loadBackground({ origins: [], feeds: { "/u/0/": 7 } });
  await settle(bg);

  assert.strictEqual(browser.__lastBadgeText(), "!");
  assert.match(browser.__lastTitle(), /permission needed/);
  assert.strictEqual(browser.__lastStatus().status, "permission");
  assert.strictEqual(browser.__entries("fetch").length, 0,
    "no Atom-feed fetch may be made before the origin is granted (this is not a " +
    "claim about tab navigation, which no click has triggered here)");
});

test("the first click requests the Gmail origin synchronously, before any await", async () => {
  const { browser, bg } = loadBackground({ origins: [], feeds: { "/u/0/": 7 } });
  await settle(bg);

  const mark = browser.__log.length;
  const pending = browser.__click();

  // Asserted before awaiting anything: the request must already be logged.
  const reqs = browser.__entries("permissions.request", mark);
  assert.strictEqual(reqs.length, 1, "permissions.request must be called in the gesture turn");
  assert.deepStrictEqual(reqs[0].origins, [GMAIL_ORIGIN]);

  await pending;
  await settle(bg);
});

test("granting on first click opens Gmail and produces a count", async () => {
  const { browser, bg } = loadBackground({ origins: [], feeds: { "/u/0/": 7 } });
  await settle(bg);

  const mark = browser.__log.length;
  await browser.__click();
  await settle(bg);

  assert.ok(browser.__origins.has(GMAIL_ORIGIN));
  assert.strictEqual(browser.__entries("tabs.create", mark).length, 1);
  assert.strictEqual(browser.__lastBadgeText(mark), "7");
  assert.strictEqual(browser.__lastStatus(mark).status, "ok");
});

test("denying on first click still opens Gmail and leaves the badge at !", async () => {
  const { browser, bg } = loadBackground({
    origins: [], grantOnRequest: false, feeds: { "/u/0/": 7 }
  });
  await settle(bg);

  const mark = browser.__log.length;
  await browser.__click();
  await settle(bg);

  assert.strictEqual(browser.__origins.has(GMAIL_ORIGIN), false);
  // Two separate facts, asserted separately on purpose. Denial stops the
  // Atom-feed read; it does not stop the click from navigating to Gmail, and
  // documentation that reports only the second assertion is wrong.
  assert.strictEqual(browser.__entries("fetch", mark).length, 0,
    "denial means zero background Atom-feed fetches");
  assert.strictEqual(browser.__entries("tabs.create", mark).length, 1,
    "denial still opens Gmail: one tab navigation, which is traffic to Google");
  assert.strictEqual(browser.__lastBadgeText(mark), "!");
  assert.strictEqual(browser.__lastStatus(mark).status, "permission");
});

test("dismissing the prompt behaves like denial", async () => {
  const { browser, bg } = loadBackground({
    origins: [], requestRejects: true, feeds: { "/u/0/": 7 }
  });
  await settle(bg);

  const mark = browser.__log.length;
  await browser.__click();
  await settle(bg);

  assert.strictEqual(browser.__lastBadgeText(mark), "!");
  assert.strictEqual(browser.__entries("fetch", mark).length, 0);
  assert.strictEqual(browser.__entries("tabs.create", mark).length, 1);
});

test("a permissions.request that throws is handled and still opens Gmail", async () => {
  const { browser, bg } = loadBackground({
    origins: [], requestThrows: true, feeds: { "/u/0/": 7 }
  });
  await settle(bg);

  const mark = browser.__log.length;
  await browser.__click();
  await settle(bg);

  assert.strictEqual(browser.__lastBadgeText(mark), "!");
  assert.strictEqual(browser.__entries("fetch", mark).length, 0);
  assert.strictEqual(browser.__entries("tabs.create", mark).length, 1);
});

test("revocation while idle turns the badge back to !", async () => {
  const { browser, bg } = loadBackground({ origins: [GMAIL_ORIGIN], feeds: { "/u/0/": 7 } });
  await settle(bg);
  assert.strictEqual(browser.__lastBadgeText(), "7");

  const mark = browser.__log.length;
  browser.__revoke([GMAIL_ORIGIN]);
  await settle(bg);

  assert.strictEqual(browser.__lastBadgeText(mark), "!");
  assert.strictEqual(browser.__lastStatus(mark).status, "permission");
});

test("a revoked permission can be requested again by clicking", async () => {
  const { browser, bg } = loadBackground({ origins: [GMAIL_ORIGIN], feeds: { "/u/0/": 7 } });
  await settle(bg);

  browser.__revoke([GMAIL_ORIGIN]);
  await settle(bg);
  assert.strictEqual(browser.__lastBadgeText(), "!");

  const mark = browser.__log.length;
  await browser.__click();
  await settle(bg);

  assert.strictEqual(browser.__entries("permissions.request", mark).length, 1);
  assert.ok(browser.__origins.has(GMAIL_ORIGIN));
  assert.strictEqual(browser.__lastBadgeText(mark), "7");
  assert.strictEqual(browser.__lastStatus(mark).status, "ok");
});

test("permissions.onAdded triggers a fresh check under a new generation", async () => {
  const { browser, bg } = loadBackground({ origins: [], feeds: { "/u/0/": 7 } });
  await settle(bg);
  const before = bg.getGeneration();

  browser.__grant([GMAIL_ORIGIN]);
  await settle(bg);

  assert.ok(bg.getGeneration() > before, "granting must bump the generation");
  assert.strictEqual(browser.__lastBadgeText(), "7");
});

test("without the host permission a Gmail tab is not visible, so a new tab opens", async () => {
  const { browser, bg } = loadBackground({
    origins: [],
    grantOnRequest: false,
    tabs: [{ url: "https://mail.google.com/mail/u/0/#inbox" }],
    feeds: { "/u/0/": 7 }
  });
  await settle(bg);

  const mark = browser.__log.length;
  await browser.__click();
  await settle(bg);

  assert.strictEqual(browser.__entries("tabs.update", mark).length, 0);
  assert.strictEqual(browser.__entries("tabs.create", mark).length, 1);
});

test("with the host permission an existing Gmail tab is reused", async () => {
  const { browser, bg } = loadBackground({
    origins: [GMAIL_ORIGIN],
    tabs: [{ url: "https://mail.google.com/mail/u/0/#inbox" }],
    feeds: { "/u/0/": 7 }
  });
  await settle(bg);

  const mark = browser.__log.length;
  await browser.__click();
  await settle(bg);

  assert.strictEqual(browser.__entries("tabs.update", mark).length, 1);
  assert.strictEqual(browser.__entries("tabs.create", mark).length, 0);
});

/* ================================================================== */
/* D. lastGood                                                         */
/* ================================================================== */

test("lastGood is not reused across configuration keys", async () => {
  const { browser, bg } = loadBackground({
    origins: [GMAIL_ORIGIN],
    storage: { accounts: "0,1", lastGood: { key: "0|", total: 42 } },
    feeds: {
      "/u/0/": 5,
      "/u/1/": () => { throw new TypeError("NetworkError"); }
    }
  });
  await settle(bg);

  const status = browser.__lastStatus();
  assert.strictEqual(status.status, "partial");
  assert.strictEqual(status.partialSource, "partial",
    "a total stored under key '0|' must not be shown under '0,1|'");
  assert.strictEqual(browser.__lastBadgeText(), "5");
});

test("lastGood is reused when the configuration key matches", async () => {
  const { browser, bg } = loadBackground({
    origins: [GMAIL_ORIGIN],
    storage: { accounts: "0,1", lastGood: { key: "0,1|", total: 42 } },
    feeds: {
      "/u/0/": 5,
      "/u/1/": () => { throw new TypeError("NetworkError"); }
    }
  });
  await settle(bg);

  const status = browser.__lastStatus();
  assert.strictEqual(status.status, "partial");
  assert.strictEqual(status.partialSource, "cached");
  assert.strictEqual(browser.__lastBadgeText(), "42");
});

test("a successful check stores lastGood under the current configuration key", async () => {
  const { browser, bg } = loadBackground({
    origins: [GMAIL_ORIGIN],
    storage: { accounts: "0,1" },
    feeds: { "/u/0/": 5, "/u/1/": 9 }
  });
  await settle(bg);

  assert.deepStrictEqual(browser.__store.lastGood, { key: "0,1|", total: 14 });
});

test("changing accounts clears lastGood", async () => {
  const { browser, bg } = loadBackground({
    origins: [GMAIL_ORIGIN],
    storage: { accounts: "0,1" },
    feeds: { "/u/0/": 5, "/u/1/": 9 }
  });
  await settle(bg);
  assert.ok(browser.__store.lastGood);

  const mark = browser.__log.length;
  await browser.storage.local.set({ accounts: "0" });
  await settle(bg);

  const removals = browser.__entries("storage.remove", mark)
    .filter((e) => e.keys.includes("lastGood"));
  assert.strictEqual(removals.length, 1);
  assert.deepStrictEqual(browser.__store.lastGood, { key: "0|", total: 5 },
    "cleared, then rewritten by the follow-up check under the new key");
});

/* ================================================================== */
/* E. lastCount is gone                                                */
/* ================================================================== */

test("a successful check never persists lastCount", async () => {
  const { browser, bg } = loadBackground({ origins: [GMAIL_ORIGIN], feeds: { "/u/0/": 7 } });
  await settle(bg);

  for (const e of browser.__entries("storage.set")) {
    assert.ok(!("lastCount" in e.payload), `lastCount written in ${JSON.stringify(e.payload)}`);
  }
  assert.ok(!("lastCount" in browser.__store));
});

test("the check result reports `count`, not `lastCount`", async () => {
  const { browser, bg } = loadBackground({ origins: [GMAIL_ORIGIN], feeds: { "/u/0/": 7 } });
  await settle(bg);

  const res = await browser.runtime.sendMessage({ type: "check-now" });
  assert.strictEqual(res.status, "ok");
  assert.strictEqual(res.count, 7);
  assert.ok(!("lastCount" in res));
  await settle(bg);
});

test("an unsuccessful check reports a null count and stores no number", async () => {
  const { browser, bg } = loadBackground({
    origins: [GMAIL_ORIGIN],
    feeds: { "/u/0/": () => atomResponse(0, { status: 401 }) }
  });
  await settle(bg);

  const res = await browser.runtime.sendMessage({ type: "check-now" });
  assert.strictEqual(res.status, "auth");
  assert.strictEqual(res.count, null);
  assert.strictEqual(browser.__lastBadgeText(), "?");
  assert.ok(!("lastCount" in browser.__store));
  await settle(bg);
});

test("installing removes a lastCount left by an earlier version", async () => {
  const { browser, bg } = loadBackground({
    origins: [GMAIL_ORIGIN],
    storage: { lastCount: 7 },
    feeds: { "/u/0/": 3 }
  });
  await settle(bg);
  assert.strictEqual(browser.__store.lastCount, 7, "present until onInstalled fires");

  browser.__installed();
  await settle(bg);

  assert.ok(!("lastCount" in browser.__store), "legacy key purged on install/upgrade");
});

/* ================================================================== */
/* F. Storage surface                                                  */
/* ================================================================== */

test("only settings, status, lastCheck and lastGood are ever persisted", async () => {
  const { browser, bg } = loadBackground({
    origins: [GMAIL_ORIGIN],
    storage: { accounts: "0", label: "", interval: 1, reuseTab: true },
    feeds: { "/u/0/": 7 }
  });
  await settle(bg);
  browser.__installed();
  browser.__alarm();
  await settle(bg);

  const allowed = new Set([
    "accounts", "label", "interval", "reuseTab",
    "status", "lastCheck", "lastGood", "partialSource"
  ]);
  for (const key of Object.keys(browser.__store)) {
    assert.ok(allowed.has(key), `unexpected key persisted: ${key}`);
  }
});

test("the periodic alarm triggers a check", async () => {
  const { browser, bg } = loadBackground({ origins: [GMAIL_ORIGIN], feeds: { "/u/0/": 7 } });
  await settle(bg);

  const mark = browser.__log.length;
  browser.__alarm("gmail-check");
  await settle(bg);

  assert.ok(browser.__entries("fetch", mark).length >= 1);
});

test("badge writes survive a browser without setBadgeTextColor", async () => {
  const { browser, bg } = loadBackground({
    origins: [GMAIL_ORIGIN], noBadgeTextColor: true, feeds: { "/u/0/": 7 }
  });
  await settle(bg);

  assert.strictEqual(browser.__lastBadgeText(), "7");
  assert.strictEqual(browser.__entries("action.setBadgeTextColor").length, 0);
  assert.strictEqual(browser.__lastStatus().status, "ok");
});
