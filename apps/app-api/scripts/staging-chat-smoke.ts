import process from "node:process";

import { expectJsonResponse } from "./smoke-auth-runtime";
import { parseStagingChatSmokeArgs } from "./staging-chat-smoke.args";
import { buildSmokePassword, fetchReadyz, mintStagingSmokeSession } from "./staging-smoke-support";

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

export async function main(argv: string[], env: NodeJS.ProcessEnv = process.env) {
	const args = parseStagingChatSmokeArgs(argv, env);
	const smokePassword = buildSmokePassword();
	const cookieHeader = await mintStagingSmokeSession({
		appApiReadyzUrl: args.appApiReadyzUrl,
		email: args.email,
		name: args.name,
		password: smokePassword,
		resetIdentity: true,
		smokeAuthSecret: args.smokeAuthSecret,
	});

	const execReadyz = await fetchReadyz(args.execReadyzUrl);
	const appApiReadyz = await fetchReadyz(args.appApiReadyzUrl);
	const chatReadyz = await fetchReadyz(new URL("/readyz", args.chatBaseUrl).toString());
	const meResult = await fetchJsonWithCookie<{
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
	const beforeConversations = await fetchJsonWithCookie<{
		conversations: Array<{ id: string; title: string }>;
	}>({
		cookieHeader,
		expectedStatus: 200,
		url: new URL("/api/chat/conversations", args.chatBaseUrl).toString(),
	});
	const requestResult = await fetchJsonWithCookie<{
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
		idempotencyKey: `staging-chat-smoke-${Date.now()}`,
		method: "POST",
		url: new URL("/api/chat/requests", args.chatBaseUrl).toString(),
	});
	const conversationId = requestResult.payload.answer.conversation.id;
	const afterConversations = await fetchJsonWithCookie<{
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
			`Conversation ${conversationId} was not present in /api/chat/conversations after the live smoke request.`,
		);
	}

	console.log(
		JSON.stringify(
			{
				identity: {
					email: args.email,
					resetViaDeployedRuntime: true,
				},
				principal: meResult.payload.principal,
				request: {
					conversationId,
					historyCountAfter: afterConversations.payload.conversations.length,
					historyCountBefore: beforeConversations.payload.conversations.length,
					historyHasConversation,
					prompt: args.prompt,
					requestId:
						requestResult.response.headers.get("x-request-id") ??
						requestResult.payload.answer.result.requestId,
					resultKind: requestResult.payload.answer.result.kind,
					traceId:
						requestResult.response.headers.get("x-trace-id") ??
						requestResult.payload.answer.result.traceId,
				},
				session: meResult.payload.session,
				surfaceChecks: {
					appApiReadyz: {
						status: appApiReadyz.status,
						url: args.appApiReadyzUrl,
					},
					chatReadyz: {
						status: chatReadyz.status,
						url: new URL("/readyz", args.chatBaseUrl).toString(),
					},
					execReadyz: {
						status: execReadyz.status,
						url: args.execReadyzUrl,
					},
				},
			},
			null,
			2,
		),
	);
}

void main(process.argv.slice(2)).catch((error: unknown) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
});
