export class OpsApiError extends Error {
	readonly code: string;
	readonly details: Record<string, unknown>;
	readonly input: string;
	readonly reasonCode: string | undefined;
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

type OpsRequestInit = Omit<RequestInit, "signal"> & {
	signal?: AbortSignal | undefined;
};

export async function fetchJson(input: string, init?: OpsRequestInit) {
	const { signal, ...requestInit } = init ?? {};
	const response = await fetch(input, {
		...requestInit,
		...(signal ? { signal } : {}),
	});
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
	if (response.status === 204) {
		return null;
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
				...(typeof error.code === "string" ? { code: error.code } : {}),
				details,
				...(typeof error.message === "string" ? { message: error.message } : {}),
				...(typeof error.reasonCode === "string" ? { reasonCode: error.reasonCode } : {}),
			};
		}
	} catch {
		return {};
	}
	return {};
}

export function queryString(values: Record<string, string | number | undefined>): string {
	const query = new URLSearchParams();
	for (const [key, value] of Object.entries(values)) {
		if (value !== undefined && value !== "") {
			query.set(key, String(value));
		}
	}
	return query.size > 0 ? `?${query.toString()}` : "";
}
