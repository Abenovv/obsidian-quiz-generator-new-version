import test from "node:test";
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { build } from "esbuild";
import { bridgedRuntimeSource } from "../scripts/runtime-bridge.mjs";

const { outputFiles } = await build({
	entryPoints: ["src/notes/index.ts"], bundle: true, write: false,
	platform: "node", format: "cjs", external: ["obsidian"], logLevel: "silent"
});
const noteSource = outputFiles[0].text;

function plain(value) { return JSON.parse(JSON.stringify(value)); }

async function fixture() {
	const files = new Map();
	const contents = new Map();
	const notices = [];
	class TFile {
		constructor(path) {
			this.path = path;
			this.basename = path.split("/").pop().replace(/\.md$/, "");
			this.extension = path.split(".").pop();
			this.name = path.split("/").pop();
		}
	}
	class TFolder { constructor() { this.children = []; } }
	class Component { register() {} registerDomEvent() {} }
	class Notice { constructor(message) { notices.push(message); } }
	const native = new Proxy({ TFile, TFolder, Notice, Component, MarkdownRenderChild: Component, normalizePath: value => value }, {
		get(target, name) { return name in target ? target[name] : Component; }
	});
	const runtimeModule = { exports: {} };
	runInNewContext(await bridgedRuntimeSource(), {
		module: runtimeModule, exports: runtimeModule.exports,
		TextEncoder, TextDecoder, URL, setTimeout, clearTimeout, console,
		require(name) { assert.equal(name, "obsidian"); return native; }
	});
	const runtime = runtimeModule.exports.continuationRuntime;
	const notesModule = { exports: {} };
	runInNewContext(noteSource, {
		module: notesModule, exports: notesModule.exports,
		TextEncoder, console,
		require(name) { assert.equal(name, "obsidian"); return native; }
	});
	const folder = new TFolder();
	const app = {
		vault: {
			getAbstractFileByPath(path) { return path === "Quizzes" ? folder : files.get(path); },
			getRoot() { return folder; },
			async create(path, content) { const file = new TFile(path); files.set(path, file); contents.set(path, content); return file; },
			async append(file, content) { contents.set(file.path, (contents.get(file.path) || "") + content); },
			async cachedRead(file) { return contents.get(file.path); },
			async process(file, update) { contents.set(file.path, update(contents.get(file.path))); }
		},
		fileManager: { generateMarkdownLink(file) { return "[[" + file.path + "]]"; } },
		workspace: { getActiveFile() { return null; } }
	};
	const opened = [];
	const cleanups = [];
	const commands = [];
	const plugin = {
		app,
		settings: { ...runtime.defaultSettings, savePath: "Quizzes", saveFormat: "Callout", quizMaterialProperty: "sources" },
		register(callback) { cleanups.push(callback); },
		registerMarkdownCodeBlockProcessor() {},
		addCommand(command) { commands.push(command); },
		async openJsonQuiz(document) { opened.push(document); }
	};
	return { runtime, install: notesModule.exports.installNoteExperience, plugin, app, contents, files, TFile, opened, cleanups, commands, notices };
}

function hiddenDocument(markdown) {
	const match = /<!-- quiz-generator:data\s*([\s\S]*?)-->/.exec(markdown);
	assert.ok(match, "Expected hidden authoritative quiz metadata");
	return JSON.parse(match[1]);
}

test("saving all seventeen runtime formats produces readable callouts and lossless data", async () => {
	const f = await fixture();
	f.install(f.plugin, f.runtime);
	const types = ["true-false", "multiple-choice", "select-all", "fill-in-the-blank", "matching", "short-answer", "long-answer", "branching-scenario", "sequencing", "categorization", "error-correction", "assertion-reason", "prediction", "evidence-selection", "two-stage", "concept-map", "what-if"];
	const questions = types.map(type => f.runtime.createQuestionTemplate(type));
	questions[1].explanation = "This is the supported answer.";
	questions[1].source = "Astronomy.md";
	const saver = new f.runtime.QuizSaver(f.app, f.plugin.settings, []);
	await saver.saveAllQuestions(questions);
	const markdown = f.contents.get(saver.saveFilePath);
	assert.equal((markdown.match(/\[!question\|qg-quiz\]/g) || []).length, 17);
	assert.ok(!markdown.includes("```quiz-json"));
	assert.deepEqual(hiddenDocument(markdown).questions, plain(questions));
	const file = f.files.get(saver.saveFilePath);
	await new f.runtime.QuizReviewer(f.app, f.plugin.settings).openQuiz(file);
	assert.equal(f.opened.length, 1, f.notices.join("\n"));
	assert.equal(f.opened[0].questions.length, 17, "Readable callouts must not duplicate the authoritative payload");
});

test("single-question saves retain readable output even when the question has metadata", async () => {
	const f = await fixture();
	f.install(f.plugin, f.runtime);
	const question = { ...f.runtime.createQuestionTemplate("multiple-choice"), hint: "Read the options.", difficulty: "easy" };
	const saver = new f.runtime.QuizSaver(f.app, f.plugin.settings, []);
	await saver.saveQuestion(question);
	assert.match(f.contents.get(saver.saveFilePath), /\[!success\]- Answer/);
	assert.deepEqual(hiddenDocument(f.contents.get(saver.saveFilePath)).questions, plain([question]));
});

test("save context preserves the original document and current session configuration", async () => {
	const f = await fixture();
	// The quality module extends the strict document schema with validated provenance.
	f.runtime.replaceQuizValidator(original => value => {
		const { provenance, ...document } = value;
		const valid = original(document);
		if (provenance) valid.provenance = provenance;
		return valid;
	});
	const question = f.runtime.createQuestionTemplate("multiple-choice");
	const document = f.runtime.createQuizDocument([question], {
		title: "Original title", description: "Original description", sources: ["Original source.md"],
		createdAt: "2026-10-30T00:00:00.000Z",
		runConfig: { mode: "exam", timerMode: "quiz", durationSeconds: 600, allowPause: false, randomizeQuestions: false },
		provenance: { kind: "ai", provider: "Google", model: "account-model", generatedAt: "2026-10-30T00:00:00.000Z" }
	});
	const saver = new f.runtime.QuizSaver(f.app, f.plugin.settings, []);
	const initial = f.runtime.QuizModal.prototype.renderQuiz;
	// Exercise the continuation wrapper without mounting the unrelated React application.
	f.runtime.QuizModal.prototype.renderQuiz = async function () { await this.quizSaver.saveAllQuestions(f.runtime.validateQuiz(this.quizDocument).questions); };
	f.install(f.plugin, f.runtime);
	const presenter = { quiz: [question], quizDocument: document, quizSaver: saver };
	await f.runtime.QuizModal.prototype.renderQuiz.call(presenter);
	const saved = hiddenDocument(f.contents.get(saver.saveFilePath));
	assert.equal(saved.title, document.title);
	assert.equal(saved.description, document.description);
	assert.equal(saved.createdAt, document.createdAt);
	assert.deepEqual(saved.sources, plain(document.sources));
	assert.deepEqual(saved.provenance, plain(document.provenance));
	assert.deepEqual(saved.runConfig, plain(document.runConfig));
	const file = f.files.get(saver.saveFilePath);
	f.contents.set(file.path, "");
	presenter.lastSession = { document, config: { ...document.runConfig, durationSeconds: 900 } };
	await saver.saveQuestion(question);
	assert.equal(hiddenDocument(f.contents.get(file.path)).runConfig.durationSeconds, 900);
	f.runtime.QuizModal.prototype.renderQuiz = initial;
});

test("standalone existing quiz blocks keep their title, sources, and exam settings when opened", async () => {
	const f = await fixture();
	f.install(f.plugin, f.runtime);
	const document = f.runtime.createQuizDocument([f.runtime.createQuestionTemplate("prediction")], {
		title: "Retained title", sources: ["Source.md"], description: "A prediction exercise.",
		runConfig: { mode: "exam", timerMode: "question", durationSeconds: 60, allowPause: false, randomizeQuestions: false }
	});
	const file = await f.app.vault.create("A different note name.md", "```quiz-json\n" + JSON.stringify(document) + "\n```\n");
	await new f.runtime.QuizReviewer(f.app, f.plugin.settings).openQuiz(file);
	assert.deepEqual(plain(f.opened[0]), plain(document));
});

test("mixed notes preserve legacy callouts and merge quiz blocks without carrying one exam configuration", async () => {
	const f = await fixture();
	f.install(f.plugin, f.runtime);
	const first = f.runtime.createQuizDocument([f.runtime.createQuestionTemplate("true-false")], {
		title: "First", sources: ["Source A.md"], runConfig: { mode: "exam", timerMode: "quiz", durationSeconds: 120, allowPause: false, randomizeQuestions: false }
	});
	const second = f.runtime.createQuizDocument([f.runtime.createQuestionTemplate("prediction")], { title: "Second", sources: ["Source B.md"] });
	const legacy = "> [!question] Mars is a planet.\n>> [!success]- Answer\n>> True\n\n";
	const file = await f.app.vault.create("Combined.md", "```quiz-json\n" + JSON.stringify(first) + "\n```\n\n" + legacy + "```quiz-json\n" + JSON.stringify(second) + "\n```\n");
	await new f.runtime.QuizReviewer(f.app, f.plugin.settings).openQuiz(file);
	assert.equal(f.opened[0].questions.length, 3);
	assert.equal(f.opened[0].runConfig, undefined);
	assert.deepEqual(plain(f.opened[0].sources), ["Source A.md", "Source B.md", "Combined.md"]);
});

test("the original spaced-repetition setting remains functional for standard and advanced formats", async () => {
	const f = await fixture();
	f.plugin.settings.saveFormat = "Spaced Repetition";
	f.plugin.settings.inlineSeparator = "::";
	f.plugin.settings.multilineSeparator = "?";
	f.install(f.plugin, f.runtime);
	const saver = new f.runtime.QuizSaver(f.app, f.plugin.settings, []);
	await saver.saveAllQuestions([f.runtime.createQuestionTemplate("true-false"), f.runtime.createQuestionTemplate("prediction")]);
	const markdown = f.contents.get(saver.saveFilePath);
	assert.match(markdown, /tags:\n  - flashcards/);
	assert.match(markdown, /True or False:.*:: True/);
	assert.match(markdown, /\n\?\n/);
	assert.match(markdown, /observer's location/);
	assert.equal(hiddenDocument(markdown).questions.length, 2);
});

test("unloading restores saver, reader, and presenter integrations", async () => {
	const f = await fixture();
	const before = { single: f.runtime.QuizSaver.prototype.saveQuestion, all: f.runtime.QuizSaver.prototype.saveAllQuestions, reader: f.runtime.QuizReviewer.prototype.openQuiz, presenter: f.runtime.QuizModal.prototype.renderQuiz };
	f.install(f.plugin, f.runtime);
	for (const cleanup of f.cleanups.reverse()) cleanup();
	assert.equal(f.runtime.QuizSaver.prototype.saveQuestion, before.single);
	assert.equal(f.runtime.QuizSaver.prototype.saveAllQuestions, before.all);
	assert.equal(f.runtime.QuizReviewer.prototype.openQuiz, before.reader);
	assert.equal(f.runtime.QuizModal.prototype.renderQuiz, before.presenter);
});
