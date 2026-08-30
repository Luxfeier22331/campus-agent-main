import { readFileSync } from "node:fs";
import { listFilesMatching, relativePath, repoPath } from "./common.ts";
import { checkContractSchemas } from "./schema-registry.ts";

export function runContractSchemaSelfTest(): void {
	checkContractSchemasPass();
	checkRegistryCoverage();
	checkObservabilityFixtures();
	checkRuntimeToolSchemaRefs();
	checkObservabilitySchemas();
}

function checkContractSchemasPass(): void {
	checkContractSchemas();
}

function checkRegistryCoverage(): void {
	const entries = registryEntries();
	const expectedValidates: Record<string, string[]> = {
		"internal-portal-descriptor.v1": ["configs/sources/internal-portal.json"],
		"runtime-tools.v7": ["configs/runtime/tools.v7.json"],
		"runtime-latency-budgets.v1": ["configs/runtime/latency-budgets.v1.json"],
	};
	for (const [entryId, validates] of Object.entries(expectedValidates)) {
		expectEqualJson(entries[entryId]?.validates, validates, `${entryId} validates`);
	}
	const runtimeConfigPaths = listFilesMatching(repoPath("configs/runtime"), "*.json").map(
		relativePath,
	);
	const sourceConfigPaths = listFilesMatching(repoPath("configs/sources"), "*.json").map(
		relativePath,
	);
	const registeredConfigPaths = Object.values(entries).flatMap((entry) =>
		Array.isArray(entry.validates)
			? entry.validates.filter((value): value is string => typeof value === "string")
			: [],
	);
	expectEqualJson(
		registeredConfigPaths.filter((path) => path.startsWith("configs/runtime/")).sort(),
		runtimeConfigPaths.sort(),
		"runtime config registry coverage",
	);
	expectEqualJson(
		registeredConfigPaths.filter((path) => path.startsWith("configs/sources/")).sort(),
		sourceConfigPaths.sort(),
		"source config registry coverage",
	);
}

function checkObservabilityFixtures(): void {
	const entries = registryEntries();
	const entryId = "truncation-summary.v2";
	expectEqualJson(
		entries[entryId]?.fixture_groups,
		[
			{
				path: "packages/contracts/fixtures/runtime_observability",
				valid_glob: `${entryId}.*.valid.json`,
				invalid_glob: `${entryId}.*.invalid.json`,
			},
		],
		`${entryId} fixture groups`,
	);
}

function checkRuntimeToolSchemaRefs(): void {
	const registry = readJson("packages/contracts/schemas/contract-schema-registry.v1.json");
	const schemaDocs: Record<string, Record<string, unknown>> = {};
	for (const entry of registry.entries as Record<string, unknown>[]) {
		if (entry.kind !== "json_artifact") {
			continue;
		}
		const schema = readJson(String(entry.path));
		schemaDocs[String(schema.$id)] = schema;
	}
	const config = readJson("configs/runtime/tools.v7.json");
	for (const tool of config.tools as Record<string, unknown>[]) {
		for (const fieldName of ["payload_schema_ref", "result_schema_ref"]) {
			const ref = String(tool[fieldName]);
			const [schemaId, fragment] = ref.split("#");
			if (schemaId === undefined || fragment === undefined) {
				throw new Error(`${tool.name}.${fieldName} must contain a JSON pointer`);
			}
			expect(schemaId in schemaDocs, `${schemaId} missing from registered schemas`);
			expect(fragment.startsWith("/$defs/"), `${ref} must point at $defs`);
			const definitionName = fragment.replace("/$defs/", "");
			const defs = schemaDocs[schemaId]?.$defs;
			expect(isRecord(defs) && definitionName in defs, `${ref} target definition missing`);
		}
	}
}

function checkObservabilitySchemas(): void {
	const truncation = readJson("packages/contracts/schemas/truncation-summary.v2.schema.json");
	expect(
		(truncation.required as string[]).includes("dropped_category_counts"),
		"truncation counts required",
	);
	const forbidden = readJson(
		"packages/contracts/fixtures/runtime_observability/truncation-summary.v2.raw_text.invalid.json",
	);
	expect("dropped_raw_messages" in forbidden, "truncation raw invalid fixture missing");
}

function registryEntries(): Record<string, Record<string, unknown>> {
	const registry = readJson("packages/contracts/schemas/contract-schema-registry.v1.json");
	return Object.fromEntries(
		(registry.entries as Record<string, unknown>[]).map((entry) => [String(entry.id), entry]),
	);
}

function readJson(path: string): Record<string, unknown> {
	const value = JSON.parse(readFileSync(repoPath(path), "utf8")) as unknown;
	if (!isRecord(value)) {
		throw new Error(`${path} must contain a JSON object`);
	}
	return value;
}

function expect(condition: boolean, message: string): void {
	if (!condition) {
		throw new Error(message);
	}
}

function expectEqualJson(actual: unknown, expected: unknown, label: string): void {
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		throw new Error(`${label} mismatch: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
