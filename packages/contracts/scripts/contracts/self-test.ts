import { readFileSync } from "node:fs";
import { repoPath } from "./common.ts";
import { materializeAlertFile } from "./materialize-observability-alerts.ts";
import { checkContractSchemas } from "./schema-registry.ts";

export function runContractSchemaSelfTest(): void {
	checkContractSchemasPass();
	checkRegistryCoverage();
	checkStructuredToolContractFixtures();
	checkSafeObservabilityFixtures();
	checkRuntimeToolSchemaRefs();
	checkObservabilityAlertMaterialization();
	checkSafeObservabilitySchemas();
}

function checkContractSchemasPass(): void {
	checkContractSchemas();
}

function checkRegistryCoverage(): void {
	const entries = registryEntries();
	const expectedValidates: Record<string, string[]> = {
		"runtime-tools.v4": ["configs/runtime/tools.v4.json"],
		"execution-control-runtime-config.v1": [
			"configs/runtime/execution-control/runtime-config.local.json",
			"configs/runtime/execution-control/runtime-config.local-provider.json",
			"configs/runtime/execution-control/runtime-config.staging.json",
		],
		"query-serving-scopes.v2": ["configs/runtime/query-serving-scopes.v2.json"],
		"intent-policy.v1": ["configs/runtime/intent-policy.v1.json"],
		"intent-drift-thresholds.v1": ["configs/runtime/intent-drift-thresholds.v1.json"],
		"runtime-latency-budgets.v1": ["configs/runtime/latency-budgets.v1.json"],
		"env-surface-policy.v1": ["configs/runtime/env-surface-policy.v1.json"],
	};
	for (const [entryId, validates] of Object.entries(expectedValidates)) {
		expectEqualJson(entries[entryId]?.validates, validates, `${entryId} validates`);
	}
	for (const entryId of ["ingestion-task-envelope.v2", "ingestion-task-registry.v2"]) {
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
		["notice-tool-contracts.v1", "packages/contracts/fixtures/notice_tool_contracts"],
	]) {
		expectEqualJson(
			entries[entryId]?.fixture_groups,
			[{ path: fixturePath, valid_glob: "*.valid.json", invalid_glob: "*.invalid.json" }],
			`${entryId} fixture groups`,
		);
	}
}

function checkSafeObservabilityFixtures(): void {
	const entries = registryEntries();
	for (const entryId of [
		"llm-io-fingerprint.v1",
		"answer-eval-fingerprint.v1",
		"truncation-summary.v1",
		"sink-identity-projection.v1",
	]) {
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
	const config = readJson("configs/runtime/tools.v4.json");
	for (const tool of config.tools as Record<string, unknown>[]) {
		for (const fieldName of ["payload_schema_ref", "result_schema_ref"]) {
			const ref = String(tool[fieldName]);
			expect(
				!ref.includes("campus_contracts."),
				`${tool.name}.${fieldName} leaks Python contract name`,
			);
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

function checkSafeObservabilitySchemas(): void {
	const fingerprint = readJson("packages/contracts/schemas/llm-io-fingerprint.v1.schema.json");
	expectSuperset(new Set(fingerprint.required as string[]), [
		"llm_call_site",
		"prompt_registry_attestation",
		"primary_attestation",
		"tool_runtime_attestation",
		"provider_request_safe_hash",
		"model_params_projection",
	]);

	const answerEval = readJson("packages/contracts/schemas/answer-eval-fingerprint.v1.schema.json");
	expectSuperset(new Set(answerEval.required as string[]), [
		"answer_fingerprint_sha256",
		"branch_identity",
		"llm_io_fingerprint_sha256",
		"output_schema_id",
		"runtime_release",
		"stage_timing_profile_sha256",
		"terminal_outcome",
		"tool_runtime_combined_sha256",
	]);

	const truncation = readJson("packages/contracts/schemas/truncation-summary.v1.schema.json");
	expect(
		(truncation.required as string[]).includes("dropped_category_counts"),
		"truncation counts required",
	);
	const forbidden = readJson(
		"packages/contracts/fixtures/runtime_observability/truncation-summary.v1.raw_text.invalid.json",
	);
	expect("dropped_raw_messages" in forbidden, "truncation raw invalid fixture missing");

	const sinkIdentity = readJson(
		"packages/contracts/schemas/sink-identity-projection.v1.schema.json",
	);
	const properties = new Set(Object.keys(sinkIdentity.properties as Record<string, unknown>));
	expect(properties.has("subject_ref"), "sink identity subject_ref missing");
	expect(!properties.has("email"), "sink identity must not expose email");
	expect(!properties.has("user_id"), "sink identity must not expose user_id");
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

function expectSuperset(actual: Set<string>, expected: string[]): void {
	for (const item of expected) {
		expect(actual.has(item), `expected required field missing: ${item}`);
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
