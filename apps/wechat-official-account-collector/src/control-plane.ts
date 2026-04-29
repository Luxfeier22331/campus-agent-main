export class WeChatOfficialAccountControlPlaneTransportError extends Error {
	readonly code: string;
	readonly retryable: boolean;
	readonly status: number;

	constructor(input: { code: string; message: string; retryable: boolean; status: number }) {
		super(input.message);
		this.name = "WeChatOfficialAccountControlPlaneTransportError";
		this.code = input.code;
		this.retryable = input.retryable;
		this.status = input.status;
	}
}

export interface WeChatOfficialAccountControlPlaneClient {
	startRun(input: {
		accountName: string;
		accountSlug: string;
		collectorVersion: string;
		providerBaseUrl: string;
		requestSummary: Record<string, unknown>;
		schedulerRunKey: string;
		startedAt: string;
		traceId?: string;
		triggerType: string;
	}): Promise<{ run: { runId: string } }>;
	sendHeartbeat(input: {
		counts: Record<string, number>;
		observedAt: string;
		runId: string;
		sequence: number;
		traceId?: string;
	}): Promise<unknown>;
	finalizeRun(input: {
		artifacts: Array<{
			artifactType: string;
			byteSize: number;
			contentSha256: string;
			objectKey: string;
			recordCount?: number;
		}>;
		error?: { code: string; message: string };
		finishedAt: string;
		runId: string;
		summary: Record<string, number>;
		terminalStatus: "completed" | "completed_with_errors" | "failed";
		traceId?: string;
	}): Promise<unknown>;
}

export function createWeChatOfficialAccountControlPlaneClient(
	env: {
		appApiBaseUrl?: string | null;
		serviceToken?: string | null;
	},
	input: { fetchImplementation?: typeof fetch } = {},
): WeChatOfficialAccountControlPlaneClient {
	const fetchImplementation = input.fetchImplementation ?? fetch;

	return {
		startRun(payload) {
			return requestJson<{ run: { runId: string } }>({
				baseUrl: env.appApiBaseUrl,
				body: {
					accountName: payload.accountName,
					accountSlug: payload.accountSlug,
					collectorVersion: payload.collectorVersion,
					provider: "feedwe",
					providerBaseUrl: payload.providerBaseUrl,
					requestSummary: payload.requestSummary,
					schedulerRunKey: payload.schedulerRunKey,
					startedAt: payload.startedAt,
					triggerType: payload.triggerType,
				},
				fetchImplementation,
				path: "/api/wechat-official-account/runs",
				serviceToken: env.serviceToken,
				traceId: payload.traceId,
			});
		},

		sendHeartbeat(payload) {
			return requestJson({
				baseUrl: env.appApiBaseUrl,
				body: {
					counts: payload.counts,
					observedAt: payload.observedAt,
					sequence: payload.sequence,
				},
				fetchImplementation,
				path: `/api/wechat-official-account/runs/${payload.runId}/heartbeats`,
				serviceToken: env.serviceToken,
				traceId: payload.traceId,
			});
		},

		finalizeRun(payload) {
			return requestJson({
				baseUrl: env.appApiBaseUrl,
				body: {
					artifacts: payload.artifacts,
					error: payload.error,
					finishedAt: payload.finishedAt,
					summary: payload.summary,
					terminalStatus: payload.terminalStatus,
				},
				fetchImplementation,
				path: `/api/wechat-official-account/runs/${payload.runId}/finalize`,
				serviceToken: env.serviceToken,
				traceId: payload.traceId,
			});
		},
	};
}

async function requestJson<T>(input: {
	baseUrl?: string | null;
	body: Record<string, unknown>;
	fetchImplementation: typeof fetch;
	path: string;
	serviceToken?: string | null;
	traceId?: string;
}): Promise<T> {
	const baseUrl = input.baseUrl?.trim();
	const serviceToken = input.serviceToken?.trim();
	if (!(baseUrl && serviceToken)) {
		throw new WeChatOfficialAccountControlPlaneTransportError({
			code: "dependency_not_ready",
			message: "WeChat official-account control plane is not configured.",
			retryable: true,
			status: 503,
		});
	}

	let response: Response;
	try {
		response = await input.fetchImplementation(`${baseUrl}${input.path}`, {
			body: JSON.stringify(input.body),
			headers: {
				authorization: `Bearer ${serviceToken}`,
				"content-type": "application/json",
				...(input.traceId ? { "x-trace-id": input.traceId } : {}),
			},
			method: "POST",
		});
	} catch (error) {
		throw new WeChatOfficialAccountControlPlaneTransportError({
			code: "app_api_unavailable",
			message:
				error instanceof Error
					? error.message
					: "WeChat official-account control-plane request failed.",
			retryable: true,
			status: 502,
		});
	}

	const parsed = (await response.json().catch(() => null)) as {
		error?: { code?: string; message?: string; retryable?: boolean };
	} | null;
	if (response.status !== 200) {
		throw new WeChatOfficialAccountControlPlaneTransportError({
			code: parsed?.error?.code ?? "app_api_error",
			message: parsed?.error?.message ?? "WeChat official-account control-plane request failed.",
			retryable: parsed?.error?.retryable ?? response.status >= 500,
			status: response.status,
		});
	}

	return parsed as T;
}
