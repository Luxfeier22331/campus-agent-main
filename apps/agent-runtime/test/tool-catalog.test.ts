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
				schema_version: "tool-registry-v4",
				registry_version: "test",
				tools: [
					{
						name: "knowledge_query",
						description: "Route this turn to the governed knowledge workflow.",
						exposure: "model_visible",
						read_only: true,
						requires_approval: false,
						payload_schema_ref: schemaRef(
							"knowledge-tool-contracts.v1",
							"KnowledgeQuerySignalPayload",
						),
						result_schema_ref: schemaRef(
							"knowledge-tool-contracts.v1",
							"KnowledgeQuerySignalResult",
						),
						handler: {
							type: "workflow_signal",
						},
						timeout_ms: 1000,
						result_projection_policy: "bounded_json",
					},
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
						name: "campus_notice_get",
						description: "Internal selected notice resolution.",
						exposure: "internal_only",
						read_only: true,
						requires_approval: false,
						payload_schema_ref: schemaRef("notice-tool-contracts.v1", "CampusNoticeGetPayload"),
						result_schema_ref: schemaRef("notice-tool-contracts.v1", "CampusNoticeGetResult"),
						handler: {
							type: "execution_control_internal_query",
							endpoint: "/internal/query/notices/get",
						},
						timeout_ms: 1000,
						result_projection_policy: "bounded_json",
					},
				],
			},
			{ toolFunctionSchemaPath: testSchemaPath("knowledge_query", "transport_schedule_lookup") },
		);

		expect(buildVisibleToolDefinitions(catalog).map((tool) => tool.name)).toEqual([
			"knowledge_query",
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
				tools: [rawKnowledgeQueryTool()],
			}),
		).toThrow("tool function schema path is required");
	});

	it("requires every model-visible tool to have a strict function schema", () => {
		expect(() =>
			loadToolCatalogFromObject(
				{
					schema_version: "tool-registry-v4",
					registry_version: "test",
					tools: [rawKnowledgeQueryTool()],
				},
				{ toolFunctionSchemaPath: testSchemaPath("transport_schedule_lookup") },
			),
		).toThrow("model-visible tool knowledge_query missing strict function schema");
	});

	it("loads the checked-in catalog and exposes only model-facing tools", () => {
		const catalog = loadToolCatalog("../../configs/runtime/tools.v4.json");

		expect(buildVisibleToolDefinitions(catalog).map((tool) => tool.name)).toEqual([
			"knowledge_query",
			"transport_schedule_lookup",
			"campus_notice_discover",
		]);
	});

	it("keeps institutional account questions on the knowledge tool contract", () => {
		const catalog = loadToolCatalog("../../configs/runtime/tools.v4.json");
		const tools = buildVisibleToolDefinitions(catalog);

		const knowledge = tools.find((tool) => tool.name === "knowledge_query");

		expect(knowledge?.description).toContain("account/network/auth/portal");
		expect(tools.some((tool) => tool.name === "service_guide_lookup")).toBe(false);
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
	});
});

function rawKnowledgeQueryTool() {
	return {
		name: "knowledge_query",
		description: "Route this turn to the governed knowledge workflow.",
		exposure: "model_visible",
		read_only: true,
		requires_approval: false,
		payload_schema_ref: schemaRef("knowledge-tool-contracts.v1", "KnowledgeQuerySignalPayload"),
		result_schema_ref: schemaRef("knowledge-tool-contracts.v1", "KnowledgeQuerySignalResult"),
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
	const schema = {
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
	const path = join(dir, "tool-function-schemas.v1.json");
	writeFileSync(path, JSON.stringify(schema), "utf8");
	return path;
}
