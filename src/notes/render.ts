import { MarkdownRenderer, type Component } from "obsidian";
import type { ContinuationPlugin, RuntimeBridge } from "../continuation/types";
import { describeQuestion, type NoteQuizDocument, type NoteQuestion } from "./format";

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, parent: HTMLElement, text?: string): HTMLElementTagNameMap[K] {
	const node = document.createElement(tag);
	node.className = className;
	if (text !== undefined) node.textContent = text;
	parent.append(node);
	return node;
}

/** The renderer uses Obsidian's sanitized Markdown path, never raw innerHTML. */
export async function renderQuizNote(
	quiz: NoteQuizDocument,
	container: HTMLElement,
	plugin: ContinuationPlugin,
	runtime: RuntimeBridge,
	sourcePath: string,
	component: Component
): Promise<void> {
	let disposed = false;
	component.register(() => { disposed = true; });
	const root = element("section", "qg-note-quiz", container);
	root.setAttribute("aria-label", quiz.title);
	const header = element("header", "qg-note-header", root);
	element("h3", "qg-note-title", header, quiz.title);
	element("p", "qg-note-meta", header, `${quiz.questions.length} ${quiz.questions.length === 1 ? "question" : "questions"}`);
	if (quiz.description) await MarkdownRenderer.render(plugin.app, quiz.description, element("div", "qg-note-description", header), sourcePath, component);
	const actions = element("div", "qg-note-actions", header);
	const study = element("button", "mod-cta", actions, "Study quiz");
	study.type = "button";
	const status = element("p", "qg-note-status", header);
	status.setAttribute("role", "status");
	status.setAttribute("aria-live", "polite");
	component.registerDomEvent(study, "click", () => {
		study.disabled = true;
		status.textContent = "";
		void plugin.openJsonQuiz(quiz).catch(error => {
			if (!disposed) status.textContent = error instanceof Error ? error.message : "Could not open this quiz.";
		}).finally(() => { if (!disposed) study.disabled = false; });
	});
	if (quiz.sources?.length) {
		const sources = element("details", "qg-note-sources", header);
		element("summary", "", sources, "Sources");
		const list = element("ul", "", sources);
		for (const source of quiz.sources) element("li", "", list, source);
	}
	const provenance = quiz.provenance;
	if (provenance && typeof provenance === "object" && !Array.isArray(provenance)) {
		const origin = provenance as Record<string, unknown>;
		if (origin.kind === "ai" && typeof origin.provider === "string") {
			const details = element("details", "qg-note-sources", header);
			element("summary", "", details, `Quiz created with ${origin.provider}`);
			if (typeof origin.model === "string") element("p", "qg-note-meta", details, `Model: ${origin.model}`);
			if (typeof origin.generatedAt === "string" && Number.isFinite(Date.parse(origin.generatedAt))) element("p", "qg-note-meta", details, new Date(origin.generatedAt).toLocaleString());
		}
	}
	const questions = element("div", "qg-note-questions", root);
	let shown = 0;
	const loadMore = element("button", "qg-note-load-more", root, "Show more questions");
	loadMore.type = "button";
	const showBatch = async (): Promise<void> => {
		loadMore.disabled = true;
		const limit = Math.min(shown + 25, quiz.questions.length);
		for (; shown < limit && !disposed; shown++) {
			await renderQuestion(quiz.questions[shown], shown, questions, plugin, sourcePath, component, () => disposed);
		}
		if (disposed) return;
		loadMore.hidden = shown >= quiz.questions.length;
		loadMore.textContent = `Show ${Math.min(25, quiz.questions.length - shown)} more questions`;
		loadMore.disabled = false;
	};
	component.registerDomEvent(loadMore, "click", () => { void showBatch(); });
	const raw = element("details", "qg-note-raw", root);
	element("summary", "", raw, "Quiz data");
	let rawRendered = false;
	component.registerDomEvent(raw, "toggle", () => {
		if (!raw.open || rawRendered || disposed) return;
		rawRendered = true;
		const explanation = element("p", "qg-note-meta", raw, "Structured data for editing or export.");
		explanation.setAttribute("role", "note");
		const pre = element("pre", "", raw);
		element("code", "language-json", pre, runtime.serializeQuizJson(quiz));
	});
	await showBatch();
}

async function renderQuestion(
	question: NoteQuestion,
	index: number,
	parent: HTMLElement,
	plugin: ContinuationPlugin,
	sourcePath: string,
	component: Component,
	isDisposed: () => boolean
): Promise<void> {
	const view = describeQuestion(question);
	const article = element("article", "qg-note-question", parent);
	const heading = element("div", "qg-note-question-heading", article);
	element("span", "qg-note-number", heading, String(index + 1));
	element("span", "qg-note-type", heading, view.label);
	const render = (markdown: string, target: HTMLElement): Promise<void> => MarkdownRenderer.render(plugin.app, markdown, target, sourcePath, component);
	await render(view.prompt, element("div", "qg-note-prompt", article));
	for (const context of view.context) await render(context, element("div", "qg-note-context", article));
	if (view.options.length) {
		const choices = element("ol", "qg-note-options", article);
		choices.setAttribute("type", "a");
		for (const option of view.options) await render(option, element("li", "", choices));
	}
	if (view.hint) {
		const hint = element("details", "qg-note-hint", article);
		element("summary", "", hint, "Hint");
		await render(view.hint, element("div", "qg-note-hint-body", hint));
	}
	const answer = element("details", "qg-note-answer", article);
	const summary = element("summary", "", answer, "Answer");
	summary.dataset.qgFeedback = "reveal";
	const body = element("div", "qg-note-answer-body", answer);
	let answerRendered = false;
	component.registerDomEvent(answer, "toggle", () => {
		if (!answer.open || answerRendered || isDisposed()) return;
		answerRendered = true;
		void (async () => {
			for (const line of view.answers) {
				if (isDisposed()) return;
				await render(line, element("div", "qg-note-answer-line", body));
			}
			if (view.explanation && !isDisposed()) await render(view.explanation, element("div", "qg-note-explanation", body));
		})().catch(() => { if (!isDisposed()) body.textContent = "The answer could not be displayed. Open this quiz to review it."; });
	});
	if (view.source) {
		const source = element("details", "qg-note-sources", article);
		element("summary", "", source, "Source");
		await render(view.source, element("div", "", source));
	}
}

export function renderQuizNoteError(source: string, container: HTMLElement, message: string): void {
	const root = element("section", "qg-note-quiz qg-note-error", container);
	element("p", "", root, "This saved quiz could not be read.");
	element("p", "qg-note-meta", root, message);
	const raw = element("details", "qg-note-raw", root);
	element("summary", "", raw, "Show quiz data");
	element("code", "language-json", element("pre", "", raw), source);
}
