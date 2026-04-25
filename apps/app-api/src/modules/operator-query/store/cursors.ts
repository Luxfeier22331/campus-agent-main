import { decodeBase64UrlJson, encodeBase64UrlJson } from "../../../base64url";

interface RequestProjectionCursor {
	requestId: string;
	startedAt: string;
}

interface AuditProjectionCursor {
	auditEventId: string;
	occurredAt: string;
}

interface SafetyAnomalyCursor {
	requestId: string;
	detectedAt: string;
}

interface QualityBadcaseCursor {
	badcaseId: string;
	openedAt: string;
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

export function encodeAuditCursor(input: { auditEventId: string; occurredAt: string }): string {
	return encodeBase64UrlJson(input satisfies AuditProjectionCursor);
}

export function decodeAuditCursor(cursor: string): AuditProjectionCursor | null {
	try {
		const parsed = decodeBase64UrlJson<Partial<AuditProjectionCursor>>(cursor);

		if (
			typeof parsed.auditEventId !== "string" ||
			!parsed.auditEventId ||
			typeof parsed.occurredAt !== "string" ||
			!parsed.occurredAt
		) {
			return null;
		}

		return {
			auditEventId: parsed.auditEventId,
			occurredAt: parsed.occurredAt,
		};
	} catch {
		return null;
	}
}

export function encodeSafetyAnomalyCursor(input: {
	detectedAt: string;
	requestId: string;
}): string {
	return encodeBase64UrlJson(input satisfies SafetyAnomalyCursor);
}

export function decodeSafetyAnomalyCursor(cursor: string): SafetyAnomalyCursor | null {
	try {
		const parsed = decodeBase64UrlJson<Partial<SafetyAnomalyCursor>>(cursor);

		if (
			typeof parsed.requestId !== "string" ||
			!parsed.requestId ||
			typeof parsed.detectedAt !== "string" ||
			!parsed.detectedAt
		) {
			return null;
		}

		return {
			detectedAt: parsed.detectedAt,
			requestId: parsed.requestId,
		};
	} catch {
		return null;
	}
}

export function encodeQualityBadcaseCursor(input: { badcaseId: string; openedAt: string }): string {
	return encodeBase64UrlJson(input satisfies QualityBadcaseCursor);
}

export function decodeQualityBadcaseCursor(cursor: string): QualityBadcaseCursor | null {
	try {
		const parsed = decodeBase64UrlJson<Partial<QualityBadcaseCursor>>(cursor);

		if (
			typeof parsed.badcaseId !== "string" ||
			!parsed.badcaseId ||
			typeof parsed.openedAt !== "string" ||
			!parsed.openedAt ||
			Number.isNaN(Date.parse(parsed.openedAt))
		) {
			return null;
		}

		return {
			badcaseId: parsed.badcaseId,
			openedAt: parsed.openedAt,
		};
	} catch {
		return null;
	}
}
