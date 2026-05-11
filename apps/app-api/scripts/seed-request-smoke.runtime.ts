import process from "node:process";

import { Client } from "pg";

import { createApp } from "../src/app";
import { createPgChatConversationStore } from "../src/modules/chat";
import type { RequestedScope, SupervisorExecutionClient } from "../src/modules/integration";
import {
	buildRequestProjectionProjector,
	createPgProjectionStore,
} from "../src/modules/projection";
import { buildChatCommandService, createPgChatCommandStore } from "../src/modules/runtime-command";
import {
	buildSmokeIdentityProvisionRuntimeEnv,
	provisionSmokeIdentity,
	readSmokeIdentityProvisionInput,
} from "./provision-smoke-identity-lib.mjs";
import type { RequestSmokeSeedScenario } from "./seed-request-smoke.args";
import { buildRequestSmokeSeedScenarios } from "./seed-request-smoke.scenarios";
import { expectJsonResponse, signInSmokeIdentity } from "./smoke-auth-runtime";

function resolveSslConfig(databaseSslMode: string) {
	return databaseSslMode === "disable"
		? false
		: {
				rejectUnauthorized: false as const,
			};
}

function resolveOperatorConnectionString(env: NodeJS.ProcessEnv): string {
	const connectionString = env.APP_API_OPERATOR_DATABASE_URL?.trim();
	if (!connectionString) {
		throw new Error("APP_API_OPERATOR_DATABASE_URL is required.");
	}

	const nextUrl = new URL(connectionString);
	nextUrl.searchParams.delete("sslmode");
	return nextUrl.toString();
}

function readDatabaseSslMode(env: NodeJS.ProcessEnv): string {
	return env.APP_API_DATABASE_SSLMODE?.trim() === "disable"
		? "disable"
		: env.APP_API_DATABASE_SSLMODE?.trim() === "prefer"
			? "prefer"
			: "require";
}

function createOperatorHeaders(input: {
	internalSharedSecret: string;
	operatorEmail: string;
}): Record<string, string> {
	return {
		accept: "application/json",
		"x-app-internal-auth": input.internalSharedSecret,
		"x-app-operator-email": input.operatorEmail,
	};
}

function scopesMatch(
	left: RequestedScope | null | undefined,
	right: RequestedScope | null | undefined,
): boolean {
	if (!(left || right)) {
		return true;
	}
	if (!(left && right)) {
		return false;
	}

	return left.collection === right.collection && left.corpus === right.corpus;
}

async function listExistingUserIds(client: Client, email: string): Promise<string[]> {
	const result = await client.query<{ id: string }>(
		'select "id" from "app_auth"."user" where "email" = $1 order by "id" asc',
		[email],
	);

	return result.rows
		.map((row) => row.id)
		.filter((value): value is string => typeof value === "string" && value.length > 0);
}

async function cleanupPreviousSmokeRequestArtifacts(
	client: Client,
	actorUserIds: string[],
): Promise<{ clearedRequestCount: number }> {
	if (actorUserIds.length === 0) {
		return {
			clearedRequestCount: 0,
		};
	}

	const requestRows = await client.query<{ request_id: string }>(
		`
      select "request_id"
      from "runtime"."request_execution"
      where "actor_user_id" = any($1::text[])
      order by "request_id" asc
    `,
		[actorUserIds],
	);
	const requestIds = requestRows.rows
		.map((row) => row.request_id)
		.filter((value): value is string => typeof value === "string" && value.length > 0);

	if (requestIds.length === 0) {
		return {
			clearedRequestCount: 0,
		};
	}

	await client.query(
		'delete from "operator"."quality_grade_projection" where "request_id" = any($1::text[])',
		[requestIds],
	);
	await client.query(
		'delete from "operator"."quality_badcase_projection" where "request_id" = any($1::text[])',
		[requestIds],
	);
	await client.query(
		'delete from "operator"."metric_rollup" where "request_id" = any($1::text[])',
		[requestIds],
	);
	await client.query(
		'delete from "operator"."request_audit_projection" where "request_id" = any($1::text[])',
		[requestIds],
	);
	await client.query(
		'delete from "operator"."trace_backlink_projection" where "request_id" = any($1::text[])',
		[requestIds],
	);
	await client.query(
		'delete from "operator"."request_projection" where "request_id" = any($1::text[])',
		[requestIds],
	);
	await client.query(
		'delete from "runtime"."projection_outbox" where "request_id" = any($1::text[])',
		[requestIds],
	);
	await client.query(
		'delete from "runtime"."request_observability_fact" where "request_id" = any($1::text[])',
		[requestIds],
	);
	await client.query(
		'delete from "runtime"."request_execution" where "request_id" = any($1::text[])',
		[requestIds],
	);

	return {
		clearedRequestCount: requestIds.length,
	};
}

function buildScriptedSupervisor(scenarios: RequestSmokeSeedScenario[]): SupervisorExecutionClient {
	let currentIndex = 0;

	return {
		async execute(input) {
			const scenario = scenarios[currentIndex];
			if (!scenario) {
				throw new Error(`Unexpected extra request for prompt: ${input.userGoal}`);
			}
			if (scenario.prompt !== input.userGoal) {
				throw new Error(
					`Scenario mismatch at index ${currentIndex}: expected "${scenario.prompt}", received "${input.userGoal}".`,
				);
			}
			if (!scopesMatch(scenario.requestedScope, input.requestedScope ?? null)) {
				throw new Error(
					`Scenario scope mismatch for ${scenario.key}: expected ${JSON.stringify(scenario.requestedScope)}, received ${JSON.stringify(input.requestedScope ?? null)}.`,
				);
			}

			currentIndex += 1;
			return scenario.response;
		},
	};
}

export async function main(argv: string[], env: NodeJS.ProcessEnv = process.env) {
	const argsModule = await import("./seed-request-smoke.args");
	const args = argsModule.parseRequestSmokeSeedArgs(argv);
	const provisionInput = readSmokeIdentityProvisionInput(
		["--email", args.email, "--name", args.name],
		env,
	);
	const runtimeEnv = buildSmokeIdentityProvisionRuntimeEnv(provisionInput);
	const client = new Client({
		connectionString: resolveOperatorConnectionString(env),
		ssl: resolveSslConfig(readDatabaseSslMode(env)),
	});

	await client.connect();

	try {
		const priorUserIds = await listExistingUserIds(client, provisionInput.email);
		const cleanupSummary = await cleanupPreviousSmokeRequestArtifacts(client, priorUserIds);
		const scenarios = buildRequestSmokeSeedScenarios();
		const projector = buildRequestProjectionProjector({
			store: createPgProjectionStore(runtimeEnv),
		});
		const app = createApp(runtimeEnv, {
			chatCommandService: buildChatCommandService({
				conversationStore: createPgChatConversationStore(runtimeEnv),
				store: createPgChatCommandStore(runtimeEnv),
				supervisor: buildScriptedSupervisor(scenarios),
			}),
		});
		const appFetch = (request: Request) => app.fetch(request);

		const identitySummary = await provisionSmokeIdentity(
			{
				...provisionInput,
				runtimeEnv,
			},
			{
				appFetch,
				async executeSql(sql: string, params: unknown[]) {
					return client.query(sql, params);
				},
			},
		);
		const cookieHeader = await signInSmokeIdentity({
			appFetch,
			captchaToken: provisionInput.captchaToken,
			email: provisionInput.email,
			password: provisionInput.password,
			publicChatOrigin: provisionInput.publicChatOrigin,
		});
		const conversationIds = new Map<string, string>();
		const seededRequests: Array<{
			answerKind: string;
			conversationId: string;
			expectedStatus: string;
			key: string;
			prompt: string;
			requestId: string;
			selectedTarget: string | null;
			traceId: string;
		}> = [];

		for (const scenario of scenarios) {
			const conversationId = conversationIds.get(scenario.conversationKey) ?? null;
			const response = await app.fetch(
				new Request("https://app-api.internal/api/chat/requests", {
					body: JSON.stringify({
						...(conversationId ? { conversationId } : {}),
						prompt: scenario.prompt,
						...(scenario.requestedScope ? { requestedScope: scenario.requestedScope } : {}),
					}),
					headers: {
						"content-type": "application/json",
						cookie: cookieHeader,
						"idempotency-key": `seed-${scenario.key}`,
					},
					method: "POST",
				}),
			);
			const payload = await expectJsonResponse<{
				answer: {
					conversation: { id: string };
					result: {
						kind: string;
						requestId: string;
						traceId: string;
					};
				};
			}>(response, 200);
			const requestId = response.headers.get("x-request-id") ?? payload.answer.result.requestId;
			if (!requestId) {
				throw new Error(`Request id missing for scenario ${scenario.key}.`);
			}

			const drainResult = await projector.drainRequest(requestId);
			if (drainResult.failed > 0 || drainResult.processed < 1) {
				throw new Error(`Projection drain failed for ${requestId}: ${JSON.stringify(drainResult)}`);
			}

			const nextConversationId = payload.answer.conversation.id;
			conversationIds.set(scenario.conversationKey, nextConversationId);
			seededRequests.push({
				answerKind: payload.answer.result.kind,
				conversationId: nextConversationId,
				expectedStatus: scenario.status,
				key: scenario.key,
				prompt: scenario.prompt,
				requestId,
				selectedTarget: scenario.response.selectedTarget,
				traceId: response.headers.get("x-trace-id") ?? payload.answer.result.traceId,
			});
		}

		const conversationListResponse = await app.fetch(
			new Request("https://app-api.internal/api/chat/conversations", {
				headers: {
					cookie: cookieHeader,
				},
			}),
		);
		const conversationListPayload = await expectJsonResponse<{
			conversations: Array<{ id: string; title: string }>;
		}>(conversationListResponse, 200);
		const operatorHeaders = createOperatorHeaders({
			internalSharedSecret: runtimeEnv.APP_API_INTERNAL_SHARED_SECRET ?? "",
			operatorEmail:
				runtimeEnv.APP_API_OPERATOR_EMAIL_ALLOWLIST?.split(",")
					.map((item: string) => item.trim())
					.find(Boolean) ?? "ops@example.com",
		});
		const operatorListResponse = await app.fetch(
			new Request(
				"https://app-api.internal/api/operator/requests?limit=20&surface=public_chat_web",
				{
					headers: operatorHeaders,
				},
			),
		);
		const operatorListPayload = await expectJsonResponse<{
			page: {
				nextCursor: string | null;
			};
			requests: Array<{
				requestId: string;
				status: string;
			}>;
		}>(operatorListResponse, 200);

		const verifiedRequests: Array<{
			actualErrorCode: string | null;
			actualSelectedTarget: string | null;
			actualStatus: string;
			answerKind: string;
			conversationId: string;
			expectedStatus: string;
			key: string;
			prompt: string;
			requestId: string;
			traceId: string;
		}> = [];

		for (const seededRequest of seededRequests) {
			const detailResponse = await app.fetch(
				new Request(`https://app-api.internal/api/operator/requests/${seededRequest.requestId}`, {
					headers: operatorHeaders,
				}),
			);
			const detailPayload = await expectJsonResponse<{
				request: {
					errorCode: string | null;
					requestId: string;
					selectedTarget: string | null;
					status: string;
				};
			}>(detailResponse, 200);
			verifiedRequests.push({
				actualErrorCode: detailPayload.request.errorCode,
				actualSelectedTarget: detailPayload.request.selectedTarget,
				actualStatus: detailPayload.request.status,
				answerKind: seededRequest.answerKind,
				conversationId: seededRequest.conversationId,
				expectedStatus: seededRequest.expectedStatus,
				key: seededRequest.key,
				prompt: seededRequest.prompt,
				requestId: seededRequest.requestId,
				traceId: seededRequest.traceId,
			});
		}

		const firstCompletedRequest = seededRequests.find(
			(request) => request.expectedStatus === "completed",
		);
		if (firstCompletedRequest) {
			const observabilityResponse = await app.fetch(
				new Request(
					`https://app-api.internal/api/operator/requests/${firstCompletedRequest.requestId}/observability`,
					{
						headers: operatorHeaders,
					},
				),
			);
			await expectJsonResponse(observabilityResponse, 200);
		}

		console.log(
			JSON.stringify(
				{
					cleanupSummary,
					conversationCount: conversationListPayload.conversations.length,
					email: identitySummary.email,
					operatorVisibleRequestIds: operatorListPayload.requests
						.map((request) => request.requestId)
						.filter((requestId) =>
							seededRequests.some((seededRequest) => seededRequest.requestId === requestId),
						),
					requestCount: verifiedRequests.length,
					requests: verifiedRequests,
					userId: identitySummary.userId,
				},
				null,
				2,
			),
		);
	} finally {
		await client.end();
	}
}
