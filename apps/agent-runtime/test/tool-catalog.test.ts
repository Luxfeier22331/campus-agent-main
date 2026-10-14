import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	buildVisibleToolDefinitions,
	loadToolCatalog,
	loadToolCatalogFromObject,
} from "../src/tool-catalog.ts";

describe("tool catalog", () => {
	it("exposes only model-visible read-only tools to the SDK surface", () => {
		const catalog = loadToolCatalogFromObject(
			{
				schema_version: "tool-registry-v8",
				registry_version: "test",
				tools: [
					{
						name: "test_lookup",
						description: "Look up a test record.",
						exposure: "model_visible",
						read_only: true,
						requires_approval: false,
						payload_schema_ref: schemaRef(
							"personal-memory-tool-contracts.v1",
							"PersonalMemoryRecallPayload",
						),
						result_schema_ref: schemaRef(
							"personal-memory-tool-contracts.v1",
							"PersonalMemoryRecallResult",
						),
						handler: {
							type: "agent_control_internal_query",
							endpoint: "/internal/query/fixture/test",
						},
						timeout_ms: 1000,
						result_projection_policy: "bounded_json",
					},
					{
						name: "internal_fixture_tool",
						description: "Internal fixture tool.",
						exposure: "closed",
						read_only: true,
						requires_approval: false,
						payload_schema_ref: schemaRef(
							"personal-memory-tool-contracts.v1",
							"PersonalMemoryRecallPayload",
						),
						result_schema_ref: schemaRef(
							"personal-memory-tool-contracts.v1",
							"PersonalMemoryRecallResult",
						),
						handler: {
							type: "agent_control_internal_query",
							endpoint: "/internal/query/fixture/internal",
						},
						timeout_ms: 1000,
						result_projection_policy: "bounded_json",
					},
				],
			},
			{
				contractFingerprint: testToolContractFingerprint(),
				toolFunctionSchemaPath: testSchemaPath("test_lookup", "internal_fixture_tool"),
			},
		);

		expect(buildVisibleToolDefinitions(catalog).map((tool) => tool.name)).toEqual(["test_lookup"]);
	});

	it("rejects model-visible tools that are not read-only", () => {
		expect(() =>
			loadToolCatalogFromObject({
				schema_version: "tool-registry-v8",
				registry_version: "test",
				tools: [
					{
						name: "submit_ticket",
						description: "Submit a ticket.",
						exposure: "model_visible",
						read_only: false,
						requires_approval: true,
						payload_schema_ref: schemaRef(
							"personal-memory-tool-contracts.v1",
							"PersonalMemoryRecallPayload",
						),
						result_schema_ref: schemaRef(
							"personal-memory-tool-contracts.v1",
							"PersonalMemoryRecallResult",
						),
						handler: {
							type: "agent_control_internal_query",
							endpoint: "/internal/query/tickets/submit",
						},
						timeout_ms: 1000,
						result_projection_policy: "bounded_json",
					},
				],
			}),
		).toThrow("model-visible tool submit_ticket must be read-only");
	});

	it("requires a tool function schema config", () => {
		expect(() =>
			loadToolCatalogFromObject({
				schema_version: "tool-registry-v8",
				registry_version: "test",
				tools: [rawTestLookupTool()],
			}),
		).toThrow("tool function schema path is required");
	});

	it("requires every model-visible tool to have a strict function schema", () => {
		expect(() =>
			loadToolCatalogFromObject(
				{
					schema_version: "tool-registry-v8",
					registry_version: "test",
					tools: [rawTestLookupTool()],
				},
				{ toolFunctionSchemaPath: testSchemaPath("unrelated_fixture_tool") },
			),
		).toThrow("model_visible tool test_lookup missing strict function schema");
	});

	it("rejects retired internal route handlers", () => {
		expect(() =>
			loadToolCatalogFromObject(
				{
					schema_version: "tool-registry-v8",
					registry_version: "test",
					tools: [rawUnsupportedWorkflowSignalTool()],
				},
				{ toolFunctionSchemaPath: testSchemaPath("retired_workflow_signal") },
			),
		).toThrow();
	});

	it("rejects non-canonical agent-control query endpoints", () => {
		for (const endpoint of [
			"https://evil.example/internal/query",
			"//evil.example/internal/query",
			"/public/query",
			"/internal/../public/query",
			"/internal/%2e%2e/public/query",
			"/internal/query/%252e%252e/public",
			"/internal/query?next=/public/query",
		]) {
			const tool = rawTestLookupTool();
			tool.handler.endpoint = endpoint;
			expect(() =>
				loadToolCatalogFromObject(
					{
						schema_version: "tool-registry-v8",
						registry_version: "test",
						tools: [tool],
					},
					{
						contractFingerprint: testToolContractFingerprint(),
						toolFunctionSchemaPath: testSchemaPath("test_lookup"),
					},
				),
			).toThrow("endpoint must be a canonical /internal/ path");
		}
	});

	it("requires an explicit contract fingerprint when loading a catalog from an object", () => {
		expect(() =>
			loadToolCatalogFromObject(
				{
					schema_version: "tool-registry-v8",
					registry_version: "test",
					tools: [rawTestLookupTool()],
				},
				{ toolFunctionSchemaPath: testSchemaPath("test_lookup") },
			),
		).toThrow("tool contract fingerprint is required");
	});

	it("exposes the registered model-visible tools", () => {
		const catalog = loadToolCatalog("../../configs/runtime/tools.v8.json");

		expect(catalog.tools.map((tool) => tool.name)).toEqual([
			"campus_search",
			"personal_memory_recall",
		]);
		expect(Object.fromEntries(catalog.tools.map((tool) => [tool.name, tool.exposure]))).toEqual({
			campus_search: "model_visible",
			personal_memory_recall: "model_visible",
		});
		expect(buildVisibleToolDefinitions(catalog).map((tool) => tool.name)).toEqual([
			"campus_search",
			"personal_memory_recall",
		]);
		expect(catalog.registryVersion).toBe("2026-09-03");
		expect(catalog.tools.find((tool) => tool.name === "campus_search")).toMatchObject({
			description:
				"检索中央民族大学当前 Campus Web 文档与已发布通知中的校内事实、政策、办事流程和近期信息，返回供回答选择的候选结果。",
			timeoutMs: 45_000,
			parameterSchema: {
				properties: {
					search_query: {
						description:
							"面向校内资料的检索表达。包含事实维度词（如申请条件、费用、资助、合作院校、流程、材料）和时间范围（如最新、2026）；多个维度用空格分隔。不需要重复学校名称。",
					},
				},
			},
		});
		expect(catalog.tools.find((tool) => tool.name === "personal_memory_recall")).toMatchObject({
			timeoutMs: 12_000,
		});
	});

	it("keeps every registered tool on a canonical agent-control endpoint", () => {
		const catalog = loadToolCatalog("../../configs/runtime/tools.v8.json");

		for (const tool of catalog.tools) {
			expect(tool).toMatchObject({
				readOnly: true,
				requiresApproval: false,
				handler: {
					type: "agent_control_internal_query",
					endpoint: expect.stringMatching(/^\/internal\//),
				},
			});
		}
	});

	it("retains strict parameter schemas for registered tools", () => {
		const catalog = loadToolCatalog("../../configs/runtime/tools.v8.json");

		for (const tool of catalog.tools) {
			expect(tool.parameterSchema).toMatchObject({
				type: "object",
				additionalProperties: false,
			});
			expect(Array.isArray(tool.parameterSchema?.required)).toBe(true);
		}
	});

	it("uses the canonical tool function schema config for registered tools", () => {
		const catalog = loadToolCatalog("../../configs/runtime/tools.v8.json");
		const tools = catalog.tools;

		const personalMemory = tools.find((tool) => tool.name === "personal_memory_recall");

		expect(personalMemory?.parameterSchema?.required).toEqual(["query"]);
		expect(personalMemory?.parameterSchema?.properties).toHaveProperty("query");
	});

	it("attests the actual registry and function schema files loaded at runtime", () => {
		const dir = mkdtempSync(join(tmpdir(), "agent-runtime-tool-attestation-"));
		const toolRegistryPath = join(dir, "tools.v8.json");
		const toolFunctionSchemaPath = join(dir, "tool-function-schemas.v4.json");
		const toolRegistry = {
			schema_version: "tool-registry-v8",
			registry_version: "attestation-test",
			tools: [rawTestLookupTool()],
		};
		const functionSchemas = strictFunctionSchemaConfig("test_lookup");
		writeFileSync(toolRegistryPath, JSON.stringify(toolRegistry), "utf8");
		writeFileSync(toolFunctionSchemaPath, JSON.stringify(functionSchemas), "utf8");

		const catalog = loadToolCatalog(toolRegistryPath, { toolFunctionSchemaPath });

		expect(catalog.contractFingerprint).toEqual({
			functionSchemaSha256: sha256CanonicalJson(functionSchemas),
			schemaVersion: "tool_contract_fingerprint.v1",
			toolsSha256: sha256CanonicalJson(toolRegistry),
		});
	});

	it("hashes runtime artifacts using canonical JSON content rather than file formatting", () => {
		const dir = mkdtempSync(join(tmpdir(), "agent-runtime-tool-canonical-attestation-"));
		const prettyToolRegistryPath = join(dir, "tools.pretty.json");
		const compactToolRegistryPath = join(dir, "tools.compact.json");
		const toolFunctionSchemaPath = join(dir, "tool-function-schemas.v4.json");
		const toolRegistry = {
			schema_version: "tool-registry-v8",
			registry_version: "attestation-test",
			tools: [rawTestLookupTool()],
		};
		const functionSchemas = strictFunctionSchemaConfig("test_lookup");
		writeFileSync(prettyToolRegistryPath, JSON.stringify(toolRegistry, null, 2), "utf8");
		writeFileSync(compactToolRegistryPath, JSON.stringify(toolRegistry), "utf8");
		writeFileSync(toolFunctionSchemaPath, JSON.stringify(functionSchemas, null, 2), "utf8");

		const prettyCatalog = loadToolCatalog(prettyToolRegistryPath, {
			toolFunctionSchemaPath,
		});
		const compactCatalog = loadToolCatalog(compactToolRegistryPath, {
			toolFunctionSchemaPath,
		});

		expect(prettyCatalog.contractFingerprint).toEqual(compactCatalog.contractFingerprint);
	});

	it("uses the cross-runtime JSON string escaping contract", () => {
		const dir = mkdtempSync(join(tmpdir(), "agent-runtime-tool-cross-runtime-"));
		const toolRegistryPath = join(dir, "tools.v8.json");
		const toolFunctionSchemaPath = join(dir, "tool-function-schemas.v4.json");
		const tool = { ...rawTestLookupTool(), description: "<>&\u2028\u2029" };
		const toolRegistry = {
			schema_version: "tool-registry-v8",
			registry_version: "cross-runtime-test",
			tools: [tool],
		};
		const functionSchemas = strictFunctionSchemaConfig("test_lookup");
		writeFileSync(toolRegistryPath, JSON.stringify(toolRegistry), "utf8");
		writeFileSync(toolFunctionSchemaPath, JSON.stringify(functionSchemas), "utf8");

		const catalog = loadToolCatalog(toolRegistryPath, { toolFunctionSchemaPath });

		expect(catalog.contractFingerprint).toEqual({
			functionSchemaSha256:
				"sha256:7c97c07675d1a7eee74421eaf5d2e6a471c6e28ec15c5be8c49fa4a2eed6f91b",
			schemaVersion: "tool_contract_fingerprint.v1",
			toolsSha256: "sha256:d123b8fb642159378f0978edab89437da068c34e09a196406e6b64c1700fbda9",
		});
	});
});

function rawTestLookupTool() {
	return {
		name: "test_lookup",
		description: "Look up a test record.",
		exposure: "model_visible",
		read_only: true,
		requires_approval: false,
		payload_schema_ref: schemaRef(
			"personal-memory-tool-contracts.v1",
			"PersonalMemoryRecallPayload",
		),
		result_schema_ref: schemaRef("personal-memory-tool-contracts.v1", "PersonalMemoryRecallResult"),
		handler: {
			type: "agent_control_internal_query",
			endpoint: "/internal/query/fixture/test",
		},
		timeout_ms: 1000,
		result_projection_policy: "bounded_json",
	};
}

function rawUnsupportedWorkflowSignalTool() {
	return {
		name: "retired_workflow_signal",
		description: "Retired workflow signal fixture.",
		exposure: "closed",
		read_only: true,
		requires_approval: false,
		payload_schema_ref: schemaRef(
			"personal-memory-tool-contracts.v1",
			"PersonalMemoryRecallPayload",
		),
		result_schema_ref: schemaRef("personal-memory-tool-contracts.v1", "PersonalMemoryRecallResult"),
		handler: {
			type: "workflow_signal",
		},
		timeout_ms: 1000,
		result_projection_policy: "bounded_json",
	};
}

function schemaRef(schemaName: string, definitionName: string): string {
	return `https://muc.wiki/campus-agent/schemas/${schemaName}.schema.json#/$defs/${definitionName}`;
}

function testSchemaPath(...toolNames: string[]): string {
	const dir = mkdtempSync(join(tmpdir(), "agent-runtime-tool-schema-"));
	const schema = strictFunctionSchemaConfig(...toolNames);
	const path = join(dir, "tool-function-schemas.v4.json");
	writeFileSync(path, JSON.stringify(schema), "utf8");
	return path;
}

function strictFunctionSchemaConfig(...toolNames: string[]) {
	return {
		schema_version: "tool-function-schemas-v4",
		tools: toolNames.map((name) => ({
			type: "function",
			name,
			description: `${name} test schema`,
			strict: true,
			parameters: {
				type: "object",
				additionalProperties: false,
				properties: {
					query_text: { type: "string", minLength: 1 },
				},
				required: ["query_text"],
			},
		})),
	};
}

function sha256(value: string): string {
	return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function sha256CanonicalJson(value: unknown): string {
	return sha256(stableJsonStringify(value));
}

function stableJsonStringify(value: unknown): string {
	if (Array.isArray(value)) {
		return `[${value.map((item) => stableJsonStringify(item)).join(",")}]`;
	}
	if (value !== null && typeof value === "object") {
		const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
			left < right ? -1 : left > right ? 1 : 0,
		);
		return `{${entries
			.map(([key, child]) => `${JSON.stringify(key)}:${stableJsonStringify(child)}`)
			.join(",")}}`;
	}
	return JSON.stringify(value);
}

function testToolContractFingerprint() {
	return {
		functionSchemaSha256: sha256("function-schema"),
		schemaVersion: "tool_contract_fingerprint.v1" as const,
		toolsSha256: sha256("tool-registry"),
	};
}
