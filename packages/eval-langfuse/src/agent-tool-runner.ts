import { randomUUID } from "node:crypto";

import { loadAgentToolEvalCases } from "./agent-tool-eval";
import {
	type ExecutionRunEvalProjection,
	parseExecutionRunEvalProjection,
} from "./execution-projection";
import { stableId } from "./identifiers";
import { type JsonObject, mapping, optionalString, stringField } from "./json";
import {
	type AgentProductEvalItem,
	type AgentTerminalResult,
	writeAgentProductEvalResult,
} from "./product-result";

interface ProductStreamEvent {
	data: JsonObject;
	event: string;
}

interface ProductRunSummary {
	conversationId: string;
	phase: string;
	requestId: string;
	runId: string;
	status: string;
	traceId: string;
}

interface ProductRunEventPage {
	events: JsonObject[];
	nextSequence: number;
	run: ProductRunSummary;
}

const ACCEPTED_RUN_RECOVERY_TIMEOUT_MS = 180_000;
const ACCEPTED_RUN_RECOVERY_POLL_MS = 500;

export interface AgentToolEvalInput {
	appApiBaseUrl: string;
	casesPath: string;
	cookieHeader: string;
	executionControlAuthSecret: string;
	executionControlBaseUrl: string;
	fetchImpl?: typeof fetch;
	limit?: number;
	outputPath: string;
}

export async function runAgentToolEval(input: AgentToolEvalInput): Promise<JsonObject> {
	const fetchImpl = input.fetchImpl ?? fetch;
	const appApiBaseUrl = input.appApiBaseUrl.replace(/\/+$/u, "");
	const executionControlBaseUrl = input.executionControlBaseUrl.replace(/\/+$/u, "");
	const validation = loadAgentToolEvalCases(input.casesPath);
	const cases = validation.cases.slice(0, input.limit ?? validation.cases.length);
	const cookieHeader = stringField(input.cookieHeader, "cookieHeader");
	const executionControlAuthSecret = stringField(
		input.executionControlAuthSecret,
		"executionControlAuthSecret",
	);
	const evalRunId = stableId("agent-eval", randomUUID());
	const items: AgentProductEvalItem[] = [];

	for (const caseItem of cases) {
		let conversationId: string | undefined;
		for (const setupTurn of caseItem.setup_turns) {
			const setupTerminal = await submitChatStream({
				baseUrl: appApiBaseUrl,
				...(conversationId ? { conversationId } : {}),
				cookieHeader,
				fetchImpl,
				prompt: setupTurn,
			});
			conversationId = setupTerminal.conversationId;
		}
		const terminal = await submitChatStream({
			baseUrl: appApiBaseUrl,
			...(conversationId ? { conversationId } : {}),
			cookieHeader,
			fetchImpl,
			prompt: caseItem.query,
		});
		const projection = await fetchExecutionProjection({
			authSecret: executionControlAuthSecret,
			baseUrl: executionControlBaseUrl,
			fetchImpl,
			runId: terminal.runId,
			terminal,
		});
		items.push({ case: caseItem, projection, terminal });
	}

	writeAgentProductEvalResult(input.outputPath, { evalRunId, items });
	return {
		case_count: items.length,
		eval_run_id: evalRunId,
		output_path: input.outputPath,
	};
}

async function submitChatStream(input: {
	baseUrl: string;
	conversationId?: string;
	cookieHeader: string;
	fetchImpl: typeof fetch;
	prompt: string;
}): Promise<AgentTerminalResult> {
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
	let acceptedRequestId: string | null = null;
	let acceptedTraceId: string | null = null;
	for await (const event of parseSse(response)) {
		if (event.event === "request.accepted") {
			acceptedRunId = optionalString(event.data.runId);
			acceptedRequestId = optionalString(event.data.requestId);
			acceptedTraceId = optionalString(event.data.traceId);
			continue;
		}
		if (event.event === "request.failed" || event.event === "request.cancelled") {
			throw new Error(`chat stream reached ${event.event}: ${JSON.stringify(event.data)}`);
		}
		if (event.event === "request.completed") {
			return terminalAnswer(event, acceptedRunId);
		}
	}
	if (acceptedRunId) {
		return recoverAcceptedRun({
			acceptedRequestId,
			acceptedTraceId,
			baseUrl: input.baseUrl,
			cookieHeader: input.cookieHeader,
			fetchImpl: input.fetchImpl,
			runId: acceptedRunId,
		});
	}
	throw new Error("chat stream ended before request.completed");
}

async function recoverAcceptedRun(input: {
	acceptedRequestId: string | null;
	acceptedTraceId: string | null;
	baseUrl: string;
	cookieHeader: string;
	fetchImpl: typeof fetch;
	runId: string;
}): Promise<AgentTerminalResult> {
	const deadline = Date.now() + ACCEPTED_RUN_RECOVERY_TIMEOUT_MS;
	let afterSequence = 0;
	let lastRun: ProductRunSummary | null = null;
	while (Date.now() < deadline) {
		const page = await fetchProductRunEvents({
			afterSequence,
			baseUrl: input.baseUrl,
			cookieHeader: input.cookieHeader,
			fetchImpl: input.fetchImpl,
			runId: input.runId,
		});
		lastRun = page.run;
		afterSequence = Math.max(afterSequence, page.nextSequence);
		if (isTerminalProductRun(page.run)) {
			const terminal = await fetchConversationTerminal({
				baseUrl: input.baseUrl,
				cookieHeader: input.cookieHeader,
				fetchImpl: input.fetchImpl,
				run: page.run,
			});
			if (terminal) {
				return terminal;
			}
		}
		await waitForAcceptedRunRecovery(ACCEPTED_RUN_RECOVERY_POLL_MS);
	}
	throw new Error(
		`accepted chat run did not reach a terminal product result within ${ACCEPTED_RUN_RECOVERY_TIMEOUT_MS}ms: ${JSON.stringify(
			{
				runId: input.runId,
				requestId: lastRun?.requestId ?? input.acceptedRequestId,
				traceId: lastRun?.traceId ?? input.acceptedTraceId,
				status: lastRun?.status ?? "unknown",
			},
		)}`,
	);
}

async function fetchProductRunEvents(input: {
	afterSequence: number;
	baseUrl: string;
	cookieHeader: string;
	fetchImpl: typeof fetch;
	runId: string;
}): Promise<ProductRunEventPage> {
	const url = new URL(`/api/chat/runs/${encodeURIComponent(input.runId)}/events`, input.baseUrl);
	url.searchParams.set("after_sequence", String(input.afterSequence));
	const response = await input.fetchImpl(url, {
		headers: { accept: "application/json", cookie: input.cookieHeader },
		method: "GET",
		signal: AbortSignal.timeout(30_000),
	});
	if (!response.ok) {
		throw new Error(`run events failed (${response.status}): ${await response.text()}`);
	}
	const payload = mapping((await response.json()) as unknown, "run events response");
	const events = Array.isArray(payload.events)
		? payload.events.filter(
				(event): event is JsonObject =>
					event !== null && typeof event === "object" && !Array.isArray(event),
			)
		: null;
	if (!events) {
		throw new Error("run events response events must be a list");
	}
	const nextSequence = Number(payload.nextSequence);
	if (!Number.isInteger(nextSequence) || nextSequence < 0) {
		throw new Error("run events response nextSequence must be a non-negative integer");
	}
	return {
		events,
		nextSequence,
		run: parseProductRunSummary(payload.run),
	};
}

function parseProductRunSummary(value: unknown): ProductRunSummary {
	const run = mapping(value, "run events response run");
	return {
		conversationId: stringField(run.conversationId, "run.conversationId"),
		phase: stringField(run.phase, "run.phase"),
		requestId: stringField(run.requestId, "run.requestId"),
		runId: stringField(run.runId, "run.runId"),
		status: stringField(run.status, "run.status"),
		traceId: stringField(run.traceId, "run.traceId"),
	};
}

function isTerminalProductRun(run: ProductRunSummary): boolean {
	return (
		["completed", "failed", "canceled", "expired"].includes(run.phase) ||
		["completed", "error", "rejected", "approval_required", "cancelled"].includes(run.status)
	);
}

async function fetchConversationTerminal(input: {
	baseUrl: string;
	cookieHeader: string;
	fetchImpl: typeof fetch;
	run: ProductRunSummary;
}): Promise<AgentTerminalResult | null> {
	const response = await input.fetchImpl(
		new URL(
			`/api/chat/conversations/${encodeURIComponent(input.run.conversationId)}`,
			input.baseUrl,
		),
		{
			headers: { accept: "application/json", cookie: input.cookieHeader },
			method: "GET",
			signal: AbortSignal.timeout(30_000),
		},
	);
	if (!response.ok) {
		throw new Error(`conversation read failed (${response.status}): ${await response.text()}`);
	}
	const payload = mapping((await response.json()) as unknown, "conversation response");
	const conversation = mapping(payload.conversation, "conversation response conversation");
	const messages = Array.isArray(conversation.messages) ? conversation.messages : [];
	const message = messages
		.slice()
		.reverse()
		.map((value) => (value && typeof value === "object" && !Array.isArray(value) ? value : null))
		.find((value) => {
			if (value?.role !== "assistant" || value.runId !== input.run.runId) {
				return false;
			}
			return !input.run.requestId || value.requestId === input.run.requestId;
		});
	if (!message) {
		return null;
	}
	return {
		answer: typeof message.text === "string" ? message.text : "",
		conversationId: input.run.conversationId,
		requestId: input.run.requestId,
		resultKind: stringField(message.kind ?? input.run.status, "assistant message kind"),
		runId: input.run.runId,
		traceId: input.run.traceId,
	};
}

async function waitForAcceptedRunRecovery(delayMs: number): Promise<void> {
	await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
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

function terminalAnswer(event: ProductStreamEvent, runId: string | null): AgentTerminalResult {
	const answer = mapping(event.data.answer, "request.completed.answer");
	const conversation = mapping(answer.conversation, "request.completed.answer.conversation");
	const result = mapping(answer.result, "request.completed.answer.result");
	return {
		answer: typeof result.text === "string" ? result.text : "",
		conversationId: stringField(conversation.id, "conversation.id"),
		requestId: optionalString(result.requestId) ?? stringField(event.data.requestId, "requestId"),
		resultKind: stringField(result.kind, "result.kind"),
		runId: stringField(runId, "request.accepted.runId"),
		traceId: optionalString(result.traceId) ?? stringField(event.data.traceId, "traceId"),
	};
}

async function fetchExecutionProjection(input: {
	authSecret: string;
	baseUrl: string;
	fetchImpl: typeof fetch;
	runId: string;
	terminal: AgentTerminalResult;
}): Promise<ExecutionRunEvalProjection> {
	const response = await input.fetchImpl(
		new URL(`/internal/execution/runs/${encodeURIComponent(input.runId)}/steps`, input.baseUrl),
		{
			headers: {
				accept: "application/json",
				"x-worker-origin-auth": input.authSecret,
			},
			method: "GET",
			signal: AbortSignal.timeout(60_000),
		},
	);
	if (!response.ok) {
		throw new Error(
			`execution projection request failed (${response.status}): ${await response.text()}`,
		);
	}
	const projection = parseExecutionRunEvalProjection((await response.json()) as unknown);
	assertToolTrajectoryMatchesTerminal(projection, input.terminal);
	return projection;
}

function assertToolTrajectoryMatchesTerminal(
	projection: ExecutionRunEvalProjection,
	terminal: AgentTerminalResult,
): void {
	const trajectory = projection.toolTrajectory;
	if (trajectory.run_id !== terminal.runId || projection.runId !== terminal.runId) {
		throw new Error("tool trajectory run_id does not match accepted runId");
	}
	if (trajectory.request_id !== terminal.requestId) {
		throw new Error("tool trajectory request_id does not match terminal answer");
	}
	if (trajectory.trace_id !== terminal.traceId || projection.traceId !== terminal.traceId) {
		throw new Error("tool trajectory trace_id does not match terminal answer");
	}
	if (trajectory.conversation_id && trajectory.conversation_id !== terminal.conversationId) {
		throw new Error("tool trajectory conversation_id does not match terminal answer");
	}
}
