import type { ContinuationPlugin, RuntimeBridge, RuntimeGenerator, RuntimeSettings } from "../continuation/types";
import { normalizeGeneratedQuiz, provenanceFromSettings, selectedSourceIdentifiers, validateWithProvenance, type SourceEntry } from "./normalize";

const QUALITY_INSTRUCTIONS = [
	"Keep the quiz concise: no introductions, summaries, grading rubrics, confidence scores, or decorative fields.",
	"Use the exact question shapes and counts requested. Do not add extra methods or repeat questions with different wording.",
	"Ask a direct question. Avoid filler such as 'according to the provided text' unless attribution is essential to the question.",
	"Proofread the requested language before returning JSON. Preserve quoted wording, code identifiers, and domain terms rather than correcting them by guesswork.",
	"Keep answer explanations brief. Never invent a source, reference, model name, or generation history; the application records provenance.",
	"Preserve technical spelling, capitalization, code, mathematical notation, and the source's stated uncertainty. Do not guess when evidence is missing."
].join("\n");

/** All behavior changes are scoped to the pinned runtime and restored when the plugin unloads. */
export function installGenerationQuality(plugin: ContinuationPlugin, runtime: RuntimeBridge): void {
	const restoreValidator = runtime.replaceQuizValidator(validate => value => validateWithProvenance(value, validate));
	plugin.register(restoreValidator);
	const prototype = runtime.Generator.prototype;
	const originalPrompt = prototype.systemPrompt;
	const enhancedPrompt = function (this: RuntimeGenerator): string {
		return originalPrompt.call(this) + "\n\n" + QUALITY_INSTRUCTIONS;
	};
	prototype.systemPrompt = enhancedPrompt;
	plugin.register(() => { if (prototype.systemPrompt === enhancedPrompt) prototype.systemPrompt = originalPrompt; });
	const factory = runtime.GeneratorFactory;
	const originalCreate = factory.createInstance;
	let disposed = false;
	const create = function (settings: RuntimeSettings): ReturnType<typeof originalCreate> {
		const generator = originalCreate.call(factory, settings);
		const generate = generator.generateQuiz;
		generator.generateQuiz = async function (sources: string[]): Promise<string> {
			const methods = runtime.selectedQuestionMethods(settings).map(method => ({ ...method }));
			const includeHints = settings.includeHints === true;
			const includeExplanations = settings.includeExplanations === true;
			const provenance = provenanceFromSettings(settings);
			const sourceIdentifiers = selectedSourceIdentifiers(sources, path => plugin.app.vault.getAbstractFileByPath(path) as SourceEntry | null, settings.includeSubfolderNotes === true);
			const result: unknown = await generate.call(this, sources);
			if (disposed) throw new Error("Quiz Generator was reloaded. Generate the quiz again.");
			if (typeof result !== "string") throw new Error("The model returned no quiz. Try again or choose another model.");
			const document = normalizeGeneratedQuiz(result, { methods, includeHints, includeExplanations, sourceIdentifiers, provenance }, runtime);
			return runtime.serializeQuizJson(document);
		};
		return generator;
	};
	factory.createInstance = create;
	plugin.register(() => {
		disposed = true;
		if (factory.createInstance === create) factory.createInstance = originalCreate;
	});
}
