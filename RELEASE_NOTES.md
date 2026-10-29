## Quiz Generator Continued 3.1.0

Saved quizzes are readable in your notes again, with question callouts and collapsed answers.

### Changes

- Render existing `quiz-json` blocks as question cards with an optional JSON view.
- Save new quizzes as native callouts while keeping the complete structured quiz data.
- Add **Make saved quiz readable** for converting quiz blocks in the active note.
- Retain all 17 question formats, five study modes, timers, bookmarks, and session recovery.
- Check requested question counts, remove duplicates, and extract one complete JSON document from provider output without guessing answers.
- Record provider, model when available, and generation time once per generated quiz.
- Refine note and study layouts, keyboard focus, and reduced-motion behavior.
- Add optional local sound feedback, off by default.
- Add a reproducible build for the continuation modules and pinned compatibility runtime.

### Install or update

Requires Obsidian 1.7.2 or newer.

Download `main.js`, `manifest.json`, and `styles.css` below. Put them in `.obsidian/plugins/quiz-generator/`, reload Obsidian, and enable **Quiz Generator Continued**.

Replace only those three files. Keep your existing `data.json` and `study-data.json`. Provider keys and study history are not included in this release.

`SHA256SUMS` contains the download checksums. The automatic source archives are development snapshots, not installation packages.

The original MIT credit is retained. This is an independently maintained continuation, not an endorsed release from the original author.
