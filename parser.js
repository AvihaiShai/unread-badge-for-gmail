"use strict";

/**
 * Feed scanning and settings normalization, isolated so both can be unit
 * tested outside the browser. Loaded as the first background script; shares
 * global scope with background.js.
 *
 * Design note (pass 4): pass 3 still decoded every delivered byte before
 * looking for the count, so an <entry> sharing a chunk with <fullcount> was
 * turned into a JavaScript string even though it was discarded immediately
 * afterwards. This version locates the closing </fullcount> tag by comparing
 * raw bytes, and passes only bytes at or before that tag to the text decoder.
 * Bytes after the closing tag are never decoded, and the decoder never
 * receives more than `windowBytes` in total.
 */
(function (root) {
  const NAME = "(?:[A-Za-z_][\\w.\\-]*:)?fullcount";
  const FULLCOUNT_RE = new RegExp(
    `<${NAME}(?:\\s[^>]*)?>\\s*(\\d+)\\s*<\\/${NAME}\\s*>`,
    "i"
  );

  // Longest plausible <fullcount>…</fullcount> serialization, with room for a
  // prefix, attributes and whitespace. Raw bytes are carried across chunk
  // boundaries up to this much so a split element still matches; it is also
  // the ceiling on how much text the decoder is ever given.
  const WINDOW_BYTES = 512;

  const DEFAULT_MAX_BYTES = 65536;

  const LT = 0x3c;        // <
  const SLASH = 0x2f;     // /
  const GT = 0x3e;        // >
  const COLON = 0x3a;     // :

  const CLOSE_NAME = [0x66, 0x75, 0x6c, 0x6c, 0x63, 0x6f, 0x75, 0x6e, 0x74]; // "fullcount"

  const isSpace = (b) => b === 0x20 || b === 0x09 || b === 0x0a || b === 0x0d;
  const lower = (b) => (b >= 0x41 && b <= 0x5a ? b + 0x20 : b);
  const isNameByte = (b) =>
    (b >= 0x61 && b <= 0x7a) || (b >= 0x41 && b <= 0x5a) ||
    (b >= 0x30 && b <= 0x39) || b === 0x5f || b === 0x2d || b === 0x2e;

  /** Does buf hold "fullcount" at pos, case-insensitively? Bytes only. */
  function matchesName(buf, pos) {
    if (pos + CLOSE_NAME.length > buf.length) return false;
    for (let k = 0; k < CLOSE_NAME.length; k++) {
      if (lower(buf[pos + k]) !== CLOSE_NAME[k]) return false;
    }
    return true;
  }

  /**
   * Index just past the '>' of a closing </fullcount> tag, or -1.
   *
   * Pure byte comparison: no string is constructed, so content that merely
   * happens to sit near a closing tag is never brought into memory as text.
   */
  function findCloseTagEnd(buf) {
    for (let i = 0; i + 3 < buf.length; i++) {
      if (buf[i] !== LT || buf[i + 1] !== SLASH) continue;

      let j = i + 2;
      // Optional namespace prefix: name bytes followed by ':'.
      let k = j;
      while (k < buf.length && isNameByte(buf[k])) k++;
      if (k < buf.length && buf[k] === COLON && k > j) j = k + 1;

      if (!matchesName(buf, j)) continue;
      j += CLOSE_NAME.length;

      while (j < buf.length && isSpace(buf[j])) j++;
      if (j < buf.length && buf[j] === GT) return j + 1;
    }
    return -1;
  }

  function concatBytes(a, b) {
    if (a.length === 0) return b;
    if (b.length === 0) return a;
    const out = new Uint8Array(a.length + b.length);
    out.set(a, 0);
    out.set(b, a.length);
    return out;
  }

  /**
   * Incremental scanner over response bytes.
   *
   * push(chunk) returns:
   *   "continue" — no count yet, keep reading
   *   "found"    — count available on .count; stop reading
   *   "limit"    — byte cap reached without a count; stop reading
   *
   * The byte cap is a hard limit on bytes *accepted*, not on bytes delivered:
   * a chunk that crosses the cap is truncated to the remaining allowance
   * before anything is done with it.
   *
   * `decoder` is injectable so tests can observe exactly which bytes reach the
   * text decoder.
   */
  function createFullCountScanner(options) {
    const opts = options || {};
    const maxBytes = Number.isInteger(opts.maxBytes) ? opts.maxBytes : DEFAULT_MAX_BYTES;
    const windowBytes = Number.isInteger(opts.windowBytes) ? opts.windowBytes : WINDOW_BYTES;
    const decoder = opts.decoder || new TextDecoder("utf-8");

    let pending = new Uint8Array(0);
    let bytes = 0;
    let decodedBytes = 0;
    let count = null;
    let state = "continue";
    let truncated = false;

    function settle(next) {
      state = next;
      pending = new Uint8Array(0);   // drop everything still held
      return state;
    }

    /**
     * Decode at most windowBytes ending at `end`, and try to read a count.
     * The element is far shorter than the window, so a longer prefix cannot
     * hold a match this would miss.
     */
    function readCountBefore(buf, end) {
      const start = Math.max(0, end - windowBytes);
      const slice = buf.subarray(start, end);
      decodedBytes += slice.length;
      const text = decoder.decode(slice);
      const m = text.match(FULLCOUNT_RE);
      if (!m) return false;
      const n = parseInt(m[1], 10);
      if (!Number.isInteger(n) || n < 0) return false;
      count = n;
      return true;
    }

    return {
      get count() { return count; },
      get state() { return state; },
      get truncated() { return truncated; },
      get bytesRead() { return bytes; },
      /** Bytes handed to the text decoder. Never includes anything past </fullcount>. */
      get decodedBytes() { return decodedBytes; },
      /** Exposed for tests: raw bytes still held between chunks. */
      get retainedBytes() { return pending.length; },

      push(chunk) {
        if (state !== "continue") return state;

        const remaining = maxBytes - bytes;
        let take = chunk;
        if (chunk.byteLength >= remaining) {
          take = chunk.subarray(0, remaining);
          truncated = true;
        }
        bytes += take.byteLength;

        const buf = concatBytes(pending, take);

        // A closing tag may appear more than once (some other element's tag
        // before the real one); keep looking past a slice that yields no count.
        let searchFrom = 0;
        for (;;) {
          const view = searchFrom === 0 ? buf : buf.subarray(searchFrom);
          const rel = findCloseTagEnd(view);
          if (rel < 0) break;
          const end = searchFrom + rel;
          if (readCountBefore(buf, end)) return settle("found");
          searchFrom = end;
        }

        if (truncated) return settle("limit");

        pending = buf.length > windowBytes
          ? buf.slice(buf.length - windowBytes)
          : buf;
        return "continue";
      },

      /**
       * Stream ended. Nothing more can match: a count needs a complete closing
       * tag, and every closing tag seen has already been tested. Nothing
       * further is decoded.
       */
      end() {
        if (state !== "continue") return state;
        return settle("end");
      }
    };
  }

  /**
   * Drive a scanner over a ReadableStream and stop at the first of: the count,
   * the byte cap, or end of stream. The reader is always cancelled, which is
   * what tells the browser to stop requesting further chunks.
   *
   * Lives here rather than in background.js so the stopping behaviour is
   * testable outside Firefox.
   */
  async function readCountFromStream(stream, options) {
    const reader = stream.getReader();
    const scanner = createFullCountScanner(options);
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) { scanner.end(); break; }
        if (scanner.push(value) !== "continue") break;
      }
    } finally {
      try { await reader.cancel(); } catch (_) { /* already closed or errored */ }
    }
    return {
      count: scanner.count,
      truncated: scanner.truncated,
      bytesRead: scanner.bytesRead,
      decodedBytes: scanner.decodedBytes,
      state: scanner.state
    };
  }

  /** Single-shot extraction over text already in hand. Used by tests only. */
  function extractFullCount(text) {
    const m = String(text).match(FULLCOUNT_RE);
    if (!m) return null;
    const n = parseInt(m[1], 10);
    return Number.isInteger(n) && n >= 0 ? n : null;
  }

  /**
   * Normalize an account list numerically.
   *
   * "0,00" and "1,1" name the same mailbox twice; summing them produced a
   * false unread total. Indices are compared as numbers, duplicates are
   * dropped, and the first occurrence keeps its position.
   */
  function normalizeAccounts(raw, options) {
    const opts = options || {};
    const maxAccounts = Number.isInteger(opts.maxAccounts) ? opts.maxAccounts : 5;
    const maxIndex = Number.isInteger(opts.maxIndex) ? opts.maxIndex : 99;

    const parts = Array.isArray(raw) ? raw : String(raw == null ? "" : raw).split(",");
    const seen = new Set();
    const out = [];
    for (const part of parts) {
      const t = String(part).trim();
      if (!/^\d{1,3}$/.test(t)) continue;
      const n = Number(t);
      if (!Number.isInteger(n) || n < 0 || n > maxIndex) continue;
      if (seen.has(n)) continue;
      seen.add(n);
      out.push(String(n));            // "00" and "0" collapse to "0"
      if (out.length >= maxAccounts) break;
    }
    return out;
  }

  /** Stable key so a cached total is never reused across a config change. */
  function configKey(accounts, label) {
    return `${(accounts || []).join(",")}|${label || ""}`;
  }

  root.UBG = Object.assign(root.UBG || {}, {
    FULLCOUNT_RE,
    WINDOW_BYTES,
    findCloseTagEnd,
    createFullCountScanner,
    readCountFromStream,
    extractFullCount,
    normalizeAccounts,
    configKey
  });
})(globalThis);

if (typeof module === "object" && module.exports) module.exports = globalThis.UBG;
