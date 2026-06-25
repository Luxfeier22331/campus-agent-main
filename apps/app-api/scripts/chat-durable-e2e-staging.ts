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
	conversationId: string | null;
	email: string;
	name: string;
	password: string | null;
	prompt: string;
	resetIdentity: boolean;
	smokeAuthSecret: string;
}

interface ProductStreamEvent {
	data: Record<string, unknown>;
	event: string;
}

interface DurableRunEventProjection {
	event: string;
	occurredAt: string;
	requestId: string;
	runId: string;
	sequence: number;
	status: string;
	traceId: string;
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

interface RuntimeStepTrajectory {
	attempts: Array<{ runId: string; workflowId: string }>;
	results?: Record<string, unknown>[];
	run: RuntimeRunSummary;
	steps?: Record<string, unknown>[];
}

interface WorkflowIdentity {
	attemptCount: number;
	workflowId: string;
}

interface LangfuseCloseoutIdentity {
	productTraceId: string;
	requestId: string;
	runId: string;
	sessionId: string;
	userId: string;
	workflowId: string;
}

export interface WorkflowTraceSummary {
	selected_capability: string;
	trace_steps: Array<{
		selected_capability?: string;
		status: string;
		step_id: string;
	}>;
}

export interface ChatDurableE2eResult {
	conversation: {
		assistantAnswerText: string;
		assistantMessageCount: number;
		hasAssistantMessageForRequest: boolean;
		id: string;
		messageCount: number;
	} | null;
	identity: {
		email: string;
		resetViaDeployedRuntime: true;
	};
	langfuseCloseout: LangfuseCloseoutIdentity | null;
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
	runtimeStepResults: Record<string, unknown>[];
	session: unknown | null;
	sessionMintAttempted: boolean;
	submit: AcceptedRunIdentity | null;
	submitStreamAbortedAfterAccepted: boolean;
	workflow: WorkflowIdentity | null;
	workflowTraceSummary: WorkflowTraceSummary | null;
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
	let conversationId: string | null = null;
	let email = DEFAULT_SMOKE_EMAIL;
	let name = DEFAULT_SMOKE_NAME;
	let password: string | null = null;
	let prompt = DEFAULT_CHAT_E2E_PROMPT;
	let resetIdentity = true;
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
		if (token === "--conversation-id") {
			const value = normalizeOptionalValue(argv[index + 1]);
			if (!value) {
				throw new Error("--conversation-id requires a non-empty value.");
			}
			conversationId = value;
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
		if (token === "--password") {
			const value = normalizeOptionalValue(argv[index + 1]);
			if (!value) {
				throw new Error("--password requires a non-empty value.");
			}
			password = value;
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
		if (token === "--no-reset-identity") {
			resetIdentity = false;
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
		conversationId,
		email,
		name,
		password,
		prompt,
		resetIdentity,
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

function readPrincipalId(principal: unknown): string {
	if (!principal || typeof principal !== "object" || Array.isArray(principal)) {
		throw new Error("staging smoke principal must be an object.");
	}
	return requireStringField(principal as Record<string, unknown>, "principalId");
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
	const occurredAt = requireStringField(event.data, "occurredAt");
	const requestId = requireStringField(event.data, "requestId");
	const runId = requireStringField(event.data, "runId");
	const status = requireStringField(event.data, "status");
	const traceId = requireStringField(event.data, "traceId");
	const sequenceValue = event.data.sequence;

	if (typeof sequenceValue !== "number" || !Number.isInteger(sequenceValue) || sequenceValue < 1) {
		throw new Error("durable run event sequence must be a positive integer.");
	}

	return {
		event: event.event,
		occurredAt,
		requestId,
		runId,
		sequence: sequenceValue,
		status,
		traceId,
	};
}

function isFinalizationCompleted(event: DurableRunEventProjection): boolean {
	return event.event === "request.completed" && event.status === "completed";
}

function isTerminalRunEvent(event: DurableRunEventProjection): boolean {
	return (
		isFinalizationCompleted(event) ||
		event.event === "request.failed" ||
		event.event === "request.cancelled"
	);
}

function assertRunMatchesAccepted(
	run: RuntimeRunSummary,
	accepted: AcceptedRunIdentity,
	expectedStatus = "completed",
): void {
	if (
		run.runId !== accepted.runId ||
		run.requestId !== accepted.requestId ||
		run.traceId !== accepted.traceId
	) {
		throw new Error("durable run status identity does not match request.accepted.");
	}
	if (run.status !== expectedStatus) {
		throw new Error(`Expected durable run status ${expectedStatus}, received ${run.status}.`);
	}
	if (!run.conversationId.trim()) {
		throw new Error("durable run status must include conversationId.");
	}
}

function readWorkflowIdentity(
	trajectory: RuntimeStepTrajectory,
	accepted: AcceptedRunIdentity,
): WorkflowIdentity {
	if (
		trajectory.run.runId !== accepted.runId ||
		trajectory.run.requestId !== accepted.requestId ||
		trajectory.run.traceId !== accepted.traceId
	) {
		throw new Error("durable run steps identity does not match request.accepted.");
	}
	if (!Array.isArray(trajectory.attempts) || trajectory.attempts.length === 0) {
		throw new Error("durable run steps must include at least one Temporal attempt.");
	}

	const workflowIds = new Set<string>();
	for (const [index, attempt] of trajectory.attempts.entries()) {
		if (attempt.runId !== accepted.runId) {
			throw new Error(`durable run step attempt ${index} runId does not match request.accepted.`);
		}
		if (typeof attempt.workflowId !== "string" || !attempt.workflowId.trim()) {
			throw new Error(`durable run step attempt ${index} must include workflowId.`);
		}
		workflowIds.add(attempt.workflowId);
	}
	if (workflowIds.size !== 1) {
		throw new Error("durable run step attempts must reference one workflowId.");
	}

	const workflowId = [...workflowIds][0];
	if (!workflowId) {
		throw new Error("durable run step attempts must include workflowId.");
	}
	return {
		attemptCount: trajectory.attempts.length,
		workflowId,
	};
}

function assertFinalEventMatchesAccepted(
	event: DurableRunEventProjection,
	accepted: AcceptedRunIdentity,
): void {
	if (event.runId !== accepted.runId) {
		throw new Error("durable run event runId does not match request.accepted.");
	}
	if (event.requestId !== accepted.requestId) {
		throw new Error("request.completed requestId does not match request.accepted.");
	}
	if (event.traceId !== accepted.traceId) {
		throw new Error("request.completed traceId does not match request.accepted.");
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
	let lastSequence = 0;
	const events: DurableRunEventProjection[] = [];
	for (let attempt = 0; attempt < 8; attempt += 1) {
		const url = new URL(input.url);
		url.searchParams.set("after_sequence", String(lastSequence));
		const response = await input.openRunEventStream({
			afterSequence: lastSequence,
			cookieHeader: input.cookieHeader,
			runId: input.accepted.runId,
			url: url.toString(),
		});
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
				return { events, terminalEvent: event };
			}
			if (isTerminalRunEvent(event)) {
				assertFinalEventMatchesAccepted(event, input.accepted);
				return { events, terminalEvent: event };
			}
		}
	}

	throw new Error(
		`Run event streams ended before request.completed for runId=${input.accepted.runId} requestId=${input.accepted.requestId} traceId=${input.accepted.traceId} lastSequence=${lastSequence} events=${JSON.stringify(events)}`,
	);
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
	const assistantAnswerText = assistantMessages.at(-1)?.text.trim();
	if (!assistantAnswerText) {
		throw new Error("conversation assistant answer text is empty.");
	}
	return {
		assistantAnswerText,
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
		langfuseCloseout: null,
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
		runtimeStepResults: [],
		session: null,
		sessionMintAttempted: false,
		submit: null,
		submitStreamAbortedAfterAccepted: false,
		workflow: null,
		workflowTraceSummary: null,
	};

	result.readyz.appApi = await resolvedDeps.fetchReadyz(args.appApiReadyzUrl);
	result.readyz.chat = await resolvedDeps.fetchReadyz(
		new URL("/readyz", args.chatBaseUrl).toString(),
	);

	const smokePassword = args.password ?? buildSmokePassword();
	result.sessionMintAttempted = true;
	const cookieHeader = await resolvedDeps.mintSmokeSession({
		appApiReadyzUrl: args.appApiReadyzUrl,
		email: args.email,
		name: args.name,
		password: smokePassword,
		resetIdentity: args.resetIdentity,
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
	const principalId = readPrincipalId(meResult.payload.principal);
	if (!meResult.payload.permissions.chat) {
		throw new Error("staging smoke identity does not have chat permission.");
	}

	const submit = await readAcceptedEvent({
		abortSubmitStream: resolvedDeps.abortSubmitStream,
		body: {
			...(args.conversationId ? { conversationId: args.conversationId } : {}),
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
	assertRunMatchesAccepted(runResult.payload.run, submit.accepted, resume.terminalEvent.status);
	result.run = runResult.payload.run;

	if (!isFinalizationCompleted(resume.terminalEvent)) {
		result.passed = false;
		return result;
	}

	const stepsResult = await resolvedDeps.fetchJsonWithCookie<RuntimeStepTrajectory>({
		cookieHeader,
		expectedStatus: 200,
		method: "GET",
		url: new URL(
			`/api/chat/runs/${encodeURIComponent(submit.accepted.runId)}/steps`,
			args.chatBaseUrl,
		).toString(),
	});
	result.workflow = readWorkflowIdentity(stepsResult.payload, submit.accepted);
	result.workflowTraceSummary = summarizeWorkflowTrace(stepsResult.payload);
	result.runtimeStepResults = stepsResult.payload.results ?? [];
	result.langfuseCloseout = {
		productTraceId: runResult.payload.run.traceId,
		requestId: runResult.payload.run.requestId,
		runId: runResult.payload.run.runId,
		sessionId: runResult.payload.run.conversationId,
		userId: principalId,
		workflowId: result.workflow.workflowId,
	};

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
	try {
		result.conversation = summarizeConversation(
			conversationResult.payload.conversation,
			runResult.payload.run,
		);
	} catch {
		result.passed = false;
		return result;
	}
	result.passed = true;
	return result;
}

function summarizeWorkflowTrace(trajectory: RuntimeStepTrajectory): WorkflowTraceSummary {
	const traceSteps = (trajectory.steps ?? []).map((step) => {
		const stepId = requireStepString(step, "stepId", "step_id");
		const status = requireStepString(step, "status");
		const selectedCapability =
			optionalStepString(step, "selectedCapability", "selected_capability") ||
			capabilityFromStepId(stepId);
		return {
			...(selectedCapability ? { selected_capability: selectedCapability } : {}),
			status,
			step_id: stepId,
		};
	});
	const selectedCapability =
		traceSteps.find((step) => step.selected_capability)?.selected_capability ?? "none";
	return {
		selected_capability: selectedCapability,
		trace_steps: traceSteps,
	};
}

function capabilityFromStepId(stepId: string): string {
	const normalized = stepId.trim();
	if (
		normalized === "rag.plan" ||
		normalized.startsWith("retrieval.") ||
		normalized === "evidence.selection" ||
		normalized === "synthesis" ||
		normalized === "grounding.verify" ||
		normalized.startsWith("capability:knowledge:")
	) {
		return "knowledge";
	}
	if (
		normalized.startsWith("capability:navigation:") ||
		normalized.startsWith("sdk_tool.execute.navigation")
	) {
		return "navigation";
	}
	if (
		normalized.startsWith("capability:notice:") ||
		normalized.startsWith("agent_as_tool:notice") ||
		normalized.startsWith("sdk_tool.execute.campus_notice")
	) {
		return "notice";
	}
	if (
		normalized.startsWith("capability:campus_services:") ||
		normalized.startsWith("sdk_tool.execute.campus_services")
	) {
		return "campus_services";
	}
	return "";
}

function requireStepString(step: Record<string, unknown>, ...keys: string[]): string {
	const value = optionalStepString(step, ...keys);
	if (!value) {
		throw new Error(`durable run step must include ${keys.join(" or ")}.`);
	}
	return value;
}

function optionalStepString(step: Record<string, unknown>, ...keys: string[]): string {
	for (const key of keys) {
		const value = step[key];
		if (typeof value === "string" && value.trim()) {
			return value;
		}
	}
	return "";
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
