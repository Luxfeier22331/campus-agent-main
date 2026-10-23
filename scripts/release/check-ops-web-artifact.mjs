import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = process.argv[2];
if (!root) {
	throw new Error("ops-web production artifact directory is required");
}

const serverEntry = join(root, "dist-server", "node.js");
if (!existsSync(serverEntry)) {
	throw new Error(`ops-web production server entry is missing: ${serverEntry}`);
}

function javascriptFiles(directory) {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) {
			return javascriptFiles(path);
		}
		return entry.name.endsWith(".js") ? [path] : [];
	});
}

const serverSources = javascriptFiles(join(root, "dist-server")).map((path) =>
	readFileSync(path, "utf8"),
);
const serverSource = serverSources.join("\n");
const workspaceImport = /(?:from|import\s*\(|require\s*\()\s*["']@campus-agent\/[^"']+["']/u;
if (workspaceImport.test(serverSource)) {
	throw new Error("ops-web production server must not import a workspace package at runtime");
}

const typeScriptImport =
	/(?:from\s*["']|import\s*\(\s*["']|require\s*\(\s*["'])[^"']+(?<!\.d)\.ts["']/u;
if (typeScriptImport.test(serverSource)) {
	throw new Error(
		"ops-web production server must not import a TypeScript source module at runtime",
	);
}

const externalJsdomImport = /(?:from|import\s*\(|require\s*\()\s*["']jsdom["']/u;
if (!externalJsdomImport.test(serverSource)) {
	throw new Error("ops-web production server must keep jsdom external");
}

try {
	execFileSync(
		process.execPath,
		[
			"--input-type=module",
			"--eval",
			'const { JSDOM } = await import("jsdom"); new JSDOM("<body></body>");',
		],
		{ cwd: root, stdio: "pipe" },
	);
} catch (error) {
	throw new Error("ops-web production artifact cannot load jsdom from its deploy dependencies", {
		cause: error,
	});
}

const bootstrapEntry = join(root, "dist-ops", "db", "bootstrap-dining.js");
if (!existsSync(bootstrapEntry)) {
	throw new Error(`ops-web production bootstrap entry is missing: ${bootstrapEntry}`);
}

const transportBootstrapEntry = join(root, "dist-ops", "db", "bootstrap-transport.js");
if (!existsSync(transportBootstrapEntry)) {
	throw new Error(
		`ops-web production transport bootstrap entry is missing: ${transportBootstrapEntry}`,
	);
}

const databaseEntry = join(root, "dist-ops", "db", "ops-web-database.js");
if (!existsSync(databaseEntry)) {
	throw new Error(`ops-web production database entry is missing: ${databaseEntry}`);
}

const internalPortalCheckEntry = join(root, "dist-ops", "internal-portal-check.js");
if (!existsSync(internalPortalCheckEntry)) {
	throw new Error(`ops-web internal portal check entry is missing: ${internalPortalCheckEntry}`);
}

for (const [label, entry] of [
	["Dining bootstrap", bootstrapEntry],
	["transport bootstrap", transportBootstrapEntry],
	["database", databaseEntry],
	["internal portal check", internalPortalCheckEntry],
]) {
	try {
		execFileSync(
			process.execPath,
			[
				"--input-type=module",
				"--eval",
				`await import(${JSON.stringify(pathToFileURL(entry).href)})`,
			],
			{ cwd: root, stdio: "pipe" },
		);
	} catch (error) {
		throw new Error(`ops-web production ${label} entry cannot load its runtime dependencies`, {
			cause: error,
		});
	}
}

console.log("ops-web production artifact is self-contained");
