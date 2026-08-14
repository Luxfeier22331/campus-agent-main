import { normalizeNoticeContent } from "@campus-agent/notices";
import {
	type InternalPortalNoticeSource,
	validateInternalPortalNoticeSource,
} from "ingestion-contracts";

import type { SourceCollectorObjectStore } from "../../../src/object-store.js";
import { fetchAttachmentBinary } from "./api.js";
import type { ApiRequestContextLike } from "./types.js";

const MAX_RESOURCE_BYTES = 100 * 1024 * 1024;
const NOTICE_KEY = /^internal_portal\/notices\/([1-9][0-9]*)\.json$/u;

interface ResourceCandidate {
	kind: "attachments" | "images";
	noticeId: number;
	ordinal: number;
	url: string;
}

export interface NoticeResourceBackfillResult {
	downloaded: number;
	existing: number;
	missing: number;
	mode: "apply" | "dry_run";
	notices: number;
	resources: number;
}

export async function backfillNoticeResources(input: {
	abortSignal?: AbortSignal;
	apiContext?: ApiRequestContextLike;
	concurrency?: number;
	dryRun: boolean;
	noticeIds?: readonly number[];
	objectStore: SourceCollectorObjectStore;
	portalHost: string;
}): Promise<NoticeResourceBackfillResult> {
	const concurrency = input.concurrency ?? 4;
	if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16) {
		throw new Error("resource concurrency must be between 1 and 16");
	}
	const notices = await loadNotices(input.objectStore, input.noticeIds);
	const resources = notices.flatMap((notice) => resourceCandidates(notice, input.portalHost));
	let existing = 0;
	const missing: ResourceCandidate[] = [];
	for (const resource of resources) {
		const bytes = await input.objectStore.getObjectIfExists({
			bucket: input.objectStore.sourceBucket,
			key: resourceKey(resource),
		});
		if (bytes) {
			existing += 1;
		} else {
			missing.push(resource);
		}
	}
	if (!input.dryRun) {
		if (!input.apiContext) {
			throw new Error("apiContext is required when applying resource backfill");
		}
		const apiContext = input.apiContext;
		await mapConcurrent(missing, concurrency, async (resource) => {
			const file = await fetchAttachmentBinary({
				...(input.abortSignal === undefined ? {} : { abortSignal: input.abortSignal }),
				apiContext,
				attachmentUrl: resource.url,
				maxBytes: MAX_RESOURCE_BYTES,
			});
			try {
				await input.objectStore.createOrVerifyStream({
					...(input.abortSignal === undefined ? {} : { abortSignal: input.abortSignal }),
					body: file.openReadStream(),
					bucket: input.objectStore.sourceBucket,
					byteSize: file.byteSize,
					contentSha256: file.contentSha256,
					contentType: file.contentType ?? "application/octet-stream",
					key: resourceKey(resource),
				});
			} finally {
				await file.remove();
			}
		});
	}
	return {
		downloaded: input.dryRun ? 0 : missing.length,
		existing,
		missing: input.dryRun ? missing.length : 0,
		mode: input.dryRun ? "dry_run" : "apply",
		notices: notices.length,
		resources: resources.length,
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

function resourceCandidates(
	notice: InternalPortalNoticeSource,
	portalHost: string,
): ResourceCandidate[] {
	const images = normalizeNoticeContent({
		html: notice.notice_content_html,
		portalHost,
		title: notice.notice_title,
	}).images.map((image) => ({
		kind: "images" as const,
		noticeId: notice.notice_id,
		ordinal: image.sourceOrdinal,
		url: image.normalizedUrl,
	}));
	const attachments = notice.attachments.map((attachment, ordinal) => {
		if (!attachment.notice_annex_id) {
			throw new Error(`notice ${notice.notice_id} attachment ${ordinal} has no id`);
		}
		return {
			kind: "attachments" as const,
			noticeId: notice.notice_id,
			ordinal,
			url: attachmentDownloadPath(notice.notice_id, attachment.notice_annex_id),
		};
	});
	return [...images, ...attachments];
}

function attachmentDownloadPath(noticeId: number, attachmentId: string): string {
	const search = new URLSearchParams({ id: attachmentId, notice_id: String(noticeId) });
	return `/comsys-portal-notice-web/download?${search.toString()}`;
}

function resourceKey(resource: ResourceCandidate): string {
	return `internal_portal/notices/${resource.noticeId}/${resource.kind}/${resource.ordinal}`;
}
async function mapConcurrent<T>(
	items: readonly T[],
	concurrency: number,
	operation: (item: T) => Promise<void>,
): Promise<void> {
	let next = 0;
	await Promise.all(
		Array.from({ length: Math.min(concurrency, items.length) }, async () => {
			while (next < items.length) {
				const index = next;
				next += 1;
				await operation(items[index] as T);
			}
		}),
	);
}
