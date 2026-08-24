# Publishing notes — Unread Badge for Gmail™ 1.0.0

Internal document. Not shipped in the release ZIP.

## Current verdict

**Ready for AMO submission.** The runtime has no known open defect, the
supporting-source archive is deterministic, the automated suite passes, and
`addons-linter 10.10.0` reports 0 errors, 0 notices and the one documented
desktop-only Android warning. The data-collection declaration is resolved
below from Mozilla's current published taxonomy. The manual matrix remains an
optional compatibility and real-account QA record; no unchecked row is
represented as having passed.

## Final release decisions

| # | Topic | Decision | State |
| --- | --- | --- | --- |
| D1 | `data_collection_permissions` | Keep `required: ["websiteContent"]`. Reading the Gmail response is essential to the advertised unread-badge function. Mozilla defines `websiteContent` to include website text, cookies, and request/response information. The extension neither reads credential values nor decodes, uses, stores, displays, or retransmits message content, so `authenticationInfo` and `personalCommunications` are not additionally declared. | Resolved; rationale and the earlier question draft are retained in `MOZILLA-QUESTION.md` |
| D2 | Manual compatibility matrix | Keep the 46 cases as honest, unchecked follow-up QA. They are not an AMO submission requirement and are not converted into passes by adjacent automation. Critical deterministic behaviours are covered by 90 automated tests, including release thresholds, failure classification, request scope and restart handling. | Not a submission blocker; no manual result is claimed |

This is a conservative classification decision, not a claim that Mozilla has
answered this extension's exact fact pattern. If an AMO reviewer requests a
different category, update the declaration and disclosure together in a new
build. The current declaration is accepted by the linter and directly matches
the broad `websiteContent` definition in Mozilla's published taxonomy.

## Resolved this pass (pass 5)

1. **Optional host permission.** `host_permissions` became
   `optional_host_permissions`. Until pass 4 the documentation claimed the
   permission was requested on first click while the manifest granted it at
   install; the manifest now matches the documentation instead of the other
   way round. `permissions.request()` is still called synchronously inside
   `action.onClicked`, before any `await`.
2. **Serialized generation-aware mutation funnel.** Every background-owned
   badge and storage write goes through one queue, and the generation is
   re-read immediately before each individual API call rather than once per
   commit. See the limitation recorded below.
3. **Background tests.** `tests/background.test.js` (34 tests) against an
   injected WebExtension API in `tests/mock-browser.js`.
4. **`lastCount` no longer persisted.** It was written and never read. The
   check result still carries the number, renamed `count`. `lastGood` is
   untouched — it is live state for multi-account partial failures, not a
   duplicate of `lastCount`.
5. **Trademark disclaimer added to `options.html`.** Pass 4's claim that the
   options page carried one was false; the file had no such text. Verified
   present in the built ZIP, not merely in the source tree.
6. **Deterministic packaging.** `build.sh` replaced by `build.py`.
7. **Documentation corrected** — see the audit below.

## Resolved this pass (pass 6)

Documentation only, plus one comment and one test rename. No parser change, no
runtime behaviour change.

1. **Network semantics corrected everywhere.** `handleClick()` calls
   `openGmail()` unconditionally — on grant, denial, dismissal, and when
   `permissions.request()` rejects or throws. Denial therefore means *no
   Atom-feed request and no background check*, not *no request to Google*: the
   click still navigates a tab to `mail.google.com`, which is ordinary browser
   traffic. Every absolute claim to the contrary was replaced. See the audit
   table.
2. **Persistence claims corrected.** `lastCount` is gone, but `lastGood.total`
   persists the last complete unread total keyed to the account/label
   configuration. "The count is not persisted" was false. Corrected to the
   three-part statement: no `lastCount` and no separate per-check count; the
   last complete total *is* persisted for multi-account fallback; the badge is
   not drawn from storage at startup.
3. **Manual case count corrected** from 48 to 46, verified programmatically.
4. **Generation guarantee narrowed** to be conditional on the browser API
   mutations succeeding, rather than implementing recovery. Reasoning below.
5. **`MOZILLA-QUESTION.md` re-audited** after item 1, and a fifth question
   added on whether credentialed session-cookie handling is fully covered by
   `websiteContent` or additionally engages `authenticationInfo`. At pass 6 it
   was not posted and the answer log was empty; the final submission decision
   is recorded at the top of this document.

## Resolved this pass (pass 7)

Documentation and build tooling only. **No runtime file changed and no test
changed** — every one of the ten runtime files is byte-identical to pass 6, the
release ZIP hash is unchanged, and the four test files are untouched. One new
file is added, `build-src.py`, which is build tooling excluded from the release
ZIP. Reviewer pass 7 found that pass 6's own corrections were still imprecise in
four places.

1. **Delivered-but-undecoded bytes described accurately.** Pass 6 said those
   bytes reach the browser's buffers and are "discarded unread". That is
   incomplete: `readCountFromStream()` calls `reader.read()`, which resolves
   with the entire chunk *in extension JavaScript*; `scanner.push(value)`
   accepts it; and `concatBytes(pending, take)` may copy it into a temporary
   `Uint8Array` before `findCloseTagEnd()` locates the closing tag. Suffix bytes
   are therefore briefly in extension memory. What remains true, and is now
   stated as the whole of the claim: they are not decoded into text, parsed as
   message data, persisted, displayed, or retransmitted, and the temporary array
   is unreachable after the call. Corrected in `README.md`, `PRIVACY.md`,
   `LISTING.md`, `MOZILLA-QUESTION.md` and `TEST-MATRIX.md`.
2. **Cookie transmission attributed correctly.** "The extension never transmits
   those cookies itself; the browser attaches them" made the extension a
   bystander to its own request. The extension code never accesses the cookie
   values, but its credentialed fetch is what causes Firefox to attach and
   transmit them. At pass 7 the `authenticationInfo` question remained open
   and `websiteContent` alone was explicitly *not* claimed to be established.
   The final classification decision is recorded above. The
   "exactly like loading Gmail in a tab" equivalence was removed everywhere:
   the requests share the browser's authenticated session but are not the same
   request or context.
3. **Checksum verification made non-circular.** See the procedure above.
4. **Request frequency qualified** in `PRIVACY.md`: a toolbar click joins an
   `inFlight` check rather than necessarily starting another set of fetches.
5. **Source-archive construction scripted** as `build-src.py`, the one addition
   this pass makes to the tree. Finding 3 permitted either documenting the
   procedure or omitting the reproducibility claim; scripting it is the
   stronger option, and it is validated by reproducing the pass-6 source
   archive byte for byte rather than by assertion. This is build tooling, not
   runtime: it is excluded from the release ZIP by `build.py`'s explicit
   `RUNTIME_FILES` list, so the release ZIP hash is unchanged.

Preserved from pass 6 without change, as instructed: parser behaviour,
`lastGood` behaviour, the optional host-permission flow, the Android position,
all manual statuses, the 46-case count, the conditional generation guarantee,
and the zero-fetch assertions for denial, dismissal and `permissions.request()`
failure.

**One deliberate non-change, recorded rather than made.** The phrase "tells the
browser to stop requesting further chunks" also appears in a source comment in
`parser.js` (above `readCountFromStream`). Pass 7's scope is documentation, and
editing that comment would change a runtime file's bytes and break the
byte-identity check. It is left as-is and flagged here for a future pass that
touches runtime files; the reviewer-facing documentation no longer uses that
phrasing.

## What the generation guarantee is, precisely

The enforceable claim, and the only one made in the code or the docs:

> After supersession, the old generation initiates no additional writes, and —
> **conditional on the relevant browser API mutations succeeding** — the
> current generation deterministically owns the final badge and storage state.

Two mechanisms produce it. The generation is re-read immediately before each
individual external API call, so a supersession landing between two calls of
the same commit stops the remaining ones. And all commits are strictly
serialized in enqueue order, so the superseding generation's commit — enqueued
behind whatever was already queued — runs afterwards and its values are the
ones left in place.

**Why the qualifier was added in pass 6, and why the alternative was
rejected.** Reviewer pass 6 observed that the unconditional form of this
sentence was stronger than the implementation. It is: `applyMutations()` treats
badge calls as *soft* (log the failure, skip the rest of the badge group,
continue) and storage calls as *hard* (propagate). So if `action.setBadgeText`
rejects, the current generation does not own the badge — the previous
generation's text stays on screen until a later write succeeds. The reviewer
offered two ways out: qualify the claim, or implement recovery that makes the
unconditional claim true.

We qualified. Implementing "recovery" here would mean retrying failed badge
calls, and a retry is itself a browser API call that can fail; the honest
statement at the end of any finite retry ladder is still conditional. Building
that ladder would convert a plainly conditional guarantee into one that merely
*looks* unconditional while resting on an unstated bound. Since the reviewer
also said not to broaden the implementation silently, no runtime behaviour was
changed: the wording moved to match the code in `background.js`, `README.md`
and here, and the background test asserting this property was renamed to state
the condition.

**The limitation, stated rather than buried.** A call already handed to the
browser cannot be recalled. If `setBadgeText` was issued a microsecond before a
revocation, that text was shown. The queue does not undo it; it guarantees the
current generation's write follows and overwrites it. Pass 4's claim that "all
persistent writes are generation-guarded" was too strong on exactly this point
and has been removed everywhere.

`tests/background.test.js` asserts both halves. One test holds a commit after
its first `setBadgeText` has gone out, invalidates it, and asserts the write
count is exactly 1 — not 0. Writing the blanket assertion instead would have
required the implementation to lie.

The test suite was checked by mutation rather than trusted because it was
green. Nine deliberate breakages were introduced one at a time: removing the
per-op generation check, moving it to once per commit, removing serialization,
deferring `invalidateNow()` in each of the two listener paths, re-adding
`lastCount`, dropping the `lastGood` key comparison, moving
`permissions.request()` behind an `await`, and removing the legacy purge. One
survived on the first attempt — deferring `invalidateNow()` in
`permissions.onRemoved` — which meant the revocation test was not
discriminating. Four tests asserting the synchrony contract inside the listener
turn were added; all nine mutations now fail the suite.

## Validator

`addons-linter 10.10.0`, run against the release ZIP:

```
errors    0
warnings  1
notices   0

KEY_FIREFOX_ANDROID_UNSUPPORTED_BY_MIN_VERSION
  "strict_min_version" requires Firefox for Android 140, which was released
  before version 142 introduced support for
  "browser_specific_settings.gecko.data_collection_permissions".
```

## Android: desktop-only by choice

The extension is **deliberately unsupported on Firefox for Android.** The
toolbar-badge UI and the click-to-grant permission flow have not been tested
there, and shipping a permission flow to a platform nobody has exercised is not
something a disclaimer fixes.

Mechanically:

* `gecko_android` is omitted from the manifest.
* AMO's submission handling checks the manifest for `gecko_android`; when it is
  present, its `strict_min_version` and `strict_max_version` set the Firefox
  for Android compatibility range, and when it is absent the submission is not
  flagged as Android-compatible. Omission is therefore what causes AMO to
  default to not listing the extension for Android.
* That default is **not** being manually overridden.
* Omitting the key does not itself technically prevent Firefox for Android from
  loading the extension. It governs AMO distribution, not what Gecko will
  install. A user who obtained the XPI another way is not blocked by its
  absence.

No claim is made here about whether badge APIs render or behave usefully on
Android. That has not been tested, so nothing is asserted either way — pass 4's
phrasing implied more than had been measured.

**The remaining linter warning is accepted as a consequence of this deliberate
desktop-only configuration.** It is not linter noise and is not dismissed as
meaningless. With `gecko_android` absent, the linter derives an Android floor
from the desktop `strict_min_version`; because the desktop minimum is 140 and
data-consent support on Android began at 142, it reports the mismatch. The
warning is a correct observation about a configuration we chose on purpose.

Three configurations were measured on 10.10.0:

| `gecko` min | `gecko_android` | Result |
| --- | --- | --- |
| 142.0 | omitted | 0 / 0 / 0 |
| 140.0 | omitted | 1 warning (shipped configuration) |
| 140.0 | 142.0 | 0 / 0 / 0 |

The third row would be clean, but declaring `gecko_android` asserts Android
compatibility that has never been tested. Raising the desktop minimum to 142
would exclude Firefox 140 and ESR 140 desktop users. Shipping one documented
warning is the honest option. Release notes must state it.

## Reproducible packaging

`build.py` replaces `build.sh`. `zip(1)` records each file's mtime, so two
builds of identical bytes produced different hashes and the instruction to
"rebuild and confirm the hash" was not achievable. Measured directly: two
`zip -X` builds of the same pass-4 tree, with one file's mtime touched between
them, produced `4cd884a1a7c23838f68920e136868531769d98d35cb8a6880d98470db23bfb2f`
and `ea37bbe364483419a152d8bb689b623e25ee74bde785311407a22c5184dcb749`.

`build.py` pins everything that is not file content: an explicit sorted runtime
file list, the ZIP epoch timestamp (1980-01-01), mode 0644, creator system 3,
no extra fields, and `ZIP_STORED` so the output does not depend on the zlib
version or on compression-level defaults. It builds twice on every run and
fails if the hashes differ.

**Scope of the determinism claim, narrowed to what the build actually proves.**
Given byte-identical inputs, `build.py` produces a byte-identical ZIP; that was
verified across two clean builds with the sources' mtimes deliberately changed
in between. It does **not** make the inputs reproducible. `icons/make-icons.py`
output depends on the installed Pillow version. Reproducing a published ZIP
hash from a clean checkout therefore means either using the committed PNGs or
matching the recorded toolchain. Nothing here has been tested on a second
machine or a different Python, so no cross-environment guarantee is claimed.

Toolchain used for the recorded hashes:

| Tool | Version |
| --- | --- |
| Python | 3.12.3 |
| Pillow | 12.1.1 |
| Node.js | 22.22.2 |
| addons-linter | 10.10.0 |

### Verifying checksums without circularity

`build.py` writes `SHA256SUMS.txt` as its final step. The pass-6 checklist said
"`python3 build.py` and confirm hashes against `SHA256SUMS.txt`", which
compares the freshly written file against itself and can never fail. Preserve a
reference copy **before** building:

```sh
cp SHA256SUMS.txt /tmp/unread-badge-expected-sums.txt   # must precede build.py
python3 build.py
cmp /tmp/unread-badge-expected-sums.txt SHA256SUMS.txt  # rebuild reproduced it
sha256sum -c /tmp/unread-badge-expected-sums.txt        # files match the list
```

`cmp` is the real check: it compares the rebuilt hash list against a copy taken
before the rewrite. `sha256sum -c` then confirms the files on disk match that
preserved list.

Scope of each entry, because a bare `sha256sum -c SHA256SUMS.txt` on a freshly
extracted source tree does not verify all eleven:

* The **ten runtime-file entries** are verifiable immediately after extracting
  the source archive, with no build:
  `grep -v '\.zip$' SHA256SUMS.txt | sha256sum -c -`.
* The **release-ZIP entry** is not, because the source archive intentionally
  does not contain the ZIP. It becomes verifiable only after running
  `build.py`, or after placing the separately supplied release ZIP beside the
  files. On an unbuilt tree `sha256sum -c` reports one missing file; that is
  expected, not a failure.
* The **supporting-source archive is reproducible as of pass 7.** Pass 6 could
  not claim this, because `build.py` builds the release ZIP only and the source
  archive was assembled by hand. `build-src.py` now performs that construction,
  pinning exactly what `build.py` pins: ZIP epoch timestamps, mode 0644,
  creator system 3, no extra fields, no directory entries, `ZIP_STORED`, and a
  fixed lexicographically sorted allowlist of archive members. It builds twice
  on every run and fails if the hashes differ.

  The allowlist is `SOURCE_FILES`, reviewed the same way `RUNTIME_FILES` is in
  `build.py`. Adding a file to the working tree does not add it to the archive;
  it has to be listed. Every listed file must exist or the build fails.

  The method was not merely asserted. Run against an unmodified pass-6 tree via
  `python3 build-src.py --root <pass6-tree> --allow-missing build-src.py --out
  /tmp/check.zip`, it reproduces the published pass-6 source archive
  `ad4c07a24cd2e0271e4f5cd09270e5ed0f2c783e9bc7a5a8cc4e80d9feeb9399` byte for
  byte. Reproducing a known-good archive from an independent implementation of
  the procedure is what licenses the claim; without it this would just be a
  script that agrees with itself.

  `--allow-missing build-src.py` is required because the script postdates the
  pass-6 tree. That is the only value the flag accepts and the only historical
  exception; it is never implicit, so a current build missing a listed file
  still fails.

  The same narrowing applies as for `build.py`: byte-identical inputs give a
  byte-identical archive, but the inputs themselves are not made reproducible.

## Documentation audit

Claims removed or corrected this pass, all of which were stronger than the
implementation:

| Claim | Where | Correction |
| --- | --- | --- |
| "all persistent writes are generation-guarded" | `PUBLISHING.md` | Replaced with the two-part guarantee and the already-issued-write limitation |
| "Requested when you first click the button, not at install" | `PRIVACY.md`, `LISTING.md` | Was false against a manifest using `host_permissions`; now true, because the manifest changed |
| "the last unread total … so the badge survives a browser restart" | `PRIVACY.md` | Corrected in two steps. Pass 5 replaced it with "the count is not persisted", which was **itself false** — `lastGood.total` persists the last complete unread total. Pass 6 states the actual distinction: no `lastCount` key and no separate most-recent-check count is persisted; `lastGood` does persist the last complete total keyed to the account/label configuration; the badge is not drawn from storage at startup, which runs a new check |
| "Settings and the last count stay in Firefox's local storage" | `LISTING.md` | Replaced with the actual storage contents |
| "`storage` — Settings and the last count" | `PRIVACY.md` permission table | Replaced; storage now enumerated key by key |
| "the warning is a linter artifact rather than a real compatibility defect" | `PUBLISHING.md` | Replaced. The warning is accepted as a consequence of a deliberate configuration |
| "which tells AMO the extension is not Android-compatible" | `README.md` | Kept but made precise, and separated from what omission does *not* do |
| "The listing, the options page and the README carry a disclaimer" | `PUBLISHING.md` | Was false for the options page. The disclaimer has now been added there |
| "`./build.sh` and confirm hashes against `SHA256SUMS.txt`" | `PUBLISHING.md` checklist | Was not achievable with a non-deterministic build; now is, within the recorded toolchain |
| "no data collection beyond what is necessary" framing | throughout | Unchanged from pass 4. **Note:** this row previously also asserted that the credentialed-request disclosure and the delivered-but-undecoded caveat "were already correct". Pass 7 found both incomplete — see the pass-7 rows below |
| "nothing is requested" | `LISTING.md`, `PRIVACY.md` | **Pass 6.** False on the denial path: the click opens a Gmail tab regardless. Replaced with the Atom-feed-scoped claim plus explicit disclosure of the tab navigation |
| "No network request to Google is possible before that grant" | `LISTING.md` permission justification | **Pass 6.** Replaced. The reviewer-facing text now states the two facts separately and names which one the test asserts |
| "no request is ever made until the user … accepts the prompt" | `MOZILLA-QUESTION.md` | **Pass 6.** Replaced, and the post now states outright that denial does not stop the tab navigation. Asking Mozilla to classify an extension we had described inaccurately would have produced an answer to the wrong question |
| "makes no requests" / "nothing is fetched" | `README.md` | **Pass 6.** Scoped to the Atom feed, with the permission's actual scope stated: it gates the feed read and the background check, not the tab |
| "no request to Google before any click" / "still no request to Google" | `TEST-MATRIX.md` cases 1 and 8 | **Pass 6.** Case 8 now requires two separate observations — one Gmail tab navigation, zero Atom-feed requests |
| "The count is not persisted and is not restored from storage" | `TEST-MATRIX.md` case 39 | **Pass 6.** `lastGood` does survive the restart; what does not happen is the badge being drawn from it. Case 39 now says which is which, and cross-references case 40 |
| "the current generation deterministically owns the final badge and storage state" | `PUBLISHING.md`, `README.md`, `background.js`, `tests/background.test.js` | **Pass 6.** Qualified as conditional on the relevant browser API mutations succeeding, since badge failures are deliberately soft. No recovery implemented |
| "Those bytes are discarded unread" / "cannot recall bytes already delivered into the browser's buffers" | `PRIVACY.md` | **Pass 7.** Incomplete against the implementation. `reader.read()` returns the whole chunk to extension JavaScript, the scanner accepts it, and it may be copied into a temporary `Uint8Array` before the closing tag is found — so suffix bytes reach extension memory, not merely browser buffers. Replaced with delivery-to-extension-code wording plus the explicit list of what is *not* done with them |
| "they are discarded unread" | `LISTING.md` | **Pass 7.** Same defect, user-facing wording |
| "They may arrive in the browser's buffers" | `MOZILLA-QUESTION.md` question 4 | **Pass 7.** Material to the classification question being asked. Rewritten to state delivery into extension memory explicitly, with the three implementation steps that cause it |
| "the reader is then cancelled, so the browser stops requesting further chunks" | `README.md`, `PRIVACY.md`, `MOZILLA-QUESTION.md` | **Pass 7.** Attributed the stop to the browser. Replaced with: the extension stops consuming further chunks and requests cancellation of the response body stream; cancellation cannot recall bytes already delivered or already in flight |
| "The extension never reads, stores or transmits those cookies itself; the browser attaches them" | `PRIVACY.md`, `MOZILLA-QUESTION.md` | **Pass 7.** Framed the extension as a bystander. The extension code does not access the cookie values, but its credentialed fetch is what causes Firefox to attach and transmit them. Replaced, and `websiteContent`-alone is now stated as *not* established |
| "exactly like loading Gmail in a tab" / "in the same way loading Gmail in a tab does" / "as it would for any same-origin request" | `README.md`, `LISTING.md`, `MOZILLA-QUESTION.md` | **Pass 7.** The Atom fetch and a tab navigation share the browser's authenticated session; they are not identical requests or contexts, and the fetch is not same-origin. Equivalence claims removed |
| "the Atom request is made once per account per interval and once when you click" | `PRIVACY.md` | **Pass 7.** A click while `check()` has an `inFlight` operation joins that promise and does not necessarily start another set of fetches. Qualified |
| "`python3 build.py` and confirm hashes against `SHA256SUMS.txt`" | `PUBLISHING.md` checklist | **Pass 7.** Circular: `build.py` overwrites `SHA256SUMS.txt`, so the comparison cannot fail. Replaced with a preserved-reference procedure, plus a statement of which entries are verifiable when |
| "an explicit file list, derived by scanning the tree" / "Every tracked file, sorted by path bytes" / "explicit path-sorted file list" | `build-src.py`, `PUBLISHING.md` | **Pass 8.** Wrong three ways. `source_files()` used `root.rglob("*")`, so it packaged any visible non-ZIP file whether tracked or not — adding `PRIVATE-NOTE.txt` to the tree demonstrably shipped it — excluded hidden paths even when tracked, and sorted Python strings rather than path bytes. Replaced by a fixed reviewed `SOURCE_FILES` allowlist, lexicographically sorted, with existence validated for every entry. The byte-ordering claim is dropped rather than implemented, since the member set is ASCII-only and the two orderings coincide; `build.py`'s own "explicit, sorted" wording was already accurate and is unchanged |
| "each scheduled check requests the feed once per configured account" with only toolbar clicks qualified | `PRIVACY.md` | **Pass 8.** Overbroad: coalescing is not specific to clicks. `check()` returns the in-flight promise to whichever caller reaches it, so an alarm firing during an active check joins that operation rather than issuing requests. Rewritten around the check *operation*, with the configuration- and permission-change paths called out separately: those call `recheck()`, which queues exactly one fresh check instead of joining. **The pass-8 replacement was itself overbroad — see the next row** |
| "Any trigger that occurs while a check is already in progress … joins that operation" / "Changing your settings … the check in progress is abandoned" | `PRIVACY.md` | **Pass 9.** Two overclaims in the pass-8 replacement. First, coalescing is decided when `check()` is called, not when the triggering event occurs. `onStartup` awaits `rescheduleAlarm()`; `onInstalled` awaits `purgeLegacyKeys()` and `rescheduleAlarm()`; `handleClick()` awaits the permission result and `openGmail()`. An operation active when one of those events begins can settle during those awaits, and the later call then starts a new operation and another set of requests. Second, "your settings" is not every setting: `storage.onChanged` returns early unless `accounts`, `label` or `interval` changed, so a `reuseTab`-only change invalidates nothing. Rewritten to separate immediate from delayed callers, to name the three settings that invalidate, and to say that a change supersedes the result being computed and aborts active feed requests rather than "abandoning" the operation. The extra set of requests is now stated as conditional on the new state still permitting feed access, which a revocation does not. **This row also asserted that only the alarm listener and the `check-now` message reach `check()` immediately. That was false, and the sentence has been struck from this row — see the next row** |
| "Only the alarm listener and the `check-now` message reach `check()` immediately" / "Other paths … perform asynchronous work first" | `PUBLISHING.md` pass-9 row, `PRIVACY.md` | **Pass 10.** Overbroad in the opposite direction from pass 9. `permissions.onAdded.addListener(() => invalidate())` is fully synchronous: `invalidate()` calls `invalidateNow()` and then `recheck()`, which calls `check()` immediately when no operation is active and otherwise queues exactly one fresh check. Granting access is therefore a third path that reaches `check()` without awaiting, and `PRIVACY.md`'s "other paths … perform asynchronous work first" reads as excluding it. The background script's own top-level `check()` call, which runs whenever the script loads, is a fourth. Also newly stated, because it is a request-frequency consequence rather than a wording defect: on a toolbar grant the permission-added listener can start or queue a check while `handleClick()` is still awaiting `openGmail()`, so `handleClick()`'s own later `check()` joins that operation only if it is still active — if it settled during the tab work, the click starts a second operation and a second set of requests. `PRIVACY.md` now enumerates the three timing classes separately, states the toolbar-grant interaction, and distinguishes the synchronous invalidation from the fresh-check request, which is immediate only on a grant. The synchronous path is covered by `permissions.onAdded triggers a fresh check under a new generation` |
| Supporting-source archive implicitly treated as reproducible | `PUBLISHING.md`, `LISTING.md` | **Pass 7.** Through pass 6 the archive was assembled by hand and no procedure shipped, so the implication was unearned. `build-src.py` now performs the construction and is validated against the pass-6 archive hash; the claim is now made explicitly and is checkable |

`README.md`, `PRIVACY.md`, `LISTING.md`, `PUBLISHING.md`, `MOZILLA-QUESTION.md`
and `TEST-MATRIX.md` now agree on: the permission model, what is stored, what
happens after restart, the Android position, the generation guarantee and its
limit, the reproducibility scope, the fate of undecoded suffix bytes (delivered
to extension code, briefly held, never decoded or used), who causes the session
cookies to be transmitted (the extension's credentialed fetch, via Firefox),
and the non-circular checksum procedure.

## Unit tests

```sh
$ node --test tests/*.test.js
# tests 90
# pass 90
# fail 0
```

Manual results are recorded separately in `TEST-MATRIX.md` section B and are
**not** to be reported alongside these numbers. All **46** manual cases remain
`[ ]`; they are follow-up compatibility and real-account QA, not evidence used
for the submission verdict.

The number was 48 in pass 5 and was wrong; nobody counted. It is 46: IDs run
1–44, and 39 is followed by the separate rows 39a and 39b. Verified
programmatically, not by eye:

```sh
$ grep -cE '^\| *[0-9]+[a-z]? *\|.*\| *\[ \] *\|$' TEST-MATRIX.md
46
```

Two cases were **not** invented to reach 48. Padding a matrix to match a
previously published number would be the same class of error as the number
itself.

## Icon

The previous icon used `#EA4335` — Google's red — on an envelope resembling
the older Gmail mark. Google's brand guidance asks third parties not to
imitate its product icons, visual identity or distinctive colours, and a
trademark disclaimer does not cure an imitative mark.

The icon was replaced: deep violet `#3D2A7A` and white, no envelope, a stack
of list rows with an unread dot. `icons/make-icons.py` generates each size
independently with whole-pixel geometry; `icons/icon.svg` is the 128px design
reference. The SVG's numbers were checked against the generator's computed
geometry for size 128 and match exactly. The SVG could not be rasterized in
the build environment (`rsvg-convert` unavailable), so the two have not been
compared pixel by pixel.

Regenerating the four PNGs under Pillow 12.1.1 reproduces the shipped files
byte for byte.

## Trademark

"Gmail" appears in the extension name. AMO permits a third-party product name
in a title where the add-on is plainly not the official client. The listing,
the README and — as of this pass — the options page carry a disclaimer. If AMO
objects, fall back to "Unread Badge for GMail" → "Unread Mail Badge" and drop
the ™.

## Release checklist

1. [x] Record and disclose the `websiteContent` classification decision
2. [x] Run all 90 automated tests
3. [x] Verify checksums by the preserved-reference procedure below — **not** by
   building and then comparing against `SHA256SUMS.txt`, which `build.py`
   rewrites
4. [x] `addons-linter 10.10.0` — 0 errors, 0 notices, 1 accepted warning
5. [ ] Attach the supporting-source archive (tests, build, icon sources, docs)
6. [ ] Paste `LISTING.md` copy; link `PRIVACY.md`
7. [ ] State the accepted Android-derived warning in the release notes
8. [ ] Submit as desktop-only, Firefox 140+

Items 5–8 are AMO form actions performed when uploading; they do not require a
new source or runtime build. `TEST-MATRIX.md` section B remains available for
post-submission and compatibility QA and is not represented as executed.
