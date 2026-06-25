import { resolve } from "node:path";

import { LangfuseClient } from "@langfuse/client";
import {
	assertCompleteSettings,
	type JsonObject,
	type LangfuseSettings,
	loadJsonObject,
	mapping,
	mappingList,
	optionalString,
	requestJson,
	requireEqual,
	slug,
	stableId,
	stringField,
} from "./shared";
import { deriveLangfuseTraceId } from "./trace";

export const SCORE_REPORT_SCHEMA_VERSION = "langfuse_score_report.v1";
export const SCORE_REGISTRY_SCHEMA_VERSION = "langfuse_score_registry.v1";
const DEFAULT_REGISTRY_PATH = resolve(
	import.meta.dirname,
	"../../evals/fixtures/ops/langfuse_score_registry.v1.json",
);
const SCORE_DATA_TYPES = new Set(["BOOLEAN", "NUMERIC", "CATEGORICAL", "TEXT"]);
const METADATA_ALLOWLIST = new Set([
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
	"release",
	"request_id",
	"schema_version",
	"source_artifact_path",
	"source_git_head",
	"surface_key",
	"top_k",
	"variant_id",
	"verdict",
]);
const FORBIDDEN_METADATA_KEYS = new Set([
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

export interface LangfuseScoreReport extends JsonObject {
	eval_kind: string;
	eval_run_id: string;
	expected_publish_denominator: number;
	omitted_items: JsonObject[];
	profile_id: string;
	release: string;
	schema_version: typeof SCORE_REPORT_SCHEMA_VERSION;
	score_items: JsonObject[];
	source_result_denominator: number;
}

export function loadLangfuseScoreReport(path: string): LangfuseScoreReport {
	return validateLangfuseScoreReport(loadJsonObject(path));
}

export function validateLangfuseScoreReport(
	payload: JsonObject,
	registryPath = DEFAULT_REGISTRY_PATH,
): LangfuseScoreReport {
	const registry = loadScoreRegistry(registryPath);
	requireEqual(payload.schema_version, SCORE_REPORT_SCHEMA_VERSION, "schema_version");
	stringField(payload.eval_kind, "eval_kind");
	stringField(payload.eval_run_id, "eval_run_id");
	stringField(payload.profile_id, "profile_id");
	stringField(payload.surface_key, "surface_key");
	stringField(payload.variant_id, "variant_id");
	stringField(payload.environment, "environment");
	stringField(payload.release, "release");
	stringField(payload.source_git_head, "source_git_head");
	stringField(payload.source_artifact_path, "source_artifact_path");
	const scoreItems = mappingList(payload.score_items, "score_items");
	const omittedItems = mappingList(payload.omitted_items, "omitted_items");
	if (scoreItems.length === 0 && omittedItems.length === 0) {
		throw new Error("score report must include score_items or omitted_items");
	}
	const sourceResultDenominator = integerField(
		payload.source_result_denominator,
		"source_result_denominator",
	);
	const expectedPublishDenominator = integerField(
		payload.expected_publish_denominator,
		"expected_publish_denominator",
	);
	if (expectedPublishDenominator !== scoreItems.length) {
		throw new Error("expected_publish_denominator must equal score_items length");
	}
	if (sourceResultDenominator !== scoreItems.length + omittedItems.length) {
		throw new Error("source_result_denominator must equal score_items plus omitted_items length");
	}
	scoreItems.forEach((item, index) => {
		validateScoreItem(item, index, registry);
	});
	omittedItems.forEach((item, index) => {
		validateOmittedItem(item, index);
	});
	return payload as LangfuseScoreReport;
}

export function buildScoreReportFromProfileReport(input: {
	environment: string;
	profileReportPath: string;
	profileReportPayload: JsonObject;
}): LangfuseScoreReport {
	const schemaVersion = stringField(input.profileReportPayload.schema_version, "schema_version");
	const profileId = stringField(input.profileReportPayload.profile_id, "profile_id");
	const caseFamily = stringField(input.profileReportPayload.case_family, "case_family");
	const versionSummary = mapping(input.profileReportPayload.version_summary, "version_summary");
	const gitHead = stringField(versionSummary.git_head, "version_summary.git_head");
	const runtimeVersion = stringField(
		versionSummary.runtime_version,
		"version_summary.runtime_version",
	);
	const rawResults = mappingList(input.profileReportPayload.sanitized_results, "sanitized_results");
	const evalRunId = slug(`${profileId}:${gitHead}:${runtimeVersion}`);
	const scoreItems: JsonObject[] = [];
	const omittedItems: JsonObject[] = [];
	for (const result of rawResults) {
		const caseId = stringField(result.case_id, "sanitized_results[].case_id");
		const correlation = result.request_correlation;
		if (!(correlation && mappingOrNull(correlation))) {
			omittedItems.push(
				profileOmittedItem(caseId, "missing_request_correlation", input, profileId),
			);
			continue;
		}
		const productTraceId = optionalString(correlation.trace_id);
		const requestId = optionalString(correlation.request_id);
		if (!(productTraceId && requestId)) {
			omittedItems.push(
				profileOmittedItem(caseId, "missing_request_correlation_identity", input, profileId),
			);
			continue;
		}
		scoreItems.push({
			case_id: caseId,
			comment: result.passed ? "profile result passed" : "profile result failed",
			data_type: "BOOLEAN",
			dataset_item_id: null,
			dataset_run_id: null,
			idempotency_key: stableId("lfscore", evalRunId, caseId, `${profileId}.profile`),
			metadata: {
				case_family: caseFamily,
				case_id: caseId,
				failure_class: optionalString(result.failure_class),
				grader_version: runtimeVersion,
				profile_id: profileId,
				request_id: requestId,
				schema_version: schemaVersion,
			},
			name: `${profileId}.profile`,
			observation_id: null,
			session_id: null,
			trace_id: deriveLangfuseTraceId(productTraceId),
			value: result.passed ? 1 : 0,
		});
	}
	return validateLangfuseScoreReport({
		environment: stringField(input.environment, "environment"),
		eval_kind: "profile",
		eval_run_id: evalRunId,
		expected_publish_denominator: scoreItems.length,
		omitted_items: omittedItems,
		profile_id: profileId,
		release: runtimeVersion,
		schema_version: SCORE_REPORT_SCHEMA_VERSION,
		score_items: scoreItems,
		source_artifact_path: input.profileReportPath,
		source_git_head: gitHead,
		source_result_denominator: rawResults.length,
		surface_key: profileSurfaceKey(profileId),
		variant_id: "default",
	});
}

export function buildScoreReportFromRagasScoreBatch(input: {
	environment: string;
	ragasScoreBatchPath: string;
	ragasScoreBatchPayload: JsonObject;
	sourceGitHead?: string | null;
}): LangfuseScoreReport {
	const schemaVersion = stringField(input.ragasScoreBatchPayload.schema_version, "schema_version");
	requireEqual(schemaVersion, "ragas_score_batch.v1", "schema_version");
	const evalRunId = stringField(input.ragasScoreBatchPayload.eval_run_id, "eval_run_id");
	const rawItems = mappingList(input.ragasScoreBatchPayload.items, "items");
	const scoreItems: JsonObject[] = [];
	const omittedItems: JsonObject[] = [];
	for (const item of rawItems) {
		const caseId = stringField(item.case_id, "items[].case_id");
		const traceId = stringField(item.trace_id, `${caseId}.trace_id`);
		const observationId = optionalString(item.observation_id);
		const itemMetadata = mapping(item.metadata ?? {}, `${caseId}.metadata`);
		const safeMetadata = ragasMetadata({
			caseId,
			itemMetadata,
			ragasScoreBatchPath: input.ragasScoreBatchPath,
			schemaVersion,
		});
		const scores = mapping(item.scores, `${caseId}.scores`);
		for (const [metricName, value] of Object.entries(scores)) {
			const name = stringField(metricName, `${caseId}.scores.metric`);
			scoreItems.push({
				case_id: caseId,
				comment: `${name} scored by RAGAS`,
				data_type: "NUMERIC",
				dataset_item_id: null,
				dataset_run_id: null,
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
				source_artifact_ref: input.ragasScoreBatchPath,
				source_result_id: `${caseId}:${metricName}`,
			});
		}
	}
	return validateLangfuseScoreReport({
		environment: stringField(input.environment, "environment"),
		eval_kind: "ragas",
		eval_run_id: evalRunId,
		expected_publish_denominator: scoreItems.length,
		omitted_items: omittedItems,
		profile_id: "ragas",
		release: evalRunId,
		schema_version: SCORE_REPORT_SCHEMA_VERSION,
		score_items: scoreItems,
		source_artifact_path: input.ragasScoreBatchPath,
		source_git_head: optionalString(input.sourceGitHead) ?? "unknown",
		source_result_denominator: scoreItems.length + omittedItems.length,
		surface_key: resolveRagasSurfaceKey(rawItems),
		variant_id: "default",
	});
}

export function buildScoreReportFromContextFollowupScoreBatch(input: {
	contextFollowupScoreBatchPath: string;
	contextFollowupScoreBatchPayload: JsonObject;
	environment: string;
}): LangfuseScoreReport {
	const schemaVersion = stringField(
		input.contextFollowupScoreBatchPayload.schema_version,
		"schema_version",
	);
	requireEqual(schemaVersion, "context_followup_score_batch.v1", "schema_version");
	const evalRunId = stringField(input.contextFollowupScoreBatchPayload.eval_run_id, "eval_run_id");
	const datasetVersion = stringField(
		input.contextFollowupScoreBatchPayload.dataset_version,
		"dataset_version",
	);
	const variantId = stringField(input.contextFollowupScoreBatchPayload.variant_id, "variant_id");
	const sourceGitHead = stringField(
		input.contextFollowupScoreBatchPayload.source_git_head,
		"source_git_head",
	);
	const rawItems = mappingList(input.contextFollowupScoreBatchPayload.items, "items");
	const scoreItems: JsonObject[] = [];
	const omittedItems: JsonObject[] = [];
	for (const item of rawItems) {
		const caseId = stringField(item.case_id, "items[].case_id");
		const traceId = stringField(item.trace_id, `${caseId}.trace_id`);
		const observationId = optionalString(item.observation_id);
		const datasetRunId = optionalString(item.dataset_run_id);
		const datasetItemId = optionalString(item.dataset_item_id);
		const itemMetadata = mapping(item.metadata ?? {}, `${caseId}.metadata`);
		const safeMetadata = contextFollowupMetadata({
			caseId,
			contextFollowupScoreBatchPath: input.contextFollowupScoreBatchPath,
			datasetVersion,
			itemMetadata,
			schemaVersion,
			sourceGitHead,
			variantId,
		});
		const scores = mapping(item.scores, `${caseId}.scores`);
		for (const [metricName, value] of Object.entries(scores)) {
			const name = stringField(metricName, `${caseId}.scores.metric`);
			scoreItems.push({
				case_id: caseId,
				comment: `${name} scored by repo-owned context follow-up evaluator`,
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
				source_artifact_ref: input.contextFollowupScoreBatchPath,
				source_result_id: `${caseId}:${metricName}`,
			});
		}
	}
	return validateLangfuseScoreReport({
		environment: stringField(input.environment, "environment"),
		eval_kind: "context_followup",
		eval_run_id: evalRunId,
		expected_publish_denominator: scoreItems.length,
		omitted_items: omittedItems,
		profile_id: "context-followup",
		release: evalRunId,
		schema_version: SCORE_REPORT_SCHEMA_VERSION,
		score_items: scoreItems,
		source_artifact_path: input.contextFollowupScoreBatchPath,
		source_git_head: sourceGitHead,
		source_result_denominator: scoreItems.length + omittedItems.length,
		surface_key: resolveContextFollowupSurfaceKey(rawItems),
		variant_id: variantId,
	});
}

export function buildScoreReportFromAgentEvalCaseResults(input: {
	agentEvalCaseResultsPath: string;
	agentEvalCaseResultsPayload: JsonObject;
	environment: string;
}): LangfuseScoreReport {
	const schemaVersion = stringField(
		input.agentEvalCaseResultsPayload.schema_version,
		"schema_version",
	);
	requireEqual(schemaVersion, "agent_eval_case_results.v1", "schema_version");
	const evalRunId = stringField(input.agentEvalCaseResultsPayload.eval_run_id, "eval_run_id");
	const datasetVersion = stringField(
		input.agentEvalCaseResultsPayload.dataset_version,
		"dataset_version",
	);
	const variantId = stringField(input.agentEvalCaseResultsPayload.variant_id, "variant_id");
	const sourceGitHead = stringField(
		input.agentEvalCaseResultsPayload.source_git_head,
		"source_git_head",
	);
	const rawItems = mappingList(input.agentEvalCaseResultsPayload.items, "items");
	const scoreItems: JsonObject[] = [];
	const omittedItems: JsonObject[] = [];
	for (const item of rawItems) {
		const caseId = stringField(item.case_id, "items[].case_id");
		const traceId = optionalString(item.trace_id);
		const observationId = optionalString(item.observation_id);
		const datasetRunId = optionalString(item.dataset_run_id);
		const datasetItemId = optionalString(item.dataset_item_id);
		const itemMetadata = mapping(item.metadata ?? {}, `${caseId}.metadata`);
		const safeMetadata = agentEvalMetadata({
			agentEvalCaseResultsPath: input.agentEvalCaseResultsPath,
			caseId,
			datasetVersion,
			itemMetadata,
			schemaVersion,
			sourceGitHead,
			variantId,
			verdict: optionalString(item.verdict) ?? "unknown",
		});
		const scores = mapping(item.scores, `${caseId}.scores`);
		for (const [metricName, value] of Object.entries(scores)) {
			const name = stringField(metricName, `${caseId}.scores.metric`);
			scoreItems.push({
				case_id: caseId,
				comment: `${name} scored by repo-owned agent evaluator`,
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
				source_artifact_ref: input.agentEvalCaseResultsPath,
				source_result_id: `${caseId}:${metricName}`,
			});
		}
	}
	return validateLangfuseScoreReport({
		environment: stringField(input.environment, "environment"),
		eval_kind: "agent_eval",
		eval_run_id: evalRunId,
		expected_publish_denominator: scoreItems.length,
		omitted_items: omittedItems,
		profile_id: "agent-eval",
		release: evalRunId,
		schema_version: SCORE_REPORT_SCHEMA_VERSION,
		score_items: scoreItems,
		source_artifact_path: input.agentEvalCaseResultsPath,
		source_git_head: sourceGitHead,
		source_result_denominator: scoreItems.length + omittedItems.length,
		surface_key: resolveAgentEvalSurfaceKey(rawItems),
		variant_id: variantId,
	});
}

export function createLangfuseClient(settings: LangfuseSettings): LangfuseClient {
	assertCompleteSettings(settings);
	return new LangfuseClient({
		baseUrl: settings.baseUrl,
		publicKey: settings.publicKey,
		secretKey: settings.secretKey,
		timeout: settings.timeoutSeconds ?? 10,
	});
}

export async function publishLangfuseScoreReport(input: {
	dryRun?: boolean;
	fetchImpl?: typeof fetch;
	scoreReportPayload: JsonObject;
	scoreReportPath?: string | null;
	settings: LangfuseSettings;
	validateOnly?: boolean;
}): Promise<JsonObject> {
	const report = validateLangfuseScoreReport(input.scoreReportPayload);
	if (!(input.dryRun || input.validateOnly)) {
		createLangfuseClient(input.settings);
	}
	let published = 0;
	for (const item of report.score_items) {
		if (!input.validateOnly) {
			if (!input.dryRun) {
				await requestJson({
					body: scoreItemToLangfusePayload(item),
					fetchImpl: input.fetchImpl,
					method: "POST",
					path: "/api/public/scores",
					settings: input.settings,
				});
			}
			published += 1;
		}
	}
	return {
		dry_run: Boolean(input.dryRun),
		eval_run_id: report.eval_run_id,
		expected_publish_denominator: report.expected_publish_denominator,
		failed: 0,
		omitted: report.omitted_items.length,
		published,
		release: report.release,
		score_report_path: input.scoreReportPath ?? null,
		source_result_denominator: report.source_result_denominator,
		validate_only: Boolean(input.validateOnly),
	};
}

export function scoreItemToLangfusePayload(item: JsonObject): JsonObject {
	const payload: JsonObject = {
		dataType: stringField(item.data_type, "score_items[].data_type"),
		id: stringField(item.idempotency_key, "score_items[].idempotency_key"),
		metadata: mapping(item.metadata, "score_items[].metadata"),
		name: stringField(item.name, "score_items[].name"),
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
	const prefix = `score_items[${index}]`;
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
	validateScoreValue(item.value, dataType, prefix, registered);
	validateMetadata(mapping(item.metadata, `${prefix}.metadata`), `${prefix}.metadata`);
	if (item.comment !== null && item.comment !== undefined && typeof item.comment !== "string") {
		throw new Error(`${prefix}.comment must be a string or null`);
	}
}

function validateOmittedItem(item: JsonObject, index: number): void {
	const prefix = `omitted_items[${index}]`;
	stringField(item.case_id, `${prefix}.case_id`);
	stringField(item.source_result_id, `${prefix}.source_result_id`);
	stringField(item.reason, `${prefix}.reason`);
	stringField(item.source_artifact_ref, `${prefix}.source_artifact_ref`);
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

function validateScoreValue(
	value: unknown,
	dataType: string,
	prefix: string,
	registry: JsonObject,
): void {
	if (dataType === "BOOLEAN" && (typeof value === "boolean" || ![0, 1].includes(Number(value)))) {
		throw new Error(`${prefix}.BOOLEAN score value must be 0 or 1`);
	}
	if (dataType === "NUMERIC" && (typeof value !== "number" || !Number.isFinite(value))) {
		throw new Error(`${prefix}.NUMERIC score value must be a number`);
	}
	if (dataType === "TEXT") {
		if (typeof value !== "string" || !value.trim() || value.length > 500) {
			throw new Error(`${prefix}.TEXT score value must be 1-500 characters`);
		}
		if (registry.release_gate) {
			throw new Error(`${prefix}.TEXT score cannot be a release gate score`);
		}
	}
}

function validateMetadata(metadata: JsonObject, prefix: string): void {
	for (const [key, value] of Object.entries(metadata)) {
		const normalized = key.trim();
		const lower = normalized.toLowerCase();
		if (FORBIDDEN_METADATA_KEYS.has(lower)) {
			throw new Error(`${prefix}.${normalized} is forbidden Langfuse metadata`);
		}
		if (!METADATA_ALLOWLIST.has(normalized)) {
			throw new Error(`${prefix}.${normalized} is not in the Langfuse metadata allowlist`);
		}
		if (Array.isArray(value) || (typeof value === "object" && value !== null)) {
			throw new Error(`${prefix}.${normalized} must be scalar or null`);
		}
	}
}

function profileOmittedItem(
	caseId: string,
	reason: string,
	input: { profileReportPath: string },
	profileId: string,
): JsonObject {
	return {
		case_id: caseId,
		metadata: { case_id: caseId, profile_id: profileId },
		reason,
		source_artifact_ref: input.profileReportPath,
		source_result_id: caseId,
	};
}

function profileSurfaceKey(profileId: string): string {
	return profileId === "online-answer-path" ? "online-answer-path" : profileId;
}

function ragasMetadata(input: {
	caseId: string;
	itemMetadata: JsonObject;
	ragasScoreBatchPath: string;
	schemaVersion: string;
}): JsonObject {
	return {
		case_id: input.caseId,
		eval_kind: "ragas",
		schema_version: input.schemaVersion,
		source_artifact_path: input.ragasScoreBatchPath,
		...(optionalString(input.itemMetadata.surface_key)
			? { surface_key: optionalString(input.itemMetadata.surface_key) }
			: {}),
		...(optionalString(input.itemMetadata.variant_id)
			? { variant_id: optionalString(input.itemMetadata.variant_id) }
			: {}),
	};
}

function contextFollowupMetadata(input: {
	caseId: string;
	contextFollowupScoreBatchPath: string;
	datasetVersion: string;
	itemMetadata: JsonObject;
	schemaVersion: string;
	sourceGitHead: string;
	variantId: string;
}): JsonObject {
	assertNoForbiddenLangfuseMetadata(input.itemMetadata, `${input.caseId}.metadata`);
	return {
		case_family: optionalString(input.itemMetadata.case_family) ?? "multi_turn_context_followup",
		case_id: input.caseId,
		dataset_version: input.datasetVersion,
		eval_kind: "context_followup",
		schema_version: input.schemaVersion,
		source_artifact_path: input.contextFollowupScoreBatchPath,
		source_git_head: input.sourceGitHead,
		variant_id: input.variantId,
		...(optionalString(input.itemMetadata.surface_key)
			? { surface_key: optionalString(input.itemMetadata.surface_key) }
			: {}),
	};
}

function agentEvalMetadata(input: {
	agentEvalCaseResultsPath: string;
	caseId: string;
	datasetVersion: string;
	itemMetadata: JsonObject;
	schemaVersion: string;
	sourceGitHead: string;
	variantId: string;
	verdict: string;
}): JsonObject {
	assertNoForbiddenLangfuseMetadata(input.itemMetadata, `${input.caseId}.metadata`);
	return {
		case_family: optionalString(input.itemMetadata.case_family) ?? "agent_eval",
		case_id: input.caseId,
		dataset_version: input.datasetVersion,
		eval_kind: "agent_eval",
		schema_version: input.schemaVersion,
		source_artifact_path: input.agentEvalCaseResultsPath,
		source_git_head: input.sourceGitHead,
		variant_id: input.variantId,
		verdict: input.verdict,
		...(optionalString(input.itemMetadata.surface_key)
			? { surface_key: optionalString(input.itemMetadata.surface_key) }
			: {}),
	};
}

function assertNoForbiddenLangfuseMetadata(metadata: JsonObject, prefix: string): void {
	for (const key of Object.keys(metadata)) {
		const normalized = key.trim();
		if (FORBIDDEN_METADATA_KEYS.has(normalized.toLowerCase())) {
			throw new Error(`${prefix}.${normalized} is forbidden Langfuse metadata`);
		}
	}
}

function resolveRagasSurfaceKey(items: JsonObject[]): string {
	for (const item of items) {
		const metadata = mappingOrNull(item.metadata) ? item.metadata : {};
		const surfaceKey = optionalString(metadata.surface_key);
		if (surfaceKey) {
			return surfaceKey;
		}
	}
	return "ragas";
}

function resolveContextFollowupSurfaceKey(items: JsonObject[]): string {
	for (const item of items) {
		const metadata = mappingOrNull(item.metadata) ? item.metadata : {};
		const surfaceKey = optionalString(metadata.surface_key);
		if (surfaceKey) {
			return surfaceKey;
		}
	}
	return "app-api.chat";
}

function resolveAgentEvalSurfaceKey(items: JsonObject[]): string {
	for (const item of items) {
		const metadata = mappingOrNull(item.metadata) ? item.metadata : {};
		const surfaceKey = optionalString(metadata.surface_key);
		if (surfaceKey) {
			return surfaceKey;
		}
	}
	return "app-api.chat";
}

function integerField(value: unknown, field: string): number {
	if (typeof value !== "number" || !Number.isInteger(value)) {
		throw new Error(`${field} must be an integer`);
	}
	return value;
}

function mappingOrNull(value: unknown): value is JsonObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
