import QuizGeneratorContinued from "../src/continuation/main";
import { runtime } from "../src/continuation/runtime";
import { Component, Modal, Notice, TFile, TFolder } from "./obsidian";

async function boot(): Promise<void> {
const root = document.querySelector<HTMLElement>("#preview-root")!;
const methods = ["true-false", "multiple-choice", "select-all", "fill-in-the-blank", "matching", "short-answer", "long-answer", "branching-scenario", "sequencing", "categorization", "error-correction", "assertion-reason", "prediction", "evidence-selection", "two-stage", "concept-map", "what-if"];
const memory = new Map<string, string>();
const rootFolder = new TFolder("");
const sampleFile = new TFile("Astronomy/Observing the sky.md");
sampleFile.parent = rootFolder;
rootFolder.children.push(sampleFile);
memory.set(sampleFile.path, "# Observing the sky\n\nEarth rotates on its axis, creating day and night. It orbits the Sun.\n\nThe inner planets in order are Mercury, Venus, Earth, and Mars.\n\nChoose a safe observing location and allow your eyes to adjust to darkness.");

const app: any = {
	vault: {
		configDir: ".obsidian",
		adapter: {
			exists: async (path: string) => memory.has(path),
			read: async (path: string) => memory.get(path) || "",
			write: async (path: string, value: string) => { memory.set(path, value); },
			mkdir: async () => undefined,
			stat: async (path: string) => memory.has(path) ? { type: "file", size: memory.get(path)!.length, ctime: Date.now(), mtime: Date.now() } : null
		},
		getRoot: () => rootFolder,
		getName: () => "Interface preview",
		getMarkdownFiles: () => [sampleFile],
		getAllFolders: () => [rootFolder],
		getAbstractFileByPath: (path: string) => path === "" ? rootFolder : path === sampleFile.path ? sampleFile : memory.has(path) ? new TFile(path) : null,
		cachedRead: async (file: TFile) => memory.get(file.path) || "",
		read: async (file: TFile) => memory.get(file.path) || "",
		create: async (path: string, text: string) => { memory.set(path, text); return new TFile(path); },
		modify: async (file: TFile, text: string) => { memory.set(file.path, text); },
		process: async (file: TFile, transform: (text: string) => string) => { const text = transform(memory.get(file.path) || ""); memory.set(file.path, text); return text; },
		append: async (file: TFile, text: string) => { memory.set(file.path, (memory.get(file.path) || "") + text); },
		on: () => ({}),
		getConfig: () => undefined
	},
	workspace: {
		on: () => ({}),
		getActiveFile: () => sampleFile,
		onLayoutReady: (callback: () => void) => callback(),
		getLeaf: () => ({ openFile: async () => { new Notice("Saved in the preview's in-memory vault."); } })
	},
	metadataCache: { getFileCache: () => ({ frontmatter: {} }), getFirstLinkpathDest: () => sampleFile },
	fileManager: { processFrontMatter: async (_file: TFile, callback: (frontmatter: Record<string, unknown>) => void) => callback({}) }
};

const plugin = new QuizGeneratorContinued(app, {
	id: "quiz-generator", name: "Quiz Generator Continued", version: "3.1.0", minAppVersion: "1.7.2", author: "Edward Cui and Yerkebulan Abenov", description: "Interface preview", isDesktopOnly: false
}) as any;
await plugin.onload();
let renderChild: Component | undefined;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, parent: HTMLElement, text?: string): HTMLElementTagNameMap[K] {
	const element = document.createElement(tag); if (text) element.textContent = text; parent.append(element); return element;
}
const header = el("header", root); header.className = "preview-header";
el("p", header, "Quiz Generator Continued").className = "preview-eyebrow";
el("h1", header, "Study notes");
el("p", header, "Public sample questions. Provider requests and real vault writes are disabled.").className = "preview-description";
const toolbar = el("nav", root); toolbar.className = "preview-toolbar"; toolbar.setAttribute("aria-label", "Preview controls");
const themeLabel = el("label", toolbar, "Theme");
const theme = el("select", themeLabel); theme.id = "preview-theme"; theme.setAttribute("aria-label", "Preview theme");
for (const [value, label] of [["dark", "Obsidian dark"], ["light", "Obsidian light"], ["paper", "Paper"], ["midnight", "Midnight"], ["high-contrast", "High contrast"]]) { const option = el("option", theme, label); option.value = value; }
theme.onchange = () => {
	document.body.className = theme.value === "light" || theme.value === "paper" ? "theme-light" : "theme-dark";
	document.body.dataset.previewTheme = theme.value;
	plugin.settings.quizTheme = ["dark", "light"].includes(theme.value) ? "obsidian" : theme.value === "high-contrast" ? "contrast" : theme.value;
	noteHost.dataset.quizTheme = plugin.settings.quizTheme;
};
const methodLabel = el("label", toolbar, "Questions");
const selection = el("select", methodLabel); selection.id = "preview-methods"; selection.setAttribute("aria-label", "Preview question formats");
for (const [value, label] of [["standard", "Original seven"], ["advanced", "Advanced ten"], ["all", "All 17 formats"], ["invalid", "Invalid JSON state"], ["long", "Long text and code"]]) { const option = el("option", selection, label); option.value = value; }

function button(id: string, text: string, callback: () => void): HTMLButtonElement { const control = el("button", toolbar, text); control.type = "button"; control.id = id; control.onclick = callback; return control; }
button("preview-study", "Start quiz", () => { void plugin.openJsonQuiz(currentDocument()); });
button("preview-studio", "Library", () => plugin.openStudyStudio());
button("preview-generator", "Generate", () => plugin.commands.find((command: any) => command.id === "open-generator")?.callback());
button("preview-import", "Import JSON", () => plugin.commands.find((command: any) => command.id === "import-quiz-json")?.callback());
button("preview-settings", "Settings", () => {
	const modal = new Modal(app); modal.setTitle("Quiz Generator settings"); modal.modalEl.classList.add("preview-settings-modal");
	const tab = plugin.settingTabs[0]; tab.containerEl = modal.contentEl; tab.display(); modal.open();
});
const noteHost = el("main", root); noteHost.id = "preview-note"; noteHost.className = "markdown-preview-view markdown-rendered preview-note";
const status = el("p", root); status.id = "preview-status"; status.className = "preview-status"; status.setAttribute("role", "status");

function currentDocument(): any {
	const chosen = selection.value === "advanced" ? methods.slice(7) : selection.value === "all" ? methods : methods.slice(0, 7);
	const questions = chosen.map(type => runtime.createQuestionTemplate(type));
	if (selection.value === "long") {
		questions.splice(0, questions.length, {
			type: "multiple-choice", question: "Which command lists files, including hidden files, without modifying the directory?", options: ["`ls -la`", "`rm -rf`", "`mkdir -p`"], answer: 0,
			explanation: "`ls` lists directory contents. The `-a` option includes hidden entries; `-l` uses the long listing format.\n\n```sh\nls -la /a/really/long/path/that/should/wrap/or/scroll/inside/the/question/without/expanding/the/page\n```"
		}, {
			type: "short-answer", question: "Explain how a clear question, enough context, and an answer reveal help a learner review a detailed technical note on a narrow screen.", answer: "Keep the prompt readable, show required context before answering, and hide the answer behind a separate disclosure until the learner is ready.",
			hint: "Consider the order in which the learner encounters the information."
		});
	}
	return runtime.createQuizDocument(questions, { title: selection.value === "long" ? "Reading code and longer questions" : "Observing the sky", description: "Review each question, then reveal the answer when you are ready.", sources: ["Astronomy/Observing the sky.md"] });
}

async function renderNote(): Promise<void> {
	renderChild?.unload(); renderChild = new Component(); noteHost.replaceChildren(); status.textContent = "";
	try {
		const processor = plugin.processors.get("quiz-json");
		if (!processor) throw new Error("The real quiz-json processor was not installed.");
		const quiz = currentDocument();
		const json = selection.value === "invalid" ? '{"questions":[{"question":"Incomplete question"}]}' : runtime.serializeQuizJson(quiz);
		await processor(json, noteHost, { sourcePath: sampleFile.path, addChild: (child: Component) => renderChild!.addChild(child) });
		status.textContent = selection.value === "invalid" ? "Showing the real invalid-data state." : `${quiz.questions.length} formats rendered with the plugin's note processor.`;
	} catch (error) { status.textContent = error instanceof Error ? error.message : "Preview failed."; status.classList.add("preview-error"); throw error; }
}
selection.onchange = () => { void renderNote(); };
await renderNote();

Object.assign(window, {
	quizPreview: {
		plugin, runtime, methods, currentDocument, renderNote,
		metrics: () => ({ cards: document.querySelectorAll(".qg-note-question").length, answers: document.querySelectorAll(".qg-note-answer").length, horizontalOverflow: document.documentElement.scrollWidth > innerWidth, openModal: Boolean(document.querySelector(".modal-container")), networkBlocked: true }),
		unload: () => { renderChild?.unload(); plugin.unload(); }
	}
});
window.addEventListener("beforeunload", () => { renderChild?.unload(); plugin.unload(); });
}

void boot().catch(error => {
	const status = document.createElement("pre");
	status.id = "preview-boot-error";
	status.textContent = error instanceof Error ? error.stack || error.message : String(error);
	document.querySelector("#preview-root")?.append(status);
	console.error(error);
});
