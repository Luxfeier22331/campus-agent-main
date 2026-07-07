import { z } from "zod";

import { formatZodIssues, type ObjectStoreReader, parseOptionalText } from "./core.ts";

const BODY_EXCERPT_MAX_CHARS = 800;
const SEARCH_TEXT_MAX_CHARS = 2000;
const NOTICE_CONSUMPTION_STATUS_NO_ADOPTION = "no_adoption";
const NOTICE_TARGET_SURFACE_NOTICE_LEVEL_QUERY = "notice_level_query";

export interface InternalNoticeProjectionEntry {
	source_family: string;
	source_corpus: string;
	source_collection: string;
	source_notice_id: string;
	unit_id: string;
	primary_role: string;
	target_surface: string;
	consumption_status: string;
	source_notice_document_id: string;
	source_document_id?: string | null;
	source_attachment_ref_ids?: readonly string[] | null;
	source_notice_release_time?: string | null;
	role_metadata?: Record<string, unknown> | null;
	updated_at?: string | null;
}

export interface InternalNoticeDocumentRegistryRecord {
	document_id: string;
	corpus: string;
	collection: string;
	source_uri: string;
	visibility_level?: string | null;
	entitlement_groups?: readonly string[] | null;
	policy_projection_version?: string | null;
	published_date?: string | null;
	is_current?: boolean | null;
	canonical_markdown_object_key?: string | null;
}

export interface InternalNoticeDocumentRegistryReader {
	listByScope(corpus: string, collection: string): readonly InternalNoticeDocumentRegistryRecord[];
}

export interface InternalNoticeProjectionStore {
	listByScope(
		sourceCorpus: string,
		sourceCollection: string,
		input?: { noticeIds?: readonly string[] },
	): readonly InternalNoticeProjectionEntry[];
}

export interface InternalNoticeReadModelStore {
	listByScope(
		sourceCorpus: string,
		sourceCollection: string,
		input?: { noticeIds?: readonly string[] },
	): readonly InternalNoticeReadModelEntry[];
	replaceNotices(
		sourceCorpus: string,
		sourceCollection: string,
		noticeIds: readonly string[],
		records: readonly InternalNoticeReadModelEntry[],
	): void;
}

export interface InternalNoticeReadModelEntry {
	source_family: string;
	source_corpus: string;
	source_collection: string;
	source_notice_id: string;
	unit_id: string;
	primary_role: string;
	target_surface: string;
	consumption_status: string;
	queryable: boolean;
	title: string;
	visibility_level: string;
	entitlement_groups: string[];
	policy_projection_version: string;
	published_at: string;
	published_at_ts: string;
	effective_at_ts: string;
	expires_at_ts: string;
	source_url: string;
	canonical_url: string;
	canonical_document_id: string;
	canonical_markdown_object_key: string;
	attachment_refs: string[];
	provenance_refs: string[];
	body_excerpt: string;
	search_text: string;
	projection_updated_at: string;
	updated_at: string;
}

export interface InternalNoticeReadModelConsistencyReport {
	source_corpus: string;
	source_collection: string;
	selected_notice_ids: string[];
	projection_entry_count: number;
	projection_queryable_count: number;
	read_model_entry_count: number;
	missing_queryable_projection_unit_ids: string[];
	extra_read_model_unit_ids: string[];
	ok: boolean;
}

export interface InternalNoticeReadModelRepairReport {
	source_corpus: string;
	source_collection: string;
	selected_notice_ids: string[];
	before: InternalNoticeReadModelConsistencyReport;
	after: InternalNoticeReadModelConsistencyReport;
	rebuilt_count: number;
}

const InternalNoticeReadModelEntrySchema = z.object({
	attachment_refs: z.array(z.string()).default([]),
	body_excerpt: z.string().default(""),
	canonical_document_id: z.string().default(""),
	canonical_markdown_object_key: z.string().default(""),
	canonical_url: z.string().default(""),
	consumption_status: z.string(),
	effective_at_ts: z.string().default(""),
	entitlement_groups: z.array(z.string()).default([]),
	expires_at_ts: z.string().default(""),
	policy_projection_version: z.string().default(""),
	primary_role: z.string(),
	projection_updated_at: z.string().default(""),
	provenance_refs: z.array(z.string()).default([]),
	published_at: z.string().default(""),
	published_at_ts: z.string().default(""),
	queryable: z.boolean(),
	search_text: z.string().default(""),
	source_collection: z.string(),
	source_corpus: z.string(),
	source_family: z.string(),
	source_notice_id: z.string(),
	source_url: z.string().default(""),
	target_surface: z.string(),
	title: z.string(),
	unit_id: z.string(),
	updated_at: z.string().default(""),
	visibility_level: z.string().default(""),
});

export function parseInternalNoticeReadModelEntry(value: unknown): InternalNoticeReadModelEntry {
	const parsed = InternalNoticeReadModelEntrySchema.safeParse(value);
	if (!parsed.success) {
		throw new Error(
			`internal notice read model entry is invalid: ${formatZodIssues(parsed.error.issues, "entry").join("; ")}`,
		);
	}
	return parsed.data;
}

export async function buildInternalNoticeReadModelEntries(
	projectionEntries: readonly InternalNoticeProjectionEntry[],
	input: {
		bucketDerived: string;
		objectStore: ObjectStoreReader;
		registry: InternalNoticeDocumentRegistryReader;
		now?: () => string;
	},
): Promise<InternalNoticeReadModelEntry[]> {
	if (projectionEntries.length === 0) {
		return [];
	}
	const sourceCorpus = projectionEntries[0]?.source_corpus ?? "";
	const sourceCollection = projectionEntries[0]?.source_collection ?? "";
	const recordsByDocumentId = indexCurrentScopeRecords(
		input.registry.listByScope(sourceCorpus, sourceCollection),
	);
	const rows: InternalNoticeReadModelEntry[] = [];
	for (const entry of projectionEntries) {
		if (!isNoticeReadModelSurface(entry)) {
			continue;
		}
		const documentId = entry.source_document_id?.trim() || entry.source_notice_document_id;
		const record =
			recordsByDocumentId.get(documentId) ??
			recordsByDocumentId.get(entry.source_notice_document_id);
		if (!record) {
			continue;
		}
		const title = resolveTitle(entry, record);
		const canonicalKey = parseOptionalText(record.canonical_markdown_object_key) ?? "";
		const body = canonicalKey
			? new TextDecoder().decode(
					await input.objectStore.getObject({
						bucket: input.bucketDerived,
						key: canonicalKey,
					}),
				)
			: "";
		const bodyExcerpt = buildBodyExcerpt(buildReadModelBodyText(entry, body));
		const publishedAt =
			parseOptionalText(entry.source_notice_release_time) ??
			parseOptionalText(record.published_date) ??
			"";
		const publishedAtTs = normalizeRequiredNoticeTimestamp(publishedAt);
		rows.push({
			attachment_refs: normalizeStringArray(entry.source_attachment_ref_ids),
			body_excerpt: bodyExcerpt,
			canonical_document_id: record.document_id,
			canonical_markdown_object_key: canonicalKey,
			canonical_url: record.source_uri,
			consumption_status: entry.consumption_status,
			effective_at_ts: "",
			entitlement_groups: normalizeStringArray(record.entitlement_groups),
			expires_at_ts: "",
			policy_projection_version: parseOptionalText(record.policy_projection_version) ?? "",
			primary_role: entry.primary_role,
			projection_updated_at: parseOptionalText(entry.updated_at) ?? "",
			provenance_refs: buildProvenanceRefs(entry, record),
			published_at: publishedAt,
			published_at_ts: publishedAtTs,
			queryable: isNoticeReadModelSurface(entry),
			search_text: buildSearchText(entry, { bodyExcerpt, title }),
			source_collection: entry.source_collection,
			source_corpus: entry.source_corpus,
			source_family: entry.source_family,
			source_notice_id: entry.source_notice_id,
			source_url: record.source_uri,
			target_surface: entry.target_surface,
			title,
			unit_id: entry.unit_id,
			updated_at: input.now?.() ?? new Date().toISOString(),
			visibility_level: parseOptionalText(record.visibility_level) ?? "",
		});
	}
	return rows.sort((left, right) =>
		`${left.source_notice_id}/${left.unit_id}`.localeCompare(
			`${right.source_notice_id}/${right.unit_id}`,
		),
	);
}

export async function rebuildInternalNoticeReadModel(input: {
	bucketDerived: string;
	noticeIds?: readonly string[];
	objectStore: ObjectStoreReader;
	projectionStore: InternalNoticeProjectionStore;
	readModelStore: InternalNoticeReadModelStore;
	registry: InternalNoticeDocumentRegistryReader;
	sourceCollection?: string;
	sourceCorpus?: string;
}): Promise<InternalNoticeReadModelEntry[]> {
	const sourceCorpus = input.sourceCorpus ?? "campus_notices";
	const sourceCollection = input.sourceCollection ?? "internal_notice";
	const noticeIds = normalizeNoticeIds(input.noticeIds ?? []);
	if (noticeIds.length === 0) {
		throw new Error(
			"refusing persistent full-scope internal notice read model rebuild without explicit notice_ids",
		);
	}
	const projectionEntries = input.projectionStore.listByScope(sourceCorpus, sourceCollection, {
		noticeIds,
	});
	const rows = await buildInternalNoticeReadModelEntries(projectionEntries, {
		bucketDerived: input.bucketDerived,
		objectStore: input.objectStore,
		registry: input.registry,
	});
	input.readModelStore.replaceNotices(sourceCorpus, sourceCollection, noticeIds, rows);
	return [...input.readModelStore.listByScope(sourceCorpus, sourceCollection, { noticeIds })];
}

export async function checkInternalNoticeReadModelConsistency(input: {
	noticeIds?: readonly string[];
	projectionStore: InternalNoticeProjectionStore;
	readModelStore: Pick<InternalNoticeReadModelStore, "listByScope">;
	sourceCollection?: string;
	sourceCorpus?: string;
}): Promise<InternalNoticeReadModelConsistencyReport> {
	const sourceCorpus = input.sourceCorpus ?? "campus_notices";
	const sourceCollection = input.sourceCollection ?? "internal_notice";
	const noticeIds = normalizeNoticeIds(input.noticeIds ?? []);
	const projectionEntries = input.projectionStore.listByScope(sourceCorpus, sourceCollection, {
		noticeIds,
	});
	const readModelRows = input.readModelStore.listByScope(sourceCorpus, sourceCollection, {
		noticeIds,
	});
	const queryableProjectionUnitIds = new Set(
		projectionEntries.filter(isNoticeReadModelSurface).map((entry) => entry.unit_id),
	);
	const readModelUnitIds = new Set(readModelRows.map((row) => row.unit_id));
	const missingQueryableProjectionUnitIds = sortedDifference(
		queryableProjectionUnitIds,
		readModelUnitIds,
	);
	const extraReadModelUnitIds = sortedDifference(readModelUnitIds, queryableProjectionUnitIds);
	return {
		extra_read_model_unit_ids: extraReadModelUnitIds,
		missing_queryable_projection_unit_ids: missingQueryableProjectionUnitIds,
		ok: missingQueryableProjectionUnitIds.length === 0 && extraReadModelUnitIds.length === 0,
		projection_entry_count: projectionEntries.length,
		projection_queryable_count: queryableProjectionUnitIds.size,
		read_model_entry_count: readModelRows.length,
		selected_notice_ids: noticeIds,
		source_collection: sourceCollection,
		source_corpus: sourceCorpus,
	};
}

export async function repairInternalNoticeReadModelConsistency(input: {
	bucketDerived: string;
	noticeIds?: readonly string[];
	objectStore: ObjectStoreReader;
	projectionStore: InternalNoticeProjectionStore;
	readModelStore: InternalNoticeReadModelStore;
	registry: InternalNoticeDocumentRegistryReader;
	sourceCollection?: string;
	sourceCorpus?: string;
}): Promise<InternalNoticeReadModelRepairReport> {
	const sourceCorpus = input.sourceCorpus ?? "campus_notices";
	const sourceCollection = input.sourceCollection ?? "internal_notice";
	const noticeIds = normalizeNoticeIds(input.noticeIds ?? []);
	if (noticeIds.length === 0) {
		throw new Error("selected notice_ids are required for read model consistency repair");
	}
	const before = await checkInternalNoticeReadModelConsistency({
		noticeIds,
		projectionStore: input.projectionStore,
		readModelStore: input.readModelStore,
		sourceCollection,
		sourceCorpus,
	});
	const rows = await rebuildInternalNoticeReadModel({
		bucketDerived: input.bucketDerived,
		noticeIds,
		objectStore: input.objectStore,
		projectionStore: input.projectionStore,
		readModelStore: input.readModelStore,
		registry: input.registry,
		sourceCollection,
		sourceCorpus,
	});
	const after = await checkInternalNoticeReadModelConsistency({
		noticeIds,
		projectionStore: input.projectionStore,
		readModelStore: input.readModelStore,
		sourceCollection,
		sourceCorpus,
	});
	return {
		after,
		before,
		rebuilt_count: rows.length,
		selected_notice_ids: noticeIds,
		source_collection: sourceCollection,
		source_corpus: sourceCorpus,
	};
}

function isNoticeReadModelSurface(entry: InternalNoticeProjectionEntry): boolean {
	return (
		isNoticeQueryRetainedConsumptionStatus(entry.consumption_status) &&
		entry.consumption_status !== NOTICE_CONSUMPTION_STATUS_NO_ADOPTION &&
		entry.target_surface === NOTICE_TARGET_SURFACE_NOTICE_LEVEL_QUERY
	);
}

function isNoticeQueryRetainedConsumptionStatus(value: string): boolean {
	return value === "retained_for_notice_query" || value === "ready_for_target";
}

function resolveTitle(
	entry: InternalNoticeProjectionEntry,
	record: InternalNoticeDocumentRegistryRecord,
): string {
	const metadata = entry.role_metadata ?? {};
	return (
		parseOptionalText(metadata.notice_title) ??
		parseOptionalText(metadata.title) ??
		parseOptionalText(metadata.regulation_title_normalized) ??
		record.document_id
	);
}

function buildSearchText(
	entry: InternalNoticeProjectionEntry,
	input: { bodyExcerpt: string; title: string },
): string {
	const metadata = entry.role_metadata ?? {};
	const metadataValues = Object.entries(metadata)
		.filter(([key]) =>
			[
				"multimodal_extracted_text",
				"multimodal_summary",
				"notice_category",
				"notice_title",
				"title",
			].includes(key),
		)
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([, value]) => String(value));
	return [
		input.title,
		entry.source_notice_id,
		entry.primary_role,
		entry.target_surface,
		...metadataValues,
		input.bodyExcerpt,
	]
		.map((value) => value.trim())
		.filter(Boolean)
		.join("\n")
		.slice(0, SEARCH_TEXT_MAX_CHARS);
}

function buildBodyExcerpt(value: string): string {
	return value.trim().slice(0, BODY_EXCERPT_MAX_CHARS);
}

function buildReadModelBodyText(entry: InternalNoticeProjectionEntry, body: string): string {
	const metadata = entry.role_metadata ?? {};
	return [
		body.trim(),
		parseOptionalText(metadata.multimodal_summary) ?? "",
		parseOptionalText(metadata.multimodal_extracted_text) ?? "",
	]
		.filter(Boolean)
		.join("\n\n");
}

function buildProvenanceRefs(
	entry: InternalNoticeProjectionEntry,
	record: InternalNoticeDocumentRegistryRecord,
): string[] {
	return [
		entry.source_notice_document_id,
		entry.source_document_id ?? "",
		record.document_id,
		...normalizeStringArray(entry.source_attachment_ref_ids),
		entry.unit_id,
	].filter((value, index, values) => value && values.indexOf(value) === index);
}

function normalizeRequiredNoticeTimestamp(value: string): string {
	const text = value.trim();
	if (!text) {
		throw new Error("notice read model published_at is required");
	}
	const normalized = text.replace("Z", "+00:00");
	const parsed = parseDateTime(normalized) ?? parseDateTime(`${normalized}T00:00:00+08:00`);
	if (!parsed) {
		throw new Error(`notice read model published_at must be ISO timestamp/date: ${text}`);
	}
	if (hasTimezone(normalized)) {
		return parsed.toISOString().replace(".000Z", "+00:00");
	}
	return `${normalized}T00:00:00+08:00`;
}

function parseDateTime(value: string): Date | null {
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? null : date;
}

function hasTimezone(value: string): boolean {
	return /(?:z|[+-]\d{2}:\d{2})$/iu.test(value);
}

function indexCurrentScopeRecords(
	records: readonly InternalNoticeDocumentRegistryRecord[],
): Map<string, InternalNoticeDocumentRegistryRecord> {
	const indexed = new Map<string, InternalNoticeDocumentRegistryRecord>();
	for (const record of records) {
		const current = indexed.get(record.document_id);
		if (!current || (record.is_current && !current.is_current)) {
			indexed.set(record.document_id, record);
		}
	}
	return indexed;
}

function normalizeNoticeIds(values: readonly string[]): string[] {
	return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}

function normalizeStringArray(values: readonly string[] | null | undefined): string[] {
	return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))];
}

function sortedDifference(left: Set<string>, right: Set<string>): string[] {
	return [...left].filter((value) => !right.has(value)).sort();
}
