/** Browser-only Obsidian adapter. Every file operation stays in memory. */
import MarkdownIt from "markdown-it";

type Options = { cls?: string | string[]; text?: string; attr?: Record<string, unknown>; title?: string };

function decorate<T extends HTMLElement>(element: T): T { return element; }
function applyOptions(element: HTMLElement, options: Options | string = {}): void {
	if (typeof options === "string") element.className = options;
	else {
		if (options.cls) element.className = Array.isArray(options.cls) ? options.cls.join(" ") : options.cls;
		if (options.text !== undefined) element.textContent = String(options.text);
		if (options.title) element.title = options.title;
		for (const [name, value] of Object.entries(options.attr || {})) element.setAttribute(name, String(value));
	}
}

const elementMethods: Record<string, (...args: any[]) => any> = {
	createEl(this: HTMLElement, tag: string, options: Options | string = {}, callback?: (element: HTMLElement) => void) {
		const element = decorate(document.createElement(tag));
		applyOptions(element, options);
		this.append(element);
		callback?.(element);
		return element;
	},
	createDiv(this: HTMLElement, options: Options | string = {}, callback?: (element: HTMLElement) => void) { return (this as any).createEl("div", options, callback); },
	createSpan(this: HTMLElement, options: Options | string = {}, callback?: (element: HTMLElement) => void) { return (this as any).createEl("span", options, callback); },
	empty(this: HTMLElement) { this.replaceChildren(); return this; },
	setText(this: HTMLElement, text: unknown) { this.textContent = String(text); return this; },
	appendText(this: HTMLElement, text: unknown) { this.append(document.createTextNode(String(text))); return this; },
	addClass(this: HTMLElement, ...names: string[]) { names.flatMap(name => name.split(" ")).filter(Boolean).forEach(name => this.classList.add(name)); return this; },
	removeClass(this: HTMLElement, ...names: string[]) { names.forEach(name => this.classList.remove(name)); return this; },
	hasClass(this: HTMLElement, name: string) { return this.classList.contains(name); },
	toggleClass(this: HTMLElement, name: string, value?: boolean) { this.classList.toggle(name, value); return this; },
	setAttr(this: HTMLElement, name: string, value: unknown) { this.setAttribute(name, String(value)); return this; },
	setAttrs(this: HTMLElement, values: Record<string, unknown>) { Object.entries(values).forEach(([name, value]) => this.setAttribute(name, String(value))); return this; },
	setCssProps(this: HTMLElement, values: Record<string, unknown>) { Object.entries(values).forEach(([name, value]) => this.style.setProperty(name, String(value))); return this; },
	setCssStyles(this: HTMLElement, values: Partial<CSSStyleDeclaration>) { Object.assign(this.style, values); return this; },
	show(this: HTMLElement) { this.hidden = false; this.style.removeProperty("display"); return this; },
	hide(this: HTMLElement) { this.hidden = true; return this; },
	detach(this: HTMLElement) { this.remove(); },
	find(this: HTMLElement, selector: string) { return this.querySelector(selector); },
	findAll(this: HTMLElement, selector: string) { return [...this.querySelectorAll(selector)]; },
	matchParent(this: HTMLElement, selector: string) { return this.closest(selector); }
};
for (const [name, method] of Object.entries(elementMethods)) {
	Object.defineProperty(HTMLElement.prototype, name, { value: method, configurable: true });
}

export class Component {
	private disposers: Array<() => void> = [];
	private children = new Set<Component>();
	register(dispose: () => void): void { this.disposers.push(dispose); }
	registerEvent(_event: unknown): void {}
	registerInterval(id: number): number { this.register(() => clearInterval(id)); return id; }
	registerDomEvent(element: EventTarget, name: string, callback: EventListener, options?: AddEventListenerOptions): void {
		element.addEventListener(name, callback, options); this.register(() => element.removeEventListener(name, callback, options));
	}
	addChild<T extends Component>(child: T): T { this.children.add(child); child.load(); return child; }
	removeChild(child: Component): void { child.unload(); this.children.delete(child); }
	load(): void { this.onload(); }
	onload(): void {}
	onunload(): void {}
	unload(): void { this.children.forEach(child => child.unload()); this.children.clear(); this.disposers.splice(0).reverse().forEach(dispose => dispose()); this.onunload(); }
}

export class MarkdownRenderChild extends Component { constructor(public containerEl: HTMLElement) { super(); } }
export class Scope { register(): void {} unregister(): void {} }

export class Modal extends Component {
	containerEl = document.createElement("div");
	modalEl = document.createElement("div");
	titleEl = document.createElement("h2");
	contentEl = document.createElement("div");
	scope = new Scope();
	private opened = false;
	constructor(public app: any) {
		super();
		this.containerEl.className = "modal-container";
		this.modalEl.className = "modal";
		this.titleEl.className = "modal-title";
		this.contentEl.className = "modal-content";
		const close = document.createElement("button");
		close.type = "button"; close.className = "modal-close-button"; close.textContent = "×"; close.setAttribute("aria-label", "Close dialog");
		close.onclick = () => this.close();
		this.modalEl.append(close, this.titleEl, this.contentEl);
		this.containerEl.append(this.modalEl);
		this.containerEl.addEventListener("click", event => { if (event.target === this.containerEl) this.close(); });
		this.registerDomEvent(document, "keydown", event => { if ((event as KeyboardEvent).key === "Escape" && this.opened) this.close(); });
	}
	setTitle(title: string): this { this.titleEl.textContent = title; return this; }
	setContent(content: string): this { this.contentEl.textContent = content; return this; }
	open(): void { this.opened = true; document.body.append(this.containerEl); this.onOpen(); }
	close(): void { if (!this.opened) return; this.opened = false; this.onClose(); this.containerEl.remove(); this.unload(); }
	onOpen(): void {}
	onClose(): void {}
}

export class FuzzySuggestModal extends Modal {
	inputEl = document.createElement("input");
	private resultsEl = document.createElement("div");
	constructor(app: any) { super(app); this.contentEl.append(this.inputEl, this.resultsEl); this.inputEl.oninput = () => this.renderResults(); }
	setPlaceholder(text: string): this { this.inputEl.placeholder = text; return this; }
	getItems(): unknown[] { return []; }
	getItemText(item: unknown): string { return String(item); }
	onChooseItem(_item: unknown, _event: Event): void {}
	onOpen(): void { this.renderResults(); this.inputEl.focus(); }
	private renderResults(): void {
		this.resultsEl.replaceChildren();
		for (const item of this.getItems().filter(item => this.getItemText(item).toLowerCase().includes(this.inputEl.value.toLowerCase()))) {
			const button = document.createElement("button"); button.type = "button"; button.textContent = this.getItemText(item);
			button.onclick = event => { this.onChooseItem(item, event); this.close(); }; this.resultsEl.append(button);
		}
	}
}

export class AbstractInputSuggest<T> { constructor(public app: any, public inputEl: HTMLInputElement) {} setValue(value: string): void { this.inputEl.value = value; } close(): void {} }
export class TAbstractFile { name: string; parent: TFolder | null = null; constructor(public path: string) { this.name = path.split("/").pop() || ""; } }
export class TFile extends TAbstractFile { extension: string; basename: string; stat = { ctime: 0, mtime: 0, size: 0 }; constructor(path: string) { super(path); this.extension = path.split(".").pop() || ""; this.basename = this.name.replace(/\.[^.]+$/, ""); } }
export class TFolder extends TAbstractFile { children: TAbstractFile[] = []; }
export class Vault { static recurseChildren(folder: TFolder, callback: (file: TAbstractFile) => void): void { folder.children.forEach(file => { callback(file); if (file instanceof TFolder) Vault.recurseChildren(file, callback); }); } }

export class Plugin extends Component {
	settings: any;
	commands: Array<{ id: string; name: string; callback: () => void }> = [];
	settingTabs: PluginSettingTab[] = [];
	processors = new Map<string, (...args: any[]) => unknown>();
	constructor(public app: any, public manifest: any) { super(); }
	addCommand(command: any): any { this.commands.push(command); return command; }
	addRibbonIcon(_icon: string, _title: string, callback: () => void): HTMLElement { const element = document.createElement("button"); element.onclick = callback; return element; }
	addSettingTab(tab: PluginSettingTab): void { this.settingTabs.push(tab); }
	registerMarkdownCodeBlockProcessor(language: string, processor: (...args: any[]) => unknown): void { this.processors.set(language, processor); }
	async loadData(): Promise<any> { return {}; }
	async saveData(_data: unknown): Promise<void> {}
}

export class PluginSettingTab { containerEl = document.createElement("div"); constructor(public app: any, public plugin: any) {} display(): void {} hide(): void {} }

class Control {
	buttonEl: HTMLButtonElement;
	inputEl: HTMLInputElement;
	selectEl: HTMLSelectElement;
	toggleEl: HTMLInputElement;
	constructor(public element: HTMLElement) { this.buttonEl = element as HTMLButtonElement; this.inputEl = element as HTMLInputElement; this.selectEl = element as HTMLSelectElement; this.toggleEl = element as HTMLInputElement; }
	setValue(value: string | boolean | number): this { if (this.inputEl.type === "checkbox") this.inputEl.checked = Boolean(value); else (this.element as HTMLInputElement).value = String(value); return this; }
	getValue(): string | boolean | number { return this.inputEl.type === "checkbox" ? this.inputEl.checked : this.inputEl.type === "range" ? Number(this.inputEl.value) : this.inputEl.value; }
	setPlaceholder(value: string): this { this.inputEl.placeholder = value; return this; }
	setButtonText(value: string): this { this.element.textContent = value; return this; }
	setTooltip(value: string): this { this.element.title = value; return this; }
	setIcon(value: string): this { setIcon(this.element, value); return this; }
	setCta(): this { this.element.classList.add("mod-cta"); return this; }
	setWarning(): this { this.element.classList.add("mod-warning"); return this; }
	setDisabled(value: boolean): this { (this.element as HTMLInputElement).disabled = value; return this; }
	setLimits(minimum: number, maximum: number, step: number): this { this.inputEl.min = String(minimum); this.inputEl.max = String(maximum); this.inputEl.step = String(step); return this; }
	setDynamicTooltip(): this { return this; }
	setInstant(): this { return this; }
	addOption(value: string, label: string): this { const option = document.createElement("option"); option.value = value; option.textContent = label; this.element.append(option); return this; }
	addOptions(values: Record<string, string>): this { Object.entries(values).forEach(([value, label]) => this.addOption(value, label)); return this; }
	onClick(callback: (event: MouseEvent) => void): this { this.element.addEventListener("click", callback); return this; }
	onChange(callback: (value: any) => void): this { this.element.addEventListener("change", () => callback(this.getValue())); if (this.element.tagName === "TEXTAREA" || this.inputEl.type === "text") this.element.addEventListener("input", () => callback(this.getValue())); return this; }
}

export class Setting {
	settingEl = document.createElement("div");
	infoEl = document.createElement("div");
	nameEl = document.createElement("div");
	descEl = document.createElement("div");
	controlEl = document.createElement("div");
	constructor(container: HTMLElement) { this.settingEl.className = "setting-item"; this.infoEl.className = "setting-item-info"; this.nameEl.className = "setting-item-name"; this.descEl.className = "setting-item-description"; this.controlEl.className = "setting-item-control"; this.infoEl.append(this.nameEl, this.descEl); this.settingEl.append(this.infoEl, this.controlEl); container.append(this.settingEl); }
	setName(value: string | DocumentFragment): this { this.nameEl.replaceChildren(); this.nameEl.append(value); return this; }
	setDesc(value: string | DocumentFragment): this { this.descEl.replaceChildren(); this.descEl.append(value); return this; }
	setHeading(): this { this.settingEl.classList.add("setting-item-heading"); return this; }
	setClass(name: string): this { this.settingEl.classList.add(name); return this; }
	setDisabled(value: boolean): this { this.controlEl.querySelectorAll<HTMLInputElement>("input,select,button,textarea").forEach(element => { element.disabled = value; }); return this; }
	private add(tag: string, type: string | null, callback: (control: Control) => void): this { const element = document.createElement(tag); if (type) (element as HTMLInputElement).type = type; if (type === "checkbox") element.setAttribute("role", "switch"); this.controlEl.append(element); callback(new Control(element)); return this; }
	addText(callback: (control: Control) => void): this { return this.add("input", "text", callback); }
	addTextArea(callback: (control: Control) => void): this { return this.add("textarea", null, callback); }
	addSearch(callback: (control: Control) => void): this { return this.add("input", "search", callback); }
	addToggle(callback: (control: Control) => void): this { return this.add("input", "checkbox", callback); }
	addSlider(callback: (control: Control) => void): this { return this.add("input", "range", callback); }
	addDropdown(callback: (control: Control) => void): this { return this.add("select", null, callback); }
	addButton(callback: (control: Control) => void): this { return this.add("button", "button", callback); }
	addExtraButton(callback: (control: Control) => void): this { return this.addButton(callback); }
}

const markdownRenderer = new MarkdownIt({ html: false, linkify: false, breaks: false });

/** Real Markdown parsing with raw HTML disabled; native Obsidian is still mocked. */
export class MarkdownRenderer {
	static async render(_app: unknown, markdown: string, element: HTMLElement, _sourcePath = "", _component?: Component): Promise<void> {
		const fragment = document.createElement("div");
		fragment.innerHTML = markdownRenderer.render(String(markdown));
		element.append(...fragment.childNodes);
	}
	static async renderMarkdown(markdown: string, element: HTMLElement, sourcePath: string, component: Component): Promise<void> { return this.render(null, markdown, element, sourcePath, component); }
}

export class Notice { constructor(text: string) { const element = document.createElement("div"); element.className = "notice"; element.setAttribute("role", "status"); element.textContent = text; document.body.append(element); setTimeout(() => element.remove(), 4000); } }
export const normalizePath = (value: string): string => value.replace(/\\/g, "/").replace(/\/{2,}/g, "/");
export const getFrontMatterInfo = (_value: string): { exists: boolean; contentStart: number } => ({ exists: false, contentStart: 0 });
export const setTooltip = (element: HTMLElement, title: string): void => { element.title = title; };
export function setIcon(element: HTMLElement, icon: string): void { element.textContent = ({ "play": "▷", "chevron-right": "›", "chevron-left": "‹", "check": "✓", "x": "×", "plus": "+", "minus": "−", "chevron-down": "⌄" } as Record<string, string>)[icon] || "·"; element.setAttribute("data-icon", icon); }
export async function requestUrl(): Promise<never> { throw new Error("Provider requests are disabled in this preview."); }
