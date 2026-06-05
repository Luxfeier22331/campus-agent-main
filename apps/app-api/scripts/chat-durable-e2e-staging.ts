import process from "node:process";

import {
	DEFAULT_CHAT_E2E_PROMPT,
	DEFAULT_STAGING_CHAT_E2E_APP_API_READYZ_URL,
	DEFAULT_STAGING_CHAT_E2E_CHAT_BASE_URL,
} from "./chat-e2e.args";
import { DEFAULT_SMOKE_EMAIL, DEFAULT_SMOKE_NAME } from "./seed-request-smoke.args";
import { expectJsonResponse, readJsonResponse } from "./smoke-auth-runtime";
import { buildSmokePassword, fetchReadyz, mintStagingSmokeSession } from "./staging-smoke-support";

interface ReadyzProbe {
	payload: unknown;
	status: number;
}

interface ChatDurableE2eArgs {
	appApiReadyzUrl: string;
	chatBaseUrl: string;
	email: string;
	name: string;
	prompt: string;
	smokeAuthSecret: string;
}

interface ProductStreamEvent {
	data: Record<string, unknown>;
	event: string;
}

interface DurableRunEventProjection {
	eventId: string;
	eventType: string;
	occurredAt: string;
	payload: Record<string, unknown>;
	runId: string;
	sequence: number;
	visibility: "browser";
}

interface RuntimeRunSummary {
	conversationId: string;
	requestId: string;
	runId: string;
	status: string;
	terminalReason?: string;
	traceId: string;
}

interface ConversationDetail {
	id: string;
	messages: Array<{
		kind: string | null;
		requestId: string | null;
		role: string;
		text: string;
	}>;
}

interface AcceptedRunIdentity {
	requestId: string;
	runId: string;
	traceId: string;
}

export interface ChatDurableE2eResult {
	conversation: {
		assistantMessageCount: number;
		hasAssistantMessageForRequest: boolean;
		id: string;
		messageCount: number;
	} | null;
	identity: {
		email: string;
		resetViaDeployedRuntime: true;
	};
	passed: boolean;
	principal: unknown | null;
	readyz: {
		appApi: ReadyzProbe | null;
		chat: ReadyzProbe | null;
	};
	resume: {
		afterSequence: number;
		events: DurableRunEventProjection[];
		terminalEvent: DurableRunEventProjection | null;
	};
	run: RuntimeRunSummary | null;
	session: unknown | null;
	sessionMintAttempted: boolean;
	submit: AcceptedRunIdentity | null;
	submitStreamAbortedAfterAccepted: boolean;
}

export interface ChatDurableE2eDependencies {
	abortSubmitStream?: (controller: AbortController) => void;
	fetchJsonWithCookie?: typeof fetchJsonWithCookie;
	fetchReadyz?: (url: string) => Promise<ReadyzProbe>;
	mintSmokeSession?: (input: {
		appApiReadyzUrl: string;
		email: string;
		name?: string;
		password: string;
		resetIdentity?: boolean;
		smokeAuthSecret: string;
	}) => Promise<string>;
	openRunEventStream?: (input: {
		afterSequence: number;
		cookieHeader: string;
		runId: string;
		url: string;
	}) => Promise<Response>;
	openSubmitStream?: (input: {
		body: unknown;
		cookieHeader: string;
		signal: AbortSignal;
		url: string;
	}) => Promise<Response>;
}

function normalizeOptionalValue(value: string | undefined): string | null {
	if (typeof value !== "string") {
		return null;
	}

	const trimmed = value.trim();
	return trimmed ? trimmed : null;
}

function parseArgs(argv: string[], env: NodeJS.ProcessEnv = process.env): ChatDurableE2eArgs {
	let appApiReadyzUrl = DEFAULT_STAGING_CHAT_E2E_APP_API_READYZ_URL;
	let chatBaseUrl = DEFAULT_STAGING_CHAT_E2E_CHAT_BASE_URL;
	let email = DEFAULT_SMOKE_EMAIL;
	let name = DEFAULT_SMOKE_NAME;
	let prompt = DEFAULT_CHAT_E2E_PROMPT;
	let smokeAuthSecret =
		normalizeOptionalValue(env.APP_API_STAGING_SMOKE_AUTH_SECRET) ??
		normalizeOptionalValue(env.STAGING_APP_API_SMOKE_AUTH_SECRET) ??
		"";

	for (let index = 0; index < argv.length; index += 1) {
		const token = argv[index];
		if (token === "--") {
			continue;
		}
		if (token === "--app-api-readyz-url") {
			const value = normalizeOptionalValue(argv[index + 1]);
			if (!value) {
				throw new Error("--app-api-readyz-url requires a non-empty value.");
			}
			appApiReadyzUrl = value;
			index += 1;
			continue;
		}
		if (token === "--chat-base-url") {
			const value = normalizeOptionalValue(argv[index + 1]);
			if (!value) {
				throw new Error("--chat-base-url requires a non-empty value.");
			}
			chatBaseUrl = value;
			index += 1;
			continue;
		}
		if (token === "--email") {
			const value = normalizeOptionalValue(argv[index + 1]);
			if (!value) {
				throw new Error("--email requires a non-empty value.");
			}
			email = value.toLowerCase();
			index += 1;
			continue;
		}
		if (token === "--name") {
			const value = normalizeOptionalValue(argv[index + 1]);
			if (!value) {
				throw new Error("--name requires a non-empty value.");
			}
			name = value;
			index += 1;
			continue;
		}
		if (token === "--prompt") {
			const value = normalizeOptionalValue(argv[index + 1]);
			if (!value) {
				throw new Error("--prompt requires a non-empty value.");
			}
			prompt = value;
			index += 1;
			continue;
		}
		if (token === "--smoke-auth-secret") {
			const value = normalizeOptionalValue(argv[index + 1]);
			if (!value) {
				throw new Error("--smoke-auth-secret requires a non-empty value.");
			}
			smokeAuthSecret = value;
			index += 1;
			continue;
		}

		throw new Error(`Unknown argument: ${token}`);
	}

	if (!smokeAuthSecret) {
		throw new Error(
			"APP_API_STAGING_SMOKE_AUTH_SECRET or STAGING_APP_API_SMOKE_AUTH_SECRET is required.",
		);
	}

	return {
		appApiReadyzUrl,
		chatBaseUrl,
		email,
		name,
		prompt,
		smokeAuthSecret,
	};
}

async function fetchJsonWithCookie<T>(input: {
	body?: unknown;
	cookieHeader: string;
	expectedStatus: number;
	idempotencyKey?: string;
	method?: string;
	url: string;
}): Promise<{ payload: T; response: Response }> {
	const response = await fetch(input.url, {
		body: input.body ? JSON.stringify(input.body) : undefined,
		headers: {
			accept: "application/json",
			...(input.body ? { "content-type": "application/json" } : {}),
			cookie: input.cookieHeader,
			...(input.idempotencyKey ? { "idempotency-key": input.idempotencyKey } : {}),
		},
		method: input.method ?? "GET",
		signal: AbortSignal.timeout(120_000),
	});

	return {
		payload: await expectJsonResponse<T>(response, input.expectedStatus),
		response,
	};
}

async function openSubmitStream(input: {
	body: unknown;
	cookieHeader: string;
	signal: AbortSignal;
	url: string;
}): Promise<Response> {
	const response = await fetch(input.url, {
		body: JSON.stringify(input.body),
		headers: {
			accept: "text/event-stream",
			"content-type": "application/json",
			cookie: input.cookieHeader,
			"idempotency-key": `chat-durable-e2e-staging-${Date.now()}`,
		},
		method: "POST",
		signal: input.signal,
	});
	await expectEventStreamResponse(response, "submit stream");
	return response;
}

async function openRunEventStream(input: {
	afterSequence: number;
	cookieHeader: string;
	runId: string;
	url: string;
}): Promise<Response> {
	const response = await fetch(input.url, {
		headers: {
			accept: "text/event-stream",
			cookie: input.cookieHeader,
		},
		method: "GET",
		signal: AbortSignal.timeout(180_000),
	});
	await expectEventStreamResponse(response, `run event stream for ${input.runId}`);
	return response;
}

async function expectEventStreamResponse(response: Response, label: string): Promise<void> {
	if (response.ok) {
		const contentType = response.headers.get("content-type") ?? "";
		if (!contentType.toLowerCase().includes("text/event-stream")) {
			throw new Error(`${label} returned non-SSE content-type: ${contentType || "missing"}.`);
		}
		return;
	}

	const payload = await readJsonResponse(response);
	throw new Error(`${label} failed (${response.status}): ${JSON.stringify(payload)}`);
}

function parseSseBlock(block: string): ProductStreamEvent | null {
	let event = "";
	const dataLines: string[] = [];

	for (const line of block.split(/\r?\n/)) {
		if (line.startsWith("event:")) {
			event = line.slice("event:".length).trim();
			continue;
		}
		if (line.startsWith("data:")) {
			dataLines.push(line.slice("data:".length).trimStart());
		}
	}

	if (!event || dataLines.length === 0) {
		return null;
	}

	return {
		data: JSON.parse(dataLines.join("\n")) as Record<string, unknown>,
		event,
	};
}

async function* parseSse(response: Response): AsyncIterable<ProductStreamEvent> {
	if (!response.body) {
		throw new Error("SSE response body is empty.");
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
			let boundary = buffer.search(/\r?\n\r?\n/);
			while (boundary >= 0) {
				const block = buffer.slice(0, boundary);
				const match = buffer.slice(boundary).match(/^\r?\n\r?\n/);
				buffer = buffer.slice(boundary + (match?.[0].length ?? 2));
				const parsed = parseSseBlock(block);
				if (parsed) {
					yield parsed;
				}
				boundary = buffer.search(/\r?\n\r?\n/);
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

function requireStringField(value: Record<string, unknown>, field: string): string {
	const raw = value[field];
	if (typeof raw !== "string" || !raw.trim()) {
		throw new Error(`${field} is required.`);
	}
	return raw;
}

function readAcceptedRunIdentity(event: ProductStreamEvent): AcceptedRunIdentity {
	if (event.event !== "request.accepted") {
		throw new Error(
			`Expected request.accepted as the first durable submit event, got ${event.event}.`,
		);
	}
	const requestId = requireStringField(event.data, "requestId");
	const traceId = requireStringField(event.data, "traceId");
	const runId = event.data.runId;
	if (typeof runId !== "string" || !runId.trim()) {
		throw new Error(
			`request.accepted must include a durable run id: ${JSON.stringify(
				summarizeAcceptedEventForDiagnostic(event.data),
			)}`,
		);
	}
	return {
		requestId,
		runId,
		traceId,
	};
}

function summarizeAcceptedEventForDiagnostic(
	data: Record<string, unknown>,
): Record<string, unknown> {
	const summary: Record<string, unknown> = {
		keys: Object.keys(data).sort(),
	};
	for (const key of ["requestId", "status", "traceId", "runPhase"]) {
		const value = data[key];
		if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
			summary[key] = value;
		}
	}
	return summary;
}

function readRunEvent(event: ProductStreamEvent): DurableRunEventProjection {
	const eventId = requireStringField(event.data, "eventId");
	const eventType = requireStringField(event.data, "eventType");
	const occurredAt = requireStringField(event.data, "occurredAt");
	const runId = requireStringField(event.data, "runId");
	const sequenceValue = event.data.sequence;
	const visibility = event.data.visibility;
	const payload = event.data.payload;

	if (typeof sequenceValue !== "number" || !Number.isInteger(sequenceValue) || sequenceValue < 1) {
		throw new Error("durable run event sequence must be a positive integer.");
	}
	if (visibility !== "browser") {
		throw new Error("durable staging e2e only accepts browser-visible run events.");
	}
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
		throw new Error("durable run event payload must be an object.");
	}

	return {
		eventId,
		eventType,
		occurredAt,
		payload: payload as Record<string, unknown>,
		runId,
		sequence: sequenceValue,
		visibility,
	};
}

function isFinalizationCompleted(event: DurableRunEventProjection): boolean {
	return event.eventType === "finalization.completed";
}

function assertRunMatchesAccepted(run: RuntimeRunSummary, accepted: AcceptedRunIdentity): void {
	if (
		run.runId !== accepted.runId ||
		run.requestId !== accepted.requestId ||
		run.traceId !== accepted.traceId
	) {
		throw new Error("durable run status identity does not match request.accepted.");
	}
	if (run.status !== "completed") {
		throw new Error(`Expected durable run status completed, received ${run.status}.`);
	}
	if (!run.conversationId.trim()) {
		throw new Error("durable run status must include conversationId.");
	}
}

function assertFinalEventMatchesAccepted(
	event: DurableRunEventProjection,
	accepted: AcceptedRunIdentity,
): void {
	if (event.runId !== accepted.runId) {
		throw new Error("durable run event runId does not match request.accepted.");
	}
	if (event.payload.request_id !== accepted.requestId) {
		throw new Error("finalization.completed request_id does not match request.accepted.");
	}
	if (event.payload.trace_id !== accepted.traceId) {
		throw new Error("finalization.completed trace_id does not match request.accepted.");
	}
}

async function readAcceptedEvent(input: {
	abortSubmitStream: (controller: AbortController) => void;
	body: unknown;
	cookieHeader: string;
	openSubmitStream: NonNullable<ChatDurableE2eDependencies["openSubmitStream"]>;
	url: string;
}): Promise<{ accepted: AcceptedRunIdentity; aborted: boolean }> {
	const controller = new AbortController();
	const response = await input.openSubmitStream({
		body: input.body,
		cookieHeader: input.cookieHeader,
		signal: controller.signal,
		url: input.url,
	});

	for await (const event of parseSse(response)) {
		const accepted = readAcceptedRunIdentity(event);
		input.abortSubmitStream(controller);
		return {
			accepted,
			aborted: true,
		};
	}

	throw new Error("Submit stream ended before request.accepted.");
}

async function readRunEventsUntilFinalization(input: {
	accepted: AcceptedRunIdentity;
	cookieHeader: string;
	openRunEventStream: NonNullable<ChatDurableE2eDependencies["openRunEventStream"]>;
	url: string;
}): Promise<{ events: DurableRunEventProjection[]; terminalEvent: DurableRunEventProjection }> {
	const response = await input.openRunEventStream({
		afterSequence: 0,
		cookieHeader: input.cookieHeader,
		runId: input.accepted.runId,
		url: input.url,
	});
	let lastSequence = 0;
	const events: DurableRunEventProjection[] = [];

	for await (const rawEvent of parseSse(response)) {
		const event = readRunEvent(rawEvent);
		if (event.runId !== input.accepted.runId) {
			throw new Error("durable run event runId does not match request.accepted.");
		}
		if (event.sequence <= lastSequence) {
			throw new Error("durable run event sequence must strictly advance.");
		}
		lastSequence = event.sequence;
		events.push(event);
		if (isFinalizationCompleted(event)) {
			assertFinalEventMatchesAccepted(event, input.accepted);
			return {
				events,
				terminalEvent: event,
			};
		}
	}

	throw new Error("Run event stream ended before finalization.completed.");
}

function summarizeConversation(
	conversation: ConversationDetail,
	run: RuntimeRunSummary,
): ChatDurableE2eResult["conversation"] {
	if (conversation.id !== run.conversationId) {
		throw new Error("conversation detail id does not match durable run status.");
	}
	const assistantMessages = conversation.messages.filter(
		(message) =>
			message.role === "assistant" &&
			message.kind === "answer" &&
			message.requestId === run.requestId &&
			message.text.trim().length > 0,
	);
	if (assistantMessages.length === 0) {
		throw new Error("conversation is missing an assistant answer message for the durable request.");
	}
	return {
		assistantMessageCount: assistantMessages.length,
		hasAssistantMessageForRequest: true,
		id: conversation.id,
		messageCount: conversation.messages.length,
	};
}

export async function runChatDurableE2eStaging(
	argv: string[],
	env: NodeJS.ProcessEnv = process.env,
	deps: ChatDurableE2eDependencies = {},
): Promise<ChatDurableE2eResult> {
	const args = parseArgs(argv, env);
	const resolvedDeps = {
		abortSubmitStream:
			deps.abortSubmitStream ??
			((controller: AbortController) => {
				controller.abort();
			}),
		fetchJsonWithCookie: deps.fetchJsonWithCookie ?? fetchJsonWithCookie,
		fetchReadyz: deps.fetchReadyz ?? fetchReadyz,
		mintSmokeSession: deps.mintSmokeSession ?? mintStagingSmokeSession,
		openRunEventStream: deps.openRunEventStream ?? openRunEventStream,
		openSubmitStream: deps.openSubmitStream ?? openSubmitStream,
	};

	const result: ChatDurableE2eResult = {
		conversation: null,
		identity: {
			email: args.email,
			resetViaDeployedRuntime: true,
		},
		passed: false,
		principal: null,
		readyz: {
			appApi: null,
			chat: null,
		},
		resume: {
			afterSequence: 0,
			events: [],
			terminalEvent: null,
		},
		run: null,
		session: null,
		sessionMintAttempted: false,
		submit: null,
		submitStreamAbortedAfterAccepted: false,
	};

	result.readyz.appApi = await resolvedDeps.fetchReadyz(args.appApiReadyzUrl);
	result.readyz.chat = await resolvedDeps.fetchReadyz(
		new URL("/readyz", args.chatBaseUrl).toString(),
	);

	const smokePassword = buildSmokePassword();
	result.sessionMintAttempted = true;
	const cookieHeader = await resolvedDeps.mintSmokeSession({
		appApiReadyzUrl: args.appApiReadyzUrl,
		email: args.email,
		name: args.name,
		password: smokePassword,
		resetIdentity: true,
		smokeAuthSecret: args.smokeAuthSecret,
	});

	const meResult = await resolvedDeps.fetchJsonWithCookie<{
		permissions: {
			chat: boolean;
			operator: boolean;
		};
		principal: unknown;
		session: unknown | null;
	}>({
		cookieHeader,
		expectedStatus: 200,
		url: new URL("/api/me", args.chatBaseUrl).toString(),
	});
	result.principal = meResult.payload.principal;
	result.session = meResult.payload.session;
	if (!meResult.payload.permissions.chat) {
		throw new Error("staging smoke identity does not have chat permission.");
	}

	const submit = await readAcceptedEvent({
		abortSubmitStream: resolvedDeps.abortSubmitStream,
		body: {
			prompt: args.prompt,
		},
		cookieHeader,
		openSubmitStream: resolvedDeps.openSubmitStream,
		url: new URL("/api/chat/requests/stream", args.chatBaseUrl).toString(),
	});
	result.submit = submit.accepted;
	result.submitStreamAbortedAfterAccepted = submit.aborted;

	const resume = await readRunEventsUntilFinalization({
		accepted: submit.accepted,
		cookieHeader,
		openRunEventStream: resolvedDeps.openRunEventStream,
		url: new URL(
			`/api/chat/runs/${encodeURIComponent(submit.accepted.runId)}/events/stream?after_sequence=0`,
			args.chatBaseUrl,
		).toString(),
	});
	result.resume = {
		afterSequence: 0,
		events: resume.events,
		terminalEvent: resume.terminalEvent,
	};

	const runResult = await resolvedDeps.fetchJsonWithCookie<{ run: RuntimeRunSummary }>({
		cookieHeader,
		expectedStatus: 200,
		method: "GET",
		url: new URL(
			`/api/chat/runs/${encodeURIComponent(submit.accepted.runId)}`,
			args.chatBaseUrl,
		).toString(),
	});
	assertRunMatchesAccepted(runResult.payload.run, submit.accepted);
	result.run = runResult.payload.run;

	const conversationResult = await resolvedDeps.fetchJsonWithCookie<{
		conversation: ConversationDetail;
	}>({
		cookieHeader,
		expectedStatus: 200,
		method: "GET",
		url: new URL(
			`/api/chat/conversations/${encodeURIComponent(runResult.payload.run.conversationId)}`,
			args.chatBaseUrl,
		).toString(),
	});
	result.conversation = summarizeConversation(
		conversationResult.payload.conversation,
		runResult.payload.run,
	);
	result.passed = true;
	return result;
}

export async function main(argv: string[], env: NodeJS.ProcessEnv = process.env) {
	const result = await runChatDurableE2eStaging(argv, env);
	console.log(JSON.stringify(result, null, 2));
	if (!result.passed) {
		process.exitCode = 1;
	}
}

if (import.meta.url === `file://${process.argv[1]}`) {
	void main(process.argv.slice(2)).catch((error: unknown) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	});
}
