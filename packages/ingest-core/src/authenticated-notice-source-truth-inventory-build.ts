import {
	type AuthenticatedNoticeDocumentRegistryRecord,
	type AuthenticatedNoticeRawAssetRecord,
	type AuthenticatedNoticeSourceTruthInventoryEntry,
	buildAuthenticatedNoticeSourceTruthParentSnapshotFromPayloads,
	inventoryEntryFromAuthenticatedNoticeParentSnapshot,
	selectLatestAuthenticatedNoticeParentRecords,
} from "./authenticated-notice-source-truth-inventory.ts";

export interface AuthenticatedNoticeSourceTruthInventoryBuildInput {
	attachmentRefsByKey: Readonly<Record<string, readonly Record<string, unknown>[]>>;
	noticeIds?: readonly string[];
	noticeManifestByKey: Readonly<Record<string, Record<string, unknown>>>;
	rawRecords: readonly AuthenticatedNoticeRawAssetRecord[];
	records: readonly AuthenticatedNoticeDocumentRegistryRecord[];
}

export function buildAuthenticatedNoticeSourceTruthInventoryEntriesFromRecords(
	input: AuthenticatedNoticeSourceTruthInventoryBuildInput,
): AuthenticatedNoticeSourceTruthInventoryEntry[] {
	const normalizedNoticeIds = normalizeNoticeIds(input.noticeIds ?? []);
	const noticeIdSet = new Set(normalizedNoticeIds);
	const recordsWithSourceTruth = input.records.filter((record) => {
		if (record.source_channel !== "internal_portal") {
			return false;
		}
		if (
			noticeIdSet.size > 0 &&
			!noticeIdSet.has(extractNoticeIdFromDocumentId(record.document_id))
		) {
			return false;
		}
		return Boolean(
			findSourceTruthKey(record, "notice-manifest.json") &&
				findSourceTruthKey(record, "content-blocks.jsonl") &&
				findSourceTruthKey(record, "attachment-refs.jsonl"),
		);
	});
	if (noticeIdSet.size > 0) {
		const foundNoticeIds = new Set(
			recordsWithSourceTruth.map((record) => extractNoticeIdFromDocumentId(record.document_id)),
		);
		const missingNoticeIds = normalizedNoticeIds.filter(
			(noticeId) => !foundNoticeIds.has(noticeId),
		);
		if (missingNoticeIds.length > 0) {
			throw new Error(
				`authenticated notice source inventory notice_ids not found in registry scope: ${missingNoticeIds.join(", ")}`,
			);
		}
	}

	const rawByKey = new Map(
		input.rawRecords.map((record) => [
			rawRecordKey(record.raw_asset_id, record.raw_version_id),
			record,
		]),
	);
	return selectLatestAuthenticatedNoticeParentRecords({
		rawRecords: input.rawRecords,
		records: recordsWithSourceTruth,
	})
		.map((record) =>
			buildInventoryEntry({
				attachmentRefsByKey: input.attachmentRefsByKey,
				noticeManifestByKey: input.noticeManifestByKey,
				rawByKey,
				record,
			}),
		)
		.sort((left, right) => left.notice_id.localeCompare(right.notice_id));
}

function buildInventoryEntry(input: {
	attachmentRefsByKey: Readonly<Record<string, readonly Record<string, unknown>[]>>;
	noticeManifestByKey: Readonly<Record<string, Record<string, unknown>>>;
	rawByKey: ReadonlyMap<string, AuthenticatedNoticeRawAssetRecord>;
	record: AuthenticatedNoticeDocumentRegistryRecord;
}): AuthenticatedNoticeSourceTruthInventoryEntry {
	const noticeManifestKey = requireSourceTruthKey(input.record, "notice-manifest.json");
	const contentBlocksKey = requireSourceTruthKey(input.record, "content-blocks.jsonl");
	const attachmentRefsKey = requireSourceTruthKey(input.record, "attachment-refs.jsonl");
	if (!input.record.raw_asset) {
		throw new Error(
			`authenticated notice source-truth parent missing raw asset: ${input.record.document_id}`,
		);
	}
	const rawRecord = input.rawByKey.get(
		rawRecordKey(input.record.raw_asset.raw_asset_id, input.record.raw_asset.raw_version_id),
	);
	if (!rawRecord) {
		throw new Error(
			`authenticated notice source inventory requires persisted raw asset registry truth: ${input.record.raw_asset.raw_asset_id}/${input.record.raw_asset.raw_version_id}`,
		);
	}
	const noticeManifest = input.noticeManifestByKey[noticeManifestKey];
	if (!noticeManifest) {
		throw new Error(
			`authenticated notice source inventory missing notice manifest: ${noticeManifestKey}`,
		);
	}
	const attachmentRefs = input.attachmentRefsByKey[attachmentRefsKey];
	if (!attachmentRefs) {
		throw new Error(
			`authenticated notice source inventory missing attachment refs: ${attachmentRefsKey}`,
		);
	}
	return inventoryEntryFromAuthenticatedNoticeParentSnapshot(
		buildAuthenticatedNoticeSourceTruthParentSnapshotFromPayloads({
			attachmentRefs,
			attachmentRefsKey,
			contentBlocksKey,
			noticeManifest,
			noticeManifestKey,
			rawRecord,
			record: input.record,
			sourceArtifactKeys: sourceTruthKeys(input.record),
		}),
	);
}

function requireSourceTruthKey(
	record: AuthenticatedNoticeDocumentRegistryRecord,
	filename: string,
): string {
	const key = findSourceTruthKey(record, filename);
	if (!key) {
		throw new Error(
			`authenticated notice source inventory missing ${filename}: ${record.document_id}`,
		);
	}
	return key;
}

function findSourceTruthKey(
	record: AuthenticatedNoticeDocumentRegistryRecord,
	filename: string,
): string | null {
	return sourceTruthKeys(record).find((key) => key.endsWith(`/source-truth/${filename}`)) ?? null;
}

function sourceTruthKeys(record: AuthenticatedNoticeDocumentRegistryRecord): string[] {
	return (record.processed_object_keys ?? [])
		.map((key) => key.trim())
		.filter((key) => key.includes("/source-truth/") && key.length > 0);
}

function normalizeNoticeIds(noticeIds: readonly string[]): string[] {
	return [...new Set(noticeIds.map((item) => item.trim()).filter(Boolean))].sort();
}

function extractNoticeIdFromDocumentId(documentId: string): string {
	const parts = documentId.split(":").map((part) => part.trim());
	if (parts.length < 3 || parts[0] !== "notice" || !parts[2]) {
		throw new Error(
			`authenticated notice source inventory requires notice document ids: ${documentId}`,
		);
	}
	return parts[2];
}

function rawRecordKey(rawAssetId: string, rawVersionId: string): string {
	return `${rawAssetId}\n${rawVersionId}`;
}
