import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { build } from "esbuild";
import { runtimeBridgePlugin } from "./runtime-bridge.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const port = Number(process.env.QUIZ_PREVIEW_PORT || 4317);
let pendingBuild;

async function previewBundle() {
	if (!pendingBuild) {
		pendingBuild = build({
			absWorkingDir: root,
			entryPoints: ["preview/main.ts"],
			bundle: true,
			write: false,
			format: "iife",
			target: "es2022",
			platform: "browser",
			logLevel: "silent",
			alias: { obsidian: path.join(root, "preview/obsidian.ts") },
			plugins: [runtimeBridgePlugin()]
		}).then(result => result.outputFiles[0].contents).finally(() => { pendingBuild = undefined; });
	}
	return pendingBuild;
}

const server = createServer(async (request, response) => {
	try {
		const pathname = new URL(request.url || "/", "http://localhost").pathname;
		response.setHeader("Cache-Control", "no-store");
		response.setHeader("X-Content-Type-Options", "nosniff");
		if (pathname === "/") {
			response.setHeader("Content-Type", "text/html; charset=utf-8");
			response.end(await readFile(path.join(root, "preview/index.html")));
		} else if (pathname === "/preview.js") {
			response.setHeader("Content-Type", "text/javascript; charset=utf-8");
			response.end(await previewBundle());
		} else if (pathname === "/styles.css") {
			response.setHeader("Content-Type", "text/css; charset=utf-8");
			const files = ["vendor/runtime-3.0.1.css", "styles/continuation.css", "preview/preview.css"];
			response.end((await Promise.all(files.map(name => readFile(path.join(root, name), "utf8")))).join("\n"));
		} else {
			response.writeHead(404).end("Not found");
		}
	} catch (error) {
		response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
		response.end(error instanceof Error ? error.message : "Preview failed");
	}
});

server.listen(port, "127.0.0.1", () => console.log(`Quiz preview: http://127.0.0.1:${port}`));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.close(() => process.exit()));
