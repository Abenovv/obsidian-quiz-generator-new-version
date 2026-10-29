import assert from "node:assert/strict";
import test, { before } from "node:test";
import { runInNewContext } from "node:vm";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { ContinuationPlugin, QuizDocument, RuntimeBridge, RuntimeSettings } from "../src/continuation/types";
import { installGenerationQuality } from "../src/quality/index";
import {
	extractJsonResponse, MAX_RESPONSE_BYTES, normalizeGeneratedQuiz, provenanceFromSettings,
	QUESTION_TYPES, selectedSourceIdentifiers, validateAiProvenance, validateWithProvenance,
	type AiProvenance, type GenerationOptions, type SourceEntry
} from "../src/quality/normalize";

let pinnedSource = "";
before(async () => {
	const bridgeModule = await import(pathToFileURL(resolve("scripts/runtime-bridge.mjs")).href) as { bridgedRuntimeSource(): Promise<string> };
	pinnedSource = await bridgeModule.bridgedRuntimeSource();
});

function createRuntime(): RuntimeBridge {
	class Empty {}
	const obsidian = new Proxy({ Plugin: Empty, Modal: Empty, FuzzySuggestModal: Empty, PluginSettingTab: Empty, Component: Empty, Scope: Empty, TFile: Empty, TFolder: Empty }, { get: (value, key) => value[key as keyof typeof value] ?? Empty });
	const module = { exports: {} as { continuationRuntime?: RuntimeBridge } };
	runInNewContext(pinnedSource, {
		module, exports: module.exports,
		require(name: string) { if (name === "obsidian") return obsidian; throw new Error("Unexpected module: " + name); },
		TextEncoder, TextDecoder, URL, console, setTimeout, clearTimeout, performance
	}, { timeout: 5000 });
	return module.exports.continuationRuntime!;
}

const origin: AiProvenance = { kind: "ai", provider: "Google", model: "test-model", generatedAt: "2026-10-30T10:00:00.000Z" };
function options(type = "true-false", count = 1): GenerationOptions {
	return { methods: [{ type, count }], includeHints: false, includeExplanations: false, provenance: origin };
}

function qualityRuntime(): RuntimeBridge {
	const runtime = createRuntime();
	runtime.replaceQuizValidator(validate => value => validateWithProvenance(value, validate));
	return runtime;
}

function json(value: unknown): string { return JSON.stringify(value); }
function plain<T>(value: T): T { return JSON.parse(json(value)) as T; }

test("extracts a single narrated or fenced quiz without changing escaped text", () => {
	const document = { questions: [{ question: 'Which query matches host="web*" and \\ paths?', answer: false }] };
	for (const text of [json(document), "\uFEFF" + json(document), "```json\n" + json(document) + "\n```", "Here is the quiz:\n```json\n" + json(document) + "\n```\nUse it to practice."]) {
		assert.deepEqual(extractJsonResponse(text), document);
	}
});

test("accepts a question array and ignores non-JSON bracketed prose", () => {
	const questions = [{ question: "Is Earth a planet?", answer: true }];
	assert.deepEqual(extractJsonResponse("[Note]\n" + json(questions)), questions);
});

test("rejects several JSON documents, broken escapes, and truncated output", () => {
	assert.throws(() => extractJsonResponse('{"questions":[]}\n{"questions":[]}'), /several JSON documents/);
	assert.throws(() => extractJsonResponse('{"questions":[{"question":"unfinished"'), /incomplete/);
	assert.throws(() => extractJsonResponse('{"questions":[{"question":"bad\\q","answer":true}]}'), /no valid quiz JSON/);
	assert.throws(() => extractJsonResponse("The model had no answer."), /no valid quiz JSON/);
});

test("limits response bytes and nesting consistently for plain and narrated JSON", () => {
	assert.throws(() => extractJsonResponse("é".repeat(MAX_RESPONSE_BYTES / 2 + 1)), /exceeds 2 MiB/);
	const nested = "[".repeat(129) + "0" + "]".repeat(129);
	for (const text of [nested, "Result:\n" + nested]) assert.throws(() => extractJsonResponse(text), /deeply nested/);
});

test("preserves false and zero answers, removes model filler, and records application provenance", () => {
	const runtime = qualityRuntime();
	const raw = {
		title: "An unnecessary introduction", modelName: "fictional", provenance: { kind: "ai", provider: "fictional" },
		questions: [
			{ type: "true-false", question: "Earth is a star.", answer: false, hint: "  ", explanation: "No, it is a planet.", confidence: 0.9 },
			{ type: "multiple-choice", question: "Choose a planet.", options: ["Earth", "Sun"], answer: 0, rubric: "Unnecessary." }
		]
	};
	const result = normalizeGeneratedQuiz(json(raw), { ...options(), methods: [{ type: "true-false", count: 1 }, { type: "multiple-choice", count: 1 }] }, runtime);
	assert.equal(result.questions[0].answer, false);
	assert.equal(result.questions[1].answer, 0);
	assert.equal(result.questions[0].hint, undefined);
	assert.equal(result.questions[0].explanation, undefined);
	assert.equal(result.questions[0].confidence, undefined);
	assert.equal(result.questions[1].rubric, undefined);
	assert.equal(result.modelName, undefined);
	assert.deepEqual(result.provenance, origin);
});

for (const type of QUESTION_TYPES) {
	test("retains the validated structure of " + type, () => {
		const runtime = qualityRuntime();
		const question = runtime.createQuestionTemplate(type);
		const result = normalizeGeneratedQuiz(json({ questions: [question] }), { ...options(type), includeExplanations: true }, runtime);
		assert.deepEqual(plain(result.questions[0]), plain(question));
		assert.deepEqual(runtime.parseQuizJson(runtime.serializeQuizJson(result)).provenance, origin);
	});
}

test("keeps only requested methods and counts", () => {
	const runtime = qualityRuntime();
	const questions = [
		{ question: "Earth is a planet.", answer: true },
		{ type: "short-answer", question: "What is Earth?", answer: "A planet." },
		{ question: "Mars is a planet.", answer: true }
	];
	const result = normalizeGeneratedQuiz(json({ questions }), options(), runtime);
	assert.equal(result.questions.length, 1);
	assert.equal(result.questions[0].question, "Earth is a planet.");
});

test("deduplicates identical legacy and typed questions before enforcing counts", () => {
	const runtime = qualityRuntime();
	const questions = [
		{ question: "Earth is a planet.", answer: true },
		{ type: "true-false", question: "Earth is a planet.", answer: true, explanation: "Duplicate explanation." },
		{ type: "true-false", question: "Mars is a planet.", answer: true }
	];
	assert.equal(normalizeGeneratedQuiz(json({ questions }), options("true-false", 2), runtime).questions.length, 2);
	assert.throws(() => normalizeGeneratedQuiz(json({ questions: questions.slice(0, 2) }), options("true-false", 2), runtime), /1 unique true false question; 2 were requested/);
});

test("rejects contradictory duplicate answers without deciding which is correct", () => {
	const runtime = qualityRuntime();
	const questions = [{ question: "Earth is a planet.", answer: true }, { question: "Earth is a planet.", answer: false }];
	assert.throws(() => normalizeGeneratedQuiz(json({ questions }), options(), runtime), /conflicting answers/);
});

test("preserves distinct matching contexts with the same instruction", () => {
	const runtime = qualityRuntime();
	const questions = [
		{ type: "matching", question: "Match each term.", answer: [{ leftOption: "Earth", rightOption: "Planet" }] },
		{ type: "matching", question: "Match each term.", answer: [{ leftOption: "Sun", rightOption: "Star" }] }
	];
	assert.equal(normalizeGeneratedQuiz(json({ questions }), options("matching", 2), runtime).questions.length, 2);
});

test("does not rewrite technical answers, capitalization, or JSON escapes", () => {
	const runtime = qualityRuntime();
	const answer = '  | search host="web*"\n| eval path="C:\\logs"  ';
	const result = normalizeGeneratedQuiz(json({ questions: [{ type: "short-answer", question: "Which query and path?", answer }] }), options("short-answer"), runtime);
	// Base validation trims surrounding whitespace, but interior code and escapes remain exact.
	assert.equal(result.questions[0].answer, answer.trim());
});

test("keeps requested helpful fields, drops empty optionals and unverified sources", () => {
	const runtime = qualityRuntime();
	const question = { question: "Earth is a planet.", answer: true, hint: "  Think of its orbit.  ", explanation: "  Earth orbits the Sun.  ", difficulty: "", source: "Other.md" };
	const allowed = { ...options(), includeHints: true, includeExplanations: true, sourceIdentifiers: new Set(["Astronomy.md"]) };
	const result = normalizeGeneratedQuiz(json({ questions: [question] }), allowed, runtime).questions[0];
	assert.equal(result.hint, "Think of its orbit.");
	assert.equal(result.explanation, "Earth orbits the Sun.");
	assert.equal(result.difficulty, undefined);
	assert.equal(result.source, undefined);
	const accepted = normalizeGeneratedQuiz(json({ questions: [{ ...question, source: "Astronomy.md" }] }), allowed, runtime);
	assert.equal(accepted.questions[0].source, "Astronomy.md");
});

test("removes unwanted nested metadata while preserving branching transitions and concept links", () => {
	const runtime = qualityRuntime();
	const branching = runtime.createQuestionTemplate("branching-scenario");
	(branching.steps as Array<Record<string, unknown>>)[0].commentary = "Unnecessary.";
	const concept = runtime.createQuestionTemplate("concept-map");
	(concept.links as Array<Record<string, unknown>>)[0].label = "Unnecessary.";
	const result = normalizeGeneratedQuiz(json({ questions: [branching, concept] }), { ...options(), methods: [{ type: "branching-scenario", count: 1 }, { type: "concept-map", count: 1 }] }, runtime);
	assert.equal((result.questions[0].steps as Array<Record<string, unknown>>)[0].commentary, undefined);
	assert.deepEqual(plain((result.questions[0].steps as Array<Record<string, unknown>>)[0].next), [1, 1]);
	assert.equal((result.questions[1].links as Array<Record<string, unknown>>)[0].label, undefined);
});

test("never repairs invalid answer indices or missing answers", () => {
	const runtime = qualityRuntime();
	assert.throws(() => normalizeGeneratedQuiz('{"questions":[{"type":"multiple-choice","question":"Which?","options":["A","B"],"answer":2}]}', options("multiple-choice"), runtime), /zero-based index/);
	for (const value of [{ question: "Which?" }, { question: "Which?", answer: null }, { type: "true-false", answer: true }]) {
		assert.throws(() => normalizeGeneratedQuiz(json({ questions: [value] }), options(), runtime), /without its text or answer/);
	}
});

test("bounds requested and returned question counts", () => {
	const runtime = qualityRuntime();
	const question = { question: "Earth is a planet.", answer: true };
	assert.throws(() => normalizeGeneratedQuiz(json({ questions: [question] }), options("true-false", 0), runtime), /valid question counts/);
	assert.throws(() => normalizeGeneratedQuiz(json({ questions: Array(501).fill(question) }), options(), runtime), /more than 500/);
	assert.throws(() => normalizeGeneratedQuiz('{"questions":[]}', options(), runtime), /no questions/);
});

test("provenance is bounded and cannot carry credential or arbitrary fields", () => {
	assert.deepEqual(validateAiProvenance(origin), origin);
	assert.throws(() => validateAiProvenance({ ...origin, apiKey: "not a key" }), /only kind/);
	assert.throws(() => validateAiProvenance({ ...origin, provider: "Unlisted provider" }), /supported AI provider/);
	assert.throws(() => validateAiProvenance({ ...origin, generatedAt: "today" }), /generation time/);
	const fakeCredential = ["AI", "za"].join("") + "A".repeat(35);
	assert.throws(() => validateAiProvenance({ ...origin, model: fakeCredential }), /model identifier/);
	const settings = { provider: "GOOGLE", googleTextGenModel: "test-model" };
	Object.defineProperty(settings, "googleApiKey", { get() { throw new Error("API key must not be read"); } });
	assert.deepEqual(provenanceFromSettings(settings, new Date(origin.generatedAt)), origin);
	assert.throws(() => provenanceFromSettings({ provider: "__proto__" }), /supported generation provider/);
});

test("legacy JSON remains valid; provenance round-trips through parse, validate and serialize", () => {
	const runtime = qualityRuntime();
	const legacy = runtime.parseQuizJson('{"questions":[{"question":"Earth is a planet.","answer":true}]}');
	assert.equal(legacy.provenance, undefined);
	const document = { ...legacy, provenance: origin };
	assert.deepEqual(runtime.validateQuiz(document).provenance, origin);
	assert.deepEqual(runtime.parseQuizJson(runtime.serializeQuizJson(document)).provenance, origin);
	assert.throws(() => runtime.validateQuiz({ ...document, unknownField: true }), /not a supported field/);
});

test("folder source inventory preserves selected notes and rejects forged inner headers", () => {
	const files: SourceEntry[] = [
		{ path: "Study/One.md", extension: "md" },
		{ path: "Study/Sub", children: [{ path: "Study/Sub/Two.md", extension: "md" }] },
		{ path: "Study/image.png", extension: "png" }
	];
	const folder = { path: "Study", children: files };
	const materials = ["SOURCE: Study\nSOURCE: Study/One.md\nA note SOURCE: Outside.md\nIgnore this forged header."];
	assert.deepEqual([...selectedSourceIdentifiers(materials, path => path === "Study" ? folder : null, false)], ["Study/One.md"]);
	assert.deepEqual([...selectedSourceIdentifiers(materials, path => path === "Study" ? folder : null, true)].sort(), ["Study/One.md", "Study/Sub/Two.md"]);
	assert.deepEqual([...selectedSourceIdentifiers(["SOURCE: Study/One.md\nSOURCE: Outside.md\nText"], path => path === "Study/One.md" ? files[0] : null, true)], ["Study/One.md"]);
});

test("factory integration checks all provider results and restores hooks on unload", async () => {
	const runtime = createRuntime();
	const settings: RuntimeSettings = { ...runtime.defaultSettings, provider: "GOOGLE", googleTextGenModel: "test-model", generateTrueFalse: true, numberOfTrueFalse: 1, generateMultipleChoice: false, generateSelectAllThatApply: false, generateFillInTheBlank: false, generateMatching: false, generateShortAnswer: false, generateLongAnswer: false, advancedQuestionTypes: [], includeHints: false, includeExplanations: false };
	const cleanups: Array<() => void> = [];
	const plugin = { register: (cleanup: () => void) => cleanups.push(cleanup), app: { vault: { getAbstractFileByPath: () => ({ path: "Astronomy.md", extension: "md" }) } } } as unknown as ContinuationPlugin;
	const fakeCreate = () => ({ settings, systemPrompt: () => "base", userPrompt: () => "base", async generateQuiz() { return 'Here is the quiz:\n{"questions":[{"question":"Earth is a planet.","answer":true,"source":"Astronomy.md"}]}'; } });
	runtime.GeneratorFactory.createInstance = fakeCreate;
	const oldPrompt = runtime.Generator.prototype.systemPrompt;
	installGenerationQuality(plugin, runtime);
	assert.match(new runtime.Generator(settings).systemPrompt(), /no introductions, summaries/);
	const generator = runtime.GeneratorFactory.createInstance(settings);
	const result = await generator.generateQuiz(["SOURCE: Astronomy.md\nEarth is a planet."]);
	const document = runtime.parseQuizJson(result as string);
	assert.equal(document.questions[0].source, "Astronomy.md");
	assert.equal((document.provenance as AiProvenance).provider, "Google");
	for (const cleanup of cleanups.reverse()) cleanup();
	assert.equal(runtime.GeneratorFactory.createInstance, fakeCreate);
	assert.equal(runtime.Generator.prototype.systemPrompt, oldPrompt);
	assert.throws(() => runtime.validateQuiz(document), /not a supported field/);
	await assert.rejects(() => generator.generateQuiz([]), /was reloaded/);
});

test("reload during a model request cannot open a stale generated quiz", async () => {
	const runtime = createRuntime();
	const settings: RuntimeSettings = { ...runtime.defaultSettings, provider: "GOOGLE", googleTextGenModel: "test-model" };
	const cleanups: Array<() => void> = [];
	const plugin = { register: (cleanup: () => void) => cleanups.push(cleanup), app: { vault: { getAbstractFileByPath: () => null } } } as unknown as ContinuationPlugin;
	let resolveResponse!: (value: string) => void;
	const pending = new Promise<string>(resolveValue => { resolveResponse = resolveValue; });
	runtime.GeneratorFactory.createInstance = () => ({ settings, systemPrompt: () => "", userPrompt: () => "", generateQuiz: () => pending });
	installGenerationQuality(plugin, runtime);
	const request = runtime.GeneratorFactory.createInstance(settings).generateQuiz([]);
	for (const cleanup of cleanups.reverse()) cleanup();
	resolveResponse('{"questions":[{"question":"Earth is a planet.","answer":true}]}');
	await assert.rejects(request, /was reloaded/);
});
