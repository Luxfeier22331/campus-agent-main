import { MIMEType } from "node:util";
import { z } from "zod";
import type { OpsAdmission, OpsOperatorContext } from "../ops-admission.ts";

export const OpsPathIdSchema = z
	.string()
	.min(1)
	.max(200)
	.regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);

export async function admitOpsApiRequest(
	admission: OpsAdmission,
	request: Request,
): Promise<OpsOperatorContext | Response> {
	const result = await admission.admit(request);
	return result.operator ?? result.response;
}

export function toSearchParams(values: Record<string, unknown>): URLSearchParams {
	const search = new URLSearchParams();
	for (const [key, value] of Object.entries(values)) {
		if (value !== undefined) {
			search.set(key, String(value));
		}
	}
	return search;
}

export function isJsonContentType(value: string | null | undefined): boolean {
	if (!value) {
		return false;
	}
	try {
		return new MIMEType(value).essence === "application/json";
	} catch {
		return false;
	}
}

export function jsonError(
	code: string,
	message: string,
	status: 400 | 401 | 403 | 404 | 409 | 422 | 428 | 500 | 502 | 503 = 404,
	details?: Record<string, unknown>,
) {
	return new Response(JSON.stringify({ error: { code, message, ...details } }), {
		headers: {
			"cache-control": "no-store",
			"content-type": "application/json; charset=utf-8",
		},
		status,
	});
}

export async function readBoundedJson(request: Request, maxBytes: number): Promise<unknown> {
	const contentLengthHeader = request.headers.get("content-length");
	if (contentLengthHeader !== null) {
		const contentLength = Number(contentLengthHeader);
		if (!Number.isSafeInteger(contentLength) || contentLength < 0 || contentLength > maxBytes) {
			return null;
		}
	}
	if (!request.body) {
		return null;
	}

	try {
		const reader = request.body.getReader();
		try {
			const chunks: Uint8Array[] = [];
			let totalBytes = 0;
			while (true) {
				const chunk = await reader.read();
				if (chunk.done) {
					break;
				}
				totalBytes += chunk.value.byteLength;
				if (totalBytes > maxBytes) {
					await reader.cancel("request body exceeds limit");
					return null;
				}
				chunks.push(chunk.value);
			}

			const body = new Uint8Array(totalBytes);
			let offset = 0;
			for (const chunk of chunks) {
				body.set(chunk, offset);
				offset += chunk.byteLength;
			}
			return JSON.parse(new TextDecoder().decode(body)) as unknown;
		} finally {
			reader.releaseLock();
		}
	} catch {
		return null;
	}
}

export async function requestHasNonEmptyBody(request: Request): Promise<boolean> {
	const contentLengthHeader = request.headers.get("content-length");
	if (contentLengthHeader !== null) {
		const contentLength = Number(contentLengthHeader);
		if (!Number.isSafeInteger(contentLength) || contentLength < 0 || contentLength > 0) {
			return true;
		}
	}
	if (!request.body) {
		return false;
	}

	try {
		const reader = request.body.getReader();
		try {
			const chunk = await reader.read();
			if (chunk.done) {
				return false;
			}
			await reader.cancel("request body is not allowed");
			return true;
		} finally {
			reader.releaseLock();
		}
	} catch {
		return true;
	}
}

export function requestHasConfiguredOrigin(request: Request, publicOrigin: string | null) {
	if (!publicOrigin) {
		return false;
	}
	const fetchSite = request.headers.get("sec-fetch-site");
	if (fetchSite && fetchSite !== "same-origin") {
		return false;
	}
	const origin = request.headers.get("origin")?.trim();
	if (!origin) {
		return false;
	}
	try {
		return new URL(origin).origin === origin && origin === publicOrigin;
	} catch {
		return false;
	}
}
