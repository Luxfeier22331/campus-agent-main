import { createHash, randomUUID } from "node:crypto";

import { AppApiRouteError } from "../../http";
import type {
	StoredWeChatOfficialAccountRun,
	WeChatOfficialAccountArtifactRecord,
	WeChatOfficialAccountCommandStore,
	WeChatOfficialAccountRunStatus,
	WeChatOfficialAccountTerminalRunStatus,
} from "./store";

export interface WeChatOfficialAccountCollectorPrincipal {
	kind: "service";
	serviceClass: "wechat_official_account_collector";
	serviceId: "wechat-official-account-collector";
}

export interface WeChatOfficialAccountStartPayload {
	accountName?: unknown;
	accountSlug?: unknown;
	collectorVersion?: unknown;
	provider?: unknown;
	providerBaseUrl?: unknown;
	requestSummary?: unknown;
	schedulerRunKey?: unknown;
	startedAt?: unknown;
	triggerType?: unknown;
}

export interface WeChatOfficialAccountHeartbeatPayload {
	counts?: unknown;
	observedAt?: unknown;
	sequence?: unknown;
}

export interface WeChatOfficialAccountFinalizePayload {
	artifacts?: unknown;
	error?: unknown;
	finishedAt?: unknown;
	summary?: unknown;
	terminalStatus?: unknown;
}

export interface WeChatOfficialAccountCommandService {
	start(input: {
		payload: WeChatOfficialAccountStartPayload;
		principal: WeChatOfficialAccountCollectorPrincipal;
	}): Promise<{ run: WeChatOfficialAccountRunResponse }>;
	heartbeat(input: {
		payload: WeChatOfficialAccountHeartbeatPayload;
		principal: WeChatOfficialAccountCollectorPrincipal;
		runId: string;
	}): Promise<{
		run: Pick<WeChatOfficialAccountRunResponse, "runId" | "status"> & {
			lastHeartbeatAt: string | null;
		};
	}>;
	finalize(input: {
		payload: WeChatOfficialAccountFinalizePayload;
		principal: WeChatOfficialAccountCollectorPrincipal;
		runId: string;
	}): Promise<{ run: WeChatOfficialAccountRunResponse & { finishedAt: string | null } }>;
	getRun(input: { runId: string }): Promise<
		| (StoredWeChatOfficialAccountRun & {
				artifacts: WeChatOfficialAccountArtifactRecord[];
		  })
		| null
	>;
	listRuns(input: { limit?: number }): Promise<{ runs: unknown[] }>;
}

export interface WeChatOfficialAccountCommandServiceDependencies {
	computeFinalizeFingerprint?: (value: unknown) => string;
	computeStartFingerprint?: (value: unknown) => string;
	generateId?: (prefix: string) => string;
	now?: () => Date;
	store: WeChatOfficialAccountCommandStore;
}

export interface WeChatOfficialAccountRunResponse {
	accountSlug: string;
	provider: "feedwe";
	runId: string;
	sourceChannel: "wechat_official_account";
	startedAt: string;
	status: WeChatOfficialAccountRunStatus;
}

interface NormalizedStartPayload {
	accountName: string;
	accountSlug: string;
	collectorVersion: string;
	provider: "feedwe";
	providerBaseUrl: string;
	requestSummary: Record<string, unknown>;
	schedulerRunKey: string;
	startedAt: string;
	triggerType: string;
}

interface NormalizedFinalizePayload {
	artifacts: WeChatOfficialAccountArtifactRecord[];
	error: { code: string | null; message: string | null };
	finishedAt: string;
	summary: Record<string, number>;
	terminalStatus: WeChatOfficialAccountTerminalRunStatus;
}

const TERMINAL_STATUSES = new Set<WeChatOfficialAccountRunStatus>([
	"completed",
	"completed_with_errors",
	"failed",
	"abandoned",
]);
const FINALIZEABLE_TERMINAL_STATUSES = new Set<WeChatOfficialAccountTerminalRunStatus>([
	"completed",
	"completed_with_errors",
	"failed",
]);
const ALLOWED_ARTIFACT_TYPES = new Set([
	"provider_response",
	"request_summary",
	"page_fetch_metadata",
	"page_raw_html",
	"source_truth_article_manifest",
	"source_truth_content_blocks",
	"source_truth_media_refs",
]);

export function defaultGenerateId(prefix: string): string {
	return `${prefix}_${randomUUID().replace(/-/g, "")}`;
}

export function defaultComputeFingerprint(value: unknown): string {
	return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function normalizeString(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function normalizeIsoTimestamp(value: unknown, field: string): string {
	const normalized = normalizeString(value);
	if (!normalized) {
		throwValidation(field, `${field} is required.`);
	}

	const timestamp = new Date(normalized);
	if (Number.isNaN(timestamp.valueOf())) {
		throwValidation(field, `${field} must be a valid ISO timestamp.`);
	}

	return timestamp.toISOString();
}

function normalizeNumericRecord(value: unknown, field: string): Record<string, number> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throwValidation(field, `${field} must be an object.`);
	}

	const normalized: Record<string, number> = {};
	for (const [key, candidate] of Object.entries(value as Record<string, unknown>)) {
		if (typeof candidate !== "number" || !Number.isFinite(candidate) || candidate < 0) {
			throwValidation(`${field}.${key}`, `${field}.${key} must be a non-negative number.`);
		}
		normalized[key] = candidate;
	}
	return normalized;
}

function normalizeRecord(value: unknown, field: string): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throwValidation(field, `${field} must be an object.`);
	}
	return { ...(value as Record<string, unknown>) };
}

function normalizePositiveInteger(value: unknown, field: string): number {
	if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
		throwValidation(field, `${field} must be a positive integer.`);
	}
	return value;
}

function normalizeNullableInteger(value: unknown, field: string): number | null {
	if (value == null) {
		return null;
	}
	if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
		throwValidation(field, `${field} must be a non-negative integer when provided.`);
	}
	return value;
}

function normalizeNullableString(value: unknown): string | null {
	const normalized = normalizeString(value);
	return normalized || null;
}

function throwValidation(field: string, message: string): never {
	throw new AppApiRouteError({
		code: "validation_failed",
		details: { field },
		message,
		retryable: false,
		status: 422,
	});
}

function requireCollectorPrincipal(principal: WeChatOfficialAccountCollectorPrincipal): void {
	if (
		principal.kind !== "service" ||
		principal.serviceClass !== "wechat_official_account_collector"
	) {
		throw new AppApiRouteError({
			code: "service_credential_required",
			message: "Collector service credential required.",
			retryable: false,
			status: 401,
		});
	}
}

function normalizeStartPayload(payload: WeChatOfficialAccountStartPayload): NormalizedStartPayload {
	const provider = normalizeString(payload.provider);
	if (provider !== "feedwe") {
		throwValidation("provider", "provider must be feedwe.");
	}

	const accountName = normalizeString(payload.accountName);
	const accountSlug = normalizeString(payload.accountSlug);
	const collectorVersion = normalizeString(payload.collectorVersion);
	const providerBaseUrl = normalizeString(payload.providerBaseUrl);
	const schedulerRunKey = normalizeString(payload.schedulerRunKey);
	const triggerType = normalizeString(payload.triggerType) || "manual";
	if (!(accountName && accountSlug && collectorVersion && providerBaseUrl && schedulerRunKey)) {
		throwValidation(
			"payload",
			"accountName, accountSlug, collectorVersion, providerBaseUrl, and schedulerRunKey are required.",
		);
	}

	return {
		accountName,
		accountSlug,
		collectorVersion,
		provider,
		providerBaseUrl,
		requestSummary: normalizeRecord(payload.requestSummary, "requestSummary"),
		schedulerRunKey,
		startedAt: normalizeIsoTimestamp(payload.startedAt, "startedAt"),
		triggerType,
	};
}

function normalizeArtifacts(
	value: unknown,
	accountSlug: string,
): WeChatOfficialAccountArtifactRecord[] {
	if (!Array.isArray(value)) {
		throwValidation("artifacts", "artifacts must be an array.");
	}

	return value.map((item, index) => {
		if (!item || typeof item !== "object" || Array.isArray(item)) {
			throwValidation(`artifacts[${index}]`, "artifact must be an object.");
		}
		const artifact = item as Record<string, unknown>;
		const artifactType = normalizeString(artifact.artifactType);
		const objectKey = normalizeString(artifact.objectKey);
		const contentSha256 = normalizeString(artifact.contentSha256);
		if (!ALLOWED_ARTIFACT_TYPES.has(artifactType)) {
			throwValidation(`artifacts[${index}].artifactType`, "artifactType is not allowed.");
		}
		if (!(objectKey && contentSha256)) {
			throwValidation(
				`artifacts[${index}]`,
				"artifactType, objectKey, and contentSha256 are required.",
			);
		}
		if (!isAllowedSourceBucketArtifactKey(objectKey, accountSlug, artifactType)) {
			throw new AppApiRouteError({
				code: "invalid_artifact_ref",
				details: { objectKey },
				message:
					"artifact objectKey must stay inside the WeChat source-bucket capture/provider/source-truth families.",
				retryable: false,
				status: 400,
			});
		}

		return {
			artifactType,
			byteSize: normalizeNullableInteger(artifact.byteSize, `artifacts[${index}].byteSize`),
			contentSha256,
			objectKey,
			recordCount: normalizeNullableInteger(
				artifact.recordCount,
				`artifacts[${index}].recordCount`,
			),
		};
	});
}

function isAllowedSourceBucketArtifactKey(
	objectKey: string,
	accountSlug: string,
	artifactType: string,
): boolean {
	const prefix = `wechat_official_account/${accountSlug}/`;
	if (!objectKey.startsWith(prefix)) {
		return false;
	}
	if (objectKey.includes("/source-truth/") || objectKey.includes("/projection/")) {
		return isAllowedSourceTruthArtifactKey(objectKey, artifactType);
	}
	if (artifactType === "provider_response") {
		return objectKey.endsWith("/provider/feedwe/provider-response.jsonl");
	}
	if (artifactType === "request_summary") {
		return objectKey.endsWith("/capture/feedwe-request-summary.json");
	}
	if (artifactType === "page_fetch_metadata") {
		return objectKey.endsWith("/capture/wechat-article-fetch-metadata.json");
	}
	if (artifactType === "page_raw_html") {
		return objectKey.endsWith("/capture/wechat-article-page.html");
	}
	return false;
}

function isAllowedSourceTruthArtifactKey(objectKey: string, artifactType: string): boolean {
	if (objectKey.includes("/projection/")) {
		return false;
	}
	if (artifactType === "source_truth_article_manifest") {
		return objectKey.endsWith("/source-truth/article-manifest.json");
	}
	if (artifactType === "source_truth_content_blocks") {
		return objectKey.endsWith("/source-truth/content-blocks.jsonl");
	}
	if (artifactType === "source_truth_media_refs") {
		return objectKey.endsWith("/source-truth/media-refs.jsonl");
	}
	return false;
}

function normalizeFinalizePayload(
	payload: WeChatOfficialAccountFinalizePayload,
	accountSlug: string,
): NormalizedFinalizePayload {
	const terminalStatus = normalizeString(payload.terminalStatus);
	if (
		!FINALIZEABLE_TERMINAL_STATUSES.has(terminalStatus as WeChatOfficialAccountTerminalRunStatus)
	) {
		throwValidation("terminalStatus", "terminalStatus is not allowed.");
	}

	const errorRecord =
		payload.error && typeof payload.error === "object" && !Array.isArray(payload.error)
			? (payload.error as Record<string, unknown>)
			: {};

	return {
		artifacts: normalizeArtifacts(payload.artifacts, accountSlug),
		error: {
			code: normalizeNullableString(errorRecord.code),
			message: normalizeNullableString(errorRecord.message),
		},
		finishedAt: normalizeIsoTimestamp(payload.finishedAt, "finishedAt"),
		summary: normalizeNumericRecord(payload.summary, "summary"),
		terminalStatus: terminalStatus as WeChatOfficialAccountTerminalRunStatus,
	};
}

function buildRunResponse(run: StoredWeChatOfficialAccountRun): WeChatOfficialAccountRunResponse {
	return {
		accountSlug: run.accountSlug,
		provider: run.provider,
		runId: run.runId,
		sourceChannel: run.sourceChannel,
		startedAt: run.startedAt,
		status: run.status,
	};
}

function ensureRunExists(
	run: StoredWeChatOfficialAccountRun | null,
	runId: string,
): StoredWeChatOfficialAccountRun {
	if (!run) {
		throw new AppApiRouteError({
			code: "run_not_found",
			message: `WeChat official-account run not found: ${runId}`,
			retryable: false,
			status: 404,
		});
	}
	return run;
}

export function buildWeChatOfficialAccountCommandService(
	dependencies: WeChatOfficialAccountCommandServiceDependencies,
): WeChatOfficialAccountCommandService {
	const computeFinalizeFingerprint =
		dependencies.computeFinalizeFingerprint ?? ((payload) => defaultComputeFingerprint(payload));
	const computeStartFingerprint =
		dependencies.computeStartFingerprint ?? ((payload) => defaultComputeFingerprint(payload));
	const generateId = dependencies.generateId ?? defaultGenerateId;
	const now = dependencies.now ?? (() => new Date());

	return {
		async start(input) {
			requireCollectorPrincipal(input.principal);
			const normalized = normalizeStartPayload(input.payload);
			const startFingerprintSha256 = computeStartFingerprint(normalized);
			const existing = await dependencies.store.getRunBySchedulerKey(
				normalized.provider,
				normalized.accountSlug,
				normalized.schedulerRunKey,
			);

			if (existing) {
				if (existing.startFingerprintSha256 !== startFingerprintSha256) {
					throw new AppApiRouteError({
						code: "idempotency_conflict",
						message: "schedulerRunKey already exists with a different payload.",
						retryable: false,
						status: 409,
					});
				}
				return { run: buildRunResponse(existing) };
			}

			const runId = generateId("wcrun");
			const run = await dependencies.store.acceptRun({
				run: {
					...normalized,
					finishedAt: null,
					lastHeartbeatAt: null,
					latestHeartbeatSequence: 0,
					runId,
					sourceChannel: "wechat_official_account",
					startFingerprintSha256,
					status: "accepted",
					summary: null,
					terminalErrorCode: null,
					terminalErrorMessage: null,
					terminalPayloadSha256: null,
				},
			});

			return { run: buildRunResponse(run) };
		},

		async heartbeat(input) {
			requireCollectorPrincipal(input.principal);
			const existing = ensureRunExists(
				await dependencies.store.getRunById(normalizeString(input.runId)),
				input.runId,
			);
			if (TERMINAL_STATUSES.has(existing.status)) {
				throw new AppApiRouteError({
					code: existing.status === "abandoned" ? "run_abandoned" : "run_not_active",
					message:
						existing.status === "abandoned"
							? "WeChat official-account run is already abandoned."
							: "WeChat official-account run is already terminal.",
					retryable: false,
					status: 409,
				});
			}

			const sequence = normalizePositiveInteger(input.payload.sequence, "sequence");
			if (sequence <= existing.latestHeartbeatSequence) {
				throw new AppApiRouteError({
					code: "heartbeat_out_of_order",
					message: "Heartbeat sequence must increase monotonically.",
					retryable: false,
					status: 409,
				});
			}
			const observedAt = normalizeIsoTimestamp(input.payload.observedAt, "observedAt");
			const counts = normalizeNumericRecord(input.payload.counts, "counts");
			const nextRun = await dependencies.store.appendHeartbeat({
				heartbeat: {
					counts,
					createdAt: now().toISOString(),
					heartbeatId: generateId("wchb"),
					observedAt,
					runId: existing.runId,
					sequence,
				},
				run: {
					...existing,
					lastHeartbeatAt: observedAt,
					latestHeartbeatSequence: sequence,
					status: "running",
					summary: counts,
				},
			});

			return {
				run: {
					lastHeartbeatAt: nextRun.lastHeartbeatAt,
					runId: nextRun.runId,
					status: nextRun.status,
				},
			};
		},

		async finalize(input) {
			requireCollectorPrincipal(input.principal);
			const existing = ensureRunExists(
				await dependencies.store.getRunById(normalizeString(input.runId)),
				input.runId,
			);
			if (existing.status === "abandoned") {
				throw new AppApiRouteError({
					code: "run_abandoned",
					message: "WeChat official-account run is already abandoned.",
					retryable: false,
					status: 409,
				});
			}

			const normalized = normalizeFinalizePayload(input.payload, existing.accountSlug);
			const terminalPayloadSha256 = computeFinalizeFingerprint(normalized);
			if (TERMINAL_STATUSES.has(existing.status)) {
				if (existing.terminalPayloadSha256 === terminalPayloadSha256) {
					return { run: { ...buildRunResponse(existing), finishedAt: existing.finishedAt } };
				}
				throw new AppApiRouteError({
					code: "run_already_finalized",
					message: "WeChat official-account run is already finalized with a different payload.",
					retryable: false,
					status: 409,
				});
			}

			const nextRun = await dependencies.store.finalizeRun({
				artifacts: normalized.artifacts,
				run: {
					...existing,
					finishedAt: normalized.finishedAt,
					status: normalized.terminalStatus,
					summary: normalized.summary,
					terminalErrorCode: normalized.error.code,
					terminalErrorMessage: normalized.error.message,
					terminalPayloadSha256,
				},
			});

			return { run: { ...buildRunResponse(nextRun), finishedAt: nextRun.finishedAt } };
		},

		async getRun(input) {
			const run = await dependencies.store.getRunById(input.runId);
			if (!run) {
				return null;
			}
			return {
				...run,
				artifacts: await dependencies.store.getRunArtifacts(run.runId),
			};
		},

		async listRuns(input) {
			return { runs: await dependencies.store.listRuns({ limit: input.limit ?? 50 }) };
		},
	};
}
