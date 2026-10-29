# Quiz Generator

Turn Obsidian notes into quizzes, then study at your own pace or under a timer.

**Version 3.0.1** · [Download the latest release](https://github.com/Abenovv/obsidian-quiz-generator-new-version/releases/latest) · [MIT license](LICENSE)

This edition adds a study library, more question formats, timed sessions, JSON editing, and four interface themes to Edward Cui's [original Quiz Generator](https://github.com/ECuiDev/obsidian-quiz-generator).

## Study your way

| Mode | How it works |
| --- | --- |
| Practice | Work through questions with feedback and explanations. |
| Timed practice | Set a time limit for the whole quiz or each question. |
| Exam | Answer under a timer; review answers after submitting. |
| Flashcards | Reveal answers and rate recall with Again, Good, or Easy. |
| Review | Revisit mistakes, skipped questions, or bookmarked items. |

The study studio keeps a quiz library, session history, and unfinished sessions. Flag questions during a session and return to them before submitting.

## Question formats

The seven original formats remain: true/false, single choice, multiple answers, fill in the blanks, matching, short answer, and long answer.

Ten additional formats support deeper practice: branching scenarios, sequencing, categorization, error correction, assertion and reason, prediction, evidence selection, answer and justification, concept maps, and what-if questions.

Generation controls include difficulty, topic focus, language, hints, explanations, and source references. Edit a question directly or regenerate an individual question.

## Install

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/Abenovv/obsidian-quiz-generator-new-version/releases/latest). The automatic “Source code” archives are repository snapshots, not plugin packages.
2. Create `.obsidian/plugins/quiz-generator/` inside your vault and place those three files there.
3. Reload Obsidian and enable **Quiz Generator** under **Settings → Community plugins**.

If you are updating an existing installation, replace only those three files. Keep your local `data.json` and `study-data.json`.

The plugin ID is `quiz-generator`, so this edition uses the same installation folder as the original plugin. Install one edition at a time.

## Start a quiz

Open **Quiz Generator: Open study studio** from the command palette, or use the plugin's ribbon icon.

To generate questions, open **Quiz Generator: Open generator**, select your notes, and choose the question formats. Configure your provider under **Settings → Quiz Generator → Models** first.

Supported providers are Google Gemini, OpenAI, Anthropic, Mistral, Cohere, Perplexity, and Ollama. Model discovery and availability depend on the provider and your account; you can also enter a model ID manually.

You can import and edit JSON quizzes without a provider key. Ollama can generate questions through a local model.

## JSON and themes

Import a question array, a legacy `{ "questions": [...] }` document, or a versioned quiz document. The editor validates questions before saving or exporting. Imports accept up to 500 questions and 2 MiB per document.

Choose **Obsidian**, **Paper**, **Midnight**, or **High contrast** for the study interface. Layouts adapt to narrow screens, and controls include visible keyboard focus.

## Your data

Provider keys belong in your local plugin settings. Obsidian stores those settings in `data.json`; treat that file as private. Quiz history and unfinished sessions use `study-data.json`.

Neither file is included in this distribution. Both are excluded from Git, along with environment files and common credential files. Do not share your settings when reporting a problem.

When you generate with a hosted provider, the selected note content is sent to that provider. Check the selected notes before generating. No live API key is needed for the release checks.

## Scoring and limits

Objective questions receive automatic scores. Short and long answers use self-review and do not count toward the automatic score. Review generated questions before relying on them.

Exam mode delays answer feedback until submission. It is intended for personal study, not supervised or tamper-proof assessment.

## Distribution and development

The checked-in `main.js`, `manifest.json`, and `styles.css` are the installable 3.0.1 distribution. The existing `src/`, package files, and build configuration are retained from upstream 2.1.2 for reference. They do **not** reproduce this customized bundle; running the legacy build can overwrite `main.js`.

To validate the distribution without installing dependencies:

```sh
node scripts/verify-release.mjs
```

The release workflow checks JavaScript syntax, manifest/version consistency, file hashes, tracked private-file exclusions, and common credential patterns before uploading the three runtime files and their checksums.

The preceding development pass completed 88 automated tests, TypeScript checking, linting, and browser interaction checks. This distribution does not include that customized source or test harness. The publish checks do not make live provider requests.

## Credits

Original plugin by **Edward Cui**. Customized edition maintained by **Yerkebulan Abenov**.

Distributed under the [MIT license](LICENSE), with the original copyright notice retained.
