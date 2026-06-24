// @vitest-environment node

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { APP_API_KNOWN_SCHEMAS } from "../scripts/adopt-shared-database.mjs";
import { appApiSchema } from "../src/db/schema";

const appRoot = resolve(import.meta.dirname, "..");

function readAppFile(relativePath: string): string {
	return readFileSync(join(appRoot, relativePath), "utf8");
}

function extractRequestScopeResolver(source: string, resolverName: string): string {
	const start = source.indexOf(`function ${resolverName}()`);
	if (start < 0) {
		throw new Error(`${resolverName} must exist in request-scope.ts`);
	}

	const nextResolver = source.indexOf("\n\t\t\tfunction ", start + 1);
	const returnBlock = source.indexOf("\n\t\t\treturn {", start + 1);
	const candidates = [nextResolver, returnBlock].filter((candidate) => candidate > start);
	if (candidates.length === 0) {
		throw new Error(`${resolverName} must have a bounded source section`);
	}

	return source.slice(start, Math.min(...candidates));
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
		expect(packageJson.scripts.test).toContain("run-node-tests.mjs");
		expect(existsSync(join(appRoot, "scripts/run-node-tests.mjs"))).toBe(true);
		expect(packageJson.scripts["test:all"]).toContain("vitest.config.mts");
		expect(packageJson.scripts["test:node"]).toContain("vitest.node.config.mts");
		expect(packageJson.scripts["test:worker"]).toContain("vitest.worker.config.mts");
		expect(packageJson.scripts["test:shared-db-integration"]).toContain(
			"vitest.shared-db.config.mts",
		);
		expect(packageJson.scripts["test:official-web-shared-db-integration"]).toContain(
			"vitest.official-web-shared-db.config.mts",
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
			"db/shared-product-migrations/0007_dining_operations.sql",
			"db/shared-product-migrations/0008_chat_conversation_management.sql",
			"db/shared-product-migrations/0009_chat_turn_branch_context.sql",
			"scripts/bootstrap-shared-product-with-seeds.mjs",
			"scripts/bootstrap-shared-product-database.mjs",
			"scripts/seed-initial-dining-release.ts",
			"scripts/ensure-app-auth-role-search-path.mjs",
			"scripts/print-shared-product-auth-migration.mjs",
			"scripts/reconcile-shared-db-drift.mjs",
			"scripts/drain-official-web-projection.ts",
			"scripts/run-with-staging-proof-env.mjs",
			"scripts/staging-runtime-db-proof.ts",
			"scripts/shared-product-database-bootstrap.mjs",
			"scripts/shared-product-database-bootstrap.d.mts",
			"vitest.worker.config.mts",
			"vitest.shared-db.config.mts",
			"vitest.official-web-shared-db.config.mts",
			"test/shared-product-db.integration.test.ts",
			"test/official-web-shared-db.integration.test.ts",
		];

		for (const relativePath of requiredFiles) {
			expect(existsSync(join(appRoot, relativePath)), relativePath).toBe(true);
		}
	});

	it("exports chat message feedback from the unified app-api schema object", () => {
		expect(Object.keys(appApiSchema)).toEqual(expect.arrayContaining(["messageFeedback"]));
	});

	it("scans all app-owned schemas during shared DB adoption and drift reconciliation", () => {
		expect(APP_API_KNOWN_SCHEMAS).toEqual(
			expect.arrayContaining([
				"docs",
				"dining",
				"identity",
				"official_web",
				"operator",
				"profile",
				"runtime",
				"wechat_official_account",
			]),
		);
	});

	it("documents app-api as the shared product DB bootstrap owner", () => {
		const readme = readAppFile("README.md");

		expect(readme).toContain("bootstrap-shared-product-with-seeds.mjs");
		expect(readme).toContain("ensure-app-auth-role-search-path.mjs");
		expect(readme).toContain("reconcile-shared-db-drift.mjs");
		expect(readme).toContain("drain-official-web-projection.ts");
		expect(readme).toContain("test:node");
		expect(readme).toContain("test:worker");
		expect(readme).toContain("test:shared-db-integration");
		expect(readme).toContain("test:official-web-shared-db-integration");
		expect(readme).toContain("app_auth.*");
		expect(readme).toContain("chat.*");
	});

	it("keeps official-web collector lifecycle outside the default shared DB lane", () => {
		const sharedDbConfig = readAppFile("vitest.shared-db.config.mts");
		const officialWebSharedDbConfig = readAppFile("vitest.official-web-shared-db.config.mts");

		expect(sharedDbConfig).not.toContain("test/official-web-shared-db.integration.test.ts");
		expect(officialWebSharedDbConfig).toContain("test/official-web-shared-db.integration.test.ts");
	});

	it("wires identity preference reads and writes through the default cached lane", () => {
		const requestScopeSource = readAppFile("src/app/request-scope.ts");
		const identityServiceStart = requestScopeSource.indexOf(
			"identityPlatformService = buildIdentityPlatformService({",
		);
		const identityServiceEnd = requestScopeSource.indexOf(
			"function resolveOfficialWebQueryService()",
			identityServiceStart,
		);

		expect(identityServiceStart).toBeGreaterThan(-1);
		expect(identityServiceEnd).toBeGreaterThan(identityServiceStart);
		expect(requestScopeSource.slice(identityServiceStart, identityServiceEnd)).toContain(
			"profileMemoryStore: createPgProfileMemoryStore(input.env, {\n\t\t\t\t\t\tgetDb: runtime.getDb,",
		);
	});

	it("keeps APP_API_DB_FRESH limited to explicit read-after-write paths", () => {
		const requestScopeSource = readAppFile("src/app/request-scope.ts");

		for (const resolverName of [
			"resolveAuthenticatedNoticeProcessingCommandService",
			"resolveAuthenticatedNoticeRunProcessingCommandService",
			"resolveCampusServicesOpsService",
			"resolveChatCommandService",
			"resolveIdentityPlatformService",
			"resolveOfficialWebCommandService",
			"resolveOfficialWebReleaseTaskProcessingCommandService",
			"resolveOfficialWebTargetReleaseGateService",
			"resolveOperatorObservabilityCommandService",
			"resolveProfileMemoryService",
			"resolveRuntimeRunService",
			"resolveWeChatOfficialAccountCommandService",
		]) {
			const resolverSource = extractRequestScopeResolver(requestScopeSource, resolverName);
			expect(resolverSource, `${resolverName} must not use APP_API_DB_FRESH`).not.toContain(
				"runtime.getFreshDb",
			);
			expect(resolverSource, `${resolverName} must use APP_API_DB`).toContain("runtime.getDb");
		}

		for (const resolverName of ["resolveDiningOperationsService", "resolveProviderConfigService"]) {
			const resolverSource = extractRequestScopeResolver(requestScopeSource, resolverName);
			expect(resolverSource, `${resolverName} must use APP_API_DB_FRESH`).toContain(
				"runtime.getFreshDb",
			);
		}

		const chatConversationResolver = extractRequestScopeResolver(
			requestScopeSource,
			"resolveChatConversationService",
		);
		expect(chatConversationResolver).toContain(
			"detailStore: createPgChatConversationStore(input.env, { getDb: runtime.getFreshDb })",
		);
		expect(chatConversationResolver).toContain(
			"store: createPgChatConversationStore(input.env, { getDb: runtime.getDb })",
		);
	});

	it("wires dining operations through shared PG storage instead of process memory", () => {
		const requestScopeSource = readAppFile("src/app/request-scope.ts");
		const diningServiceStart = requestScopeSource.indexOf(
			"diningOperationsService = buildDiningOperationsService({",
		);
		const diningServiceEnd = requestScopeSource.indexOf(
			"function resolveOfficialWebCommandService()",
			diningServiceStart,
		);

		expect(diningServiceStart).toBeGreaterThan(-1);
		expect(diningServiceEnd).toBeGreaterThan(diningServiceStart);
		const diningScopeSource = requestScopeSource.slice(diningServiceStart, diningServiceEnd);
		expect(diningScopeSource).toContain("createPgDiningOperationsStore(input.env, {");
		expect(diningScopeSource).toContain("getDb: runtime.getFreshDb");
		expect(requestScopeSource).not.toContain("createProcessDiningOperationsStore");
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
