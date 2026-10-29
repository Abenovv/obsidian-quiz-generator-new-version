declare module "virtual:quiz-runtime" {
	const RuntimePlugin: import("./types").RuntimePluginConstructor;
	export default RuntimePlugin;
	export const continuationRuntime: import("./types").RuntimeBridge;
}
