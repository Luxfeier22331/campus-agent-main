import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";

const forbiddenRuntimePackages = [
	"@aws-sdk/client-s3",
	"@temporalio/client",
	"@temporalio/worker",
	"@temporalio/workflow",
	"openai",
	"pg",
	"qdrant-client",
] as const;

const forbiddenRuntimeTokens = [
	"process.env",
	"fetch(",
	'from "node:child_process"',
	'from "child_process"',
	'from "node:fs"',
	'from "node:fs/promises"',
	'from "fs"',
	'from "fs/promises"',
] as const;

const allowedRuntimeTokenOccurrences = new Map<string, readonly string[]>([
	["node.ts", ['from "node:fs"']],
]);

describe("ingest-core module boundaries", () => {
	it("does not import through the package facade from internal modules", () => {
		const offenders: string[] = [];
		for (const fileName of sourceFiles()) {
			const source = readSourceFile(fileName);
			if (source.includes('from "./index.ts"')) {
				offenders.push(basename(fileName));
			}
		}

		expect(offenders).toEqual([]);
	});

	it("does not depend on runtime, storage, database or provider clients", () => {
		const packageJson = JSON.parse(
			readFileSync(join(import.meta.dirname, "..", "package.json"), "utf8"),
		) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
		const declaredDependencies = {
			...packageJson.dependencies,
			...packageJson.devDependencies,
		};

		const offenders = forbiddenRuntimePackages.filter(
			(packageName) => declaredDependencies[packageName],
		);

		expect(offenders).toEqual([]);
	});

	it("does not import runtime clients, env bootstrap, fs access or network calls from src", () => {
		const offenders: string[] = [];
		for (const fileName of sourceFiles()) {
			const source = readSourceFile(fileName);
			for (const token of forbiddenRuntimeTokens) {
				if (!source.includes(token)) {
					continue;
				}
				if (allowedRuntimeTokenOccurrences.get(fileName)?.includes(token)) {
					continue;
				}
				offenders.push(`${fileName}: ${token}`);
			}
			for (const packageName of forbiddenRuntimePackages) {
				if (source.includes(`from "${packageName}"`) || source.includes(`from '${packageName}'`)) {
					offenders.push(`${fileName}: ${packageName}`);
				}
			}
		}

		expect(offenders).toEqual([]);
	});
});

function sourceFiles(): string[] {
	return readdirSync(join(import.meta.dirname, "..", "src"))
		.filter((fileName) => fileName.endsWith(".ts"))
		.sort();
}

function readSourceFile(fileName: string): string {
	return readFileSync(join(import.meta.dirname, "..", "src", fileName), "utf8");
}
