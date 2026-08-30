import { normalizeNoticeContent } from "@campus-agent/notices";
import type { InternalPortalNoticeSource } from "ingestion-contracts";

import type { InternalPortalCollectionObjectStore } from "../../../src/object-store.js";
import { fetchAttachmentBinary } from "./api.js";
import { PortalSessionExpiredError } from "./auth-errors.js";
import type { ApiRequestContextLike } from "./types.js";

const MAX_RESOURCE_BYTES = 100 * 1024 * 1024;

export interface NoticeResourceKindResult {
	downloaded: number;
	existing: number;
	missing: number;
	resources: number;
}

export interface NoticeResourceEnsureResult {
	attachments: NoticeResourceKindResult;
	downloaded: number;
	existing: number;
	images: NoticeResourceKindResult;
	missing: number;
	resources: number;
}

export type NoticeResourceKind = "attachments" | "images";

interface ResourceCandidate {
	kind: NoticeResourceKind;
	noticeId: number;
	ordinal: number;
	url: string;
}

export class NoticeResourceTransferError extends Error {
	readonly noticeId: number;
	readonly operation = "download" as const;
	readonly resourceKind: NoticeResourceKind;
	readonly resourceOrdinal: number;

	constructor(
		input: Pick<ResourceCandidate, "kind" | "noticeId" | "ordinal">,
		options: { cause: unknown },
	) {
		super(
			`notice ${input.noticeId} ${input.kind} resource ${input.ordinal} download failed`,
			{ cause: options.cause },
		);
		this.name = "NoticeResourceTransferError";
		this.noticeId = input.noticeId;
		this.resourceKind = input.kind;
		this.resourceOrdinal = input.ordinal;
	}
}

export async function ensureNoticeResources(input: {
	abortSignal?: AbortSignal;
	apiContext?: ApiRequestContextLike;
	dryRun: boolean;
	notices: readonly InternalPortalNoticeSource[];
	objectStore: InternalPortalCollectionObjectStore;
	portalHost: string;
}): Promise<NoticeResourceEnsureResult> {
	const resources = input.notices.flatMap((notice) => resourceCandidates(notice, input.portalHost));
	const existingByKind = {
		attachments: 0,
		images: 0,
	};
	const missing: ResourceCandidate[] = [];

	for (const resource of resources) {
		const bytes = await input.objectStore.getObjectIfExists({
			...(input.abortSignal === undefined ? {} : { abortSignal: input.abortSignal }),
			bucket: input.objectStore.sourceBucket,
			key: resourceKey(resource),
		});
		if (bytes) {
			existingByKind[resource.kind] += 1;
		} else {
			missing.push(resource);
		}
	}

	if (!input.dryRun && missing.length > 0) {
		if (!input.apiContext) {
			throw new Error("apiContext is required when applying notice resources");
		}
		const apiContext = input.apiContext;
		for (const resource of missing) {
			let file: Awaited<ReturnType<typeof fetchAttachmentBinary>>;
			try {
				file = await fetchAttachmentBinary({
					...(input.abortSignal === undefined ? {} : { abortSignal: input.abortSignal }),
					apiContext,
					attachmentUrl: resource.url,
					maxBytes: MAX_RESOURCE_BYTES,
				});
			} catch (error) {
				if (error instanceof PortalSessionExpiredError) {
					throw error;
				}
				throw new NoticeResourceTransferError(resource, { cause: error });
			}
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
		}
	}

	const missingByKind = countByKind(missing);
	const downloadedByKind = input.dryRun
		? { attachments: 0, images: 0 }
		: { attachments: missingByKind.attachments, images: missingByKind.images };
	return {
		attachments: kindResult(
			resources.filter((resource) => resource.kind === "attachments").length,
			existingByKind.attachments,
			downloadedByKind.attachments,
			input.dryRun ? missingByKind.attachments : 0,
		),
		downloaded: input.dryRun ? 0 : missing.length,
		existing: resources.length - missing.length,
		images: kindResult(
			resources.filter((resource) => resource.kind === "images").length,
			existingByKind.images,
			downloadedByKind.images,
			input.dryRun ? missingByKind.images : 0,
		),
		missing: input.dryRun ? missing.length : 0,
		resources: resources.length,
	};
}

function kindResult(
	resources: number,
	existing: number,
	downloaded: number,
	missing: number,
): NoticeResourceKindResult {
	return { downloaded, existing, missing, resources };
}

function resourceCandidates(
	notice: InternalPortalNoticeSource,
	portalHost: string,
): ResourceCandidate[] {
	if (notice.is_external) {
		return [];
	}
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

function countByKind(resources: readonly ResourceCandidate[]): {
	attachments: number;
	images: number;
} {
	return resources.reduce(
		(counts, resource) => {
			counts[resource.kind] += 1;
			return counts;
		},
		{ attachments: 0, images: 0 },
	);
}
