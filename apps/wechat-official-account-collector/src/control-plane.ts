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

interface WeChatOfficialAccountControlPlaneErrorEnvelope {
	error?: {
		code?: string;
		message?: string;
		retryable?: boolean;
	};
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

	const parsed = await parseJsonResponse(response);
	if (response.status !== 200) {
		const errorEnvelope = parseControlPlaneErrorEnvelope(parsed, response.status);
		throw new WeChatOfficialAccountControlPlaneTransportError({
			code: errorEnvelope.code,
			message: errorEnvelope.message,
			retryable: errorEnvelope.retryable,
			status: response.status,
		});
	}

	return parsed as T;
}

async function parseJsonResponse(
	response: Response,
): Promise<WeChatOfficialAccountControlPlaneErrorEnvelope> {
	try {
		return (await response.json()) as WeChatOfficialAccountControlPlaneErrorEnvelope;
	} catch (error) {
		throw new WeChatOfficialAccountControlPlaneTransportError({
			code: "app_api_invalid_json",
			message:
				error instanceof Error
					? `WeChat official-account control-plane returned invalid JSON: ${error.message}`
					: "WeChat official-account control-plane returned invalid JSON.",
			retryable: response.status >= 500,
			status: response.status,
		});
	}
}

function parseControlPlaneErrorEnvelope(
	parsed: WeChatOfficialAccountControlPlaneErrorEnvelope,
	status: number,
): { code: string; message: string; retryable: boolean } {
	const error = parsed.error;
	if (
		!error ||
		typeof error.code !== "string" ||
		error.code.trim() === "" ||
		typeof error.message !== "string" ||
		error.message.trim() === "" ||
		typeof error.retryable !== "boolean"
	) {
		throw new WeChatOfficialAccountControlPlaneTransportError({
			code: "app_api_invalid_error_envelope",
			message: "WeChat official-account control-plane returned an invalid error envelope.",
			retryable: false,
			status,
		});
	}
	return {
		code: error.code,
		message: error.message,
		retryable: error.retryable,
	};
}
