import process from "node:process";
import type {
	AcceptedRunIdentity,
	ChatDurableE2eArgs,
	ChatDurableE2eDependencies,
	ChatDurableE2eResult,
	ConversationDetail,
	DurableRunEventProjection,
	ProductStreamEvent,
	RuntimeRunSummary,
	RuntimeStepTrajectory,
	WorkflowIdentity,
} from "./support/chat-durable-e2e-staging.types";
import {
	DEFAULT_CHAT_E2E_PROMPT,
	DEFAULT_STAGING_CHAT_E2E_APP_API_READYZ_URL,
	DEFAULT_STAGING_CHAT_E2E_CHAT_BASE_URL,
} from "./support/chat-e2e.args";
import { expectEventStreamResponse, fetchJsonWithCookie, parseSse } from "./support/http-smoke";
import { fetchReadyz, signInE2eIdentity } from "./support/staging-smoke-support";

export type {
	ChatDurableE2eDependencies,
	ChatDurableE2eResult,
} from "./support/chat-durable-e2e-staging.types";

function normalizeOptionalValue(value: string | undefined): string | null {
	if (typeof value !== "string") {
		return null;
	}

	const trimmed = value.trim();
	return trimmed ? trimmed : null;
}

function parseArgs(argv: string[]): ChatDurableE2eArgs {
	let appApiReadyzUrl = DEFAULT_STAGING_CHAT_E2E_APP_API_READYZ_URL;
	let captchaToken = "";
	let chatBaseUrl = DEFAULT_STAGING_CHAT_E2E_CHAT_BASE_URL;
	let conversationId: string | null = null;
	let email = "";
	let password = "";
	let prompt = DEFAULT_CHAT_E2E_PROMPT;

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
		if (token === "--captcha-token") {
			const value = normalizeOptionalValue(argv[index + 1]);
			if (!value) {
				throw new Error("--captcha-token requires a non-empty value.");
			}
			captchaToken = value;
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
		throw new Error(`Unknown argument: ${token}`);
	}

	if (!email) {
		throw new Error("--email is required.");
	}
	if (!password) {
		throw new Error("--password is required.");
	}
	if (!captchaToken) {
		throw new Error("--captcha-token is required.");
	}

	return {
		appApiReadyzUrl,
		captchaToken,
		chatBaseUrl,
		conversationId,
		email,
		password,
		prompt,
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
	deps: ChatDurableE2eDependencies = {},
): Promise<ChatDurableE2eResult> {
	const args = parseArgs(argv);
	const resolvedDeps = {
		abortSubmitStream:
			deps.abortSubmitStream ??
			((controller: AbortController) => {
				controller.abort();
			}),
		fetchJsonWithCookie: deps.fetchJsonWithCookie ?? fetchJsonWithCookie,
		fetchReadyz: deps.fetchReadyz ?? fetchReadyz,
		signInIdentity: deps.signInIdentity ?? signInE2eIdentity,
		openRunEventStream: deps.openRunEventStream ?? openRunEventStream,
		openSubmitStream: deps.openSubmitStream ?? openSubmitStream,
	};

	const result: ChatDurableE2eResult = {
		agentRuntimeEvalProjection: null,
		conversation: null,
		identity: {
			email: args.email,
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
		signInAttempted: false,
		submit: null,
		submitStreamAbortedAfterAccepted: false,
		workflow: null,
	};

	result.readyz.appApi = await resolvedDeps.fetchReadyz(args.appApiReadyzUrl);
	result.readyz.chat = await resolvedDeps.fetchReadyz(
		new URL("/readyz", args.chatBaseUrl).toString(),
	);

	result.signInAttempted = true;
	const cookieHeader = await resolvedDeps.signInIdentity({
		captchaToken: args.captchaToken,
		chatBaseUrl: args.chatBaseUrl,
		email: args.email,
		password: args.password,
	});

	const meResult = await resolvedDeps.fetchJsonWithCookie<{
		permissions: {
			chat: boolean;
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
		throw new Error("E2E identity does not have chat permission.");
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
	result.agentRuntimeEvalProjection = stepsResult.payload.agentRuntimeEvalProjection ?? null;
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

export async function main(argv: string[]) {
	const result = await runChatDurableE2eStaging(argv);
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
