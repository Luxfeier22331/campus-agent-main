import { createHash } from "node:crypto";
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
	schema_version: z.literal("tool-registry-v4"),
	registry_version: z.string().min(1),
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
	schemaVersion: "tool-registry-v4";
	registryVersion: string;
	runtimeFingerprint: ToolRuntimeFingerprint;
	tools: ToolCatalogEntry[];
}

export interface ToolRuntimeFingerprint {
	combinedSha256: string;
	functionSchemaSha256: string;
	functionSchemaVersion: "tool-function-schemas-v1";
	schemaVersion: "tool_runtime_fingerprint.v1";
	toolsRegistryVersion: string;
	toolsSchemaVersion: "tool-registry-v4";
	toolsSha256: string;
	workflowArtifactRegistryVersion: string;
	workflowArtifactSchemaVersion: "workflow-artifact-registry-v2";
	workflowArtifactSha256: string;
}

export interface VisibleToolDefinition {
	name: string;
	description: string;
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

export function loadToolCatalog(
	path: string,
	options: { toolFunctionSchemaPath?: string; workflowArtifactRegistryPath?: string } = {},
): ToolCatalog {
	const rawToolCatalog = readFileSync(path, "utf8");
	const toolFunctionSchemaPath =
		options.toolFunctionSchemaPath ?? defaultToolFunctionSchemaPath(path);
	const workflowArtifactRegistryPath =
		options.workflowArtifactRegistryPath ?? defaultWorkflowArtifactRegistryPath(path);
	const toolFunctionSchemaRaw = readRequiredRuntimeArtifact(
		toolFunctionSchemaPath,
		"tool function schema config",
	);
	const workflowArtifactRegistryRaw = readRequiredRuntimeArtifact(
		workflowArtifactRegistryPath,
		"workflow artifact registry config",
	);
	const workflowArtifactRegistry = parseWorkflowArtifactRegistry(workflowArtifactRegistryRaw);
	return loadToolCatalogFromObject(JSON.parse(rawToolCatalog), {
		runtimeFingerprint: buildToolRuntimeFingerprint({
			toolCatalogRaw: rawToolCatalog,
			toolFunctionSchemaRaw,
			toolsRegistryVersion: registryVersionFromRawToolCatalog(rawToolCatalog),
			workflowArtifactRegistry,
			workflowArtifactRegistryRaw,
		}),
		toolFunctionSchemaPath,
	});
}

export function loadToolCatalogFromObject(
	value: unknown,
	options: { runtimeFingerprint?: ToolRuntimeFingerprint; toolFunctionSchemaPath?: string } = {},
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
		registryVersion: parsed.registry_version,
		runtimeFingerprint: requireToolRuntimeFingerprint(options.runtimeFingerprint),
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

function buildToolRuntimeFingerprint(input: {
	toolCatalogRaw: string;
	toolFunctionSchemaRaw: string;
	toolsRegistryVersion: string;
	workflowArtifactRegistry: WorkflowArtifactRegistryMetadata;
	workflowArtifactRegistryRaw: string;
}): ToolRuntimeFingerprint {
	const toolsSha256 = sha256CanonicalJson(input.toolCatalogRaw);
	const functionSchemaSha256 = sha256CanonicalJson(input.toolFunctionSchemaRaw);
	const workflowArtifactSha256 = sha256CanonicalJson(input.workflowArtifactRegistryRaw);
	return {
		combinedSha256: sha256(
			JSON.stringify({
				function_schema_sha256: functionSchemaSha256,
				function_schema_version: "tool-function-schemas-v1",
				schema_version: "tool_runtime_fingerprint.v1",
				tools_registry_version: input.toolsRegistryVersion,
				tools_schema_version: "tool-registry-v4",
				tools_sha256: toolsSha256,
				workflow_artifact_registry_version: input.workflowArtifactRegistry.registryVersion,
				workflow_artifact_schema_version: "workflow-artifact-registry-v2",
				workflow_artifact_sha256: workflowArtifactSha256,
			}),
		),
		functionSchemaSha256,
		functionSchemaVersion: "tool-function-schemas-v1",
		schemaVersion: "tool_runtime_fingerprint.v1",
		toolsRegistryVersion: input.toolsRegistryVersion,
		toolsSchemaVersion: "tool-registry-v4",
		toolsSha256,
		workflowArtifactRegistryVersion: input.workflowArtifactRegistry.registryVersion,
		workflowArtifactSchemaVersion: "workflow-artifact-registry-v2",
		workflowArtifactSha256,
	};
}

interface WorkflowArtifactRegistryMetadata {
	registryVersion: string;
	schemaVersion: "workflow-artifact-registry-v2";
}

function requireToolRuntimeFingerprint(
	fingerprint: ToolRuntimeFingerprint | undefined,
): ToolRuntimeFingerprint {
	if (fingerprint === undefined) {
		throw new Error("tool runtime fingerprint is required");
	}
	return fingerprint;
}

function parseWorkflowArtifactRegistry(raw: string): WorkflowArtifactRegistryMetadata {
	const parsed = JSON.parse(raw) as {
		registry_version?: unknown;
		schema_version?: unknown;
	};
	if (
		parsed.schema_version !== "workflow-artifact-registry-v2" ||
		typeof parsed.registry_version !== "string" ||
		parsed.registry_version.trim() === ""
	) {
		throw new Error("workflow artifact registry config must use workflow-artifact-registry-v2");
	}
	return {
		registryVersion: parsed.registry_version,
		schemaVersion: parsed.schema_version,
	};
}

function registryVersionFromRawToolCatalog(raw: string): string {
	return rawCatalogSchema.parse(JSON.parse(raw)).registry_version;
}

function readRequiredRuntimeArtifact(path: string | undefined, label: string): string {
	if (path === undefined) {
		throw new Error(`${label} path is required`);
	}
	if (!existsSync(path)) {
		throw new Error(`${label} not found: ${path}`);
	}
	return readFileSync(path, "utf8");
}

function sha256(value: string): string {
	return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function sha256CanonicalJson(raw: string): string {
	return sha256(stableJsonStringify(JSON.parse(raw)));
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

function defaultWorkflowArtifactRegistryPath(toolCatalogPath: string): string | undefined {
	for (let dir = dirname(toolCatalogPath); ; dir = dirname(dir)) {
		const candidate = join(dir, "configs", "runtime", "workflow-artifacts.v2.json");
		if (existsSync(candidate)) {
			return candidate;
		}
		const parent = dirname(dir);
		if (parent === dir) {
			return;
		}
	}
}
