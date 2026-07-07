import { z } from "zod";

import { formatZodIssues, parseOptionalText } from "./core.ts";

export type DocumentVersionQueryMode = "current" | "historical" | "as_of" | "compare";
export type VersionResolutionStatus = "resolved" | "unresolved";
export type VersionResolutionReason =
	| "document_not_found"
	| "current_version_not_found"
	| "previous_version_not_found"
	| "version_not_found"
	| "as_of_unresolved"
	| "compare_pair_unresolved";
export type VersionSelectionAnchor = "current" | "previous" | "exact" | "as_of";

export interface DocumentVersionQuery {
	mode?: DocumentVersionQueryMode;
	as_of?: string | null;
	version_id?: string | null;
	compare_to_version_id?: string | null;
}

export interface VersionRegistryRecord {
	collection?: string | null;
	corpus?: string | null;
	document_id: string;
	effective_date?: string | null;
	ingestion_timestamp: string;
	is_current?: boolean | null;
	published_date?: string | null;
	revision_track: string;
	supersedes_version_id?: string | null;
	version_id: string;
}

export interface ResolvedVersionSelection {
	document_id: string;
	revision_track: string;
	version_id: string;
	anchor: VersionSelectionAnchor;
}

export interface ResolvedVersionQuery {
	mode: DocumentVersionQueryMode;
	status: VersionResolutionStatus;
	primary_selection: ResolvedVersionSelection | null;
	comparison_selection: ResolvedVersionSelection | null;
	unresolved_reason: VersionResolutionReason | "";
	selected_version_ids: string[];
}

const VersionRegistryRecordSchema = z
	.object({
		collection: z.string().trim().min(1).nullable().optional(),
		corpus: z.string().trim().min(1).nullable().optional(),
		document_id: z.string().trim().min(1),
		effective_date: z.string().trim().min(1).nullable().optional(),
		ingestion_timestamp: z
			.string()
			.trim()
			.min(1)
			.refine((value) => parseTimestamp(value) !== null, {
				message: "must be an ISO timestamp",
			}),
		is_current: z.boolean().nullable().optional(),
		published_date: z.string().trim().min(1).nullable().optional(),
		revision_track: z.string().trim().min(1),
		supersedes_version_id: z.string().trim().min(1).nullable().optional(),
		version_id: z.string().trim().min(1),
	})
	.passthrough();

const DocumentVersionQuerySchema = z
	.object({
		as_of: z.string().trim().optional().default(""),
		compare_to_version_id: z.string().trim().optional().default(""),
		mode: z.enum(["current", "historical", "as_of", "compare"]).optional().default("current"),
		version_id: z.string().trim().optional().default(""),
	})
	.superRefine((value, ctx) => {
		if (value.mode === "as_of") {
			if (!value.as_of) {
				ctx.addIssue({
					code: "custom",
					message: "as_of is required when version mode is as_of",
					path: ["as_of"],
				});
			}
			if (value.version_id) {
				ctx.addIssue({
					code: "custom",
					message: "version_id is not allowed when version mode is as_of",
					path: ["version_id"],
				});
			}
			if (value.compare_to_version_id) {
				ctx.addIssue({
					code: "custom",
					message: "compare_to_version_id is only allowed when version mode is compare",
					path: ["compare_to_version_id"],
				});
			}
			return;
		}
		if (value.as_of) {
			ctx.addIssue({
				code: "custom",
				message: "as_of is only allowed when version mode is as_of",
				path: ["as_of"],
			});
		}
		if (!["historical", "compare"].includes(value.mode) && value.version_id) {
			ctx.addIssue({
				code: "custom",
				message: "version_id is only allowed when version mode is historical or compare",
				path: ["version_id"],
			});
		}
		if (value.mode !== "compare" && value.compare_to_version_id) {
			ctx.addIssue({
				code: "custom",
				message: "compare_to_version_id is only allowed when version mode is compare",
				path: ["compare_to_version_id"],
			});
		}
		if (value.compare_to_version_id && !value.version_id) {
			ctx.addIssue({
				code: "custom",
				message: "version_id is required when compare_to_version_id is set",
				path: ["version_id"],
			});
		}
	});

export function resolveDocumentVersionQuery(input: {
	documentId: string;
	preferredRevisionTracks?: readonly string[];
	records: readonly VersionRegistryRecord[];
	versionQuery?: DocumentVersionQuery;
}): ResolvedVersionQuery {
	const documentId = input.documentId.trim();
	if (!documentId) {
		throw new Error("documentId is required");
	}
	const versionQuery = parseDocumentVersionQuery(input.versionQuery ?? {});
	const records = parseRegistryRecords(input.records).filter(
		(record) => record.document_id === documentId,
	);
	const trackRecords = resolveTrackRecords(
		records,
		normalizeRevisionTracks(input.preferredRevisionTracks),
	);
	if (trackRecords.length === 0) {
		return unresolved(versionQuery.mode, "document_not_found");
	}

	if (versionQuery.mode === "current") {
		const currentRecord = resolveCurrentRecord(trackRecords);
		return currentRecord
			? resolved(versionQuery.mode, selectionFromRecord(currentRecord, "current"))
			: unresolved(versionQuery.mode, "current_version_not_found");
	}

	if (versionQuery.mode === "historical") {
		const historicalRecord = resolveHistoricalRecord(trackRecords, versionQuery);
		return historicalRecord
			? resolved(
					versionQuery.mode,
					selectionFromRecord(historicalRecord, versionQuery.version_id ? "exact" : "previous"),
				)
			: unresolved(
					versionQuery.mode,
					versionQuery.version_id ? "version_not_found" : "previous_version_not_found",
				);
	}

	if (versionQuery.mode === "as_of") {
		const asOfRecord = resolveAsOfRecord(trackRecords, versionQuery.as_of ?? "");
		return asOfRecord
			? resolved(versionQuery.mode, selectionFromRecord(asOfRecord, "as_of"))
			: unresolved(versionQuery.mode, "as_of_unresolved");
	}

	const currentRecord = resolveCurrentRecord(trackRecords);
	const primaryRecord = resolveHistoricalRecord(trackRecords, versionQuery);
	const comparisonRecord = versionQuery.compare_to_version_id
		? resolveExactRecord(trackRecords, versionQuery.compare_to_version_id)
		: currentRecord;
	if (!currentRecord) {
		return unresolved(versionQuery.mode, "compare_pair_unresolved");
	}
	if (!primaryRecord) {
		return unresolved(versionQuery.mode, "compare_pair_unresolved");
	}
	if (!comparisonRecord) {
		return unresolved(versionQuery.mode, "compare_pair_unresolved");
	}
	if (comparisonRecord.version_id === primaryRecord.version_id) {
		return unresolved(versionQuery.mode, "compare_pair_unresolved");
	}
	return {
		comparison_selection: selectionFromRecord(
			comparisonRecord,
			versionQuery.compare_to_version_id ? "exact" : "current",
		),
		mode: versionQuery.mode,
		primary_selection: selectionFromRecord(
			primaryRecord,
			versionQuery.version_id ? "exact" : "previous",
		),
		selected_version_ids: selectedVersionIds(primaryRecord, comparisonRecord),
		status: "resolved",
		unresolved_reason: "",
	};
}

function parseDocumentVersionQuery(query: DocumentVersionQuery): Required<DocumentVersionQuery> {
	const parsed = DocumentVersionQuerySchema.safeParse({
		as_of: query.as_of ?? undefined,
		compare_to_version_id: query.compare_to_version_id ?? undefined,
		mode: query.mode ?? undefined,
		version_id: query.version_id ?? undefined,
	});
	if (!parsed.success) {
		throw new Error(
			`document version query is invalid: ${formatZodIssues(parsed.error.issues, "version_query").join("; ")}`,
		);
	}
	return parsed.data;
}

function parseRegistryRecords(records: readonly VersionRegistryRecord[]): VersionRegistryRecord[] {
	return records.map((record, index) => {
		const parsed = VersionRegistryRecordSchema.safeParse(record);
		if (!parsed.success) {
			throw new Error(
				`version registry record is invalid: ${formatZodIssues(parsed.error.issues, `records[${index}]`).join("; ")}`,
			);
		}
		return {
			...parsed.data,
			effective_date: parseOptionalText(parsed.data.effective_date),
			ingestion_timestamp: parsed.data.ingestion_timestamp,
			is_current: Boolean(parsed.data.is_current),
			published_date: parseOptionalText(parsed.data.published_date),
			supersedes_version_id: parseOptionalText(parsed.data.supersedes_version_id),
		};
	});
}

function resolveTrackRecords(
	records: readonly VersionRegistryRecord[],
	preferredRevisionTracks: readonly string[],
): VersionRegistryRecord[] {
	for (const revisionTrack of preferredRevisionTracks) {
		const matches = listVersions(records, revisionTrack);
		if (matches.length > 0) {
			return matches;
		}
	}
	const currentRecord = maxByIngestionTimestamp(records.filter((record) => record.is_current));
	if (currentRecord) {
		const matches = listVersions(records, currentRecord.revision_track);
		if (matches.length > 0) {
			return matches;
		}
	}
	const allRecords = listVersions(records);
	const discoveredRevisionTrack = allRecords[0]?.revision_track;
	return discoveredRevisionTrack ? listVersions(records, discoveredRevisionTrack) : [];
}

function listVersions(
	records: readonly VersionRegistryRecord[],
	revisionTrack?: string,
): VersionRegistryRecord[] {
	return [...records]
		.filter((record) => revisionTrack === undefined || record.revision_track === revisionTrack)
		.sort((left, right) => timestampMillis(right) - timestampMillis(left));
}

function resolveCurrentRecord(
	records: readonly VersionRegistryRecord[],
): VersionRegistryRecord | null {
	return maxByIngestionTimestamp(records.filter((record) => record.is_current));
}

function resolveHistoricalRecord(
	records: readonly VersionRegistryRecord[],
	versionQuery: Required<DocumentVersionQuery>,
): VersionRegistryRecord | null {
	if (versionQuery.version_id) {
		const exactRecord = resolveExactRecord(records, versionQuery.version_id);
		return exactRecord && !exactRecord.is_current ? exactRecord : null;
	}
	const currentRecord = resolveCurrentRecord(records);
	if (currentRecord?.supersedes_version_id) {
		const supersededRecord = resolveExactRecord(records, currentRecord.supersedes_version_id);
		if (supersededRecord) {
			return supersededRecord;
		}
	}
	return records.find((record) => !record.is_current) ?? null;
}

function resolveAsOfRecord(
	records: readonly VersionRegistryRecord[],
	asOf: string,
): VersionRegistryRecord | null {
	const anchorDate = parseDate(asOf);
	if (!anchorDate) {
		return null;
	}
	const candidates = records
		.map((record) => ({ record, recordDate: recordEffectiveDate(record) }))
		.filter(
			(item): item is { record: VersionRegistryRecord; recordDate: Date } =>
				item.recordDate !== null && item.recordDate.getTime() <= anchorDate.getTime(),
		)
		.sort((left, right) => {
			const dateDelta = right.recordDate.getTime() - left.recordDate.getTime();
			return dateDelta === 0
				? timestampMillis(right.record) - timestampMillis(left.record)
				: dateDelta;
		});
	return candidates[0]?.record ?? null;
}

function resolveExactRecord(
	records: readonly VersionRegistryRecord[],
	versionId: string,
): VersionRegistryRecord | null {
	return records.find((record) => record.version_id === versionId) ?? null;
}

function selectionFromRecord(
	record: VersionRegistryRecord,
	anchor: VersionSelectionAnchor,
): ResolvedVersionSelection {
	return {
		anchor,
		document_id: record.document_id,
		revision_track: record.revision_track,
		version_id: record.version_id,
	};
}

function resolved(
	mode: DocumentVersionQueryMode,
	primarySelection: ResolvedVersionSelection,
): ResolvedVersionQuery {
	return {
		comparison_selection: null,
		mode,
		primary_selection: primarySelection,
		selected_version_ids: [primarySelection.version_id],
		status: "resolved",
		unresolved_reason: "",
	};
}

function unresolved(
	mode: DocumentVersionQueryMode,
	reason: VersionResolutionReason,
): ResolvedVersionQuery {
	return {
		comparison_selection: null,
		mode,
		primary_selection: null,
		selected_version_ids: [],
		status: "unresolved",
		unresolved_reason: reason,
	};
}

function selectedVersionIds(
	primaryRecord: VersionRegistryRecord,
	comparisonRecord: VersionRegistryRecord,
): string[] {
	return primaryRecord.version_id === comparisonRecord.version_id
		? [primaryRecord.version_id]
		: [primaryRecord.version_id, comparisonRecord.version_id];
}

function normalizeRevisionTracks(value: readonly string[] | undefined): string[] {
	return [...new Set((value ?? []).map((item) => item.trim()).filter(Boolean))];
}

function maxByIngestionTimestamp(
	records: readonly VersionRegistryRecord[],
): VersionRegistryRecord | null {
	let selected: VersionRegistryRecord | null = null;
	for (const record of records) {
		if (!selected || timestampMillis(record) > timestampMillis(selected)) {
			selected = record;
		}
	}
	return selected;
}

function recordEffectiveDate(record: VersionRegistryRecord): Date | null {
	return (
		parseDate(record.effective_date ?? "") ??
		parseDate(record.published_date ?? "") ??
		parseDate(record.ingestion_timestamp)
	);
}

function parseDate(value: string): Date | null {
	const normalized = value.trim();
	if (!normalized) {
		return null;
	}
	const isoDate = normalized.slice(0, 10);
	if (/^\d{4}-\d{2}-\d{2}$/u.test(isoDate)) {
		const parsed = new Date(`${isoDate}T00:00:00.000Z`);
		return Number.isNaN(parsed.getTime()) ? null : parsed;
	}
	const chineseDate = /^(?<year>\d{4})年(?<month>\d{1,2})月(?<day>\d{1,2})日/u.exec(normalized);
	if (chineseDate?.groups) {
		const year = Number(chineseDate.groups.year);
		const month = Number(chineseDate.groups.month);
		const day = Number(chineseDate.groups.day);
		const parsed = new Date(Date.UTC(year, month - 1, day));
		return Number.isNaN(parsed.getTime()) ? null : parsed;
	}
	const parsed = new Date(normalized);
	return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseTimestamp(value: string): Date | null {
	const parsed = new Date(value.trim());
	return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function timestampMillis(record: VersionRegistryRecord): number {
	const parsed = parseTimestamp(record.ingestion_timestamp);
	if (!parsed) {
		throw new Error(`invalid ingestion timestamp for ${record.document_id}/${record.version_id}`);
	}
	return parsed.getTime();
}
