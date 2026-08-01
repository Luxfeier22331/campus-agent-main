import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
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

const bootstrapEntry = join(root, "dist-ops", "db", "bootstrap-dining.js");
if (!existsSync(bootstrapEntry)) {
	throw new Error(`ops-web production bootstrap entry is missing: ${bootstrapEntry}`);
}

const databaseEntry = join(root, "dist-ops", "db", "ops-web-database.js");
if (!existsSync(databaseEntry)) {
	throw new Error(`ops-web production database entry is missing: ${databaseEntry}`);
}

const internalPortalCheckEntry = join(root, "dist-ops", "internal-portal", "check.js");
if (!existsSync(internalPortalCheckEntry)) {
	throw new Error(
		`ops-web production internal portal check entry is missing: ${internalPortalCheckEntry}`,
	);
}

const diningJournal = join(root, "drizzle", "meta", "_journal.json");
if (!existsSync(diningJournal)) {
	throw new Error(`ops-web Dining migration journal is missing: ${diningJournal}`);
}
const journal = JSON.parse(readFileSync(diningJournal, "utf8"));
for (const entry of journal.entries ?? []) {
	const migration = join(root, "drizzle", `${entry.tag}.sql`);
	if (!existsSync(migration)) {
		throw new Error(`ops-web Dining migration is missing: ${migration}`);
	}
}

for (const [label, entry] of [
	["bootstrap", bootstrapEntry],
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
