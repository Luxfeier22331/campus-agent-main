import process from "node:process";

import { deriveLangfuseTraceId } from "../src/modules/telemetry/trace";
import {
	DEFAULT_STAGING_CHAT_E2E_APP_API_READYZ_URL,
	DEFAULT_STAGING_CHAT_E2E_CHAT_BASE_URL,
} from "./support/chat-e2e.args";
import {
	expectEventStreamResponse,
	fetchJsonWithCookie,
	type ProductStreamEvent,
	parseSse,
} from "./support/http-smoke";
import { DEFAULT_SMOKE_EMAIL, DEFAULT_SMOKE_NAME } from "./support/smoke-identity-defaults";
import {
	buildSmokePassword,
	fetchReadyz,
	mintStagingSmokeSession,
} from "./support/staging-smoke-support";

interface ReadyzProbe {
	payload: unknown;
	status: number;
}

interface ChatMemoryE2eStagingArgs {
	appApiReadyzUrl: string;
	chatBaseUrl: string;
	email: string;
	memoryValue: string;
	name: string;
	observabilityCanary: ObservabilityCanarySubmitHeaders | null;
	prompt: string;
	smokeAuthSecret: string;
}

interface ObservabilityCanarySubmitHeaders {
	apiKeySentinel: string;
	headerSentinel: string;
}

interface SubmitIdentity {
	requestId: string;
	resultKind: string;
	runId: string;
	runtimeTraceId: string;
	traceId: string;
}

interface RuntimeStepTrajectory {
	results: Array<{
		projectionRef: string;
		resultKind: string;
		runId: string;
		sanitizedPayload: Record<string, unknown>;
		status: string;
		stepId: string;
	}>;
	steps: Array<{
		runId: string;
		sanitizedPayload: Record<string, unknown>;
		status: string;
		stepId: string;
		stepKind: string;
	}>;
}

export interface ChatMemoryE2eStagingResult {
	identity: {
		email: string;
		resetViaDeployedRuntime: true;
	};
	memory: {
		deleted: boolean;
		itemId: string | null;
		key: string;
	};
	passed: boolean;
	principal: unknown | null;
	readyz: {
		appApi: ReadyzProbe | null;
		chat: ReadyzProbe | null;
	};
	recall: {
		memoryRef: string;
		selectedMemoryCount: number;
		status: string;
		stepId: string;
	} | null;
	session: unknown | null;
	sessionMintAttempted: boolean;
	submit: SubmitIdentity | null;
}

export interface ChatMemoryE2eStagingDependencies {
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
	openSubmitStream?: (input: {
		body: unknown;
		cookieHeader: string;
		observabilityCanary: ObservabilityCanarySubmitHeaders | null;
		url: string;
	}) => Promise<Response>;
}

const OBSERVABILITY_CANARY_HEADER_SENTINEL_PATTERN = /^header-[A-Za-z0-9._:-]{5,249}$/u;
const OBSERVABILITY_CANARY_API_KEY_SENTINEL_PATTERN = /^credential-[A-Za-z0-9._:-]{1,245}$/u;

function normalizeOptionalValue(value: string | undefined): string | null {
	if (typeof value !== "string") {
		return null;
	}

	const trimmed = value.trim();
	return trimmed ? trimmed : null;
}

function parseArgs(argv: string[], env: NodeJS.ProcessEnv = process.env): ChatMemoryE2eStagingArgs {
	let appApiReadyzUrl = DEFAULT_STAGING_CHAT_E2E_APP_API_READYZ_URL;
	let chatBaseUrl = DEFAULT_STAGING_CHAT_E2E_CHAT_BASE_URL;
	let email = DEFAULT_SMOKE_EMAIL;
	let memoryValue = `smoke memory sentinel ${Date.now()}`;
	let name = DEFAULT_SMOKE_NAME;
	let observabilityCanaryApiKeySentinel: string | null = null;
	let observabilityCanaryHeaderSentinel: string | null = null;
	let prompt = "请根据你记住的 smoke memory sentinel 回答我。";
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
		if (token === "--memory-value") {
			const value = normalizeOptionalValue(argv[index + 1]);
			if (!value) {
				throw new Error("--memory-value requires a non-empty value.");
			}
			memoryValue = value;
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
		if (
			token === "--observability-canary-header-sentinel" ||
			token === "--observability-canary-api-key-sentinel"
		) {
			const value = normalizeOptionalValue(argv[index + 1]);
			const pattern =
				token === "--observability-canary-header-sentinel"
					? OBSERVABILITY_CANARY_HEADER_SENTINEL_PATTERN
					: OBSERVABILITY_CANARY_API_KEY_SENTINEL_PATTERN;
			if (!(value && pattern.test(value))) {
				throw new Error(`${token} requires a valid synthetic sentinel.`);
			}
			if (token === "--observability-canary-header-sentinel") {
				if (observabilityCanaryHeaderSentinel !== null) {
					throw new Error(`${token} may only be provided once.`);
				}
				observabilityCanaryHeaderSentinel = value;
			} else {
				if (observabilityCanaryApiKeySentinel !== null) {
					throw new Error(`${token} may only be provided once.`);
				}
				observabilityCanaryApiKeySentinel = value;
			}
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
	if (
		(observabilityCanaryHeaderSentinel === null) !==
		(observabilityCanaryApiKeySentinel === null)
	) {
		throw new Error("Observability canary header and API-key sentinels must be provided together.");
	}
	if (
		observabilityCanaryHeaderSentinel !== null &&
		observabilityCanaryHeaderSentinel === observabilityCanaryApiKeySentinel
	) {
		throw new Error("Observability canary header and API-key sentinels must be distinct.");
	}

	return {
		appApiReadyzUrl,
		chatBaseUrl,
		email,
		memoryValue,
		name,
		observabilityCanary:
			observabilityCanaryHeaderSentinel === null || observabilityCanaryApiKeySentinel === null
				? null
				: {
						apiKeySentinel: observabilityCanaryApiKeySentinel,
						headerSentinel: observabilityCanaryHeaderSentinel,
					},
		prompt,
		smokeAuthSecret,
	};
}

export async function openChatMemorySubmitStream(input: {
	body: unknown;
	cookieHeader: string;
	observabilityCanary: ObservabilityCanarySubmitHeaders | null;
	url: string;
}): Promise<Response> {
	const headers = new Headers({
		accept: "text/event-stream",
		"content-type": "application/json",
		cookie: input.cookieHeader,
		"idempotency-key": `chat-memory-e2e-staging-${Date.now()}`,
	});
	if (input.observabilityCanary) {
		headers.set("x-observability-canary", input.observabilityCanary.headerSentinel);
		headers.set("x-observability-canary-api-key", input.observabilityCanary.apiKeySentinel);
	}
	const response = await fetch(input.url, {
		body: JSON.stringify(input.body),
		headers,
		method: "POST",
		signal: AbortSignal.timeout(180_000),
	});
	await expectEventStreamResponse(response, "memory chat submit stream");
	return response;
}

function requireStringField(value: Record<string, unknown>, field: string): string {
	const raw = value[field];
	if (typeof raw !== "string" || !raw.trim()) {
		throw new Error(`${field} is required.`);
	}
	return raw;
}

function readSubmitIdentity(
	event: ProductStreamEvent,
	accepted: Pick<SubmitIdentity, "requestId" | "runId" | "traceId">,
): SubmitIdentity {
	const answer = event.data.answer;
	if (!answer || typeof answer !== "object" || Array.isArray(answer)) {
		throw new Error("request.completed must include answer payload.");
	}
	const result = (answer as Record<string, unknown>).result;
	if (!result || typeof result !== "object" || Array.isArray(result)) {
		throw new Error("request.completed answer must include result.");
	}
	const resultRecord = result as Record<string, unknown>;
	const requestId = requireStringField(event.data, "requestId");
	const traceId = requireStringField(event.data, "traceId");
	if (requestId !== accepted.requestId || traceId !== accepted.traceId) {
		throw new Error("request.completed identity does not match request.accepted.");
	}
	return {
		requestId,
		resultKind: requireStringField(resultRecord, "kind"),
		runId: accepted.runId,
		runtimeTraceId: deriveLangfuseTraceId(traceId),
		traceId,
	};
}

async function submitStream(input: {
	body: unknown;
	cookieHeader: string;
	openSubmitStream: NonNullable<ChatMemoryE2eStagingDependencies["openSubmitStream"]>;
	observabilityCanary: ObservabilityCanarySubmitHeaders | null;
	url: string;
}): Promise<SubmitIdentity> {
	const response = await input.openSubmitStream({
		body: input.body,
		cookieHeader: input.cookieHeader,
		observabilityCanary: input.observabilityCanary,
		url: input.url,
	});
	let accepted: Pick<SubmitIdentity, "requestId" | "runId" | "traceId"> | null = null;
	for await (const event of parseSse(response)) {
		if (event.event === "request.accepted") {
			accepted = {
				requestId: requireStringField(event.data, "requestId"),
				runId: requireStringField(event.data, "runId"),
				traceId: requireStringField(event.data, "traceId"),
			};
			continue;
		}
		if (event.event === "request.failed" || event.event === "request.cancelled") {
			const error = event.data.error;
			throw new Error(
				`Memory chat request reached ${event.event}: ${
					error && typeof error === "object" ? JSON.stringify(error) : JSON.stringify(event.data)
				}`,
			);
		}
		if (event.event === "request.completed") {
			if (!accepted) {
				throw new Error("Memory chat stream completed before request.accepted.");
			}
			return readSubmitIdentity(event, accepted);
		}
	}
	throw new Error("Memory chat submit stream ended before request.completed.");
}

function readNumber(value: Record<string, unknown>, field: string): number | null {
	const raw = value[field];
	return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
}

function readMemoryRecallProof(
	trajectory: RuntimeStepTrajectory,
): NonNullable<ChatMemoryE2eStagingResult["recall"]> {
	const step = trajectory.steps.find((candidate) => candidate.stepId === "memory.recall");
	if (!step) {
		throw new Error("Run steps are missing memory.recall.");
	}
	if (step.status !== "completed") {
		throw new Error(`memory.recall status is ${step.status}, expected completed.`);
	}
	const result = trajectory.results.find(
		(candidate) =>
			candidate.stepId === "memory.recall" && candidate.resultKind === "memory_recall_result",
	);
	if (!result) {
		throw new Error("Run steps are missing memory_recall_result.");
	}
	const memoryRef =
		typeof result.sanitizedPayload.memory_ref === "string"
			? result.sanitizedPayload.memory_ref.trim()
			: "";
	if (!memoryRef) {
		throw new Error("memory_recall_result is missing memory_ref.");
	}
	const selectedMemoryCount =
		readNumber(result.sanitizedPayload, "selected_memory_count") ??
		readNumber(step.sanitizedPayload, "selected_memory_count");
	if (!(typeof selectedMemoryCount === "number" && selectedMemoryCount > 0)) {
		throw new Error("memory_recall_result did not select any memory.");
	}
	return {
		memoryRef,
		selectedMemoryCount,
		status: step.status,
		stepId: step.stepId,
	};
}

export async function runChatMemoryE2eStaging(
	argv: string[],
	env: NodeJS.ProcessEnv = process.env,
	deps: ChatMemoryE2eStagingDependencies = {},
): Promise<ChatMemoryE2eStagingResult> {
	const args = parseArgs(argv, env);
	const resolvedDeps = {
		fetchJsonWithCookie: deps.fetchJsonWithCookie ?? fetchJsonWithCookie,
		fetchReadyz: deps.fetchReadyz ?? fetchReadyz,
		mintSmokeSession: deps.mintSmokeSession ?? mintStagingSmokeSession,
		openSubmitStream: deps.openSubmitStream ?? openChatMemorySubmitStream,
	};
	const result: ChatMemoryE2eStagingResult = {
		identity: {
			email: args.email,
			resetViaDeployedRuntime: true,
		},
		memory: {
			deleted: false,
			itemId: null,
			key: "smoke_memory_probe",
		},
		passed: false,
		principal: null,
		readyz: {
			appApi: null,
			chat: null,
		},
		recall: null,
		session: null,
		sessionMintAttempted: false,
		submit: null,
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

	await resolvedDeps.fetchJsonWithCookie({
		cookieHeader,
		expectedStatus: 200,
		url: new URL("/api/me/profile-memory", args.chatBaseUrl).toString(),
	});

	const upsertResult = await resolvedDeps.fetchJsonWithCookie<{
		item: {
			itemId: string;
			key: string;
			value: string;
		};
	}>({
		body: {
			key: result.memory.key,
			value: args.memoryValue,
		},
		cookieHeader,
		expectedStatus: 200,
		method: "POST",
		url: new URL("/api/me/profile-memory/items", args.chatBaseUrl).toString(),
	});
	result.memory.itemId = upsertResult.payload.item.itemId;
	try {
		const submit = await submitStream({
			body: {
				prompt: args.prompt,
			},
			cookieHeader,
			observabilityCanary: args.observabilityCanary,
			openSubmitStream: resolvedDeps.openSubmitStream,
			url: new URL("/api/chat/requests/stream", args.chatBaseUrl).toString(),
		});
		result.submit = submit;

		const stepsResult = await resolvedDeps.fetchJsonWithCookie<RuntimeStepTrajectory>({
			cookieHeader,
			expectedStatus: 200,
			method: "GET",
			url: new URL(
				`/api/chat/runs/${encodeURIComponent(submit.runId)}/steps`,
				args.appApiReadyzUrl,
			).toString(),
		});
		result.recall = readMemoryRecallProof(stepsResult.payload);
		result.passed = true;
		return result;
	} finally {
		if (result.memory.itemId) {
			const deleteResult = await resolvedDeps.fetchJsonWithCookie<{ deleted: boolean }>({
				cookieHeader,
				expectedStatus: 200,
				method: "DELETE",
				url: new URL(
					`/api/me/profile-memory/items/${encodeURIComponent(result.memory.itemId)}`,
					args.chatBaseUrl,
				).toString(),
			});
			result.memory.deleted = deleteResult.payload.deleted === true;
		}
	}
}

export async function main(argv: string[], env: NodeJS.ProcessEnv = process.env) {
	const result = await runChatMemoryE2eStaging(argv, env);
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
