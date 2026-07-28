// @vitest-environment node

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";
import { appApiSchema } from "../src/db/schema";
import { APP_API_KNOWN_SCHEMAS } from "../src/script-support/shared-db/shared-product-schema-shared.ts";

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
	});

	it("checks in explicit current shared product bootstrap artifacts under app-api", () => {
		const requiredFiles = [
			"db/shared-product-schema/campus_services.sql",
			"db/shared-product-schema/chat_current.sql",
			"drizzle/0000_initial.sql",
			"ops/db/bootstrap-shared-product-database.ts",
			"ops/db/campus-services-grants.ts",
			"ops/db/ensure-app-auth-role-search-path.ts",
			"src/script-support/shared-db/shared-product-database-bootstrap.ts",
			"vitest.worker.config.mts",
			"vitest.shared-db.config.mts",
			"test/shared-product-db.integration.test.ts",
		];

		for (const relativePath of requiredFiles) {
			expect(existsSync(join(appRoot, relativePath)), relativePath).toBe(true);
		}
		expect(existsSync(join(appRoot, "db/shared-product-migrations"))).toBe(false);
	});

	it("exports chat message feedback from the unified app-api schema object", () => {
		expect(Object.keys(appApiSchema)).toEqual(expect.arrayContaining(["messageFeedback"]));
	});

	it("keeps the current schema snapshot free of retired routing state", () => {
		const chatSchema = readAppFile("db/shared-product-schema/chat_current.sql");
		const snapshot = readAppFile("drizzle/meta/0001_snapshot.json");

		for (const retiredField of [
			"intent_classifier_version",
			"intent_schema_version",
			"intent_tool",
			"requested_scope",
			"resolved_scope",
			"version_query_json",
			"answer_eval_fingerprint_json",
			"llm_io_fingerprint_json",
		]) {
			expect(snapshot).not.toContain(retiredField);
			expect(chatSchema).not.toContain(retiredField);
		}
		expect(chatSchema).toContain('"resolved_targets_json" jsonb');
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

	it("keeps app-owned schema inventory aligned with the current schema baseline", () => {
		expect(APP_API_KNOWN_SCHEMAS).toEqual(
			expect.arrayContaining(["campus_groups", "docs", "dining", "profile", "runtime"]),
		);
		expect(APP_API_KNOWN_SCHEMAS).not.toEqual(
			expect.arrayContaining(["identity", "observability"]),
		);
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

	it("keeps APP_API_DB_FRESH limited to explicit read-after-write paths", () => {
		const requestScopeSource = readAppFile("src/app/request-scope.ts");
		const freshDbReferences = requestScopeSource.match(/runtime\.getFreshDb/g) ?? [];
		expect(freshDbReferences).toHaveLength(8);

		expect(requestScopeSource).toContain(
			"store: createPgRuntimeRunStore(input.env, { getDb: runtime.getDb })",
		);
		expect(requestScopeSource).toContain(
			"store: createPgProfileMemoryStore(input.env, { getDb: runtime.getFreshDb })",
		);
		expect(requestScopeSource).toContain(
			"store: createPgAccountAdminStore(input.env, { getDb: runtime.getFreshDb })",
		);
		expect(requestScopeSource).toContain(
			"store: createPgAccountLifecycleStore(input.env, { getDb: runtime.getFreshDb })",
		);
		expect(requestScopeSource).toContain("getDb: runtime.getFreshDb");
		expect(requestScopeSource).toContain(
			"createPgCampusGroupsStore(input.env, { getDb: runtime.getFreshDb })",
		);
		expect(requestScopeSource).toContain(
			"detailStore: createPgChatConversationStore(input.env, { getDb: runtime.getFreshDb })",
		);
		expect(requestScopeSource).toContain(
			"dining ??= createPgDiningMapReadService(input.env, {\n\t\t\t\t\t\tgetDb: runtime.getFreshDb",
		);
		expect(requestScopeSource).toContain(
			"diningContent ??= createPgDiningContentService(input.env, {\n\t\t\t\t\t\tgetDb: runtime.getFreshDb",
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

	it("keeps Dining bootstrap outside the app-api shared database bootstrap", () => {
		const bootstrapSource = readAppFile("ops/db/bootstrap-shared-product-database.ts");

		expect(bootstrapSource).not.toContain("jobs/dining-sync");
		expect(bootstrapSource).not.toContain("import-dev-seed");
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
