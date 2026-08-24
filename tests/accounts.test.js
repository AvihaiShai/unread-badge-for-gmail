"use strict";

const test = require("node:test");
const assert = require("node:assert");
const { normalizeAccounts, configKey } = require("../parser.js");

const norm = (raw) => normalizeAccounts(raw, { maxAccounts: 5, maxIndex: 99 });

/* ---------------------------------------------------------------- */
/* finding 5: duplicates                                              */
/* ---------------------------------------------------------------- */

test("0,0 collapses to a single mailbox", () => {
  assert.deepStrictEqual(norm("0,0"), ["0"]);
});

test("0,00 collapses to a single mailbox", () => {
  assert.deepStrictEqual(norm("0,00"), ["0"]);
});

test("1,1 collapses to a single mailbox", () => {
  assert.deepStrictEqual(norm("1,1"), ["1"]);
});

test("leading zeros normalize to their numeric form", () => {
  assert.deepStrictEqual(norm("00,01,002"), ["0", "1", "2"]);
});

test("duplicates are dropped while first-occurrence order is kept", () => {
  assert.deepStrictEqual(norm("2,0,2,1,0"), ["2", "0", "1"]);
});

test("corrupted storage with repeated values is de-duplicated defensively", () => {
  assert.deepStrictEqual(norm(" 3 , 03 ,3,  3 "), ["3"]);
});

test("de-duplication happens before the five-account cap", () => {
  // Seven entries, four distinct mailboxes.
  assert.deepStrictEqual(norm("0,0,1,1,2,2,3"), ["0", "1", "2", "3"]);
});

test("more than five distinct accounts are capped at five", () => {
  assert.deepStrictEqual(norm("0,1,2,3,4,5,6"), ["0", "1", "2", "3", "4"]);
});

/* ---------------------------------------------------------------- */
/* other malformed input                                              */
/* ---------------------------------------------------------------- */

test("out-of-range and non-numeric entries are discarded", () => {
  assert.deepStrictEqual(norm("0,100,abc,-1,2"), ["0", "2"]);
});

test("empty and nullish input yields an empty list for the caller to default", () => {
  assert.deepStrictEqual(norm(""), []);
  assert.deepStrictEqual(norm(null), []);
  assert.deepStrictEqual(norm(undefined), []);
});

test("an array is accepted as well as a comma string", () => {
  assert.deepStrictEqual(norm(["0", "0", "1"]), ["0", "1"]);
});

/* ---------------------------------------------------------------- */
/* finding 5: the resulting configuration key                         */
/* ---------------------------------------------------------------- */

test("a duplicated list produces the same config key as its de-duplicated form", () => {
  assert.strictEqual(configKey(norm("0,0"), ""), configKey(norm("0"), ""));
  assert.strictEqual(configKey(norm("0,00"), ""), configKey(norm("0"), ""));
});

test("a cached total from 0,0 cannot be reused for 0,1", () => {
  assert.notStrictEqual(configKey(norm("0,0"), ""), configKey(norm("0,1"), ""));
});

test("order and label still distinguish keys", () => {
  assert.notStrictEqual(configKey(norm("0,1"), ""), configKey(norm("1,0"), ""));
  assert.notStrictEqual(configKey(norm("0"), "work"), configKey(norm("0"), ""));
});
