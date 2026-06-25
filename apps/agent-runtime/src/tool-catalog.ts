import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";

const schemaRefPattern =
	/^https:\/\/muc\.wiki\/campus-agent\/schemas\/[A-Za-z0-9.-]+\.schema\.json#\/\$defs\/[A-Za-z0-9_]+$/;
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
	payload_schema_ref: z.string().regex(schemaRefPattern),
	result_schema_ref: z.string().regex(schemaRefPattern),
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
	return loadToolCatalogFromObject(JSON.parse(readFileSync(path, "utf8")), {
		toolFunctionSchemaPath: defaultToolFunctionSchemaPath(path),
	});
}

export function loadToolCatalogFromObject(
	value: unknown,
	options: { toolFunctionSchemaPath?: string } = {},
): ToolCatalog {
	const parsed = rawCatalogSchema.parse(value);
	const seen = new Set<string>();
	for (const tool of parsed.tools) {
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
	}
	const functionSchemas = loadToolFunctionSchemas(options.toolFunctionSchemaPath);
	const tools = parsed.tools.map((tool): ToolCatalogEntry => {
		const parameterSchema = functionSchemas.get(tool.name);
		if (tool.exposure === "model_visible" && parameterSchema === undefined) {
			throw new Error(`model-visible tool ${tool.name} missing strict function schema`);
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
			parameterSchema,
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
		.map((tool) => {
			if (tool.parameterSchema === undefined) {
				throw new Error(`model-visible tool ${tool.name} missing strict function schema`);
			}
			return {
				name: tool.name,
				description: tool.description,
				capability: tool.capability,
				handler: tool.handler,
				parameterSchema: tool.parameterSchema,
				timeoutMs: tool.timeoutMs,
			};
		});
}

interface ToolFunctionSchemaFile {
	schema_version?: unknown;
	tools?: unknown;
}

function loadToolFunctionSchemas(path: string | undefined): Map<string, JsonObjectSchema> {
	if (path === undefined) {
		throw new Error("tool function schema path is required");
	}
	if (!existsSync(path)) {
		throw new Error(`tool function schema config not found: ${path}`);
	}
	const parsed = JSON.parse(readFileSync(path, "utf8")) as ToolFunctionSchemaFile;
	if (parsed.schema_version !== "tool-function-schemas-v1" || !Array.isArray(parsed.tools)) {
		throw new Error("tool function schema config must use tool-function-schemas-v1");
	}
	const result = new Map<string, JsonObjectSchema>();
	for (const rawTool of parsed.tools) {
		const tool = rawTool as {
			name?: unknown;
			parameters?: unknown;
			strict?: unknown;
			type?: unknown;
		};
		if (tool.type !== "function" || tool.strict !== true || typeof tool.name !== "string") {
			continue;
		}
		const parameters = tool.parameters as JsonObjectSchema;
		if (
			parameters?.type !== "object" ||
			parameters.additionalProperties !== false ||
			!Array.isArray(parameters.required) ||
			parameters.properties === undefined
		) {
			throw new Error(`tool ${tool.name} must provide a strict object parameter schema`);
		}
		result.set(tool.name, parameters);
	}
	return result;
}

function defaultToolFunctionSchemaPath(toolCatalogPath: string): string | undefined {
	for (let dir = dirname(toolCatalogPath); ; dir = dirname(dir)) {
		const candidate = join(dir, "configs", "runtime", "tool-function-schemas.v1.json");
		if (existsSync(candidate)) {
			return candidate;
		}
		const parent = dirname(dir);
		if (parent === dir) {
			return;
		}
	}
}
