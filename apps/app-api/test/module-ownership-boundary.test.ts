// @vitest-environment node

import { readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const appRoot = join(import.meta.dirname, "..");

function read(relativePath: string): string {
	return readFileSync(join(appRoot, relativePath), "utf8");
}

const appSourceRoot = join(appRoot, "src");
const appModulesRoot = join(appSourceRoot, "modules");
const authModuleRoot = join(appModulesRoot, "auth");

function isWithin(root: string, candidate: string): boolean {
	const path = relative(root, candidate);
	return path === "" || !(path.startsWith("..") || isAbsolute(path));
}

function resolveLocalModule(importer: string, specifier: string): string | null {
	if (!specifier.startsWith(".")) {
		return null;
	}

	const base = resolve(dirname(importer), specifier);
	for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) {
		try {
			if (statSync(candidate).isFile()) {
				return candidate;
			}
		} catch {
			// Ignore unresolved local imports; the TypeScript compiler owns resolution errors.
		}
	}
	return null;
}

function collectModuleAuthEdges(entryRelativePath: string): string[] {
	const pending = [join(appRoot, entryRelativePath)];
	const visited = new Set<string>();
	const authEdges: string[] = [];

	while (pending.length > 0) {
		const next = pending.pop();
		if (!next) {
			continue;
		}
		const current = resolve(next);
		if (visited.has(current) || !isWithin(appModulesRoot, current)) {
			continue;
		}
		visited.add(current);

		const source = readFileSync(current, "utf8");
		const specifiers = new Set<string>();
		for (const match of source.matchAll(/\bfrom\s*["']([^"']+)["']/gu)) {
			const specifier = match[1];
			if (specifier) {
				specifiers.add(specifier);
			}
		}
		for (const match of source.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/gu)) {
			const specifier = match[1];
			if (specifier) {
				specifiers.add(specifier);
			}
		}
		for (const match of source.matchAll(/^\s*import\s*["']([^"']+)["']/gmu)) {
			const specifier = match[1];
			if (specifier) {
				specifiers.add(specifier);
			}
		}

		for (const specifier of specifiers) {
			const dependency = resolveLocalModule(current, specifier);
			if (!dependency) {
				continue;
			}
			if (isWithin(authModuleRoot, dependency)) {
				authEdges.push(`${current} -> ${dependency}`);
			}
			if (isWithin(appModulesRoot, dependency)) {
				pending.push(dependency);
			}
		}
	}

	return authEdges;
}

describe("app-api module ownership boundary", () => {
	it("keeps chat persistence independent from profile-memory persistence", () => {
		const source = read("src/modules/chat/store.ts");

		expect(source).not.toContain("profileMemoryCommands");
		expect(source).not.toContain("profileMemoryCommandSources");
		expect(source).not.toContain("profileMemorySettings");
		expect(source).not.toContain("../profile-memory/command-state");
	});

	it("keeps persisted schema definitions independent from service facades", () => {
		for (const relativePath of [
			"src/db/schema/chat.ts",
			"src/db/schema/runtime.ts",
			"src/db/schema/profile.ts",
		]) {
			const source = read(relativePath);
			expect(source, relativePath).not.toMatch(/from ["'].*(?:service|store|integration)["']/u);
		}
	});

	it("keeps turn-dispatch persistence types independent from auth runtime types", () => {
		const source = read("src/modules/turn-dispatch-types.ts");

		expect(source).not.toContain("ResolvedAppPrincipal");
		expect(source).not.toMatch(/from ["'][^"']*auth/u);
	});

	it("keeps runtime-command store types independent from its service facade", () => {
		const source = read("src/modules/runtime-command/store-types.ts");
		expect(source).not.toContain('from "./service"');
		expect(source).not.toContain("from './service'");
	});

	it("keeps runtime-command error policy independent from write builders", () => {
		const errors = read("src/modules/runtime-command/service/errors.ts");
		const writes = read("src/modules/runtime-command/service/writes.ts");

		expect(errors).not.toContain('from "./writes"');
		expect(errors).not.toContain("from './writes'");
		expect(writes).toContain('from "./errors"');
	});

	it("keeps runtime-command assembly separate from its PostgreSQL adapters", () => {
		const assembly = read("src/modules/runtime-command/store.ts");
		const commands = read("src/modules/runtime-command/store-commands.ts");
		const profileMemorySnapshot = read("src/modules/profile-memory/snapshot.ts");

		expect(assembly).toContain("createPgAcceptedChatCommandStore");
		expect(assembly).toContain("createPgChatCommandObservabilityStore");
		expect(assembly).not.toContain("../../db/schema");
		expect(commands).toContain("captureProfileMemorySnapshotForUpdate");
		expect(commands).not.toContain("profileMemorySettings");
		expect(commands).not.toContain("isProfileMemoryRuntimeEnabled");
		expect(profileMemorySnapshot).toContain("profileMemorySettings");
		expect(profileMemorySnapshot).toContain('.for("update")');
	});

	it("keeps runtime-command orchestration independent from persistence write construction", () => {
		const source = read("src/modules/runtime-command/service.ts");

		expect(source).toContain('from "./service/acceptance"');
		expect(source).toContain('from "./service/durable-run"');
		expect(source).toContain('from "./service/finalization"');
		expect(source).not.toContain("buildAcceptedWrite");
		expect(source).not.toContain("buildFinalizedWrite");
		expect(source).not.toContain("readFrozenChatAdmission");
	});

	it("keeps Email Access independent from Auth implementations", () => {
		const service = read("src/modules/email-access/service.ts");
		expect(service).not.toMatch(/from ["']\.\.\/auth(?:\/|["'])/u);
		expect(collectModuleAuthEdges("src/modules/email-access/index.ts")).toEqual([]);
	});
});
