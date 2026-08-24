"use strict";

/**
 * A mock of the slice of the WebExtension API that background.js uses.
 *
 * Two things make the background testable at all:
 *
 *   1. Every external mutation is appended to an ordered log *before* it takes
 *      effect, so a test can assert on what was issued and in what order —
 *      not merely on the state left behind.
 *   2. Any mutation can be held mid-flight with `hold(label)`, which is what
 *      lets a test invalidate a generation at a chosen point: while a commit
 *      is queued, or after its first write has already gone out.
 *
 * Not a Firefox emulator. It models only the behaviours the tests depend on,
 * including the one that matters for `optional_host_permissions`: tab URLs are
 * invisible until the Gmail origin is granted.
 */

const GMAIL_ORIGIN = "https://mail.google.com/*";

/** An Atom feed response whose body is a real ReadableStream. */
function atomResponse(count, opts) {
  const o = opts || {};
  const body =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<feed xmlns="http://purl.org/atom/ns#"><title>Gmail - Inbox</title>` +
    `<fullcount>${count}</fullcount>` +
    `<entry><title>Invoice</title><author><name>Dana Levi</name>` +
    `<email>dana.levi@example.com</email></author></entry></feed>`;
  const stream = new ReadableStream({
    start(c) {
      c.enqueue(new TextEncoder().encode(body));
      c.close();
    }
  });
  return new Response(stream, {
    status: o.status || 200,
    headers: { "content-type": o.contentType || "application/atom+xml" }
  });
}

function makeBrowser(options) {
  const opts = options || {};

  const log = [];
  const store = { ...(opts.storage || {}) };
  const origins = new Set(opts.origins || []);
  const tabs = (opts.tabs || []).map((t, i) => ({ id: i + 1, windowId: 1, ...t }));
  const alarms = new Map();
  const holds = new Map();

  let grantOnRequest = opts.grantOnRequest !== false;
  let requestRejects = !!opts.requestRejects;
  let requestThrows = !!opts.requestThrows;

  const L = {
    alarm: [], installed: [], startup: [], changed: [],
    message: [], permAdded: [], permRemoved: [], clicked: []
  };
  const channel = (arr) => ({
    addListener: (fn) => { arr.push(fn); },
    removeListener: (fn) => { const i = arr.indexOf(fn); if (i >= 0) arr.splice(i, 1); },
    hasListener: (fn) => arr.includes(fn)
  });

  /* --- ordered log, with optional mid-flight holds --- */

  async function record(label, detail) {
    log.push({ label, ...(detail || {}) });
    const queue = holds.get(label);
    if (queue && queue.length) {
      const h = queue.shift();
      h.announce();
      await h.gate;
    }
  }

  /**
   * Hold the next call carrying `label`. `reached` resolves once the call has
   * been issued and is waiting; `release()` lets it complete.
   */
  function hold(label) {
    let announce;
    let release;
    const reached = new Promise((r) => { announce = r; });
    const gate = new Promise((r) => { release = r; });
    if (!holds.has(label)) holds.set(label, []);
    holds.get(label).push({ announce, gate });
    return { reached, release };
  }

  function emit(listeners, ...args) {
    for (const fn of listeners.slice()) {
      try {
        const r = fn(...args);
        if (r && typeof r.then === "function") r.then(undefined, () => {});
      } catch (_) { /* a listener throwing must not break the emitter */ }
    }
  }

  function emitChanged(changes) {
    if (Object.keys(changes).length === 0) return;
    emit(L.changed, changes, "local");
  }

  /* --- storage --- */

  const storage = {
    local: {
      // Reads are not logged: the log is a record of mutations.
      get(query) {
        if (query == null) return Promise.resolve({ ...store });
        if (typeof query === "string") {
          return Promise.resolve(query in store ? { [query]: store[query] } : {});
        }
        if (Array.isArray(query)) {
          const out = {};
          for (const k of query) if (k in store) out[k] = store[k];
          return Promise.resolve(out);
        }
        const out = {};
        for (const k of Object.keys(query)) {
          out[k] = k in store ? store[k] : query[k];
        }
        return Promise.resolve(out);
      },
      async set(obj) {
        await record("storage.set", { payload: { ...obj }, keys: Object.keys(obj) });
        const changes = {};
        for (const k of Object.keys(obj)) {
          changes[k] = { oldValue: store[k], newValue: obj[k] };
          store[k] = obj[k];
        }
        emitChanged(changes);
      },
      async remove(keys) {
        const list = Array.isArray(keys) ? keys : [keys];
        await record("storage.remove", { keys: list.slice() });
        const changes = {};
        for (const k of list) {
          if (k in store) { changes[k] = { oldValue: store[k] }; delete store[k]; }
        }
        emitChanged(changes);
      }
    },
    onChanged: channel(L.changed)
  };

  /* --- permissions --- */

  const permissions = {
    contains(req) {
      const want = (req && req.origins) || [];
      return Promise.resolve(want.every((o) => origins.has(o)));
    },
    async request(req) {
      // Logged synchronously on call, so a test can assert the request was
      // issued during the click gesture rather than after an await.
      await record("permissions.request", {
        origins: (req && req.origins) || [],
        data_collection: (req && req.data_collection) || []
      });
      if (requestThrows) throw new Error("permissions.request may only be called from a user gesture");
      if (requestRejects) return false;          // denial or dismissal
      if (!grantOnRequest) return false;
      const added = ((req && req.origins) || []).filter((o) => !origins.has(o));
      for (const o of (req && req.origins) || []) origins.add(o);
      if (added.length) emit(L.permAdded, { origins: added, permissions: [] });
      return true;
    },
    getAll() {
      return Promise.resolve({
        origins: Array.from(origins), permissions: [], data_collection: []
      });
    },
    onAdded: channel(L.permAdded),
    onRemoved: channel(L.permRemoved)
  };

  /* --- action --- */

  const action = {
    setBadgeText: (d) => record("action.setBadgeText", { text: d.text }),
    setBadgeBackgroundColor: (d) => record("action.setBadgeBackgroundColor", { color: d.color }),
    setBadgeTextColor: (d) => record("action.setBadgeTextColor", { color: d.color }),
    setTitle: (d) => record("action.setTitle", { title: d.title }),
    onClicked: channel(L.clicked)
  };
  if (opts.noBadgeTextColor) delete action.setBadgeTextColor;

  /* --- tabs and windows --- */

  const tabsApi = {
    query() {
      const granted = origins.has(GMAIL_ORIGIN);
      return Promise.resolve(tabs.map((t) =>
        granted ? { ...t } : { id: t.id, windowId: t.windowId }));
    },
    async update(id, props) {
      await record("tabs.update", { id, props });
      return { id };
    },
    async create(props) {
      await record("tabs.create", { url: props.url });
      return { id: 1000 + tabs.length };
    }
  };

  const windowsApi = {
    update: (id, props) => record("windows.update", { id, props })
  };

  /* --- alarms and runtime --- */

  const alarmsApi = {
    async clear(name) {
      await record("alarms.clear", { name });
      return alarms.delete(name);
    },
    create(name, info) {
      log.push({ label: "alarms.create", name, info });
      alarms.set(name, info);
    },
    onAlarm: channel(L.alarm)
  };

  const runtime = {
    onInstalled: channel(L.installed),
    onStartup: channel(L.startup),
    onMessage: channel(L.message),
    async sendMessage(msg) {
      for (const fn of L.message.slice()) {
        const r = fn(msg);
        if (r !== undefined) return await r;
      }
      return undefined;
    }
  };

  /* --- fetch --- */

  const routes = opts.feeds || {};
  const fetchImpl = opts.fetch || (async (url) => {
    for (const key of Object.keys(routes)) {
      if (url.includes(key)) {
        const r = routes[key];
        if (typeof r === "function") return await r(url);
        if (r instanceof Error) throw r;
        return atomResponse(r);
      }
    }
    throw new TypeError("NetworkError when attempting to fetch resource.");
  });

  async function fetchStub(url, init) {
    log.push({ label: "fetch", url, init: init || {} });
    return await fetchImpl(url, init);
  }

  return {
    storage, permissions, action, alarms: alarmsApi, runtime,
    tabs: tabsApi, windows: windowsApi,

    /* ---- test surface ---- */
    __log: log,
    __store: store,
    __fetch: fetchStub,
    __hold: hold,
    __listeners: L,
    __origins: origins,
    __setGrant(v) { grantOnRequest = v; },
    __setRequestRejects(v) { requestRejects = v; },
    __setRequestThrows(v) { requestThrows = v; },

    /** Fire the toolbar click, returning whatever the listener returned. */
    __click() {
      const results = L.clicked.slice().map((fn) => fn());
      return Promise.all(results.map((r) => Promise.resolve(r).catch(() => {})));
    },
    __revoke(list) {
      const removed = (list || [GMAIL_ORIGIN]).filter((o) => origins.has(o));
      for (const o of removed) origins.delete(o);
      emit(L.permRemoved, { origins: removed, permissions: [] });
    },
    __grant(list) {
      const added = (list || [GMAIL_ORIGIN]).filter((o) => !origins.has(o));
      for (const o of added) origins.add(o);
      emit(L.permAdded, { origins: added, permissions: [] });
    },
    /** Emit storage.onChanged synchronously, bypassing the write path. */
    __changed(changes, area) { emit(L.changed, changes, area || "local"); },
    __installed() { emit(L.installed, { reason: "install" }); },
    __startup() { emit(L.startup); },
    __alarm(name) { emit(L.alarm, { name: name || "gmail-check" }); },

    /* ---- log readers ---- */
    __entries(label, from) {
      return log.slice(from || 0).filter((e) => e.label === label);
    },
    __lastBadgeText(from) {
      const e = this.__entries("action.setBadgeText", from);
      return e.length ? e[e.length - 1].text : undefined;
    },
    __lastTitle(from) {
      const e = this.__entries("action.setTitle", from);
      return e.length ? e[e.length - 1].title : undefined;
    },
    __statusWrites(from) {
      return this.__entries("storage.set", from).filter((e) => "status" in e.payload);
    },
    __lastStatus(from) {
      const w = this.__statusWrites(from);
      return w.length ? w[w.length - 1].payload : undefined;
    }
  };
}

/**
 * Load a fresh copy of background.js against a fresh mock. The module cache is
 * busted so each test gets its own generation counter, mutation queue and
 * listener registrations.
 */
function loadBackground(options) {
  const browser = makeBrowser(options);
  globalThis.browser = browser;
  delete globalThis.chrome;
  globalThis.UBG = require("../parser.js");
  globalThis.fetch = browser.__fetch;

  const path = require.resolve("../background.js");
  delete require.cache[path];
  const bg = require(path);
  return { browser, bg };
}

/** Run the microtask/macrotask queue until the background stops working. */
async function settle(bg, rounds) {
  const n = rounds || 40;
  for (let i = 0; i < n; i++) {
    await bg.mutationsSettled();
    await new Promise((r) => setImmediate(r));
  }
  await bg.mutationsSettled();
}

module.exports = { makeBrowser, loadBackground, settle, atomResponse, GMAIL_ORIGIN };
