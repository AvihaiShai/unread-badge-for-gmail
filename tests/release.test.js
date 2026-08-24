"use strict";

const test = require("node:test");
const assert = require("node:assert");
const {
  loadBackground, settle, atomResponse, GMAIL_ORIGIN
} = require("./mock-browser.js");

test("release badge thresholds are rendered exactly", async () => {
  const cases = [
    [0, ""],
    [1, "1"],
    [999, "999"],
    [1000, "999+"],
    [9999, "999+"],
    [10000, "9k+"]
  ];

  for (const [count, expected] of cases) {
    const { browser, bg } = loadBackground({
      origins: [GMAIL_ORIGIN], feeds: { "/u/0/": count }
    });
    await settle(bg);
    assert.strictEqual(browser.__lastBadgeText(), expected, `count ${count}`);
    assert.strictEqual(browser.__lastStatus().status, "ok", `count ${count}`);
  }
});

test("multiple configured accounts are summed and named in the tooltip", async () => {
  const { browser, bg } = loadBackground({
    origins: [GMAIL_ORIGIN],
    storage: { accounts: "0,1" },
    feeds: { "/u/0/": 5, "/u/1/": 9 }
  });
  await settle(bg);

  assert.strictEqual(browser.__lastBadgeText(), "14");
  assert.match(browser.__lastTitle(), /Account 0: 5 unread/);
  assert.match(browser.__lastTitle(), /Account 1: 9 unread/);
});

test("authentication, HTTP, network and parse failures remain user-safe", async (t) => {
  const cases = [
    ["authentication", () => atomResponse(0, { status: 401 }), "auth", /not signed in/i],
    ["HTTP", () => atomResponse(0, { status: 503 }), "error", /couldn't reach Gmail/i],
    ["network", () => { throw new TypeError("offline"); }, "error", /couldn't reach Gmail/i],
    ["parse", () => new Response("<feed></feed>", {
      status: 200, headers: { "content-type": "application/atom+xml" }
    }), "error", /couldn't reach Gmail/i]
  ];

  for (const [name, feed, expectedStatus, expectedTitle] of cases) {
    await t.test(name, async () => {
      const { browser, bg } = loadBackground({
        origins: [GMAIL_ORIGIN], feeds: { "/u/0/": feed }
      });
      await settle(bg);
      assert.strictEqual(browser.__lastBadgeText(), "?");
      assert.strictEqual(browser.__lastStatus().status, expectedStatus);
      assert.match(browser.__lastTitle(), expectedTitle);
    });
  }
});

test("the feed request is credentialed, uncached and limited to Gmail", async () => {
  const { browser, bg } = loadBackground({
    origins: [GMAIL_ORIGIN],
    storage: { accounts: "2", label: "Team / urgent" },
    feeds: { "/u/2/": 4 }
  });
  await settle(bg);

  const requests = browser.__entries("fetch");
  assert.strictEqual(requests.length, 1);
  assert.strictEqual(
    requests[0].url,
    "https://mail.google.com/mail/u/2/feed/atom/Team%20%2F%20urgent"
  );
  assert.strictEqual(requests[0].init.credentials, "include");
  assert.strictEqual(requests[0].init.cache, "no-store");
  assert.strictEqual(requests[0].init.redirect, "follow");
  assert.deepStrictEqual(requests[0].init.headers, {
    "Cache-Control": "no-cache", "Pragma": "no-cache"
  });
});

test("startup reschedules the alarm and replaces a stale count with an error", async () => {
  let offline = false;
  const { browser, bg } = loadBackground({
    origins: [GMAIL_ORIGIN],
    fetch: async () => {
      if (offline) throw new TypeError("offline");
      return atomResponse(12);
    }
  });
  await settle(bg);
  assert.strictEqual(browser.__lastBadgeText(), "12");

  offline = true;
  const mark = browser.__log.length;
  browser.__startup();
  await settle(bg);

  assert.strictEqual(browser.__lastBadgeText(mark), "?");
  assert.strictEqual(browser.__lastStatus(mark).status, "error");
  assert.strictEqual(browser.__entries("alarms.clear", mark).length, 1);
  assert.strictEqual(
    browser.__log.slice(mark).filter((entry) => entry.label === "alarms.create").length,
    1
  );
});

test("an unrelated alarm never contacts Gmail", async () => {
  const { browser, bg } = loadBackground({
    origins: [GMAIL_ORIGIN], feeds: { "/u/0/": 7 }
  });
  await settle(bg);

  const mark = browser.__log.length;
  browser.__alarm("another-extension-alarm");
  await settle(bg);
  assert.strictEqual(browser.__entries("fetch", mark).length, 0);
});
