import {
	type InternalPortalNoticeSource,
	validateInternalPortalNoticeSource,
} from "ingestion-contracts";

import type { SourceCollectorObjectStore } from "../../../src/object-store.js";
import { ensureNoticeResources, type NoticeResourceEnsureResult } from "./notice-resources.js";
import type { ApiRequestContextLike } from "./types.js";

const NOTICE_KEY = /^internal_portal\/notices\/([1-9][0-9]*)\.json$/u;

export type NoticeResourceBackfillResult = Omit<
	NoticeResourceEnsureResult,
	"attachments" | "images"
> & {
	mode: "apply" | "dry_run";
	notices: number;
};

export async function backfillNoticeResources(input: {
	abortSignal?: AbortSignal;
	apiContext?: ApiRequestContextLike;
	concurrency?: number;
	dryRun: boolean;
	noticeIds?: readonly number[];
	objectStore: SourceCollectorObjectStore;
	portalHost: string;
}): Promise<NoticeResourceBackfillResult> {
	const notices = await loadNotices(input.objectStore, input.noticeIds);
	const result = await ensureNoticeResources({
		...(input.abortSignal === undefined ? {} : { abortSignal: input.abortSignal }),
		...(input.apiContext === undefined ? {} : { apiContext: input.apiContext }),
		...(input.concurrency === undefined ? {} : { concurrency: input.concurrency }),
		dryRun: input.dryRun,
		notices,
		objectStore: input.objectStore,
		portalHost: input.portalHost,
	});
	return {
		downloaded: result.downloaded,
		existing: result.existing,
		missing: result.missing,
		mode: input.dryRun ? "dry_run" : "apply",
		notices: notices.length,
		resources: result.resources,
	};
}

async function loadNotices(
	store: SourceCollectorObjectStore,
	ids?: readonly number[],
): Promise<InternalPortalNoticeSource[]> {
	if (!(ids || store.listObjectKeys)) {
		throw new Error("object store listing is unavailable");
	}
	const selected = ids
		? [...ids]
		: (
				(await store.listObjectKeys?.({
					bucket: store.sourceBucket,
					prefix: "internal_portal/notices/",
				})) ?? []
			).flatMap((key) => {
				const match = NOTICE_KEY.exec(key);
				return match ? [Number(match[1])] : [];
			});
	if (selected.length === 0) {
		throw new Error("no notice source objects were selected");
	}
	const notices: InternalPortalNoticeSource[] = [];
	for (const id of [...new Set(selected)].sort((left, right) => left - right)) {
		const key = `internal_portal/notices/${id}.json`;
		const value = JSON.parse(
			Buffer.from(await store.getObject({ bucket: store.sourceBucket, key })).toString("utf8"),
		) as unknown;
		const validation = validateInternalPortalNoticeSource(value);
		if (!validation.ok) {
			throw new Error(`${key} violates its contract: ${validation.errors.join("; ")}`);
		}
		if ((value as InternalPortalNoticeSource).notice_id !== id) {
			throw new Error(`${key} contains a different notice_id`);
		}
		notices.push(value as InternalPortalNoticeSource);
	}
	return notices;
}
