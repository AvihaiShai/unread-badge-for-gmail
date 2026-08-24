"use strict";

const test = require("node:test");
const assert = require("node:assert");
const { createFullCountScanner, findCloseTagEnd, extractFullCount } = require("../parser.js");

const enc = new TextEncoder();
const bytes = (s) => enc.encode(s);

/**
 * A TextDecoder that records every byte it is asked to decode, so a test can
 * assert on the decoder's *input* rather than on what the scanner retained
 * afterwards. Erasing a string after building it is not the same as never
 * building it.
 */
function spyDecoder() {
  const real = new TextDecoder("utf-8");
  const seen = [];
  return {
    calls: 0,
    get total() { return seen.reduce((n, b) => n + b.length, 0); },
    get text() { return seen.map((b) => real.decode(b)).join(""); },
    decode(input, options) {
      this.calls++;
      seen.push(Uint8Array.from(input));
      return real.decode(input, options);
    }
  };
}

/** Feed a list of string chunks and return the scanner. */
function scan(chunks, options) {
  const s = createFullCountScanner(options);
  for (const c of chunks) {
    if (s.push(bytes(c)) !== "continue") return s;
  }
  s.end();
  return s;
}

const ENTRY = `<entry>
  <title>Quarterly invoice</title>
  <summary>Please find attached the invoice for</summary>
  <author><name>Dana Levi</name><email>dana.levi@example.com</email></author>
  <id>tag:gmail.google.com,2004:1234567890</id>
</entry>`;

const FEED = (n, tail) =>
  `<?xml version="1.0" encoding="UTF-8"?>` +
  `<feed xmlns="http://purl.org/atom/ns#"><title>Gmail - Inbox</title>` +
  `<fullcount>${n}</fullcount>` + (tail || "");

/* ---------------------------------------------------------------- */
/* basic extraction                                                   */
/* ---------------------------------------------------------------- */

test("reads the count from a namespaced Atom document", () => {
  const s = scan([FEED(7)]);
  assert.strictEqual(s.state, "found");
  assert.strictEqual(s.count, 7);
});

test("zero unread is a count, not a missing value", () => {
  assert.strictEqual(scan([FEED(0)]).count, 0);
});

test("missing fullcount yields null", () => {
  const s = scan([`<feed xmlns="http://purl.org/atom/ns#"><title>Gmail</title></feed>`]);
  assert.strictEqual(s.count, null);
  assert.strictEqual(s.state, "end");
});

test("an HTML sign-in page yields null", () => {
  const s = scan(["<!DOCTYPE html><html><body><form action=\"/signin\"></form></body></html>"]);
  assert.strictEqual(s.count, null);
});

test("an empty body yields null", () => {
  assert.strictEqual(scan([]).count, null);
});

test("attributes and whitespace inside the element still match", () => {
  assert.strictEqual(scan([`<fullcount xml:lang="en"> 42 </fullcount>`]).count, 42);
});

test("a closing tag with whitespace before the bracket still matches", () => {
  assert.strictEqual(scan(["<fullcount>6</fullcount   >"]).count, 6);
});

test("a prefixed serialization still matches", () => {
  assert.strictEqual(scan([`<gm:fullcount>3</gm:fullcount>`]).count, 3);
});

test("a similarly named element does not match", () => {
  assert.strictEqual(scan(["<fullcounted>9</fullcounted>"]).count, null);
});

test("an unrelated closing tag before the count does not stop the scan", () => {
  assert.strictEqual(scan(["<title>Gmail</title><fullcount>5</fullcount>"]).count, 5);
});

/* ---------------------------------------------------------------- */
/* byte-level tag detection                                           */
/* ---------------------------------------------------------------- */

test("findCloseTagEnd works on raw bytes and returns the index past '>'", () => {
  const b = bytes("<fullcount>7</fullcount>REST");
  const end = findCloseTagEnd(b);
  assert.strictEqual(end, "<fullcount>7</fullcount>".length);
  assert.strictEqual(findCloseTagEnd(bytes("<entry><title>x</title>")), -1);
});

test("findCloseTagEnd is case-insensitive and prefix-tolerant", () => {
  assert.ok(findCloseTagEnd(bytes("</FullCount>")) > 0);
  assert.ok(findCloseTagEnd(bytes("</gm:fullcount>")) > 0);
  assert.strictEqual(findCloseTagEnd(bytes("</fullcountx>")), -1);
});

/* ---------------------------------------------------------------- */
/* chunk boundaries                                                   */
/* ---------------------------------------------------------------- */

test("an element split across two chunks is still matched", () => {
  assert.strictEqual(scan(["<feed><fullc", "ount>12</fullcount><entry>"]).count, 12);
});

test("an element split mid-digit is still matched", () => {
  assert.strictEqual(scan(["<fullcount>1", "23</fullcount>"]).count, 123);
});

test("a closing tag split across chunks is still matched", () => {
  assert.strictEqual(scan(["<fullcount>4</full", "count>"]).count, 4);
});

test("a multi-byte character split across chunks does not corrupt the scan", () => {
  const raw = bytes(`<title>Gmail — Inbox</title><fullcount>5</fullcount>`);
  const cut = 12;                       // lands inside the em dash sequence
  const s = createFullCountScanner();
  s.push(raw.subarray(0, cut));
  s.push(raw.subarray(cut));
  assert.strictEqual(s.count, 5);
});

/* ---------------------------------------------------------------- */
/* finding: bytes after </fullcount> never reach the decoder          */
/* ---------------------------------------------------------------- */

test("a chunk carrying the count and a whole entry decodes only up to the tag", () => {
  const decoder = spyDecoder();
  const s = createFullCountScanner({ decoder });
  const payload = FEED(7, ENTRY + "</feed>");
  const state = s.push(bytes(payload));

  assert.strictEqual(state, "found");
  assert.strictEqual(s.count, 7);

  // The decoder saw only the region ending at </fullcount>.
  const upToTag = payload.indexOf("</fullcount>") + "</fullcount>".length;
  assert.strictEqual(s.decodedBytes, upToTag);
  assert.strictEqual(decoder.total, upToTag);
  assert.ok(!decoder.text.includes("Dana Levi"));
  assert.ok(!decoder.text.includes("dana.levi@example.com"));
  assert.ok(!decoder.text.includes("Quarterly invoice"));
  assert.strictEqual(s.retainedBytes, 0);
});

test("a 40 KB chunk decodes only a few hundred bytes", () => {
  const decoder = spyDecoder();
  const s = createFullCountScanner({ decoder });
  const filler = ENTRY.repeat(Math.ceil(40000 / ENTRY.length));
  s.push(bytes(FEED(9, filler)));

  assert.strictEqual(s.count, 9);
  assert.ok(decoder.total <= 512, `decoder saw ${decoder.total} bytes`);
  assert.ok(!decoder.text.includes("Dana Levi"));
});

test("a stream with no count never invokes the decoder at all", () => {
  const decoder = spyDecoder();
  const s = createFullCountScanner({ decoder });
  s.push(bytes("<feed><title>Gmail</title>"));
  s.push(bytes("<subtitle>none</subtitle>"));
  s.end();

  assert.strictEqual(s.count, null);
  assert.strictEqual(s.decodedBytes, 0);
  assert.strictEqual(decoder.calls, 0);
});

test("entries preceding the count are not decoded and not accumulated", () => {
  const decoder = spyDecoder();
  const s = createFullCountScanner({ decoder, windowBytes: 128 });
  for (let i = 0; i < 40; i++) s.push(bytes(ENTRY));

  assert.ok(s.retainedBytes <= 128, `retained ${s.retainedBytes} bytes`);
  assert.ok(!decoder.text.includes("Dana Levi"));

  assert.strictEqual(s.push(bytes("<fullcount>4</fullcount>")), "found");
  assert.strictEqual(s.count, 4);
  assert.strictEqual(s.retainedBytes, 0);
  assert.ok(decoder.total <= 128 + 24);
});

test("scanning is inert after the count is found", () => {
  const decoder = spyDecoder();
  const s = createFullCountScanner({ decoder });
  s.push(bytes(FEED(7)));
  const readBefore = s.bytesRead;
  const decodedBefore = s.decodedBytes;

  assert.strictEqual(s.push(bytes(ENTRY)), "found");
  assert.strictEqual(s.bytesRead, readBefore);      // no further bytes accepted
  assert.strictEqual(s.decodedBytes, decodedBefore); // and none decoded
  assert.strictEqual(s.count, 7);
});

/* ---------------------------------------------------------------- */
/* the byte cap is a hard limit                                       */
/* ---------------------------------------------------------------- */

test("a single oversized chunk is truncated at the cap", () => {
  const s = createFullCountScanner({ maxBytes: 1024 });
  const state = s.push(bytes("x".repeat(50000)));
  assert.strictEqual(state, "limit");
  assert.strictEqual(s.bytesRead, 1024);     // not 50000
  assert.ok(s.truncated);
  assert.strictEqual(s.count, null);
  assert.strictEqual(s.retainedBytes, 0);
});

test("a count beyond the cap is not returned", () => {
  const s = createFullCountScanner({ maxBytes: 512 });
  s.push(bytes("x".repeat(600) + "<fullcount>9</fullcount>"));
  assert.strictEqual(s.count, null);
  assert.ok(s.truncated);
  assert.strictEqual(s.bytesRead, 512);
});

test("a count that ends exactly at the cap is returned", () => {
  const tag = "<fullcount>8</fullcount>";
  const pad = "x".repeat(100);
  const s = createFullCountScanner({ maxBytes: pad.length + tag.length });
  s.push(bytes(pad + tag));
  assert.strictEqual(s.count, 8);
});

test("the cap holds across many chunks", () => {
  const s = createFullCountScanner({ maxBytes: 1000 });
  for (let i = 0; i < 10; i++) s.push(bytes("y".repeat(300)));
  assert.strictEqual(s.bytesRead, 1000);
  assert.strictEqual(s.state, "limit");
});

/* ---------------------------------------------------------------- */
/* single-shot helper                                                 */
/* ---------------------------------------------------------------- */

test("extractFullCount agrees with the scanner", () => {
  assert.strictEqual(extractFullCount(FEED(7, ENTRY)), 7);
  assert.strictEqual(extractFullCount("<feed></feed>"), null);
  assert.strictEqual(extractFullCount(""), null);
});
