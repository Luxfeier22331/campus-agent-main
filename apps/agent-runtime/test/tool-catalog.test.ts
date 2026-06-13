import { describe, expect, it } from "vitest";
import {
	buildVisibleToolDefinitions,
	loadToolCatalog,
	loadToolCatalogFromObject,
} from "../src/tool-catalog.ts";

describe("tool catalog", () => {
	it("exposes only model-visible read-only tools to the SDK surface", () => {
		const catalog = loadToolCatalogFromObject({
			schema_version: "tool-catalog.v1",
			catalog_version: "test",
			tools: [
				{
					name: "knowledge_query",
					capability: "knowledge",
					description: "Route this turn to the governed knowledge workflow.",
					exposure: "model_visible",
					read_only: true,
					requires_approval: false,
					payload_schema_ref: "manual.KnowledgeQuerySignalPayload",
					result_schema_ref: "manual.KnowledgeQuerySignalResult",
					handler: {
						type: "workflow_signal",
					},
					timeout_ms: 1000,
					result_projection_policy: "bounded_json",
				},
				{
					name: "transport_schedule_lookup",
					capability: "campus_services",
					description: "Lookup campus shuttle schedule snapshots.",
					exposure: "model_visible",
					read_only: true,
					requires_approval: false,
					payload_schema_ref: "manual.TransportScheduleLookupPayload",
					result_schema_ref: "manual.TransportScheduleLookupResult",
					handler: {
						type: "execution_control_internal_query",
						endpoint: "/internal/query/campus-services/transport-schedule",
					},
					timeout_ms: 1000,
					result_projection_policy: "bounded_json",
				},
				{
					name: "campus_notice_get",
					capability: "notice",
					description: "Internal selected notice resolution.",
					exposure: "internal_only",
					read_only: true,
					requires_approval: false,
					payload_schema_ref: "manual.CampusNoticeGetPayload",
					result_schema_ref: "manual.CampusNoticeGetResult",
					handler: {
						type: "execution_control_internal_query",
						endpoint: "/internal/query/notices/get",
					},
					timeout_ms: 1000,
					result_projection_policy: "bounded_json",
				},
			],
		});

		expect(buildVisibleToolDefinitions(catalog).map((tool) => tool.name)).toEqual([
			"knowledge_query",
			"transport_schedule_lookup",
		]);
	});

	it("rejects model-visible tools that are not read-only", () => {
		expect(() =>
			loadToolCatalogFromObject({
				schema_version: "tool-catalog.v1",
				catalog_version: "test",
				tools: [
					{
						name: "submit_ticket",
						capability: "campus_services",
						description: "Submit a ticket.",
						exposure: "model_visible",
						read_only: false,
						requires_approval: true,
						payload_schema_ref: "manual.SubmitTicketPayload",
						result_schema_ref: "manual.SubmitTicketResult",
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

	it("loads the checked-in catalog and exposes only model-facing tools", () => {
		const catalog = loadToolCatalog("../../configs/runtime/tool-catalog.v1.json");

		expect(buildVisibleToolDefinitions(catalog).map((tool) => tool.name)).toEqual([
			"knowledge_query",
			"service_status_lookup",
			"service_guide_lookup",
			"transport_schedule_lookup",
			"contact_directory_lookup",
			"academic_calendar_lookup",
			"campus_notice_change_set_lookup",
			"campus_notice_discover",
		]);
	});

	it("exposes strict SDK parameter schemas with explicit required fields", () => {
		const catalog = loadToolCatalog("../../configs/runtime/tool-catalog.v1.json");

		for (const tool of buildVisibleToolDefinitions(catalog)) {
			expect(tool.parameterSchema).toMatchObject({
				type: "object",
				additionalProperties: false,
			});
			expect(Array.isArray(tool.parameterSchema.required)).toBe(true);
		}
	});

	it("uses the canonical tool function schema fixture for model-visible tools", () => {
		const catalog = loadToolCatalog("../../configs/runtime/tool-catalog.v1.json");
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
