import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { createLangfuseEvalClient } from "./langfuse-client";
import {
	type JsonObject,
	type LangfuseSettings,
	loadJsonObject,
	mappingList,
	optionalString,
	requireEqual,
	sha256Bytes,
	sha256Text,
	slug,
	stringField,
	stringList,
} from "./shared";

export function buildLangfuseDatasetItems(input: {
	dataset: JsonObject;
	fixtureHash: string;
	fixturePath: string;
	sourceGitHead: string;
}): JsonObject[] {
	const payload = loadJsonObject(input.fixturePath);
	const cases = Array.isArray(payload.cases)
		? mappingList(payload.cases, "cases")
		: mappingList(payload.items, "items");
	return cases.map((item) =>
		datasetItem({
			caseItem: item,
			dataset: input.dataset,
			expectedOutput: expectedPayload(input.dataset, item),
			fixtureHash: input.fixtureHash,
			fixturePath: input.fixturePath,
			inputPayload: inputPayload(input.dataset, item),
			sourceGitHead: input.sourceGitHead,
		}),
	);
}

export async function syncLangfuseScoreConfigs(input: {
	dryRun: boolean;
	fetchImpl?: typeof fetch;
	registryPath: string;
	settings: LangfuseSettings;
}): Promise<JsonObject> {
	const registry = loadJsonObject(input.registryPath);
	const scores = mappingList(registry.scores, "registry.scores");
	const langfuse = createLangfuseEvalClient({
		fetchImpl: input.fetchImpl,
		settings: input.settings,
	});
	const existing = new Set(
		(await langfuse.listScoreConfigs()).map((item) => stringField(item.name, "score_config.name")),
	);
	const planned = scores.filter((score) => !existing.has(stringField(score.name, "score.name")));
	if (!input.dryRun) {
		for (const score of planned) {
			await langfuse.createScoreConfig(scoreConfigPayload(score));
		}
	}
	return {
		created: input.dryRun ? 0 : planned.length,
		dry_run: input.dryRun,
		existing: existing.size,
		expected: scores.length,
		failed: 0,
		planned_create: input.dryRun ? planned.length : 0,
		planned_score_names: planned.map((score) => stringField(score.name, "score.name")),
		schema_version: "langfuse_score_config_sync_report.v1",
	};
}

export async function syncLangfuseDatasets(input: {
	dryRun: boolean;
	fetchImpl?: typeof fetch;
	manifestPath: string;
	settings: LangfuseSettings;
}): Promise<JsonObject> {
	const manifest = loadJsonObject(input.manifestPath);
	requireEqual(manifest.schema_version, "langfuse_dataset_manifest.v1", "schema_version");
	const sourceGitHead = stringField(manifest.source_git_head, "source_git_head");
	const langfuse = createLangfuseEvalClient({
		fetchImpl: input.fetchImpl,
		settings: input.settings,
	});
	const existingNames = new Set(
		(await langfuse.listDatasets()).map((item) => stringField(item.name, "dataset.name")),
	);
	const reports: JsonObject[] = [];
	for (const dataset of mappingList(manifest.datasets, "datasets")) {
		reports.push(
			await syncOneDataset({
				dataset,
				dryRun: input.dryRun,
				existingNames,
				langfuse,
				manifestPath: input.manifestPath,
				sourceGitHead,
			}),
		);
	}
	return {
		datasets: reports,
		dry_run: input.dryRun,
		manifest_path: input.manifestPath,
		schema_version: "langfuse_dataset_sync_report.v1",
	};
}

function inputPayload(dataset: JsonObject, item: JsonObject): JsonObject {
	const caseId = stringField(item.case_id, "case_id");
	if (dataset.kind === "answer_quality") {
		return {
			case_id: caseId,
			surface_key: stringField(dataset.surface_key, "surface_key"),
		};
	}
	if (dataset.kind === "rag_qrels") {
		const query = stringField(item.query, "query");
		return {
			case_id: caseId,
			question: query,
			surface_key: stringField(dataset.surface_key, "surface_key"),
			user_input: query,
		};
	}
	return {
		case_id: caseId,
		query_sha256: sha256Text(stringField(item.query, "query")),
		surface_key: stringField(dataset.surface_key, "surface_key"),
	};
}

function expectedPayload(dataset: JsonObject, item: JsonObject): JsonObject {
	if (dataset.kind === "answer_quality") {
		return {
			forbidden_claims: stringList(item.forbidden_claims),
			required_facts: stringList(item.required_facts),
			split: optionalString(item.split),
		};
	}
	if (dataset.kind === "rag_qrels") {
		const referenceContextIds = sourceDocIds(item.expected_sources, "expected_sources");
		const forbiddenContextIds = sourceDocIds(item.forbidden_sources, "forbidden_sources");
		return {
			case_id: item.case_id,
			forbidden_context_ids: forbiddenContextIds,
			metric_applicability: {
				context_recall: referenceContextIds.length > 0,
				id_context_precision: referenceContextIds.length > 0,
				id_context_recall: referenceContextIds.length > 0,
			},
			reference_context_ids: referenceContextIds,
			split: optionalString(item.split),
		};
	}
	return { case_id: item.case_id, split: optionalString(item.split) };
}

function sourceDocIds(value: unknown, field: string): string[] {
	return mappingList(value ?? [], field)
		.map((source) => optionalString(source.doc_id))
		.filter((docId): docId is string => Boolean(docId));
}

function datasetItem(input: {
	caseItem: JsonObject;
	dataset: JsonObject;
	expectedOutput: JsonObject;
	fixtureHash: string;
	fixturePath: string;
	inputPayload: JsonObject;
	sourceGitHead: string;
}): JsonObject {
	const slugValue = stringField(input.dataset.slug, "slug");
	const caseId = stringField(input.caseItem.case_id, "case_id");
	return {
		datasetName: stringField(input.dataset.name, "name"),
		expectedOutput: input.expectedOutput,
		id: `campus-${slug(slugValue)}-${sha256Text(caseId).slice(0, 16)}`,
		input: input.inputPayload,
		metadata: {
			case_id: caseId,
			dataset_slug: slugValue,
			fixture_hash: input.fixtureHash,
			schema_version: "langfuse_dataset_manifest.v1",
			source_fixture_path: input.fixturePath,
			source_git_head: input.sourceGitHead,
			surface_key: stringField(input.dataset.surface_key, "surface_key"),
		},
		status: "ACTIVE",
	};
}

async function syncOneDataset(input: {
	dataset: JsonObject;
	dryRun: boolean;
	existingNames: Set<string>;
	langfuse: ReturnType<typeof createLangfuseEvalClient>;
	manifestPath: string;
	sourceGitHead: string;
}): Promise<JsonObject> {
	const name = stringField(input.dataset.name, "datasets[].name");
	const rawFixturePath = stringField(input.dataset.fixture_path, "fixture_path");
	const fixturePath = rawFixturePath.startsWith("/")
		? rawFixturePath
		: resolve(input.manifestPath, "..", rawFixturePath);
	const fixtureHash = sha256Bytes(readFileSync(fixturePath));
	const desired = buildLangfuseDatasetItems({
		dataset: input.dataset,
		fixtureHash,
		fixturePath,
		sourceGitHead: input.sourceGitHead,
	});
	if (!(input.dryRun || input.existingNames.has(name))) {
		await input.langfuse.createDataset({ name });
	}
	if (!input.dryRun) {
		for (const item of desired) {
			await input.langfuse.createDatasetItem(item);
		}
	}
	return {
		created: input.dryRun ? 0 : desired.length,
		desired_items: desired,
		dry_run: input.dryRun,
		fixture_hash: fixtureHash,
		fixture_path: fixturePath,
		name,
		planned_create: input.dryRun ? desired.length : 0,
	};
}

function scoreConfigPayload(score: JsonObject): JsonObject {
	const dataType = stringField(score.data_type, "data_type");
	const payload: JsonObject = {
		dataType,
		description: optionalString(score.description),
		name: stringField(score.name, "name"),
	};
	const valueRange = Array.isArray(score.value_range) ? score.value_range : [];
	if (dataType === "NUMERIC" && valueRange.length === 2) {
		payload.minValue = valueRange[0];
		payload.maxValue = valueRange[1];
	}
	return payload;
}
