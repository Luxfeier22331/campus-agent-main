import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { repoPath } from "./common.ts";
import { checkEnvContracts } from "./env-contracts.ts";
import { materializeAlertFile } from "./materialize-observability-alerts.ts";
import { checkContractSchemas } from "./schema-registry.ts";

export function runContractSchemaSelfTest(): void {
	checkContractSchemasPass();
	checkEnvContracts();
	checkEnvContractFailureFixtures();
	checkRegistryCoverage();
	checkStructuredToolContractFixtures();
	checkObservabilityFixtures();
	checkRuntimeToolSchemaRefs();
	checkObservabilityAlertMaterialization();
	checkObservabilitySchemas();
}

function checkContractSchemasPass(): void {
	checkContractSchemas();
}

function checkEnvContractFailureFixtures(): void {
	expectEnvContractFailure({
		label: "undeclared source key",
		contract: envFixtureContract({
			keys: [{ class: "config", name: "DECLARED_VALUE", required_by: [] }],
			source: { kind: "typescript", path: "consumer.ts" },
		}),
		expected: "uses undeclared environment name UNDECLARED_VALUE",
		files: { "consumer.ts": "process.env.UNDECLARED_VALUE;\n" },
	});
	expectEnvContractFailure({
		label: "Kubernetes secret classification",
		contract: envFixtureContract({
			keys: [{ class: "config", name: "CONFIG_VALUE", required_by: ["runtime"] }],
			source: { kind: "kubernetes", path: "workload.yaml" },
		}),
		expected: "delivers CONFIG_VALUE as secret, but fixture declares it as config",
		files: {
			"workload.yaml": `apiVersion: v1
kind: Pod
metadata:
  name: fixture
spec:
  containers:
    - name: fixture
      image: example.invalid/fixture
      env:
        - name: CONFIG_VALUE
          valueFrom:
            secretKeyRef:
              name: fixture
              key: CONFIG_VALUE
`,
		},
	});
	expectEnvContractFailure({
		label: "retired source key",
		contract: envFixtureContract({
			retiredNames: ["RETIRED_VALUE"],
			source: { kind: "typescript", path: "consumer.ts" },
		}),
		expected: "still consumes retired environment name RETIRED_VALUE",
		files: { "consumer.ts": "process.env.RETIRED_VALUE;\n" },
	});
	expectEnvContractFailure({
		label: "forbidden Hindsight value",
		contract: envFixtureContract({
			forbiddenValues: { HINDSIGHT_API_ENABLE_OBSERVATIONS: ["false"] },
			keys: [
				{
					class: "config",
					name: "HINDSIGHT_API_ENABLE_OBSERVATIONS",
					required_by: ["runtime"],
				},
			],
			source: { kind: "kubernetes", path: "configmap.yaml" },
		}),
		expected: 'assigns forbidden value "false" to HINDSIGHT_API_ENABLE_OBSERVATIONS',
		files: {
			"configmap.yaml": `apiVersion: v1
kind: ConfigMap
metadata:
  name: fixture
data:
  HINDSIGHT_API_ENABLE_OBSERVATIONS: "false"
`,
		},
	});
	expectEnvContractFailure({
		label: "non-retired rejection",
		contract: envFixtureContract({
			source: {
				kind: "typescript",
				path: "consumer.ts",
				rejects: ["ACTIVE_VALUE"],
			},
		}),
		expected: "rejects non-retired name ACTIVE_VALUE",
		files: { "consumer.ts": "process.env.ACTIVE_VALUE;\n" },
	});
}

function envFixtureContract(input: {
	forbiddenValues?: Record<string, string[]>;
	keys?: Array<{ class: "config" | "secret"; name: string; required_by: string[] }>;
	retiredNames?: string[];
	source: Record<string, unknown>;
}): Record<string, unknown> {
	return {
		consumers: [{ id: "runtime", sources: [input.source] }],
		forbidden_values: input.forbiddenValues,
		keys: input.keys ?? [],
		owner: "fixture",
		retired_names: input.retiredNames,
		schema_version: "campus_env_contract.v1",
	};
}

function expectEnvContractFailure(input: {
	contract: Record<string, unknown>;
	expected: string;
	files: Record<string, string>;
	label: string;
}): void {
	const root = mkdtempSync(join(tmpdir(), "campus-env-contract-"));
	try {
		writeFileSync(join(root, "env.contract.json"), JSON.stringify(input.contract), "utf8");
		for (const [relativePath, contents] of Object.entries(input.files)) {
			const path = join(root, relativePath);
			mkdirSync(dirname(path), { recursive: true });
			writeFileSync(path, contents, "utf8");
		}
		let failure = "";
		try {
			checkEnvContracts(root);
		} catch (error) {
			failure = error instanceof Error ? error.message : String(error);
		}
		expect(
			failure.includes(input.expected),
			`${input.label} mismatch: expected ${JSON.stringify(input.expected)}, received ${JSON.stringify(failure)}`,
		);
	} finally {
		rmSync(root, { force: true, recursive: true });
	}
}

function checkRegistryCoverage(): void {
	const entries = registryEntries();
	const expectedValidates: Record<string, string[]> = {
		"runtime-tools.v5": ["configs/runtime/tools.v5.json"],
		"execution-control-runtime-config.v1": [
			"configs/runtime/execution-control/runtime-config.local.json",
			"configs/runtime/execution-control/runtime-config.local-provider.json",
			"configs/runtime/execution-control/runtime-config.staging.json",
		],
		"query-serving-targets.v1": ["configs/runtime/query-serving-targets.v1.json"],
		"runtime-latency-budgets.v1": ["configs/runtime/latency-budgets.v1.json"],
	};
	for (const [entryId, validates] of Object.entries(expectedValidates)) {
		expectEqualJson(entries[entryId]?.validates, validates, `${entryId} validates`);
	}
	for (const entryId of [
		"ingestion-task-envelope.v3",
		"ingestion-task-registry.v3",
		"ingestion-task-result.v1",
	]) {
		const fixtureGroups = entries[entryId]?.fixture_groups;
		if (!Array.isArray(fixtureGroups)) {
			throw new Error(`${entryId} fixture groups missing`);
		}
		expect(fixtureGroups.length > 0, `${entryId} fixture groups empty`);
	}
}

function checkStructuredToolContractFixtures(): void {
	const entries = registryEntries();
	for (const [entryId, fixturePath] of [
		[
			"campus-services-tool-contracts.v1",
			"packages/contracts/fixtures/campus_services_tool_contracts",
		],
	]) {
		expectEqualJson(
			entries[entryId]?.fixture_groups,
			[{ path: fixturePath, valid_glob: "*.valid.json", invalid_glob: "*.invalid.json" }],
			`${entryId} fixture groups`,
		);
	}
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
	const config = readJson("configs/runtime/tools.v5.json");
	for (const tool of config.tools as Record<string, unknown>[]) {
		for (const fieldName of ["payload_schema_ref", "result_schema_ref"]) {
			const ref = String(tool[fieldName]);
			const [schemaId, fragment] = ref.split("#");
			expect(fragment !== undefined, `${tool.name}.${fieldName} must contain a JSON pointer`);
			expect(schemaId in schemaDocs, `${schemaId} missing from registered schemas`);
			expect(fragment.startsWith("/$defs/"), `${ref} must point at $defs`);
			const definitionName = fragment.replace("/$defs/", "");
			const defs = schemaDocs[schemaId]?.$defs;
			expect(isRecord(defs) && definitionName in defs, `${ref} target definition missing`);
		}
	}
}

function checkObservabilityAlertMaterialization(): void {
	const result = materializeAlertFile(repoPath("configs/runtime/observability-alerts.v1.json"));
	expectEqualJson(
		result.schema_version,
		"axiom-monitor-materialization-v1",
		"observability alert materialization schema",
	);
	expect(result.source_alert_version.length > 0, "observability alert source version missing");
	expect(result.monitors.length > 0, "observability alert monitor materialization empty");
	for (const monitor of result.monitors) {
		expect(typeof monitor.id === "string" && monitor.id.length > 0, "monitor id missing");
		expect(
			typeof monitor.query === "string" && monitor.query.includes("campus."),
			"monitor query missing campus metric",
		);
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
