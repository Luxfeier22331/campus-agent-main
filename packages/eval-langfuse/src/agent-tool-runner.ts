import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	type AgentToolEvalArgumentMode,
	type AgentToolEvalCase,
	type AgentToolEvalToolCall,
	validateAgentToolEvalDataset,
} from "./agent-tool-eval";
import {
	type ExecutionRunEvalProjection,
	parseExecutionRunEvalProjection,
} from "./execution-projection";
import { createLangfuseEvalClient } from "./langfuse-client";
import {
	buildLangfuseScoresFromRagasAgentScoreBatch,
	buildLangfuseScoresFromRagasScoreBatch,
	type LangfuseScoreItem,
	publishLangfuseScores,
} from "./score-publisher";
import {
	type JsonObject,
	type LangfuseSettings,
	loadJsonObject,
	mapping,
	optionalString,
	stableId,
	stringField,
	writeJsonObject,
} from "./shared";
import type { ToolTrajectory } from "./tool-trajectory";
import { deriveLangfuseTraceId } from "./trace";

interface ProductStreamEvent {
	data: JsonObject;
	event: string;
}

interface TerminalAnswer {
	answerText: string;
	conversationId: string;
	requestId: string;
	resultKind: string;
	runId: string | null;
	traceId: string;
}

export interface AgentToolEvalInput {
	appApiBaseUrl: string;
	cookieHeader?: string | null;
	datasetName: string;
	datasetVersion?: string | null;
	dryRun?: boolean;
	environment: string;
	fetchImpl?: typeof fetch;
	limit?: number;
	runPythonRagasAgentScoreBatch: (input: { inputPath: string; outputPath: string }) => void;
	runPythonRagasScoreBatch: (input: { inputPath: string; outputPath: string }) => void;
	settings: LangfuseSettings;
	stagingSmokeAuthSecret?: string | null;
	stagingSmokeEmail?: string | null;
	validateOnly?: boolean;
}

export async function runAgentToolEval(input: AgentToolEvalInput): Promise<JsonObject> {
	const fetchImpl = input.fetchImpl ?? fetch;
	const appApiBaseUrl = input.appApiBaseUrl.replace(/\/+$/u, "");
	const langfuse = createLangfuseEvalClient({
		fetchImpl,
		settings: input.settings,
	});
	const dataset = await langfuse.getDataset(input.datasetName, {
		version: input.datasetVersion ?? undefined,
	});
	const validation = validateAgentToolEvalDataset(dataset);
	const cases = validation.cases.slice(0, input.limit ?? validation.cases.length);
	const cookieHeader =
		optionalString(input.cookieHeader) ??
		(await mintCookieIfRequested({
			baseUrl: appApiBaseUrl,
			fetchImpl,
			smokeAuthSecret: input.stagingSmokeAuthSecret,
			smokeEmail: input.stagingSmokeEmail,
		}));
	const evalRunId = stableId("agent-tool-eval", input.environment, randomUUID());
	const agentSampleItems: JsonObject[] = [];
	const ragSampleItems: JsonObject[] = [];
	const deterministicScoreItems: LangfuseScoreItem[] = [];

	for (const item of cases) {
		let conversationId: string | undefined;
		for (const setupTurn of item.setup_turns) {
			const setupTerminal = await submitChatStream({
				baseUrl: appApiBaseUrl,
				conversationId,
				cookieHeader,
				fetchImpl,
				prompt: setupTurn,
			});
			conversationId = setupTerminal.conversationId;
		}
		const terminal = await submitChatStream({
			baseUrl: appApiBaseUrl,
			conversationId,
			cookieHeader,
			fetchImpl,
			prompt: item.query,
		});
		const projection = await fetchExecutionProjection({
			baseUrl: appApiBaseUrl,
			cookieHeader,
			fetchImpl,
			runId: terminal.runId,
			terminal,
		});
		const langfuseTraceId = await deriveLangfuseTraceId(terminal.traceId);
		const datasetRunItem = await langfuse.createDatasetRunItem({
			datasetItemId: item.dataset_item_id,
			...(input.datasetVersion ? { datasetVersion: input.datasetVersion } : {}),
			runName: evalRunId,
			traceId: langfuseTraceId,
		});
		const datasetRunId = datasetRunIdentity({
			datasetItemId: item.dataset_item_id,
			langfuseTraceId,
			payload: datasetRunItem,
		});
		agentSampleItems.push(
			agentRagasSample({
				datasetRunId,
				item,
				langfuseTraceId,
				terminal,
				trajectory: projection.toolTrajectory,
			}),
		);
		const ragSample = ragRagasSample({
			datasetRunId,
			item,
			langfuseTraceId,
			projection,
			terminal,
		});
		if (ragSample) {
			ragSampleItems.push(ragSample);
		}
		deterministicScoreItems.push(
			...deterministicScores({
				datasetRunId,
				evalRunId,
				item,
				langfuseTraceId,
				projection,
				terminal,
			}),
		);
	}

	const workDir = mkdtempSync(join(tmpdir(), "campus-agent-tool-eval-"));
	const agentSampleBatchPath = join(workDir, "ragas-agent-samples.json");
	const agentScoreBatchPath = join(workDir, "ragas-agent-scores.json");
	const ragSampleBatchPath = join(workDir, "ragas-samples.json");
	const ragScoreBatchPath = join(workDir, "ragas-scores.json");
	try {
		writeJsonObject(agentSampleBatchPath, {
			eval_run_id: evalRunId,
			items: agentSampleItems,
			schema_version: "ragas_agent_sample_batch.v1",
		});
		input.runPythonRagasAgentScoreBatch({
			inputPath: agentSampleBatchPath,
			outputPath: agentScoreBatchPath,
		});
		const agentScorePlan = buildLangfuseScoresFromRagasAgentScoreBatch({
			ragasAgentScoreBatchPath: agentScoreBatchPath,
			ragasAgentScoreBatchPayload: loadJsonObject(agentScoreBatchPath),
			sourceKind: "langfuse_dataset",
		});
		assertEvalRunId(agentScorePlan.evalRunId, evalRunId, "Ragas agent score batch");
		const scoreItems = [...agentScorePlan.scoreItems, ...deterministicScoreItems];
		const omittedItems = [...agentScorePlan.omittedItems];
		let sourceResultDenominator =
			agentScorePlan.sourceResultDenominator + deterministicScoreItems.length;
		if (ragSampleItems.length > 0) {
			writeJsonObject(ragSampleBatchPath, {
				eval_run_id: evalRunId,
				items: ragSampleItems,
				schema_version: "ragas_sample_batch.v1",
			});
			input.runPythonRagasScoreBatch({
				inputPath: ragSampleBatchPath,
				outputPath: ragScoreBatchPath,
			});
			const ragScorePlan = buildLangfuseScoresFromRagasScoreBatch({
				ragasScoreBatchPath: ragScoreBatchPath,
				ragasScoreBatchPayload: loadJsonObject(ragScoreBatchPath),
				sourceKind: "langfuse_dataset",
			});
			assertEvalRunId(ragScorePlan.evalRunId, evalRunId, "Ragas score batch");
			scoreItems.push(...ragScorePlan.scoreItems);
			omittedItems.push(...ragScorePlan.omittedItems);
			sourceResultDenominator += ragScorePlan.sourceResultDenominator;
		}
		const publish = await publishLangfuseScores({
			dryRun: input.dryRun,
			evalRunId,
			fetchImpl,
			omittedItems,
			scoreItems,
			settings: input.settings,
			sourceResultDenominator,
			validateOnly: input.validateOnly,
		});
		return {
			...publish,
			agent_sample_count: agentSampleItems.length,
			case_count: cases.length,
			dataset_name: input.datasetName,
			environment: input.environment,
			rag_sample_count: ragSampleItems.length,
			schema_version: "agent_tool_eval_run.v1",
			source_kind: "langfuse_dataset",
		};
	} finally {
		rmSync(workDir, { force: true, recursive: true });
	}
}

function agentRagasSample(input: {
	datasetRunId: string;
	item: AgentToolEvalCase;
	langfuseTraceId: string;
	terminal: TerminalAnswer;
	trajectory: ToolTrajectory;
}): JsonObject {
	return {
		answer: input.terminal.answerText,
		argument_mode: input.item.argument_mode,
		case_id: input.item.case_id,
		dataset_item_id: input.item.dataset_item_id,
		dataset_run_id: input.datasetRunId,
		metadata: {
			argument_mode: input.item.argument_mode,
			...(input.item.case_family ? { case_family: input.item.case_family } : {}),
			surface_key: input.item.surface_key ?? input.trajectory.surface ?? "app-api.chat",
		},
		query: input.item.query,
		reference: input.item.reference,
		reference_tool_calls: toolCallsForArgumentMode(
			input.item.reference_tool_calls,
			input.item.argument_mode,
		),
		tool_calls: observedToolCalls(input.trajectory, input.item.argument_mode),
		trace_id: input.langfuseTraceId,
	};
}

function ragRagasSample(input: {
	datasetRunId: string;
	item: AgentToolEvalCase;
	langfuseTraceId: string;
	projection: ExecutionRunEvalProjection;
	terminal: TerminalAnswer;
}): JsonObject | null {
	if (input.projection.retrievedContexts.length === 0) {
		return null;
	}
	return {
		answer: input.projection.answer ?? input.terminal.answerText,
		case_id: input.item.case_id,
		contexts: input.projection.retrievedContexts,
		dataset_item_id: input.item.dataset_item_id,
		dataset_run_id: input.datasetRunId,
		metadata: {
			surface_key:
				input.item.surface_key ?? input.projection.toolTrajectory.surface ?? "app-api.chat",
		},
		question: input.item.query,
		reference: input.item.reference,
		reference_context_ids: input.item.reference_context_ids,
		reference_contexts: input.item.reference_contexts,
		retrieved_context_ids: input.projection.retrievedContextIds,
		trace_id: input.langfuseTraceId,
	};
}

function deterministicScores(input: {
	datasetRunId: string;
	evalRunId: string;
	item: AgentToolEvalCase;
	langfuseTraceId: string;
	projection: ExecutionRunEvalProjection;
	terminal: TerminalAnswer;
}): LangfuseScoreItem[] {
	const scores: LangfuseScoreItem[] = [];
	if (input.item.expected_outcome) {
		const passed = input.terminal.resultKind === input.item.expected_outcome;
		scores.push(
			booleanScore({
				caseItem: input.item,
				datasetRunId: input.datasetRunId,
				evalKind: "execution",
				evalRunId: input.evalRunId,
				langfuseTraceId: input.langfuseTraceId,
				name: "execution.outcome_match",
				passed,
			}),
		);
	}
	if (input.item.expected_grounding_mode) {
		scores.push(
			booleanScore({
				caseItem: input.item,
				datasetRunId: input.datasetRunId,
				evalKind: "routing",
				evalRunId: input.evalRunId,
				langfuseTraceId: input.langfuseTraceId,
				name: "routing.grounding_mode_match",
				passed: input.projection.groundingMode === input.item.expected_grounding_mode,
			}),
		);
	}
	if (input.item.forbidden_context_ids.length > 0) {
		const retrieved = new Set(input.projection.retrievedContextIds);
		const passed = input.item.forbidden_context_ids.every((contextId) => !retrieved.has(contextId));
		scores.push(
			booleanScore({
				caseItem: input.item,
				datasetRunId: input.datasetRunId,
				evalKind: "retrieval",
				evalRunId: input.evalRunId,
				langfuseTraceId: input.langfuseTraceId,
				name: "retrieval.forbidden_context_absent",
				passed,
			}),
		);
	}
	return scores;
}

function booleanScore(input: {
	caseItem: AgentToolEvalCase;
	datasetRunId: string;
	evalKind: string;
	evalRunId: string;
	langfuseTraceId: string;
	name: string;
	passed: boolean;
}): LangfuseScoreItem {
	return {
		case_id: input.caseItem.case_id,
		comment: input.passed ? "dataset expectation matched" : "dataset expectation did not match",
		data_type: "BOOLEAN",
		dataset_item_id: input.caseItem.dataset_item_id,
		dataset_run_id: input.datasetRunId,
		idempotency_key: stableId("lfscore", input.evalRunId, input.caseItem.case_id, input.name),
		metadata: {
			case_id: input.caseItem.case_id,
			eval_kind: input.evalKind,
			metric_key: input.name,
			source_kind: "langfuse_dataset",
			surface_key: input.caseItem.surface_key ?? "app-api.chat",
			verdict: input.passed ? "pass" : "fail",
		},
		name: input.name,
		trace_id: input.langfuseTraceId,
		value: input.passed ? 1 : 0,
	};
}

function datasetRunIdentity(input: {
	datasetItemId: string;
	langfuseTraceId: string;
	payload: JsonObject;
}): string {
	if (
		stringField(input.payload.datasetItemId, "dataset run item.datasetItemId") !==
		input.datasetItemId
	) {
		throw new Error("dataset run item datasetItemId does not match the evaluated case");
	}
	if (stringField(input.payload.traceId, "dataset run item.traceId") !== input.langfuseTraceId) {
		throw new Error("dataset run item traceId does not match the product trace");
	}
	return stringField(input.payload.datasetRunId, "dataset run item.datasetRunId");
}

function assertEvalRunId(actual: string, expected: string, source: string): void {
	if (actual !== expected) {
		throw new Error(`${source} eval_run_id does not match the product eval run`);
	}
}

function observedToolCalls(
	trajectory: ToolTrajectory,
	argumentMode: AgentToolEvalArgumentMode,
): AgentToolEvalToolCall[] {
	return trajectory.tool_calls.map((call) => ({
		args: argumentMode === "eval_safe_args" ? { ...(call.eval_safe_args ?? {}) } : {},
		name: call.tool_name,
	}));
}

function toolCallsForArgumentMode(
	toolCalls: AgentToolEvalToolCall[],
	argumentMode: AgentToolEvalArgumentMode,
): AgentToolEvalToolCall[] {
	return toolCalls.map((call) => ({
		args: argumentMode === "eval_safe_args" ? { ...call.args } : {},
		name: call.name,
	}));
}

async function mintCookieIfRequested(input: {
	baseUrl: string;
	fetchImpl: typeof fetch;
	smokeAuthSecret?: string | null;
	smokeEmail?: string | null;
}): Promise<string> {
	const secret = optionalString(input.smokeAuthSecret);
	if (!secret) {
		throw new Error("cookie-header or staging-smoke-auth-secret is required");
	}
	const email = optionalString(input.smokeEmail) ?? "agent-tool-eval@muc.wiki";
	const response = await input.fetchImpl(
		new URL("/api/internal/staging-smoke/auth/session", input.baseUrl),
		{
			body: JSON.stringify({
				email,
				name: "Agent Tool Eval",
				password: `EvalPass!${randomUUID()}`,
				resetIdentity: true,
			}),
			headers: {
				accept: "application/json",
				"content-type": "application/json",
				"x-app-staging-smoke-auth": secret,
			},
			method: "POST",
			signal: AbortSignal.timeout(30_000),
		},
	);
	if (!response.ok) {
		throw new Error(
			`staging smoke session mint failed (${response.status}): ${await response.text()}`,
		);
	}
	const cookie = response.headers.get("set-cookie");
	if (!cookie) {
		throw new Error("staging smoke session mint did not return set-cookie");
	}
	return cookie
		.split(/,(?=\s*[^;,=\s]+=[^;]+)/u)
		.map((item) => item.split(";", 1)[0]?.trim())
		.filter((item): item is string => Boolean(item))
		.join("; ");
}

async function submitChatStream(input: {
	baseUrl: string;
	conversationId?: string;
	cookieHeader: string;
	fetchImpl: typeof fetch;
	prompt: string;
}): Promise<TerminalAnswer> {
	const response = await input.fetchImpl(new URL("/api/chat/requests/stream", input.baseUrl), {
		body: JSON.stringify({
			...(input.conversationId ? { conversationId: input.conversationId } : {}),
			prompt: input.prompt,
		}),
		headers: {
			accept: "text/event-stream",
			"content-type": "application/json",
			cookie: input.cookieHeader,
			"idempotency-key": stableId("agent-tool-eval", input.prompt, randomUUID()),
		},
		method: "POST",
		signal: AbortSignal.timeout(180_000),
	});
	if (!response.ok) {
		throw new Error(`chat stream failed (${response.status}): ${await response.text()}`);
	}
	if (!(response.headers.get("content-type") ?? "").toLowerCase().includes("text/event-stream")) {
		throw new Error("chat stream response must be text/event-stream");
	}

	let acceptedRunId: string | null = null;
	for await (const event of parseSse(response)) {
		if (event.event === "request.accepted") {
			acceptedRunId = optionalString(event.data.runId);
			continue;
		}
		if (event.event === "request.failed" || event.event === "request.cancelled") {
			throw new Error(`chat stream reached ${event.event}: ${JSON.stringify(event.data)}`);
		}
		if (event.event === "request.completed") {
			return terminalAnswer(event, acceptedRunId);
		}
	}
	throw new Error("chat stream ended before request.completed");
}

async function* parseSse(response: Response): AsyncIterable<ProductStreamEvent> {
	if (!response.body) {
		throw new Error("SSE response body is empty");
	}
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	try {
		while (true) {
			const chunk = await reader.read();
			if (chunk.done) {
				break;
			}
			buffer += decoder.decode(chunk.value, { stream: true });
			let boundary = buffer.search(/\r?\n\r?\n/u);
			while (boundary >= 0) {
				const block = buffer.slice(0, boundary);
				const match = buffer.slice(boundary).match(/^\r?\n\r?\n/u);
				buffer = buffer.slice(boundary + (match?.[0].length ?? 2));
				const parsed = parseSseBlock(block);
				if (parsed) {
					yield parsed;
				}
				boundary = buffer.search(/\r?\n\r?\n/u);
			}
		}
		buffer += decoder.decode();
		const parsed = parseSseBlock(buffer.trim());
		if (parsed) {
			yield parsed;
		}
	} finally {
		reader.releaseLock();
	}
}

function parseSseBlock(block: string): ProductStreamEvent | null {
	let event = "";
	const dataLines: string[] = [];
	for (const line of block.split(/\r?\n/u)) {
		if (line.startsWith("event:")) {
			event = line.slice("event:".length).trim();
		}
		if (line.startsWith("data:")) {
			dataLines.push(line.slice("data:".length).trimStart());
		}
	}
	if (!event || dataLines.length === 0) {
		return null;
	}
	const data = JSON.parse(dataLines.join("\n")) as unknown;
	return { data: mapping(data, "sse.data"), event };
}

function terminalAnswer(event: ProductStreamEvent, runId: string | null): TerminalAnswer {
	const answer = mapping(event.data.answer, "request.completed.answer");
	const conversation = mapping(answer.conversation, "request.completed.answer.conversation");
	const result = mapping(answer.result, "request.completed.answer.result");
	return {
		answerText: optionalString(result.text) ?? "",
		conversationId: stringField(conversation.id, "conversation.id"),
		requestId: optionalString(result.requestId) ?? stringField(event.data.requestId, "requestId"),
		resultKind: stringField(result.kind, "result.kind"),
		runId,
		traceId: optionalString(result.traceId) ?? stringField(event.data.traceId, "traceId"),
	};
}

async function fetchExecutionProjection(input: {
	baseUrl: string;
	cookieHeader: string;
	fetchImpl: typeof fetch;
	runId: string | null;
	terminal: TerminalAnswer;
}): Promise<ExecutionRunEvalProjection> {
	const runId = optionalString(input.runId);
	if (!runId) {
		throw new Error("tool trajectory requires request.accepted runId");
	}
	const response = await input.fetchImpl(
		new URL(`/api/chat/runs/${encodeURIComponent(runId)}/steps`, input.baseUrl),
		{
			headers: {
				accept: "application/json",
				cookie: input.cookieHeader,
			},
			method: "GET",
			signal: AbortSignal.timeout(60_000),
		},
	);
	if (!response.ok) {
		throw new Error(`run steps failed (${response.status}): ${await response.text()}`);
	}
	const payload = mapping((await response.json()) as unknown, "run steps payload");
	const projection = parseExecutionRunEvalProjection(payload);
	assertToolTrajectoryMatchesTerminal(projection.toolTrajectory, input.terminal);
	return projection;
}

function assertToolTrajectoryMatchesTerminal(
	trajectory: ToolTrajectory,
	terminal: TerminalAnswer,
): void {
	if (trajectory.run_id !== terminal.runId) {
		throw new Error("tool trajectory run_id does not match accepted runId");
	}
	if (trajectory.request_id !== terminal.requestId) {
		throw new Error("tool trajectory request_id does not match terminal answer");
	}
	if (trajectory.trace_id !== terminal.traceId) {
		throw new Error("tool trajectory trace_id does not match terminal answer");
	}
	if (trajectory.conversation_id && trajectory.conversation_id !== terminal.conversationId) {
		throw new Error("tool trajectory conversation_id does not match terminal answer");
	}
}
