import test from "node:test";
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { bridgedRuntimeSource } from "../scripts/runtime-bridge.mjs";

async function runtimeFixture() {
	class NativeComponent {}
	const native = new Proxy({}, { get: (_target, name) => name === "normalizePath" ? value => value : NativeComponent });
	const module = { exports: {} };
	runInNewContext(await bridgedRuntimeSource(), {
		module, exports: module.exports, TextEncoder, TextDecoder, URL,
		setTimeout, clearTimeout, console,
		require(name) { assert.equal(name, "obsidian"); return native; }
	});
	return module.exports;
}

test("pinned bridge initializes the original plugin and all required integrations", async () => {
	const bundle = await runtimeFixture();
	assert.equal(typeof bundle.default, "function");
	for (const name of ["QuizSaver", "QuizReviewer", "Generator", "SettingsTab", "QuizModal", "parseQuizJson", "validateQuiz", "createQuizDocument"]) {
		assert.equal(typeof bundle.continuationRuntime[name], "function", name);
	}
	assert.equal(typeof bundle.continuationRuntime.GeneratorFactory.createInstance, "function");
});

test("compatibility bridge preserves valid templates for all seventeen question methods", async () => {
	const { continuationRuntime: runtime } = await runtimeFixture();
	const types = ["true-false", "multiple-choice", "select-all", "fill-in-the-blank", "matching", "short-answer", "long-answer", "branching-scenario", "sequencing", "categorization", "error-correction", "assertion-reason", "prediction", "evidence-selection", "two-stage", "concept-map", "what-if"];
	const questions = types.map(type => runtime.createQuestionTemplate(type));
	const document = runtime.createQuizDocument(questions, { title: "Compatibility check" });
	const restored = runtime.parseQuizJson(runtime.serializeQuizJson(document));
	assert.equal(restored.questions.length, 17);
	assert.deepEqual(Array.from(restored.questions, question => runtime.questionType(question)), types);
});

test("scoped validation integration reaches internal serializers and restores the original validator", async () => {
	const { continuationRuntime: runtime } = await runtimeFixture();
	let validations = 0;
	const restore = runtime.replaceQuizValidator(original => value => {
		validations++;
		return original(value);
	});
	const question = runtime.createQuestionTemplate("true-false");
	const document = runtime.createQuizDocument([question]);
	runtime.serializeQuizJson(document);
	runtime.parseQuizJson(JSON.stringify(document));
	assert.equal(validations, 3);
	restore();
	runtime.validateQuiz(document);
	assert.equal(validations, 3);
});

test("strict index validation remains active through the compatibility boundary", async () => {
	const { continuationRuntime: runtime } = await runtimeFixture();
	assert.throws(() => runtime.createQuizDocument([
		{ type: "multiple-choice", question: "Select a letter.", options: ["A", "B"], answer: 3 }
	]), /answer/);
});
