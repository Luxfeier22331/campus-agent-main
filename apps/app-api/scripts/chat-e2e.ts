import process from "node:process";
import { Client, type ClientConfig } from "pg";
import { buildOperatorDatabaseConfig } from "../src/db/runtime";
import { type ChatE2eArgs, type ChatE2eProfile, parseChatE2eArgs } from "./chat-e2e.args";
import { assertExpectedChatE2eResultKind } from "./chat-e2e.result-kind";
import { buildCookieHeader, expectJsonResponse, readJsonResponse } from "./smoke-auth-runtime";
import { buildSmokePassword, mintStagingSmokeSession } from "./staging-smoke-support";

type ReadyzName = "appApi" | "chat" | "exec";

interface ReadyzProbe {
	payload: unknown;
	status: number;
}

type ChatE2eBlockedBy =
	| "app_api_not_ready"
	| "chat_surface_not_ready"
	| "execution_control_not_ready"
	| "execution_control_tunnel_unreachable";

export interface ChatE2eDependencies {
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
	readModelExecutionState?: (requestId: string) => Promise<string | null>;
	signInSmokeIdentity?: (input: {
		captchaToken: string;
		chatBaseUrl: string;
		email: string;
		password: string;
	}) => Promise<string>;
	openSubmitStream?: (input: {
		body: unknown;
		cookieHeader: string;
		url: string;
	}) => Promise<Response>;
}

interface ChatE2eReadyzSummary {
	appApi: ReadyzProbe | null;
	chat: ReadyzProbe | null;
	exec: ReadyzProbe | null;
}

interface ChatE2eSuccessSummary {
	conversationId: string;
	historyCountAfter: number;
	historyCountBefore: number;
	historyHasConversation: boolean;
	prompt: string;
	modelExecutionState: string | null;
	requestId: string;
	resultKind: string;
	runId: string | null;
	traceId: string;
	transport: ChatE2eArgs["transport"];
}

export interface ChatE2eResult {
	blocked_by: ChatE2eBlockedBy | null;
	chat_request_attempted: boolean;
	identity: {
		email: string;
		resetViaDeployedRuntime: boolean;
	};
	passed: boolean;
	principal: unknown | null;
	profile: ChatE2eProfile;
	readyz: ChatE2eReadyzSummary;
	request: ChatE2eSuccessSummary | null;
	session: unknown | null;
	session_mint_attempted: boolean;
	sign_in_attempted: boolean;
}

async function defaultFetchReadyz(url: string): Promise<ReadyzProbe> {
	const response = await fetch(url, {
		headers: {
			accept: "application/json",
		},
		signal: AbortSignal.timeout(30_000),
	});
	return {
		payload: await readJsonResponse(response),
		status: response.status,
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
		method: input.method ?? "GET",
		headers: {
			accept: "application/json",
			...(input.body
				? {
						"content-type": "application/json",
					}
				: {}),
			cookie: input.cookieHeader,
			...(input.idempotencyKey
				? {
						"idempotency-key": input.idempotencyKey,
					}
				: {}),
		},
		body: input.body ? JSON.stringify(input.body) : undefined,
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
	url: string;
}): Promise<Response> {
	const response = await fetch(input.url, {
		body: JSON.stringify(input.body),
		headers: {
			accept: "text/event-stream",
			"content-type": "application/json",
			cookie: input.cookieHeader,
			"idempotency-key": `chat-e2e-stream-${Date.now()}`,
		},
		method: "POST",
		signal: AbortSignal.timeout(180_000),
	});
	await expectEventStreamResponse(response, "chat e2e submit stream");
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

async function defaultReadModelExecutionState(requestId: string): Promise<string | null> {
	const client = new Client(buildOperatorDatabaseConfig(process.env) as ClientConfig);

	await client.connect();
	try {
		const result = await client.query<{ model_execution_state: string | null }>(
			'select "model_execution_state" from "runtime"."request_observability_fact" where "request_id" = $1',
			[requestId],
		);
		return result.rows[0]?.model_execution_state ?? null;
	} finally {
		await client.end();
	}
}

function classifyReadyzBlock(name: ReadyzName, probe: ReadyzProbe): ChatE2eBlockedBy | null {
	if (probe.status === 200) {
		return null;
	}
	if (name === "exec") {
		if (probe.status === 530 && isCloudflareTunnelError(probe.payload)) {
			return "execution_control_tunnel_unreachable";
		}
		return "execution_control_not_ready";
	}
	if (name === "appApi") {
		return "app_api_not_ready";
	}
	return "chat_surface_not_ready";
}

function isCloudflareTunnelError(payload: unknown): boolean {
	if (typeof payload === "string") {
		return payload.includes("1033");
	}
	if (!payload || typeof payload !== "object") {
		return false;
	}
	const record = payload as Record<string, unknown>;
	return record.error_code === 1033 || record.error_name === "tunnel_error";
}

function emptyResult(args: ChatE2eArgs): ChatE2eResult {
	return {
		blocked_by: null,
		chat_request_attempted: false,
		identity: {
			email: args.email,
			resetViaDeployedRuntime: args.profile === "staging",
		},
		passed: false,
		principal: null,
		profile: args.profile,
		readyz: {
			appApi: null,
			chat: null,
			exec: null,
		},
		request: null,
		session: null,
		session_mint_attempted: false,
		sign_in_attempted: false,
	};
}

interface ProductStreamEvent {
	data: Record<string, unknown>;
	event: string;
}

interface StreamTerminalIdentity {
	conversationId: string;
	requestId: string;
	resultKind: string;
	runId: string | null;
	traceId: string;
}

interface AcceptedStreamIdentity {
	requestId: string;
	runId: string;
	traceId: string;
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

function optionalStringField(value: Record<string, unknown>, field: string): string | null {
	const raw = value[field];
	return typeof raw === "string" && raw.trim() ? raw : null;
}

function readStreamTerminalIdentity(
	event: ProductStreamEvent,
	accepted: AcceptedStreamIdentity,
): StreamTerminalIdentity {
	if (event.event === "request.failed" || event.event === "request.cancelled") {
		const error = event.data.error;
		throw new Error(
			`Stream chat request reached ${event.event}: ${
				error && typeof error === "object" ? JSON.stringify(error) : JSON.stringify(event.data)
			}`,
		);
	}
	if (event.event !== "request.completed") {
		throw new Error(`Expected request.completed terminal event, got ${event.event}.`);
	}
	const answer = event.data.answer;
	if (!answer || typeof answer !== "object" || Array.isArray(answer)) {
		throw new Error("request.completed must include answer payload.");
	}
	const answerRecord = answer as Record<string, unknown>;
	const conversation = answerRecord.conversation;
	if (!conversation || typeof conversation !== "object" || Array.isArray(conversation)) {
		throw new Error("request.completed answer must include conversation.");
	}
	const result = answerRecord.result;
	if (!result || typeof result !== "object" || Array.isArray(result)) {
		throw new Error("request.completed answer must include result.");
	}
	const resultRecord = result as Record<string, unknown>;
	const requestId =
		optionalStringField(resultRecord, "requestId") ?? requireStringField(event.data, "requestId");
	const traceId =
		optionalStringField(resultRecord, "traceId") ?? requireStringField(event.data, "traceId");
	if (requestId !== accepted.requestId || traceId !== accepted.traceId) {
		throw new Error("Stream terminal request identity does not match request.accepted.");
	}
	return {
		conversationId: requireStringField(conversation as Record<string, unknown>, "id"),
		requestId,
		resultKind: requireStringField(resultRecord, "kind"),
		runId: accepted.runId,
		traceId,
	};
}

async function submitStreamAndReadTerminal(input: {
	body: unknown;
	cookieHeader: string;
	openSubmitStream: NonNullable<ChatE2eDependencies["openSubmitStream"]>;
	url: string;
}): Promise<StreamTerminalIdentity> {
	const response = await input.openSubmitStream({
		body: input.body,
		cookieHeader: input.cookieHeader,
		url: input.url,
	});
	let accepted: AcceptedStreamIdentity | null = null;
	for await (const event of parseSse(response)) {
		if (event.event === "request.accepted") {
			accepted = {
				requestId: requireStringField(event.data, "requestId"),
				runId: requireStringField(event.data, "runId"),
				traceId: requireStringField(event.data, "traceId"),
			};
			continue;
		}
		if (
			event.event === "request.completed" ||
			event.event === "request.failed" ||
			event.event === "request.cancelled"
		) {
			if (!accepted) {
				throw new Error("Stream chat request reached terminal event before request.accepted.");
			}
			return readStreamTerminalIdentity(event, accepted);
		}
	}
	throw new Error("Submit stream ended before a terminal request event.");
}

async function defaultSignInSmokeIdentity(input: {
	captchaToken: string;
	chatBaseUrl: string;
	email: string;
	password: string;
}): Promise<string> {
	const response = await fetch(new URL("/api/auth/sign-in/email", input.chatBaseUrl).toString(), {
		body: JSON.stringify({
			email: input.email,
			password: input.password,
		}),
		headers: {
			accept: "application/json",
			"content-type": "application/json",
			origin: input.chatBaseUrl,
			referer: new URL("/login", input.chatBaseUrl).toString(),
			"x-captcha-response": input.captchaToken,
		},
		method: "POST",
		signal: AbortSignal.timeout(30_000),
	});
	const payload = await readJsonResponse(response);
	if (!response.ok) {
		throw new Error(
			`Dev smoke identity sign-in failed (${response.status}): ${JSON.stringify(payload)}`,
		);
	}
	return buildCookieHeader(response);
}

async function resolveCookieHeader(
	args: ChatE2eArgs,
	result: ChatE2eResult,
	deps: Required<Pick<ChatE2eDependencies, "mintSmokeSession" | "signInSmokeIdentity">>,
): Promise<string> {
	if (args.profile === "staging") {
		if (!args.appApiReadyzUrl) {
			throw new Error("Staging chat e2e requires --app-api-readyz-url.");
		}
		const smokePassword = buildSmokePassword();
		result.session_mint_attempted = true;
		return deps.mintSmokeSession({
			appApiReadyzUrl: args.appApiReadyzUrl,
			email: args.email,
			name: args.name,
			password: smokePassword,
			resetIdentity: true,
			smokeAuthSecret: args.smokeAuthSecret,
		});
	}

	result.sign_in_attempted = true;
	return deps.signInSmokeIdentity({
		captchaToken: args.captchaToken,
		chatBaseUrl: args.chatBaseUrl,
		email: args.email,
		password: args.password,
	});
}

async function runReadyzChecks(
	args: ChatE2eArgs,
	deps: Required<Pick<ChatE2eDependencies, "fetchReadyz">>,
): Promise<{ blockedBy: ChatE2eBlockedBy | null; readyz: ChatE2eReadyzSummary }> {
	let exec: ReadyzProbe | null = null;
	if (args.execReadyzUrl) {
		exec = await deps.fetchReadyz(args.execReadyzUrl);
		const execBlock = classifyReadyzBlock("exec", exec);
		if (execBlock) {
			return {
				blockedBy: execBlock,
				readyz: {
					appApi: null,
					chat: null,
					exec,
				},
			};
		}
	}

	let appApi: ReadyzProbe | null = null;
	if (args.appApiReadyzUrl) {
		appApi = await deps.fetchReadyz(args.appApiReadyzUrl);
		const appApiBlock = classifyReadyzBlock("appApi", appApi);
		if (appApiBlock) {
			return {
				blockedBy: appApiBlock,
				readyz: {
					appApi,
					chat: null,
					exec,
				},
			};
		}
	}

	const chat = await deps.fetchReadyz(new URL("/readyz", args.chatBaseUrl).toString());
	const chatBlock = classifyReadyzBlock("chat", chat);
	return {
		blockedBy: chatBlock,
		readyz: {
			appApi,
			chat,
			exec,
		},
	};
}

export async function runChatE2e(
	argv: string[],
	env: NodeJS.ProcessEnv = process.env,
	deps: ChatE2eDependencies = {},
): Promise<ChatE2eResult> {
	const args = parseChatE2eArgs(argv, env);
	const result = emptyResult(args);
	const resolvedDeps = {
		fetchJsonWithCookie: deps.fetchJsonWithCookie ?? fetchJsonWithCookie,
		fetchReadyz: deps.fetchReadyz ?? defaultFetchReadyz,
		mintSmokeSession: deps.mintSmokeSession ?? mintStagingSmokeSession,
		openSubmitStream: deps.openSubmitStream ?? openSubmitStream,
		readModelExecutionState: deps.readModelExecutionState ?? defaultReadModelExecutionState,
		signInSmokeIdentity: deps.signInSmokeIdentity ?? defaultSignInSmokeIdentity,
	};
	const readyzResult = await runReadyzChecks(args, resolvedDeps);
	result.readyz = readyzResult.readyz;
	if (readyzResult.blockedBy) {
		result.blocked_by = readyzResult.blockedBy;
		return result;
	}

	const cookieHeader = await resolveCookieHeader(args, result, resolvedDeps);

	const meResult = await resolvedDeps.fetchJsonWithCookie<{
		permissions: {
			chat: boolean;
			operator: boolean;
		};
		principal: {
			email: string | null;
			principalId: string;
			type: string;
		};
		session: {
			expiresAt: string;
			sessionId: string;
		} | null;
	}>({
		cookieHeader,
		expectedStatus: 200,
		url: new URL("/api/me", args.chatBaseUrl).toString(),
	});
	const beforeConversations = await resolvedDeps.fetchJsonWithCookie<{
		conversations: Array<{ id: string; title: string }>;
	}>({
		cookieHeader,
		expectedStatus: 200,
		url: new URL("/api/chat/conversations", args.chatBaseUrl).toString(),
	});
	result.chat_request_attempted = true;
	const requestIdentity =
		args.transport === "stream"
			? await submitStreamAndReadTerminal({
					body: {
						prompt: args.prompt,
					},
					cookieHeader,
					openSubmitStream: resolvedDeps.openSubmitStream,
					url: new URL("/api/chat/requests/stream", args.chatBaseUrl).toString(),
				})
			: await submitSync({
					args,
					cookieHeader,
					fetchJsonWithCookie: resolvedDeps.fetchJsonWithCookie,
				});
	const conversationId = requestIdentity.conversationId;
	const resultKind = requestIdentity.resultKind;
	const requestId = requestIdentity.requestId;
	const traceId = requestIdentity.traceId;
	assertExpectedChatE2eResultKind({
		actual: resultKind,
		expected: args.expectResultKind,
		requestId,
		traceId,
	});
	const modelExecutionState = args.expectModelExecutionState
		? await resolvedDeps.readModelExecutionState(requestId)
		: null;
	if (args.expectModelExecutionState && modelExecutionState !== args.expectModelExecutionState) {
		throw new Error(
			`Expected model execution state ${args.expectModelExecutionState} for request ${requestId}, received ${
				modelExecutionState ?? "null"
			}.`,
		);
	}
	const afterConversations = await resolvedDeps.fetchJsonWithCookie<{
		conversations: Array<{ id: string; title: string }>;
	}>({
		cookieHeader,
		expectedStatus: 200,
		url: new URL("/api/chat/conversations", args.chatBaseUrl).toString(),
	});
	const historyHasConversation = afterConversations.payload.conversations.some(
		(conversation) => conversation.id === conversationId,
	);
	if (!historyHasConversation) {
		throw new Error(
			`Conversation ${conversationId} was not present in /api/chat/conversations after the live request.`,
		);
	}
	if (args.transport === "stream") {
		const conversationDetail = await resolvedDeps.fetchJsonWithCookie<{
			conversation: {
				id: string;
				messages: Array<{
					kind: string | null;
					requestId: string | null;
					role: string;
					text: string;
				}>;
			};
		}>({
			cookieHeader,
			expectedStatus: 200,
			method: "GET",
			url: new URL(
				`/api/chat/conversations/${encodeURIComponent(conversationId)}`,
				args.chatBaseUrl,
			).toString(),
		});
		if (conversationDetail.payload.conversation.id !== conversationId) {
			throw new Error("Conversation detail id does not match stream terminal conversation id.");
		}
		const hasAssistantMessage = conversationDetail.payload.conversation.messages.some(
			(message) =>
				message.role === "assistant" &&
				message.kind === "answer" &&
				message.requestId === requestId &&
				message.text.trim().length > 0,
		);
		if (!hasAssistantMessage) {
			throw new Error(
				"Conversation is missing an assistant answer message for the stream request.",
			);
		}
	}

	result.passed = true;
	result.principal = meResult.payload.principal;
	result.request = {
		conversationId,
		historyCountAfter: afterConversations.payload.conversations.length,
		historyCountBefore: beforeConversations.payload.conversations.length,
		historyHasConversation,
		prompt: args.prompt,
		modelExecutionState,
		requestId,
		resultKind,
		runId: requestIdentity.runId,
		traceId,
		transport: args.transport,
	};
	result.session = meResult.payload.session;
	return result;
}

async function submitSync(input: {
	args: ChatE2eArgs;
	cookieHeader: string;
	fetchJsonWithCookie: NonNullable<ChatE2eDependencies["fetchJsonWithCookie"]>;
}): Promise<StreamTerminalIdentity> {
	const requestResult = await input.fetchJsonWithCookie<{
		answer: {
			conversation: {
				id: string;
			};
			result: {
				kind: string;
				requestId: string;
				traceId: string;
			};
		};
	}>({
		body: {
			prompt: input.args.prompt,
		},
		cookieHeader: input.cookieHeader,
		expectedStatus: 200,
		idempotencyKey: `chat-e2e-${input.args.profile}-${Date.now()}`,
		method: "POST",
		url: new URL("/api/chat/requests", input.args.chatBaseUrl).toString(),
	});
	return {
		conversationId: requestResult.payload.answer.conversation.id,
		requestId:
			requestResult.response.headers.get("x-request-id") ??
			requestResult.payload.answer.result.requestId,
		resultKind: requestResult.payload.answer.result.kind,
		runId: null,
		traceId:
			requestResult.response.headers.get("x-trace-id") ??
			requestResult.payload.answer.result.traceId,
	};
}

export async function main(argv: string[], env: NodeJS.ProcessEnv = process.env) {
	const result = await runChatE2e(argv, env);
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
