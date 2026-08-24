# Unread Badge for Gmail™

A Firefox toolbar badge showing the number of unread messages in your Gmail
inbox. No popup, no sign-in flow of its own, no account linking. Clicking the
button opens Gmail.

*Not affiliated with, endorsed by, or sponsored by Google. Gmail is a
trademark of Google LLC.*

## How it works

Firefox already holds your Gmail session cookies. Once you grant access to
`mail.google.com`, the extension requests Gmail's Atom feed
(`https://mail.google.com/mail/u/<n>/feed/atom`) on a timer, reads the unread
count out of the response, and writes it on the toolbar badge.

The request is an ordinary credentialed HTTPS request from your browser to
Google. The extension code never accesses the cookie values; its credentialed
fetch causes Firefox to attach and transmit the existing Gmail session cookies
to Google, because that is the only way Google will answer it. It shares the
browser's authenticated session with a Gmail tab, but it is not the same
request or the same context. Nothing is sent anywhere else.

### Permission model

`mail.google.com` is declared under `optional_host_permissions`, so it is not
granted at install time:

* a fresh install shows `!` and runs no unread check — no Atom-feed request;
* the first toolbar click calls `permissions.request()` synchronously, inside
  the click handler, before any `await` — awaiting first would discard the
  user-activation status and the request would silently fail;
* on grant, Gmail opens and a check runs immediately;
* on denial, dismissal, or a `permissions.request()` that rejects or throws,
  Gmail still opens, the badge stays `!`, and no Atom-feed request is made;
* revoking in about:addons returns the badge to `!` and stops checking;
* clicking again after a revocation re-requests the permission.

`handleClick()` calls `openGmail()` on **every** path — the comment on that line
says so, and the background tests assert one `tabs.create` on the denial,
dismissal and throw paths. The scope of the permission is therefore: it gates
the Atom-feed read and the background check, not the tab. Opening a Gmail tab
loads `mail.google.com` in the ordinary way, which is traffic to Google
regardless of what the user answered to the prompt. Documentation in this tree
must not say "no request to Google" when it means "no Atom-feed request".

`permissions.onAdded` and `permissions.onRemoved` are registered
synchronously at top level, so a change made in about:addons is reflected
without waiting for the next poll.

### Reading only the count

Gmail's feed puts `<fullcount>` before the `<entry>` elements that carry
senders, subjects and snippets. The extension reads the response as a stream
and stops at the count:

* incoming bytes are searched for the closing `</fullcount>` tag by **raw byte
  comparison** — no string is built while searching;
* when the tag is found, only the bytes at or before it (at most 512) are
  passed to the text decoder; the rest of that chunk is never decoded;
* the extension then stops consuming further chunks and requests cancellation
  of the response body stream; cancellation cannot recall bytes already
  delivered or already in flight;
* at most 64 KB is ever accepted, enforced per chunk, so a response without a
  count cannot be read indefinitely.

What this does **not** claim: chunk boundaries are arbitrary and outside the
extension's control, and the bytes that follow the count are not merely sitting
in a network buffer. A ReadableStream chunk containing bytes after
`</fullcount>` may be delivered to extension code and briefly held in a
temporary byte array: `readCountFromStream()` calls `reader.read()`, which
returns the whole chunk to extension JavaScript; `scanner.push(value)` accepts
it; and `concatBytes(pending, take)` may copy it into a temporary `Uint8Array`
before `findCloseTagEnd()` locates the closing tag.

The extension does not decode those suffix bytes into text, parse them as
message data, persist them, display them, or retransmit them. Only the region
ending at the closing tag ever reaches the text decoder. Once the call returns,
the temporary array is unreachable and is left for garbage collection.
Cancellation cannot recall bytes already delivered or already in flight.
See `PRIVACY.md`.

### Generations and the mutation funnel

A check that started under one permission or configuration state must not
write a badge describing a state that has since changed. A generation counter
is bumped synchronously by `permissions.onAdded`, `permissions.onRemoved` and
`storage.onChanged`, before those handlers await anything, and in-flight
requests are aborted at the same moment.

Every badge and storage write then goes through one serialized queue. The
generation is re-read immediately before **each individual** API call, not
once per commit. This guarantees exactly two things:

1. after supersession the old generation initiates no further writes;
2. because the superseding generation enqueues its own commit behind whatever
   is already queued, that commit runs afterwards — and **if** its browser API
   calls succeed, its values are the ones left in place.

That conditional is load-bearing and is not a hedge. `applyMutations()` treats
badge calls as *soft*: a failing `action.set*` call is logged, the rest of that
badge group is skipped, and the commit continues. A half-written badge is worse
than a stale one, so this is deliberate — but it means that if the browser
refuses a badge call, the current generation does not own the badge, and the
previous generation's text stays on screen until the next successful write.
Storage ops are *hard*: they propagate to the caller rather than being skipped.
So the ownership claim holds for badge and storage state **conditional on the
relevant browser API mutations succeeding**, and no recovery or retry is
implemented that would make it hold unconditionally.

It does **not** guarantee that a call already handed to the browser is
recalled. If `setBadgeText` went out a microsecond before a revocation, that
text was briefly shown; the queue does not undo it, it guarantees the current
generation's write follows and overwrites it. `tests/background.test.js`
asserts both the guarantee and this limitation.

## Compatibility

* Firefox desktop 140 and later.
* Firefox for Android: deliberately unsupported — see the Android section of
  `PUBLISHING.md`. `gecko_android` is omitted, which is what tells AMO not to
  list the extension for Android.

## Layout

| Path | Purpose |
| --- | --- |
| `manifest.json` | MV3 manifest, event page, data-consent declaration |
| `parser.js` | byte scanner, stream reader, account normalization |
| `background.js` | scheduling, fetching, badge, permissions, click handling |
| `options.html` / `options.js` | settings UI |
| `icons/icon.svg` | 128px design reference |
| `icons/make-icons.py` | per-size icon generator (Pillow) |
| `tests/mock-browser.js` | injected WebExtension API mock used by the background tests |
| `tests/*.test.js` | unit tests (`node --test`) |
| `build.py` | validate, test, package the release ZIP deterministically, write hashes |
| `build-src.py` | package the supporting-source archive deterministically |

## Build and test

```sh
node --test tests/*.test.js     # unit tests
python3 icons/make-icons.py     # regenerate PNGs (run inside icons/)
python3 build.py                # validate, test, package release ZIP, hash
python3 build-src.py            # package the supporting-source archive
addons-linter unread-badge-for-gmail-<version>.zip
```

`build.py` packages only the ten runtime files listed in its `RUNTIME_FILES`
constant. Tests, build tooling, icon sources and documentation ship separately
as the supporting-source archive.

### Verifying the checksums

`build.py` **overwrites** `SHA256SUMS.txt` as its last step, so "build, then
check against `SHA256SUMS.txt`" compares the file with itself and proves
nothing. Preserve a reference copy *before* building:

```sh
cp SHA256SUMS.txt /tmp/unread-badge-expected-sums.txt   # before build.py
python3 build.py
cmp /tmp/unread-badge-expected-sums.txt SHA256SUMS.txt  # rebuild reproduced it
sha256sum -c /tmp/unread-badge-expected-sums.txt        # files match the list
```

The first command must run before `build.py` rewrites the file.

`SHA256SUMS.txt` holds eleven entries: the release ZIP and the ten runtime
files.

* The **ten runtime-file entries** can be verified immediately after extracting
  the source archive, with no build:
  `grep -v '\.zip$' SHA256SUMS.txt | sha256sum -c -`.
* The **release-ZIP entry** is not verifiable at that point, because the source
  archive deliberately does not contain the ZIP. It becomes verifiable only
  after running `build.py`, or after placing the separately supplied release ZIP
  beside these files. A bare `sha256sum -c SHA256SUMS.txt` on a freshly
  extracted source tree therefore reports one missing file, and that is
  expected rather than a failure.
* The **supporting-source archive is reproducible as of pass 7**, because the
  procedure that constructs it is now included: `build-src.py`. Given
  byte-identical inputs it emits a byte-identical archive, and it builds twice
  on every run and fails if the two disagree. The method was validated against
  the pass-6 tree, which it reproduces byte for byte
  (`ad4c07a24cd2e0271e4f5cd09270e5ed0f2c783e9bc7a5a8cc4e80d9feeb9399`). As with
  `build.py`, this does not make the *inputs* reproducible — see the Pillow
  note above.

The ZIP is built with fixed timestamps, fixed file modes and `ZIP_STORED`, so
repeated builds from identical inputs produce identical bytes; `build.py`
builds twice and fails if the two hashes differ. That covers the packaging
step only. Icon PNGs are Pillow-version-dependent, so reproducing a published
hash from a clean checkout means either using the committed PNGs or matching
the Pillow version recorded in `PUBLISHING.md`.

## Settings

* **Account index** — the number in your Gmail URL (`/mail/u/0/`). Comma
  separate up to five to total several mailboxes. Duplicates are rejected:
  `0,0` and `0,00` name one mailbox and would double its count.
* **Label** — empty for the inbox, or a label name.
* **Check every** — 1 to 120 minutes.
* **Reuse an open Gmail tab** — focus an existing tab instead of opening one.
  Without the host permission tab URLs are not visible, so this falls through
  to opening a new tab.

## Badge states

| Badge | Meaning |
| --- | --- |
| number | unread count (`999+`, `9k+` above those thresholds) |
| empty | zero unread |
| `!` | host permission not granted, or revoked — click to grant |
| `?` | not signed in, or Gmail unreachable |
| amber number | some accounts unavailable; tooltip says whether the figure is a partial sum or the last known total |

The badge is not restored from storage on restart; startup performs a fresh
check.

## Licence

MIT. See `LICENSE`.
