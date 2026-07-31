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
				schema_version: "tool-registry-v6",
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
							type: "execution_control_internal_query",
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
							type: "execution_control_internal_query",
							endpoint: "/internal/query/fixture/internal",
						},
						timeout_ms: 1000,
						result_projection_policy: "bounded_json",
					},
				],
			},
			{
				runtimeFingerprint: testToolRuntimeFingerprint(),
				toolFunctionSchemaPath: testSchemaPath("test_lookup", "internal_fixture_tool"),
			},
		);

		expect(buildVisibleToolDefinitions(catalog).map((tool) => tool.name)).toEqual(["test_lookup"]);
	});

	it("rejects model-visible tools that are not read-only", () => {
		expect(() =>
			loadToolCatalogFromObject({
				schema_version: "tool-registry-v6",
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
							type: "execution_control_internal_query",
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
				schema_version: "tool-registry-v6",
				registry_version: "test",
				tools: [rawTestLookupTool()],
			}),
		).toThrow("tool function schema path is required");
	});

	it("requires every model-visible tool to have a strict function schema", () => {
		expect(() =>
			loadToolCatalogFromObject(
				{
					schema_version: "tool-registry-v6",
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
					schema_version: "tool-registry-v6",
					registry_version: "test",
					tools: [rawUnsupportedWorkflowSignalTool()],
				},
				{ toolFunctionSchemaPath: testSchemaPath("retired_workflow_signal") },
			),
		).toThrow();
	});

	it("rejects non-canonical execution-control query endpoints", () => {
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
						schema_version: "tool-registry-v6",
						registry_version: "test",
						tools: [tool],
					},
					{
						runtimeFingerprint: testToolRuntimeFingerprint(),
						toolFunctionSchemaPath: testSchemaPath("test_lookup"),
					},
				),
			).toThrow("endpoint must be a canonical /internal/ path");
		}
	});

	it("requires explicit runtime attestation when loading a catalog from an object", () => {
		expect(() =>
			loadToolCatalogFromObject(
				{
					schema_version: "tool-registry-v6",
					registry_version: "test",
					tools: [rawTestLookupTool()],
				},
				{ toolFunctionSchemaPath: testSchemaPath("test_lookup") },
			),
		).toThrow("tool runtime fingerprint is required");
	});

	it("exposes the registered personal memory tool", () => {
		const catalog = loadToolCatalog("../../configs/runtime/tools.v6.json");

		expect(catalog.tools.map((tool) => tool.name)).toEqual(["personal_memory_recall"]);
		expect(Object.fromEntries(catalog.tools.map((tool) => [tool.name, tool.exposure]))).toEqual({
			personal_memory_recall: "model_visible",
		});
		expect(buildVisibleToolDefinitions(catalog).map((tool) => tool.name)).toEqual([
			"personal_memory_recall",
		]);
	});

	it("keeps every registered tool on a canonical execution-control endpoint", () => {
		const catalog = loadToolCatalog("../../configs/runtime/tools.v6.json");

		for (const tool of catalog.tools) {
			expect(tool).toMatchObject({
				readOnly: true,
				requiresApproval: false,
				handler: {
					type: "execution_control_internal_query",
					endpoint: expect.stringMatching(/^\/internal\//),
				},
			});
		}
	});

	it("retains strict parameter schemas for registered tools", () => {
		const catalog = loadToolCatalog("../../configs/runtime/tools.v6.json");

		for (const tool of catalog.tools) {
			expect(tool.parameterSchema).toMatchObject({
				type: "object",
				additionalProperties: false,
			});
			expect(Array.isArray(tool.parameterSchema?.required)).toBe(true);
		}
	});

	it("uses the canonical tool function schema config for registered tools", () => {
		const catalog = loadToolCatalog("../../configs/runtime/tools.v6.json");
		const tools = catalog.tools;

		const personalMemory = tools.find((tool) => tool.name === "personal_memory_recall");

		expect(personalMemory?.parameterSchema?.required).toEqual(["query"]);
		expect(personalMemory?.parameterSchema?.properties).toHaveProperty("query");
	});

	it("attests the actual registry and function schema files loaded at runtime", () => {
		const dir = mkdtempSync(join(tmpdir(), "agent-runtime-tool-attestation-"));
		const toolRegistryPath = join(dir, "tools.v6.json");
		const toolFunctionSchemaPath = join(dir, "tool-function-schemas.v3.json");
		const toolRegistry = {
			schema_version: "tool-registry-v6",
			registry_version: "attestation-test",
			tools: [rawTestLookupTool()],
		};
		const functionSchemas = strictFunctionSchemaConfig("test_lookup");
		writeFileSync(toolRegistryPath, JSON.stringify(toolRegistry), "utf8");
		writeFileSync(toolFunctionSchemaPath, JSON.stringify(functionSchemas), "utf8");

		const catalog = loadToolCatalog(toolRegistryPath, {
			runtimeRelease: "test-release",
			toolFunctionSchemaPath,
		});
		const expectedCombined = sha256(
			JSON.stringify({
				function_schema_sha256: sha256CanonicalJson(functionSchemas),
				function_schema_version: "tool-function-schemas-v3",
				runtime_release: "test-release",
				schema_version: "tool_runtime_fingerprint.v2",
				tools_registry_version: "attestation-test",
				tools_schema_version: "tool-registry-v6",
				tools_sha256: sha256CanonicalJson(toolRegistry),
			}),
		);

		expect(catalog.runtimeFingerprint).toEqual({
			combinedSha256: expectedCombined,
			functionSchemaSha256: sha256CanonicalJson(functionSchemas),
			functionSchemaVersion: "tool-function-schemas-v3",
			runtimeRelease: "test-release",
			schemaVersion: "tool_runtime_fingerprint.v2",
			toolsRegistryVersion: "attestation-test",
			toolsSchemaVersion: "tool-registry-v6",
			toolsSha256: sha256CanonicalJson(toolRegistry),
		});
	});

	it("hashes runtime artifacts using canonical JSON content rather than file formatting", () => {
		const dir = mkdtempSync(join(tmpdir(), "agent-runtime-tool-canonical-attestation-"));
		const prettyToolRegistryPath = join(dir, "tools.pretty.json");
		const compactToolRegistryPath = join(dir, "tools.compact.json");
		const toolFunctionSchemaPath = join(dir, "tool-function-schemas.v3.json");
		const toolRegistry = {
			schema_version: "tool-registry-v6",
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

		expect(prettyCatalog.runtimeFingerprint).toEqual(compactCatalog.runtimeFingerprint);
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
			type: "execution_control_internal_query",
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
	const path = join(dir, "tool-function-schemas.v3.json");
	writeFileSync(path, JSON.stringify(schema), "utf8");
	return path;
}

function strictFunctionSchemaConfig(...toolNames: string[]) {
	return {
		schema_version: "tool-function-schemas-v3",
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

function testToolRuntimeFingerprint() {
	return {
		combinedSha256: sha256("combined-tool-runtime"),
		functionSchemaSha256: sha256("function-schema"),
		functionSchemaVersion: "tool-function-schemas-v3" as const,
		runtimeRelease: "test-release",
		schemaVersion: "tool_runtime_fingerprint.v2" as const,
		toolsRegistryVersion: "test",
		toolsSchemaVersion: "tool-registry-v6" as const,
		toolsSha256: sha256("tool-registry"),
	};
}
