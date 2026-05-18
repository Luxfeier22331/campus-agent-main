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

interface ControlPlaneErrorEnvelope {
	error?: {
		code?: string;
		message?: string;
		retryable?: boolean;
	};
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
	if (!(baseUrl && serviceToken)) {
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

	const parsed = await parseJsonResponse(response);
	if (response.status !== 200) {
		const errorEnvelope = parseControlPlaneErrorEnvelope(parsed, response.status);
		throw new OfficialWebControlPlaneTransportError({
			code: errorEnvelope.code,
			message: errorEnvelope.message,
			retryable: errorEnvelope.retryable,
			status: response.status,
		});
	}

	return parsed as T;
}

async function parseJsonResponse(response: Response): Promise<ControlPlaneErrorEnvelope> {
	try {
		return (await response.json()) as ControlPlaneErrorEnvelope;
	} catch (error) {
		throw new OfficialWebControlPlaneTransportError({
			code: "app_api_invalid_json",
			message:
				error instanceof Error
					? `Official-web control plane returned invalid JSON: ${error.message}`
					: "Official-web control plane returned invalid JSON.",
			retryable: response.status >= 500,
			status: response.status,
		});
	}
}

function parseControlPlaneErrorEnvelope(
	parsed: ControlPlaneErrorEnvelope,
	status: number,
): { code: string; message: string; retryable: boolean } {
	const error = parsed?.error;
	if (
		!error ||
		typeof error.code !== "string" ||
		error.code.trim() === "" ||
		typeof error.message !== "string" ||
		error.message.trim() === "" ||
		typeof error.retryable !== "boolean"
	) {
		throw new OfficialWebControlPlaneTransportError({
			code: "app_api_invalid_error_envelope",
			message: "Official-web control plane returned an invalid error envelope.",
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
