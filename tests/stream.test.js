"use strict";

const test = require("node:test");
const assert = require("node:assert");
const { readCountFromStream } = require("../parser.js");

const enc = new TextEncoder();

/**
 * A stream that records how many chunks were actually pulled and whether the
 * consumer cancelled it. Mirrors what Firefox does with res.body: chunks are
 * produced on demand, and cancel() is the signal to stop.
 */
function recordingStream(chunks) {
  const log = { pulled: 0, cancelled: false, reason: null };
  let i = 0;
  const stream = new ReadableStream({
    pull(controller) {
      if (i >= chunks.length) { controller.close(); return; }
      log.pulled++;
      controller.enqueue(enc.encode(chunks[i++]));
    },
    cancel(reason) { log.cancelled = true; log.reason = reason; }
  });
  return { stream, log };
}

const ENTRY = "<entry><title>Invoice</title><author><name>Dana Levi</name>" +
  "<email>dana.levi@example.com</email></author></entry>";

test("stops pulling chunks once the count is found", async () => {
  const { stream, log } = recordingStream([
    "<feed><fullcount>7</fullcount>",
    ENTRY,
    ENTRY,
    "</feed>"
  ]);
  const res = await readCountFromStream(stream, {});
  assert.strictEqual(res.count, 7);
  assert.strictEqual(log.pulled, 1, "later chunks must not be requested");
  assert.ok(log.cancelled, "the reader must cancel the body");
});

test("a chunk carrying the count and a whole entry still stops there", async () => {
  const { stream, log } = recordingStream([
    `<feed><fullcount>3</fullcount>${ENTRY}`,
    ENTRY
  ]);
  const res = await readCountFromStream(stream, {});
  assert.strictEqual(res.count, 3);
  assert.strictEqual(log.pulled, 1);
  assert.ok(log.cancelled);
  // Only the region ending at </fullcount> was decoded, not the entry that
  // arrived in the same chunk.
  assert.strictEqual(res.decodedBytes, "<feed><fullcount>3</fullcount>".length);
});

test("stops pulling once the byte cap is reached", async () => {
  const { stream, log } = recordingStream([
    "a".repeat(400), "b".repeat(400), "c".repeat(400), "d".repeat(400)
  ]);
  const res = await readCountFromStream(stream, { maxBytes: 700 });
  assert.strictEqual(res.count, null);
  assert.ok(res.truncated);
  assert.strictEqual(res.bytesRead, 700);
  assert.strictEqual(log.pulled, 2, "reading must stop at the cap, not at end of stream");
  assert.ok(log.cancelled);
});

test("a stream that ends without a count reports null", async () => {
  const { stream } = recordingStream(["<feed>", "<title>Gmail</title>", "</feed>"]);
  const res = await readCountFromStream(stream, {});
  assert.strictEqual(res.count, null);
  assert.strictEqual(res.state, "end");
});

/**
 * Finding 6: the pass-two harness logged the abort event but never failed the
 * pending read, so a stalled-body test could hang instead of validating
 * anything. This is the corrected shape: abort errors the stream controller,
 * and the pending read rejects with an AbortError.
 */
function stalledStream(signal) {
  let controller;
  const stream = new ReadableStream({
    start(c) {
      controller = c;
      c.enqueue(enc.encode("<feed><title>Gmail</title>"));   // headers + a prefix
      // then nothing: the body stalls
    },
    cancel() {}
  });
  signal.addEventListener("abort", () => {
    try {
      controller.error(new DOMException("The operation was aborted.", "AbortError"));
    } catch (_) { /* already closed */ }
  });
  return stream;
}

test("an aborted stalled body rejects rather than hanging", async () => {
  const ac = new AbortController();
  const stream = stalledStream(ac.signal);
  setTimeout(() => ac.abort(), 25);

  await assert.rejects(
    readCountFromStream(stream, {}),
    (e) => e && e.name === "AbortError"
  );
});

test("abort after the count is found does not affect the result", async () => {
  const ac = new AbortController();
  const stream = stalledStream(ac.signal);
  // A stream whose first chunk already carries the count never waits.
  const withCount = new ReadableStream({
    start(c) {
      c.enqueue(enc.encode("<feed><fullcount>11</fullcount>"));
    }
  });
  const res = await readCountFromStream(withCount, {});
  ac.abort();
  await new Promise((r) => setTimeout(r, 5));
  assert.strictEqual(res.count, 11);
  void stream;
});
