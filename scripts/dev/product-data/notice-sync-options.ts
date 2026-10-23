export interface NoticeSyncSelection {
	releasedFrom: string;
	releasedTo: string;
}

export function parseNoticeSyncSelection(input: {
	releasedFrom?: string;
	releasedTo?: string;
}): NoticeSyncSelection | null {
	const releasedFrom = normalizeDate(input.releasedFrom, "--released-from");
	const releasedTo = normalizeDate(input.releasedTo, "--released-to");
	if (releasedFrom === null && releasedTo === null) {
		return null;
	}
	if (releasedFrom === null || releasedTo === null) {
		throw new Error("--released-from and --released-to must be provided together");
	}
	if (releasedFrom >= releasedTo) {
		throw new Error("--released-from must be earlier than --released-to");
	}
	return {
		releasedFrom: `${releasedFrom}T00:00:00+08:00`,
		releasedTo: `${releasedTo}T00:00:00+08:00`,
	};
}

function normalizeDate(value: string | undefined, flag: string): string | null {
	if (value === undefined) {
		return null;
	}
	const normalized = value.trim();
	if (!/^\d{4}-\d{2}-\d{2}$/u.test(normalized)) {
		throw new Error(`${flag} must use YYYY-MM-DD`);
	}
	const date = new Date(`${normalized}T00:00:00.000Z`);
	if (
		normalized.startsWith("0000-") ||
		Number.isNaN(date.valueOf()) ||
		date.toISOString().slice(0, 10) !== normalized
	) {
		throw new Error(`${flag} must be a valid calendar date`);
	}
	return normalized;
}
