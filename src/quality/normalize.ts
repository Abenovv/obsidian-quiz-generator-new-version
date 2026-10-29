import type { QuizDocument, QuizQuestion, RuntimeSettings } from "../continuation/types";

export const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_QUESTIONS = 500;
const MAX_JSON_DEPTH = 128;

export const QUESTION_TYPES = [
	"true-false", "multiple-choice", "select-all", "fill-in-the-blank", "matching",
	"short-answer", "long-answer", "branching-scenario", "sequencing", "categorization",
	"error-correction", "assertion-reason", "prediction", "evidence-selection",
	"two-stage", "concept-map", "what-if"
] as const;

const TYPE_FIELDS: Record<string, readonly string[]> = {
	"true-false": [], "multiple-choice": ["options"], "select-all": ["options"],
	"fill-in-the-blank": [], matching: [], "short-answer": [], "long-answer": [],
	"branching-scenario": ["steps"], sequencing: ["items"], categorization: ["items", "categories"],
	"error-correction": ["passage", "options", "correction"],
	"assertion-reason": ["assertion", "reason", "options"], prediction: ["context", "options"],
	"evidence-selection": ["claim", "options"], "two-stage": ["options", "reasons", "reasonAnswer"],
	"concept-map": ["nodes", "links", "options"], "what-if": ["context", "baseline", "change", "options"]
};

const MODEL_FIELDS = {
	OPENAI: ["OpenAI", "openAITextGenModel"], GOOGLE: ["Google", "googleTextGenModel"],
	ANTHROPIC: ["Anthropic", "anthropicTextGenModel"], MISTRAL: ["Mistral", "mistralTextGenModel"],
	COHERE: ["Cohere", "cohereTextGenModel"], PERPLEXITY: ["Perplexity", "perplexityTextGenModel"],
	OLLAMA: ["Ollama", "ollamaTextGenModel"]
} as const;

export interface AiProvenance {
	kind: "ai";
	provider: string;
	model?: string;
	generatedAt: string;
}

export interface RequestedMethod { type: string; count: number }
export interface GenerationOptions {
	methods: RequestedMethod[];
	includeHints: boolean;
	includeExplanations: boolean;
	sourceIdentifiers?: ReadonlySet<string>;
	provenance: AiProvenance;
}

export interface QualityRuntime {
	validateQuiz(value: unknown): QuizDocument;
	questionType(question: QuizQuestion): string;
}

export interface SourceEntry { path: string; extension?: string; children?: SourceEntry[] }

/** Source inventory comes from selected paths, never from headers embedded in note text. */
export function selectedSourceIdentifiers(
	materials: string[],
	resolve: (path: string) => SourceEntry | null,
	includeSubfolders: boolean
): ReadonlySet<string> {
	const result = new Set<string>();
	for (const material of materials) {
		const match = /^SOURCE: ([^\r\n]+)(?:\r?\n|$)/.exec(material);
		if (!match) continue;
		const entry = resolve(match[1]);
		if (!entry) continue;
		if (entry.extension === "md") { result.add(entry.path); continue; }
		if (!Array.isArray(entry.children)) continue;
		const pending = [...entry.children];
		const seen = new Set<SourceEntry>();
		while (pending.length) {
			const child = pending.pop();
			if (!child || seen.has(child)) continue;
			seen.add(child);
			if (child.extension === "md") result.add(child.path);
			else if (includeSubfolders && Array.isArray(child.children)) pending.push(...child.children);
		}
	}
	return result;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonContainer(value: unknown): value is Record<string, unknown> | unknown[] {
	return Array.isArray(value) || isRecord(value);
}

/** Extract one complete JSON container. Never guess missing commas, brackets, or escapes. */
export function extractJsonResponse(text: string): Record<string, unknown> | unknown[] {
	if (new TextEncoder().encode(text).length > MAX_RESPONSE_BYTES) {
		throw new Error("The model response exceeds 2 MiB. Request fewer questions.");
	}
	const input = text.replace(/^\uFEFF/, "").trim();
	if (!input) throw new Error("The model returned no quiz. Try different source notes or request fewer questions.");
	// The same balanced scan handles plain JSON and surrounding narration, with one depth limit.
	const candidates: Array<Record<string, unknown> | unknown[]> = [];
	let start = -1;
	const stack: string[] = [];
	let quoted = false;
	let escaped = false;
	for (let index = 0; index < input.length; index++) {
		const char = input[index];
		if (start < 0) {
			if (char === "{" || char === "[") { start = index; stack.push(char); }
			continue;
		}
		if (quoted) {
			if (escaped) escaped = false;
			else if (char === "\\") escaped = true;
			else if (char === '"') quoted = false;
			continue;
		}
		if (char === '"') { quoted = true; continue; }
		if (char === "{" || char === "[") {
			stack.push(char);
			if (stack.length > MAX_JSON_DEPTH) throw new Error("The model response is too deeply nested. Request a simpler quiz.");
		} else if (char === "}" || char === "]") {
			const opening = stack.pop();
			if ((char === "}" && opening !== "{") || (char === "]" && opening !== "[")) {
				throw new Error("The model returned malformed JSON. Regenerate the quiz; answers were not changed.");
			}
			if (stack.length === 0) {
				try {
					const candidate: unknown = JSON.parse(input.slice(start, index + 1));
					if (isJsonContainer(candidate)) candidates.push(candidate);
				} catch { /* Ignore bracketed prose; it is not a JSON document. */ }
				start = -1;
			}
		}
	}
	if (start >= 0 || quoted) throw new Error("The model response is incomplete. Request fewer questions and try again.");
	if (candidates.length !== 1) {
		throw new Error(candidates.length > 1
			? "The model returned several JSON documents. Request one quiz and try again."
			: "The model returned no valid quiz JSON. Try again or choose another model.");
	}
	return candidates[0];
}

export function validateAiProvenance(value: unknown): AiProvenance {
	if (!isRecord(value) || Object.keys(value).some(key => !["kind", "provider", "model", "generatedAt"].includes(key))) {
		throw new Error("Quiz provenance must contain only kind, provider, model, and generatedAt.");
	}
	const providerNames: readonly string[] = Object.values(MODEL_FIELDS).map(([name]) => name);
	if (value.kind !== "ai" || typeof value.provider !== "string" || !providerNames.includes(value.provider)) {
		throw new Error("Quiz provenance needs a supported AI provider.");
	}
	if (typeof value.generatedAt !== "string"
		|| !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value.generatedAt)
		|| !Number.isFinite(Date.parse(value.generatedAt))) {
		throw new Error("Quiz provenance needs a valid generation time.");
	}
	const result: AiProvenance = { kind: "ai", provider: value.provider, generatedAt: value.generatedAt };
	if (value.model !== undefined) {
		if (typeof value.model !== "string" || value.model.length === 0 || value.model.length > 200
			|| /[\u0000-\u001f\u007f]/.test(value.model)
			|| /AIza[0-9A-Za-z_-]{20,}|(?:sk-|ghp_|github_pat_)[A-Za-z0-9_-]{20,}/.test(value.model)) {
			throw new Error("Quiz provenance has an invalid model identifier.");
		}
		result.model = value.model;
	}
	return result;
}

/** Reads only the selected provider/model fields. API key fields never enter provenance. */
export function provenanceFromSettings(settings: RuntimeSettings, date = new Date()): AiProvenance {
	if (typeof settings.provider !== "string" || !Object.hasOwn(MODEL_FIELDS, settings.provider)) {
		throw new Error("Choose a supported generation provider first.");
	}
	const entry = MODEL_FIELDS[settings.provider as keyof typeof MODEL_FIELDS];
	const [provider, modelField] = entry;
	const model = settings[modelField];
	return validateAiProvenance({
		kind: "ai", provider, generatedAt: date.toISOString(),
		...(typeof model === "string" && model.trim() ? { model: model.trim() } : {})
	});
}

export function validateWithProvenance(value: unknown, validate: (input: unknown) => QuizDocument): QuizDocument {
	if (!isRecord(value) || value.provenance === undefined) return validate(value);
	const { provenance, ...document } = value;
	const origin = validateAiProvenance(provenance);
	return { ...validate(document), provenance: origin };
}

function cleanQuestion(value: unknown, options: GenerationOptions, runtime: QualityRuntime): Record<string, unknown> {
	if (!isRecord(value)) throw new Error("The model returned an invalid question. Regenerate the quiz.");
	if (value.answer === undefined || value.answer === null || typeof value.question !== "string") {
		throw new Error("The model returned a question without its text or answer. Regenerate the quiz.");
	}
	let type: string;
	try { type = runtime.questionType(value as QuizQuestion); }
	catch { throw new Error("The model returned an invalid question format. Regenerate the quiz."); }
	const fields = TYPE_FIELDS[type];
	if (!fields) throw new Error("The model returned an unsupported question format. Use one of the selected formats.");
	const allowed = ["type", "question", "answer", "hint", "explanation", "source", "difficulty", ...fields];
	const result = Object.fromEntries(Object.entries(value).filter(([key]) => allowed.includes(key)));
	result.type = type;
	for (const optional of ["hint", "explanation", "source", "difficulty"] as const) {
		if (typeof result[optional] === "string") {
			const trimmed = result[optional].trim();
			if (trimmed) result[optional] = trimmed;
			else delete result[optional];
		} else if (result[optional] === null) delete result[optional];
	}
	if (!options.includeHints) delete result.hint;
	if (!options.includeExplanations) delete result.explanation;
	if (typeof result.source === "string" && !options.sourceIdentifiers?.has(result.source)) delete result.source;
	if (type === "branching-scenario" && Array.isArray(result.steps)) {
		result.steps = result.steps.map(step => isRecord(step)
			? Object.fromEntries(Object.entries(step).filter(([key]) => ["prompt", "options", "next"].includes(key))) : step);
	}
	if (type === "concept-map" && Array.isArray(result.links)) {
		result.links = result.links.map(link => isRecord(link)
			? Object.fromEntries(Object.entries(link).filter(([key]) => ["from", "to"].includes(key))) : link);
	}
	if (type === "matching" && Array.isArray(result.answer)) {
		result.answer = result.answer.map(pair => isRecord(pair)
			? Object.fromEntries(Object.entries(pair).filter(([key]) => ["leftOption", "rightOption"].includes(key))) : pair);
	}
	return result;
}

/** Stable identity keeps case, code, escapes, and context intact. Only optional teaching metadata is excluded. */
function stableValue(value: unknown): string {
	if (Array.isArray(value)) return "[" + value.map(stableValue).join(",") + "]";
	if (isRecord(value)) return "{" + Object.keys(value).sort().map(key => JSON.stringify(key) + ":" + stableValue(value[key])).join(",") + "}";
	return JSON.stringify(value);
}

function questionIdentity(question: QuizQuestion): string {
	const context = Object.fromEntries(Object.entries(question).filter(([key]) => !["answer", "reasonAnswer", "explanation", "hint", "difficulty", "source"].includes(key)));
	if (question.type === "matching" && Array.isArray(question.answer)) {
		context.matchingTerms = question.answer.map(pair => isRecord(pair) ? pair.leftOption : pair);
		context.matchingOptions = question.answer.map(pair => isRecord(pair) ? pair.rightOption : pair).sort();
	}
	return stableValue(context);
}

export function normalizeGeneratedQuiz(text: string, options: GenerationOptions, runtime: QualityRuntime): QuizDocument {
	const requested = new Map<string, number>();
	for (const method of options.methods) {
		if (!QUESTION_TYPES.includes(method.type as typeof QUESTION_TYPES[number])
			|| !Number.isInteger(method.count) || method.count < 1 || method.count > MAX_QUESTIONS || requested.has(method.type)) {
			throw new Error("Choose valid question counts before generating.");
		}
		requested.set(method.type, method.count);
	}
	const total = [...requested.values()].reduce((sum, count) => sum + count, 0);
	if (total < 1 || total > MAX_QUESTIONS) throw new Error("Choose between 1 and 500 questions before generating.");
	const parsed = extractJsonResponse(text);
	const rawQuestions = Array.isArray(parsed) ? parsed : parsed.questions;
	if (!Array.isArray(rawQuestions) || !rawQuestions.length) {
		throw new Error("The model returned no questions. Try different source notes or request fewer questions.");
	}
	if (rawQuestions.length > MAX_QUESTIONS) throw new Error("The model returned more than 500 questions. Request a smaller quiz.");
	const output: QuizQuestion[] = [];
	const counts = new Map<string, number>();
	const unique = new Map<string, string>();
	for (const raw of rawQuestions) {
		const question = cleanQuestion(raw, options, runtime);
		const type = runtime.questionType(question as QuizQuestion);
		const wanted = requested.get(type);
		if (wanted === undefined) continue;
		// Validate before counting or capping. A broken answer must never be silently repaired.
		const valid = runtime.validateQuiz({ questions: [question] }).questions[0];
		const identity = questionIdentity(valid);
		const answers = stableValue([valid.answer, valid.reasonAnswer]);
		const previous = unique.get(identity);
		if (previous !== undefined) {
			if (previous !== answers) throw new Error("The model repeated a question with conflicting answers. Regenerate the quiz.");
			continue;
		}
		unique.set(identity, answers);
		if ((counts.get(type) ?? 0) >= wanted) continue;
		counts.set(type, (counts.get(type) ?? 0) + 1);
		output.push(valid);
	}
	const missing = [...requested].filter(([type, count]) => (counts.get(type) ?? 0) !== count);
	if (missing.length) {
		const [type, count] = missing[0];
		const received = counts.get(type) ?? 0;
		throw new Error(`The model supplied ${received} unique ${type.replace(/-/g, " ")} ${received === 1 ? "question" : "questions"}; ${count} ${count === 1 ? "was" : "were"} requested. Request fewer questions or regenerate.`);
	}
	return runtime.validateQuiz({ schemaVersion: 1, title: "Generated quiz", questions: output, provenance: options.provenance });
}
