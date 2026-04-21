export class OfficialWebControlPlaneTransportError extends Error {
	readonly code: string;
	readonly retryable: boolean;
	readonly status: number;

	constructor(input: { code: string; message: string; retryable: boolean; status: number }) {
		super(input.message);
		this.name = "OfficialWebControlPlaneTransportError";
		this.code = input.code;
		this.retryable = input.retryable;
		this.status = input.status;
	}
}

export async function requestJson<T>(input: {
	baseUrl?: string | null;
	serviceToken?: string | null;
	path: string;
	body: Record<string, unknown>;
	traceId?: string;
	fetchImplementation: typeof fetch;
}): Promise<T> {
	const baseUrl = input.baseUrl?.trim();
	const serviceToken = input.serviceToken?.trim();
	if (!baseUrl || !serviceToken) {
		throw new OfficialWebControlPlaneTransportError({
			code: "dependency_not_ready",
			message: "Official-web control plane is not configured.",
			retryable: true,
			status: 503,
		});
	}

	let response: Response;
	try {
		response = await input.fetchImplementation(`${baseUrl}${input.path}`, {
			method: "POST",
			headers: {
				authorization: `Bearer ${serviceToken}`,
				"content-type": "application/json",
				...(input.traceId ? { "x-trace-id": input.traceId } : {}),
			},
			body: JSON.stringify(input.body),
		});
	} catch (error) {
		throw new OfficialWebControlPlaneTransportError({
			code: "app_api_unavailable",
			message:
				error instanceof Error ? error.message : "Official-web control plane request failed.",
			retryable: true,
			status: 502,
		});
	}

	const parsed = (await response.json().catch(() => null)) as {
		error?: { code?: string; message?: string; retryable?: boolean };
	} | null;
	if (response.status !== 200) {
		throw new OfficialWebControlPlaneTransportError({
			code: parsed?.error?.code ?? "app_api_error",
			message: parsed?.error?.message ?? "Official-web control plane request failed.",
			retryable: parsed?.error?.retryable ?? response.status >= 500,
			status: response.status,
		});
	}

	return parsed as T;
}
