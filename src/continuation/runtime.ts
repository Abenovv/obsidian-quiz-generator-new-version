import RuntimePlugin, { continuationRuntime } from "virtual:quiz-runtime";
import type { RuntimeBridge } from "./types";

/** Keep the compatibility seam narrow; new features live in typed modules. */
function checkedRuntime(value: RuntimeBridge): RuntimeBridge {
	const required: Array<keyof RuntimeBridge> = [
		"QuizSaver", "QuizReviewer", "Generator", "SettingsTab", "QuizModal",
		"parseQuizJson", "validateQuiz", "createQuizDocument", "serializeQuizJson"
	];
	for (const name of required) {
		if (typeof value[name] !== "function") {
			throw new Error(`Quiz Generator could not initialize its ${name} integration.`);
		}
	}
	return value;
}

export const BasePlugin = RuntimePlugin;
export const runtime = checkedRuntime(continuationRuntime);
