// @vitest-environment node

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";
import { appApiSchema } from "../src/db/schema";

const appRoot = resolve(import.meta.dirname, "..");

function readAppFile(relativePath: string): string {
	return readFileSync(join(appRoot, relativePath), "utf8");
}

describe("app-api schema and module ownership", () => {
	it("keeps the Drizzle schema installer inputs under app-api", () => {
		const requiredFiles = [
			"drizzle/0000_initial.sql",
			"drizzle/baseline/app_auth_pre_0006.sql",
			"drizzle/baseline/chat_pre_0001.sql",
			"ops/db/prepare-local.ts",
			"ops/db/schema.ts",
			"src/db/schema/managed.ts",
			"src/script-support/shared-db/database.ts",
			"vitest.worker.config.mts",
			"vitest.shared-db.config.mts",
			"test/shared-product-db.integration.test.ts",
		];

		for (const relativePath of requiredFiles) {
			expect(existsSync(join(appRoot, relativePath)), relativePath).toBe(true);
		}
	});

	it("exports chat message feedback from the unified app-api schema object", () => {
		expect(Object.keys(appApiSchema)).toEqual(expect.arrayContaining(["messageFeedback"]));
	});

	it("cuts the worker app shell through app-local submodules instead of keeping helpers inline", () => {
		const appSource = readAppFile("src/app.ts");

		expect(appSource).toContain('from "./app/readiness"');
		expect(appSource).toContain('from "./app/request-scope"');
		expect(appSource).toContain('from "./app/routes"');
	});

	it("keeps runtime command orchestration separate from normalization and write builders", () => {
		const serviceSource = readAppFile("src/modules/runtime-command/service.ts");
		const acceptanceSource = readAppFile("src/modules/runtime-command/service/acceptance.ts");
		const finalizationSource = readAppFile("src/modules/runtime-command/service/finalization.ts");

		expect(serviceSource).toContain('from "./service/acceptance"');
		expect(serviceSource).toContain('from "./service/errors"');
		expect(serviceSource).toContain('from "./service/finalization"');
		expect(serviceSource).toContain('from "./service/normalize"');
		expect(serviceSource).toContain('from "./service/types"');
		expect(serviceSource).not.toContain('from "./service/writes"');
		expect(acceptanceSource).toContain('from "./writes"');
		expect(finalizationSource).toContain('from "./writes"');
	});
});
