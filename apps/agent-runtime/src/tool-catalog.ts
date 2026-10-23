import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";

const schemaRefPattern =
	/^https:\/\/muc\.wiki\/campus-agent\/schemas\/[A-Za-z0-9.-]+\.schema\.json#\/\$defs\/[A-Za-z0-9_]+$/;
const exposureSchema = z.enum(["model_visible", "closed"]);
const agentControlInternalQueryEndpointSchema = z
	.string()
	.min(1)
	.refine(isCanonicalAgentControlInternalEndpoint, {
		message: "endpoint must be a canonical /internal/ path",
	});
const agentControlInternalQueryHandlerSchema = z.object({
	type: z.literal("agent_control_internal_query"),
	endpoint: agentControlInternalQueryEndpointSchema,
});
const rawToolSchema = z.object({
	name: z.string().min(1),
	description: z.string().min(1),
	exposure: exposureSchema,
	read_only: z.boolean(),
	requires_approval: z.boolean(),
	payload_schema_ref: z.string().regex(schemaRefPattern),
	result_schema_ref: z.string().regex(schemaRefPattern),
	handler: agentControlInternalQueryHandlerSchema,
	timeout_ms: z.number().int().positive(),
	result_projection_policy: z.literal("bounded_json"),
});
const rawCatalogSchema = z.object({
	schema_version: z.literal("tool-registry-v8"),
	registry_version: z.string().min(1),
	tools: z.array(rawToolSchema).min(1),
});

export type ToolExposure = z.infer<typeof exposureSchema>;

export interface AgentControlInternalQueryHandler {
	type: "agent_control_internal_query";
	endpoint: string;
}

export type ToolCatalogHandler = AgentControlInternalQueryHandler;

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
	schemaVersion: "tool-registry-v8";
	registryVersion: string;
	contractFingerprint: ToolContractFingerprint;
	tools: ToolCatalogEntry[];
}

export interface ToolContractFingerprint {
	functionSchemaSha256: string;
	schemaVersion: "tool_contract_fingerprint.v1";
	toolsSha256: string;
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

export function isCanonicalAgentControlInternalEndpoint(value: string): boolean {
	const endpoint = value.trim();
	if (
		endpoint !== value ||
		!endpoint.startsWith("/internal/") ||
		endpoint.includes("\\") ||
		endpoint.includes("%") ||
		endpoint.includes("?") ||
		endpoint.includes("#")
	) {
		return false;
	}
	try {
		const parsed = new URL(endpoint, "http://agent-control.invalid");
		return parsed.origin === "http://agent-control.invalid" && parsed.pathname === endpoint;
	} catch {
		return false;
	}
}

export function loadToolCatalog(
	path: string,
	options: { toolFunctionSchemaPath?: string } = {},
): ToolCatalog {
	const rawToolCatalog = readFileSync(path, "utf8");
	const toolFunctionSchemaPath =
		options.toolFunctionSchemaPath ?? defaultToolFunctionSchemaPath(path);
	const toolFunctionSchemaRaw = readRequiredRuntimeArtifact(
		toolFunctionSchemaPath,
		"tool function schema config",
	);
	return loadToolCatalogFromObject(JSON.parse(rawToolCatalog), {
		contractFingerprint: buildToolContractFingerprint({
			toolCatalogRaw: rawToolCatalog,
			toolFunctionSchemaRaw,
		}),
		...(toolFunctionSchemaPath ? { toolFunctionSchemaPath } : {}),
	});
}

export function loadToolCatalogFromObject(
	value: unknown,
	options: { contractFingerprint?: ToolContractFingerprint; toolFunctionSchemaPath?: string } = {},
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
		if (tool.exposure !== "closed" && parameterSchema === undefined) {
			throw new Error(`${tool.exposure} tool ${tool.name} missing strict function schema`);
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
			...(parameterSchema ? { parameterSchema } : {}),
		};
	});
	return {
		schemaVersion: parsed.schema_version,
		registryVersion: parsed.registry_version,
		contractFingerprint: requireToolContractFingerprint(options.contractFingerprint),
		tools,
	};
}

export function buildVisibleToolDefinitions(catalog: ToolCatalog): VisibleToolDefinition[] {
	return buildToolDefinitions(catalog, "model_visible");
}

function buildToolDefinitions(
	catalog: ToolCatalog,
	exposure: "model_visible",
): VisibleToolDefinition[] {
	return catalog.tools
		.filter((tool) => tool.exposure === exposure && tool.readOnly)
		.map((tool) => {
			if (tool.parameterSchema === undefined) {
				throw new Error(`${exposure} tool ${tool.name} missing strict function schema`);
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
	if (parsed.schema_version !== "tool-function-schemas-v4" || !Array.isArray(parsed.tools)) {
		throw new Error("tool function schema config must use tool-function-schemas-v4");
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

function buildToolContractFingerprint(input: {
	toolCatalogRaw: string;
	toolFunctionSchemaRaw: string;
}): ToolContractFingerprint {
	return {
		functionSchemaSha256: sha256CanonicalJson(input.toolFunctionSchemaRaw),
		schemaVersion: "tool_contract_fingerprint.v1",
		toolsSha256: sha256CanonicalJson(input.toolCatalogRaw),
	};
}

function requireToolContractFingerprint(
	fingerprint: ToolContractFingerprint | undefined,
): ToolContractFingerprint {
	if (fingerprint === undefined) {
		throw new Error("tool contract fingerprint is required");
	}
	return fingerprint;
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
			.map(([key, child]) => `${canonicalJSONString(key)}:${stableJsonStringify(child)}`)
			.join(",")}}`;
	}
	return typeof value === "string" ? canonicalJSONString(value) : JSON.stringify(value);
}

function canonicalJSONString(value: string): string {
	return JSON.stringify(value)
		.replaceAll("<", "\\u003c")
		.replaceAll(">", "\\u003e")
		.replaceAll("&", "\\u0026")
		.replaceAll("\u2028", "\\u2028")
		.replaceAll("\u2029", "\\u2029");
}

function defaultToolFunctionSchemaPath(toolCatalogPath: string): string | undefined {
	for (let dir = dirname(toolCatalogPath); ; dir = dirname(dir)) {
		const candidate = join(dir, "configs", "runtime", "tool-function-schemas.v4.json");
		if (existsSync(candidate)) {
			return candidate;
		}
		const parent = dirname(dir);
		if (parent === dir) {
			return;
		}
	}
}
