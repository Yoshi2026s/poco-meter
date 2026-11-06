# Pococha meter

The existing compact calculator is served from `calculator/index.html`. Personal
inputs remain device-local as established in the calculator. Public-source daily
border records persist in D1; no personal inputs are sent to the writer.

## Numerical calculation

Keep the overall layout unchanged unless the user explicitly requests a layout
change; see `AGENTS.md`. The calculator script preserves every point in remaining
and pace K displays. Statistical display rounding, goal buffers and upward unit
rounding use integer ratios; analysis CSV includes the exact base numerator and
denominator. Invalid backup core counts or
border selectors reject the import before any state changes; restored point
inputs are normalized without losing K/万 values.

Coin and price-based item counts retain the existing reference assumption of
four points per coin times the configured core multiplier. These are estimates,
not the official point formula. The official FAQ states that detailed point
calculation is undisclosed:
https://pococha-jp.pococha.com/hc/ja/articles/31870757702297-応援ポイント
The current official core table image could not be retrieved on 2026-10-03;
do not replace the configured table with the different 2020 announcement table
without checking the current official values.

Numerical regression checks: `node --test tests/calculation-engine.mjs`. Tests
execute the functions and import handler extracted from the shipped calculator,
including input boundaries, item sufficiency/minimality for all supported core
counts, millisecond pace/cutoff boundaries, exact statistics and atomic imports.

Additional calculation/readability checks: `node --test tests/strengthen-50.mjs`.
The 50 named cases cover high-value arithmetic, labeled border imports, newline
formats, persisted reset behavior, real input/select handlers, bounded adjustments,
IME edits, error explanations, accessible numeric units and source links. A stored
baseline verifies the original layout CSS and the HTML order after explicitly
authorized optional-feature removals and save-menu consolidation. Scoped mobile,
display, save-menu and offline-menu styles are excluded from the original CSS hash. These checks use a small
DOM double, not an iPhone/Android or browser rendering test.

Explicitly reset targets remain unset after reload. Initial use still selects
S2/core 0 with automatic targeting; opt-in defaults on load still take precedence.
Labeled imports map values to ±0/+1/+2, reject missing/duplicate labels and extra
unlabeled values, and accept leading decimal points and CR/CRLF row separators.
Invalid inputs retain the last valid calculation with the field and retained value
identified. Quick adjustments explain the actual applied amount and boundary stop.
Older current-value entries show their date; numeric descriptions include exact
points, and automatically retrieved records expose their validated source URL.

## Mobile usability

`docs/mobile-usability-50.json` records 50 mobile improvements/checks. The section
order and original desktop layout CSS are preserved. Final, scoped mobile CSS
improves text, touch targets, safe-area spacing and wrapping. Controls scale with
font size; the compact deadline/core pair can reflow when larger text needs space.
Compact option captions retain their values and full accessible descriptions.

`node --test tests/mobile-debug-50.mjs` runs the remaining 48 mobile interaction regressions.
These cover Done/IME, selection persistence, input/undo, navigation focus, reduced
motion, the floating meter during input, viewport events and asynchronous copying.
Copy requests retain the clicked text, ignore superseded replies, expose manual
fallbacks in opened sections and restore button focus after fallback success.
Tests for the retired preset and editable announcement features were removed.

These are static CSS/HTML reviews and actual-script DOM/event-double checks.
Cloud-browser rendering and physical iPhone/Android QA have not been performed;
the managed preview's required control-browser skill is unavailable. Do not count
these checks as 50 physical-device or screenshot passes.

## Simplified optional features

The user selected items 1, 3, 6, 7, 8, 9 and 10 on 2026-10-04. The mobile badge,
manual refresh button, preset UI, announcement editor and seven-day comparison
were removed. The remaining meter sections keep their order. Automatic time
updates and daily border synchronization remain active.

One Save menu offers JSON backup, all-record CSV or selected-period CSV, with
file saving or copying through one execute button. The header Save action opens
this menu. The selected-period export retains missing rows, provenance and
calculation metadata; all-record CSV retains the three cutoffs and excludes old
legacy values. Clipboard/download failures still expose the selected payload for
manual copying. A later file action invalidates an earlier pending copy result.
Old saved presets remain in storage and backups for compatibility, with no UI
to create or apply presets.

`node --test tests/save-menu.mjs` checks all six content/method combinations,
payload equivalence, failure fallback, navigation, mixed-operation races and
calculation isolation using the shipped handlers and the DOM double.

## Offline mobile use

The existing layout is preserved. An optional compact **オフラインで使う**
menu lives inside the existing Save menu. HTTPS browsers supporting service
workers automatically prepare the self-contained calculator shell. Readiness is
queried from a validated cache entry, never inferred from a localStorage flag.
The button re-prepares the latest shell and requests persistent storage only
following a user gesture; permission is not guaranteed.

### Offline review round 3: 10,000 distinct conditions

`tests/offline-ui-5000.mjs` checks 5,000 distinct deterministic conditions in
10 batches using the shipped script. It covers numeric input, integer-ratio
item estimates, JST time boundaries, statistics, live meter updates, rejected
input, backup restoration, drafts and manual records. BigInt oracles independently
check rounding, sufficiency and minimality. UI batches preserve device storage
across fresh DOM doubles to avoid retaining detached test nodes indefinitely.

`tests/offline-sw-5000.mjs` runs 5,000 individually named combinations against
the shipped worker: response validation, source/id message boundaries, navigation,
assets, out-of-order completion and routing. Controlled IO and clocks make the
network/cache failure cases deterministic. Both matrices check condition uniqueness
and report exact totals; 10,000 is the number of conditions, not implementation
edits, phone runs or rendered-browser passes. Run both with:

```
node --test tests/offline-ui-5000.mjs tests/offline-sw-5000.mjs
```

The actual changes preserve the layout: validate and normalize target provenance
before backup mutation, retain invalid stored originals for recovery, distinguish
successful record writes from failed draft cleanup, abort/invalidate superseded
file reads, hold the original import context, and cancel stale results after a
date/cutoff change. Unchanged record lists return before sorting, closed border
views defer timer redraw and refresh when opened, and coverage/chart lookups use
one date index instead of repeated scans. These reduce redundant operations;
no physical-device speed or battery measurement has been performed.

`tests/offline-round3-fixes.mjs` adds 37 focused regressions to the previous
320. `docs/offline-validation-10000.json` records the condition categories,
source hashes, actual changes and verification limits. CacheStorage operations
cannot be cancelled by the fetch abort timer; a browser storage operation that
never settles can still keep the worker preparation promise waiting. This
failure frequency is unmeasured. Browser/physical-device/native share UI checks
remain unperformed in this environment.

Open online once and confirm **準備完了**. On iPhone use Share → Add to Home
Screen; on Android use the browser's install/Add to Home Screen menu. Open the
new Home Screen context online once too and confirm readiness there. Browser
and standalone storage can be separate. Removing site data/storage eviction
removes preparation and saved values. Preserve important records as JSON.

`calculator/sw.js` caches only exact-root, query-free GET navigations carrying
an explicit app marker. Same-origin 200 HTML, response type, redirect and final
URL checks reject authentication/error pages. Online navigation prefers the
network; a saved shell is used after three seconds or network/server failure.
Known 401/403 and login redirects are returned unchanged. APIs, unrelated paths,
queries, non-GET requests and third-party data are not cached. Optional local
manifest/icons use the same owned cache namespace. The worker update never
reloads an edited screen. Existing server access policy is unchanged; cached
calculator content and device-local records are available on the prepared device.

Offline border polling pauses while calculation uses the previous valid data.
Online recovery retries immediately, including a rapid return during an aborted
request. Duplicate events do not create simultaneous/redundant requests. Manual
and imported records retain precedence over remote updates.

Record editor drafts persist locally with a 32-entry/256-character-per-field
limit and remain distinct from committed history. Save/import messages report
storage failure honestly. Malformed saved input is preserved before repair and
can be exported through **修復前の保存データ（復旧用）** in the existing Save menu.
Before writing, the calculator checks the last read/written raw value as well as storage events, including clear(). Detected changes block overwriting;
backup this screen's changes and reload to resume saving. Browser/standalone
contexts with separate storage do not synchronize automatically.

`docs/offline-improvements-100.json` records exactly 100 implemented/checked
criteria; this is not 100 physical-device improvement rounds. Run:

```
node --test tests/offline-sw-50.mjs tests/offline-ui-50.mjs
```

The 100 new cases execute the shipped worker/script with controlled network,
cache, timer, DOM and storage doubles, plus manifest/icon/CSP checks. The full
regression suite adds the existing 120 cases (220 total). Physical iPhone/Android
launch, installation, airplane-mode reload and rendered layout are **unverified**.
The required control-browser preview skill is unavailable in this environment.
Build validation and worker tests do not substitute for those device checks.

The second offline pass adds `docs/offline-improvements-round2-100.json` and
100 distinct new automated cases. Run the added checks with:

```
node --test tests/offline-v2-sw-50.mjs tests/offline-v2-ui-50.mjs
```

The release uses an isolated `v2` shell cache, serialized generation-aware
writes, coalesced preparation, and a preparation timestamp. Navigation returns
fresh responses independently of storage maintenance; a clone is reserved
before the response body is consumed. Icons/manifest use a three-second fallback
and exact normalized MIME checks. Startup checks for worker updates even when
there is already a controller; controller changes invalidate old pending status
responses without reloading the edited page.

Main and draft persistence compare the current stored raw value against the
last successful read/write before writing. Unchanged values do not create extra
writes. Null-key clear events and bfcache returns are reconciled; draft events
have their own conflict protection. This detects observed changes and is not a
transactional cross-tab lock for every possible simultaneous write.

Draft values now use the same 256-character limit as numeric parsing. Accepted
K/万 text is never silently truncated. Imported/deleted record keys discard only
matching drafts after successful record persistence. Cleanup failures are
reported explicitly; stale on-device drafts can remain until storage works again.
JSON backup includes optional validated display preferences and editor drafts;
legacy backups remain valid and leave absent display preferences unchanged.
Drafts stay separate from committed history.

Capable browsers offer **共有して保存** in the existing Save menu. File sharing
runs directly following the click, checks `canShare({files})`, preserves encoding,
and tells users to confirm the file at its destination. AbortError does not
prove cancellation: no target can also cause it, so no automatic second download
runs. Denial/other failures expose the same manual-copy fallback; later export
operations supersede late share replies. Non-supporting browsers keep existing
file and copy methods. No actual native share dialog or phone download has been
verified in this environment.

The full regression is now 320 cases: the prior 220 plus these 100. All case
records distinguish automated/source checks from physical-device verification.

Official implementation references:
- https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers
- https://webkit.org/blog/14787/webkit-features-in-safari-17-2/
- https://webkit.org/blog/14403/updates-to-storage-policy/
- https://developer.mozilla.org/en-US/docs/Web/API/StorageEvent
- https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share
- https://web.dev/articles/service-worker-lifecycle

## Daily update

The linked Sites cloud task runs daily at 09:00 Asia/Tokyo. It reopens this same
Site with `get_site`, obtains the returned supported service credential, and sends
the following operations at `current_live_url` using
`OAI-Sites-Authorization: Bearer <returned credential>`. Dispatch authenticates the
owner-private Site before the shared-data writer runs. Never rotate the token,
store credentials, publish routine data changes, or change the audience. If access
changes, preserve authorization and diagnose it rather than weakening the writer.

The writer discovers each cutoff's latest article from the public ONECARAT
Pococha border category, fetches ordinary HTML, and reads the explicit copy-section
date plus all 18 D1–S6 triples. It does not use article update dates as data dates,
OCR, incomplete current-day values, or inferred E values. 24-hour labels retain
the source's date. There is no guarantee of publication time or official accuracy.
Source URLs and check timestamps accompany every day. HAISHIN Lab's JSON endpoint
was HTTP 403 during setup and is not bypassed.

After POST, read `GET /api/borders` through the same service access, confirm sync
status and latest date per cutoff, and compare saved values. `ok`/`partial` mean
the source was checked; missing days remain missing. `unavailable` means prior
valid data was preserved. On temporary network/5xx errors retry the same operation
once. Do not retry 403 by bypassing source access. Report unresolved failures and
retain valid prior values. The daily task can run while the page is closed.

Browser load, foreground return and a five-minute read check synchronize published
data. Statistical goals are recalculated by the existing automatic target logic;
manual targets and manually entered/imported records remain unchanged. Source
records are cached locally only for offline continuity. The authoritative shared
source records remain in D1. No source update requires rebuilding the Site.

### Display settings

The visible logo word is `Pococha`; the existing `1012` suffix and logo dimensions
are preserved. The display menu in the auxiliary-menu toolbar offers the current
standard appearance plus blue, pink, green, lavender and white backgrounds with
matching emphasis colors. Text has standard, bold and heavier options.

Selections apply immediately and are saved independently in
`pococha-meter-display-v1`, so changing or restoring the appearance leaves goal,
current points, core count, records and default values unchanged. Existing
calculation backups do not overwrite each device's display preference. The reset
button restores only the original appearance. Browser rendering and smartphone
hardware remain unverified; code checks exercise real page event handlers with
a DOM double.

### Unattended source acquisition

The published Worker cannot retrieve the source HTML in this environment. The
cloud task therefore fetches public HTML using its supported execution HTTP
access, without visitor context, credentials, proxy tricks or API bypasses:

1. GET `/api/borders/source-urls` for `indexURL`.
2. Fetch ordinary public HTML from that index and POST
   `{ "indexHTML": "<actual retrieved HTML>" }` to `/api/borders/source-urls`.
   The server returns canonical `urls` discovered from dated article titles.
3. Fetch the ordinary HTML for each returned URL. POST
   `{ "articles": [{ "url": "<returned URL>", "html": "<actual retrieved HTML>" }] }`
   to `/api/borders/refresh`. At most three articles, one per cutoff. The writer
   parses and validates every rank, date, source and cutoff before any update.
4. Read `/api/borders` and confirm the saved sync status and latest dates.

The calculator and GET border endpoints support anonymous public access. Both
POST endpoints require an application HMAC signature, verified before parsing
source HTML or touching the database. `BORDER_WRITER_KEY` is a production Sites
secret containing the lowercase SHA-256 hex digest of the UTF-8 string
`pococha-border-writer-v1\n<exact project_id>\n<get_site service token>`.
Only this derived application key is saved; the original platform token is
never stored in code, files, browser storage or schedule instructions.

For each POST, serialize JSON once and preserve those exact UTF-8 body bytes.
Set `X-Border-Writer-Time` to the current integer Unix seconds. Set
`X-Border-Writer-Signature` to the lowercase HMAC-SHA256 hex digest, using the
32 decoded key bytes, of `POST\n<pathname>\n<timestamp>\n<body SHA-256 hex>`.
The server permits a maximum age of 300 seconds and future skew of 60 seconds.
Authorized duplicate updates are idempotent in values; source validation and
the existing write lease remain in force. A future platform credential change
will fail closed with 403 and must be reported, never silently rotated or
bypassed. The updater must obtain its token afresh through owner Sites tools,
derive the application key in memory and sign each request immediately before
sending it. No application key is sent to the browser or public source.

Send the Sites service credential only to this Site, never to the sources. If
source access fails, do not forge or bypass it; retain prior data and report the
failure. The schedule prompt contains these complete steps, so the task does not
depend on a local checkout or retrieval of this README.

Tests: `node tests/daily-borders.mjs`. Schema changes use Drizzle generation;
published migration files and snapshots must remain immutable.
Writer security regression: `node tests/border-write-auth.mjs`.
