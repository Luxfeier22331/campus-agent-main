import type {
	InternalNoticeReadModelEntry,
	InternalNoticeReadModelStore,
} from "./internal-notice-read-model.ts";
import { parseInternalNoticeReadModelEntry } from "./internal-notice-read-model.ts";
import {
	applyNoticeConsumptionProjectionRebuild,
	type NoticeConsumptionProjectionEntry,
	type NoticeConsumptionProjectionStore,
	parseNoticeConsumptionProjectionEntry,
} from "./notice-consumption-projection.ts";
import {
	WECHAT_PUBLIC_NOTICE_SOURCE_COLLECTION,
	WECHAT_PUBLIC_NOTICE_SOURCE_CORPUS,
} from "./wechat-public-notice-types.ts";

export function applyWeChatPublicNoticeProjectionRebuild(input: {
	projectionEntries: readonly NoticeConsumptionProjectionEntry[];
	projectionStore: NoticeConsumptionProjectionStore;
	sourceCollection?: string;
	sourceCorpus?: string;
}): NoticeConsumptionProjectionEntry[] {
	const sourceCorpus = input.sourceCorpus ?? WECHAT_PUBLIC_NOTICE_SOURCE_CORPUS;
	const sourceCollection = input.sourceCollection ?? WECHAT_PUBLIC_NOTICE_SOURCE_COLLECTION;
	const noticeIds = selectNoticeIdsFromProjectionEntries(input.projectionEntries);
	return applyNoticeConsumptionProjectionRebuild({
		entries: input.projectionEntries,
		noticeIds,
		projectionStore: input.projectionStore,
		sourceCollection,
		sourceCorpus,
	});
}

export function applyWeChatPublicNoticeReadModelMaterialization(input: {
	noticeIds?: readonly string[];
	readModelRows: readonly InternalNoticeReadModelEntry[];
	readModelStore: InternalNoticeReadModelStore;
	sourceCollection?: string;
	sourceCorpus?: string;
}): InternalNoticeReadModelEntry[] {
	const sourceCorpus = input.sourceCorpus ?? WECHAT_PUBLIC_NOTICE_SOURCE_CORPUS;
	const sourceCollection = input.sourceCollection ?? WECHAT_PUBLIC_NOTICE_SOURCE_COLLECTION;
	const rows = input.readModelRows
		.map(parseInternalNoticeReadModelEntry)
		.filter(
			(row) => row.source_corpus === sourceCorpus && row.source_collection === sourceCollection,
		)
		.sort(compareInternalNoticeReadModelRows);
	const noticeIds = normalizeStringValues(
		input.noticeIds ?? rows.map((row) => row.source_notice_id),
	);
	if (noticeIds.length === 0) {
		return [];
	}
	input.readModelStore.replaceNotices(sourceCorpus, sourceCollection, noticeIds, rows);
	return [
		...input.readModelStore.listByScope(sourceCorpus, sourceCollection, {
			noticeIds,
		}),
	].sort(compareInternalNoticeReadModelRows);
}

function selectNoticeIdsFromProjectionEntries(
	entries: readonly NoticeConsumptionProjectionEntry[],
): string[] {
	return normalizeStringValues(
		entries.map((entry) => parseNoticeConsumptionProjectionEntry(entry).source_notice_id),
	);
}

function compareInternalNoticeReadModelRows(
	left: InternalNoticeReadModelEntry,
	right: InternalNoticeReadModelEntry,
): number {
	return `${left.source_notice_id}/${left.unit_id}`.localeCompare(
		`${right.source_notice_id}/${right.unit_id}`,
	);
}

function normalizeStringValues(values: readonly string[]): string[] {
	return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}
