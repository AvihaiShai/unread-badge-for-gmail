# Data-collection classification decision and retained Mozilla question

Status: **resolved for submission from Mozilla's published taxonomy.** The
question below is retained as reviewer context and may still be posted, but it
is not a submission blocker. The shipped declaration remains
`required: ["websiteContent"]` for the reasons recorded in the decision log.

The manifest below is what the extension currently ships. It uses
`optional_host_permissions`, so the Gmail origin is not granted at install and
**no Atom-feed request or background unread check occurs** until the user
clicks the toolbar button and accepts the prompt. It is not the case that the
click sends nothing to Google when the prompt is refused: the button opens
Gmail in a tab on grant, denial and dismissal alike, and that page navigation
is ordinary browser traffic. The post below says so explicitly, because a
question that overstates the extension's restraint would get an answer to the
wrong question. The declaration remains `required: ["websiteContent"]`; it has
not been moved to `optional` merely because the separate host permission is
requested later.

---

**Subject: `websiteContent` under `required` or `optional` when the host
permission itself is optional and requested on first click?**

I'm preparing an MV3 extension for AMO and want the built-in data consent
declaration right before I submit rather than after a reviewer corrects me.

**What it does.** It shows the number of unread Gmail messages on the toolbar
badge. There is no popup and no message list — the entire user-visible output
is an integer.

**Permission shape.** The Gmail origin is optional, not install-time:

```json
"permissions": ["alarms", "storage"],
"optional_host_permissions": ["https://mail.google.com/*"],
"browser_specific_settings": {
  "gecko": {
    "data_collection_permissions": { "required": ["websiteContent"] }
  }
}
```

On a fresh install the badge shows `!` and no feed request is made. The first
toolbar click calls `permissions.request({ origins: ["https://mail.google.com/*"] })`
synchronously inside the click handler. Only after the user accepts does the
extension fetch `https://mail.google.com/mail/u/<n>/feed/atom` with
`credentials: "include"`, read the integer in `<fullcount>`, and write it on
the badge. If the user declines, or later revokes in about:addons, the badge
returns to `!` and no further feed requests are made.

**One thing I want to be precise about, because it affects what "before the
grant" means.** The toolbar button has a second job: it opens Gmail. That
happens unconditionally — on grant, on denial, on dismissal, and if the
permission request itself fails — because a mail button that does nothing when
you decline a prompt would be broken. So denying the permission stops the
Atom-feed read and the background polling; it does not stop the click from
navigating a tab to `mail.google.com`, with whatever cookies the browser
normally sends on a top-level navigation. That navigation is the browser
loading a page the user asked for, not the extension reading anything, but I
would rather state it than have a reviewer discover I had described the
extension as making no requests at all.

**How it reads the response.** The body is read as a stream. Incoming bytes are
searched for the closing `</fullcount>` tag by byte comparison; only the region
ending at that tag — at most 512 bytes — is passed to a `TextDecoder`. The
extension then stops consuming further chunks and requests cancellation of the
response body stream. A 64 KB hard cap applies if no count is found.

**The honest part, and I want to be exact about it because I think it bears on
questions 3 and 4.** It would be convenient to say the remaining bytes only
ever reach browser or network buffers. That is not accurate. Chunk boundaries
are arbitrary, and a `ReadableStream` chunk containing bytes after
`</fullcount>` **may be delivered to my extension's JavaScript** and briefly
held in a temporary byte array:

* `reader.read()` resolves with the entire chunk, in extension code;
* the scanner accepts that chunk;
* the chunk may be copied into a temporary `Uint8Array` *before* the code
  locates the closing tag — the tag search happens after the copy, so the
  suffix bytes are in extension memory at that moment.

So bytes of `<entry>` elements (senders, subjects, snippets) can be present in
extension memory, not merely in the browser's buffers.

What the extension then does with them is nothing. They are not decoded into
text, not parsed as message data, not persisted, not displayed, and not
retransmitted. Only the region ending at the closing tag reaches the
`TextDecoder`. Once the call returns, the temporary array is unreachable and is
left for garbage collection. Requesting cancellation stops the extension
consuming more; it cannot recall bytes already delivered or already in flight.

**Where the data goes.** The request and the session metadata that accompanies
it go only to Google. Nothing is sent to the developer, to analytics providers,
to advertisers, or to any developer-operated server. There is no such server.

**My questions.**

1. Gmail access is the extension's core functionality, but the host permission
   is granted only after a user gesture, and no feed read can occur before that
   grant. Should `websiteContent` be declared under **required** or under
   **optional** data collection in this shape? Required matches "the extension
   cannot function without it"; optional matches "nothing is collected until
   the user opts in at runtime". I currently declare it as required. Does the
   fact that the click opens a Gmail tab regardless of the answer bear on this
   at all, or is a tab navigation simply outside the scope of what these
   declarations describe?

2. If it should be optional: must the click request the Gmail origin and
   `data_collection: ["websiteContent"]` **in the same
   `permissions.request()` call during the same user gesture**, i.e.

   ```js
   browser.permissions.request({
     origins: ["https://mail.google.com/*"],
     data_collection: ["websiteContent"]
   });
   ```

   — or may they be requested separately? If they must be combined, is a
   single prompt shown, and does a partial grant need handling?

3. Does `personalCommunications` **additionally** apply here? The taxonomy
   gives emails as the direct example, and the endpoint's response is an email
   feed, but the only field the extension uses is `<fullcount>`. Is the
   classification driven by what the requested resource contains, or by what
   the extension actually reads out of it?

4. Do the delivered-but-undecoded bytes described above affect the
   classification at all? To be clear about the fact I think matters: they are
   not merely in the browser's buffers — a chunk containing them is handed to
   my extension's JavaScript and may be briefly held in a temporary byte array
   in extension memory. They are never decoded into text, parsed as message
   data, persisted, displayed or retransmitted, and the array is unreachable
   once the call returns. Does "collection" turn on delivery into extension
   memory, on decoding, or on retention and use? If delivery alone is enough,
   I assume that changes the answer to question 3, since the undecoded bytes
   are message content even though the extension only reads `<fullcount>`.

5. Is the authenticated part of this fully covered by `websiteContent`, or does
   it additionally engage `authenticationInfo`? The request is credentialed
   (`credentials: "include"`). The extension code never accesses the cookie
   values — it has no `cookies` permission and never touches `document.cookie` —
   but its credentialed fetch is what causes Firefox to attach and transmit the
   user's existing Gmail session cookies to Google. I state it that way rather
   than "the browser attaches them" because the extension initiates the request
   that causes the transmission, and I do not want to imply the extension is a
   bystander to it. Reading the taxonomy, `websiteContent` expressly
   extends to embedded material including cookies and request and response
   information, while the `authenticationInfo` examples are credentials the
   user supplies — passwords, usernames, PINs, security questions,
   registration data for account-based services. That reading says
   `websiteContent` alone, but "the extension causes a credentialed request"
   and "the extension collects authentication information" feel close enough
   together that I do not want to decide it myself.

I'd rather over-declare than mislead, but I also don't want to request a
consent that misdescribes what the extension does.

Reference: https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/

---

## Answer log

No extension-specific Mozilla response was obtained. Submission does not claim
otherwise.

## Final decision

* Keep `websiteContent` in `required`: the Gmail response is necessary for the
  advertised unread-badge feature, even though the origin permission is
  requested later through a user gesture.
* Do not additionally declare `authenticationInfo`: the code never obtains or
  reads credential values, while Mozilla's `websiteContent` definition
  expressly covers cookies and request/response information.
* Do not additionally declare `personalCommunications`: the extension extracts
  only `<fullcount>` and never decodes, parses, uses, stores, displays, or
  retransmits senders, subjects, snippets, bodies, or other message content.
  Arbitrary chunking can place undecoded suffix bytes briefly in extension
  memory, and the public privacy notice states that fact explicitly.

This is a good-faith application of the published taxonomy. If AMO applies a
different classification to this exact response-streaming pattern, the
manifest and disclosures must be changed together in a new build.

## What we have and have not established ourselves

VERIFIED from the Extension Workshop page linked above:

* `websiteContent` is defined broadly enough to cover request and response
  information, and expressly includes cookies among the embedded material it
  covers. It is one of the types eligible for implicit consent.
* `personalCommunications` names emails as its direct example and is **not**
  eligible for implicit consent.
* `authenticationInfo` is illustrated by credentials the user supplies —
  passwords, usernames, PINs, security questions, and registration information
  for extensions offering account-based services — and is **not** eligible for
  implicit consent.
* Optional data types are requested with `permissions.request()` from a
  user-activated event handler, using a `data_collection` key.
* `addons-linter 10.10.0` accepts `optional_host_permissions` alongside
  `required: ["websiteContent"]` — 0 errors, 0 notices.

FACT-PATTERN AMBIGUITIES retained for reviewer visibility:

* Mozilla's documentation does not expressly say that an optional host
  permission obliges, permits or forbids moving the corresponding data type to
  the optional list. The final decision follows whether the data is essential
  to the advertised function, not the timing of the separate origin grant.
* The taxonomy does not expressly discuss a mail feed from which only an
  aggregate integer is extracted.
* Whether issuing a credentialed fetch — which causes Firefox to attach and
  transmit the user's Gmail session cookies, values the extension code never
  accesses — is fully covered by `websiteContent` or also engages
  `authenticationInfo`. The taxonomy's cookie clause under `websiteContent` and
  its user-supplied-credential examples under `authenticationInfo` point toward
  `websiteContent` alone. That is the basis of the shipped declaration, while
  the extension's responsibility for initiating the request remains fully
  disclosed.
* The taxonomy does not expressly define whether incidental delivery of
  undecoded suffix bytes into extension memory, without decoding, retention or
  use, independently engages `personalCommunications`.
