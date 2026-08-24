# Privacy Policy — Unread Badge for Gmail™

Last updated: 2026-08-23. Applies to version 1.0.0.

## Summary

The extension asks Gmail how many unread messages you have and puts that
number on your toolbar. The developer receives nothing: no account
identifiers, no message data, no usage statistics, no crash reports. There is
no developer-operated server, no analytics provider, and no advertising.

That is not the same as "nothing leaves the browser". The extension makes a
credentialed HTTPS request to Google. The extension code never accesses the
cookie values, but that credentialed fetch causes Firefox to attach and
transmit your existing Gmail session cookies to Google's servers. The request
uses the same authenticated session your Gmail tab uses; it is not the same
request or the same context as loading Gmail in a tab.

## What happens before you allow it

Access to `mail.google.com` is an **optional** permission. It is not granted
when you install the extension. Until you grant it, the badge shows `!` and the
extension performs no unread-count check: it makes no Gmail Atom-feed request,
to Google or to anyone else.

The first time you click the toolbar button, Firefox asks whether to allow
access to `mail.google.com`. Whatever you answer — allow, decline, or dismiss —
**the click opens Gmail in a tab**, because opening Gmail is what the button
does. Loading that page is ordinary browser traffic to Google, the same traffic
you would generate by typing the address yourself. The extension does not read
that page; it only asks the browser to open it.

If you allow access, the extension additionally begins checking your unread
count in the background. If you decline or dismiss, the badge stays `!` and no
Atom-feed check runs. You can revoke the permission at any time in
about:addons; the badge returns to `!` and background checking stops, while the
button continues to open Gmail.

## What is sent, and to whom

| Recipient | What they receive | Why |
| --- | --- | --- |
| Google (`mail.google.com`) | An HTTPS request for your Atom feed. Because the fetch is credentialed, Firefox attaches and transmits your existing Gmail session cookies with it, along with the request metadata any HTTPS request carries (IP address, user agent, timing) | It is the only way to obtain your unread count |
| Google (`mail.google.com`) | Whatever your browser sends when it loads the Gmail page in a tab you opened by clicking the button — this happens whether or not the permission is granted | Opening Gmail is what the button does |
| Anyone else | Nothing | — |

Once you have granted access, each check operation requests the feed once per
configured account. Checks are normally scheduled once per configured interval
(default: one minute). If another call to start a check reaches `check()` while
an operation is still in progress, it joins that operation instead of starting
another set of requests. Which caller reaches `check()`, and when, differs by
path:

* The scheduled alarm, the options page's "Check now" button, and the
  background script's own run when it loads call `check()` directly, without
  awaiting anything first.
* Browser startup, extension install or update, and toolbar clicks perform
  asynchronous work before their own direct call to `check()` — rescheduling
  the alarm, clearing obsolete storage, resolving the permission prompt, or
  opening the Gmail tab. An operation that was active when one of those events
  began can finish during that work, and the later call then starts a new
  operation and another set of requests.
* Granting access is handled synchronously. The permission-added listener
  invalidates the state a running check was based on and immediately requests
  a fresh one, which starts at once if no operation is active and is otherwise
  queued behind the active operation.

Granting access from the toolbar prompt therefore involves both of the last two
paths. The permission-added listener can start or queue a check while the click
is still opening the Gmail tab. The click's own later call joins that check if
it is still running, but starts another operation, and another set of requests,
if it has already finished.

Changing the configured accounts, the label, or the interval, or granting or
revoking access, invalidates any result being computed under the previous state
and aborts active feed requests. That invalidation is synchronous in every
case. The fresh check that follows is requested immediately when access is
granted; for a settings change or a revocation it is requested after the
extension has finished rescheduling the alarm, clearing the cached total, or
updating the badge. If the old operation is still active when that request is
made, one fresh check is queued after it, and repeated queue requests during
that same active operation are coalesced into that one; if no operation is
active, the fresh check starts at once. This can cause an additional set of
feed requests when the new state still permits feed access; after a revocation
it does not,
because the fresh check finds no permission and requests nothing.

The second row is not extension data collection in any meaningful sense — it is
a page load in a tab, indistinguishable from typing the address — but it is
listed because "clicking the button sends nothing to Google" would be false.

## What the extension does with the response

The response is processed entirely on your computer. The extension:

* searches incoming bytes for the closing `</fullcount>` tag by direct byte
  comparison, without building text;
* decodes at most 512 bytes — the region ending at that tag — and reads the
  integer;
* stops consuming further chunks and requests cancellation of the response body
  stream — cancellation cannot recall bytes already delivered or already in
  flight;
* accepts at most 64 KB in total if no count is found.

Message senders, subjects, snippets and identifiers are not decoded, parsed,
stored, displayed or retransmitted by the extension.

An honest caveat, stated precisely because a weaker version of it was wrong:
the response arrives in chunks whose boundaries the extension does not control,
and those bytes do not merely sit in a network buffer out of the extension's
reach. A ReadableStream chunk containing bytes after `</fullcount>` may be
delivered to extension code and briefly held in a temporary byte array — the
stream reader hands the whole chunk to the extension's JavaScript, and the
scanner may copy it into a temporary array before it locates the closing tag.

What the extension does with those suffix bytes is nothing. It does not decode
them into text, parse them as message data, persist them, display them, or
retransmit them. Only the region ending at the closing tag is ever passed to
the text decoder. When the call returns, the temporary array is unreachable and
is left for garbage collection. Cancelling the stream stops the extension
consuming more; it cannot recall bytes already delivered or already in flight.

## What is stored, and where

In Firefox's local extension storage on your computer, and nowhere else. This
is the complete list:

| Key | Contents |
| --- | --- |
| `accounts` | the account indices you configured, e.g. `0` or `0,1` |
| `label` | the label you configured, or empty for the inbox |
| `interval` | how often to check, in minutes |
| `reuseTab` | whether clicking focuses an existing Gmail tab |
| `status` | the outcome of the last check — one of `ok`, `partial`, `auth`, `error`, `permission` |
| `partialSource` | written alongside a `partial` status, recording whether the figure shown was a partial sum or the last complete total |
| `lastCheck` | when that outcome was recorded |
| `lastGood` | the last complete total together with the account/label configuration it was gathered under, so that a temporarily unreachable mailbox does not make the badge drop to a misleadingly low number |

`lastGood` is the only number kept between checks, and it exists for that one
purpose. It is discarded when you change the accounts or the label. It is not
used to restore the badge after a restart.

Earlier builds also wrote a `lastCount` key. Nothing read it, and it is no
longer written; it is deleted from existing profiles when the extension
updates.

**The badge is not restored from storage after a browser restart.** On
startup the extension performs a fresh check: if the permission is still
granted and Gmail is reachable, the badge shows the current count; if Gmail is
unreachable, it shows `?`; if the permission is missing or was revoked, it
shows `!`.

No synchronization, no export, no remote copy. Removing the extension removes
this storage.

## Permissions

| Permission | Type | Why |
| --- | --- | --- |
| `https://mail.google.com/*` | **optional** — requested on your first click, never at install | Needed to fetch the feed with your existing session. |
| `alarms` | required | The periodic check. |
| `storage` | required | The settings and status described above. |

## Data collection declaration

The manifest declares `websiteContent` under Firefox's built-in data consent,
in the `required` list. Mozilla's taxonomy defines website content broadly,
including website text, cookies, and request and response information. It is
`required` because reading the Gmail response is necessary for the advertised
unread-badge function. The separate Gmail host permission remains optional and
is requested only after a toolbar click; until it is granted, no feed is read.

`authenticationInfo` is not additionally declared because the extension does
not obtain or read a username, password, session-cookie value, PIN, security
answer, or other credential. Its credentialed fetch causes Firefox to attach
the existing Gmail cookies to the request, and Mozilla's taxonomy expressly
places cookies and request information within `websiteContent`.

`personalCommunications` is not additionally declared because the extension
does not decode, parse, use, persist, display, or retransmit senders, subjects,
snippets, message bodies, or other communications. It extracts only the unread
integer. As disclosed above, arbitrary response chunking can briefly place
undecoded suffix bytes in extension memory; those bytes are not treated as
message data and are immediately released. `MOZILLA-QUESTION.md` retains the
earlier classification questions and the final rationale for reviewer context.

## Children

The extension is not directed at children and has no age-gated features. The
developer does not receive identifying information about any user. This is not
a claim that no personal data is involved: your Gmail cookies are personal
data under Mozilla's definitions, and they are sent to Google as described
above.

## Changes and contact

Material changes to this policy will accompany a version update. Questions and
reports: https://github.com/AvihaiShai
