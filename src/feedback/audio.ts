export interface FeedbackPreferences {
	soundEnabled: boolean;
	motion: "system" | "reduced";
}

export function readFeedbackPreferences(value: unknown): FeedbackPreferences {
	const candidate = value && typeof value === "object" ? value as Record<string, unknown> : {};
	return {
		soundEnabled: candidate.soundEnabled === true,
		motion: candidate.motion === "reduced" ? "reduced" : "system"
	};
}

interface AudioParameter {
	setValueAtTime(value: number, time: number): unknown;
	linearRampToValueAtTime(value: number, time: number): unknown;
	exponentialRampToValueAtTime(value: number, time: number): unknown;
}

interface Tone {
	type: OscillatorType;
	frequency: AudioParameter;
	connect(destination: unknown): unknown;
	start(time: number): void;
	stop(time: number): void;
	disconnect(): void;
	onended: (() => void) | null;
}

interface Gain {
	gain: AudioParameter;
	connect(destination: unknown): unknown;
	disconnect(): void;
}

export interface FeedbackAudioContext {
	state: string;
	currentTime: number;
	destination: unknown;
	resume(): Promise<void>;
	close(): Promise<void>;
	createOscillator(): Tone;
	createGain(): Gain;
}

export interface FeedbackAudioOptions {
	preferences(): FeedbackPreferences;
	createContext(): FeedbackAudioContext | undefined;
	now?(): number;
}

/** A context is created only after an explicit user interaction. */
export class FeedbackAudio {
	private context: FeedbackAudioContext | undefined;
	private disposed = false;
	private lastPlayed = -Infinity;
	private readonly options: FeedbackAudioOptions;

	constructor(options: FeedbackAudioOptions) {
		this.options = options;
	}

	async play(userGesture: boolean, preview = false): Promise<boolean> {
		if (this.disposed || !userGesture || (!preview && !this.options.preferences().soundEnabled)) return false;
		const now = this.options.now?.() ?? performance.now();
		if (now - this.lastPlayed < 350) return false;
		this.lastPlayed = now;
		try {
			this.context ??= this.options.createContext();
			const context = this.context;
			if (!context || context.state === "closed") return false;
			if (context.state === "suspended") await context.resume();
			if (this.disposed || context.state !== "running") return false;
			if (!preview && !this.options.preferences().soundEnabled) return false;
			const tone = context.createOscillator();
			const gain = context.createGain();
			const start = context.currentTime;
			tone.type = "sine";
			tone.frequency.setValueAtTime(preview ? 523.25 : 440, start);
			gain.gain.setValueAtTime(0.0001, start);
			gain.gain.linearRampToValueAtTime(0.025, start + 0.012);
			gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.1);
			tone.connect(gain);
			gain.connect(context.destination);
			tone.onended = () => { tone.disconnect(); gain.disconnect(); };
			tone.start(start);
			tone.stop(start + 0.12);
			return true;
		} catch {
			// Unsupported audio and browser autoplay restrictions must not interrupt study.
			return false;
		}
	}

	dispose(): void {
		this.disposed = true;
		const context = this.context;
		this.context = undefined;
		if (context && context.state !== "closed") void context.close().catch(() => undefined);
	}
}
