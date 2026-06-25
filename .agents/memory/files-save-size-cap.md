---
name: files/save size cap vs large generated outputs
description: Why /api/files/save needs a large body cap and must authorize before parsing
---

# /api/files/save and large generated outputs

Generated pipeline outputs in the App Storage bucket are legitimately large:
`testcases.json` / `coding_questions.json` reach **50–120 MB** (159 files >5 MB
observed). The READ path has no size cap, so big files load fine in the UI; any
size limit on the SAVE/upload path that is smaller than this silently breaks
"replace whole file" with a 413 that surfaces as a generic "Save failed".

**Rule:** any body/size cap on file routes must account for ~120 MB+ outputs.
The save cap is `FILE_SAVE_MAX_BYTES` (default 256 MB).

**Why:** the prior 5 MB cap rejected every large-output save on the live site.

**How to apply:** when adding/auditing caps on `src/app/api/files/*`, do not
assume small files. Also: **authorize before parsing** — `/api/files/save`
reads `problemId` from the *query string*, runs `assertSafeProblemId` +
`requireProblemAccess()` BEFORE `request.json()`, so a non-owner/unauthenticated
caller cannot force a 256 MB in-memory parse (DoS). All save callers must pass
`?problemId=` (not in the body). `putObject` uses resumable uploads for buffers
>8 MB.
