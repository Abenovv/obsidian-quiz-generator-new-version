import { build, transform } from "esbuild";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { runtimeBridgePlugin, VENDOR_CSS_SHA256 } from "./runtime-bridge.mjs";

process.chdir(fileURLToPath(new URL("../", import.meta.url)));
const result = await build({
	entryPoints: ["src/continuation/main.ts"],
	outfile: "main.js",
	write: false,
	bundle: true,
	format: "cjs",
	platform: "browser",
	target: "es2022",
	external: ["obsidian"],
	plugins: [runtimeBridgePlugin()],
	minify: true,
	legalComments: "inline",
	sourcemap: false,
	logLevel: "info",
	banner: { js: "/* Quiz Generator Continued. Built from typed extensions and the pinned 3.0.1 compatibility runtime. MIT licensed. */" }
});
const vendorCss = await readFile("vendor/runtime-3.0.1.css");
if (createHash("sha256").update(vendorCss).digest("hex") !== VENDOR_CSS_SHA256) {
	throw new Error("The compatibility stylesheet differs from the reviewed 3.0.1 distribution.");
}
const css = [vendorCss.toString("utf8"), await readFile("styles/continuation.css", "utf8")];
const stylesheet = css.map(value => value.replace(/\r\n/g, "\n").trimEnd()).join("\n\n") + "\n";
await transform(stylesheet, { loader: "css", logLevel: "warning" });
const script = result.outputFiles[0]?.contents;
if (!script?.length) throw new Error("The plugin build did not produce a runtime file.");
const manifest = await readFile("manifest.json");
const outputs = new Map([["main.js", script], ["styles.css", Buffer.from(stylesheet)]]);
const checksums = new Map([["main.js", script], ["manifest.json", manifest], ["styles.css", Buffer.from(stylesheet)]]);
const sums = Array.from(checksums, ([path, bytes]) => createHash("sha256").update(bytes).digest("hex") + "  " + path);
// Compile and validate every input before replacing installable files.
for (const [path, bytes] of outputs) await writeFile(path, bytes);
await writeFile("SHA256SUMS", sums.join("\n") + "\n");
