import { randomUUID } from "node:crypto";
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
import { fetchReadyz, signInE2eIdentity } from "./support/staging-smoke-support";

interface ReadyzProbe {
	payload: unknown;
	status: number;
}

interface ChatMemoryE2eStagingArgs {
	appApiReadyzUrl: string;
	captchaToken: string;
	chatBaseUrl: string;
	email: string;
	memoryValue: string;
	observabilityCanary: ObservabilityCanarySubmitHeaders | null;
	password: string;
	prompt: string;
}

interface ObservabilityCanarySubmitHeaders {
	apiKeySentinel: string;
	headerSentinel: string;
}

interface SubmitIdentity {
	answerText: string;
	conversationId: string;
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
		activityAttempt?: number;
		runId: string;
		sanitizedPayload: Record<string, unknown>;
		status: string;
		stepId: string;
		stepKind: string;
		updatedAt?: string;
	}>;
}

interface ProfileMemoryItemSnapshot {
	itemId: string;
	key: string;
	revision: number;
	state: "synced" | "saving" | "deleting" | "failed";
	value: string;
}

interface ProfileMemorySnapshot {
	items: ProfileMemoryItemSnapshot[];
	lifecycleState: "active" | "paused" | "erasing" | "erased";
	syncStatus: "synced" | "pending" | "failed";
}

interface ProfileMemoryMutationSnapshot {
	item?: ProfileMemoryItemSnapshot;
	lifecycleState: ProfileMemorySnapshot["lifecycleState"];
	syncStatus: ProfileMemorySnapshot["syncStatus"];
}

interface MemoryRecallProof {
	outcome: "matched" | "no_match";
	status: "completed";
	stepId: string;
}

interface MemoryAppendProof {
	skipReasons: string[];
	status: "completed" | "skipped";
	stepId: "memory.append";
}

interface ChatRunProof {
	answerContainsExpected: boolean | null;
	answerExcludesForbidden: boolean | null;
	append: MemoryAppendProof;
	conversationId: string;
	recall: MemoryRecallProof | null;
	requestId: string;
	resultKind: string;
	runId: string;
	runtimeTraceId: string;
	traceId: string;
	visibleToolNames: string[];
}

export interface ChatMemoryE2eStagingResult {
	lifecycle: {
		erased: "erased" | null;
		initial: "active" | null;
		paused: "paused" | null;
		reactivated: "active" | null;
		resumed: "active" | null;
	};
	memory: {
		createdRevision: number | null;
		deleted: boolean;
		itemId: string | null;
		updatedRevision: number | null;
	};
	passed: boolean;
	readyz: {
		appApiStatus: number | null;
		chatStatus: number | null;
	};
	runs: {
		conversationAppend: ChatRunProof | null;
		conversationRecall: ChatRunProof | null;
		deletedProbe: ChatRunProof | null;
		explicitRecall: ChatRunProof | null;
		paused: ChatRunProof | null;
		resumed: ChatRunProof | null;
	};
	signInAttempted: boolean;
}

export interface ChatMemoryE2eStagingDependencies {
	fetchJsonWithCookie?: typeof fetchJsonWithCookie;
	fetchReadyz?: (url: string) => Promise<ReadyzProbe>;
	signInIdentity?: (input: {
		captchaToken: string;
		chatBaseUrl: string;
		email: string;
		password: string;
	}) => Promise<string>;
	sleep?: (milliseconds: number) => Promise<void>;
	openSubmitStream?: (input: {
		body: unknown;
		cookieHeader: string;
		observabilityCanary: ObservabilityCanarySubmitHeaders | null;
		url: string;
	}) => Promise<Response>;
}

const OBSERVABILITY_CANARY_HEADER_SENTINEL_PATTERN = /^header-[A-Za-z0-9._:-]{5,249}$/u;
const OBSERVABILITY_CANARY_API_KEY_SENTINEL_PATTERN = /^credential-[A-Za-z0-9._:-]{1,245}$/u;
const PROFILE_MEMORY_POLL_INTERVAL_MS = 2_000;
const PROFILE_MEMORY_POLL_ATTEMPTS = 60;
const RUN_STEPS_POLL_INTERVAL_MS = 2_000;
const RUN_STEPS_POLL_ATTEMPTS = 60;
const PROFILE_MEMORY_KEY = "smoke_memory_probe";
const PERSONAL_MEMORY_RECALL_TOOL = "personal_memory_recall";

async function defaultSleep(milliseconds: number): Promise<void> {
	await new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

function normalizeOptionalValue(value: string | undefined): string | null {
	if (typeof value !== "string") {
		return null;
	}

	const trimmed = value.trim();
	return trimmed ? trimmed : null;
}

function parseArgs(argv: string[]): ChatMemoryE2eStagingArgs {
	let appApiReadyzUrl = DEFAULT_STAGING_CHAT_E2E_APP_API_READYZ_URL;
	let captchaToken = "";
	let chatBaseUrl = DEFAULT_STAGING_CHAT_E2E_CHAT_BASE_URL;
	let email = "";
	let memoryValue = `smoke memory sentinel ${Date.now()}`;
	let observabilityCanaryApiKeySentinel: string | null = null;
	let observabilityCanaryHeaderSentinel: string | null = null;
	let password = "";
	let prompt = "请完整复述你记住的 smoke_memory_probe 值，只输出该值。";

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
		if (token === "--password") {
			const value = normalizeOptionalValue(argv[index + 1]);
			if (!value) {
				throw new Error("--password requires a non-empty value.");
			}
			password = value;
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

	if (!email) {
		throw new Error("--email is required.");
	}
	if (!password) {
		throw new Error("--password is required.");
	}
	if (!captchaToken) {
		throw new Error("--captcha-token is required.");
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
		captchaToken,
		chatBaseUrl,
		email,
		memoryValue,
		observabilityCanary:
			observabilityCanaryHeaderSentinel === null || observabilityCanaryApiKeySentinel === null
				? null
				: {
						apiKeySentinel: observabilityCanaryApiKeySentinel,
						headerSentinel: observabilityCanaryHeaderSentinel,
					},
		password,
		prompt,
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
		"idempotency-key": `chat-memory-e2e-staging-${randomUUID()}`,
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

async function readSubmitIdentity(
	event: ProductStreamEvent,
	accepted: Pick<SubmitIdentity, "requestId" | "runId" | "traceId">,
): Promise<SubmitIdentity> {
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
	const requestId = requireStringField(event.data, "requestId");
	const traceId = requireStringField(event.data, "traceId");
	if (requestId !== accepted.requestId || traceId !== accepted.traceId) {
		throw new Error("request.completed identity does not match request.accepted.");
	}
	return {
		answerText: requireStringField(resultRecord, "text"),
		conversationId: requireStringField(conversation as Record<string, unknown>, "id"),
		requestId,
		resultKind: requireStringField(resultRecord, "kind"),
		runId: accepted.runId,
		runtimeTraceId: await deriveLangfuseTraceId(traceId),
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
			return await readSubmitIdentity(event, accepted);
		}
	}
	throw new Error("Memory chat submit stream ended before request.completed.");
}

function readStringArray(value: unknown, field: string): string[] {
	if (!Array.isArray(value) || value.some((candidate) => typeof candidate !== "string")) {
		throw new Error(`${field} must be a string array.`);
	}
	return [...value];
}

function readAgentVisibleToolNames(trajectory: RuntimeStepTrajectory): string[] | null {
	const step = trajectory.steps.filter((candidate) => candidate.stepId === "agent.primary").at(-1);
	if (!step) {
		return null;
	}
	return readStringArray(step.sanitizedPayload.visible_tool_names, "visible_tool_names");
}

function hasMemoryRecallStep(trajectory: RuntimeStepTrajectory): boolean {
	return trajectory.steps.some((candidate) =>
		candidate.stepId.startsWith(`sdk_tool.execute.${PERSONAL_MEMORY_RECALL_TOOL}.`),
	);
}

function readMemoryRecallProof(trajectory: RuntimeStepTrajectory): MemoryRecallProof | null {
	const step = trajectory.steps
		.filter((candidate) =>
			candidate.stepId.startsWith(`sdk_tool.execute.${PERSONAL_MEMORY_RECALL_TOOL}.`),
		)
		.at(-1);
	if (step?.status !== "completed") {
		return null;
	}
	const result = trajectory.results.find(
		(candidate) => candidate.stepId === step.stepId && candidate.resultKind === "typed_tool_result",
	);
	if (!result) {
		return null;
	}
	if (result.sanitizedPayload.tool_name !== PERSONAL_MEMORY_RECALL_TOOL) {
		throw new Error("Personal memory tool result has an invalid tool_name.");
	}
	const outcome = result.sanitizedPayload.outcome;
	if (outcome !== "matched" && outcome !== "no_match") {
		throw new Error("Personal memory tool result has an invalid outcome.");
	}
	if (!result.projectionRef.trim()) {
		throw new Error("Personal memory tool result is missing projectionRef.");
	}
	return {
		outcome,
		status: "completed",
		stepId: step.stepId,
	};
}

function readMemoryAppendProof(trajectory: RuntimeStepTrajectory): MemoryAppendProof | null {
	const step = trajectory.steps.filter((candidate) => candidate.stepId === "memory.append").at(-1);
	if (!step || (step.status !== "completed" && step.status !== "skipped")) {
		return null;
	}
	if (step.sanitizedPayload.status !== step.status) {
		throw new Error("memory.append projection status does not match the step status.");
	}
	return {
		skipReasons: readStringArray(step.sanitizedPayload.skip_reasons, "memory.append skip_reasons"),
		status: step.status,
		stepId: "memory.append",
	};
}

async function readProfileMemory(input: {
	cookieHeader: string;
	fetchJsonWithCookie: NonNullable<ChatMemoryE2eStagingDependencies["fetchJsonWithCookie"]>;
	url: string;
}): Promise<ProfileMemorySnapshot> {
	const response = await input.fetchJsonWithCookie<{ profileMemory: ProfileMemorySnapshot }>({
		cookieHeader: input.cookieHeader,
		expectedStatus: 200,
		url: input.url,
	});
	return response.payload.profileMemory;
}

async function waitForProfileMemory(input: {
	cookieHeader: string;
	description: string;
	fetchJsonWithCookie: NonNullable<ChatMemoryE2eStagingDependencies["fetchJsonWithCookie"]>;
	ready: (profileMemory: ProfileMemorySnapshot) => boolean;
	sleep: NonNullable<ChatMemoryE2eStagingDependencies["sleep"]>;
	url: string;
}): Promise<ProfileMemorySnapshot> {
	for (let attempt = 1; attempt <= PROFILE_MEMORY_POLL_ATTEMPTS; attempt += 1) {
		const profileMemory = await readProfileMemory(input);
		if (profileMemory.syncStatus === "failed") {
			throw new Error(`Profile memory failed while waiting for ${input.description}.`);
		}
		if (profileMemory.items.some((item) => item.state === "failed")) {
			throw new Error(`A profile memory item failed while waiting for ${input.description}.`);
		}
		if (input.ready(profileMemory)) {
			return profileMemory;
		}
		if (attempt < PROFILE_MEMORY_POLL_ATTEMPTS) {
			await input.sleep(PROFILE_MEMORY_POLL_INTERVAL_MS);
		}
	}
	throw new Error(`Timed out waiting for ${input.description}.`);
}

function requireProfileMemoryState(
	profileMemory: ProfileMemorySnapshot | ProfileMemoryMutationSnapshot,
	lifecycleState: ProfileMemorySnapshot["lifecycleState"],
	syncStatus: ProfileMemorySnapshot["syncStatus"],
	label: string,
): void {
	if (profileMemory.lifecycleState !== lifecycleState || profileMemory.syncStatus !== syncStatus) {
		throw new Error(
			`${label} is ${profileMemory.lifecycleState}/${profileMemory.syncStatus}, expected ${lifecycleState}/${syncStatus}.`,
		);
	}
}

function requireAcceptedItem(input: {
	item: ProfileMemoryItemSnapshot | undefined;
	itemId?: string;
	key: string;
	revision?: number;
	value: string;
}): ProfileMemoryItemSnapshot {
	const item = input.item;
	if (!item) {
		throw new Error("Profile memory mutation response is missing the accepted item.");
	}
	if (
		item.state !== "saving" ||
		item.key !== input.key ||
		item.value !== input.value ||
		(input.itemId !== undefined && item.itemId !== input.itemId) ||
		(input.revision !== undefined && item.revision !== input.revision)
	) {
		throw new Error("Profile memory mutation response does not match the accepted item.");
	}
	if (!Number.isSafeInteger(item.revision) || item.revision < 1) {
		throw new Error("Profile memory mutation response has an invalid revision.");
	}
	return item;
}

async function waitForProfileMemoryItem(input: {
	cookieHeader: string;
	deleted?: boolean;
	expectedRevision?: number;
	expectedValue?: string;
	fetchJsonWithCookie: NonNullable<ChatMemoryE2eStagingDependencies["fetchJsonWithCookie"]>;
	itemId: string;
	sleep: NonNullable<ChatMemoryE2eStagingDependencies["sleep"]>;
	url: string;
}): Promise<ProfileMemorySnapshot> {
	return await waitForProfileMemory({
		...input,
		description: input.deleted
			? `profile memory item ${input.itemId} deletion`
			: `profile memory item ${input.itemId} synchronization`,
		ready(profileMemory) {
			const item = profileMemory.items.find((candidate) => candidate.itemId === input.itemId);
			if (input.deleted) {
				return profileMemory.syncStatus === "synced" && !item;
			}
			return (
				profileMemory.syncStatus === "synced" &&
				item?.state === "synced" &&
				(input.expectedRevision === undefined || item.revision === input.expectedRevision) &&
				(input.expectedValue === undefined || item.value === input.expectedValue)
			);
		},
	});
}

async function waitForProfileMemoryLifecycle(input: {
	cookieHeader: string;
	empty: boolean;
	fetchJsonWithCookie: NonNullable<ChatMemoryE2eStagingDependencies["fetchJsonWithCookie"]>;
	lifecycleState: ProfileMemorySnapshot["lifecycleState"];
	sleep: NonNullable<ChatMemoryE2eStagingDependencies["sleep"]>;
	url: string;
}): Promise<ProfileMemorySnapshot> {
	return await waitForProfileMemory({
		...input,
		description: `profile memory lifecycle ${input.lifecycleState}/synced`,
		ready(profileMemory) {
			return (
				profileMemory.lifecycleState === input.lifecycleState &&
				profileMemory.syncStatus === "synced" &&
				(!input.empty || profileMemory.items.length === 0)
			);
		},
	});
}

async function waitForRunProof(input: {
	appApiBaseUrl: string;
	appendStatus: MemoryAppendProof["status"];
	cookieHeader: string;
	expectedAnswerText?: string;
	fetchJsonWithCookie: NonNullable<ChatMemoryE2eStagingDependencies["fetchJsonWithCookie"]>;
	forbiddenAnswerText?: string;
	recall: "absent" | "matched" | "optional";
	sleep: NonNullable<ChatMemoryE2eStagingDependencies["sleep"]>;
	submit: SubmitIdentity;
	visibleTools: "disabled" | "enabled";
}): Promise<ChatRunProof> {
	if (input.submit.resultKind !== "answer") {
		throw new Error(`Memory chat returned ${input.submit.resultKind}, expected answer.`);
	}
	const answerContainsExpected = input.expectedAnswerText
		? input.submit.answerText.includes(input.expectedAnswerText)
		: null;
	if (answerContainsExpected === false) {
		throw new Error("Memory chat answer did not contain the expected sentinel.");
	}
	const answerExcludesForbidden = input.forbiddenAnswerText
		? !input.submit.answerText.includes(input.forbiddenAnswerText)
		: null;
	if (answerExcludesForbidden === false) {
		throw new Error("Memory chat answer still contained the deleted sentinel.");
	}

	for (let attempt = 1; attempt <= RUN_STEPS_POLL_ATTEMPTS; attempt += 1) {
		const stepsResult = await input.fetchJsonWithCookie<RuntimeStepTrajectory>({
			cookieHeader: input.cookieHeader,
			expectedStatus: 200,
			method: "GET",
			url: new URL(
				`/api/chat/runs/${encodeURIComponent(input.submit.runId)}/steps`,
				input.appApiBaseUrl,
			).toString(),
		});
		const trajectory = stepsResult.payload;
		const visibleToolNames = readAgentVisibleToolNames(trajectory);
		const append = readMemoryAppendProof(trajectory);
		const recall = readMemoryRecallProof(trajectory);
		if (visibleToolNames === null || append === null || (input.recall === "matched" && !recall)) {
			if (attempt < RUN_STEPS_POLL_ATTEMPTS) {
				await input.sleep(RUN_STEPS_POLL_INTERVAL_MS);
				continue;
			}
			break;
		}
		if (
			input.visibleTools === "enabled" &&
			!visibleToolNames.includes(PERSONAL_MEMORY_RECALL_TOOL)
		) {
			throw new Error("agent.primary did not expose personal_memory_recall.");
		}
		if (input.visibleTools === "disabled" && visibleToolNames.length > 0) {
			throw new Error("agent.primary exposed tools while profile memory was paused.");
		}
		if (append.status !== input.appendStatus) {
			throw new Error(`memory.append status is ${append.status}, expected ${input.appendStatus}.`);
		}
		if (
			input.appendStatus === "skipped" &&
			(append.skipReasons.length !== 1 || append.skipReasons[0] !== "memory_disabled")
		) {
			throw new Error("Paused memory.append did not report memory_disabled.");
		}
		if (input.appendStatus === "completed" && append.skipReasons.length > 0) {
			throw new Error("Completed memory.append unexpectedly reported skip reasons.");
		}
		if (input.recall === "absent" && hasMemoryRecallStep(trajectory)) {
			throw new Error("Personal memory recall ran while profile memory was paused.");
		}
		if (input.recall === "matched" && recall?.outcome !== "matched") {
			throw new Error("Personal memory recall did not match the staged memory.");
		}
		return {
			answerContainsExpected,
			answerExcludesForbidden,
			append,
			conversationId: input.submit.conversationId,
			recall,
			requestId: input.submit.requestId,
			resultKind: input.submit.resultKind,
			runId: input.submit.runId,
			runtimeTraceId: input.submit.runtimeTraceId,
			traceId: input.submit.traceId,
			visibleToolNames,
		};
	}
	throw new Error(`Timed out waiting for memory projections for run ${input.submit.runId}.`);
}

async function submitAndProveMemoryRun(input: {
	appApiBaseUrl: string;
	appendStatus: MemoryAppendProof["status"];
	body: unknown;
	cookieHeader: string;
	expectedAnswerText?: string;
	fetchJsonWithCookie: NonNullable<ChatMemoryE2eStagingDependencies["fetchJsonWithCookie"]>;
	forbiddenAnswerText?: string;
	observabilityCanary: ObservabilityCanarySubmitHeaders | null;
	openSubmitStream: NonNullable<ChatMemoryE2eStagingDependencies["openSubmitStream"]>;
	recall: "absent" | "matched" | "optional";
	sleep: NonNullable<ChatMemoryE2eStagingDependencies["sleep"]>;
	submitUrl: string;
	visibleTools: "disabled" | "enabled";
}): Promise<ChatRunProof> {
	const submit = await submitStream({
		body: input.body,
		cookieHeader: input.cookieHeader,
		observabilityCanary: input.observabilityCanary,
		openSubmitStream: input.openSubmitStream,
		url: input.submitUrl,
	});
	return await waitForRunProof({
		appApiBaseUrl: input.appApiBaseUrl,
		appendStatus: input.appendStatus,
		cookieHeader: input.cookieHeader,
		...(input.expectedAnswerText ? { expectedAnswerText: input.expectedAnswerText } : {}),
		fetchJsonWithCookie: input.fetchJsonWithCookie,
		...(input.forbiddenAnswerText ? { forbiddenAnswerText: input.forbiddenAnswerText } : {}),
		recall: input.recall,
		sleep: input.sleep,
		submit,
		visibleTools: input.visibleTools,
	});
}

async function eraseAndReactivateProfileMemory(input: {
	chatBaseUrl: string;
	cookieHeader: string;
	fetchJsonWithCookie: NonNullable<ChatMemoryE2eStagingDependencies["fetchJsonWithCookie"]>;
	operationId: string;
	profileMemoryUrl: string;
	sleep: NonNullable<ChatMemoryE2eStagingDependencies["sleep"]>;
}): Promise<void> {
	const eraseResult = await input.fetchJsonWithCookie<{
		profileMemory: ProfileMemoryMutationSnapshot;
	}>({
		cookieHeader: input.cookieHeader,
		expectedStatus: 202,
		idempotencyKey: `chat-memory-e2e-erase-${input.operationId}`,
		method: "DELETE",
		url: input.profileMemoryUrl,
	});
	requireProfileMemoryState(eraseResult.payload.profileMemory, "erasing", "pending", "Owner erase");
	await waitForProfileMemoryLifecycle({
		cookieHeader: input.cookieHeader,
		empty: true,
		fetchJsonWithCookie: input.fetchJsonWithCookie,
		lifecycleState: "erased",
		sleep: input.sleep,
		url: input.profileMemoryUrl,
	});

	const reactivateResult = await input.fetchJsonWithCookie<{
		profileMemory: ProfileMemoryMutationSnapshot;
	}>({
		body: { enabled: true },
		cookieHeader: input.cookieHeader,
		expectedStatus: 202,
		idempotencyKey: `chat-memory-e2e-reactivate-${input.operationId}`,
		method: "PATCH",
		url: new URL("/api/me/profile-memory/settings", input.chatBaseUrl).toString(),
	});
	requireProfileMemoryState(
		reactivateResult.payload.profileMemory,
		"active",
		"pending",
		"Owner reactivation",
	);
	await waitForProfileMemoryLifecycle({
		cookieHeader: input.cookieHeader,
		empty: true,
		fetchJsonWithCookie: input.fetchJsonWithCookie,
		lifecycleState: "active",
		sleep: input.sleep,
		url: input.profileMemoryUrl,
	});
}

export async function runChatMemoryE2eStaging(
	argv: string[],
	deps: ChatMemoryE2eStagingDependencies = {},
): Promise<ChatMemoryE2eStagingResult> {
	const args = parseArgs(argv);
	const resolvedDeps = {
		fetchJsonWithCookie: deps.fetchJsonWithCookie ?? fetchJsonWithCookie,
		fetchReadyz: deps.fetchReadyz ?? fetchReadyz,
		openSubmitStream: deps.openSubmitStream ?? openChatMemorySubmitStream,
		signInIdentity: deps.signInIdentity ?? signInE2eIdentity,
		sleep: deps.sleep ?? defaultSleep,
	};
	const operationId = randomUUID();
	const updatedMemoryValue = `${Array.from(args.memoryValue).slice(0, 440).join("")} ${randomUUID()}`;
	const conversationMemorySentinel = `conversation-memory-${randomUUID()}`;
	const result: ChatMemoryE2eStagingResult = {
		lifecycle: {
			erased: null,
			initial: null,
			paused: null,
			reactivated: null,
			resumed: null,
		},
		memory: {
			createdRevision: null,
			deleted: false,
			itemId: null,
			updatedRevision: null,
		},
		passed: false,
		readyz: {
			appApiStatus: null,
			chatStatus: null,
		},
		runs: {
			conversationAppend: null,
			conversationRecall: null,
			deletedProbe: null,
			explicitRecall: null,
			paused: null,
			resumed: null,
		},
		signInAttempted: false,
	};

	const appApiReadyz = await resolvedDeps.fetchReadyz(args.appApiReadyzUrl);
	result.readyz.appApiStatus = appApiReadyz.status;
	const chatReadyz = await resolvedDeps.fetchReadyz(
		new URL("/readyz", args.chatBaseUrl).toString(),
	);
	result.readyz.chatStatus = chatReadyz.status;

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
	}>({
		cookieHeader,
		expectedStatus: 200,
		url: new URL("/api/me", args.chatBaseUrl).toString(),
	});
	if (!meResult.payload.permissions.chat) {
		throw new Error("E2E identity does not have chat permission.");
	}

	const profileMemoryUrl = new URL("/api/me/profile-memory", args.chatBaseUrl).toString();
	const submitUrl = new URL("/api/chat/requests/stream", args.chatBaseUrl).toString();
	let cleanupCompleted = false;
	let primaryError: unknown;
	try {
		const initialProfileMemory = await readProfileMemory({
			cookieHeader,
			fetchJsonWithCookie: resolvedDeps.fetchJsonWithCookie,
			url: profileMemoryUrl,
		});
		requireProfileMemoryState(initialProfileMemory, "active", "synced", "Initial profile memory");
		result.lifecycle.initial = "active";

		const existingItem = initialProfileMemory.items.find(
			(candidate) => candidate.key === PROFILE_MEMORY_KEY,
		);
		if (existingItem) {
			const precleanResult = await resolvedDeps.fetchJsonWithCookie<{
				profileMemory: ProfileMemoryMutationSnapshot;
			}>({
				cookieHeader,
				expectedStatus: 202,
				idempotencyKey: `chat-memory-e2e-preclean-${operationId}`,
				method: "DELETE",
				url: new URL(
					`/api/me/profile-memory/items/${encodeURIComponent(existingItem.itemId)}`,
					args.chatBaseUrl,
				).toString(),
			});
			requireProfileMemoryState(
				precleanResult.payload.profileMemory,
				"active",
				"pending",
				"Profile memory preclean",
			);
			await waitForProfileMemoryItem({
				cookieHeader,
				deleted: true,
				fetchJsonWithCookie: resolvedDeps.fetchJsonWithCookie,
				itemId: existingItem.itemId,
				sleep: resolvedDeps.sleep,
				url: profileMemoryUrl,
			});
		}

		const createResult = await resolvedDeps.fetchJsonWithCookie<{
			profileMemory: ProfileMemoryMutationSnapshot;
		}>({
			body: { key: PROFILE_MEMORY_KEY, value: args.memoryValue },
			cookieHeader,
			expectedStatus: 202,
			idempotencyKey: `chat-memory-e2e-create-${operationId}`,
			method: "POST",
			url: new URL("/api/me/profile-memory/items", args.chatBaseUrl).toString(),
		});
		requireProfileMemoryState(
			createResult.payload.profileMemory,
			"active",
			"pending",
			"Item create",
		);
		const createdItem = requireAcceptedItem({
			item: createResult.payload.profileMemory.item,
			key: PROFILE_MEMORY_KEY,
			value: args.memoryValue,
		});
		result.memory.itemId = createdItem.itemId;
		result.memory.createdRevision = createdItem.revision;
		await waitForProfileMemoryItem({
			cookieHeader,
			expectedRevision: createdItem.revision,
			expectedValue: args.memoryValue,
			fetchJsonWithCookie: resolvedDeps.fetchJsonWithCookie,
			itemId: createdItem.itemId,
			sleep: resolvedDeps.sleep,
			url: profileMemoryUrl,
		});

		const updateResult = await resolvedDeps.fetchJsonWithCookie<{
			profileMemory: ProfileMemoryMutationSnapshot;
		}>({
			body: { key: PROFILE_MEMORY_KEY, value: updatedMemoryValue },
			cookieHeader,
			expectedStatus: 202,
			idempotencyKey: `chat-memory-e2e-update-${operationId}`,
			method: "PATCH",
			url: new URL(
				`/api/me/profile-memory/items/${encodeURIComponent(createdItem.itemId)}`,
				args.chatBaseUrl,
			).toString(),
		});
		requireProfileMemoryState(
			updateResult.payload.profileMemory,
			"active",
			"pending",
			"Item update",
		);
		const updatedItem = requireAcceptedItem({
			item: updateResult.payload.profileMemory.item,
			itemId: createdItem.itemId,
			key: PROFILE_MEMORY_KEY,
			revision: createdItem.revision + 1,
			value: updatedMemoryValue,
		});
		result.memory.updatedRevision = updatedItem.revision;
		await waitForProfileMemoryItem({
			cookieHeader,
			expectedRevision: updatedItem.revision,
			expectedValue: updatedMemoryValue,
			fetchJsonWithCookie: resolvedDeps.fetchJsonWithCookie,
			itemId: updatedItem.itemId,
			sleep: resolvedDeps.sleep,
			url: profileMemoryUrl,
		});

		result.runs.explicitRecall = await submitAndProveMemoryRun({
			appApiBaseUrl: args.appApiReadyzUrl,
			appendStatus: "completed",
			body: { prompt: args.prompt },
			cookieHeader,
			expectedAnswerText: updatedMemoryValue,
			fetchJsonWithCookie: resolvedDeps.fetchJsonWithCookie,
			observabilityCanary: args.observabilityCanary,
			openSubmitStream: resolvedDeps.openSubmitStream,
			recall: "matched",
			sleep: resolvedDeps.sleep,
			submitUrl,
			visibleTools: "enabled",
		});

		result.runs.conversationAppend = await submitAndProveMemoryRun({
			appApiBaseUrl: args.appApiReadyzUrl,
			appendStatus: "completed",
			body: {
				prompt: `请记住：我的会话记忆测试代号是 ${conversationMemorySentinel}。请简短确认。`,
			},
			cookieHeader,
			fetchJsonWithCookie: resolvedDeps.fetchJsonWithCookie,
			observabilityCanary: args.observabilityCanary,
			openSubmitStream: resolvedDeps.openSubmitStream,
			recall: "optional",
			sleep: resolvedDeps.sleep,
			submitUrl,
			visibleTools: "enabled",
		});

		result.runs.conversationRecall = await submitAndProveMemoryRun({
			appApiBaseUrl: args.appApiReadyzUrl,
			appendStatus: "completed",
			body: { prompt: "我的会话记忆测试代号是什么？请只回答代号。" },
			cookieHeader,
			expectedAnswerText: conversationMemorySentinel,
			fetchJsonWithCookie: resolvedDeps.fetchJsonWithCookie,
			observabilityCanary: args.observabilityCanary,
			openSubmitStream: resolvedDeps.openSubmitStream,
			recall: "matched",
			sleep: resolvedDeps.sleep,
			submitUrl,
			visibleTools: "enabled",
		});

		const pauseResult = await resolvedDeps.fetchJsonWithCookie<{
			profileMemory: ProfileMemoryMutationSnapshot;
		}>({
			body: { enabled: false },
			cookieHeader,
			expectedStatus: 202,
			idempotencyKey: `chat-memory-e2e-pause-${operationId}`,
			method: "PATCH",
			url: new URL("/api/me/profile-memory/settings", args.chatBaseUrl).toString(),
		});
		requireProfileMemoryState(
			pauseResult.payload.profileMemory,
			"paused",
			"pending",
			"Owner pause",
		);
		await waitForProfileMemoryLifecycle({
			cookieHeader,
			empty: false,
			fetchJsonWithCookie: resolvedDeps.fetchJsonWithCookie,
			lifecycleState: "paused",
			sleep: resolvedDeps.sleep,
			url: profileMemoryUrl,
		});
		result.lifecycle.paused = "paused";

		result.runs.paused = await submitAndProveMemoryRun({
			appApiBaseUrl: args.appApiReadyzUrl,
			appendStatus: "skipped",
			body: { prompt: "请复述我的 smoke_memory_probe 值。" },
			cookieHeader,
			fetchJsonWithCookie: resolvedDeps.fetchJsonWithCookie,
			observabilityCanary: args.observabilityCanary,
			openSubmitStream: resolvedDeps.openSubmitStream,
			recall: "absent",
			sleep: resolvedDeps.sleep,
			submitUrl,
			visibleTools: "disabled",
		});

		const resumeResult = await resolvedDeps.fetchJsonWithCookie<{
			profileMemory: ProfileMemoryMutationSnapshot;
		}>({
			body: { enabled: true },
			cookieHeader,
			expectedStatus: 202,
			idempotencyKey: `chat-memory-e2e-resume-${operationId}`,
			method: "PATCH",
			url: new URL("/api/me/profile-memory/settings", args.chatBaseUrl).toString(),
		});
		requireProfileMemoryState(
			resumeResult.payload.profileMemory,
			"active",
			"pending",
			"Owner resume",
		);
		await waitForProfileMemoryLifecycle({
			cookieHeader,
			empty: false,
			fetchJsonWithCookie: resolvedDeps.fetchJsonWithCookie,
			lifecycleState: "active",
			sleep: resolvedDeps.sleep,
			url: profileMemoryUrl,
		});
		result.lifecycle.resumed = "active";

		result.runs.resumed = await submitAndProveMemoryRun({
			appApiBaseUrl: args.appApiReadyzUrl,
			appendStatus: "completed",
			body: { prompt: "请完整复述你记住的 smoke_memory_probe 值，只输出该值。" },
			cookieHeader,
			expectedAnswerText: updatedMemoryValue,
			fetchJsonWithCookie: resolvedDeps.fetchJsonWithCookie,
			observabilityCanary: args.observabilityCanary,
			openSubmitStream: resolvedDeps.openSubmitStream,
			recall: "matched",
			sleep: resolvedDeps.sleep,
			submitUrl,
			visibleTools: "enabled",
		});

		const deleteResult = await resolvedDeps.fetchJsonWithCookie<{
			profileMemory: ProfileMemoryMutationSnapshot;
		}>({
			cookieHeader,
			expectedStatus: 202,
			idempotencyKey: `chat-memory-e2e-delete-${operationId}`,
			method: "DELETE",
			url: new URL(
				`/api/me/profile-memory/items/${encodeURIComponent(createdItem.itemId)}`,
				args.chatBaseUrl,
			).toString(),
		});
		requireProfileMemoryState(
			deleteResult.payload.profileMemory,
			"active",
			"pending",
			"Item delete",
		);
		await waitForProfileMemoryItem({
			cookieHeader,
			deleted: true,
			fetchJsonWithCookie: resolvedDeps.fetchJsonWithCookie,
			itemId: createdItem.itemId,
			sleep: resolvedDeps.sleep,
			url: profileMemoryUrl,
		});
		result.memory.deleted = true;

		result.runs.deletedProbe = await submitAndProveMemoryRun({
			appApiBaseUrl: args.appApiReadyzUrl,
			appendStatus: "completed",
			body: { prompt: "请完整复述你记住的 smoke_memory_probe 值，只输出该值。" },
			cookieHeader,
			fetchJsonWithCookie: resolvedDeps.fetchJsonWithCookie,
			forbiddenAnswerText: updatedMemoryValue,
			observabilityCanary: args.observabilityCanary,
			openSubmitStream: resolvedDeps.openSubmitStream,
			recall: "optional",
			sleep: resolvedDeps.sleep,
			submitUrl,
			visibleTools: "enabled",
		});

		await eraseAndReactivateProfileMemory({
			chatBaseUrl: args.chatBaseUrl,
			cookieHeader,
			fetchJsonWithCookie: resolvedDeps.fetchJsonWithCookie,
			operationId,
			profileMemoryUrl,
			sleep: resolvedDeps.sleep,
		});
		cleanupCompleted = true;
		result.lifecycle.erased = "erased";
		result.lifecycle.reactivated = "active";
		result.passed = true;
	} catch (error) {
		primaryError = error;
	}

	if (!cleanupCompleted) {
		try {
			await eraseAndReactivateProfileMemory({
				chatBaseUrl: args.chatBaseUrl,
				cookieHeader,
				fetchJsonWithCookie: resolvedDeps.fetchJsonWithCookie,
				operationId: `${operationId}-cleanup-${randomUUID()}`,
				profileMemoryUrl,
				sleep: resolvedDeps.sleep,
			});
		} catch (cleanupError) {
			if (primaryError !== undefined) {
				throw new AggregateError(
					[primaryError, cleanupError],
					"Memory staging smoke failed and account cleanup also failed.",
				);
			}
			throw cleanupError;
		}
	}
	if (primaryError !== undefined) {
		throw primaryError;
	}
	return result;
}

export async function main(argv: string[]) {
	const result = await runChatMemoryE2eStaging(argv);
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
