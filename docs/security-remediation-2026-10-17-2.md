# Security follow-up: v2026.10.17.2

Base: v2026.10.17.1, source a5853dd638423ca3f4ba3312ff82d60559b3d93d.

## Implemented

- F20: D1 stores only the SHA-256 token hash, creation/expiry timestamps and revocation state. New sessions have a fixed 31,536,000-second lifetime. Reads never renew expiry. Legacy cookies are adopted only when they already own a thread, with expiry fixed to the earliest known thread creation plus that lifetime; the original cookie issue time cannot be recovered. Unknown tokens cannot create chosen sessions by POST.
- The owner inbox has an explicit confirmation button for POST /api/admin/contact/session. Existing owner authentication, exact same-origin JSON and an 8 KB/30-second body limit apply. Revocation covers every thread of the same browser capability and is idempotent. Records and images remain available to the owner. Fresh sessions may create new inquiries; this is not a device ban.
- Expired/revoked tokens return 401 and a clearing cookie before access. Reads recheck after awaited DB/R2 operations. Visitor SQL writes include active-session conditions using database execution time as well as the request time, preventing queued work after expiry or revocation. Permanent tombstones and non-overwriting legacy adoption prevent token resurrection. The UI clears stale displayed history and session state while preserving unsent text/images; reopening creates a new session without automatically sending.
- New-session issuance and legacy adoption have an additional IP/global quota before persistent writes: per IP 30/hour and 100/day, global 1,000/hour and 5,000/day. Existing valid-session reads do not consume issuance quota. This reduces growth but does not impose an overall storage cap.
- F03: A 15-second in-process public border snapshot now includes serialized JSON and a weak SHA-256 ETag. Unchanged conditional requests return 304. Every request still claims the existing quota. Responses revalidate, vary by Origin, and retain only the exact GitHub CORS allowance. Refresh and JST day rollover invalidate the snapshot. Internal callers receive clones so they cannot mutate shared content. Calculator/history public fetches now use no-cache; private requests remain no-store.
- Additive migration 0007_contact_sessions; service-worker shell cache v57. No existing records, images or calculation data are removed. No real visitor session was revoked during this maintenance.

## Validation

- 133 related regression tests passed: dedicated sessions 16 and ETag/cache 7, plus contact/image/client, security, calculation, import and history checks. The delayed-D1 expiry race was reproduced independently and fixed before this run.
- Vinext build passed. Built-Worker integrations with isolated D1/R2 passed for owner/visitor isolation, migration, same-origin revocation, private image access, idempotency, retained owner history and unaffected other visitors. Owner statistics integration also passed.
- Current offline service-worker tests passed 50/50, and offline-v2 UI tests passed 50/50. Four legacy offline-v2 service-worker assertions fail identically on the unchanged base because that harness expects five assets instead of the current six including border history. Do not treat all historical suites as green. Dependencies did not change; no fresh dependency-audit claim is made.
- Production inquiry bodies/images are not read for verification. Browser/physical-phone interaction has not been verified in this continuation; deterministic client tests and the public artifact checks are separate evidence.

## Remaining

F20 is partial: rotation, authenticated history recovery/migration to a replacement capability and safe session-record cleanup are not implemented. A stolen active token works until expiry or owner revocation; already downloaded content cannot be recalled. F03 is partial: initial/changed full-history payloads and quota DB work remain. F13 total storage/retention and F15 orphan reconciliation need inventory and conservative capacity/reservation design. Other outstanding items remain in the audit. Status totals: 9 addressed, 8 partial, 5 unfinished across 22 recorded findings; not a guarantee of exhaustive security.

References: OWASP Session Management Cheat Sheet; MDN HTTP ETag. Implementation and isolated tests are the evidence for this change.
