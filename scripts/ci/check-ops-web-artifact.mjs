import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.argv[2];
if (!root) {
	throw new Error("ops-web production artifact directory is required");
}

const serverEntry = join(root, "dist-server", "node.js");
if (!existsSync(serverEntry)) {
	throw new Error(`ops-web production server entry is missing: ${serverEntry}`);
}

const serverSource = readFileSync(serverEntry, "utf8");
const workspaceImport = /(?:from|import\s*\(|require\s*\()\s*["']@campus-agent\/[^"']+["']/u;
if (workspaceImport.test(serverSource)) {
	throw new Error("ops-web production server must not import a workspace package at runtime");
}

const typeScriptImport = /(?:from|import\s*\(|require\s*\()\s*["'][^"']+\.ts["']/u;
if (typeScriptImport.test(serverSource)) {
	throw new Error(
		"ops-web production server must not import a TypeScript source module at runtime",
	);
}

if (existsSync(join(root, "node_modules", "@campus-agent", "dining"))) {
	throw new Error(
		"ops-web production dependencies must not contain the development-only dining workspace",
	);
}

console.log("ops-web production artifact is self-contained");
