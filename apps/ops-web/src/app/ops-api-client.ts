import type {
	ProviderConfigConnectionSummary,
	ProviderConfigProfileSummary,
} from "@campus-agent/provider-config";
import type {
	DiningCatalogCommand,
	DiningDraft,
	DiningOpsObservation,
	DiningOpsOverview,
	DiningOpsReview,
	DiningOpsSourceRun,
	DiningRelease,
	DiningReleaseDetail,
	DiningReviewCommand,
	DiningValidationReport,
} from "../shared/dining-contract";
import type {
	OpsOverviewWindow,
	OpsRequestSummary,
	OpsRequestWindow,
} from "../shared/ops-contract";
import {
	OpsInternalPortalAuthStatusSchema,
	OpsObservabilityResponseSchema,
	OpsOverviewResponseSchema,
	OpsRequestDetailResponseSchema,
	OpsRequestListResponseSchema,
} from "../shared/ops-contract";

export interface OpsRequestListParams {
	conversationId?: string;
	cursor?: string;
	limit?: number;
	previous?: string;
	q?: string;
	requestId?: string;
	status?: OpsRequestSummary["status"];
	traceId?: string;
	window?: OpsRequestWindow;
}

export class OpsApiError extends Error {
	readonly code: string;
	readonly details: Record<string, unknown>;
	readonly input: string;
	readonly reasonCode?: string;
	readonly status: number;

	constructor(
		message: string,
		input: string,
		status: number,
		code: string,
		reasonCode?: string,
		details: Record<string, unknown> = {},
	) {
		super(message);
		this.code = code;
		this.details = details;
		this.input = input;
		this.name = "OpsApiError";
		this.reasonCode = reasonCode;
		this.status = status;
	}
}

async function fetchJson(input: string, init?: RequestInit) {
	const response = await fetch(input, init);
	if (!response.ok) {
		const error = await readErrorBody(response);
		throw new OpsApiError(
			error.message ?? `请求失败：HTTP ${response.status}`,
			input,
			response.status,
			error.code ?? "OPS_API_REQUEST_FAILED",
			error.reasonCode,
			error.details ?? {},
		);
	}
	return response.json() as Promise<unknown>;
}

async function readErrorBody(response: Response): Promise<{
	code?: string;
	details?: Record<string, unknown>;
	message?: string;
	reasonCode?: string;
}> {
	try {
		const body = (await response.json()) as unknown;
		if (
			body &&
			typeof body === "object" &&
			"error" in body &&
			body.error &&
			typeof body.error === "object"
		) {
			const error = body.error as Record<string, unknown>;
			const details = Object.fromEntries(
				Object.entries(error).filter(
					([key, value]) => !["code", "message", "reasonCode"].includes(key) && value !== undefined,
				),
			);
			return {
				code: typeof error.code === "string" ? error.code : undefined,
				details,
				message: typeof error.message === "string" ? error.message : undefined,
				reasonCode: typeof error.reasonCode === "string" ? error.reasonCode : undefined,
			};
		}
	} catch {
		return {};
	}
	return {};
}

export async function fetchInternalPortalAuthStatus(input: { signal?: AbortSignal } = {}) {
	return OpsInternalPortalAuthStatusSchema.parse(
		await fetchJson("/api/ops/internal-portal-auth", { signal: input.signal }),
	);
}

export async function replaceInternalPortalCredential(credential: string) {
	return OpsInternalPortalAuthStatusSchema.parse(
		await fetchJson("/api/ops/internal-portal-auth", {
			body: JSON.stringify({ credential }),
			headers: { "content-type": "application/json" },
			method: "PUT",
		}),
	);
}

export async function resumeInternalPortalAuthMaintenance() {
	return OpsInternalPortalAuthStatusSchema.parse(
		await fetchJson("/api/ops/internal-portal-auth/maintenance/resume", { method: "POST" }),
	);
}

export async function fetchOpsRequests(
	params: OpsRequestListParams = {},
	input: { signal?: AbortSignal } = {},
) {
	const query = new URLSearchParams();
	const apiParams = {
		conversationId: params.conversationId,
		cursor: params.cursor,
		limit: params.limit,
		q: params.q,
		requestId: params.requestId,
		status: params.status,
		traceId: params.traceId,
		window: params.window,
	};
	for (const [key, value] of Object.entries(apiParams)) {
		if (value !== undefined && value !== "") {
			query.set(key, String(value));
		}
	}
	const search = query.toString();
	return OpsRequestListResponseSchema.parse(
		await fetchJson(`/api/ops/requests${search ? `?${search}` : ""}`, {
			signal: input.signal,
		}),
	);
}

export async function fetchOpsRequestDetail(
	requestId: string,
	input: { signal?: AbortSignal } = {},
) {
	return OpsRequestDetailResponseSchema.parse(
		await fetchJson(`/api/ops/requests/${encodeURIComponent(requestId)}`, { signal: input.signal }),
	);
}

export async function fetchOpsOverview(
	window: OpsOverviewWindow = "1h",
	input: { signal?: AbortSignal } = {},
) {
	const query = new URLSearchParams({ window });
	return OpsOverviewResponseSchema.parse(
		await fetchJson(`/api/ops/overview?${query.toString()}`, { signal: input.signal }),
	);
}

export async function fetchOpsObservability(
	requestId: string,
	kind: "logs" | "trace",
	input: { signal?: AbortSignal } = {},
) {
	const query = new URLSearchParams({ kind });
	return OpsObservabilityResponseSchema.parse(
		await fetchJson(
			`/api/ops/requests/${encodeURIComponent(requestId)}/observability?${query.toString()}`,
			{ signal: input.signal },
		),
	);
}

export async function fetchDiningOverview(input: { signal?: AbortSignal } = {}) {
	return fetchJson("/api/ops/dining/overview", {
		signal: input.signal,
	}) as Promise<DiningOpsOverview>;
}

export async function fetchDiningDraft(input: { signal?: AbortSignal } = {}) {
	return fetchJson("/api/ops/dining/catalog/draft", { signal: input.signal }) as Promise<{
		draft: DiningDraft;
	}>;
}

export async function fetchDiningValidation(input: { signal?: AbortSignal } = {}) {
	return fetchJson("/api/ops/dining/catalog/draft/validation", {
		signal: input.signal,
	}) as Promise<{ validation: DiningValidationReport }>;
}

export async function rebaseDiningDraft() {
	return fetchJson("/api/ops/dining/catalog/draft/rebase", { method: "POST" }) as Promise<{
		draft: DiningDraft;
	}>;
}

export async function applyDiningCatalogCommand(command: DiningCatalogCommand) {
	return fetchJson("/api/ops/dining/catalog/draft/commands", {
		body: JSON.stringify(command),
		headers: { "content-type": "application/json" },
		method: "POST",
	}) as Promise<{ draft: DiningDraft }>;
}

export async function publishDiningCatalog(notes: string) {
	return fetchJson("/api/ops/dining/catalog/publish", {
		body: JSON.stringify({ notes }),
		headers: { "content-type": "application/json" },
		method: "POST",
	}) as Promise<DiningReleaseDetail>;
}

export async function fetchDiningReleases(input: { signal?: AbortSignal } = {}) {
	return fetchJson("/api/ops/dining/releases", { signal: input.signal }) as Promise<{
		releases: DiningRelease[];
	}>;
}

export async function rollbackDiningRelease(releaseId: string, notes: string) {
	return fetchJson(`/api/ops/dining/releases/${encodeURIComponent(releaseId)}/rollback`, {
		body: JSON.stringify({ notes }),
		headers: { "content-type": "application/json" },
		method: "POST",
	}) as Promise<DiningReleaseDetail>;
}

export async function fetchDiningReviews(input: { signal?: AbortSignal } = {}) {
	return fetchJson("/api/ops/dining/reviews?limit=100", { signal: input.signal }) as Promise<{
		reviews: DiningOpsReview[];
	}>;
}

export async function fetchDiningSource(input: { signal?: AbortSignal } = {}) {
	const [runs, observations] = await Promise.all([
		fetchJson("/api/ops/dining/source-runs?limit=30", { signal: input.signal }) as Promise<{
			runs: DiningOpsSourceRun[];
		}>,
		fetchJson("/api/ops/dining/observations?limit=100", { signal: input.signal }) as Promise<{
			observations: DiningOpsObservation[];
		}>,
	]);
	return { observations: observations.observations, runs: runs.runs };
}

export async function applyDiningReviewCommand(reviewId: string, command: DiningReviewCommand) {
	return fetchJson(`/api/ops/dining/reviews/${encodeURIComponent(reviewId)}/commands`, {
		body: JSON.stringify(command),
		headers: { "content-type": "application/json" },
		method: "POST",
	}) as Promise<{ ok: true }>;
}

export async function fetchProviderConfig(input: { signal?: AbortSignal } = {}) {
	const [connections, profiles] = await Promise.all([
		fetchJson("/api/ops/provider-config/connections", { signal: input.signal }) as Promise<{
			connections: ProviderConfigConnectionSummary[];
		}>,
		fetchJson("/api/ops/provider-config/profiles", { signal: input.signal }) as Promise<{
			profiles: ProviderConfigProfileSummary[];
			runtime: {
				configured: boolean;
				digest: string | null;
				publicationId: string | null;
				profiles: Record<
					string,
					{ model: string; profileId: string; provider: string; revision: number }
				>;
				publishedAt: string | null;
				publishedBy: { displayName: string; principalId: string } | null;
			};
		}>,
	]);
	return {
		connections: connections.connections,
		profiles: profiles.profiles,
		runtime: profiles.runtime,
	};
}

export async function createProviderConnection(payload: Record<string, unknown>) {
	return fetchJson("/api/ops/provider-config/connections", {
		body: JSON.stringify(payload),
		headers: { "content-type": "application/json" },
		method: "POST",
	});
}
export async function createProviderProfile(payload: Record<string, unknown>) {
	return fetchJson("/api/ops/provider-config/profiles", {
		body: JSON.stringify(payload),
		headers: { "content-type": "application/json" },
		method: "POST",
	});
}
export async function updateProviderConnection(
	connectionId: string,
	payload: Record<string, unknown>,
) {
	return fetchJson(`/api/ops/provider-config/connections/${encodeURIComponent(connectionId)}`, {
		body: JSON.stringify(payload),
		headers: { "content-type": "application/json" },
		method: "PATCH",
	});
}
export async function updateProviderProfile(profileId: string, payload: Record<string, unknown>) {
	return fetchJson(`/api/ops/provider-config/profiles/${encodeURIComponent(profileId)}`, {
		body: JSON.stringify(payload),
		headers: { "content-type": "application/json" },
		method: "PATCH",
	});
}
export async function validateProviderProfile(profileId: string) {
	return fetchJson(`/api/ops/provider-config/profiles/${encodeURIComponent(profileId)}/validate`, {
		method: "POST",
	});
}
export async function activateProviderProfile(profileId: string) {
	return fetchJson(`/api/ops/provider-config/profiles/${encodeURIComponent(profileId)}/activate`, {
		method: "POST",
	});
}
