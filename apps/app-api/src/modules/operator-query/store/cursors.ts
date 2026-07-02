import { decodeBase64UrlJson, encodeBase64UrlJson } from "../../../base64url";

interface RequestProjectionCursor {
	requestId: string;
	startedAt: string;
}

interface RuntimeProjectionCursor {
	id: string;
	timestamp: string;
}

export function encodeRequestCursor(input: { requestId: string; startedAt: string }): string {
	return encodeBase64UrlJson(input satisfies RequestProjectionCursor);
}

export function decodeRequestCursor(cursor: string): RequestProjectionCursor | null {
	try {
		const parsed = decodeBase64UrlJson<Partial<RequestProjectionCursor>>(cursor);

		if (
			typeof parsed.requestId !== "string" ||
			!parsed.requestId ||
			typeof parsed.startedAt !== "string" ||
			!parsed.startedAt
		) {
			return null;
		}

		return {
			requestId: parsed.requestId,
			startedAt: parsed.startedAt,
		};
	} catch {
		return null;
	}
}

export function encodeRuntimeProjectionCursor(input: { id: string; timestamp: string }): string {
	return encodeBase64UrlJson(input satisfies RuntimeProjectionCursor);
}

export function decodeRuntimeProjectionCursor(cursor: string): RuntimeProjectionCursor | null {
	try {
		const parsed = decodeBase64UrlJson<Partial<RuntimeProjectionCursor>>(cursor);

		if (
			typeof parsed.id !== "string" ||
			!parsed.id ||
			typeof parsed.timestamp !== "string" ||
			!parsed.timestamp ||
			Number.isNaN(Date.parse(parsed.timestamp))
		) {
			return null;
		}

		return {
			id: parsed.id,
			timestamp: parsed.timestamp,
		};
	} catch {
		return null;
	}
}
