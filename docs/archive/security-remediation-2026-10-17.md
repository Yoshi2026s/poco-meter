# Security follow-up: v2026.10.17.1

Base: v2026.10.14.7, source commit 6aad0bdc5c930dbe83c0644ae57ad122a2abd8bb.

## Changes

- F09: CSV/paste imports preflight the merged number of unique dates per cutoff at preview and commit. A batch introducing dates beyond 5,000 is rejected before any record, draft, revision or storage change. Legacy oversized logs are preserved and existing dates remain editable. Manual/automatic writes and loading legacy oversized state remain outside this bound.
- F14: JPEG/WebP EXIF is rebuilt with only orientation/color-space rendering fields. JPEG comments, Photoshop/IPTC resources and thumbnails, plus WebP XMP/unknown chunks, are removed before storage. ICC and JPEG XMP/unknown APP extensions are retained for rendering compatibility, so this is partial metadata minimization, not complete anonymization. Existing stored images are unchanged. Raw-image retry hashes preserve pre-update idempotency. Production full pixel decoding/re-encoding remains outside this change (F05).
- F03: Non-admin attachment GET/HEAD now claims the existing contactRead IP/global quota before contact-message lookup and R2 access. Admin authorization and owner isolation remain unchanged.
- F22: Security counters no longer rely on a request landing on second zero for cleanup. The first request per DB and subsequent requests at least one minute apart trigger a single concurrent cleanup attempt. Only counters expired for more than one hour are removed. Cleanup failure does not bypass quotas or signature replay protection. No user records or images are deleted.

The previous 21-item audit remains 8 addressed / 7 partial / 6 unfinished; adding addressed F22 gives 9 / 7 / 6. These are implementation states, not a guarantee of complete attack coverage.

## Validation

- Dedicated import tests: 8; security-counter tests: 4; image metadata and contact-image tests: 25. The image tests decode actual JPEG (including P3 ICC) and WebP at orientations 1, 6 and 8 with Sharp and compare dimensions and every pixel.
- Related regression run: 85 tests, initially 84 passed and one CSP hash check failed while the main inline script seal was stale. Resealed the final source; the four security/export checks then passed. Contact/image/security group: 35 passed. Excluding the three shared security checks, these runs cover 117 distinct passing final checks.
- Import-related offline regression groups: 37 and 50 passed. The older strengthen-50 group has 9 failures reproduced identically on the unchanged base; it is not claimed green. One mean-specific precision test now explicitly selects mean, preserving the product default p75.
- Dependency audit: production 0 warnings; complete audit 1 high braces advisory (GHSA-vfj7-8cjw-p6xm), with the existing project length/depth guard retained. No dependencies changed in this follow-up.
- Final Vinext build and isolated built-Worker contact/admin integration checks passed.
- Browser QA was not completed: after correcting the missing local managed profile, preview started, but the browser rejected access to its existing error tab under URL security policy. No policy workaround was attempted. Physical-phone behavior is unverified.

## Remaining work

Full-history response size, complete image decoding, legacy client-state bounds, GitHub framing/origin isolation, long-term data retention and total storage limits, orphan reconciliation, origin-bound update signatures, runtime stable admin-ID configuration, contact session expiry/revocation, and independent border-source verification remain as recorded in the private audit. No actual attack or leaked user data was established by this work.
