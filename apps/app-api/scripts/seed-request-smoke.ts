import process from "node:process";
import { pathToFileURL } from "node:url";

import { Client } from "pg";

import { createApp } from "../src/app";
import { createPgChatConversationStore } from "../src/modules/chat";
import type {
	RequestedScope,
	SupervisorExecutionClient,
	SupervisorExecutionResponse,
} from "../src/modules/integration";
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

const DEFAULT_SMOKE_EMAIL = "help_bot@outlook.com";
const DEFAULT_SMOKE_NAME = "Campus Agent Smoke";

export interface RequestSmokeSeedArgs {
	email: string;
	name: string;
}

export interface RequestSmokeSeedScenario {
	conversationKey: string;
	key: string;
	prompt: string;
	requestedScope: RequestedScope | null;
	response: SupervisorExecutionResponse;
	status: SupervisorExecutionResponse["status"];
}

function normalizeOptionalValue(value: string | undefined): string | null {
	if (typeof value !== "string") {
		return null;
	}

	const trimmed = value.trim();
	return trimmed ? trimmed : null;
}

export function parseRequestSmokeSeedArgs(argv: string[]): RequestSmokeSeedArgs {
	let email = DEFAULT_SMOKE_EMAIL;
	let name = DEFAULT_SMOKE_NAME;

	for (let index = 0; index < argv.length; index += 1) {
		const token = argv[index];
		if (token === "--") {
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

		throw new Error(`Unknown argument: ${token}`);
	}

	return {
		email,
		name,
	};
}

export function buildRequestSmokeSeedScenarios(): RequestSmokeSeedScenario[] {
	return [
		{
			conversationKey: "library",
			key: "library-hours-answer",
			prompt: "图书馆周末开到几点？",
			requestedScope: {
				collection: "student_rules",
				corpus: "regulations",
			},
			response: {
				answerText: "图书馆周末开放到 22:00，考试周如有调整会另行通知。",
				error: null,
				followUpQuestion: "",
				observability: {
					aclAnomalyCode: null,
					aclDecision: "allowed",
					cachedInputTokens: 0,
					candidateCount: 4,
					citationCount: 1,
					citationExpected: true,
					citationMissing: false,
					estimatedCostMicrousd: 3810,
					failClosed: false,
					inputTokens: 184,
					modelName: "gpt-5.4-mini",
					modelProvider: "openai",
					outputTokens: 86,
					refusalClass: null,
					resolvedScopeCollection: "student_rules",
					resolvedScopeCorpus: "regulations",
					retrievedSourceCount: 1,
					retrievalAttempted: true,
				},
				result: {
					diagnostics: {
						resolved_policy_document_id: "handbook:library-hours",
						resolved_policy_title: "图书馆开放时间",
						retrieved_title_summary: ["图书馆开放时间"],
						rewritten_query: "中央民族大学 图书馆 周末 开放时间",
						semantic_outcome: "answered",
					},
					evidence: {
						collection: "student_rules",
						corpus: "regulations",
						query_text: "图书馆周末开到几点？",
						sources: [
							{
								doc_id: "handbook:library-hours",
								source_title: "图书馆开放时间",
							},
						],
					},
				},
				selectedTarget: "rag-agent",
				status: "completed",
				traceId: "trace_smoke_library_01",
			},
			status: "completed",
		},
		{
			conversationKey: "curriculum",
			key: "curriculum-semester-4",
			prompt: "法学民族班培养方案里大二下有什么课？",
			requestedScope: {
				collection: "curriculum_plan",
				corpus: "curriculum",
			},
			response: {
				answerText: "第四学期有中国少数民族文字学、侵权责任法、翻译学导论。",
				error: null,
				followUpQuestion: "",
				observability: {
					aclAnomalyCode: null,
					aclDecision: "allowed",
					cachedInputTokens: 0,
					candidateCount: 3,
					citationCount: 1,
					citationExpected: true,
					citationMissing: false,
					estimatedCostMicrousd: 4120,
					failClosed: false,
					inputTokens: 201,
					modelName: "gpt-5.4-mini",
					modelProvider: "openai",
					outputTokens: 79,
					refusalClass: null,
					resolvedScopeCollection: "curriculum_plan",
					resolvedScopeCorpus: "curriculum",
					retrievedSourceCount: 1,
					retrievalAttempted: true,
				},
				result: {
					diagnostics: {
						resolved_program_family_title: "民族班",
						resolved_entity_type: "program",
						rewritten_query: "法学民族实验班培养方案里第四学期有什么课",
						session_program_family: "民族实验班",
						session_program: "法学民族实验班",
						session_semester: "第四学期",
					},
					evidence: {
						collection: "curriculum_plan",
						corpus: "curriculum",
						query_text: "法学民族班培养方案里大二下有什么课？",
						sources: [
							{
								doc_id: "curriculum:法学（民族实验班）本科人才培养方案",
								source_title: "法学（民族实验班）本科人才培养方案",
							},
						],
					},
				},
				selectedTarget: "rag-agent",
				status: "completed",
				traceId: "trace_smoke_curriculum_01",
			},
			status: "completed",
		},
		{
			conversationKey: "curriculum",
			key: "curriculum-semester-2-follow-up",
			prompt: "那大一下呢？",
			requestedScope: {
				collection: "curriculum_plan",
				corpus: "curriculum",
			},
			response: {
				answerText: "第二学期有中国法制史。",
				error: null,
				followUpQuestion: "",
				observability: {
					aclAnomalyCode: null,
					aclDecision: "allowed",
					cachedInputTokens: 0,
					candidateCount: 2,
					citationCount: 1,
					citationExpected: true,
					citationMissing: false,
					estimatedCostMicrousd: 2970,
					failClosed: false,
					inputTokens: 126,
					modelName: "gpt-5.4-mini",
					modelProvider: "openai",
					outputTokens: 42,
					refusalClass: null,
					resolvedScopeCollection: "curriculum_plan",
					resolvedScopeCorpus: "curriculum",
					retrievedSourceCount: 1,
					retrievalAttempted: true,
				},
				result: {
					diagnostics: {
						resolved_program_family_title: "民族班",
						resolved_entity_type: "program",
						rewritten_query: "法学民族实验班培养方案里第二学期有什么课",
						session_program_family: "民族实验班",
						session_program: "法学民族实验班",
						session_semester: "第二学期",
					},
					evidence: {
						collection: "curriculum_plan",
						corpus: "curriculum",
						query_text: "那大一下呢？",
						sources: [
							{
								doc_id: "curriculum:法学（民族实验班）本科人才培养方案",
								source_title: "法学（民族实验班）本科人才培养方案",
							},
						],
					},
				},
				selectedTarget: "rag-agent",
				status: "completed",
				traceId: "trace_smoke_curriculum_02",
			},
			status: "completed",
		},
		{
			conversationKey: "clarification",
			key: "clarification-major-options",
			prompt: "民族班都有什么专业？",
			requestedScope: {
				collection: "curriculum_plan",
				corpus: "curriculum",
			},
			response: {
				answerText: "",
				error: null,
				followUpQuestion: "你想看哪个学院或哪个专业方向？我可以继续帮你缩小范围。",
				observability: {
					aclAnomalyCode: null,
					aclDecision: "allowed",
					cachedInputTokens: 0,
					candidateCount: 2,
					citationCount: 0,
					citationExpected: false,
					citationMissing: false,
					estimatedCostMicrousd: 1880,
					failClosed: false,
					inputTokens: 96,
					modelName: "gpt-5.4-mini",
					modelProvider: "openai",
					outputTokens: 33,
					refusalClass: null,
					resolvedScopeCollection: "curriculum_plan",
					resolvedScopeCorpus: "curriculum",
					retrievedSourceCount: 0,
					retrievalAttempted: true,
				},
				result: {
					diagnostics: {
						clarification_reason: "program_family_missing",
						semantic_outcome: "needs_clarification",
						scope_class: "curriculum_lookup",
					},
				},
				selectedTarget: "rag-agent",
				status: "needs_clarification",
				traceId: "trace_smoke_clarification_01",
			},
			status: "needs_clarification",
		},
		{
			conversationKey: "no-answer",
			key: "no-answer-mars-campus",
			prompt: "民大 2035 年火星校区什么时候开学？",
			requestedScope: {
				collection: "student_rules",
				corpus: "regulations",
			},
			response: {
				answerText: "当前没有足够依据回答这个问题。",
				error: null,
				followUpQuestion: "",
				observability: {
					aclAnomalyCode: null,
					aclDecision: "allowed",
					cachedInputTokens: 0,
					candidateCount: 0,
					citationCount: 0,
					citationExpected: false,
					citationMissing: false,
					estimatedCostMicrousd: 1440,
					failClosed: false,
					inputTokens: 88,
					modelName: "gpt-5.4-mini",
					modelProvider: "openai",
					outputTokens: 22,
					refusalClass: null,
					resolvedScopeCollection: "student_rules",
					resolvedScopeCorpus: "regulations",
					retrievedSourceCount: 0,
					retrievalAttempted: true,
				},
				result: {
					diagnostics: {
						no_answer_reason: "resolved_policy_clause_not_found",
						semantic_outcome: "no_answer",
						rewritten_query: "中央民族大学 火星校区 开学 时间",
					},
				},
				selectedTarget: "rag-agent",
				status: "no_answer",
				traceId: "trace_smoke_no_answer_01",
			},
			status: "no_answer",
		},
	];
}

function resolveSslConfig(databaseSslMode: string) {
	return databaseSslMode === "disable"
		? false
		: {
				rejectUnauthorized: false as const,
			};
}

function resolveOperatorConnectionString(env: NodeJS.ProcessEnv): string {
	const connectionString =
		env.APP_API_OPERATOR_DATABASE_URL?.trim() || env.APP_API_MANAGEMENT_DATABASE_URL?.trim();
	if (!connectionString) {
		throw new Error(
			"APP_API_OPERATOR_DATABASE_URL is required. Legacy APP_API_MANAGEMENT_DATABASE_URL is accepted as a compatibility alias.",
		);
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

async function readJsonResponse(response: Response): Promise<unknown> {
	const text = await response.text();
	if (!text) {
		return null;
	}

	try {
		return JSON.parse(text);
	} catch {
		return text;
	}
}

async function expectJsonResponse<T>(response: Response, expectedStatus: number): Promise<T> {
	const payload = await readJsonResponse(response);
	if (response.status !== expectedStatus) {
		throw new Error(
			`Expected ${expectedStatus}, received ${response.status}: ${JSON.stringify(payload)}`,
		);
	}

	return payload as T;
}

function splitSetCookieHeader(value: string): string[] {
	return value
		.split(/,(?=\s*[^;,=\s]+=[^;]+)/)
		.map((item) => item.trim())
		.filter(Boolean);
}

function buildCookieHeader(response: Response): string {
	const headersWithGetSetCookie = response.headers as Headers & {
		getSetCookie?: () => string[];
	};
	const setCookies =
		typeof headersWithGetSetCookie.getSetCookie === "function"
			? headersWithGetSetCookie.getSetCookie()
			: splitSetCookieHeader(response.headers.get("set-cookie") ?? "");

	if (setCookies.length === 0) {
		throw new Error("Expected auth response to include a session cookie.");
	}

	return setCookies
		.map((cookie) => cookie.split(";", 1)[0])
		.filter((cookie): cookie is string => typeof cookie === "string" && cookie.length > 0)
		.join("; ");
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
	if (!left && !right) {
		return true;
	}
	if (!left || !right) {
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

async function signInSmokeIdentity(input: {
	appFetch: (request: Request) => Promise<Response> | Response;
	captchaToken: string;
	email: string;
	password: string;
	publicChatOrigin: string;
}): Promise<string> {
	const response = await input.appFetch(
		new Request("https://app-api.internal/api/auth/sign-in/email", {
			body: JSON.stringify({
				email: input.email,
				password: input.password,
			}),
			headers: {
				"content-type": "application/json",
				origin: input.publicChatOrigin,
				referer: `${input.publicChatOrigin.replace(/\/$/, "")}/login`,
				"x-captcha-response": input.captchaToken,
			},
			method: "POST",
		}),
	);
	const payload = await readJsonResponse(response);
	if (!response.ok) {
		throw new Error(
			`Smoke identity sign-in failed (${response.status}): ${JSON.stringify(payload)}`,
		);
	}

	return buildCookieHeader(response);
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

async function main() {
	const args = parseRequestSmokeSeedArgs(process.argv.slice(2));
	const provisionInput = readSmokeIdentityProvisionInput(
		["--email", args.email, "--name", args.name],
		process.env,
	);
	const runtimeEnv = buildSmokeIdentityProvisionRuntimeEnv(provisionInput);
	const client = new Client({
		connectionString: resolveOperatorConnectionString(process.env),
		ssl: resolveSslConfig(readDatabaseSslMode(process.env)),
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

function isDirectExecution(): boolean {
	const entry = process.argv[1];
	if (!entry) {
		return false;
	}

	return import.meta.url === pathToFileURL(entry).href;
}

if (isDirectExecution()) {
	void main().catch((error: unknown) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	});
}
