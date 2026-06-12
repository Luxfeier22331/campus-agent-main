import { readFileSync } from "node:fs";
import { z } from "zod";

const exposureSchema = z.enum(["model_visible", "internal_only", "closed"]);
const executionControlInternalQueryHandlerSchema = z.object({
	type: z.literal("execution_control_internal_query"),
	endpoint: z.string().min(1),
});
const workflowSignalHandlerSchema = z.object({
	type: z.literal("workflow_signal"),
});
const handlerSchema = z.discriminatedUnion("type", [
	executionControlInternalQueryHandlerSchema,
	workflowSignalHandlerSchema,
]);
const rawToolSchema = z.object({
	name: z.string().min(1),
	capability: z.string().min(1),
	description: z.string().min(1),
	exposure: exposureSchema,
	read_only: z.boolean(),
	requires_approval: z.boolean(),
	payload_schema_ref: z.string().min(1),
	result_schema_ref: z.string().min(1),
	handler: handlerSchema,
	timeout_ms: z.number().int().positive(),
	result_projection_policy: z.literal("bounded_json"),
});
const rawCatalogSchema = z.object({
	schema_version: z.literal("tool-catalog.v1"),
	catalog_version: z.string().min(1),
	tools: z.array(rawToolSchema).min(1),
});

export type ToolExposure = z.infer<typeof exposureSchema>;

export interface ExecutionControlInternalQueryHandler {
	type: "execution_control_internal_query";
	endpoint: string;
}

export interface WorkflowSignalHandler {
	type: "workflow_signal";
}

export type ToolCatalogHandler = ExecutionControlInternalQueryHandler | WorkflowSignalHandler;

export interface ToolCatalogEntry {
	name: string;
	capability: string;
	description: string;
	exposure: ToolExposure;
	readOnly: boolean;
	requiresApproval: boolean;
	payloadSchemaRef: string;
	resultSchemaRef: string;
	handler: ToolCatalogHandler;
	timeoutMs: number;
	resultProjectionPolicy: "bounded_json";
	parameterSchema?: JsonObjectSchema;
}

export interface ToolCatalog {
	schemaVersion: "tool-catalog.v1";
	catalogVersion: string;
	tools: ToolCatalogEntry[];
}

export interface VisibleToolDefinition {
	name: string;
	description: string;
	capability: string;
	handler: ToolCatalogHandler;
	parameterSchema: JsonObjectSchema;
	timeoutMs: number;
}

export interface JsonObjectSchema {
	type: "object";
	additionalProperties: false;
	properties: Record<string, unknown>;
	required: string[];
}

export function loadToolCatalog(path: string): ToolCatalog {
	return loadToolCatalogFromObject(JSON.parse(readFileSync(path, "utf8")));
}

export function loadToolCatalogFromObject(value: unknown): ToolCatalog {
	const parsed = rawCatalogSchema.parse(value);
	const seen = new Set<string>();
	const tools = parsed.tools.map((tool): ToolCatalogEntry => {
		if (seen.has(tool.name)) {
			throw new Error(`duplicate tool name: ${tool.name}`);
		}
		seen.add(tool.name);
		if (tool.exposure === "model_visible" && !tool.read_only) {
			throw new Error(`model-visible tool ${tool.name} must be read-only`);
		}
		if (tool.exposure === "closed" && tool.requires_approval) {
			throw new Error(`closed tool ${tool.name} must not require approval`);
		}
		return {
			name: tool.name,
			capability: tool.capability,
			description: tool.description,
			exposure: tool.exposure,
			readOnly: tool.read_only,
			requiresApproval: tool.requires_approval,
			payloadSchemaRef: tool.payload_schema_ref,
			resultSchemaRef: tool.result_schema_ref,
			handler: tool.handler,
			timeoutMs: tool.timeout_ms,
			resultProjectionPolicy: tool.result_projection_policy,
			parameterSchema: parameterSchemaForTool(tool.name),
		};
	});
	return {
		schemaVersion: parsed.schema_version,
		catalogVersion: parsed.catalog_version,
		tools,
	};
}

export function buildVisibleToolDefinitions(catalog: ToolCatalog): VisibleToolDefinition[] {
	return catalog.tools
		.filter((tool) => tool.exposure === "model_visible" && tool.readOnly)
		.map((tool) => ({
			name: tool.name,
			description: tool.description,
			capability: tool.capability,
			handler: tool.handler,
			parameterSchema: tool.parameterSchema ?? parameterSchemaForTool(tool.name),
			timeoutMs: tool.timeoutMs,
		}));
}

const nonEmptyStringSchema = { type: "string", minLength: 1 };
const stringArraySchema = {
	type: "array",
	items: nonEmptyStringSchema,
};

function parameterSchemaForTool(toolName: string): JsonObjectSchema {
	switch (toolName) {
		case "knowledge_query":
			return strictObjectSchema(
				{
					query_text: nonEmptyStringSchema,
					intent: {
						type: "string",
						enum: ["answer_question", "compare_rules", "clarify_scope"],
					},
				},
				["query_text"],
			);
		case "service_status_lookup":
			return strictObjectSchema(
				{
					subject_query: nonEmptyStringSchema,
					service_family: nonEmptyStringSchema,
					effective_at: nonEmptyStringSchema,
				},
				["subject_query"],
			);
		case "service_guide_lookup":
			return strictObjectSchema(
				{
					query_text: nonEmptyStringSchema,
					service_id: nonEmptyStringSchema,
					focus: {
						type: "string",
						enum: ["entry", "procedure", "materials", "contact", "eligibility"],
					},
				},
				["query_text"],
			);
		case "transport_schedule_lookup":
			return strictObjectSchema(
				{
					query_text: nonEmptyStringSchema,
					route_query: nonEmptyStringSchema,
					service_date: nonEmptyStringSchema,
					intent: {
						type: "string",
						enum: ["next_departure", "service_window", "route_status"],
					},
				},
				["query_text"],
			);
		case "contact_directory_lookup":
			return strictObjectSchema(
				{
					query_text: nonEmptyStringSchema,
					entity_query: nonEmptyStringSchema,
					department_query: nonEmptyStringSchema,
				},
				["query_text"],
			);
		case "academic_calendar_lookup":
			return strictObjectSchema(
				{
					query_text: nonEmptyStringSchema,
					date: nonEmptyStringSchema,
					term: nonEmptyStringSchema,
					intent: {
						type: "string",
						enum: ["teaching_week", "holiday", "makeup_class", "term_window", "named_event"],
					},
				},
				["query_text"],
			);
		case "campus_notice_change_set_lookup":
			return strictObjectSchema(
				{
					topic_query: nonEmptyStringSchema,
					service_family: nonEmptyStringSchema,
					target_surfaces: stringArraySchema,
				},
				["topic_query"],
			);
		case "campus_notice_discover":
			return strictObjectSchema(
				{
					query_text: nonEmptyStringSchema,
					topic_query: nonEmptyStringSchema,
					target_surfaces: stringArraySchema,
					limit: { type: "integer", minimum: 1, maximum: 10 },
				},
				["query_text"],
			);
		default:
			return strictObjectSchema({});
	}
}

function strictObjectSchema(
	properties: Record<string, unknown>,
	required: string[] = [],
): JsonObjectSchema {
	return {
		type: "object",
		additionalProperties: false,
		properties,
		required,
	};
}
