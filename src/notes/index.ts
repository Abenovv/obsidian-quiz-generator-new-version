import { MarkdownRenderChild, Notice, TFile } from "obsidian";
import type { ContinuationPlugin, QuizDocument, QuizQuestion, RuntimeBridge, RuntimeQuizModal, RuntimeQuizReviewer, RuntimeQuizSaver } from "../continuation/types";
import { describeQuestion, findQuizBlocks, makeQuizBlocksReadable, readableQuestionMarkdown, removeManagedQuizText, serializeReadableQuiz } from "./format";
import { renderQuizNote, renderQuizNoteError } from "./render";

export function installNoteExperience(plugin: ContinuationPlugin, runtime: RuntimeBridge): void {
	plugin.registerMarkdownCodeBlockProcessor("quiz-json", async (source, element, context) => {
		const child = new MarkdownRenderChild(element);
		context.addChild(child);
		try {
			const document = runtime.parseQuizJson(source);
			await renderQuizNote(document, element, plugin, runtime, context.sourcePath, child);
		} catch (error) {
			element.replaceChildren();
			renderQuizNoteError(source, element, error instanceof Error ? error.message : "Check the question structure and try again.");
		}
	});
	const saverContexts = installSaverContext(plugin, runtime);
	installReadableSaving(plugin, runtime, saverContexts);
	installNoteReader(plugin, runtime);
	plugin.addCommand({
		id: "make-saved-quiz-readable",
		name: "Make saved quiz readable",
		checkCallback: checking => {
			const file = plugin.app.workspace.getActiveFile();
			if (!file || file.extension !== "md") return false;
			if (!checking) void repairActiveNote(plugin, runtime, file);
			return true;
		}
	});
}

/** Keep the current quiz's origin and run configuration attached to its saver. */
function installSaverContext(plugin: ContinuationPlugin, runtime: RuntimeBridge): WeakMap<RuntimeQuizSaver, () => QuizDocument> {
	const contexts = new WeakMap<RuntimeQuizSaver, () => QuizDocument>();
	const prototype = runtime.QuizModal.prototype;
	const original = prototype.renderQuiz;
	const render = function (this: RuntimeQuizModal, session?: unknown): Promise<void> {
		const savedSession = session !== null && typeof session === "object" ? session as { document?: unknown; config?: unknown } : undefined;
		const initial = runtime.validateQuiz(savedSession?.document || this.quizDocument || runtime.createQuizDocument(this.quiz));
		const initialConfig = savedSession?.config && typeof savedSession.config === "object" && !Array.isArray(savedSession.config)
			? savedSession.config : initial.runConfig;
		contexts.set(this.quizSaver, () => {
			const active = this.lastSession;
			return active
				? runtime.validateQuiz({ ...active.document, runConfig: active.config })
				: runtime.validateQuiz({ ...initial, ...(initialConfig ? { runConfig: initialConfig } : {}) });
		});
		return original.call(this, session);
	};
	prototype.renderQuiz = render;
	plugin.register(() => { if (prototype.renderQuiz === render) prototype.renderQuiz = original; });
	return contexts;
}

/** Patch only our pinned saver class, and restore its methods on plugin unload. */
function installReadableSaving(plugin: ContinuationPlugin, runtime: RuntimeBridge, contexts: WeakMap<RuntimeQuizSaver, () => QuizDocument>): void {
	const prototype = runtime.QuizSaver.prototype;
	const originalSingle = prototype.saveQuestion;
	const originalAll = prototype.saveAllQuestions;
	async function save(saver: RuntimeQuizSaver, questions: QuizQuestion[]): Promise<void> {
		if (!questions.length) return;
		const current = contexts.get(saver)?.();
		const document = runtime.createQuizDocument(questions, {
			...current,
			title: current?.title || saver.saveFilePath.split("/").pop()?.replace(/\.md$/i, "") || "Saved quiz",
			sources: current?.sources || saver.quizSources.map(file => file.path)
		});
		let renderQuestion = readableQuestionMarkdown;
		if (saver.settings.saveFormat === "Spaced Repetition") {
			// Keep existing spaced-repetition syntax for the original seven formats.
			// Advanced formats receive a complete multiline front and back.
			renderQuestion = question => {
				const view = describeQuestion(question);
				if (["true-false", "multiple-choice", "select-all", "fill-in-the-blank", "matching", "short-answer", "long-answer"].includes(view.type)) {
					return saver.createSpacedRepetitionQuestion(question);
				}
				const separator = typeof saver.settings.multilineSeparator === "string" ? saver.settings.multilineSeparator : "?";
				const choices = view.options.map((option, choice) => `${String.fromCharCode(97 + choice)}) ${option}`);
				return `**${view.label}:** ${view.prompt}\n\n${[...view.context, ...choices].join("\n\n")}\n${separator}\n${view.answers.join("\n\n")}${view.explanation ? `\n\n${view.explanation}` : ""}\n\n`;
			};
		}
		const content = serializeReadableQuiz(document, renderQuestion);
		const file = await saver.getSaveFile();
		await saver.app.vault.append(file, content);
		new Notice(saver.validSavePath ? (questions.length === 1 ? "Question saved" : "Quiz saved") : "Save folder unavailable. Quiz saved in the vault root.");
	}
	const single = function (this: RuntimeQuizSaver, question: QuizQuestion): Promise<void> { return save(this, [question]); };
	const all = function (this: RuntimeQuizSaver, questions: QuizQuestion[]): Promise<void> { return save(this, questions); };
	prototype.saveQuestion = single;
	prototype.saveAllQuestions = all;
	plugin.register(() => {
		if (prototype.saveQuestion === single) prototype.saveQuestion = originalSingle;
		if (prototype.saveAllQuestions === all) prototype.saveAllQuestions = originalAll;
	});
}

function installNoteReader(plugin: ContinuationPlugin, runtime: RuntimeBridge): void {
	const prototype = runtime.QuizReviewer.prototype;
	const original = prototype.openQuiz;
	const reader = async function (this: RuntimeQuizReviewer, file: TFile | null): Promise<void> {
		if (!(file instanceof TFile)) { new Notice("Select a quiz note first."); return; }
		try {
			const markdown = await this.app.vault.cachedRead(file);
			const blocks = findQuizBlocks(markdown);
			if (!blocks.length) { await original.call(this, file); return; }
			const documents: QuizDocument[] = [];
			let invalid = 0;
			for (const block of blocks) {
				try { documents.push(runtime.parseQuizJson(block.source)); }
				catch { invalid++; }
			}
			this.quiz.length = 0;
			const remaining = removeManagedQuizText(markdown);
			this.calloutParser(remaining);
			this.spacedRepetitionParser(remaining);
			if (invalid) new Notice(`${invalid === 1 ? "One saved quiz could" : `${invalid} saved quizzes could`} not be read. Check the quiz data in the note.`);
			if (!documents.length && !this.quiz.length) { new Notice("No readable questions in this note."); return; }
			// Preserve timers, title, sources, and all metadata for a standalone quiz.
			const document = documents.length === 1 && !this.quiz.length ? documents[0] : runtime.createQuizDocument(
				[...documents.flatMap(item => item.questions), ...this.quiz],
				{ title: file.basename.slice(0, 200), sources: [...new Set([...documents.flatMap(item => item.sources || []), file.path])] }
			);
			await plugin.openJsonQuiz(document);
		} catch (error) {
			new Notice(error instanceof Error ? error.message : "Could not open this quiz note.");
		}
	};
	prototype.openQuiz = reader;
	plugin.register(() => { if (prototype.openQuiz === reader) prototype.openQuiz = original; });
}

async function repairActiveNote(plugin: ContinuationPlugin, runtime: RuntimeBridge, file: TFile): Promise<void> {
	try {
		let converted = 0;
		let errors = 0;
		await plugin.app.vault.process(file, markdown => {
			const result = makeQuizBlocksReadable(markdown, runtime.parseQuizJson);
			converted = result.converted;
			errors = result.errors;
			return result.content;
		});
		const result = converted ? `${converted === 1 ? "Quiz is" : `${converted} quizzes are`} now readable.` : "No quiz JSON blocks to convert.";
		new Notice(result + (errors ? ` ${errors === 1 ? "One invalid block was" : `${errors} invalid blocks were`} kept unchanged.` : ""));
	} catch (error) {
		new Notice(error instanceof Error ? error.message : "Could not update this quiz note.");
	}
}
