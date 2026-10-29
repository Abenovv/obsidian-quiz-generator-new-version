import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const vendorPath = fileURLToPath(new URL("../vendor/runtime-3.0.1.cjs", import.meta.url));
export const VENDOR_SHA256 = "bada1e53682595f36a6b07448b8d27c7e67bea74e05bb70dc29d72bba6b8bfbd";
export const VENDOR_CSS_SHA256 = "8b8c3c50d4fa5015f3a069944bd28df0377ca5737fd5b50ea3867ed3b68daa7f";

/** Adapt an immutable, hash-pinned distribution without editing generated code. */
export async function bridgedRuntimeSource() {
	const bytes = await readFile(vendorPath);
	const digest = createHash("sha256").update(bytes).digest("hex");
	if (digest !== VENDOR_SHA256) {
		throw new Error("The compatibility runtime differs from the reviewed 3.0.1 distribution.");
	}
	const source = bytes.toString("utf8");
	const signatures = ["var pi=class", "var Yr=class", "he=class", "var Ei=class", "function Ge(", "function Be(", "function Qt(", "function Qi("];
	for (const signature of signatures) {
		if (!source.includes(signature)) throw new Error("A required runtime integration is unavailable: " + signature);
	}
	return source + `\n;rn();Pa();\nmodule.exports.continuationRuntime = {\n`
		+ ` QuizSaver: pi, QuizReviewer: Yr, Generator: he, SettingsTab: Ei, QuizModal: at,\n`
		+ ` parseQuizJson(value){return Ge(value)}, validateQuiz(value){return Be(value)},\n`
		+ ` createQuizDocument(value,meta){return Qt(value,meta)}, serializeQuizJson(value,meta){return Qi(value,meta)},\n`
		+ ` extractNoteQuizzes: dh, questionType: me, createQuestionTemplate: Di,\n`
		+ ` defaultSettings: Na, activeModelSummary: ar, GeneratorFactory: cr,\n`
		+ ` selectedQuestionMethods: kt, inferQuestionType: me,\n`
		+ ` replaceQuizValidator(wrap){const previous=Be;const next=wrap(previous);if(typeof next!=="function")throw new Error("Invalid quiz validator integration");Be=next;return()=>{if(Be===next)Be=previous}},\n`
		+ ` replaceQuizParser(wrap){const previous=Ge;const next=wrap(previous);if(typeof next!=="function")throw new Error("Invalid quiz parser integration");Ge=next;return()=>{if(Ge===next)Ge=previous}}\n};\n`;
}

export function runtimeBridgePlugin() {
	return {
		name: "quiz-generator-compatibility",
		setup(build) {
			build.onResolve({ filter: /^virtual:quiz-runtime$/ }, () => ({ path: "runtime", namespace: "quiz-runtime" }));
			build.onLoad({ filter: /.*/, namespace: "quiz-runtime" }, async () => ({
				contents: await bridgedRuntimeSource(), loader: "js", resolveDir: fileURLToPath(new URL("../", import.meta.url))
			}));
		}
	};
}
