import {
	NOTICE_CATEGORY_LABELS,
	NOTICE_FILTER_CATEGORIES,
	type NoticeCategory,
	NoticeDetailResponseSchema,
	type NoticeListResponse,
	NoticeListResponseSchema,
} from "campus-contracts/notices";

import { AppApiRouteError } from "../../http";
import { buildInternalPortalAttachmentUrl } from "./internal-portal-url";
import type {
	NoticeAssetRecord,
	NoticeObjectStore,
	NoticeRecord,
	NoticeService,
	NoticeStore,
} from "./types";

export function buildNoticeService(input: {
	objectStore: NoticeObjectStore;
	store: NoticeStore;
}): NoticeService {
	return {
		async getDetail(noticeId) {
			const record = await input.store.getDetail(noticeId);
			if (!record) {
				throw noticeNotFound();
			}
			return NoticeDetailResponseSchema.parse({
				...toNoticeMetadata(record),
				attachments: record.assets
					.filter(isAssetKind("attachment"))
					.map((asset) => toAttachmentMetadata(asset, record.noticeId)),
				contentHtml: record.contentHtml,
				externalUrl: null,
				images: record.assets.filter(isAssetKind("image")).map((asset) => ({
					...toAssetMetadata(asset),
					url: `/api/notices/${record.noticeId}/images/${asset.ordinal}`,
				})),
				isExternal: false,
			});
		},
		async list(query) {
			const records = await input.store.list(query);
			const response: NoticeListResponse = {
				filters: {
					categories: NOTICE_FILTER_CATEGORIES.map((value) => ({
						label: NOTICE_CATEGORY_LABELS[value],
						value,
					})),
					noticeTypes: records.noticeTypes.map((item) => ({
						label: item.name,
						value: item.id,
					})),
					organizations: records.organizations.map((item) => ({
						label: item.name,
						value: item.id,
					})),
				},
				items: records.items.map((record) => {
					if (record.isExternal) {
						if (!record.externalUrl) {
							throw invalidNoticeProjection();
						}
						return {
							...toNoticeMetadata(record),
							externalUrl: record.externalUrl,
							isExternal: true as const,
						};
					}
					return {
						...toNoticeMetadata(record),
						externalUrl: null,
						isExternal: false as const,
					};
				}),
				pagination: {
					page: query.page,
					pageSize: 30,
					totalItems: records.totalItems,
					totalPages: Math.ceil(records.totalItems / 30),
				},
			};
			return NoticeListResponseSchema.parse(response);
		},
		async readImage(noticeId, ordinal) {
			const asset = await input.store.getImageAsset(noticeId, ordinal);
			if (!asset) {
				throw noticeNotFound();
			}
			const response = await input.objectStore.get(asset.contentSha256);
			if (!response?.body) {
				throw noticeNotFound();
			}
			return { body: response.body, contentType: asset.contentType };
		},
	};
}

function toNoticeMetadata(record: NoticeRecord) {
	return {
		category: record.category as NoticeCategory,
		noticeId: record.noticeId,
		noticeType: record.noticeType,
		organization: record.organization,
		releasedAt:
			record.releasedAt instanceof Date
				? record.releasedAt.toISOString()
				: new Date(record.releasedAt).toISOString(),
		title: record.title,
	};
}

function isAssetKind(kind: NoticeAssetRecord["kind"]) {
	return (asset: NoticeAssetRecord) => asset.kind === kind;
}

function toAssetMetadata(asset: NoticeAssetRecord) {
	return {
		byteSize: asset.byteSize,
		contentType: asset.contentType,
		name: asset.name,
		ordinal: asset.ordinal,
	};
}

function toAttachmentMetadata(asset: NoticeAssetRecord, noticeId: string) {
	if (!asset.portalAnnexId) {
		throw invalidNoticeProjection();
	}
	return {
		...toAssetMetadata(asset),
		downloadUrl: buildInternalPortalAttachmentUrl({
			noticeId,
			portalAnnexId: asset.portalAnnexId,
		}),
	};
}

function noticeNotFound(): AppApiRouteError {
	return new AppApiRouteError({
		code: "notice_not_found",
		message: "The requested notice does not exist.",
		retryable: false,
		status: 404,
	});
}

function invalidNoticeProjection(): AppApiRouteError {
	return new AppApiRouteError({
		code: "notice_projection_invalid",
		message: "The stored notice projection is invalid.",
		retryable: false,
		status: 500,
	});
}
