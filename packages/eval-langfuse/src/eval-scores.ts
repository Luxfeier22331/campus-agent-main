import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AgentToolEvalCase, AgentToolEvalToolCall } from "./agent-tool-eval";
import {
	type JsonObject,
	loadJsonObject,
	mapping,
	mappingList,
	stringField,
	writeJsonObject,
} from "./json";
import { type AgentProductEvalItem, loadAgentProductEvalResult } from "./product-result";

export const AGENT_EVAL_SCORE_BATCH_SCHEMA_VERSION = "agent_eval_score_batch.v2";

export interface AgentEvalScoreError extends JsonObject {
	metric_name: string;
	reason: string;
}

export interface AgentEvalScoreItem extends JsonObject {
	case_id: string;
	errors: AgentEvalScoreError[];
	scores: Record<string, number>;
}

export interface AgentEvalScoreBatch {
	items: AgentEvalScoreItem[];
}

export interface ScoreAgentProductResultInput {
	inputPath: string;
	outputPath: string;
	runPythonAgent: (input: { inputPath: string; outputPath: string }) => void;
	runPythonRag: (input: { inputPath: string; outputPath: string }) => void;
}

export function scoreAgentProductResult(input: ScoreAgentProductResultInput): JsonObject {
	const productResult = loadAgentProductEvalResult(input.inputPath);
	const workDir = mkdtempSync(join(tmpdir(), "campus-agent-eval-score-"));
	const agentInputPath = join(workDir, "agent-samples.json");
	const agentOutputPath = join(workDir, "agent-scores.json");
	const ragInputPath = join(workDir, "rag-samples.json");
	const ragOutputPath = join(workDir, "rag-scores.json");
	try {
		writeJsonObject(agentInputPath, {
			items: productResult.items.map(agentRagasSample),
			schema_version: "ragas_agent_sample_batch.v3",
		});
		input.runPythonAgent({ inputPath: agentInputPath, outputPath: agentOutputPath });

		const scoresByCase = new Map<string, Record<string, number>>();
		const errorsByCase = new Map<string, AgentEvalScoreError[]>();
		for (const item of productResult.items) {
			scoresByCase.set(item.case.case_id, deterministicScores(item));
			errorsByCase.set(item.case.case_id, []);
		}
		mergeRagasScoreBatch({
			payload: loadJsonObject(agentOutputPath),
			schemaVersion: "ragas_agent_score_batch.v3",
			expectedCaseIds: new Set(productResult.items.map((item) => item.case.case_id)),
			scoresByCase,
			errorsByCase,
		});

		const ragItems = productResult.items.filter((item) => expectsRetrievedContext(item.case));
		if (ragItems.length > 0) {
			writeJsonObject(ragInputPath, {
				items: ragItems.map(ragRagasSample),
				schema_version: "ragas_sample_batch.v3",
			});
			input.runPythonRag({ inputPath: ragInputPath, outputPath: ragOutputPath });
			mergeRagasScoreBatch({
				payload: loadJsonObject(ragOutputPath),
				schemaVersion: "ragas_score_batch.v3",
				expectedCaseIds: new Set(ragItems.map((item) => item.case.case_id)),
				scoresByCase,
				errorsByCase,
			});
		}

		const outputItems = productResult.items.map((item) => ({
			case_id: item.case.case_id,
			errors: errorsByCase.get(item.case.case_id) ?? [],
			scores: scoresByCase.get(item.case.case_id) ?? {},
		}));
		writeJsonObject(input.outputPath, {
			items: outputItems,
			schema_version: AGENT_EVAL_SCORE_BATCH_SCHEMA_VERSION,
		});
		return {
			case_count: outputItems.length,
			eval_run_id: productResult.evalRunId,
			error_count: outputItems.reduce((total, item) => total + item.errors.length, 0),
			output_path: input.outputPath,
			score_count: outputItems.reduce((total, item) => total + Object.keys(item.scores).length, 0),
		};
	} finally {
		rmSync(workDir, { force: true, recursive: true });
	}
}

export function loadAgentEvalScoreBatch(path: string): AgentEvalScoreBatch {
	const payload = loadJsonObject(path);
	if (payload.schema_version !== AGENT_EVAL_SCORE_BATCH_SCHEMA_VERSION) {
		throw new Error(`score batch schema_version must be ${AGENT_EVAL_SCORE_BATCH_SCHEMA_VERSION}`);
	}
	const seenCaseIds = new Set<string>();
	const items = mappingList(payload.items, "items").map((item, index) => {
		const caseId = stringField(item.case_id, `items[${index}].case_id`);
		if (seenCaseIds.has(caseId)) {
			throw new Error(`score batch case_id is duplicated: ${caseId}`);
		}
		seenCaseIds.add(caseId);
		const rawScores = mapping(item.scores, `${caseId}.scores`);
		const scores = Object.fromEntries(
			Object.entries(rawScores).map(([name, value]) => {
				if (typeof value !== "number" || !Number.isFinite(value)) {
					throw new Error(`${caseId}.scores.${name} must be a finite number`);
				}
				return [stringField(name, `${caseId}.scores.metric`), value];
			}),
		);
		const errors = mappingList(item.errors ?? [], `${caseId}.errors`).map((error) => ({
			metric_name: stringField(error.metric_name, `${caseId}.errors[].metric_name`),
			reason: stringField(error.reason, `${caseId}.errors[].reason`),
		}));
		return { case_id: caseId, errors, scores };
	});
	return { items };
}

function agentRagasSample(item: AgentProductEvalItem): JsonObject {
	return {
		answer: item.answer,
		case_id: item.case.case_id,
		metadata: {
			...(item.case.case_family ? { case_family: item.case.case_family } : {}),
			surface_key: item.case.surface_key ?? "app-api.chat",
		},
		query: item.case.query,
		...(item.case.reference ? { reference: item.case.reference } : {}),
		reference_tool_calls: referenceToolCallNames(item.case.reference_tool_calls),
		tool_calls: observedToolCallNames(item.toolTrajectory.tool_calls),
	};
}

function ragRagasSample(item: AgentProductEvalItem): JsonObject {
	return {
		case_id: item.case.case_id,
		metadata: { surface_key: item.case.surface_key ?? "app-api.chat" },
		...(item.case.reference ? { reference: item.case.reference } : {}),
		response: item.answer,
		cited_contexts: item.citedContexts,
		retrieved_contexts: item.retrievedContexts,
		user_input: item.case.query,
	};
}

function deterministicScores(item: AgentProductEvalItem): Record<string, number> {
	const scores: Record<string, number> = {};
	if (expectsRetrievedContext(item.case)) {
		scores["retrieval.context_present"] = item.retrievedContexts.length > 0 ? 1 : 0;
	}
	if (item.case.forbidden_context_ids.length > 0) {
		const retrieved = new Set(item.retrievedContextIds);
		scores["retrieval.forbidden_context_absent"] = item.case.forbidden_context_ids.every(
			(contextId) => !retrieved.has(contextId),
		)
			? 1
			: 0;
	}
	return scores;
}

function mergeRagasScoreBatch(input: {
	errorsByCase: Map<string, AgentEvalScoreError[]>;
	expectedCaseIds: Set<string>;
	payload: JsonObject;
	schemaVersion: string;
	scoresByCase: Map<string, Record<string, number>>;
}): void {
	if (input.payload.schema_version !== input.schemaVersion) {
		throw new Error(`Ragas score schema_version must be ${input.schemaVersion}`);
	}
	const seenCaseIds = new Set<string>();
	for (const item of mappingList(input.payload.items, "Ragas score items")) {
		const caseId = stringField(item.case_id, "Ragas score item.case_id");
		if (!input.expectedCaseIds.has(caseId)) {
			throw new Error(`Ragas score contains unexpected case_id: ${caseId}`);
		}
		if (seenCaseIds.has(caseId)) {
			throw new Error(`Ragas score contains duplicate case_id: ${caseId}`);
		}
		seenCaseIds.add(caseId);
		const scores = input.scoresByCase.get(caseId);
		const errors = input.errorsByCase.get(caseId);
		if (!(scores && errors)) {
			throw new Error(`Ragas score contains unknown case_id: ${caseId}`);
		}
		for (const [metricName, value] of Object.entries(mapping(item.scores, `${caseId}.scores`))) {
			if (typeof value !== "number" || !Number.isFinite(value)) {
				throw new Error(`${caseId}.${metricName} must be a finite number`);
			}
			if (scores[metricName] !== undefined) {
				throw new Error(`${caseId} contains duplicate metric: ${metricName}`);
			}
			scores[metricName] = value;
		}
		for (const error of mappingList(item.errors ?? [], `${caseId}.errors`)) {
			errors.push({
				metric_name: stringField(error.metric_name, `${caseId}.errors[].metric_name`),
				reason: stringField(error.reason, `${caseId}.errors[].reason`),
			});
		}
	}
	if (seenCaseIds.size !== input.expectedCaseIds.size) {
		const missing = [...input.expectedCaseIds].filter((caseId) => !seenCaseIds.has(caseId));
		throw new Error(`Ragas score is missing case_id: ${missing.join(", ")}`);
	}
}

function expectsRetrievedContext(item: AgentToolEvalCase): boolean {
	return item.reference_context_ids.length > 0 || item.reference_contexts.length > 0;
}

function referenceToolCallNames(toolCalls: AgentToolEvalToolCall[]): AgentToolEvalToolCall[] {
	return toolCalls.map((call) => ({ args: {}, name: call.name }));
}

function observedToolCallNames(
	toolCalls: ReadonlyArray<{ tool_name: AgentToolEvalToolCall["name"] }>,
): AgentToolEvalToolCall[] {
	return toolCalls.map((call) => ({ args: {}, name: call.tool_name }));
}
