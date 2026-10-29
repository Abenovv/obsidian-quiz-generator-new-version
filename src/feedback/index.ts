import { FeedbackAudio, readFeedbackPreferences } from "./audio";
import type { FeedbackAudioContext, FeedbackPreferences } from "./audio";

interface FeedbackPlugin {
	settings: object;
	saveSettings(): Promise<void>;
	register(cleanup: () => void): void;
}

interface FeedbackSettingsTab {
	plugin: FeedbackPlugin;
	containerEl: HTMLElement;
	display(): void;
}

interface FeedbackRuntime {
	SettingsTab: { prototype: { display(): void } };
}

function preferences(plugin: FeedbackPlugin): FeedbackPreferences {
	const settings = plugin.settings as Record<string, unknown>;
	const continuation = settings.continuation as Record<string, unknown> | undefined;
	return readFeedbackPreferences(continuation?.feedback);
}

function writePreferences(plugin: FeedbackPlugin, next: FeedbackPreferences): void {
	const settings = plugin.settings as Record<string, unknown>;
	const previous = settings.continuation;
	settings.continuation = {
		...(previous && typeof previous === "object" ? previous : {}),
		feedback: next
	};
}

/** Only opening an answer in a saved note or flashcard can produce reveal feedback. */
export function isRevealControl(target: Element): boolean {
	if (target.closest('[data-qg-mode="exam"], [data-mode="exam"]')) return false;
	const summary = target.closest(".qg-note-answer > summary");
	if (summary) return !(summary.parentElement as HTMLDetailsElement | null)?.open;
	const calloutTitle = target.closest('.callout[data-callout="success"].is-collapsible.is-collapsed > .callout-title');
	if (calloutTitle?.parentElement?.closest('.callout[data-callout="question"][data-callout-metadata="qg-quiz"]')) return true;
	const explicit = target.closest('[data-qg-feedback="reveal"]');
	if (explicit?.closest(".qg-note, .qg-note-quiz, .qg-flashcard")) return true;
	const button = target.closest(".qg-flashcard button");
	return !!button && /^(show|reveal) answer$/i.test(button.textContent?.trim() ?? "");
}

export function installFeedback(plugin: FeedbackPlugin, runtime: FeedbackRuntime): void {
	const doc = document;
	const body = doc.body;
	const previousMotion = body.getAttribute("data-qg-motion");
	const applyMotion = (): void => body.setAttribute("data-qg-motion", preferences(plugin).motion);
	applyMotion();
	const audio = new FeedbackAudio({
		preferences: () => preferences(plugin),
		createContext: () => {
			const view = doc.defaultView as (Window & { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }) | null;
			const Context = view?.AudioContext ?? view?.webkitAudioContext;
			return Context ? new Context() as unknown as FeedbackAudioContext : undefined;
		}
	});
	const click = (event: MouseEvent): void => {
		const target = event.target as Element | null;
		if (!event.isTrusted || !target || typeof target.closest !== "function") return;
		if (isRevealControl(target)) void audio.play(true);
	};
	doc.addEventListener("click", click, true);

	const prototype = runtime.SettingsTab.prototype;
	const original = prototype.display;
	function display(this: FeedbackSettingsTab): void {
		original.call(this);
		if (this.plugin !== plugin) return;
		const container = this.containerEl;
		for (const option of Array.from(container.querySelectorAll("option"))) {
			if (option.textContent === "Pусский") option.textContent = "Русский";
		}
		for (const heading of Array.from(container.querySelectorAll("h2"))) {
			if (heading.textContent === "Quiz Generator") heading.textContent = "Quiz Generator Continued";
		}
		container.querySelector(".qg-feedback-settings")?.remove();
		const section = container.ownerDocument.createElement("section");
		section.className = "qg-feedback-settings";
		const heading = section.appendChild(container.ownerDocument.createElement("h3"));
		heading.textContent = "Study feedback";
		const status = container.ownerDocument.createElement("p");
		status.setAttribute("role", "status");
		status.className = "setting-item-description";
		let saving = Promise.resolve();
		const save = (next: FeedbackPreferences): void => {
			writePreferences(plugin, next);
			applyMotion();
			status.textContent = "";
			saving = saving.then(() => plugin.saveSettings()).catch(() => {
				status.textContent = "Could not save feedback preferences. Try changing the setting again.";
			});
		};
		const row = (name: string, description: string): HTMLElement => {
			const item = section.appendChild(container.ownerDocument.createElement("div"));
			item.className = "setting-item qg-feedback-row";
			const info = item.appendChild(container.ownerDocument.createElement("div"));
			info.className = "setting-item-info";
			const label = info.appendChild(container.ownerDocument.createElement("div"));
			label.className = "setting-item-name";
			label.textContent = name;
			const help = info.appendChild(container.ownerDocument.createElement("div"));
			help.className = "setting-item-description";
			help.textContent = description;
			const controls = item.appendChild(container.ownerDocument.createElement("div"));
			controls.className = "setting-item-control";
			return controls;
		};
		const soundControls = row("Study sounds", "Play a quiet tone when you reveal an answer. Off by default.");
		const sound = soundControls.appendChild(container.ownerDocument.createElement("input"));
		sound.type = "checkbox";
		sound.setAttribute("aria-label", "Study sounds");
		sound.checked = preferences(plugin).soundEnabled;
		sound.onchange = () => save({ ...preferences(plugin), soundEnabled: sound.checked });
		const preview = soundControls.appendChild(container.ownerDocument.createElement("button"));
		preview.type = "button";
		preview.textContent = "Test sound";
		preview.onclick = (event) => { if (event.isTrusted) void audio.play(true, true); };
		const motionControls = row("Motion", "Follow your system preference, or reduce study animations.");
		const motion = motionControls.appendChild(container.ownerDocument.createElement("select"));
		motion.setAttribute("aria-label", "Motion");
		for (const [value, label] of [["system", "Follow system"], ["reduced", "Reduce motion"]]) {
			const option = motion.appendChild(container.ownerDocument.createElement("option"));
			option.value = value;
			option.textContent = label;
		}
		motion.value = preferences(plugin).motion;
		motion.onchange = () => save({ ...preferences(plugin), motion: motion.value === "reduced" ? "reduced" : "system" });
		section.appendChild(status);
		container.appendChild(section);
	}
	prototype.display = display as typeof original;
	plugin.register(() => {
		doc.removeEventListener("click", click, true);
		if (prototype.display === display) prototype.display = original;
		if (previousMotion === null) body.removeAttribute("data-qg-motion");
		else body.setAttribute("data-qg-motion", previousMotion);
		audio.dispose();
	});
}
