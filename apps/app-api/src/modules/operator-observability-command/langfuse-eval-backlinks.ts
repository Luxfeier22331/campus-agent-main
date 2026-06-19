import { AppApiRouteError } from "../../http";
import type {
	LangfuseEvalBacklinkProjectionWrite,
	OperatorObservabilityCommandStore,
} from "./store";

const FORBIDDEN_LANGFUSE_EVAL_BACKLINK_FIELDS = new Set([
	"answer",
	"authorization",
	"cookie",
	"jwt",
	"prompt",
	"providerrawresponse",
	"rawanswer",
	"rawprompt",
	"rawtranscript",
	"retrievedsnippet",
	"snippet",
	"sourcebody",
	"transcript",
]);
const SAFE_EXTERNAL_LINK_PROTOCOLS = new Set(["http:", "https:"]);

export interface OperatorLangfuseEvalBacklinkPayloadItem {
	requestId?: unknown;
	traceId?: unknown;
	evalRunId?: unknown;
	scoreName?: unknown;
	scoreValue?: unknown;
	release?: unknown;
	environment?: unknown;
	langfuseUrl?: unknown;
	[key: string]: unknown;
}

export interface OperatorLangfuseEvalBacklinksPayload {
	backlinks?: unknown;
}

export async function ingestLangfuseEvalBacklinks(input: {
	now: () => Date;
	payload: OperatorLangfuseEvalBacklinksPayload;
	store: OperatorObservabilityCommandStore;
}): Promise<{ accepted: number }> {
	const backlinks = ensureArray<OperatorLangfuseEvalBacklinkPayloadItem>(
		input.payload.backlinks,
		"backlinks",
	);
	const writes: LangfuseEvalBacklinkProjectionWrite[] = [];
	const upsertLangfuseEvalBacklinks = input.store.upsertLangfuseEvalBacklinks;
	if (!upsertLangfuseEvalBacklinks) {
		throw new AppApiRouteError({
			code: "operator_store_not_ready",
			message: "Langfuse eval backlink projection store is not configured.",
			retryable: false,
			status: 500,
		});
	}

	for (let index = 0; index < backlinks.length; index += 1) {
		const item = backlinks[index] ?? {};
		const prefix = `backlinks[${index}]`;
		assertNoForbiddenLangfuseEvalBacklinkFields(item, prefix);
		const requestId = normalizeRequiredString(item.requestId, `${prefix}.requestId`);
		const traceId = normalizeRequiredString(item.traceId, `${prefix}.traceId`);
		const seed = await input.store.getRequestObservabilitySeed(requestId);
		if (!seed) {
			throw new AppApiRouteError({
				code: "request_not_found",
				details: { requestId },
				message: "Request observability seed not found.",
				retryable: false,
				status: 404,
			});
		}
		if (seed.traceId !== traceId) {
			throw new AppApiRouteError({
				code: "validation_failed",
				details: { field: `${prefix}.traceId`, requestId },
				message: `${prefix}.traceId must match the request-scoped traceId.`,
				retryable: false,
				status: 422,
			});
		}

		const evalRunId = normalizeRequiredString(item.evalRunId, `${prefix}.evalRunId`);
		const scoreName = normalizeRequiredString(item.scoreName, `${prefix}.scoreName`);
		const release = normalizeRequiredString(item.release, `${prefix}.release`);
		const environment = normalizeRequiredString(item.environment, `${prefix}.environment`);
		const scoreValue = normalizeScoreValue(item.scoreValue, `${prefix}.scoreValue`);
		const langfuseUrl = normalizeRequiredSafeExternalLink(
			item.langfuseUrl,
			`${prefix}.langfuseUrl`,
		);

		writes.push({
			environment,
			evalBacklinkId: buildLangfuseEvalBacklinkId({
				environment,
				evalRunId,
				release,
				scoreName,
				traceId,
			}),
			evalRunId,
			langfuseUrl,
			projectedAt: input.now().toISOString(),
			release,
			scoreName,
			scoreValue,
			traceId,
		});
	}

	await upsertLangfuseEvalBacklinks({ backlinks: writes });
	return { accepted: writes.length };
}

function assertNoForbiddenLangfuseEvalBacklinkFields(
	item: OperatorLangfuseEvalBacklinkPayloadItem,
	prefix: string,
): void {
	for (const key of Object.keys(item)) {
		if (FORBIDDEN_LANGFUSE_EVAL_BACKLINK_FIELDS.has(normalizePayloadKey(key))) {
			throw new AppApiRouteError({
				code: "validation_failed",
				details: { field: `${prefix}.${key}` },
				message: `${prefix}.${key} is forbidden in Langfuse eval backlink payloads.`,
				retryable: false,
				status: 422,
			});
		}
	}
}

function normalizeString(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function normalizeRequiredString(value: unknown, field: string): string {
	const normalized = normalizeString(value);
	if (!normalized) {
		throw new AppApiRouteError({
			code: "validation_failed",
			details: { field },
			message: `${field} is required.`,
			retryable: false,
			status: 422,
		});
	}
	return normalized;
}

function ensureArray<T>(value: unknown, field: string): T[] {
	if (!Array.isArray(value)) {
		throw new AppApiRouteError({
			code: "validation_failed",
			details: { field },
			message: `${field} must be an array.`,
			retryable: false,
			status: 422,
		});
	}
	return value as T[];
}

function normalizeScoreValue(value: unknown, field: string): string | number | boolean {
	if (
		typeof value === "string" ||
		(typeof value === "number" && Number.isFinite(value)) ||
		typeof value === "boolean"
	) {
		return value;
	}
	throw new AppApiRouteError({
		code: "validation_failed",
		details: { field },
		message: `${field} must be a string, finite number, or boolean.`,
		retryable: false,
		status: 422,
	});
}

function normalizeRequiredSafeExternalLink(value: unknown, field: string): string {
	const normalized = normalizeRequiredString(value, field);
	try {
		const parsed = new URL(normalized);
		if (SAFE_EXTERNAL_LINK_PROTOCOLS.has(parsed.protocol)) {
			return parsed.toString();
		}
	} catch {
		// Fall through to a uniform validation error.
	}
	throw new AppApiRouteError({
		code: "validation_failed",
		details: { field },
		message: `${field} must be an http(s) URL.`,
		retryable: false,
		status: 422,
	});
}

function normalizePayloadKey(value: string): string {
	return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function buildLangfuseEvalBacklinkId(input: {
	traceId: string;
	evalRunId: string;
	scoreName: string;
	release: string;
	environment: string;
}): string {
	return [input.traceId, input.evalRunId, input.scoreName, input.release, input.environment].join(
		":",
	);
}
