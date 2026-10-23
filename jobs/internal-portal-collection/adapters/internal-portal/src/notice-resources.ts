import { normalizeNoticeContent } from "@campus-agent/notices";
import type { InternalPortalNoticeResource, InternalPortalNoticeSource } from "ingestion-contracts";
import { createHash } from "node:crypto";

import type { InternalPortalCollectionObjectStore } from "../../../src/object-store.js";
import { fetchAttachmentBinary, PortalHttpError } from "./api.js";
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
	resourceRefs: InternalPortalNoticeResource[];
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
	refresh?: boolean;
	notices: readonly InternalPortalNoticeSource[];
	objectStore: InternalPortalCollectionObjectStore;
	portalHost: string;
}): Promise<NoticeResourceEnsureResult> {
	const resources = input.notices.flatMap((notice) => resourceCandidates(notice, input.portalHost));
	const existingByKind = {
		attachments: 0,
		images: 0,
	};
	const downloadedByKind = {
		attachments: 0,
		images: 0,
	};
	const permanentlyMissingByKind = {
		attachments: 0,
		images: 0,
	};
	const missing: ResourceCandidate[] = [];
	const resourceRefs: InternalPortalNoticeResource[] = [];

	for (const resource of resources) {
		if (input.refresh) {
			missing.push(resource);
			continue;
		}
		const previous = input.notices.find((notice) => notice.notice_id === resource.noticeId)?.resources?.find((ref) => ref.kind === resource.kind && ref.ordinal === resource.ordinal);
		if (previous) {
			if (previous.object_key) {
				const exists = await input.objectStore.hasObject({
					bucket: input.objectStore.sourceBucket,
					key: previous.object_key,
					...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
				});
				if (exists) {
					existingByKind[resource.kind] += 1;
					resourceRefs.push(previous);
					continue;
				}
			} else {
				permanentlyMissingByKind[resource.kind] += 1;
				resourceRefs.push(previous);
				continue;
			}
		}
		const bytes = await input.objectStore.getObjectIfExists({
			...(input.abortSignal === undefined ? {} : { abortSignal: input.abortSignal }),
			bucket: input.objectStore.sourceBucket,
			key: resourceKey(resource),
		});
		if (bytes) {
			const sha256 = createHash("sha256").update(bytes).digest("hex");
			if (!input.dryRun) await input.objectStore.createObject({ body: bytes, bucket: input.objectStore.sourceBucket, contentType: "application/octet-stream", key: resourceContentKey(sha256) });
			existingByKind[resource.kind] += 1;
			resourceRefs.push({ kind: resource.kind, ordinal: resource.ordinal, object_key: resourceContentKey(sha256), content_type: "application/octet-stream", byte_size: bytes.byteLength, sha256 });
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
				if (error instanceof PortalHttpError && error.status === 404) {
					permanentlyMissingByKind[resource.kind] += 1;
					resourceRefs.push({
						kind: resource.kind,
						ordinal: resource.ordinal,
						object_key: null,
						content_type: null,
						byte_size: null,
						sha256: null,
					});
					console.log(
						JSON.stringify({
							noticeResource: {
								disposition: "missing",
								httpStatus: 404,
								noticeId: resource.noticeId,
								resourceKind: resource.kind,
								resourceOrdinal: resource.ordinal,
							},
							status: "running",
						}),
					);
					continue;
				}
				throw new NoticeResourceTransferError(resource, { cause: error });
			}
			try {
				await input.objectStore.createObject({
					...(input.abortSignal === undefined ? {} : { abortSignal: input.abortSignal }),
					body: file.openReadStream(),
					bucket: input.objectStore.sourceBucket,
					byteSize: file.byteSize,
					contentType: file.contentType ?? "application/octet-stream",
					key: resourceContentKey(file.contentSha256),
				});
			} finally {
				await file.remove();
			}
			resourceRefs.push({
				kind: resource.kind,
				ordinal: resource.ordinal,
				object_key: resourceContentKey(file.contentSha256),
				content_type: file.contentType ?? "application/octet-stream",
				byte_size: file.byteSize,
				sha256: file.contentSha256,
			});
			downloadedByKind[resource.kind] += 1;
		}
	}

	const missingByKind = input.dryRun ? countByKind(missing) : permanentlyMissingByKind;
	return {
		attachments: kindResult(
			resources.filter((resource) => resource.kind === "attachments").length,
			existingByKind.attachments,
			downloadedByKind.attachments,
			missingByKind.attachments,
		),
		downloaded: downloadedByKind.attachments + downloadedByKind.images,
		existing: resources.length - missing.length,
		images: kindResult(
			resources.filter((resource) => resource.kind === "images").length,
			existingByKind.images,
			downloadedByKind.images,
			missingByKind.images,
		),
		missing: missingByKind.attachments + missingByKind.images,
		resources: resources.length,
		resourceRefs,
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

function resourceContentKey(sha256: string): string {
	return `internal_portal/resources/sha256/${sha256}`;
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
