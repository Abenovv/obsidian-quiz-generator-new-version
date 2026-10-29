import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

process.chdir(fileURLToPath(new URL("../", import.meta.url)));
const runtimeFiles = ["main.js", "manifest.json", "styles.css"];
const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
const versions = JSON.parse(readFileSync("versions.json", "utf8"));
const packageInfo = JSON.parse(readFileSync("package.json", "utf8"));

assert.equal(manifest.id, "quiz-generator");
assert.equal(packageInfo.version, manifest.version);
assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
assert.equal(versions[manifest.version], manifest.minAppVersion);
assert.equal(manifest.isDesktopOnly, false);
execFileSync(process.execPath, ["--check", "main.js"], { stdio: "inherit" });

const checksumLines = readFileSync("SHA256SUMS", "utf8").trim().split(/\r?\n/);
assert.equal(checksumLines.length, runtimeFiles.length);
for (const name of runtimeFiles) {
  const content = readFileSync(name);
  assert.ok(content.length > 0, name + " is empty");
  const digest = createHash("sha256").update(content).digest("hex");
  assert.ok(checksumLines.includes(digest + "  " + name), "Checksum mismatch: " + name);
}

// Report filenames only. Never print a candidate credential.
const secretPatterns = [
  /AIza[0-9A-Za-z_-]{35}/,
  /(?:sk-proj-|sk-ant-|sk-)[A-Za-z0-9_-]{20,}/,
  /(?:ghp_|github_pat_)[A-Za-z0-9_]{20,}/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/
];
const privatePath = /(?:^|\/)(?:data\.json|study-data\.json|\.env(?:\..*)?|credentials\.json|service-account[^/]*\.json)$|\.(?:pem|key|p12|pfx)$/i;
const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0").filter(Boolean);
assert.ok(files.length > 0, "No tracked files to verify");
for (const file of files) {
  assert.ok(!privatePath.test(file), "Private file is tracked: " + file);
  const content = readFileSync(file, "utf8");
  assert.ok(!secretPatterns.some(pattern => pattern.test(content)), "Possible credential in " + file);
}
console.log("Verified Quiz Generator " + manifest.version + ": syntax, manifest, hashes, and " + files.length + " tracked files.");
