import { AppApiRouteError } from "../../http";

export function assertAllowedKeys(
	record: Record<string, unknown>,
	allowed: ReadonlySet<string>,
	context: string,
): void {
	for (const key of Object.keys(record)) {
		if (!allowed.has(key)) {
			throw routeError({
				code: "validation_failed",
				details: { field: `${context}.${key}` },
				message: `${context}.${key} is not allowed.`,
				status: 422,
			});
		}
	}
}

export function normalizeEnum<T extends string>(
	value: unknown,
	allowed: ReadonlySet<T>,
	field: string,
): T {
	if (typeof value !== "string" || !allowed.has(value as T)) {
		throw routeError({
			code: "validation_failed",
			details: { field },
			message: `${field} is unsupported.`,
			status: 422,
		});
	}
	return value as T;
}

export function normalizeUniqueEnumList<T extends string>(
	value: unknown,
	allowed: ReadonlySet<T>,
	field: string,
): T[] {
	if (!Array.isArray(value)) {
		throw routeError({
			code: "validation_failed",
			details: { field },
			message: `${field} must be an array.`,
			status: 422,
		});
	}
	const seen = new Set<T>();
	for (const item of value) {
		const normalized = normalizeEnum(item, allowed, field);
		if (seen.has(normalized)) {
			throw routeError({
				code: "validation_failed",
				details: { field },
				message: `${field} must not contain duplicates.`,
				status: 422,
			});
		}
		seen.add(normalized);
	}
	return [...seen];
}

export function normalizeNullableString(value: unknown, field: string): string | null {
	if (value === null) {
		return null;
	}
	return normalizeRequiredString(value, field);
}

export function normalizeBoolean(value: unknown, field: string): boolean {
	if (typeof value !== "boolean") {
		throw routeError({
			code: "validation_failed",
			details: { field },
			message: `${field} must be a boolean.`,
			status: 422,
		});
	}
	return value;
}

export function normalizeOptionalBoolean(value: unknown, field: string): boolean | null {
	if (value === null || value === undefined) {
		return null;
	}
	return normalizeBoolean(value, field);
}

export function normalizeInteger(value: unknown, field: string): number {
	if (typeof value !== "number" || !Number.isInteger(value)) {
		throw routeError({
			code: "validation_failed",
			details: { field },
			message: `${field} must be an integer.`,
			status: 422,
		});
	}
	return value;
}

export function normalizeOptionalPositiveInteger(value: unknown, field: string): number | null {
	if (value === null || value === undefined) {
		return null;
	}
	if (!Number.isInteger(value) || Number(value) < 1) {
		throw routeError({
			code: "validation_failed",
			details: { field },
			message: `${field} must be a positive integer.`,
			status: 422,
		});
	}
	return Number(value);
}

export function normalizeOptionalNumberInRange(
	value: unknown,
	min: number,
	max: number,
	field: string,
): number | null {
	if (value === null || value === undefined) {
		return null;
	}
	if (typeof value !== "number" || value < min || value > max) {
		throw routeError({
			code: "validation_failed",
			details: { field },
			message: `${field} is out of range.`,
			status: 422,
		});
	}
	return value;
}

export function normalizeOptionalEnum<T extends string>(
	value: unknown,
	allowed: ReadonlySet<T>,
	field: string,
): T | null {
	if (value === null || value === undefined) {
		return null;
	}
	return normalizeEnum(value, allowed, field);
}

export function requireRecord(value: unknown, field: string): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw routeError({
			code: "validation_failed",
			details: { field },
			message: `${field} must be an object.`,
			status: 422,
		});
	}
	return value as Record<string, unknown>;
}

export function normalizeRequiredString(value: unknown, field: string): string {
	const normalized = typeof value === "string" ? value.trim() : "";
	if (!normalized) {
		throw routeError({
			code: "validation_failed",
			details: { field },
			message: `${field} is required.`,
			status: 422,
		});
	}
	return normalized;
}

export function normalizeServiceString(value: unknown, field: string): string {
	return normalizeRequiredString(value, field);
}

export function normalizeOptionalServiceString(
	value: string | undefined,
	field: string,
): string | undefined {
	if (value === undefined) {
		return;
	}
	return normalizeServiceString(value, field);
}

export function normalizeOptionalReplayIndexString(
	record: Record<string, unknown>,
	field: "approval_ref" | "operator_principal",
): string | null {
	if (!(field in record)) {
		return null;
	}
	const value = record[field];
	if (typeof value !== "string" || !value.trim()) {
		throw routeError({
			code: "validation_failed",
			details: { field },
			message: `${field} must be a non-empty string when present.`,
			status: 422,
		});
	}
	return value.trim();
}

export function normalizeIsoTimestamp(value: unknown, field: string): string {
	const normalized = normalizeRequiredString(value, field);
	const date = new Date(normalized);
	if (Number.isNaN(date.valueOf())) {
		throw routeError({
			code: "validation_failed",
			details: { field },
			message: `${field} must be a valid ISO timestamp.`,
			status: 422,
		});
	}
	return date.toISOString();
}

export function normalizeOptionalNonNegativeInteger(
	value: unknown,
	field: string,
): number | undefined {
	if (value === null || value === undefined) {
		return;
	}
	if (!Number.isInteger(value) || Number(value) < 0) {
		throw routeError({
			code: "validation_failed",
			details: { field },
			message: `${field} must be a non-negative integer.`,
			status: 422,
		});
	}
	return Number(value);
}

export function normalizeSha256Ref(value: unknown, field: string): string {
	const normalized = normalizeRequiredString(value, field);
	const hash = normalized.startsWith("sha256:") ? normalized.slice("sha256:".length) : normalized;
	if (!/^[a-f0-9]{64}$/.test(hash)) {
		throw routeError({
			code: "validation_failed",
			details: { field },
			message: `${field} must be a sha256 reference.`,
			status: 422,
		});
	}
	return normalized;
}

export function normalizeObjectRef(value: unknown): string {
	const objectRef = normalizeRequiredString(value, "object_ref");
	if (!objectRef.startsWith("s3://")) {
		throw routeError({
			code: "validation_failed",
			details: { field: "object_ref" },
			message: "object_ref must be an S3-compatible object reference.",
			status: 422,
		});
	}
	return objectRef;
}

export function normalizeKeyToken(value: string): string {
	return value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]/g, "");
}

export function routeError(input: {
	code: string;
	details?: Record<string, unknown>;
	message: string;
	status: number;
}): AppApiRouteError {
	return new AppApiRouteError({
		code: input.code,
		details: input.details,
		message: input.message,
		retryable: false,
		status: input.status,
	});
}
