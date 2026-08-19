import {
	NOTICE_SOURCE_PREFIX,
	parseNoticeClassificationSourceJson,
	noticeSourceIdFromKey,
	noticeSourceKey,
	type NoticeClassificationSource,
	validateNoticeIds,
} from "notice-classifier-core/source";
import type { NoticeClassificationTask } from "notice-classifier-core/batch";

import { mapWithConcurrency } from "./concurrency.ts";
import type { NoticeClassifierObjectStore } from "./object-store.ts";

export interface NoticeInputLoadOptions {
	concurrency?: number;
}

export async function loadNoticeClassificationInputs(
	objectStore: Pick<NoticeClassifierObjectStore, "getSource" | "listSource">,
	noticeIds?: readonly number[],
	options: NoticeInputLoadOptions = {},
): Promise<NoticeClassificationTask[]> {
	const ids = noticeIds ? validateNoticeIds(noticeIds) : await listNoticeSourceIds(objectStore);
	if (ids.length === 0) throw new Error("no notice source objects were found");
	const concurrency = options.concurrency ?? 1;
	if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
		throw new Error("notice input concurrency must be a positive integer");
	}
	return mapWithConcurrency(
		[...ids].sort((left, right) => left - right),
		concurrency,
		async (noticeId) => {
			const key = noticeSourceKey(noticeId);
			const notice = await loadNotice(objectStore, key);
			if (notice.notice_id !== noticeId) {
				throw new Error(`${key} contains notice_id ${notice.notice_id}`);
			}
			return { noticeId, noticeTitle: notice.notice_title };
		},
	);
}

export async function listNoticeSourceIds(
	objectStore: Pick<NoticeClassifierObjectStore, "listSource">,
): Promise<number[]> {
	const ids = new Set<number>();
	for (const key of await objectStore.listSource(NOTICE_SOURCE_PREFIX)) {
		const noticeId = noticeSourceIdFromKey(key);
		if (noticeId !== null) ids.add(noticeId);
	}
	return [...ids];
}

async function loadNotice(
	objectStore: Pick<NoticeClassifierObjectStore, "getSource">,
	key: string,
): Promise<NoticeClassificationSource> {
	return parseNoticeClassificationSourceJson(await objectStore.getSource(key), key);
}
