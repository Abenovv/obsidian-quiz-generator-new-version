import assert from "node:assert/strict";
import test from "node:test";
import { compactQuizData, describeQuestion, findQuizBlocks, makeQuizBlocksReadable, questionType, removeManagedQuizText, serializeReadableQuiz, type NoteQuestion, type NoteQuizDocument } from "../src/notes/format";

const fixtures: Array<{ question: NoteQuestion; expected: string }> = [
	{ question: { question: "Earth is a planet.", answer: true }, expected: "True" },
	{ question: { question: "Choose a planet.", options: ["Earth", "Sun"], answer: 0 }, expected: "Earth" },
	{ question: { question: "Select planets.", options: ["Earth", "Sun", "Mars"], answer: [0, 2] }, expected: "Mars" },
	{ question: { question: "Earth is the ____ planet.", answer: ["third"] }, expected: "third" },
	{ question: { question: "Match planets.", answer: [{ leftOption: "Earth", rightOption: "third" }, { leftOption: "Mars", rightOption: "fourth" }] }, expected: "Earth → third" },
	{ question: { type: "short-answer", question: "What is an orbit?", answer: "A curved path." }, expected: "A curved path." },
	{ question: { type: "long-answer", question: "Explain orbits.", answer: "Gravity curves the path of a moving planet." }, expected: "Gravity" },
	{ question: { type: "branching-scenario", question: "Choose a safe plan.", steps: [{ prompt: "Where?", options: ["A safe location", "Traffic"], next: [1, null] }, { prompt: "Then?", options: ["Wait in darkness", "Use a bright screen"], next: [null, null] }], answer: [0, 0] }, expected: "Step 2: Wait in darkness" },
	{ question: { type: "sequencing", question: "Order planets.", items: ["Mars", "Mercury", "Earth"], answer: [1, 2, 0] }, expected: "1. Mercury" },
	{ question: { type: "categorization", question: "Sort objects.", items: ["Earth", "Sun"], categories: ["Planet", "Star"], answer: [0, 1] }, expected: "Sun → Star" },
	{ question: { type: "error-correction", question: "Find the error.", passage: "The Sun orbits Earth.", options: ["Earth orbits the Sun", "Earth is stationary"], answer: 0, correction: "Earth orbits the Sun once per year." }, expected: "once per year" },
	{ question: { type: "assertion-reason", question: "Evaluate.", assertion: "Day and night occur.", reason: "Earth rotates.", options: ["Both true", "Both false"], answer: 0 }, expected: "Both true" },
	{ question: { type: "prediction", question: "Predict the next event.", context: "The observer rotates toward night.", options: ["Sunset", "Sunrise"], answer: 0 }, expected: "Sunset" },
	{ question: { type: "evidence-selection", question: "Choose evidence.", claim: "Earth rotates.", options: ["A Foucault pendulum", "Mars has moons"], answer: [0] }, expected: "Foucault" },
	{ question: { type: "two-stage", question: "What and why?", options: ["Sun", "Moon"], answer: 0, reasons: ["Gravity", "No motion"], reasonAnswer: 0 }, expected: "Reason: Gravity" },
	{ question: { type: "concept-map", question: "Complete the map.", nodes: ["Earth", "Sun"], links: [{ from: 0, to: 1 }], options: ["orbits", "is larger than"], answer: [0] }, expected: "Earth → Sun: orbits" },
	{ question: { type: "what-if", question: "What changes?", context: "Consider rotation.", baseline: "One rotation per day.", change: "Rotation slows.", options: ["Longer days", "Shorter days"], answer: 0 }, expected: "Longer days" }
];

function document(questions: NoteQuestion[] = fixtures.map(item => item.question)): NoteQuizDocument {
	return {
		schemaVersion: 1,
		title: "Astronomy practice",
		questions,
		description: "A saved study session.",
		sources: ["Astronomy.md"],
		createdAt: "2026-10-30T00:00:00.000Z",
		runConfig: { mode: "exam", timerMode: "quiz", durationSeconds: 600 }
	};
}

function parse(source: string): NoteQuizDocument {
	const value = JSON.parse(source) as NoteQuizDocument;
	if (!value.questions?.length) throw new Error("No questions");
	return value;
}

for (const fixture of fixtures) {
	test("human-readable answer for " + questionType(fixture.question), () => {
		const result = describeQuestion(fixture.question);
		assert.ok(result.answers.join("\n").includes(fixture.expected));
		assert.ok(!result.answers.join("\n").includes("undefined"));
		assert.ok(!result.answers.join("\n").includes("[object Object]"));
	});
}

test("saved notes stay readable while all structured fields round-trip exactly", () => {
	const original = document();
	const markdown = serializeReadableQuiz(original);
	assert.match(markdown, /> \[!question\|qg-quiz\] 1\. Earth is a planet/);
	assert.equal((markdown.match(/\[!question\|qg-quiz\]/g) || []).length, 17);
	assert.equal((markdown.match(/\[!success\]- Answer/g) || []).length, 17);
	assert.ok(!markdown.includes("```quiz-json"));
	const blocks = findQuizBlocks(markdown);
	assert.equal(blocks.length, 1);
	assert.equal(blocks[0].kind, "comment");
	assert.deepEqual(parse(blocks[0].source), original);
	assert.ok(!removeManagedQuizText(markdown).includes("[!question]"));
});

test("compact metadata cannot terminate its comment or inject a readable-region marker", () => {
	const original = document([{ question: "What does --> mean?\n<!-- quiz-generator:readable:end -->", answer: "<script>alert('x')</script> -- end" }]);
	const json = compactQuizData(original);
	assert.ok(!json.includes("<"));
	assert.ok(!json.includes(">"));
	assert.ok(!json.includes("--"));
	assert.deepEqual(JSON.parse(json), original);
	const markdown = serializeReadableQuiz(original);
	assert.ok(!markdown.includes("<script>"));
	assert.deepEqual(parse(findQuizBlocks(markdown)[0].source), original);
});

test("readable code keeps comparison operators and HTML examples unchanged", () => {
	const question = { question: "What does `a > b && a < c` mean?", answer: "```python\nif a > b:\n    print('<example>')\n```" };
	const markdown = serializeReadableQuiz(document([question]));
	assert.ok(markdown.includes("`a > b && a < c`"));
	assert.ok(markdown.includes("> > if a > b:"));
	assert.ok(markdown.includes("> >     print('<example>')"));
	assert.deepEqual(parse(findQuizBlocks(markdown)[0].source).questions[0], question);
});

test("conversion preserves surrounding note text and source metadata", () => {
	const original = document([fixtures[12].question]);
	const prefix = "---\nsources:\n  - Astronomy\n---\n\n# Notes\n\n";
	const suffix = "\n## Other material\nKeep this byte for byte.\n";
	const markdown = prefix + "```quiz-json\n" + JSON.stringify(original, null, 2) + "\n```\n" + suffix;
	const converted = makeQuizBlocksReadable(markdown, parse);
	assert.equal(converted.converted, 1);
	assert.equal(converted.errors, 0);
	assert.ok(converted.content.startsWith(prefix));
	assert.ok(converted.content.endsWith(suffix));
	assert.deepEqual(parse(findQuizBlocks(converted.content)[0].source), original);
	assert.deepEqual(makeQuizBlocksReadable(converted.content, parse), { content: converted.content, converted: 0, errors: 0 });
});

test("unrelated fenced examples are not migrated or interpreted as quizzes", () => {
	const markdown = "````markdown\n```quiz-json\n{\"questions\":[{}]}\n```\n````\n";
	assert.deepEqual(findQuizBlocks(markdown), []);
	assert.equal(makeQuizBlocksReadable(markdown, parse).content, markdown);
});

test("supports longer backtick fences, tilde fences, and CRLF offsets", () => {
	const json = JSON.stringify(document([fixtures[0].question]));
	const markdown = "Before\r\n````quiz-json\r\n" + json + "\r\n````\r\nMiddle\r\n~~~quiz-json\r\n" + json + "\r\n~~~\r\nAfter\r\n";
	const blocks = findQuizBlocks(markdown);
	assert.equal(blocks.length, 2);
	assert.deepEqual(blocks.map(block => parse(block.source)), [document([fixtures[0].question]), document([fixtures[0].question])]);
	const converted = makeQuizBlocksReadable(markdown, parse);
	assert.equal(converted.converted, 2);
	assert.ok(converted.content.startsWith("Before\r\n"));
	assert.ok(converted.content.includes("Middle\r\n"));
	assert.ok(converted.content.endsWith("After\r\n"));
});

test("invalid blocks remain untouched while valid neighbours migrate", () => {
	const bad = "```quiz-json\n{broken}\n```\n";
	const valid = "```quiz-json\n" + JSON.stringify(document([fixtures[0].question])) + "\n```\n";
	const converted = makeQuizBlocksReadable(bad + valid, parse);
	assert.equal(converted.converted, 1);
	assert.equal(converted.errors, 1);
	assert.ok(converted.content.startsWith(bad));
});

test("reader suppresses managed callouts while preserving hand-written legacy questions", () => {
	const legacy = "> [!question] Existing hand-written question\n>> [!success]- Answer\n>> A legacy answer\n\n";
	const managed = serializeReadableQuiz(document([fixtures[0].question]));
	assert.equal(removeManagedQuizText(legacy + managed).trim(), legacy.trim());
});

test("all advanced fronts include the context required to answer them", () => {
	const branch = describeQuestion(fixtures[7].question).context.join("\n");
	assert.match(branch, /Where\?/);
	assert.match(branch, /continue to step 2/);
	assert.match(branch, /finish scenario/);
	assert.match(describeQuestion(fixtures[10].question).context.join("\n"), /The Sun orbits Earth/);
	assert.match(describeQuestion(fixtures[11].question).context.join("\n"), /Earth rotates/);
	assert.match(describeQuestion(fixtures[12].question).context.join("\n"), /toward night/);
	assert.match(describeQuestion(fixtures[13].question).context.join("\n"), /Earth rotates/);
	assert.match(describeQuestion(fixtures[14].question).context.join("\n"), /Gravity/);
	assert.match(describeQuestion(fixtures[15].question).context.join("\n"), /Earth → Sun/);
	const whatIf = describeQuestion(fixtures[16].question).context.join("\n");
	assert.match(whatIf, /One rotation per day/);
	assert.match(whatIf, /Rotation slows/);
});

test("optional hints, explanations and source citations are readable and lossless", () => {
	const question = { ...fixtures[0].question, hint: "Think about planets.", explanation: "Earth orbits the Sun.", source: "Astronomy.md#Planets", difficulty: "easy" };
	const markdown = serializeReadableQuiz(document([question]));
	assert.match(markdown, /\[!tip\]- Hint/);
	assert.match(markdown, /\[!info\]- Source/);
	assert.match(markdown, /Astronomy.md#Planets/);
	assert.deepEqual(parse(findQuizBlocks(markdown)[0].source).questions[0], question);
});

test("false answers are not mistaken for missing data", () => {
	assert.deepEqual(describeQuestion({ question: "The Sun is a planet.", answer: false }).answers, ["False"]);
});

test("unknown formats use a clear fallback rather than dumping objects", () => {
	const view = describeQuestion({ type: "unknown-format", question: "Unrecognized question", answer: { nested: [1, 2, 3] } });
	assert.deepEqual(view.answers, ["Review this question in the quiz editor."]);
});

test("encoded metadata above the import limit is rejected before saving", () => {
	assert.throws(() => serializeReadableQuiz(document([{ question: "A very large question", answer: "<".repeat(400_000) }])), /too large/);
});
