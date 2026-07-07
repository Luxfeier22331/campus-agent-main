import { z } from "zod";

import { formatZodIssues, parseOptionalText } from "./core.ts";

const NOTICE_CONSUMPTION_STATUS_READY_FOR_TARGET = "ready_for_target_materialization";
const ALLOWED_NOTICE_CONSUMPTION_STATUSES = new Set([
	"retained_for_notice_query",
	NOTICE_CONSUMPTION_STATUS_READY_FOR_TARGET,
	"pending_multimodal_processing",
	"no_adoption",
]);

export interface NoticeConsumptionProjectionEntry {
	source_family: string;
	source_corpus: string;
	source_collection: string;
	source_notice_id: string;
	unit_id: string;
	primary_role: string;
	semantic_owner: string;
	default_agent: string;
	target_surface: string;
	temporal_policy: string;
	completeness_status: string;
	answerability: string;
	consumption_status: string;
	source_notice_document_id: string;
	source_document_id?: string | null;
	source_attachment_ref_ids: string[];
	source_notice_release_time?: string | null;
	role_metadata: Record<string, unknown>;
	updated_at: string;
}

export interface NoticeConsumptionProjectionStore {
	listByScope(
		sourceCorpus: string,
		sourceCollection: string,
		input?: { noticeIds?: readonly string[] },
	): readonly NoticeConsumptionProjectionEntry[];
	replaceNotices(
		sourceCorpus: string,
		sourceCollection: string,
		noticeIds: readonly string[],
		records: readonly NoticeConsumptionProjectionEntry[],
	): void;
}

const NoticeConsumptionProjectionEntrySchema = z.object({
	answerability: z.string(),
	completeness_status: z.string(),
	consumption_status: z.string(),
	default_agent: z.string(),
	primary_role: z.string(),
	role_metadata: z.record(z.string(), z.unknown()).default({}),
	semantic_owner: z.string(),
	source_attachment_ref_ids: z.array(z.string()).default([]),
	source_collection: z.string(),
	source_corpus: z.string(),
	source_document_id: z.string().nullable().optional(),
	source_family: z.string(),
	source_notice_document_id: z.string(),
	source_notice_id: z.string(),
	source_notice_release_time: z.string().nullable().optional(),
	target_surface: z.string(),
	temporal_policy: z.string(),
	unit_id: z.string(),
	updated_at: z.string().default(""),
});

export function parseNoticeConsumptionProjectionEntry(
	value: unknown,
): NoticeConsumptionProjectionEntry {
	const parsed = NoticeConsumptionProjectionEntrySchema.safeParse(value);
	if (!parsed.success) {
		throw new Error(
			`notice consumption projection entry is invalid: ${formatZodIssues(parsed.error.issues, "entry").join("; ")}`,
		);
	}
	if (!ALLOWED_NOTICE_CONSUMPTION_STATUSES.has(parsed.data.consumption_status)) {
		throw new Error(`unsupported notice consumption status: ${parsed.data.consumption_status}`);
	}
	return parsed.data;
}

export function applyNoticeConsumptionProjectionRebuild(input: {
	entries: readonly NoticeConsumptionProjectionEntry[];
	noticeIds?: readonly string[];
	projectionStore: NoticeConsumptionProjectionStore;
	sourceCollection?: string;
	sourceCorpus?: string;
}): NoticeConsumptionProjectionEntry[] {
	const sourceCorpus = input.sourceCorpus ?? "campus_notices";
	const sourceCollection = input.sourceCollection ?? "internal_notice";
	const noticeIds = normalizeNoticeIds(input.noticeIds ?? []);
	if (noticeIds.length === 0) {
		throw new Error(
			"refusing persistent full-scope notice consumption projection rebuild without explicit notice_ids",
		);
	}
	const entries = input.entries
		.map(parseNoticeConsumptionProjectionEntry)
		.filter(
			(entry) =>
				entry.source_corpus === sourceCorpus &&
				entry.source_collection === sourceCollection &&
				noticeIds.includes(entry.source_notice_id),
		)
		.sort(compareNoticeConsumptionProjectionEntries);
	input.projectionStore.replaceNotices(sourceCorpus, sourceCollection, noticeIds, entries);
	return [
		...input.projectionStore.listByScope(sourceCorpus, sourceCollection, {
			noticeIds,
		}),
	].sort(compareNoticeConsumptionProjectionEntries);
}

export function stampNoticeConsumptionAdmissionProvenance(
	entries: readonly NoticeConsumptionProjectionEntry[],
	input: {
		admissionBatchId?: string;
		admissionCommand?: string;
		admissionCreatedAt?: string;
	},
): NoticeConsumptionProjectionEntry[] {
	const admissionBatchId = parseOptionalText(input.admissionBatchId) ?? "";
	const admissionCommand = parseOptionalText(input.admissionCommand) ?? "";
	const admissionCreatedAt = parseOptionalText(input.admissionCreatedAt) ?? "";
	if (!(admissionBatchId || admissionCommand || admissionCreatedAt)) {
		return entries.map(parseNoticeConsumptionProjectionEntry);
	}
	return entries.map((entry) => {
		const parsed = parseNoticeConsumptionProjectionEntry(entry);
		const roleMetadata = { ...parsed.role_metadata };
		if (admissionBatchId) {
			roleMetadata.consumer_admission_batch_id = admissionBatchId;
		}
		if (admissionCommand) {
			roleMetadata.consumer_admission_command = admissionCommand;
		}
		if (admissionCreatedAt) {
			roleMetadata.consumer_admission_created_at = admissionCreatedAt;
		}
		return {
			...parsed,
			role_metadata: roleMetadata,
		};
	});
}

export function selectReadyNoticeConsumptionTargetDocumentIds(
	entries: readonly NoticeConsumptionProjectionEntry[],
	input: {
		primaryRoles?: readonly string[];
		targetSurface: string;
	},
): string[] {
	const allowedRoles = new Set(normalizeStringValues(input.primaryRoles ?? []));
	return [
		...new Set(
			entries
				.map(parseNoticeConsumptionProjectionEntry)
				.filter(
					(entry) =>
						entry.target_surface === input.targetSurface &&
						entry.consumption_status === NOTICE_CONSUMPTION_STATUS_READY_FOR_TARGET &&
						parseOptionalText(entry.source_document_id) &&
						(allowedRoles.size === 0 || allowedRoles.has(entry.primary_role)),
				)
				.map((entry) => parseOptionalText(entry.source_document_id))
				.filter((value): value is string => Boolean(value)),
		),
	].sort();
}

function compareNoticeConsumptionProjectionEntries(
	left: NoticeConsumptionProjectionEntry,
	right: NoticeConsumptionProjectionEntry,
): number {
	return `${left.source_notice_id}/${left.unit_id}`.localeCompare(
		`${right.source_notice_id}/${right.unit_id}`,
	);
}

function normalizeNoticeIds(values: readonly string[]): string[] {
	return normalizeStringValues(values).sort();
}

function normalizeStringValues(values: readonly string[]): string[] {
	return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
