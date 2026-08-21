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

export interface AgentToolEvalInput {
	appApiBaseUrl: string;
	casesPath: string;
	cookieHeader: string;
	fetchImpl?: typeof fetch;
	limit?: number;
	outputPath: string;
}

export async function runAgentToolEval(input: AgentToolEvalInput): Promise<JsonObject> {
	const fetchImpl = input.fetchImpl ?? fetch;
	const appApiBaseUrl = input.appApiBaseUrl.replace(/\/+$/u, "");
	const validation = loadAgentToolEvalCases(input.casesPath);
	const cases = validation.cases.slice(0, input.limit ?? validation.cases.length);
	const cookieHeader = stringField(input.cookieHeader, "cookieHeader");
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
			baseUrl: appApiBaseUrl,
			cookieHeader,
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
	baseUrl: string;
	cookieHeader: string;
	fetchImpl: typeof fetch;
	runId: string;
	terminal: AgentTerminalResult;
}): Promise<ExecutionRunEvalProjection> {
	const response = await input.fetchImpl(
		new URL(`/api/chat/runs/${encodeURIComponent(input.runId)}/steps`, input.baseUrl),
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
