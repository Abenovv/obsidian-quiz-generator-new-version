import { build } from "esbuild";
import { readdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runtimeBridgePlugin } from "./runtime-bridge.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
process.chdir(root);
async function discover(directory) {
	const entries = await readdir(directory, { withFileTypes: true });
	const files = await Promise.all(entries.map(entry => entry.isDirectory()
		? discover(join(directory, entry.name))
		: [join(directory, entry.name)]));
	return files.flat().filter(path => /\.test\.(?:ts|mjs)$/.test(path)).sort();
}

const files = await discover("tests");
if (!files.length) throw new Error("No tests were found.");
// Keep test bundles beside node_modules so external dev dependencies resolve.
const temporaryPrefix = join(root, ".test-run-");
const directory = await mkdtemp(temporaryPrefix);
try {
	const runnable = [];
	for (let index = 0; index < files.length; index++) {
		const path = files[index];
		const output = join(directory, `test-${index}.mjs`);
		await build({
			entryPoints: [path], outfile: output, bundle: true, platform: "node", format: "esm",
			target: "node24", packages: "external", logLevel: "warning", plugins: [
				runtimeBridgePlugin(),
				{
					name: "test-source-locations",
					setup(build) {
						// Preserve file-relative fixtures when modules move into a temporary bundle.
						build.onLoad({ filter: /\.(?:ts|mjs)$/, namespace: "file" }, async ({ path }) => ({
							contents: (await readFile(path, "utf8")).replaceAll("import.meta.url", JSON.stringify(pathToFileURL(path).href)),
							loader: path.endsWith(".ts") ? "ts" : "js"
						}));
					}
				}
			]
		});
		runnable.push(output);
	}
	const result = spawnSync(process.execPath, ["--test", ...runnable], { stdio: "inherit" });
	if (result.error) throw result.error;
	process.exitCode = result.status ?? 1;
} finally {
	// Only remove the temporary directory created by this run.
	if (!directory.startsWith(temporaryPrefix)) throw new Error("Unexpected temporary test directory.");
	await rm(directory, { recursive: true, force: true });
}
