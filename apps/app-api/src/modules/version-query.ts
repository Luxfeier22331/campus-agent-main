export type VersionQueryMode = "current" | "historical" | "as_of" | "compare";

export interface VersionQuery {
	mode: VersionQueryMode;
	asOf?: string;
	versionId?: string;
	compareToVersionId?: string;
}

export class VersionQueryValidationError extends Error {
	readonly field: string;

	constructor(input: { field: string; message: string }) {
		super(input.message);
		this.name = "VersionQueryValidationError";
		this.field = input.field;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeOptionalString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function assertAllowedMode(mode: string): asserts mode is VersionQueryMode {
	if (mode === "current" || mode === "historical" || mode === "as_of" || mode === "compare") {
		return;
	}

	throw new VersionQueryValidationError({
		field: "versionQuery.mode",
		message: "versionQuery.mode must be one of current, historical, as_of, compare.",
	});
}

export function normalizeVersionQuery(value: unknown): VersionQuery | null {
	if (value === null || value === undefined) {
		return null;
	}
	if (!isRecord(value)) {
		throw new VersionQueryValidationError({
			field: "versionQuery",
			message: "versionQuery must be an object.",
		});
	}

	const mode = normalizeOptionalString(value.mode) ?? "current";
	assertAllowedMode(mode);

	const asOf = normalizeOptionalString(value.asOf);
	const versionId = normalizeOptionalString(value.versionId);
	const compareToVersionId = normalizeOptionalString(value.compareToVersionId);

	if (mode === "as_of") {
		if (!asOf) {
			throw new VersionQueryValidationError({
				field: "versionQuery.asOf",
				message: "versionQuery.asOf is required when versionQuery.mode is as_of.",
			});
		}
		if (versionId) {
			throw new VersionQueryValidationError({
				field: "versionQuery.versionId",
				message: "versionQuery.versionId is not allowed when versionQuery.mode is as_of.",
			});
		}
		if (compareToVersionId) {
			throw new VersionQueryValidationError({
				field: "versionQuery.compareToVersionId",
				message:
					"versionQuery.compareToVersionId is only allowed when versionQuery.mode is compare.",
			});
		}
	} else if (asOf) {
		throw new VersionQueryValidationError({
			field: "versionQuery.asOf",
			message: "versionQuery.asOf is only allowed when versionQuery.mode is as_of.",
		});
	}

	if (mode !== "historical" && mode !== "compare" && versionId) {
		throw new VersionQueryValidationError({
			field: "versionQuery.versionId",
			message:
				"versionQuery.versionId is only allowed when versionQuery.mode is historical or compare.",
		});
	}

	if (mode !== "compare" && compareToVersionId) {
		throw new VersionQueryValidationError({
			field: "versionQuery.compareToVersionId",
			message: "versionQuery.compareToVersionId is only allowed when versionQuery.mode is compare.",
		});
	}

	if (compareToVersionId && !versionId) {
		throw new VersionQueryValidationError({
			field: "versionQuery.versionId",
			message: "versionQuery.versionId is required when versionQuery.compareToVersionId is set.",
		});
	}

	return {
		mode,
		...(asOf ? { asOf } : {}),
		...(versionId ? { versionId } : {}),
		...(compareToVersionId ? { compareToVersionId } : {}),
	};
}

export function summarizeVersionQuery(input: VersionQuery | null | undefined): {
	mode: VersionQueryMode | null;
	summary: string | null;
} {
	if (!input) {
		return {
			mode: null,
			summary: null,
		};
	}

	if (input.mode === "historical") {
		return {
			mode: input.mode,
			summary: input.versionId ? `historical:${input.versionId}` : "historical",
		};
	}
	if (input.mode === "as_of") {
		return {
			mode: input.mode,
			summary: input.asOf ? `as_of:${input.asOf}` : "as_of",
		};
	}
	if (input.mode === "compare") {
		if (input.versionId && input.compareToVersionId) {
			return {
				mode: input.mode,
				summary: `compare:${input.versionId}->${input.compareToVersionId}`,
			};
		}
		if (input.versionId) {
			return {
				mode: input.mode,
				summary: `compare:${input.versionId}`,
			};
		}
	}

	return {
		mode: input.mode,
		summary: input.mode,
	};
}

export function toCapabilityExecutionVersionQuery(input: VersionQuery): Record<string, unknown> {
	return {
		mode: input.mode,
		...(input.asOf ? { as_of: input.asOf } : {}),
		...(input.versionId ? { version_id: input.versionId } : {}),
		...(input.compareToVersionId ? { compare_to_version_id: input.compareToVersionId } : {}),
	};
}
