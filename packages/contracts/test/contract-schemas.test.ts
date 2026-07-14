import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isRecord, loadYaml, repoPath, stringArray } from "../scripts/contracts/common.ts";
import { checkContractSchemas } from "../scripts/contracts/schema-registry.ts";

const repoRoot = join(import.meta.dirname, "..", "..", "..");

function readJson(path: string): Record<string, unknown> {
	const value = JSON.parse(readFileSync(join(repoRoot, path), "utf8")) as unknown;
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error(`${path} must contain a JSON object`);
	}
	return value as Record<string, unknown>;
}

function readToolContractEnum(name: string): string[] {
	const contract = loadYaml(repoPath("docs/contracts/schemas/tool-execution.openapi.yaml"));
	if (!(isRecord(contract) && isRecord(contract.components))) {
		throw new Error("tool execution contract must define components");
	}
	const schemas = contract.components.schemas;
	if (!(isRecord(schemas) && isRecord(schemas[name]))) {
		throw new Error(`tool execution contract must define ${name}`);
	}
	return stringArray(schemas[name].enum, `tool execution contract ${name}.enum`);
}

describe("contract schema registry", () => {
	it("validates registered schemas, runtime artifacts and fixtures", () => {
		expect(() => checkContractSchemas()).not.toThrow();
	}, 60_000);

	it("keeps model-visible runtime tool schemas on registered JSON Schema refs", () => {
		const registry = readJson("packages/contracts/schemas/contract-schema-registry.v1.json");
		const registryEntries = (registry.entries as Record<string, unknown>[] | undefined) ?? [];
		expect(registryEntries.map((entry) => entry.id)).not.toContain("public-web-tool-contracts.v1");
		const schemaIds = new Set(
			registryEntries
				.map((entry) => entry.path)
				.filter((path): path is string => typeof path === "string" && path.endsWith(".schema.json"))
				.map((path) => readJson(path).$id)
				.filter((id): id is string => typeof id === "string"),
		);
		const tools = readJson("configs/runtime/tools.v4.json").tools as Record<string, unknown>[];

		for (const tool of tools) {
			for (const fieldName of ["payload_schema_ref", "result_schema_ref"]) {
				const ref = String(tool[fieldName]);
				const [schemaId, pointer] = ref.split("#");
				expect(schemaIds.has(schemaId), `${schemaId} must be registered`).toBe(true);
				expect(pointer, `${tool.name}.${fieldName} must target a $defs JSON pointer`).toMatch(
					/^\/\$defs\//u,
				);
			}
		}
	});

	it("keeps the runtime tool catalog aligned with model-visible schemas", () => {
		const tools = readJson("configs/runtime/tools.v4.json").tools as Record<string, unknown>[];
		const functionSchemas = readJson("configs/runtime/tool-function-schemas.v1.json")
			.tools as Record<string, unknown>[];
		const toolIds = readToolContractEnum("ToolID");
		const modelVisibleToolNames = readToolContractEnum("ModelVisibleToolName");
		const requestedTools = readToolContractEnum("RequestedTool");
		const catalogNames = tools.map((tool) => String(tool.name));
		const modelVisibleNames = tools
			.filter((tool) => tool.exposure === "model_visible")
			.map((tool) => String(tool.name))
			.sort();
		const requestableNames = tools
			.filter((tool) => tool.exposure === "model_visible")
			.map((tool) => String(tool.name));
		const functionSchemaNames = functionSchemas.map((tool) => String(tool.name)).sort();

		expect(toolIds).toEqual(expect.arrayContaining(catalogNames));
		expect(requestedTools).toEqual(expect.arrayContaining(requestableNames));
		expect(modelVisibleToolNames.sort()).toEqual(modelVisibleNames);
		expect(functionSchemaNames).toEqual(expect.arrayContaining(modelVisibleNames));
		expect(functionSchemaNames).toContain("knowledge_search");
		expect(modelVisibleNames).not.toContain("knowledge_search");
		expect(modelVisibleNames).not.toContain("public_web_search");
	});
});
