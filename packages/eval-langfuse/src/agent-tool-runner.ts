import { randomUUID } from "node:crypto";

import { loadAgentToolEvalCases } from "./agent-tool-eval";
import {
	type ExecutionRunEvalProjection,
	parseExecutionRunEvalProjection,
} from "./execution-projection";
import { type JsonObject, mapping, optionalString, stringField } from "./json";
import { type AgentProductEvalItem, writeAgentProductEvalResult } from "./product-result";

interface ProductStreamEvent {
	data: JsonObject;
	event: string;
}

interface ProductRunSummary {
	conversationId: string;
	phase: string;
	requestId: string;
	status: string;
}

interface AgentTerminalResult {
	answer: string;
	conversationId: string;
	requestId: string;
}

interface ProductRunEventPage {
	events: JsonObject[];
	nextSequence: number;
	run: ProductRunSummary;
}

const PRODUCT_RUN_TIMEOUT_MS = 900_000;
const ACCEPTED_RUN_RECOVERY_TIMEOUT_MS = PRODUCT_RUN_TIMEOUT_MS;
const ACCEPTED_RUN_RECOVERY_POLL_MS = 500;
const EXECUTION_PROJECTION_RECOVERY_TIMEOUT_MS = 30_000;
const EXECUTION_PROJECTION_RECOVERY_POLL_MS = 200;

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
	const evalRunId = `agent-eval:${randomUUID()}`;
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
			requestId: terminal.requestId,
		});
		if (projection.answer !== terminal.answer) {
			throw new Error("execution eval projection answer does not match the product result");
		}
		items.push({ case: caseItem, ...projection });
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
			"idempotency-key": `agent-tool-eval:${randomUUID()}`,
		},
		method: "POST",
		signal: AbortSignal.timeout(PRODUCT_RUN_TIMEOUT_MS),
	});
	if (!response.ok) {
		throw new Error(`chat stream failed (${response.status}): ${await response.text()}`);
	}
	if (!(response.headers.get("content-type") ?? "").toLowerCase().includes("text/event-stream")) {
		throw new Error("chat stream response must be text/event-stream");
	}

	let acceptedRequestId: string | null = null;
	for await (const event of parseSse(response)) {
		if (event.event === "request.accepted") {
			acceptedRequestId = optionalString(event.data.requestId);
			continue;
		}
		if (event.event === "request.failed" || event.event === "request.cancelled") {
			throw new Error(`chat stream reached ${event.event}: ${JSON.stringify(event.data)}`);
		}
		if (event.event === "request.completed") {
			return terminalAnswer(event, acceptedRequestId);
		}
	}
	if (acceptedRequestId) {
		return recoverAcceptedRun({
			baseUrl: input.baseUrl,
			cookieHeader: input.cookieHeader,
			fetchImpl: input.fetchImpl,
			requestId: acceptedRequestId,
		});
	}
	throw new Error("chat stream ended before request.completed");
}

async function recoverAcceptedRun(input: {
	baseUrl: string;
	cookieHeader: string;
	fetchImpl: typeof fetch;
	requestId: string;
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
			requestId: input.requestId,
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
				requestId: lastRun?.requestId ?? input.requestId,
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
	requestId: string;
}): Promise<ProductRunEventPage> {
	const url = new URL(
		`/api/chat/requests/${encodeURIComponent(input.requestId)}/events`,
		input.baseUrl,
	);
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
		status: stringField(run.status, "run.status"),
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
		.find((value) => value?.role === "assistant" && value.requestId === input.run.requestId);
	if (!message) {
		return null;
	}
	return {
		answer: typeof message.text === "string" ? message.text : "",
		conversationId: input.run.conversationId,
		requestId: input.run.requestId,
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

function terminalAnswer(
	event: ProductStreamEvent,
	acceptedRequestId: string | null,
): AgentTerminalResult {
	const answer = mapping(event.data.answer, "request.completed.answer");
	const conversation = mapping(answer.conversation, "request.completed.answer.conversation");
	const result = mapping(answer.result, "request.completed.answer.result");
	const requestId =
		optionalString(result.requestId) ?? stringField(event.data.requestId, "requestId");
	if (acceptedRequestId && acceptedRequestId !== requestId) {
		throw new Error("request.completed requestId does not match request.accepted");
	}
	return {
		answer: typeof result.text === "string" ? result.text : "",
		conversationId: stringField(conversation.id, "conversation.id"),
		requestId,
	};
}

async function fetchExecutionProjection(input: {
	authSecret: string;
	baseUrl: string;
	fetchImpl: typeof fetch;
	requestId: string;
}): Promise<ExecutionRunEvalProjection> {
	const deadline = Date.now() + EXECUTION_PROJECTION_RECOVERY_TIMEOUT_MS;
	while (true) {
		const response = await input.fetchImpl(
			new URL(
				`/internal/execution/requests/${encodeURIComponent(input.requestId)}/steps`,
				input.baseUrl,
			),
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
		const payload = (await response.json()) as unknown;
		if (executionProjectionAnswerReady(payload, input.requestId)) {
			return parseExecutionRunEvalProjection(payload);
		}
		if (Date.now() >= deadline) {
			throw new Error(
				`execution eval projection did not expose a final answer within ${EXECUTION_PROJECTION_RECOVERY_TIMEOUT_MS}ms for ${input.requestId}`,
			);
		}
		await waitForAcceptedRunRecovery(EXECUTION_PROJECTION_RECOVERY_POLL_MS);
	}
}

function executionProjectionAnswerReady(value: unknown, requestId: string): boolean {
	const payload = mapping(value, "run steps payload");
	const projection = mapping(
		payload.agentRuntimeEvalProjection ?? payload.agent_runtime_eval_projection ?? payload,
		"agent runtime eval projection",
	);
	if (projection.schema_version !== "agent_runtime_eval_projection.v5") {
		throw new Error("agent runtime eval projection must use agent_runtime_eval_projection.v5");
	}
	if (
		stringField(projection.request_id, "agent runtime eval projection.request_id") !== requestId
	) {
		throw new Error("execution eval projection request_id does not match the product request");
	}
	return optionalString(projection.answer) !== null;
}
