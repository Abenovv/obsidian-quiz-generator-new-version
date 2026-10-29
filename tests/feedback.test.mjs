import test from "node:test";
import assert from "node:assert/strict";
import { FeedbackAudio, readFeedbackPreferences } from "../src/feedback/audio.ts";
import { installFeedback, isRevealControl } from "../src/feedback/index.ts";

function fixture(options = {}) {
	const calls = [];
	let currentTime = 0;
	let preferences = { soundEnabled: true, motion: "system" };
	const parameter = {
		setValueAtTime(value, at) { calls.push(["set", value, at]); },
		linearRampToValueAtTime(value, at) { calls.push(["linear", value, at]); },
		exponentialRampToValueAtTime(value, at) { calls.push(["exponential", value, at]); }
	};
	const tone = {
		frequency: parameter, type: "sine", onended: null,
		connect() {}, disconnect() { calls.push(["tone disconnected"]); },
		start() { calls.push(["start"]); }, stop() { calls.push(["stop"]); }
	};
	const context = {
		state: "running", currentTime: 1, destination: {},
		async resume() { context.state = "running"; calls.push(["resume"]); },
		async close() { context.state = "closed"; calls.push(["close"]); },
		createOscillator() { return tone; },
		createGain() { return { gain: parameter, connect() {}, disconnect() { calls.push(["gain disconnected"]); } }; }
	};
	const audio = new FeedbackAudio({
		preferences: () => preferences,
		createContext() { calls.push(["create"]); return context; },
		now: () => currentTime,
		...options
	});
	return { audio, calls, context, tone, advance(ms) { currentTime += ms; }, setPreferences(value) { preferences = value; } };
}

test("preferences default to silent and follow the system", () => {
	for (const input of [undefined, null, 1, {}, { soundEnabled: "true", motion: "animated" }]) {
		assert.deepEqual(readFeedbackPreferences(input), { soundEnabled: false, motion: "system" });
	}
	assert.deepEqual(readFeedbackPreferences({ soundEnabled: true, motion: "reduced" }), { soundEnabled: true, motion: "reduced" });
});

test("loading and untrusted interactions never create an audio context", async () => {
	const f = fixture();
	assert.deepEqual(f.calls, []);
	assert.equal(await f.audio.play(false), false);
	assert.deepEqual(f.calls, []);
});

test("disabled sound stays silent; explicit preview works without changing preferences", async () => {
	const f = fixture();
	f.setPreferences({ soundEnabled: false, motion: "system" });
	assert.equal(await f.audio.play(true), false);
	assert.deepEqual(f.calls, []);
	assert.equal(await f.audio.play(true, true), true);
	f.advance(400);
	assert.equal(await f.audio.play(true), false);
});

test("answer feedback is quiet, short, and disconnects audio nodes", async () => {
	const f = fixture();
	assert.equal(await f.audio.play(true), true);
	assert.ok(f.calls.some(call => call[0] === "linear" && call[1] === 0.025));
	f.tone.onended();
	assert.ok(f.calls.some(call => call[0] === "tone disconnected"));
	assert.ok(f.calls.some(call => call[0] === "gain disconnected"));
});

test("rapid clicks are throttled and share one audio context", async () => {
	const f = fixture();
	assert.equal(await f.audio.play(true), true);
	assert.equal(await f.audio.play(true), false);
	f.advance(351);
	assert.equal(await f.audio.play(true), true);
	assert.equal(f.calls.filter(call => call[0] === "create").length, 1);
});

test("suspended audio resumes only following a gesture", async () => {
	const f = fixture();
	f.context.state = "suspended";
	assert.equal(await f.audio.play(false), false);
	assert.equal(await f.audio.play(true), true);
	assert.equal(f.calls.filter(call => call[0] === "resume").length, 1);
});

test("unsupported and blocked audio do not reject", async () => {
	assert.equal(await fixture({ createContext: () => undefined }).audio.play(true), false);
	assert.equal(await fixture({ createContext() { throw new Error("blocked"); } }).audio.play(true), false);
});

test("unload closes audio and prevents subsequent playback", async () => {
	const f = fixture();
	await f.audio.play(true);
	f.audio.dispose();
	f.audio.dispose();
	f.advance(400);
	assert.equal(await f.audio.play(true), false);
	assert.equal(f.calls.filter(call => call[0] === "close").length, 1);
});

test("unload during an awaited resume cannot start a tone", async () => {
	let finishResume;
	const f = fixture();
	f.context.state = "suspended";
	f.context.resume = () => new Promise(resolve => { finishResume = resolve; });
	const playing = f.audio.play(true);
	f.audio.dispose();
	finishResume();
	assert.equal(await playing, false);
	assert.equal(f.calls.filter(call => call[0] === "start").length, 0);
});

test("reveal detection excludes exams, closing notes, ratings, and unrelated controls", () => {
	function target(matches) { return { closest(selector) { return matches[selector] ?? null; } }; }
	assert.equal(isRevealControl(target({})), false);
	assert.equal(isRevealControl(target({ '.qg-note-answer > summary': { parentElement: { open: false } } })), true);
	assert.equal(isRevealControl(target({ '.qg-note-answer > summary': { parentElement: { open: true } } })), false);
	assert.equal(isRevealControl(target({ '[data-qg-mode="exam"], [data-mode="exam"]': {}, '.qg-flashcard button': { textContent: "Reveal answer" } })), false);
	assert.equal(isRevealControl(target({ '.qg-flashcard button': { textContent: "Reveal answer" } })), true);
	assert.equal(isRevealControl(target({ '.qg-flashcard button': { textContent: "Again" } })), false);
	assert.equal(isRevealControl(target({ '[data-qg-feedback="reveal"]': { closest() { return null; } } })), false);
});

test("native saved callouts sound only on opening an answer inside an explicitly marked quiz question", () => {
	const titleSelector = '.callout[data-callout="success"].is-collapsible.is-collapsed > .callout-title';
	const quizSelector = '.callout[data-callout="question"][data-callout-metadata="qg-quiz"]';
	function target({ marked = true, collapsed = true, exam = false, questionTitle = false } = {}) {
		return { closest(selector) {
			if (selector === '[data-qg-mode="exam"], [data-mode="exam"]') return exam ? {} : null;
			if (selector !== titleSelector || !collapsed || questionTitle) return null;
			return { parentElement: { closest(parentSelector) { return marked && parentSelector === quizSelector ? {} : null; } } };
		} };
	}
	assert.equal(isRevealControl(target()), true);
	assert.equal(isRevealControl(target({ marked: false })), false);
	assert.equal(isRevealControl(target({ collapsed: false })), false);
	assert.equal(isRevealControl(target({ exam: true })), false);
	assert.equal(isRevealControl(target({ questionTitle: true })), false);
});

test("installer preserves settings, saves preferences, and restores listeners and motion on unload", async () => {
	const listeners = new Map();
	const cleanups = [];
	let saves = 0;
	const previousDocument = globalThis.document;
	class Element {
		constructor(tag, owner) { this.tagName = tag; this.ownerDocument = owner; this.children = []; this.attrs = new Map(); }
		appendChild(child) { this.children.push(child); child.parentElement = this; return child; }
		setAttribute(name, value) { this.attrs.set(name, value); }
		getAttribute(name) { return this.attrs.get(name) ?? null; }
		removeAttribute(name) { this.attrs.delete(name); }
		querySelector(selector) { return all(this).find(el => selector === ".qg-feedback-settings" && el.className === "qg-feedback-settings") ?? null; }
		querySelectorAll(selector) { return all(this).filter(el => el.tagName === selector); }
		remove() { this.parentElement.children = this.parentElement.children.filter(el => el !== this); }
	}
	function all(root) { return root.children.flatMap(child => [child, ...all(child)]); }
	const doc = { defaultView: {}, createElement(tag) { return new Element(tag, doc); }, addEventListener(name, callback) { listeners.set(name, callback); }, removeEventListener(name, callback) { if (listeners.get(name) === callback) listeners.delete(name); } };
	doc.body = new Element("body", doc);
	doc.body.setAttribute("data-qg-motion", "existing");
	globalThis.document = doc;
	const plugin = { settings: { provider: "preserve-provider", continuation: { otherPreference: true } }, async saveSettings() { saves++; }, register(cleanup) { cleanups.push(cleanup); } };
	const original = function () {
		this.containerEl.children = [];
		const heading = this.containerEl.appendChild(doc.createElement("h2"));
		heading.textContent = "Quiz Generator";
		const option = this.containerEl.appendChild(doc.createElement("option"));
		option.textContent = "Pусский";
		option.value = "ru";
		option.selected = true;
		const other = this.containerEl.appendChild(doc.createElement("option"));
		other.textContent = "English";
		other.value = "en";
	};
	const SettingsTab = { prototype: { display: original } };
	try {
		installFeedback(plugin, { SettingsTab });
		assert.equal(doc.body.getAttribute("data-qg-motion"), "system");
		assert.ok(listeners.has("click"));
		const tab = { plugin, containerEl: new Element("div", doc) };
		SettingsTab.prototype.display.call(tab);
		const controls = all(tab.containerEl);
		assert.equal(controls.find(el => el.tagName === "h2").textContent, "Quiz Generator Continued");
		const languageOption = controls.find(el => el.tagName === "option" && el.value === "ru");
		assert.equal(languageOption.textContent, "Русский");
		assert.equal(languageOption.value, "ru");
		assert.equal(languageOption.selected, true);
		assert.equal(controls.find(el => el.value === "en").textContent, "English");
		const sound = controls.find(el => el.getAttribute("aria-label") === "Study sounds");
		assert.equal(sound.checked, false);
		sound.checked = true;
		sound.onchange();
		const motion = controls.find(el => el.getAttribute("aria-label") === "Motion");
		motion.value = "reduced";
		motion.onchange();
		await new Promise(resolve => setImmediate(resolve));
		assert.equal(saves, 2);
		assert.equal(plugin.settings.provider, "preserve-provider");
		assert.equal(plugin.settings.continuation.otherPreference, true);
		assert.deepEqual(plugin.settings.continuation.feedback, { soundEnabled: true, motion: "reduced" });
		assert.equal(doc.body.getAttribute("data-qg-motion"), "reduced");
		cleanups.forEach(cleanup => cleanup());
		assert.equal(listeners.size, 0);
		assert.equal(SettingsTab.prototype.display, original);
		assert.equal(doc.body.getAttribute("data-qg-motion"), "existing");
	} finally { globalThis.document = previousDocument; }
});
