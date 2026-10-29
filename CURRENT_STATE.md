# Current state

Version 3.1.0 is Quiz Generator Continued, an independent MIT continuation with the same `quiz-generator` plugin ID.

Active source lives in `src/continuation`, `src/notes`, `src/quality`, and `src/feedback`. The build includes a hash-pinned 3.0.1 compatibility runtime. Earlier upstream source is preserved in Git history.

Saved notes use native question-and-answer callouts plus hidden lossless quiz data. Existing quiz-json blocks have a reader and an active-note conversion command. Generation checks structure, requested counts, duplicates, and provenance. Sound is optional and off by default.

Run `npm run typecheck`, `npm test`, `npm run build`, and `npm run verify:release`. Tests and previews use fixtures; they do not need API keys or real notes. Install only main.js, manifest.json, and styles.css. Keep local data.json and study-data.json private.
