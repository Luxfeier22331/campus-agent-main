import { resolve } from "node:path";

import { createLangfuseEvalClient } from "./langfuse-client";
import {
	assertCompleteSettings,
	isRecord,
	type JsonObject,
	type LangfuseSettings,
	loadJsonObject,
	mapping,
	mappingList,
	optionalString,
	requireEqual,
	stableId,
	stringField,
} from "./shared";

export const SCORE_REGISTRY_SCHEMA_VERSION = "langfuse_score_registry.v1";
const DEFAULT_REGISTRY_PATH = resolve(
	import.meta.dirname,
	"../assets/registries/langfuse_score_registry.v1.json",
);
const SCORE_DATA_TYPES = new Set(["BOOLEAN", "NUMERIC", "CATEGORICAL", "TEXT"]);
export const LANGFUSE_SCORE_METADATA_ALLOWLIST = new Set([
	"argument_mode",
	"candidate_id",
	"case_family",
	"case_id",
	"collection_key",
	"dataset_item_id",
	"dataset_version",
	"eval_kind",
	"failure_class",
	"grader_version",
	"metric_key",
	"profile_id",
	"query_id",
	"retrieval_top_k",
	"release",
	"request_id",
	"reranker_enabled",
	"schema_version",
	"source_artifact_path",
	"source_kind",
	"source_git_head",
	"surface_key",
	"top_k",
	"variant_id",
	"verdict",
]);
export const LANGFUSE_SCORE_FORBIDDEN_METADATA_KEYS = new Set([
	"api_key",
	"authorization",
	"cookie",
	"cookies",
	"database_url",
	"jwt",
	"object_store_secret",
	"provider_raw_response",
	"raw_answer",
	"raw_prompt",
	"standalone_query",
	"raw_retrieved_snippet",
	"raw_transcript",
	"retrieved_snippet",
	"source_body",
	"source_body_text",
]);

export interface LangfuseScoreItem extends JsonObject {
	case_id: string;
	comment?: string | null;
	data_type: string;
	dataset_item_id?: string | null;
	dataset_run_id?: string | null;
	idempotency_key: string;
	metadata: JsonObject;
	name: string;
	observation_id?: string | null;
	session_id?: string | null;
	trace_id?: string | null;
	value: unknown;
}

export interface LangfuseScoreOmission extends JsonObject {
	case_id: string;
	metadata: JsonObject;
	reason: string;
	source_artifact_ref?: string | null;
	source_result_id: string;
}

export interface LangfuseScorePublishPlan {
	evalRunId: string;
	omittedItems: LangfuseScoreOmission[];
	scoreItems: LangfuseScoreItem[];
	sourceResultDenominator: number;
}

export function buildLangfuseScoresFromRagasScoreBatch(input: {
	ragasScoreBatchPath?: string | null;
	ragasScoreBatchPayload: JsonObject;
	sourceKind?: string | null;
}): LangfuseScorePublishPlan {
	const sourceKind = optionalString(input.sourceKind) ?? "local_artifact";
	const schemaVersion = stringField(input.ragasScoreBatchPayload.schema_version, "schema_version");
	requireEqual(schemaVersion, "ragas_score_batch.v1", "schema_version");
	const evalRunId = stringField(input.ragasScoreBatchPayload.eval_run_id, "eval_run_id");
	const rawItems = mappingList(input.ragasScoreBatchPayload.items, "items");
	const scoreItems: LangfuseScoreItem[] = [];
	const omittedItems: LangfuseScoreOmission[] = [];
	for (const item of rawItems) {
		const caseId = stringField(item.case_id, "items[].case_id");
		const traceId = stringField(item.trace_id, `${caseId}.trace_id`);
		const observationId = optionalString(item.observation_id);
		const datasetItemId = optionalString(item.dataset_item_id);
		const datasetRunId = optionalString(item.dataset_run_id);
		const itemMetadata = mapping(item.metadata ?? {}, `${caseId}.metadata`);
		const safeMetadata = ragasMetadata({
			caseId,
			itemMetadata,
			ragasScoreBatchPath: input.ragasScoreBatchPath,
			schemaVersion,
			sourceKind,
		});
		const scores = mapping(item.scores, `${caseId}.scores`);
		for (const [metricName, value] of Object.entries(scores)) {
			const name = stringField(metricName, `${caseId}.scores.metric`);
			scoreItems.push({
				case_id: caseId,
				comment: `${name} scored by RAGAS`,
				data_type: "NUMERIC",
				dataset_item_id: datasetItemId,
				dataset_run_id: datasetRunId,
				idempotency_key: stableId("lfscore", evalRunId, caseId, name),
				metadata: { ...safeMetadata, metric_key: name },
				name,
				observation_id: observationId,
				session_id: null,
				trace_id: traceId,
				value,
			});
		}
		for (const error of mappingList(item.errors ?? [], `${caseId}.errors`)) {
			const metricName = stringField(error.metric_name, `${caseId}.errors[].metric_name`);
			const reason = stringField(error.reason, `${caseId}.errors[].reason`);
			omittedItems.push({
				case_id: caseId,
				metadata: { ...safeMetadata, metric_key: metricName },
				reason,
				...(sourceKind === "local_artifact"
					? { source_artifact_ref: input.ragasScoreBatchPath ?? null }
					: {}),
				source_result_id: `${caseId}:${metricName}`,
			});
		}
	}
	return validateLangfuseScorePublishPlan({
		evalRunId,
		omittedItems,
		scoreItems,
		sourceResultDenominator: scoreItems.length + omittedItems.length,
	});
}

export function buildLangfuseScoresFromRagasAgentScoreBatch(input: {
	ragasAgentScoreBatchPath?: string | null;
	ragasAgentScoreBatchPayload: JsonObject;
	sourceKind?: string | null;
}): LangfuseScorePublishPlan {
	const sourceKind = optionalString(input.sourceKind) ?? "local_artifact";
	const schemaVersion = stringField(
		input.ragasAgentScoreBatchPayload.schema_version,
		"schema_version",
	);
	requireEqual(schemaVersion, "ragas_agent_score_batch.v1", "schema_version");
	const evalRunId = stringField(input.ragasAgentScoreBatchPayload.eval_run_id, "eval_run_id");
	const rawItems = mappingList(input.ragasAgentScoreBatchPayload.items, "items");
	const scoreItems: LangfuseScoreItem[] = [];
	const omittedItems: LangfuseScoreOmission[] = [];
	for (const item of rawItems) {
		const caseId = stringField(item.case_id, "items[].case_id");
		const traceId = stringField(item.trace_id, `${caseId}.trace_id`);
		const observationId = optionalString(item.observation_id);
		const datasetItemId = optionalString(item.dataset_item_id);
		const datasetRunId = optionalString(item.dataset_run_id);
		const itemMetadata = mapping(item.metadata ?? {}, `${caseId}.metadata`);
		const safeMetadata = ragasAgentMetadata({
			caseId,
			itemMetadata,
			ragasAgentScoreBatchPath: input.ragasAgentScoreBatchPath,
			schemaVersion,
			sourceKind,
		});
		const scores = mapping(item.scores, `${caseId}.scores`);
		for (const [metricName, value] of Object.entries(scores)) {
			const name = stringField(metricName, `${caseId}.scores.metric`);
			scoreItems.push({
				case_id: caseId,
				comment: `${name} scored by RAGAS agent metrics`,
				data_type: "NUMERIC",
				dataset_item_id: datasetItemId,
				dataset_run_id: datasetRunId,
				idempotency_key: stableId("lfscore", evalRunId, caseId, name),
				metadata: { ...safeMetadata, metric_key: name },
				name,
				observation_id: observationId,
				session_id: null,
				trace_id: traceId,
				value,
			});
		}
		for (const error of mappingList(item.errors ?? [], `${caseId}.errors`)) {
			const metricName = stringField(error.metric_name, `${caseId}.errors[].metric_name`);
			const reason = stringField(error.reason, `${caseId}.errors[].reason`);
			omittedItems.push({
				case_id: caseId,
				metadata: { ...safeMetadata, metric_key: metricName },
				reason,
				...(sourceKind === "local_artifact"
					? { source_artifact_ref: input.ragasAgentScoreBatchPath ?? null }
					: {}),
				source_result_id: `${caseId}:${metricName}`,
			});
		}
	}
	return validateLangfuseScorePublishPlan({
		evalRunId,
		omittedItems,
		scoreItems,
		sourceResultDenominator: scoreItems.length + omittedItems.length,
	});
}

export function validateLangfuseScorePublishPlan(input: {
	evalRunId: string;
	omittedItems: LangfuseScoreOmission[];
	registryPath?: string;
	scoreItems: LangfuseScoreItem[];
	sourceResultDenominator: number;
}): LangfuseScorePublishPlan {
	const registry = loadScoreRegistry(input.registryPath ?? DEFAULT_REGISTRY_PATH);
	stringField(input.evalRunId, "evalRunId");
	if (input.scoreItems.length === 0 && input.omittedItems.length === 0) {
		throw new Error("Langfuse score publish plan must include scoreItems or omittedItems");
	}
	if (input.sourceResultDenominator !== input.scoreItems.length + input.omittedItems.length) {
		throw new Error("sourceResultDenominator must equal scoreItems plus omittedItems length");
	}
	input.scoreItems.forEach((item, index) => {
		validateScoreItem(item, index, registry);
	});
	input.omittedItems.forEach((item, index) => {
		validateOmittedItem(item, index);
	});
	return input;
}

export async function publishLangfuseScores(input: {
	dryRun?: boolean;
	evalRunId: string;
	fetchImpl?: typeof fetch;
	omittedItems?: LangfuseScoreOmission[];
	registryPath?: string;
	scoreItems: LangfuseScoreItem[];
	settings: LangfuseSettings;
	sourceResultDenominator: number;
	validateOnly?: boolean;
}): Promise<JsonObject> {
	const omittedItems = input.omittedItems ?? [];
	const plan = validateLangfuseScorePublishPlan({
		evalRunId: input.evalRunId,
		omittedItems,
		registryPath: input.registryPath,
		scoreItems: input.scoreItems,
		sourceResultDenominator: input.sourceResultDenominator,
	});
	if (!(input.dryRun || input.validateOnly)) {
		assertCompleteSettings(input.settings);
	}
	const langfuse = createLangfuseEvalClient({
		fetchImpl: input.fetchImpl,
		settings: input.settings,
	});
	let published = 0;
	for (const item of plan.scoreItems) {
		if (!input.validateOnly) {
			if (!input.dryRun) {
				await langfuse.createScore(scoreItemToLangfusePayload(item));
			}
			published += 1;
		}
	}
	if (!(input.validateOnly || input.dryRun)) {
		await langfuse.flushScores();
	}
	return {
		dry_run: Boolean(input.dryRun),
		eval_run_id: plan.evalRunId,
		expected_publish_denominator: plan.scoreItems.length,
		failed: 0,
		omitted: plan.omittedItems.length,
		published,
		score_target: "langfuse_scores_api",
		source_result_denominator: plan.sourceResultDenominator,
		validate_only: Boolean(input.validateOnly),
	};
}

export function scoreItemToLangfusePayload(item: JsonObject): JsonObject {
	const payload: JsonObject = {
		dataType: stringField(item.data_type, "score.data_type"),
		id: stringField(item.idempotency_key, "score.idempotency_key"),
		metadata: mapping(item.metadata, "score.metadata"),
		name: stringField(item.name, "score.name"),
		source: "API",
		value: item.value,
	};
	for (const [source, target] of [
		["trace_id", "traceId"],
		["observation_id", "observationId"],
		["session_id", "sessionId"],
		["dataset_run_id", "datasetRunId"],
		["dataset_item_id", "datasetItemId"],
	] as const) {
		const value = optionalString(item[source]);
		if (value) {
			payload[target] = value;
		}
	}
	const comment = optionalString(item.comment);
	if (comment) {
		payload.comment = comment;
	}
	return payload;
}

function loadScoreRegistry(path: string): Map<string, JsonObject> {
	const payload = loadJsonObject(path);
	requireEqual(payload.schema_version, SCORE_REGISTRY_SCHEMA_VERSION, "registry.schema_version");
	const registry = new Map<string, JsonObject>();
	for (const score of mappingList(payload.scores, "registry.scores")) {
		const name = stringField(score.name, "registry.scores[].name");
		const dataType = stringField(score.data_type, "registry.scores[].data_type");
		if (!SCORE_DATA_TYPES.has(dataType)) {
			throw new Error(`registry score ${name} has unsupported data_type ${dataType}`);
		}
		registry.set(name, score);
	}
	return registry;
}

function validateScoreItem(
	item: JsonObject,
	index: number,
	registry: Map<string, JsonObject>,
): void {
	const prefix = `scoreItems[${index}]`;
	const idempotencyKey = stringField(item.idempotency_key, `${prefix}.idempotency_key`);
	if (idempotencyKey.length > 255) {
		throw new Error(`${prefix}.idempotency_key must be at most 255 characters`);
	}
	const name = stringField(item.name, `${prefix}.name`);
	const registered = registry.get(name);
	if (!registered) {
		throw new Error(`unknown Langfuse score name: ${name}`);
	}
	const dataType = stringField(item.data_type, `${prefix}.data_type`);
	if (dataType !== stringField(registered.data_type, `registry.${name}.data_type`)) {
		throw new Error(`${prefix}.data_type does not match registry for ${name}`);
	}
	stringField(item.case_id, `${prefix}.case_id`);
	validateTargetIdentity(item, prefix);
	validateScoreValue(item.value, dataType, prefix);
	validateMetadata(mapping(item.metadata, `${prefix}.metadata`), `${prefix}.metadata`);
	if (item.comment !== null && item.comment !== undefined && typeof item.comment !== "string") {
		throw new Error(`${prefix}.comment must be a string or null`);
	}
}

function validateOmittedItem(item: JsonObject, index: number): void {
	const prefix = `omittedItems[${index}]`;
	stringField(item.case_id, `${prefix}.case_id`);
	stringField(item.source_result_id, `${prefix}.source_result_id`);
	stringField(item.reason, `${prefix}.reason`);
	optionalString(item.source_artifact_ref);
	validateMetadata(mapping(item.metadata, `${prefix}.metadata`), `${prefix}.metadata`);
}

function validateTargetIdentity(item: JsonObject, prefix: string): void {
	const traceId = optionalString(item.trace_id);
	const observationId = optionalString(item.observation_id);
	const sessionId = optionalString(item.session_id);
	const datasetRunId = optionalString(item.dataset_run_id);
	if (observationId && !traceId) {
		throw new Error(`${prefix}.observation_id requires trace_id`);
	}
	if (sessionId && (traceId || observationId || datasetRunId)) {
		throw new Error(`${prefix}.session_id scores cannot carry trace or dataset identity`);
	}
	if (!(traceId || sessionId || datasetRunId)) {
		throw new Error(`${prefix} must carry trace_id, session_id, or dataset_run_id`);
	}
}

function validateScoreValue(value: unknown, dataType: string, prefix: string): void {
	if (dataType === "BOOLEAN" && ![0, 1].includes(Number(value))) {
		throw new Error(`${prefix}.BOOLEAN score value must be 0 or 1`);
	}
	if (dataType === "NUMERIC" && (typeof value !== "number" || !Number.isFinite(value))) {
		throw new Error(`${prefix}.NUMERIC score value must be a number`);
	}
	if (dataType === "CATEGORICAL" && (typeof value !== "string" || !value.trim())) {
		throw new Error(`${prefix}.CATEGORICAL score value must be a non-empty string`);
	}
	if (dataType === "TEXT" && (typeof value !== "string" || !value.trim() || value.length > 500)) {
		throw new Error(`${prefix}.TEXT score value must be 1-500 characters`);
	}
}

function validateMetadata(metadata: JsonObject, prefix: string): void {
	for (const [key, value] of Object.entries(metadata)) {
		const normalized = key.trim();
		const lower = normalized.toLowerCase();
		if (LANGFUSE_SCORE_FORBIDDEN_METADATA_KEYS.has(lower)) {
			throw new Error(`${prefix}.${normalized} is forbidden Langfuse metadata`);
		}
		if (!LANGFUSE_SCORE_METADATA_ALLOWLIST.has(normalized)) {
			throw new Error(`${prefix}.${normalized} is not in the Langfuse metadata allowlist`);
		}
		if (Array.isArray(value) || (typeof value === "object" && value !== null)) {
			throw new Error(`${prefix}.${normalized} must be scalar or null`);
		}
	}
}

function ragasMetadata(input: {
	caseId: string;
	itemMetadata: JsonObject;
	ragasScoreBatchPath?: string | null;
	schemaVersion: string;
	sourceKind: string;
}): JsonObject {
	return {
		case_id: input.caseId,
		eval_kind: "ragas",
		schema_version: input.schemaVersion,
		source_kind: input.sourceKind,
		...(input.sourceKind === "local_artifact" && input.ragasScoreBatchPath
			? { source_artifact_path: input.ragasScoreBatchPath }
			: {}),
		...(optionalString(input.itemMetadata.surface_key)
			? { surface_key: optionalString(input.itemMetadata.surface_key) }
			: {}),
		...(optionalString(input.itemMetadata.variant_id)
			? { variant_id: optionalString(input.itemMetadata.variant_id) }
			: {}),
	};
}

function ragasAgentMetadata(input: {
	caseId: string;
	itemMetadata: JsonObject;
	ragasAgentScoreBatchPath?: string | null;
	schemaVersion: string;
	sourceKind: string;
}): JsonObject {
	return {
		case_id: input.caseId,
		eval_kind: "ragas_agent",
		schema_version: input.schemaVersion,
		source_kind: input.sourceKind,
		...(input.sourceKind === "local_artifact" && input.ragasAgentScoreBatchPath
			? { source_artifact_path: input.ragasAgentScoreBatchPath }
			: {}),
		...(optionalString(input.itemMetadata.argument_mode)
			? { argument_mode: optionalString(input.itemMetadata.argument_mode) }
			: {}),
		...(optionalString(input.itemMetadata.surface_key)
			? { surface_key: optionalString(input.itemMetadata.surface_key) }
			: {}),
		...(optionalString(input.itemMetadata.variant_id)
			? { variant_id: optionalString(input.itemMetadata.variant_id) }
			: {}),
	};
}

export function resolveFirstSurfaceKey(items: JsonObject[]): string {
	for (const item of items) {
		const metadata = isRecord(item.metadata) ? item.metadata : {};
		const surfaceKey = optionalString(metadata.surface_key);
		if (surfaceKey) {
			return surfaceKey;
		}
	}
	return "ragas";
}
