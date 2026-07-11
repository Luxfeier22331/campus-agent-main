import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	buildInternalToolDefinitions,
	buildVisibleToolDefinitions,
	loadToolCatalog,
	loadToolCatalogFromObject,
} from "../src/tool-catalog.ts";

describe("tool catalog", () => {
	it("exposes only model-visible read-only tools to the SDK surface", () => {
		const catalog = loadToolCatalogFromObject(
			{
				schema_version: "tool-registry-v4",
				registry_version: "test",
				tools: [
					{
						name: "transport_schedule_lookup",
						description: "Lookup campus shuttle schedule snapshots.",
						exposure: "model_visible",
						read_only: true,
						requires_approval: false,
						payload_schema_ref: schemaRef(
							"campus-services-tool-contracts.v1",
							"TransportScheduleLookupPayload",
						),
						result_schema_ref: schemaRef(
							"campus-services-tool-contracts.v1",
							"TransportScheduleLookupResult",
						),
						handler: {
							type: "execution_control_internal_query",
							endpoint: "/internal/query/campus-services/transport-schedule",
						},
						timeout_ms: 1000,
						result_projection_policy: "bounded_json",
					},
					{
						name: "internal_fixture_tool",
						description: "Internal fixture tool.",
						exposure: "internal_only",
						read_only: true,
						requires_approval: false,
						payload_schema_ref: schemaRef(
							"campus-services-tool-contracts.v1",
							"TransportScheduleLookupPayload",
						),
						result_schema_ref: schemaRef(
							"campus-services-tool-contracts.v1",
							"TransportScheduleLookupResult",
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
				toolFunctionSchemaPath: testSchemaPath(
					"transport_schedule_lookup",
					"internal_fixture_tool",
				),
			},
		);

		expect(buildVisibleToolDefinitions(catalog).map((tool) => tool.name)).toEqual([
			"transport_schedule_lookup",
		]);
	});

	it("rejects model-visible tools that are not read-only", () => {
		expect(() =>
			loadToolCatalogFromObject({
				schema_version: "tool-registry-v4",
				registry_version: "test",
				tools: [
					{
						name: "submit_ticket",
						description: "Submit a ticket.",
						exposure: "model_visible",
						read_only: false,
						requires_approval: true,
						payload_schema_ref: schemaRef(
							"campus-services-tool-contracts.v1",
							"TransportScheduleLookupPayload",
						),
						result_schema_ref: schemaRef(
							"campus-services-tool-contracts.v1",
							"TransportScheduleLookupResult",
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
				schema_version: "tool-registry-v4",
				registry_version: "test",
				tools: [rawTransportScheduleTool()],
			}),
		).toThrow("tool function schema path is required");
	});

	it("requires every model-visible tool to have a strict function schema", () => {
		expect(() =>
			loadToolCatalogFromObject(
				{
					schema_version: "tool-registry-v4",
					registry_version: "test",
					tools: [rawTransportScheduleTool()],
				},
				{ toolFunctionSchemaPath: testSchemaPath("unrelated_fixture_tool") },
			),
		).toThrow("model_visible tool transport_schedule_lookup missing strict function schema");
	});

	it("rejects retired internal route handlers", () => {
		expect(() =>
			loadToolCatalogFromObject(
				{
					schema_version: "tool-registry-v4",
					registry_version: "test",
					tools: [rawUnsupportedWorkflowSignalTool()],
				},
				{ toolFunctionSchemaPath: testSchemaPath("knowledge_query") },
			),
		).toThrow();
	});

	it("requires explicit runtime attestation when loading a catalog from an object", () => {
		expect(() =>
			loadToolCatalogFromObject(
				{
					schema_version: "tool-registry-v4",
					registry_version: "test",
					tools: [rawTransportScheduleTool()],
				},
				{ toolFunctionSchemaPath: testSchemaPath("transport_schedule_lookup") },
			),
		).toThrow("tool runtime fingerprint is required");
	});

	it("loads the checked-in catalog and exposes only model-facing tools", () => {
		const catalog = loadToolCatalog("../../configs/runtime/tools.v4.json");

		expect(buildVisibleToolDefinitions(catalog).map((tool) => tool.name)).toEqual([
			"transport_schedule_lookup",
			"knowledge_query",
		]);
	});

	it("exposes knowledge_query as a handoff-only model-visible tool", () => {
		const catalog = loadToolCatalog("../../configs/runtime/tools.v4.json");
		const visibleTools = buildVisibleToolDefinitions(catalog);

		const knowledge = catalog.tools.find((tool) => tool.name === "knowledge_query");

		expect(knowledge).toMatchObject({
			name: "knowledge_query",
			exposure: "model_visible",
			readOnly: true,
			requiresApproval: false,
			handler: { type: "agent_handoff", target: "knowledge_agent" },
		});
		expect(visibleTools.some((tool) => tool.name === "knowledge_query")).toBe(true);
		expect(visibleTools.some((tool) => tool.name === "service_guide_lookup")).toBe(false);
	});

	it("keeps knowledge_search internal to specialist agents", () => {
		const catalog = loadToolCatalog("../../configs/runtime/tools.v4.json");

		expect(
			buildVisibleToolDefinitions(catalog).some((tool) => tool.name === "knowledge_search"),
		).toBe(false);
		expect(
			buildInternalToolDefinitions(catalog).find((tool) => tool.name === "knowledge_search"),
		).toMatchObject({
			name: "knowledge_search",
			handler: {
				type: "execution_control_internal_query",
				endpoint: "/internal/query/knowledge/search",
			},
		});
	});

	it("exposes strict SDK parameter schemas with explicit required fields", () => {
		const catalog = loadToolCatalog("../../configs/runtime/tools.v4.json");

		for (const tool of buildVisibleToolDefinitions(catalog)) {
			expect(tool.parameterSchema).toMatchObject({
				type: "object",
				additionalProperties: false,
			});
			expect(Array.isArray(tool.parameterSchema.required)).toBe(true);
		}
	});

	it("uses the canonical tool function schema config for model-visible tools", () => {
		const catalog = loadToolCatalog("../../configs/runtime/tools.v4.json");
		const tools = buildVisibleToolDefinitions(catalog);

		const transport = tools.find((tool) => tool.name === "transport_schedule_lookup");

		expect(transport?.parameterSchema.required).toEqual([
			"query_text",
			"intent",
			"route_selector",
			"snapshot_query",
			"service_time_query",
			"result_limit",
		]);
		expect(transport?.parameterSchema.properties).toHaveProperty("route_selector");
		expect(transport?.parameterSchema.properties).not.toHaveProperty("route_query");

		const knowledge = tools.find((tool) => tool.name === "knowledge_query");
		expect(knowledge?.parameterSchema.required).toEqual(["query_text", "scope", "version_query"]);
		expect(knowledge?.parameterSchema.properties).toHaveProperty("scope");
		expect(knowledge?.parameterSchema.properties).toHaveProperty("version_query");

		const knowledgeSearch = buildInternalToolDefinitions(catalog).find(
			(tool) => tool.name === "knowledge_search",
		);
		expect(knowledgeSearch?.parameterSchema.required).toEqual(["query_text"]);
		expect(knowledgeSearch?.parameterSchema.properties).toEqual({
			query_text: expect.objectContaining({ type: "string" }),
		});
	});

	it("attests the actual registry, function schema, and workflow artifact files loaded at runtime", () => {
		const dir = mkdtempSync(join(tmpdir(), "agent-runtime-tool-attestation-"));
		const toolRegistryPath = join(dir, "tools.v4.json");
		const toolFunctionSchemaPath = join(dir, "tool-function-schemas.v1.json");
		const workflowArtifactRegistryPath = join(dir, "workflow-artifacts.v2.json");
		const toolRegistry = {
			schema_version: "tool-registry-v4",
			registry_version: "attestation-test",
			tools: [rawTransportScheduleTool()],
		};
		const functionSchemas = strictFunctionSchemaConfig("transport_schedule_lookup");
		const workflowArtifacts = {
			schema_version: "workflow-artifact-registry-v2",
			registry_version: "artifact-test",
			artifacts: [],
			forbidden_raw_key_tokens: [],
			support_status_values: [],
			visibility_values: [],
		};
		writeFileSync(toolRegistryPath, JSON.stringify(toolRegistry), "utf8");
		writeFileSync(toolFunctionSchemaPath, JSON.stringify(functionSchemas), "utf8");
		writeFileSync(workflowArtifactRegistryPath, JSON.stringify(workflowArtifacts), "utf8");

		const catalog = loadToolCatalog(toolRegistryPath, {
			toolFunctionSchemaPath,
			workflowArtifactRegistryPath,
		});
		const expectedCombined = sha256(
			JSON.stringify({
				function_schema_sha256: sha256CanonicalJson(functionSchemas),
				function_schema_version: "tool-function-schemas-v1",
				schema_version: "tool_runtime_fingerprint.v1",
				tools_registry_version: "attestation-test",
				tools_schema_version: "tool-registry-v4",
				tools_sha256: sha256CanonicalJson(toolRegistry),
				workflow_artifact_registry_version: "artifact-test",
				workflow_artifact_schema_version: "workflow-artifact-registry-v2",
				workflow_artifact_sha256: sha256CanonicalJson(workflowArtifacts),
			}),
		);

		expect(catalog.runtimeFingerprint).toEqual({
			combinedSha256: expectedCombined,
			functionSchemaSha256: sha256CanonicalJson(functionSchemas),
			functionSchemaVersion: "tool-function-schemas-v1",
			schemaVersion: "tool_runtime_fingerprint.v1",
			toolsRegistryVersion: "attestation-test",
			toolsSchemaVersion: "tool-registry-v4",
			toolsSha256: sha256CanonicalJson(toolRegistry),
			workflowArtifactRegistryVersion: "artifact-test",
			workflowArtifactSchemaVersion: "workflow-artifact-registry-v2",
			workflowArtifactSha256: sha256CanonicalJson(workflowArtifacts),
		});

		writeFileSync(
			workflowArtifactRegistryPath,
			JSON.stringify({ ...workflowArtifacts, registry_version: "artifact-test-2" }),
			"utf8",
		);
		const updatedCatalog = loadToolCatalog(toolRegistryPath, {
			toolFunctionSchemaPath,
			workflowArtifactRegistryPath,
		});

		expect(updatedCatalog.runtimeFingerprint.combinedSha256).not.toBe(expectedCombined);
	});

	it("hashes runtime artifacts using canonical JSON content rather than file formatting", () => {
		const dir = mkdtempSync(join(tmpdir(), "agent-runtime-tool-canonical-attestation-"));
		const prettyToolRegistryPath = join(dir, "tools.pretty.json");
		const compactToolRegistryPath = join(dir, "tools.compact.json");
		const toolFunctionSchemaPath = join(dir, "tool-function-schemas.v1.json");
		const workflowArtifactRegistryPath = join(dir, "workflow-artifacts.v2.json");
		const toolRegistry = {
			schema_version: "tool-registry-v4",
			registry_version: "attestation-test",
			tools: [rawTransportScheduleTool()],
		};
		const functionSchemas = strictFunctionSchemaConfig("transport_schedule_lookup");
		const workflowArtifacts = {
			schema_version: "workflow-artifact-registry-v2",
			registry_version: "artifact-test",
			artifacts: [],
			forbidden_raw_key_tokens: [],
			support_status_values: [],
			visibility_values: [],
		};
		writeFileSync(prettyToolRegistryPath, JSON.stringify(toolRegistry, null, 2), "utf8");
		writeFileSync(compactToolRegistryPath, JSON.stringify(toolRegistry), "utf8");
		writeFileSync(toolFunctionSchemaPath, JSON.stringify(functionSchemas, null, 2), "utf8");
		writeFileSync(workflowArtifactRegistryPath, JSON.stringify(workflowArtifacts, null, 2), "utf8");

		const prettyCatalog = loadToolCatalog(prettyToolRegistryPath, {
			toolFunctionSchemaPath,
			workflowArtifactRegistryPath,
		});
		const compactCatalog = loadToolCatalog(compactToolRegistryPath, {
			toolFunctionSchemaPath,
			workflowArtifactRegistryPath,
		});

		expect(prettyCatalog.runtimeFingerprint).toEqual(compactCatalog.runtimeFingerprint);
	});
});

function rawTransportScheduleTool() {
	return {
		name: "transport_schedule_lookup",
		description: "Lookup campus shuttle schedule snapshots.",
		exposure: "model_visible",
		read_only: true,
		requires_approval: false,
		payload_schema_ref: schemaRef(
			"campus-services-tool-contracts.v1",
			"TransportScheduleLookupPayload",
		),
		result_schema_ref: schemaRef(
			"campus-services-tool-contracts.v1",
			"TransportScheduleLookupResult",
		),
		handler: {
			type: "execution_control_internal_query",
			endpoint: "/internal/query/campus-services/transport-schedule",
		},
		timeout_ms: 1000,
		result_projection_policy: "bounded_json",
	};
}

function rawUnsupportedWorkflowSignalTool() {
	return {
		name: "knowledge_query",
		description: "Route this turn to the governed knowledge workflow.",
		exposure: "internal_only",
		read_only: true,
		requires_approval: false,
		payload_schema_ref: schemaRef("knowledge-tool-contracts.v1", "KnowledgeQueryPayload"),
		result_schema_ref: schemaRef("knowledge-tool-contracts.v1", "KnowledgeQueryPayload"),
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
	const path = join(dir, "tool-function-schemas.v1.json");
	writeFileSync(path, JSON.stringify(schema), "utf8");
	return path;
}

function strictFunctionSchemaConfig(...toolNames: string[]) {
	return {
		schema_version: "tool-function-schemas-v1",
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
		functionSchemaVersion: "tool-function-schemas-v1" as const,
		schemaVersion: "tool_runtime_fingerprint.v1" as const,
		toolsRegistryVersion: "test",
		toolsSchemaVersion: "tool-registry-v4" as const,
		toolsSha256: sha256("tool-registry"),
		workflowArtifactRegistryVersion: "test",
		workflowArtifactSchemaVersion: "workflow-artifact-registry-v2" as const,
		workflowArtifactSha256: sha256("workflow-artifacts"),
	};
}
