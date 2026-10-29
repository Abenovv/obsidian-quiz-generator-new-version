import type { App, Plugin, PluginManifest, PluginSettingTab, TFile } from "obsidian";

/** Data crossing the pinned runtime boundary is validated before use. */
export interface QuizQuestion {
	[key: string]: unknown;
	type?: string;
	question: string;
	answer: unknown;
	options?: string[];
	explanation?: string;
	hint?: string;
	source?: string;
	difficulty?: string;
}

export interface QuizDocument {
	[key: string]: unknown;
	schemaVersion: 1;
	title: string;
	questions: QuizQuestion[];
	description?: string;
	createdAt?: string;
	sources?: string[];
	runConfig?: Record<string, unknown>;
}

export type RuntimeSettings = Record<string, unknown>;

export interface ContinuationPlugin extends Plugin {
	settings: RuntimeSettings;
	saveSettings(): Promise<void>;
	openJsonQuiz(document: QuizDocument): Promise<void>;
	openStudyStudio(): void;
	onload(): Promise<void>;
	onunload(): void;
}

export interface RuntimeQuizSaver {
	app: App;
	settings: RuntimeSettings;
	quizSources: TFile[];
	saveFilePath: string;
	validSavePath: boolean;
	getSaveFile(): Promise<TFile>;
	saveQuestion(question: QuizQuestion): Promise<void>;
	saveAllQuestions(questions: QuizQuestion[]): Promise<void>;
	createCalloutQuestion(question: QuizQuestion): string;
	createSpacedRepetitionQuestion(question: QuizQuestion): string;
}

export interface RuntimeQuizReviewer {
	app: App;
	settings: RuntimeSettings;
	quiz: QuizQuestion[];
	openQuiz(file: TFile | null): Promise<void>;
	calloutParser(text: string): void;
	spacedRepetitionParser(text: string): void;
}

export interface RuntimeGenerator {
	settings: RuntimeSettings;
	systemPrompt(): string;
	userPrompt(sources: string[]): string;
}

export interface RuntimeSettingsTab extends PluginSettingTab {
	plugin: ContinuationPlugin;
	activeSection: string;
}

export interface RuntimeQuizModal {
	quizDocument?: QuizDocument;
	quiz: QuizQuestion[];
	quizSaver: RuntimeQuizSaver;
	lastSession?: { document: QuizDocument; config: Record<string, unknown> };
	renderQuiz(session?: unknown): Promise<void>;
}

export interface RuntimeBridge {
	QuizSaver: {
		new (app: App, settings: RuntimeSettings, sources: TFile[]): RuntimeQuizSaver;
		prototype: RuntimeQuizSaver;
	};
	QuizReviewer: {
		new (app: App, settings: RuntimeSettings): RuntimeQuizReviewer;
		prototype: RuntimeQuizReviewer;
	};
	Generator: {
		new (settings: RuntimeSettings): RuntimeGenerator;
		prototype: RuntimeGenerator;
	};
	SettingsTab: {
		new (app: App, plugin: ContinuationPlugin): RuntimeSettingsTab;
		prototype: RuntimeSettingsTab;
	};
	QuizModal: {
		new (app: App, settings: RuntimeSettings, questions: QuizQuestion[], sources: TFile[], document?: QuizDocument): RuntimeQuizModal;
		prototype: RuntimeQuizModal;
	};
	parseQuizJson(text: string): QuizDocument;
	validateQuiz(value: unknown): QuizDocument;
	createQuizDocument(questions: QuizQuestion[], metadata?: Record<string, unknown>): QuizDocument;
	serializeQuizJson(value: QuizDocument | QuizQuestion[], metadata?: Record<string, unknown>): string;
	extractNoteQuizzes(text: string): { documents: QuizDocument[]; remaining: string; errors: string[] };
	questionType(question: QuizQuestion): string;
	createQuestionTemplate(type: string): QuizQuestion;
	defaultSettings: RuntimeSettings;
	activeModelSummary(settings: RuntimeSettings): string;
	GeneratorFactory: { createInstance(settings: RuntimeSettings): RuntimeGenerator & { generateQuiz(sources: string[]): Promise<unknown> } };
	selectedQuestionMethods(settings: RuntimeSettings): Array<{ type: string; count: number }>;
	inferQuestionType(question: QuizQuestion): string;
	replaceQuizValidator(wrap: (validate: (value: unknown) => QuizDocument) => (value: unknown) => QuizDocument): () => void;
	replaceQuizParser(wrap: (parse: (value: string) => QuizDocument) => (value: string) => QuizDocument): () => void;
}

export type RuntimePluginConstructor = new (app: App, manifest: PluginManifest) => ContinuationPlugin;
