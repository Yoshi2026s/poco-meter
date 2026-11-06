# Reviewed historical border data

Source: ONECARAT public monthly Pococha border articles, fetched on 2026-10-06.
Scope: 2025-01-01 through published 2026-10-05 data; 13, 22 and 24 hour cutoffs.
66 article HTML documents and 558 actual PNG/JPEG tables were acquired. Article update timestamps are not data dates.

Table date labels and cutoff headers were read from the actual images. Numeric columns use detected table grid lines. Whole-column OCR readings were compared at multiple scales; ambiguous cells were independently read and manually reviewed where required. No missing or E-band values are inferred.

The evidence JSON records each source article/image URL, original-byte SHA-256, accepted date labels, and manual reviews. The data JSON contains only validated positive ascending triples for D1 through S6. Source copy-text rows are used only if every overlapping table value agrees; conflicting rows are excluded (including the October 2025 24-hour footer labelled October 30 whose values belong to October 31).

Production backfill merges only absent ranks and dates, preserving all existing production values and source URLs. Fresh daily-source validation is required before backfill runs. Upserts use batches of 100 rows through one bound JSON argument, keeping the initial archive import below the D1 free query limit. No schema migration or database reset is used.

Client storage pools repeated provenance metadata without dropping historical records or personal input. Old uncompressed device saves remain readable. Partial historical rows remain partial, including in offline calculations.

Verification: history-archive.mjs, history-storage.mjs, daily-borders.mjs (real SQLite, query budget, existing value preservation, failed-refresh preservation), border-write-auth.mjs, calculation-engine.mjs and border-reliability-regressions.mjs. Production is additionally read back and compared with every newly imported rank triple and the prior production snapshot.
