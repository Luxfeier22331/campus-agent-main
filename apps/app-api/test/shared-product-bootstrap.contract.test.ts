// @vitest-environment node

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { appApiSchema } from "../src/db/schema";

const appRoot = resolve(import.meta.dirname, "..");

function readAppFile(relativePath: string): string {
	return readFileSync(join(appRoot, relativePath), "utf8");
}

describe("app-api shared product bootstrap contracts", () => {
	it("defines repeatable bootstrap and test lane commands for app_auth/chat ownership", () => {
		const packageJson = JSON.parse(readAppFile("package.json")) as {
			scripts: Record<string, string>;
		};

		expect(packageJson.scripts["db:bootstrap"]).toBeTruthy();
		expect(packageJson.scripts["db:bootstrap:staging"]).toBeTruthy();
		expect(packageJson.scripts["db:ensure-app-auth-role-search-path"]).toBeTruthy();
		expect(packageJson.scripts["db:print-auth-migration"]).toBeTruthy();
		expect(packageJson.scripts["db:reconcile-shared-drift"]).toContain(
			"reconcile-shared-db-drift.mjs",
		);
		expect(packageJson.scripts["official-web:drain-projection"]).toContain(
			"drain-official-web-projection.ts",
		);
		expect(packageJson.scripts["official-web:drain-projection"]).toContain("tsx");
		expect(packageJson.scripts.test).toBe("pnpm run test:node");
		expect(packageJson.scripts["test:all"]).toContain("vitest.config.mts");
		expect(packageJson.scripts["test:node"]).toContain("vitest.node.config.mts");
		expect(packageJson.scripts["test:worker"]).toContain("vitest.worker.config.mts");
		expect(packageJson.scripts["test:shared-db-integration"]).toContain(
			"vitest.shared-db.config.mts",
		);
	});

	it("checks in explicit shared product bootstrap artifacts under app-api", () => {
		const requiredFiles = [
			"db/shared-product-migrations/0001_chat_schema.sql",
			"db/shared-product-migrations/0002_message_retryable.sql",
			"db/shared-product-migrations/0003_chat_session_slots.sql",
			"db/shared-product-migrations/0004_chat_message_structured_parts.sql",
			"db/shared-product-migrations/0005_profile_memory.sql",
			"db/shared-product-migrations/0006_message_feedback.sql",
			"scripts/bootstrap-shared-product-database.mjs",
			"scripts/ensure-app-auth-role-search-path.mjs",
			"scripts/print-shared-product-auth-migration.mjs",
			"scripts/reconcile-shared-db-drift.mjs",
			"scripts/drain-official-web-projection.ts",
			"scripts/shared-product-database-bootstrap.mjs",
			"scripts/shared-product-database-bootstrap.d.mts",
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

	it("documents app-api as the shared product DB bootstrap owner", () => {
		const readme = readAppFile("README.md");

		expect(readme).toContain("db:bootstrap");
		expect(readme).toContain("db:bootstrap:staging");
		expect(readme).toContain("db:ensure-app-auth-role-search-path");
		expect(readme).toContain("db:reconcile-shared-drift");
		expect(readme).toContain("official-web:drain-projection");
		expect(readme).toContain("test:node");
		expect(readme).toContain("test:worker");
		expect(readme).toContain("test:shared-db-integration");
		expect(readme).toContain("app_auth.*");
		expect(readme).toContain("chat.*");
	});

	it("cuts the worker app shell through app-local submodules instead of keeping helpers inline", () => {
		const appSource = readAppFile("src/app.ts");

		expect(appSource).toContain('from "./app/readiness"');
		expect(appSource).toContain('from "./app/request-scope"');
		expect(appSource).toContain('from "./app/request-utils"');
		expect(appSource).toContain('from "./app/routes"');
		expect(appSource).not.toContain("function dependencyNotReadyResponse()");
		expect(appSource).not.toContain("function buildInternalEvalPrincipalFromRequest(");
		expect(appSource).not.toContain("async function defaultRuntimeReadinessProbe(");
	});

	it("cuts runtime command normalization and write builders into service submodules", () => {
		const serviceSource = readAppFile("src/modules/runtime-command/service.ts");

		expect(serviceSource).toContain('from "./service/errors"');
		expect(serviceSource).toContain('from "./service/normalize"');
		expect(serviceSource).toContain('from "./service/types"');
		expect(serviceSource).toContain('from "./service/writes"');
		expect(serviceSource).not.toContain("function normalizeRequestedScope(");
		expect(serviceSource).not.toContain("function buildAcceptedWrite(");
		expect(serviceSource).not.toContain("function buildFinalizedWrite(");
	});
});
