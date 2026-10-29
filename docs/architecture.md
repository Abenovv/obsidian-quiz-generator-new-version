# Architecture and source status

The 3.1.0 build combines a pinned compatibility runtime with typed continuation modules. Installing the release requires only `main.js`, `manifest.json`, and `styles.css`.

## Active source

| Area | Responsibility |
| --- | --- |
| `src/continuation/` | Plugin entry point, typed contracts, and runtime integration. |
| `src/notes/` | Readable saved notes, quiz-block rendering, and active-note conversion. |
| `src/quality/` | Generation boundaries and structured JSON handling. |
| `src/feedback/` | Optional local audio and motion preferences. |
| `styles/continuation.css` | Note and study interface styles. |
| `scripts/build.mjs` | Runtime verification, bundling, and stylesheet assembly. |

The modules extend the existing study runtime rather than replacing its quiz library, timers, or 17 question formats.

## Compatibility runtime

`vendor/runtime-3.0.1.cjs` and `vendor/runtime-3.0.1.css` preserve the customized 3.0.1 behavior. That version's original TypeScript source was removed during an earlier local cleanup and is not reconstructed here.

The build verifies the pinned runtime hash before exposing a small named bridge to the new source. It does not edit the vendored file in place. A runtime update requires reviewing that bridge and rerunning the tests.

This makes the continuation build reproducible from the checked-in files. It does not make the original customized 3.0.1 TypeScript available. The earlier upstream 2.1.2 source remains in Git history for reference.

## Build and verify

```sh
npm ci
npm run typecheck
npm test
npm run build
npm run verify:release
```

Run these commands from a clean checkout with Node.js 24 or newer. Tests use fixtures and mocks; they do not need provider keys or private notes. Runtime code relies on Obsidian's native module, which is supplied by the app. The continuation requires Obsidian 1.7.2 or newer.

Before publishing, inspect the Git diff and confirm that `data.json`, `study-data.json`, environment files, and credentials are untracked. The release verifier checks tracked filenames, common credential patterns, manifest/version consistency, JavaScript syntax, and runtime checksums.

## Saved notes

New saved quizzes contain readable question and answer callouts plus a compact authoritative quiz document in an HTML comment. The readable content remains available with the plugin disabled; the stored document preserves advanced question structure for reopening.

Existing fenced `quiz-json` blocks are rendered by the plugin. **Make saved quiz readable** converts quiz blocks in the active note to the callout format while preserving surrounding note content. The raw JSON remains available as an optional detail when viewing an existing block.

## Data boundaries

Generation cleanup accepts one complete JSON document, validates the requested types and counts, removes duplicate questions and unrequested optional fields, and passes answers through unchanged. Ambiguous, truncated, and oversized output is rejected. If too few valid unique questions remain, generation fails with guidance to request fewer questions.

The plugin adds document-level provenance after validation: `kind`, `provider`, optional `model`, and `generatedAt`. The model response cannot supply trusted provenance. Source references are limited to selected note identifiers. These checks establish structure and origin, not factual correctness.

Provider keys stay in local Obsidian settings. Saved quizzes and session history stay in local study data. Neither belongs in source control or release assets.

Generation through a hosted model sends selected notes to the configured provider endpoint. The build, tests, and release verifier do not make generation requests.
