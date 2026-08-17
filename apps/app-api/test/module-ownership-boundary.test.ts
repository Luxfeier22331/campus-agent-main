// @vitest-environment node

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const appRoot = join(import.meta.dirname, "..");

function read(relativePath: string): string {
	return readFileSync(join(appRoot, relativePath), "utf8");
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

	it("keeps runtime-command store types independent from its service facade", () => {
		const source = read("src/modules/runtime-command/store-types.ts");
		expect(source).not.toContain('from "./service"');
		expect(source).not.toContain("from './service'");
	});

	it("keeps runtime-command assembly separate from its PostgreSQL adapters", () => {
		const assembly = read("src/modules/runtime-command/store.ts");
		const commands = read("src/modules/runtime-command/store-commands.ts");
		const profileMemorySnapshot = read("src/modules/profile-memory/snapshot.ts");

		expect(assembly).toContain("createPgChatAdmissionStore");
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
		expect(source).toContain('from "./service/durable-admission"');
		expect(source).toContain('from "./service/finalization"');
		expect(source).not.toContain("buildAcceptedWrite");
		expect(source).not.toContain("buildFinalizedWrite");
		expect(source).not.toContain("readFrozenChatAdmission");
	});
});
