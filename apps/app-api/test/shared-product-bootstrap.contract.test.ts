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
	it("keeps repeatable bootstrap artifacts while package scripts stay lifecycle-only", () => {
		const packageJson = JSON.parse(readAppFile("package.json")) as {
			scripts: Record<string, string>;
		};

		expect(packageJson.scripts["db:bootstrap"]).toBeUndefined();
		expect(packageJson.scripts["db:bootstrap:staging"]).toBeUndefined();
		expect(packageJson.scripts["dining:seed-initial-release"]).toBeUndefined();
		expect(packageJson.scripts["db:ensure-app-auth-role-search-path"]).toBeUndefined();
		expect(packageJson.scripts["db:print-auth-migration"]).toBeUndefined();
		expect(packageJson.scripts["db:reconcile-shared-drift"]).toBeUndefined();
		expect(packageJson.scripts["official-web:drain-projection"]).toBeUndefined();
		expect(packageJson.scripts.test).toBe("pnpm run test:node");
		expect(existsSync(join(appRoot, "scripts/run-node-tests.mjs"))).toBe(false);
		expect(packageJson.scripts["test:all"]).toBeUndefined();
		expect(packageJson.scripts["test:node"]).toBe(
			"pnpm run test:node:fast && pnpm run test:node:isolated",
		);
		expect(packageJson.scripts["test:node:fast"]).toContain("vitest.node-fast.config.mts");
		expect(packageJson.scripts["test:node:isolated"]).toContain("vitest.node-isolated.config.mts");
		expect(packageJson.scripts["test:worker"]).toContain("vitest.worker.config.mts");
		expect(packageJson.scripts["test:shared-db-integration"]).toContain(
			"vitest.shared-db.config.mts",
		);
		expect(packageJson.scripts["test:official-web-shared-db-integration"]).toBeUndefined();
		expect(packageJson.scripts["db:generate"]).toContain("drizzle-kit generate");
		expect(packageJson.scripts["db:check"]).toContain("drizzle-kit check");
	});

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
		expect(existsSync(join(appRoot, "db/shared-product-schema/chat_current.sql"))).toBe(false);
	});

	it("exports chat message feedback from the unified app-api schema object", () => {
		expect(Object.keys(appApiSchema)).toEqual(expect.arrayContaining(["messageFeedback"]));
	});

	it("keeps the current schema snapshot free of retired routing state", () => {
		const journal = JSON.parse(readAppFile("drizzle/meta/_journal.json")) as {
			entries: Array<{ idx: number }>;
		};
		const latestIndex = journal.entries.at(-1)?.idx;
		expect(latestIndex).toBeTypeOf("number");
		const snapshot = readAppFile(
			`drizzle/meta/${String(latestIndex).padStart(4, "0")}_snapshot.json`,
		);

		for (const retiredField of [
			"intent_classifier_version",
			"intent_schema_version",
			"intent_tool",
			"requested_scope",
			"resolved_scope",
			"version_query_json",
			"answer_eval_fingerprint_json",
			"llm_io_fingerprint_json",
			"requested_tool",
			"resolved_targets_json",
			"selected_tool",
		]) {
			expect(snapshot).not.toContain(retiredField);
		}
		expect(snapshot).not.toContain("execution_input_released_at");
		expect(snapshot).toContain('"chat.turn_dispatches"');
	});

	it("keeps retired replay and observability configuration out of the initial schema", () => {
		const baseline = readAppFile("drizzle/0000_initial.sql");
		const snapshot = readAppFile("drizzle/meta/0000_snapshot.json");

		for (const retiredName of [
			"llm_debug_trace_config",
			"replay_packet_access_audit",
			"replay_packet_index",
			"trace_backlink_projection",
			"debug_trace_refs_json",
		]) {
			expect(baseline).not.toContain(retiredName);
			expect(snapshot).not.toContain(retiredName);
		}
		expect(baseline).toContain('CREATE TABLE "observability"."ops_observability_read_audit"');
	});

	it("links app-api database ownership and installation documentation", () => {
		const readme = readAppFile("README.md");

		expect(readme).toContain("docs/data/postgres-ownership.md");
		expect(readme).toContain("jobs/app-api-schema/README.md");
		expect(readme).toContain("docs/runbooks/release.md");
		expect(readme).toContain("`ops/db/`");
		expect(readme).toContain("test:node");
		expect(readme).toContain("test:worker");
		expect(readme).toContain("test:shared-db-integration");
	});

	it("keeps official-web collector lifecycle outside app-api shared DB lanes", () => {
		const sharedDbConfig = readAppFile("vitest.shared-db.config.mts");

		expect(sharedDbConfig).not.toContain("test/official-web-shared-db.integration.test.ts");
		expect(existsSync(join(appRoot, "vitest.official-web-shared-db.config.mts"))).toBe(false);
		expect(existsSync(join(appRoot, "test/official-web-shared-db.integration.test.ts"))).toBe(
			false,
		);
	});

	it("uses one request-scoped database binding across product stores", () => {
		const requestScopeSource = readAppFile("src/app/request-scope.ts");

		expect(requestScopeSource).toContain(
			"store: createPgRuntimeRunStore(input.env, { getDb: runtime.getDb })",
		);
		expect(requestScopeSource).toContain(
			"store: createPgProfileMemoryStore(input.env, { getDb: runtime.getDb })",
		);
		expect(requestScopeSource).toContain(
			"store: createPgAccountAdminStore(input.env, { getDb: runtime.getDb })",
		);
		expect(requestScopeSource).toContain(
			"store: createPgAccountLifecycleStore(input.env, { getDb: runtime.getDb })",
		);
		expect(requestScopeSource).toContain(
			"createPgCampusGroupsStore(input.env, { getDb: runtime.getDb })",
		);
		expect(requestScopeSource).toContain(
			"detailStore: createPgChatConversationStore(input.env, { getDb: runtime.getDb })",
		);
		expect(requestScopeSource).toContain(
			"store: createPgChatConversationStore(input.env, { getDb: runtime.getDb })",
		);
		expect(requestScopeSource).toContain(
			"conversationStore: createPgChatConversationStore(input.env, {",
		);
		expect(requestScopeSource).toContain(
			"store: createPgChatCommandStore(input.env, { getDb: runtime.getDb })",
		);
	});

	it("cuts the worker app shell through app-local submodules instead of keeping helpers inline", () => {
		const appSource = readAppFile("src/app.ts");

		expect(appSource).toContain('from "./app/readiness"');
		expect(appSource).toContain('from "./app/request-scope"');
		expect(appSource).toContain('from "./app/routes"');
		expect(appSource).toContain('const APP_API_HTTP_SURFACE = "app_api"');
		expect(appSource).not.toContain("resolveRequestSurface");
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
