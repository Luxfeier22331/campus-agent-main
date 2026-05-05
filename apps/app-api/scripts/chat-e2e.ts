import process from "node:process";
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
	| "supervisor_exec_not_ready"
	| "supervisor_exec_tunnel_unreachable";

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
	signInSmokeIdentity?: (input: {
		captchaToken: string;
		chatBaseUrl: string;
		email: string;
		password: string;
	}) => Promise<string>;
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
	requestId: string;
	resultKind: string;
	traceId: string;
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

function classifyReadyzBlock(name: ReadyzName, probe: ReadyzProbe): ChatE2eBlockedBy | null {
	if (probe.status === 200) {
		return null;
	}
	if (name === "exec") {
		if (probe.status === 530 && isCloudflareTunnelError(probe.payload)) {
			return "supervisor_exec_tunnel_unreachable";
		}
		return "supervisor_exec_not_ready";
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
	const exec = await deps.fetchReadyz(args.execReadyzUrl);
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
	const requestResult = await resolvedDeps.fetchJsonWithCookie<{
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
			prompt: args.prompt,
		},
		cookieHeader,
		expectedStatus: 200,
		idempotencyKey: `chat-e2e-${args.profile}-${Date.now()}`,
		method: "POST",
		url: new URL("/api/chat/requests", args.chatBaseUrl).toString(),
	});
	const conversationId = requestResult.payload.answer.conversation.id;
	const resultKind = requestResult.payload.answer.result.kind;
	const requestId =
		requestResult.response.headers.get("x-request-id") ??
		requestResult.payload.answer.result.requestId;
	const traceId =
		requestResult.response.headers.get("x-trace-id") ?? requestResult.payload.answer.result.traceId;
	assertExpectedChatE2eResultKind({
		actual: resultKind,
		expected: args.expectResultKind,
		requestId,
		traceId,
	});
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

	result.passed = true;
	result.principal = meResult.payload.principal;
	result.request = {
		conversationId,
		historyCountAfter: afterConversations.payload.conversations.length,
		historyCountBefore: beforeConversations.payload.conversations.length,
		historyHasConversation,
		prompt: args.prompt,
		requestId,
		resultKind,
		traceId,
	};
	result.session = meResult.payload.session;
	return result;
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
