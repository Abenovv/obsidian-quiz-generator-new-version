import type { QuizDocument, QuizQuestion } from "../continuation/types";

/** Human-readable views of a quiz. The original document remains authoritative. */
export type NoteQuestion = QuizQuestion;
export type NoteQuizDocument = QuizDocument;

export interface QuestionPresentation {
	type: string;
	label: string;
	prompt: string;
	context: string[];
	options: string[];
	answers: string[];
	explanation?: string;
	hint?: string;
	source?: string;
}

const labels: Record<string, string> = {
	"true-false": "True or false",
	"multiple-choice": "Multiple choice",
	"select-all": "Multiple answers",
	"fill-in-the-blank": "Fill in the blanks",
	matching: "Matching",
	"short-answer": "Short answer",
	"long-answer": "Long answer",
	"branching-scenario": "Branching scenario",
	sequencing: "Put in order",
	categorization: "Sort into groups",
	"error-correction": "Find the error",
	"assertion-reason": "Assertion and reason",
	prediction: "Predict the outcome",
	"evidence-selection": "Choose the evidence",
	"two-stage": "Answer and justify",
	"concept-map": "Concept map",
	"what-if": "What if?"
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): string => typeof value === "string" ? value : "";
const strings = (value: unknown): string[] => Array.isArray(value)
	? value.filter((item): item is string => typeof item === "string") : [];
const indices = (value: unknown): number[] => Array.isArray(value)
	? value.filter((item): item is number => Number.isInteger(item)) : [];

export function questionType(question: NoteQuestion): string {
	if (question.type) return question.type;
	if (Array.isArray(question.options)) return Array.isArray(question.answer) ? "select-all" : "multiple-choice";
	if (typeof question.answer === "boolean") return "true-false";
	if (Array.isArray(question.answer)) return question.answer.some(isRecord) ? "matching" : "fill-in-the-blank";
	// Legacy string answers have no length-based type distinction in the runtime.
	return "short-answer";
}

function selected(options: string[], value: unknown): string[] {
	if (typeof value === "number" && Number.isInteger(value)) return options[value] ? [options[value]] : [];
	return indices(value).flatMap(index => options[index] ? [options[index]] : []);
}

function contextField(question: NoteQuestion, key: string, label: string): string[] {
	const value = text(question[key]);
	return value ? [`**${label}**\n\n${value}`] : [];
}

export function describeQuestion(question: NoteQuestion): QuestionPresentation {
	const type = questionType(question);
	const options = strings(question.options);
	const result: QuestionPresentation = {
		type,
		label: labels[type] || "Question",
		prompt: question.question,
		context: [],
		options,
		answers: [],
		explanation: text(question.explanation) || undefined,
		hint: text(question.hint) || undefined,
		source: text(question.source) || undefined
	};
	const items = strings(question.items);
	switch (type) {
		case "true-false":
			result.answers = typeof question.answer === "boolean" ? [question.answer ? "True" : "False"] : [];
			break;
		case "short-answer":
		case "long-answer":
			result.answers = text(question.answer) ? [text(question.answer)] : [];
			break;
		case "fill-in-the-blank":
			result.answers = strings(question.answer).map((answer, index) => `${index + 1}. ${answer}`);
			break;
		case "matching": {
			const pairs = Array.isArray(question.answer) ? question.answer.filter(isRecord) : [];
			const left = pairs.map(pair => text(pair.leftOption));
			const right = pairs.map(pair => text(pair.rightOption));
			const arrangedRight = right.length > 1 ? [...right.slice(1), right[0]] : right;
			result.context = [
				`**Group A**\n\n${left.map((item, index) => `${index + 1}. ${item}`).join("\n")}`,
				`**Group B**\n\n${arrangedRight.map((item, index) => `${index + 1}. ${item}`).join("\n")}`
			];
			result.answers = pairs.map(pair => `${text(pair.leftOption)} → ${text(pair.rightOption)}`);
			break;
		}
		case "sequencing":
			result.options = items;
			result.answers = selected(items, question.answer).map((item, index) => `${index + 1}. ${item}`);
			break;
		case "categorization": {
			const categories = strings(question.categories);
			result.options = items;
			result.context = [`**Groups:** ${categories.join(" · ")}`];
			result.answers = indices(question.answer).map((category, index) => `${items[index]} → ${categories[category]}`);
			break;
		}
		case "branching-scenario": {
			const steps = Array.isArray(question.steps) ? question.steps.filter(isRecord) : [];
			const answers = indices(question.answer);
			result.context = steps.map((step, index) => {
				const next = Array.isArray(step.next) ? step.next : [];
				return `**Step ${index + 1}**\n\n${text(step.prompt)}\n\n${strings(step.options).map((option, choice) => `${choice + 1}. ${option} (${typeof next[choice] === "number" ? `continue to step ${Number(next[choice]) + 1}` : "finish scenario"})`).join("\n")}`;
			});
			result.answers = steps.flatMap((step, index) => {
				const answer = strings(step.options)[answers[index]];
				return answer ? [`Step ${index + 1}: ${answer}`] : [];
			});
			break;
		}
		case "error-correction":
			result.context = contextField(question, "passage", "Passage");
			result.answers = selected(options, question.answer);
			if (text(question.correction)) result.answers.push(text(question.correction));
			break;
		case "assertion-reason":
			result.context = [...contextField(question, "assertion", "Assertion"), ...contextField(question, "reason", "Reason")];
			result.answers = selected(options, question.answer);
			break;
		case "prediction":
			result.context = contextField(question, "context", "Context");
			result.answers = selected(options, question.answer);
			break;
		case "evidence-selection":
			result.context = contextField(question, "claim", "Claim");
			result.answers = selected(options, question.answer);
			break;
		case "two-stage": {
			const reasons = strings(question.reasons);
			result.context = [`**Reasons**\n\n${reasons.map((reason, index) => `${index + 1}. ${reason}`).join("\n")}`];
			result.answers = [...selected(options, question.answer), ...selected(reasons, question.reasonAnswer).map(reason => `Reason: ${reason}`)];
			break;
		}
		case "concept-map": {
			const nodes = strings(question.nodes);
			const links = Array.isArray(question.links) ? question.links.filter(isRecord) : [];
			const answers = indices(question.answer);
			const linkText = (link: Record<string, unknown>) => `${nodes[Number(link.from)]} → ${nodes[Number(link.to)]}`;
			result.context = [`**Relationships**\n\n${links.map((link, index) => `${index + 1}. ${linkText(link)}`).join("\n")}`];
			result.answers = links.map((link, index) => `${linkText(link)}: ${options[answers[index]]}`);
			break;
		}
		case "what-if":
			result.context = [...contextField(question, "context", "Context"), ...contextField(question, "baseline", "Starting point"), ...contextField(question, "change", "Change")];
			result.answers = selected(options, question.answer);
			break;
		default:
			result.answers = selected(options, question.answer);
	}
	if (!result.answers.length) result.answers = ["Review this question in the quiz editor."];
	return result;
}

export const READABLE_START = "<!-- quiz-generator:readable:start -->";
export const READABLE_END = "<!-- quiz-generator:readable:end -->";
export const DATA_START = "<!-- quiz-generator:data";

/** Encode HTML delimiters so question content cannot close our metadata comment. */
export function compactQuizData(document: NoteQuizDocument): string {
	return JSON.stringify(document).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/--/g, "\\u002d\\u002d");
}

/** Escape raw HTML while keeping operators inside Markdown code unchanged. */
function safeMarkdown(value: string): string {
	const escape = (part: string) => part.replace(/</g, "&lt;").replace(/>/g, "&gt;");
	let fence: { char: string; length: number } | undefined;
	return value.split(/\r?\n/).map(line => {
		const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line);
		if (fence) {
			if (marker && marker[1][0] === fence.char && marker[1].length >= fence.length && !line.slice(marker[0].length).trim()) fence = undefined;
			return line;
		}
		if (marker) { fence = { char: marker[1][0], length: marker[1].length }; return line; }
		let result = "";
		let cursor = 0;
		for (const match of line.matchAll(/(`+)(.*?)\1/g)) {
			const start = match.index || 0;
			result += escape(line.slice(cursor, start)) + match[0];
			cursor = start + match[0].length;
		}
		return result + escape(line.slice(cursor));
	}).join("\n");
}
const quote = (value: string, prefix: string): string => safeMarkdown(value).split(/\r?\n/).map(line => prefix + line).join("\n");

export function readableQuestionMarkdown(question: NoteQuestion, index: number): string {
	const presentation = describeQuestion(question);
	const [firstLine, ...otherLines] = presentation.prompt.split(/\r?\n/);
	const chunks = [`> [!question|qg-quiz] ${index + 1}. ${safeMarkdown(firstLine)}`, `> *${presentation.label}*`];
	if (otherLines.length) chunks.push(quote(otherLines.join("\n"), "> "));
	for (const context of presentation.context) chunks.push(">", quote(context, "> "));
	if (presentation.options.length) chunks.push(">", ...presentation.options.map((option, optionIndex) => quote(`${String.fromCharCode(97 + optionIndex)}) ${option}`, "> ")));
	if (presentation.hint) chunks.push(">", "> > [!tip]- Hint", quote(presentation.hint, "> > "));
	chunks.push(">", "> > [!success]- Answer", ...presentation.answers.map(answer => quote(answer, "> > ")));
	if (presentation.explanation) chunks.push("> >", quote(presentation.explanation, "> > "));
	if (presentation.source) chunks.push(">", "> > [!info]- Source", quote(presentation.source, "> > "));
	return chunks.join("\n") + "\n";
}

export function serializeReadableQuiz(document: NoteQuizDocument, renderQuestion: (question: NoteQuestion, index: number) => string = readableQuestionMarkdown): string {
	const data = compactQuizData(document);
	if (new TextEncoder().encode(data).length > 2 * 1024 * 1024) throw new Error("This quiz is too large to save in one note. Save fewer questions.");
	const provenance = document.provenance;
	const origin = isRecord(provenance) && provenance.kind === "ai" && typeof provenance.provider === "string"
		? `\n*Quiz created with ${safeMarkdown(provenance.provider)}${typeof provenance.model === "string" ? ` · ${safeMarkdown(provenance.model)}` : ""}.*\n` : "";
	return `\n${READABLE_START}\n${document.questions.map(renderQuestion).join("\n")}${origin}\n*Use Study studio to edit the questions and saved answers together.*\n${READABLE_END}\n\n${DATA_START}\n${data}\n-->\n`;
}

export interface QuizBlock {
	start: number;
	end: number;
	source: string;
	kind: "comment" | "fence";
}

/** Find only quiz payloads, skipping unrelated fenced Markdown/code. */
export function findQuizBlocks(markdown: string): QuizBlock[] {
	const blocks: QuizBlock[] = [];
	const lines = markdown.split(/(?<=\n)/);
	let offset = 0;
	let fence: { char: string; length: number; start: number; contentStart: number; quiz: boolean } | undefined;
	let comment: { start: number; contentStart: number } | undefined;
	for (const line of lines) {
		if (comment) {
			const end = line.indexOf("-->");
			if (end !== -1) {
				blocks.push({ start: comment.start, end: offset + end + 3, source: markdown.slice(comment.contentStart, offset + end).trim(), kind: "comment" });
				comment = undefined;
			}
		} else if (fence) {
			const close = /^ {0,3}(`{3,}|~{3,})[ \t]*(?:\r?\n)?$/.exec(line);
			if (close && close[1][0] === fence.char && close[1].length >= fence.length) {
				if (fence.quiz) blocks.push({ start: fence.start, end: offset + line.length, source: markdown.slice(fence.contentStart, offset).trim(), kind: "fence" });
				fence = undefined;
			}
		} else {
			const commentStart = line.indexOf(DATA_START);
			if (commentStart !== -1 && !line.slice(0, commentStart).trim()) {
				const contentStart = offset + commentStart + DATA_START.length;
				const end = line.indexOf("-->", commentStart + DATA_START.length);
				if (end !== -1) blocks.push({ start: offset + commentStart, end: offset + end + 3, source: markdown.slice(contentStart, offset + end).trim(), kind: "comment" });
				else comment = { start: offset + commentStart, contentStart };
			} else {
				const open = /^ {0,3}(`{3,}|~{3,})([^\r\n]*)(?:\r?\n)?$/.exec(line);
				if (open) fence = { char: open[1][0], length: open[1].length, start: offset, contentStart: offset + line.length, quiz: open[2].trim().toLowerCase() === "quiz-json" };
			}
		}
		offset += line.length;
	}
	return blocks;
}

export function removeManagedQuizText(markdown: string): string {
	let remaining = markdown;
	for (const block of findQuizBlocks(markdown).reverse()) remaining = remaining.slice(0, block.start) + remaining.slice(block.end);
	return remaining.replace(/^<!-- quiz-generator:readable:start -->\r?\n[\s\S]*?^<!-- quiz-generator:readable:end -->[ \t]*(?:\r?\n)?/gm, "");
}

/** Replace only valid quiz fences; invalid data and surrounding note text remain intact. */
export function makeQuizBlocksReadable(markdown: string, parse: (source: string) => NoteQuizDocument): { content: string; converted: number; errors: number } {
	let content = markdown;
	let converted = 0;
	let errors = 0;
	for (const block of findQuizBlocks(markdown).reverse()) {
		if (block.kind !== "fence") continue;
		try {
			const readable = serializeReadableQuiz(parse(block.source));
			content = content.slice(0, block.start) + readable + content.slice(block.end);
			converted++;
		} catch { errors++; }
	}
	return { content, converted, errors };
}
