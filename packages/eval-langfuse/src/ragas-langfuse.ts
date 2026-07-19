import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createLangfuseEvalClient } from "./langfuse-client";
import { buildLangfuseScoresFromRagasScoreBatch, publishLangfuseScores } from "./score-publisher";
import {
	isRecord,
	type JsonObject,
	type LangfuseSettings,
	loadJsonObject,
	mapping,
	mappingList,
	optionalString,
	stableId,
	stringField,
	stringList,
	writeJsonObject,
} from "./shared";

export interface RagasLangfusePipelineInput {
	environment: string;
	fetchImpl?: typeof fetch;
	limit?: number;
	release?: string | null;
	runPythonRagasScoreBatch: (input: { inputPath: string; outputPath: string }) => void;
	settings: LangfuseSettings;
	tag?: string[];
	traceName?: string;
	validateOnly?: boolean;
}

export async function runRagasTraceScoring(input: RagasLangfusePipelineInput): Promise<JsonObject> {
	const langfuse = createLangfuseEvalClient({
		fetchImpl: input.fetchImpl,
		settings: input.settings,
	});
	const traces = await langfuse.listTraces({
		limit: input.limit ?? 50,
		name: input.traceName,
		release: input.release ?? undefined,
		tags: input.tag?.join(","),
	});
	return runRagasPipeline({
		environment: input.environment,
		fetchImpl: input.fetchImpl,
		runPythonRagasScoreBatch: input.runPythonRagasScoreBatch,
		sampleItems: traces
			.slice(0, input.limit ?? traces.length)
			.map((trace) => ragasSampleFromTrace(trace)),
		settings: input.settings,
		sourceKind: "langfuse_trace",
		validateOnly: input.validateOnly,
	});
}

export async function runRagasDatasetScoring(
	input: RagasLangfusePipelineInput & { datasetName: string; datasetVersion?: string | null },
): Promise<JsonObject> {
	const langfuse = createLangfuseEvalClient({
		fetchImpl: input.fetchImpl,
		settings: input.settings,
	});
	const dataset = await langfuse.getDataset(input.datasetName, {
		version: input.datasetVersion ?? undefined,
	});
	const items = mappingList(dataset.items ?? [], "dataset.items");
	const sampleItems = await Promise.all(
		items
			.slice(0, input.limit ?? items.length)
			.map((item) => ragasSampleFromDatasetItem(item, input.datasetName, langfuse)),
	);
	return runRagasPipeline({
		environment: input.environment,
		fetchImpl: input.fetchImpl,
		runPythonRagasScoreBatch: input.runPythonRagasScoreBatch,
		sampleItems,
		settings: input.settings,
		sourceKind: "langfuse_dataset",
		validateOnly: input.validateOnly,
	});
}

async function runRagasPipeline(input: {
	environment: string;
	fetchImpl?: typeof fetch;
	runPythonRagasScoreBatch: RagasLangfusePipelineInput["runPythonRagasScoreBatch"];
	sampleItems: JsonObject[];
	settings: LangfuseSettings;
	sourceKind: string;
	validateOnly?: boolean;
}): Promise<JsonObject> {
	const evalRunId = stableId("ragas", input.sourceKind, Date.now());
	const workDir = mkdtempSync(join(tmpdir(), "campus-ragas-langfuse-"));
	const sampleBatchPath = join(workDir, "ragas-samples.json");
	const scoreBatchPath = join(workDir, "ragas-scores.json");
	try {
		writeJsonObject(sampleBatchPath, {
			eval_run_id: evalRunId,
			items: input.sampleItems,
			schema_version: "ragas_sample_batch.v1",
		});
		input.runPythonRagasScoreBatch({
			inputPath: sampleBatchPath,
			outputPath: scoreBatchPath,
		});
		const scorePlan = buildLangfuseScoresFromRagasScoreBatch({
			ragasScoreBatchPath: scoreBatchPath,
			ragasScoreBatchPayload: loadJsonObject(scoreBatchPath),
			sourceKind: input.sourceKind,
		});
		const publish = await publishLangfuseScores({
			evalRunId: scorePlan.evalRunId,
			fetchImpl: input.fetchImpl,
			omittedItems: scorePlan.omittedItems,
			scoreItems: scorePlan.scoreItems,
			settings: input.settings,
			sourceResultDenominator: scorePlan.sourceResultDenominator,
			validateOnly: input.validateOnly,
		});
		return {
			...publish,
			sample_count: input.sampleItems.length,
			source_kind: input.sourceKind,
		};
	} finally {
		rmSync(workDir, { force: true, recursive: true });
	}
}

function ragasSampleFromTrace(trace: JsonObject): JsonObject {
	const traceId = stringField(trace.id, "trace.id");
	const evalFields = evalFieldsFrom(trace);
	const observation = firstRagasObservation(trace);
	const observationFields = observation ? evalFieldsFrom(observation) : {};
	const merged = { ...evalFields, ...observationFields };
	return buildRagasSample({
		caseId: optionalString(merged.case_id) ?? traceId,
		datasetItemId: optionalString(merged.dataset_item_id),
		observationId: optionalString(observation?.id),
		payload: merged,
		traceId,
	});
}

async function ragasSampleFromDatasetItem(
	item: JsonObject,
	datasetName: string,
	langfuse: ReturnType<typeof createLangfuseEvalClient>,
): Promise<JsonObject> {
	const input = mapping(item.input ?? {}, "dataset.item.input");
	const expected = isRecord(item.expectedOutput) ? item.expectedOutput : {};
	const metadata = isRecord(item.metadata) ? item.metadata : {};
	const itemId = stringField(item.id, "item.id");
	const traceId =
		optionalString(metadata.trace_id) ??
		optionalString(input.trace_id) ??
		optionalString(expected.trace_id);
	const traceFields = traceId
		? await ragasEvalFieldsFromTrace({
				langfuse,
				observationId:
					optionalString(metadata.observation_id) ??
					optionalString(input.observation_id) ??
					optionalString(expected.observation_id),
				traceId,
			})
		: {};
	const payload: JsonObject = {
		...traceFields,
		...input,
		...expected,
		...metadata,
		dataset_name: datasetName,
	};
	const requiredTraceId = requiredMaterializedTraceId(itemId, payload, traceId);
	return buildRagasSample({
		caseId: optionalString(metadata.case_id) ?? optionalString(input.case_id) ?? itemId,
		datasetRunId: optionalString(metadata.dataset_run_id),
		datasetItemId: optionalString(item.id),
		observationId: optionalString(payload.observation_id),
		payload,
		traceId: requiredTraceId,
	});
}

async function ragasEvalFieldsFromTrace(input: {
	langfuse: ReturnType<typeof createLangfuseEvalClient>;
	observationId?: string | null;
	traceId: string;
}): Promise<JsonObject> {
	const trace = await input.langfuse.getTrace(input.traceId, { observations: true });
	const traceFields = evalFieldsFrom(trace);
	const observation = ragasObservation(trace, input.observationId);
	if (input.observationId && !observation) {
		throw new Error(
			`${input.traceId}.${input.observationId} is not materialized for Ragas scoring; missing observation_id.`,
		);
	}
	const observationFields = observation ? evalFieldsFrom(observation) : {};
	return {
		...traceFields,
		...observationFields,
		...(observation ? { observation_id: optionalString(observation.id) } : {}),
	};
}

function buildRagasSample(input: {
	caseId: string;
	datasetRunId?: string | null;
	datasetItemId?: string | null;
	observationId?: string | null;
	payload: JsonObject;
	traceId: string;
}): JsonObject {
	assertMaterializedRagasPayload(input.caseId, input.payload);
	const sample: JsonObject = {
		answer: stringField(input.payload.answer, `${input.caseId}.answer`),
		case_id: input.caseId,
		contexts: requiredStringList(input.payload.retrieved_contexts, `${input.caseId}.contexts`),
		question: stringField(
			input.payload.question ?? input.payload.user_input,
			`${input.caseId}.question`,
		),
		trace_id: input.traceId,
	};
	const optionalFields = {
		dataset_run_id: input.datasetRunId,
		dataset_item_id: input.datasetItemId,
		observation_id: input.observationId,
		reference: optionalString(input.payload.reference),
	};
	for (const [key, value] of Object.entries(optionalFields)) {
		if (value) {
			sample[key] = value;
		}
	}
	for (const field of ["retrieved_context_ids", "reference_context_ids", "reference_contexts"]) {
		const values = stringList(input.payload[field]);
		if (values.length > 0) {
			sample[field] = values;
		}
	}
	sample.metadata = safeMetadata(input.payload);
	return sample;
}

function firstRagasObservation(trace: JsonObject): JsonObject | null {
	return ragasObservation(trace, null);
}

function ragasObservation(trace: JsonObject, observationId?: string | null): JsonObject | null {
	for (const observation of mappingList(trace.observations ?? [], "trace.observations")) {
		if (observationId && optionalString(observation.id) !== observationId) {
			continue;
		}
		const fields = evalFieldsFrom(observation);
		if (optionalString(fields.question) || optionalString(fields.answer)) {
			return observation;
		}
	}
	return null;
}

function assertMaterializedRagasPayload(caseId: string, payload: JsonObject): void {
	const missing: string[] = [];
	if (!optionalString(payload.answer)) {
		missing.push("answer");
	}
	if (stringList(payload.retrieved_contexts).length === 0) {
		missing.push("retrieved_contexts");
	}
	if (!(optionalString(payload.question) || optionalString(payload.user_input))) {
		missing.push("question");
	}
	if (missing.length > 0) {
		throw new Error(materializedRagasInputError(caseId, missing));
	}
}

function requiredMaterializedTraceId(
	itemId: string,
	payload: JsonObject,
	traceId: string | null,
): string {
	const caseId =
		optionalString(payload.case_id) ?? optionalString(payload.dataset_item_id) ?? itemId;
	const missing: string[] = [];
	if (!traceId) {
		missing.push("trace_id");
	}
	if (!optionalString(payload.answer)) {
		missing.push("answer");
	}
	if (stringList(payload.retrieved_contexts).length === 0) {
		missing.push("retrieved_contexts");
	}
	if (!(optionalString(payload.question) || optionalString(payload.user_input))) {
		missing.push("question");
	}
	if (missing.length > 0) {
		throw new Error(materializedRagasInputError(caseId, missing));
	}
	return stringField(traceId, `${itemId}.trace_id`);
}

function materializedRagasInputError(caseId: string, missing: string[]): string {
	return `${caseId} is not materialized for Ragas scoring; missing ${missing.join(
		", ",
	)}. Run the Langfuse dataset item through the instrumented agent first, then attach a trace/observation with safe eval.answer and eval.retrieved_contexts before running ragas-score-dataset.`;
}

function evalFieldsFrom(value: JsonObject): JsonObject {
	const metadata = isRecord(value.metadata) ? value.metadata : {};
	const direct = isRecord(value.eval) ? value.eval : {};
	const output: JsonObject = {};
	for (const [key, raw] of Object.entries({ ...metadata, ...direct })) {
		if (key.startsWith("eval.")) {
			output[key.slice("eval.".length)] = raw;
		} else if (key in SAFE_EVAL_FIELD_NAMES) {
			output[key] = raw;
		}
	}
	assertNoForbiddenFields(output);
	return output;
}

function safeMetadata(payload: JsonObject): JsonObject {
	const metadata: JsonObject = {};
	for (const key of ["surface_key", "variant_id", "dataset_version"]) {
		const value = optionalString(payload[key]);
		if (value) {
			metadata[key] = value;
		}
	}
	return metadata;
}

function requiredStringList(value: unknown, field: string): string[] {
	const items = stringList(value);
	if (items.length === 0) {
		throw new Error(`${field} must include at least one string`);
	}
	return items;
}

function assertNoForbiddenFields(value: unknown): void {
	if (Array.isArray(value)) {
		for (const item of value) {
			assertNoForbiddenFields(item);
		}
		return;
	}
	if (!isRecord(value)) {
		return;
	}
	for (const [key, child] of Object.entries(value)) {
		if (FORBIDDEN_EVAL_FIELD_NAMES.has(key.toLowerCase())) {
			throw new Error(`${key} is forbidden in Ragas Langfuse projection`);
		}
		assertNoForbiddenFields(child);
	}
}

const SAFE_EVAL_FIELD_NAMES: Record<string, true> = {
	answer: true,
	case_id: true,
	dataset_item_id: true,
	dataset_version: true,
	metric_applicability: true,
	question: true,
	reference: true,
	reference_context_ids: true,
	reference_contexts: true,
	retrieved_context_ids: true,
	retrieved_contexts: true,
	surface_key: true,
	user_input: true,
	variant_id: true,
};

const FORBIDDEN_EVAL_FIELD_NAMES = new Set([
	"api_key",
	"authorization",
	"cookie",
	"database_url",
	"jwt",
	"object_store_secret",
	"provider_raw_response",
	"raw_answer",
	"raw_chat_transcript",
	"raw_prompt",
	"raw_provider_response",
	"raw_retrieved_snippet",
	"raw_trace",
	"source_body",
	"transcript",
]);
