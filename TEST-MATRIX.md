# Test matrix — Unread Badge for Gmail™ 1.0.1

Two kinds of evidence, kept separate. Automated results are reproducible on
any machine; manual results are claims about what a person observed and are
marked as such.

## A. Automated (reproducible)

```sh
node --test tests/*.test.js
```

| File | Tests | Covers |
| --- | --- | --- |
| `tests/scanner.test.js` | 26 | count extraction, byte-level tag detection, chunk boundaries, decoder input, 64 KB cap |
| `tests/stream.test.js` | 6 | stopping behaviour over a real `ReadableStream`, cancellation, aborted stalled body |
| `tests/accounts.test.js` | 14 | numeric normalization, duplicate rejection, config keys |
| `tests/background.test.js` | 34 | mutation funnel, generation invalidation, optional permission flow, `lastGood` keying, storage surface |
| `tests/release.test.js` | 10 | badge thresholds, multi-account display, failure classes, request scope and startup behaviour |

Current result: **90 tests, 90 pass, 0 fail.** Paste the actual output into
`PUBLISHING.md` at release time rather than restating this number.

`tests/mock-browser.js` is a helper, not a test file. It supplies an injected
WebExtension API whose every mutation is logged in order *before* it takes
effect, and any single mutation can be held mid-flight. That is what makes the
generation tests deterministic rather than timing-dependent.

Note on what the decoder tests prove: they assert on the *input* to an
injected `TextDecoder`, not on state cleared afterwards. Erasing a string
after building it is not the same as never building it, and only the former
was true before pass 4.

Note on what they do **not** prove, which matters for the privacy wording. They
bound what reaches the decoder; they do not bound what reaches extension
memory. `reader.read()` resolves with a whole chunk inside extension code, the
scanner accepts it, and the chunk may be copied into a temporary `Uint8Array`
before the closing tag is located — so a chunk containing bytes after
`</fullcount>` can be briefly held in extension memory. The tests assert those
suffix bytes are never decoded into text (`decodedBytes` never includes them);
they do not assert the bytes were never present, because they were. Documents
in this tree must not describe those bytes as reaching only browser or network
buffers. See `PRIVACY.md` and `MOZILLA-QUESTION.md`.

Note on what the background tests prove, and do not. They assert that a
superseded generation *initiates* no further writes, and that the current
generation's commit runs last and leaves the final state. They deliberately do
**not** assert that a superseded generation performed no writes at all: one
test holds a commit after its first `setBadgeText` has already gone out,
invalidates it, and then asserts the write count is exactly 1. A call already
handed to the browser cannot be recalled, and the suite says so rather than
pretending otherwise.

Two tests assert a *timing* contract rather than an outcome — that
`permissions.onRemoved`, `permissions.onAdded` and `storage.onChanged` bump
the generation synchronously, before yielding. Deferring the bump by one
microtask leaves a window in which a run that has just finished fetching still
believes it is current. Nothing observable afterwards distinguishes that
reliably, so it is asserted where it is decided: inside the listener turn,
with no `await` between the event and the check.

## B. Manual (observed, not reproducible from this archive)

Status key: `[ ]` not yet run, `[P]` passed, `[F]` failed, `[-]` blocked.

**There are 46 manual cases below, and every one is `[ ]`.** None is claimed as
executed. Automated coverage of adjacent behaviour does not convert any of
these to a pass. This section is retained as compatibility and real-account QA;
it is not an AMO submission prerequisite and is not evidence used for the final
release verdict.

The count is 46, not 44 and not 48. The highest ID is 44, but 39 is followed by
39a and 39b, which are separate rows with their own status boxes: 44 + 2 = 46.
Documents citing this number must cite 46. Verify it rather than trusting it:

```sh
grep -cE '^\| *[0-9]+[a-z]? *\|.*\| *\[ \] *\|$' TEST-MATRIX.md
```

That command counts table rows whose first cell is a case ID and whose last
cell is an unchecked box, which is the same thing as "manual cases not yet
run" only while every case is `[ ]`. Once execution begins, the two diverge and
the `[ ]` filter must be dropped from the pattern.

### Installation and first run

The permission is optional, so a fresh install must show `!` and must make no
Gmail Atom-feed request until the first click is granted. Note the scope: the
permission gates the feed read and the background check. It does not gate the
tab — the toolbar button opens Gmail on grant, denial and dismissal alike, and
that page load is ordinary traffic to Google. Cases below distinguish the two.

| # | Case | Expected | Status |
| --- | --- | --- | --- |
| 1 | Install from ZIP on Firefox desktop 140 | Installs; badge shows `!`; no Atom-feed request to `mail.google.com/mail/u/*/feed/atom` before any click (check the Network panel). No click has occurred, so no Gmail tab has opened either | [ ] |
| 2 | Install on current release Firefox | Same as case 1 | [ ] |
| 3 | Install on ESR 140 | Same as case 1 | [ ] |
| 4 | Fresh profile, no Gmail session | `!` before granting; `?` after granting | [ ] |
| 5 | Toolbar button present in navbar by default | Yes | [ ] |
| 6 | First click on a fresh install | Firefox permission prompt for mail.google.com appears; prompt is raised by the click itself, not after a delay | [ ] |

### Permission flow

| # | Case | Expected | Status |
| --- | --- | --- | --- |
| 7 | Grant | Gmail opens; badge shows a count without further clicks | [ ] |
| 8 | Deny | Two separate observations. (a) A Gmail tab opens and loads `mail.google.com` — that page navigation is ordinary traffic to Google and is expected. (b) No Atom-feed request appears in the Network panel, and no background check runs. Badge stays `!` | [ ] |
| 9 | Dismiss prompt with Esc | Same as deny | [ ] |
| 10 | Leave prompt unanswered ~2 minutes, then grant | Badge updates; no lost state after event-page suspension | [ ] |
| 11 | Revoke in about:addons while idle | Badge becomes `!` promptly | [ ] |
| 12 | Revoke while a check is in flight (throttle to "GPRS") | Badge becomes and stays `!`; no numeric badge reappears afterwards | [ ] |
| 13 | Re-grant after revocation, by clicking the button | Prompt appears again; count returns | [ ] |
| 14 | Change account index while a check is in flight | Final badge is the new configuration's result | [ ] |
| 15 | Confirm about:addons lists mail.google.com as an optional permission the user can toggle | Listed under Permissions and data | [ ] |

### Counts

| # | Case | Expected | Status |
| --- | --- | --- | --- |
| 16 | Zero unread | Empty badge, grey | [ ] |
| 17 | 1–999 unread | Exact number, red | [ ] |
| 18 | >999 | `999+` | [ ] |
| 19 | >9999 | `9k+` | [ ] |
| 20 | Read a message in Gmail, wait one interval | Badge decreases | [ ] |
| 21 | Two accounts `0,1` | Sum of both; tooltip lists each | [ ] |
| 22 | Enter `0,0` in options | Rejected with "Account 0 is listed more than once" | [ ] |
| 23 | Enter `0,00` | Same rejection | [ ] |
| 24 | Corrupt storage to `0,00` via console, reload | Treated as one mailbox; no doubled total | [ ] |
| 25 | Non-existent account index `7` | `?`, tooltip explains | [ ] |
| 26 | Label `important` | Count for that label | [ ] |
| 27 | Non-existent label | `?` with parse or auth kind | [ ] |

### Failure modes

| # | Case | Expected | Status |
| --- | --- | --- | --- |
| 28 | Signed out of Gmail | `?`, tooltip says not signed in | [ ] |
| 29 | Offline | `?`, tooltip says couldn't reach Gmail | [ ] |
| 30 | One of two accounts failing | Amber badge; tooltip distinguishes partial sum from last known total | [ ] |
| 31 | Stalled body (see harness below) | Aborts at 15s, badge `?` | [ ] |
| 32 | Response with no `<fullcount>` | `?` with parse kind | [ ] |
| 33 | Response larger than 64 KB with no count | Aborts at the cap, not at end of body | [ ] |

### Environments

| # | Case | Expected | Status |
| --- | --- | --- | --- |
| 34 | Private browsing (extension not allowed) | No crash; behaves as unpermitted | [ ] |
| 35 | Private browsing (allowed) | Uses that context's session | [ ] |
| 36 | Container tabs, Gmail in a container | Documented behaviour: the check uses the default context | [ ] |
| 37 | Strict Enhanced Tracking Protection | Count still retrieved | [ ] |
| 38 | Total Cookie Protection enabled | Count still retrieved | [ ] |
| 39 | Browser restart — permission granted, Gmail reachable | Badge shows a **freshly checked** count. `lastGood` does survive the restart in storage (verify in case 40), but the badge is not drawn from it: startup runs a new check and the badge reflects that check's result | [ ] |
| 39a | Browser restart — permission granted, offline or Gmail failing | Badge shows `?`, not a remembered number | [ ] |
| 39b | Browser restart — permission never granted or since revoked | Badge shows `!` | [ ] |
| 40 | Inspect storage after restart (`about:debugging` → Storage) | Contains only `accounts`, `label`, `interval`, `reuseTab`, `status`, `lastCheck`, optionally `partialSource` and `lastGood`. No `lastCount` | [ ] |
| 41 | Upgrade over a profile that has `lastCount` in storage | `lastCount` is removed on update | [ ] |
| 42 | Event page suspended ~5 minutes, then alarm | Check runs | [ ] |
| 43 | Light and dark themes | Badge legible in both | [ ] |
| 44 | Options page | Trademark disclaimer visible without scrolling past the controls | [ ] |

## C. Stalled-body harness

The pass-two version of this harness logged the abort event but never failed
the pending read, so `reader.read()` could stay pending forever and the
timeout cases would hang rather than validate anything. The abort listener
must actually error the stream controller:

```js
// Stub fetch that returns a Response whose body stalls after a prefix.
const realFetch = globalThis.fetch;
globalThis.fetch = (url, opts = {}) => {
  let controller;
  const body = new ReadableStream({
    start(c) {
      controller = c;
      c.enqueue(new TextEncoder().encode("<feed><title>Gmail</title>"));
      // then nothing — the body stalls
    },
    cancel() {}
  });

  // This is the part that was missing: aborting the signal must reject the
  // pending read, because controller.abort() does not error a manually
  // constructed stream on its own.
  if (opts.signal) {
    opts.signal.addEventListener("abort", () => {
      try {
        controller.error(new DOMException("The operation was aborted.", "AbortError"));
      } catch (_) { /* already closed */ }
    });
  }

  return Promise.resolve(new Response(body, {
    status: 200,
    headers: { "content-type": "application/atom+xml" }
  }));
};
// restore with: globalThis.fetch = realFetch;
```

Expected: `fetchCount()` rejects with `kind === "timeout"` after
`LIMITS.fetchTimeoutMs` (15s), the badge shows `?`, and no check remains
pending. The same abort wiring is exercised automatically in
`tests/stream.test.js` ("an aborted stalled body rejects rather than hanging").

## D. Not yet covered

* Consumer Gmail against a real account at every badge threshold.
* Container and private-browsing matrices above (34–38) are untested.
* Behaviour under Google's occasional feed redirects to interstitial pages.
* Whether the permission prompt's own wording satisfies a reviewer; only the
  API call timing has been tested, not the resulting UI.
* Firefox for Android: not tested at all, and deliberately not offered.
