## Quiz Generator 3.0.1

A study studio for Obsidian with a quiz library, timed sessions, and a cleaner interface.

### Included

- Five study modes: Practice, Timed practice, Exam, Flashcards, and Review.
- Seventeen question formats, including branching scenarios, sequencing, evidence selection, and answer-and-justification questions.
- Whole-quiz and per-question timers, flags, bookmarks, and session recovery.
- Updated provider connections, model discovery, and manual model IDs.
- JSON import, editing, validation, and export.
- Obsidian, Paper, Midnight, and High contrast themes.
- Simpler generation controls, grouped settings, and clearer save and error states.

### Install or update

Download `main.js`, `manifest.json`, and `styles.css` below and place them in `.obsidian/plugins/quiz-generator/`. Reload Obsidian and enable the plugin. Keep your existing `data.json` and `study-data.json`.

`SHA256SUMS` contains checksums for the three installable files. The source archives are repository snapshots; the retained TypeScript source is the older upstream version and does not reproduce this customized bundle.

Provider keys, settings, saved quizzes, and session history are not included. Add your own provider key in the plugin settings, use Ollama, or import a JSON quiz.

Objective questions are scored automatically. Short and long answers use self-review. Hosted generation sends the selected notes to your chosen provider.
