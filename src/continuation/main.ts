import { BasePlugin, runtime } from "./runtime";
import { installNoteExperience } from "../notes/index";
import { installGenerationQuality } from "../quality/index";
import { installFeedback } from "../feedback/index";

export default class QuizGeneratorContinued extends BasePlugin {
	async onload(): Promise<void> {
		await super.onload();
		installGenerationQuality(this, runtime);
		installNoteExperience(this, runtime);
		installFeedback(this, runtime);
	}
}
