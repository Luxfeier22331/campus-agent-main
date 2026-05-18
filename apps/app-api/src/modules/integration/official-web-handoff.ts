import {
	DEFAULT_OFFICIAL_WEB_HANDOFF_TIMEOUT_MS,
	type Env,
	parsePositiveInteger,
} from "../../config";
import type {
	OfficialWebHandoffPublisher,
	OfficialWebIngestionHandoffPayload,
} from "../official-web-projection";

export class OfficialWebHandoffTransportError extends Error {
	readonly code: string;
	readonly retryable: boolean;
	readonly status: number;

	constructor(input: {
		code: string;
		message: string;
		retryable: boolean;
		status: number;
	}) {
		super(input.message);
		this.name = "OfficialWebHandoffTransportError";
		this.code = input.code;
		this.retryable = input.retryable;
		this.status = input.status;
	}
}

interface OfficialWebHandoffPublisherInput {
	fetchImplementation?: typeof fetch;
}

interface OfficialWebHandoffErrorEnvelope {
	error?: {
		code?: string;
		message?: string;
		retryable?: boolean;
	};
}

function readHandoffRuntimeConfig(
	env: Pick<
		Env,
		| "APP_API_OFFICIAL_WEB_HANDOFF_TIMEOUT_MS"
		| "APP_API_OFFICIAL_WEB_HANDOFF_TOKEN"
		| "APP_API_OFFICIAL_WEB_HANDOFF_URL"
	>,
): {
	timeoutMs: number;
	token: string;
	url: string;
} {
	const url = env.APP_API_OFFICIAL_WEB_HANDOFF_URL?.trim();
	const token = env.APP_API_OFFICIAL_WEB_HANDOFF_TOKEN?.trim();
	if (!(url && token)) {
		throw new OfficialWebHandoffTransportError({
			code: "dependency_not_ready",
			message: "Official web ingestion handoff runtime is not configured.",
			retryable: true,
			status: 503,
		});
	}

	return {
		timeoutMs: parsePositiveInteger(
			env.APP_API_OFFICIAL_WEB_HANDOFF_TIMEOUT_MS,
			DEFAULT_OFFICIAL_WEB_HANDOFF_TIMEOUT_MS,
		),
		token,
		url,
	};
}

export function createOfficialWebHandoffPublisher(
	env: Pick<
		Env,
		| "APP_API_OFFICIAL_WEB_HANDOFF_TIMEOUT_MS"
		| "APP_API_OFFICIAL_WEB_HANDOFF_TOKEN"
		| "APP_API_OFFICIAL_WEB_HANDOFF_URL"
	>,
	input: OfficialWebHandoffPublisherInput = {},
): OfficialWebHandoffPublisher {
	const fetchImplementation = input.fetchImplementation ?? fetch;

	return {
		async publish(payload: OfficialWebIngestionHandoffPayload): Promise<{ dispatchRef: string }> {
			const runtime = readHandoffRuntimeConfig(env);

			let response: Response;
			try {
				response = await new Promise<Response>((resolve, reject) => {
					const controller = new AbortController();
					const timeoutId = setTimeout(() => {
						controller.abort();
						reject(
							new OfficialWebHandoffTransportError({
								code: "official_web_handoff_timeout",
								message: `Official web handoff exceeded ${runtime.timeoutMs}ms timeout.`,
								retryable: true,
								status: 504,
							}),
						);
					}, runtime.timeoutMs);

					fetchImplementation(runtime.url, {
						body: JSON.stringify(payload),
						headers: {
							authorization: `Bearer ${runtime.token}`,
							"content-type": "application/json",
							"x-official-web-event-id": payload.eventId,
						},
						method: "POST",
						signal: controller.signal,
					})
						.then(resolve)
						.catch((error) => {
							if (error instanceof Error && error.name === "AbortError") {
								reject(
									new OfficialWebHandoffTransportError({
										code: "official_web_handoff_timeout",
										message: `Official web handoff exceeded ${runtime.timeoutMs}ms timeout.`,
										retryable: true,
										status: 504,
									}),
								);
								return;
							}

							reject(error);
						})
						.finally(() => {
							clearTimeout(timeoutId);
						});
				});
			} catch (error) {
				if (error instanceof OfficialWebHandoffTransportError) {
					throw error;
				}

				throw new OfficialWebHandoffTransportError({
					code: "official_web_handoff_unavailable",
					message: error instanceof Error ? error.message : "Official web handoff request failed.",
					retryable: true,
					status: 502,
				});
			}

			const parsed = await parseOfficialWebHandoffJsonResponse(response);

			if (response.status < 200 || response.status >= 300) {
				const errorEnvelope = parseOfficialWebHandoffErrorEnvelope(parsed, response.status);
				throw new OfficialWebHandoffTransportError({
					code: errorEnvelope.code,
					message: errorEnvelope.message,
					retryable: errorEnvelope.retryable,
					status: response.status,
				});
			}

			const dispatchRef = typeof parsed?.dispatchRef === "string" ? parsed.dispatchRef.trim() : "";
			if (!dispatchRef) {
				throw new OfficialWebHandoffTransportError({
					code: "official_web_handoff_invalid_response",
					message: "Official web handoff receiver did not return a dispatchRef.",
					retryable: true,
					status: 502,
				});
			}

			return {
				dispatchRef,
			};
		},
	};
}

async function parseOfficialWebHandoffJsonResponse(
	response: Response,
): Promise<Record<string, unknown>> {
	try {
		return (await response.json()) as Record<string, unknown>;
	} catch {
		throw new OfficialWebHandoffTransportError({
			code: "official_web_handoff_invalid_response",
			message: "Official web handoff receiver returned an invalid JSON response.",
			retryable: response.status >= 500,
			status: response.status >= 200 && response.status < 300 ? 502 : response.status,
		});
	}
}

function parseOfficialWebHandoffErrorEnvelope(
	parsed: OfficialWebHandoffErrorEnvelope,
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
		throw new OfficialWebHandoffTransportError({
			code: "official_web_handoff_invalid_error_envelope",
			message: "Official web handoff receiver returned an invalid error envelope.",
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
