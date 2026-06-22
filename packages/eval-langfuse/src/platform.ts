import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { scoreItemToLangfusePayload, validateLangfuseScoreReport } from "./score-report";
import {
	type JsonObject,
	type LangfuseSettings,
	listPaginated,
	loadJsonObject,
	mapping,
	mappingList,
	optionalString,
	requestJson,
	requireEqual,
	sha256Bytes,
	sha256Json,
	sha256Text,
	slug,
	stableId,
	stringField,
	stringList,
	writeJsonObject,
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
	const existing = new Set(
		(
			await listPaginated({
				fetchImpl: input.fetchImpl,
				path: "/api/public/score-configs",
				settings: input.settings,
			})
		).map((item) => stringField(item.name, "score_config.name")),
	);
	const planned = scores.filter((score) => !existing.has(stringField(score.name, "score.name")));
	if (!input.dryRun) {
		for (const score of planned) {
			await requestJson({
				body: scoreConfigPayload(score),
				fetchImpl: input.fetchImpl,
				method: "POST",
				path: "/api/public/score-configs",
				settings: input.settings,
			});
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
	const existingNames = new Set(
		(
			await listPaginated({
				fetchImpl: input.fetchImpl,
				path: "/api/public/v2/datasets",
				settings: input.settings,
			})
		).map((item) => stringField(item.name, "dataset.name")),
	);
	const reports: JsonObject[] = [];
	for (const dataset of mappingList(manifest.datasets, "datasets")) {
		reports.push(
			await syncOneDataset({
				dataset,
				dryRun: input.dryRun,
				existingNames,
				fetchImpl: input.fetchImpl,
				manifestPath: input.manifestPath,
				settings: input.settings,
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

export async function runLangfuseExperiment(input: {
	fetchImpl?: typeof fetch;
	manifestPath: string;
	settings: LangfuseSettings;
}): Promise<JsonObject> {
	const manifest = loadJsonObject(input.manifestPath);
	requireEqual(manifest.schema_version, "langfuse_experiment_manifest.v1", "schema_version");
	const itemResults: JsonObject[] = [];
	let datasetRunId = optionalString(manifest.dataset_run_id);
	for (const item of mappingList(manifest.item_results, "item_results")) {
		const result = { ...item };
		if (manifest.dataset_source === "langfuse") {
			const response = await requestJson({
				body: {
					datasetItemId: stringField(item.dataset_item_id, "item.dataset_item_id"),
					datasetVersion: optionalString(manifest.dataset_version),
					observationId: optionalString(item.observation_id),
					runDescription: optionalString(manifest.run_description),
					runName: stringField(manifest.run_name, "run_name"),
					traceId: stringField(item.trace_id, "item.trace_id"),
				},
				fetchImpl: input.fetchImpl,
				method: "POST",
				path: "/api/public/dataset-run-items",
				settings: input.settings,
			});
			datasetRunId = stringField(response.datasetRunId, "datasetRunId");
			result.dataset_run_item_id = stringField(response.id, "id");
		}
		itemResults.push(result);
	}
	const artifact = experimentArtifact(manifest, itemResults, datasetRunId);
	writeJsonObject(stringField(manifest.artifact_path, "artifact_path"), artifact);
	const scoreReport = scoreReportFromExperimentManifest(manifest, artifact, datasetRunId);
	writeJsonObject(stringField(manifest.score_report_path, "score_report_path"), scoreReport);
	return {
		...artifact,
		artifact_path: manifest.artifact_path,
		score_report_path: manifest.score_report_path,
	};
}

export async function syncLangfuseAnnotationQueue(input: {
	dryRun: boolean;
	fetchImpl?: typeof fetch;
	manifestPath: string;
	settings: LangfuseSettings;
}): Promise<JsonObject> {
	const manifest = loadJsonObject(input.manifestPath);
	requireEqual(manifest.schema_version, "langfuse_review_manifest.v1", "schema_version");
	const queueId = stringField(manifest.queue_id, "queue_id");
	let enqueued = 0;
	let prefilled = 0;
	for (const item of mappingList(manifest.items, "items")) {
		const objectId = stringField(item.object_id, "items[].object_id");
		const objectType = stringField(item.object_type, "items[].object_type");
		if (!input.dryRun) {
			await requestJson({
				body: { objectId, objectType },
				fetchImpl: input.fetchImpl,
				method: "POST",
				path: `/api/public/annotation-queues/${queueId}/items`,
				settings: input.settings,
			});
		}
		enqueued += 1;
		for (const score of mappingList(item.prefill_scores ?? [], "prefill_scores")) {
			if (!input.dryRun) {
				await requestJson({
					body: scoreItemToLangfusePayload({
						...score,
						idempotency_key: stableId("annotation", queueId, objectId, score.name),
						observation_id: objectType === "OBSERVATION" ? objectId : null,
						trace_id: objectType === "TRACE" ? objectId : null,
					}),
					fetchImpl: input.fetchImpl,
					method: "POST",
					path: "/api/public/scores",
					settings: input.settings,
				});
			}
			prefilled += 1;
		}
	}
	return {
		dry_run: input.dryRun,
		enqueued: input.dryRun ? 0 : enqueued,
		planned_enqueue: input.dryRun ? enqueued : 0,
		planned_prefill_scores: input.dryRun ? prefilled : 0,
		prefilled_scores: input.dryRun ? 0 : prefilled,
		queue_id: queueId,
		schema_version: "langfuse_review_queue_sync_report.v1",
	};
}

export async function exportLangfuseReviewResults(input: {
	fetchImpl?: typeof fetch;
	manifestPath: string;
	outputPath: string;
	settings: LangfuseSettings;
}): Promise<JsonObject> {
	const manifest = loadJsonObject(input.manifestPath);
	const queueId = stringField(manifest.queue_id, "queue_id");
	const items = await listPaginated({
		fetchImpl: input.fetchImpl,
		path: `/api/public/annotation-queues/${queueId}/items`,
		query: { status: "COMPLETED" },
		settings: input.settings,
	});
	const payload = {
		items: items.map((item) => reviewExportItem(queueId, item)),
		queue_id: queueId,
		schema_version: "langfuse_review_export.v1",
	};
	writeJsonObject(input.outputPath, payload);
	return { ...payload, output_path: input.outputPath };
}

function inputPayload(dataset: JsonObject, item: JsonObject): JsonObject {
	const caseId = stringField(item.case_id, "case_id");
	if (dataset.kind === "online_answer_path") {
		return {
			case_id: caseId,
			surface_key: stringField(dataset.surface_key, "surface_key"),
			user_goal_sha256: sha256Text(stringField(item.user_goal, "user_goal")),
		};
	}
	if (dataset.kind === "context_followup") {
		return {
			case_id: caseId,
			question_sha256: sha256Text(stringField(item.question, "question")),
			surface_key: stringField(dataset.surface_key, "surface_key"),
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
	return { case_id: item.case_id, split: optionalString(item.split) };
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
	fetchImpl?: typeof fetch;
	manifestPath: string;
	settings: LangfuseSettings;
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
		await requestJson({
			body: { name },
			fetchImpl: input.fetchImpl,
			method: "POST",
			path: "/api/public/v2/datasets",
			settings: input.settings,
		});
	}
	if (!input.dryRun) {
		for (const item of desired) {
			await requestJson({
				body: item,
				fetchImpl: input.fetchImpl,
				method: "POST",
				path: "/api/public/dataset-items",
				settings: input.settings,
			});
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

function experimentArtifact(
	manifest: JsonObject,
	itemResults: JsonObject[],
	datasetRunId: string | null,
): JsonObject {
	return {
		aggregate_scores: mappingList(manifest.aggregate_scores, "aggregate_scores"),
		dataset_name: stringField(manifest.dataset_name, "dataset_name"),
		dataset_run_id: datasetRunId,
		environment: stringField(manifest.environment, "environment"),
		experiment_kind: stringField(manifest.experiment_kind, "experiment_kind"),
		experiment_run_id: stringField(manifest.experiment_run_id, "experiment_run_id"),
		item_results: itemResults,
		release: stringField(manifest.release, "release"),
		schema_version: "langfuse_experiment_result.v1",
		source_git_head: stringField(manifest.source_git_head, "source_git_head"),
		surface_key: stringField(manifest.surface_key, "surface_key"),
		variant_id: stringField(manifest.variant_id, "variant_id"),
		verdict: itemResults.some((item) => item.status !== "passed") ? "fail" : "pass",
	};
}

function scoreReportFromExperimentManifest(
	manifest: JsonObject,
	artifact: JsonObject,
	datasetRunId: string | null,
): JsonObject {
	const scoreItems: JsonObject[] = [];
	for (const score of mappingList(artifact.aggregate_scores, "aggregate_scores")) {
		if (datasetRunId) {
			scoreItems.push({
				case_id: slug(`aggregate:${score.name}`),
				comment: optionalString(score.comment),
				data_type: stringField(score.data_type, "score.data_type"),
				dataset_item_id: null,
				dataset_run_id: datasetRunId,
				idempotency_key: stableId(
					"lfscore",
					manifest.experiment_run_id,
					`aggregate:${score.name}`,
					score.name,
				),
				metadata: {
					case_id: slug(`aggregate:${score.name}`),
					eval_kind: manifest.experiment_kind,
					release: manifest.release,
					schema_version: "langfuse_experiment_result.v1",
					surface_key: manifest.surface_key,
					variant_id: manifest.variant_id,
				},
				name: score.name,
				observation_id: null,
				session_id: null,
				trace_id: null,
				value: score.value,
			});
		}
	}
	return validateLangfuseScoreReport({
		environment: manifest.environment,
		eval_kind: manifest.experiment_kind,
		eval_run_id: manifest.experiment_run_id,
		expected_publish_denominator: scoreItems.length,
		omitted_items: [],
		profile_id: manifest.experiment_kind,
		release: manifest.release,
		schema_version: "langfuse_score_report.v1",
		score_items: scoreItems,
		source_artifact_path: manifest.artifact_path,
		source_git_head: manifest.source_git_head,
		source_result_denominator: scoreItems.length,
		surface_key: manifest.surface_key,
		variant_id: manifest.variant_id,
	});
}

function reviewExportItem(queueId: string, item: JsonObject): JsonObject {
	const queueItemId = stringField(item.id, "queue_item.id");
	const scores = mappingList(item.scores ?? item.annotations ?? [], "scores")
		.filter((score) => optionalString(score.scoreConfigId) || optionalString(score.configId))
		.map((score) => ({
			score_config_id: optionalString(score.scoreConfigId) ?? optionalString(score.configId),
			score_name: optionalString(score.name),
			value: score.value,
		}));
	const metadata =
		item.metadata && typeof item.metadata === "object" ? mapping(item.metadata, "metadata") : {};
	return {
		case_id: optionalString(item.caseId) ?? optionalString(metadata.case_id) ?? item.objectId,
		object_id: stringField(item.objectId, "objectId"),
		object_type: stringField(item.objectType, "objectType"),
		queue_id: queueId,
		queue_item_id: queueItemId,
		repo_backlog_candidate_id: stableId("review", queueId, queueItemId),
		review_comment_hash: sha256Json(item.comment ?? ""),
		reviewer_score_summary: scores,
		score_config_ids: scores.map((score) => score.score_config_id),
	};
}
