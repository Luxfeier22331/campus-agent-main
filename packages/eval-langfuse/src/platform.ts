import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { sha256Bytes, sha256Text, slug } from "./identifiers";
import {
	type JsonObject,
	loadJsonObject,
	mapping,
	mappingList,
	optionalString,
	requireEqual,
	stringField,
	stringList,
} from "./json";
import { createLangfuseEvalClient } from "./langfuse-client";
import type { LangfuseSettings } from "./settings";

export function buildLangfuseDatasetItems(input: {
	dataset: JsonObject;
	assetHash: string;
	assetPath: string;
	sourceGitHead: string;
}): JsonObject[] {
	const payload = loadJsonObject(input.assetPath);
	const cases = Array.isArray(payload.cases)
		? mappingList(payload.cases, "cases")
		: mappingList(payload.items, "items");
	return cases.map((item) =>
		datasetItem({
			caseItem: item,
			dataset: input.dataset,
			expectedOutput: expectedPayload(input.dataset, item),
			assetHash: input.assetHash,
			assetPath: input.assetPath,
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
		...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
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
	requireEqual(manifest.schema_version, "langfuse_dataset_manifest.v2", "schema_version");
	const sourceGitHead = stringField(manifest.source_git_head, "source_git_head");
	const langfuse = createLangfuseEvalClient({
		...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
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
	if (dataset.kind === "rag_eval") {
		const question = stringField(item.question, "question");
		return {
			case_id: caseId,
			question,
			...(stringList(item.setup_turns).length > 0
				? { setup_turns: stringList(item.setup_turns) }
				: {}),
			surface_key: stringField(dataset.surface_key, "surface_key"),
			user_input: question,
		};
	}
	if (dataset.kind === "agent_tool_eval") {
		const query = stringField(item.query, "query");
		return {
			case_id: caseId,
			query,
			...(stringList(item.setup_turns).length > 0
				? { setup_turns: stringList(item.setup_turns) }
				: {}),
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
	if (dataset.kind === "rag_eval") {
		const referenceContextIds = stringList(item.reference_context_ids);
		const expectedOutcome = stringField(item.expected_outcome, "expected_outcome");
		const expectedDocumentScopes = stringList(item.expected_document_scopes);
		return {
			case_id: item.case_id,
			expected_outcome: expectedOutcome,
			expected_document_scopes: expectedDocumentScopes,
			forbidden_context_ids: stringList(item.forbidden_context_ids),
			metric_applicability: {
				answer_relevancy: expectedOutcome === "answer",
				context_precision: expectedOutcome === "answer" && referenceContextIds.length > 0,
				context_recall: expectedOutcome === "answer" && referenceContextIds.length > 0,
				faithfulness: expectedOutcome === "answer" && referenceContextIds.length > 0,
			},
			reference: stringField(item.reference, "reference"),
			reference_context_ids: referenceContextIds,
			reference_contexts: stringList(item.reference_contexts),
			split: optionalString(item.split),
		};
	}
	if (dataset.kind === "agent_tool_eval") {
		return {
			case_id: item.case_id,
			expected_outcome: stringField(item.expected_outcome, "expected_outcome"),
			forbidden_context_ids: stringList(item.forbidden_context_ids),
			reference: stringField(item.reference, "reference"),
			reference_context_ids: stringList(item.reference_context_ids),
			reference_contexts: stringList(item.reference_contexts),
			reference_tool_calls: mappingList(item.reference_tool_calls, "reference_tool_calls").map(
				(toolCall, index) => ({
					args: mapping(toolCall.args, `reference_tool_calls[${index}].args`),
					name: stringField(toolCall.name, `reference_tool_calls[${index}].name`),
				}),
			),
			split: optionalString(item.split),
		};
	}
	return { case_id: item.case_id, split: optionalString(item.split) };
}

function datasetItem(input: {
	caseItem: JsonObject;
	dataset: JsonObject;
	expectedOutput: JsonObject;
	assetHash: string;
	assetPath: string;
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
			argument_mode: optionalString(input.caseItem.argument_mode) ?? "name_only",
			case_id: caseId,
			case_family: optionalString(input.caseItem.case_family),
			dataset_slug: slugValue,
			asset_hash: input.assetHash,
			schema_version: "langfuse_dataset_manifest.v2",
			source_asset_path: input.assetPath,
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
	const rawAssetPath = stringField(input.dataset.asset_path, "asset_path");
	const assetPath = rawAssetPath.startsWith("/")
		? rawAssetPath
		: resolve(input.manifestPath, "..", rawAssetPath);
	const assetHash = sha256Bytes(readFileSync(assetPath));
	const desired = buildLangfuseDatasetItems({
		dataset: input.dataset,
		assetHash,
		assetPath,
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
		asset_hash: assetHash,
		asset_path: assetPath,
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
