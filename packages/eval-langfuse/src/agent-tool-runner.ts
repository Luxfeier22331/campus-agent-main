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
import { createLangfuseEvalClient } from "./langfuse-client";
import {
	buildLangfuseScoresFromRagasAgentScoreBatch,
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
import { parseToolTrajectory, type ToolTrajectory } from "./tool-trajectory";

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
	runPythonRagasAgentScoreBatch: (input: {
		inputPath: string;
		outputPath: string;
		runtimeConfigPath?: string;
	}) => void;
	runtimeConfigPath?: string;
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
	const sampleItems: JsonObject[] = [];

	for (const item of cases) {
		const terminal = await submitChatStream({
			baseUrl: appApiBaseUrl,
			cookieHeader,
			fetchImpl,
			prompt: item.query,
		});
		const trajectory = await fetchToolTrajectory({
			baseUrl: appApiBaseUrl,
			cookieHeader,
			fetchImpl,
			runId: terminal.runId,
			terminal,
		});
		sampleItems.push(agentRagasSample({ item, terminal, trajectory }));
	}

	const workDir = mkdtempSync(join(tmpdir(), "campus-agent-tool-eval-"));
	const sampleBatchPath = join(workDir, "ragas-agent-samples.json");
	const scoreBatchPath = join(workDir, "ragas-agent-scores.json");
	try {
		writeJsonObject(sampleBatchPath, {
			eval_run_id: evalRunId,
			items: sampleItems,
			schema_version: "ragas_agent_sample_batch.v1",
		});
		input.runPythonRagasAgentScoreBatch({
			inputPath: sampleBatchPath,
			outputPath: scoreBatchPath,
			runtimeConfigPath: input.runtimeConfigPath,
		});
		const scorePlan = buildLangfuseScoresFromRagasAgentScoreBatch({
			ragasAgentScoreBatchPath: scoreBatchPath,
			ragasAgentScoreBatchPayload: loadJsonObject(scoreBatchPath),
			sourceKind: "langfuse_dataset",
		});
		const publish = await publishLangfuseScores({
			dryRun: input.dryRun,
			evalRunId: scorePlan.evalRunId,
			fetchImpl,
			omittedItems: scorePlan.omittedItems,
			scoreItems: scorePlan.scoreItems,
			settings: input.settings,
			sourceResultDenominator: scorePlan.sourceResultDenominator,
			validateOnly: input.validateOnly,
		});
		return {
			...publish,
			case_count: cases.length,
			dataset_name: input.datasetName,
			environment: input.environment,
			schema_version: "agent_tool_eval_run.v1",
			source_kind: "langfuse_dataset",
		};
	} finally {
		rmSync(workDir, { force: true, recursive: true });
	}
}

function agentRagasSample(input: {
	item: AgentToolEvalCase;
	terminal: TerminalAnswer;
	trajectory: ToolTrajectory;
}): JsonObject {
	return {
		answer: input.terminal.answerText,
		argument_mode: input.item.argument_mode,
		case_id: input.item.case_id,
		dataset_item_id: input.item.dataset_item_id,
		dataset_run_id: input.item.dataset_run_id,
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
		trace_id: input.terminal.traceId,
	};
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
	cookieHeader: string;
	fetchImpl: typeof fetch;
	prompt: string;
}): Promise<TerminalAnswer> {
	const response = await input.fetchImpl(new URL("/api/chat/requests/stream", input.baseUrl), {
		body: JSON.stringify({ prompt: input.prompt }),
		headers: {
			accept: "text/event-stream",
			"content-type": "application/json",
			cookie: input.cookieHeader,
			"idempotency-key": stableId("agent-tool-eval", input.prompt, Date.now()),
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

async function fetchToolTrajectory(input: {
	baseUrl: string;
	cookieHeader: string;
	fetchImpl: typeof fetch;
	runId: string | null;
	terminal: TerminalAnswer;
}): Promise<ToolTrajectory> {
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
	const evalProjection = mapping(
		payload.agentRuntimeEvalProjection,
		"run steps agentRuntimeEvalProjection",
	);
	const trajectory = parseToolTrajectory(evalProjection.tool_trajectory);
	assertToolTrajectoryMatchesTerminal(trajectory, input.terminal);
	return trajectory;
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
