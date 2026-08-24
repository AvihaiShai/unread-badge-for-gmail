# AMO listing copy — Unread Badge for Gmail™ 1.0.1

Paste-ready text for the AMO submission form. Wording here must match
`PRIVACY.md` and `README.md`; if one changes, change all three.

## Name

Unread Badge for Gmail™

## Summary (250 char limit)

Shows your unread Gmail count on the Firefox toolbar. No popup, no sign-in of
its own — it uses the Gmail session you already have. Click to open Gmail. Not
affiliated with Google.

## Description

**A number on your toolbar. That's it.**

Unread Badge for Gmail puts your unread inbox count on the Firefox toolbar and
opens Gmail when you click it. There's no popup, no separate sign-in, and no
account linking — it uses the Gmail session your browser already has.

**No unread checking until you allow it**

Access to mail.google.com is optional and is not granted when you install. A
fresh install shows `!` on the badge and checks nothing. The first time you
click the button, Firefox asks whether to allow access. Allow it and the count
starts appearing. Decline or dismiss and no unread check ever runs — but the
click still opens Gmail in a tab, because that is what the button is for, and
loading that page is ordinary browser traffic to Google either way. You can
revoke access at any time in about:addons, and grant it again later by clicking
the button.

**How it works**

Once you've granted access, the extension requests Gmail's Atom feed on a
timer and reads the unread count from it. The extension never accesses your
cookie values, but because the request is credentialed, Firefox attaches and
transmits your existing Gmail session cookies to Google with it. It uses the
same signed-in session your Gmail tab uses, though it isn't the same request.
It goes nowhere else.

The extension stops reading the response as soon as it has the count. It
searches raw bytes for the closing tag, decodes at most 512 bytes to read the
number, then stops consuming the response and asks for the stream to be
cancelled. Senders, subjects and message snippets are never decoded, stored,
displayed or sent anywhere.

Because the response arrives in chunks whose boundaries the extension can't
control, a chunk carrying message bytes after the count may reach the extension
and be held briefly in a temporary byte array. Those bytes are not decoded into
text, parsed as messages, saved, shown, or sent on; they are released for
garbage collection. Cancelling can't recall bytes already delivered or already
in flight.

**The developer receives nothing.** No analytics, no telemetry, no server, no
ads. Your settings, the outcome of the last check, and the last complete unread
total stay in Firefox's local storage on your computer and go nowhere else.
That last total is kept so a temporarily unreachable mailbox doesn't make the
badge drop to a misleadingly low number. It is not used to draw the badge after
a restart: on startup the extension runs a fresh check.

**Options**

• One mailbox or up to five, totalled (the number in your /mail/u/0/ URL)
• Any label, or the inbox
• Check every 1–120 minutes
• Reuse an open Gmail tab, or always open a new one

**Requirements**

Firefox desktop 140 or later. Firefox for Android is not supported.

*Not affiliated with, endorsed by, or sponsored by Google. Gmail is a
trademark of Google LLC. This extension is an independent project and its
icon is an original design, not a Google mark.*

## Categories

Primary: Search Tools. Secondary: Privacy & Security.

## Tags

gmail, email, unread, badge, toolbar, notifier

## Permission justifications (reviewer-facing)

**`https://mail.google.com/*` (optional_host_permissions)** — Required to
request the Atom feed with the user's existing session. Declared as an optional
host permission, so it is not granted at install. It is requested by
`permissions.request()` called synchronously in the `action.onClicked` handler,
before any `await`.

Stated precisely, because the weaker form of this claim has been wrong here
before: **no Gmail Atom-feed request and no background unread check occurs
without the host permission.** That is what `tests/background.test.js` asserts —
zero `fetch` entries. It is not a claim that the extension causes no traffic to
Google, because `handleClick()` calls `openGmail()` unconditionally: on grant,
on denial, on dismissal and on a failed `permissions.request()`, the click
creates or focuses a Gmail tab, and that page navigation is ordinary browser
traffic. The same test asserts that too — exactly one `tabs.create` on the
denial path — so the two facts are recorded separately rather than one standing
in for the other.

**`alarms`** — Schedules the periodic check on an event page. A DOM timer would
not survive suspension.

**`storage`** — Settings, the outcome and time of the last check, and `lastGood`:
the last **complete** unread total, stored together with the account/label
configuration it was gathered under, so a temporarily unreachable mailbox does
not make the badge drop to a misleadingly low number. So the last complete total
*is* persisted. What is not persisted is a separate per-check count: the
`lastCount` key of earlier builds was written and never read, is no longer
written, and is deleted on update. The badge is not drawn from storage at
startup; startup performs a new check.

## Notes to reviewer

* The extension declares `websiteContent` in the **required** data collection
  list because reading the Gmail response is essential to the advertised
  unread-badge function. Mozilla's taxonomy defines `websiteContent` broadly
  enough to include website text, cookies, and request/response information.
  `authenticationInfo` is not additionally declared because the extension
  never obtains or reads credential values; Firefox attaches the existing
  cookies to the extension-initiated request. `personalCommunications` is not
  additionally declared because the extension extracts only `<fullcount>` and
  never decodes, parses, stores, displays, or retransmits message content. The
  earlier classification questions and this decision are recorded in
  `MOZILLA-QUESTION.md` for review. Happy to adjust the declaration if AMO
  applies the taxonomy differently to this exact fact pattern.
* **Android.** The extension is desktop-only by choice: the toolbar-badge UI
  and the click-to-grant permission flow have not been tested on Firefox for
  Android, so it is not offered there. `gecko_android` is omitted, which is
  what causes AMO to default to not listing the extension for Android; that
  default is not being overridden. Omitting the key does not itself prevent
  Firefox for Android from loading the extension — it governs AMO
  distribution, not Gecko.
* `addons-linter 10.10.0` reports one warning,
  `KEY_FIREFOX_ANDROID_UNSUPPORTED_BY_MIN_VERSION`, because the desktop
  minimum is 140 while data-consent support on Android begins at 142. With
  `gecko_android` absent, the linter derives an Android floor from the desktop
  key. The warning is accepted as a consequence of the desktop-only
  configuration described above; raising the desktop minimum to 142 purely to
  silence it would exclude Firefox 140 and ESR 140 desktop users.
* The release ZIP is built by `build.py` with fixed timestamps and
  `ZIP_STORED`, so its SHA-256 can be reproduced from the same source tree.
  `SHA256SUMS.txt` in the source archive lists eleven entries: the ZIP hash and
  the hash of each of the ten runtime files. The ten runtime-file entries can be
  checked immediately after extracting the source archive; the ZIP entry cannot,
  because the source archive deliberately omits the ZIP, and it becomes
  checkable only after running `build.py` or placing the supplied release ZIP
  beside the files. Note also that `build.py` rewrites `SHA256SUMS.txt`, so a
  reference copy must be preserved before building — the procedure is in
  `README.md` and `PUBLISHING.md`. The supporting-source archive is built by
  `build-src.py` with the same pinning and is likewise reproducible from
  identical inputs.
* No minified, obfuscated, or bundled code. No remote code execution. Three
  source files, all readable. `parser.js` and `background.js` each end with a
  `typeof module === "object"` block that exports internals to the Node test
  runner; it is inert in the browser, where `module` does not exist.
