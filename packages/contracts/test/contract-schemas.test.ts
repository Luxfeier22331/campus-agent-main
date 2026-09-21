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

	it("keeps registered runtime tool schemas on registered JSON Schema refs", () => {
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
		const tools = readJson("configs/runtime/tools.v7.json").tools as Record<string, unknown>[];

		for (const tool of tools) {
			for (const fieldName of ["payload_schema_ref", "result_schema_ref"]) {
				const ref = String(tool[fieldName]);
				const [schemaId, pointer] = ref.split("#");
				if (schemaId === undefined) {
					throw new Error(`${tool.name}.${fieldName} must contain a schema ID`);
				}
				expect(schemaIds.has(schemaId), `${schemaId} must be registered`).toBe(true);
				expect(pointer, `${tool.name}.${fieldName} must target a $defs JSON pointer`).toMatch(
					/^\/\$defs\//u,
				);
			}
		}
	});

	it("keeps registered tool artifacts aligned with current exposure", () => {
		const tools = readJson("configs/runtime/tools.v7.json").tools as Record<string, unknown>[];
		const functionSchemas = readJson("configs/runtime/tool-function-schemas.v4.json")
			.tools as Record<string, unknown>[];
		const toolIds = readToolContractEnum("ToolID");
		const modelVisibleFunctionToolNames = readToolContractEnum("ModelVisibleToolName");
		const catalogNames = tools.map((tool) => String(tool.name)).sort();
		const modelVisibleNames = tools
			.filter((tool) => tool.exposure === "model_visible")
			.map((tool) => String(tool.name))
			.sort();
		const functionSchemaNames = functionSchemas.map((tool) => String(tool.name)).sort();
		const expectedRegisteredTools = ["campus_search", "personal_memory_recall"];

		expect(catalogNames).toEqual(expectedRegisteredTools);
		expect(toolIds.sort()).toEqual(catalogNames);
		expect(modelVisibleNames).toEqual(["campus_search", "personal_memory_recall"]);
		expect(modelVisibleFunctionToolNames.sort()).toEqual(modelVisibleNames);
		expect(functionSchemaNames).toEqual(catalogNames);
	});

	it("defines campus search candidates and run-scoped citation indexes", () => {
		const schema = readJson(
			"packages/contracts/schemas/campus-search-tool-contracts.v4.schema.json",
		);
		const definitions = schema.$defs as Record<string, Record<string, unknown>>;
		const payload = definitions.CampusSearchPayload;
		const result = definitions.CampusSearchResult;
		const item = definitions.CampusSearchResultItem;
		const payloadProperties = payload?.properties as Record<string, Record<string, unknown>>;
		const resultProperties = result?.properties as Record<string, Record<string, unknown>>;
		const documentDefinition = definitions.CampusDocumentResultItem;
		const noticeDefinition = definitions.CampusNoticeResultItem;
		if (!(documentDefinition && noticeDefinition)) {
			throw new Error("campus search result item definitions are invalid");
		}
		if (!(isRecord(documentDefinition.properties) && isRecord(noticeDefinition.properties))) {
			throw new Error("campus search result item properties are invalid");
		}

		expect(payload?.required).toEqual(["search_query"]);
		expect(Object.keys(payloadProperties)).toEqual(["search_goal", "search_query"]);
		expect(payloadProperties.search_goal).toMatchObject({ type: "string", minLength: 1 });
		expect(result?.required).toEqual(["outcome", "results"]);
		expect(resultProperties.results).toMatchObject({ maxItems: 5 });
		expect(item?.oneOf).toHaveLength(2);
		expect(documentDefinition.required).toEqual(
			expect.arrayContaining(["citation_index", "result_ref", "source_kind"]),
		);
		expect(noticeDefinition.required).toEqual(
			expect.arrayContaining(["citation_index", "result_ref", "source_kind", "notice_id"]),
		);
		expect(noticeDefinition.properties.source_kind).toEqual({ const: "notice" });
		expect(documentDefinition.properties.source_kind).toEqual({ const: "document" });
	});
});
