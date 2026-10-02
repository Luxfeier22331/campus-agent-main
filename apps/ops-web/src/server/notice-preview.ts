import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { normalizeNoticeContent } from "@campus-agent/notices";
import {
	type InternalPortalNoticeSource,
	validateInternalPortalNoticeSource,
} from "ingestion-contracts";
import portal from "../../../../configs/sources/internal-portal.json" with { type: "json" };
import type { NoticePreview } from "../shared/notice-preview-contract.ts";

export class NoticePreviewError extends Error {
	readonly status: 404 | 502 | 503;
	readonly code: string;
	constructor(code: string, message: string, status: 404 | 502 | 503, cause?: unknown) {
		super(message, { cause });
		this.code = code;
		this.status = status;
	}
}

export interface NoticeSourceObject {
	body: ReadableStream<Uint8Array>;
	contentType: string;
}
export interface NoticePreviewStore {
	get(key: string): Promise<NoticeSourceObject>;
}

export interface NoticePreviewEnv {
	OBJECT_STORE_ENDPOINT?: string;
	OBJECT_STORE_REGION?: string;
	OBJECT_STORE_BUCKET_SOURCE?: string;
	OBJECT_STORE_SOURCE_ACCESS_KEY?: string;
	OBJECT_STORE_SOURCE_SECRET_KEY?: string;
}

export function createNoticePreviewStore(env: NoticePreviewEnv): NoticePreviewStore {
	return {
		async get(key) {
			const required = (name: keyof NoticePreviewEnv) => {
				const value = env[name]?.trim();
				if (!value) {
					throw new NoticePreviewError(
						"OPS_NOTICE_PREVIEW_UNAVAILABLE",
						"通知来源存储未配置。",
						503,
					);
				}
				return value;
			};
			const bucket = required("OBJECT_STORE_BUCKET_SOURCE");
			const client = new S3Client({
				endpoint: required("OBJECT_STORE_ENDPOINT"),
				region: env.OBJECT_STORE_REGION?.trim() || "us-east-1",
				forcePathStyle: true,
				maxAttempts: 1,
				credentials: {
					accessKeyId: required("OBJECT_STORE_SOURCE_ACCESS_KEY"),
					secretAccessKey: required("OBJECT_STORE_SOURCE_SECRET_KEY"),
				},
			});
			try {
				const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
				if (!result.Body) {
					throw new Error("Source object has no body");
				}
				const reader = result.Body.transformToWebStream().getReader();
				return {
					contentType: result.ContentType ?? "application/octet-stream",
					body: new ReadableStream<Uint8Array>({
						async pull(controller) {
							try {
								const next = await reader.read();
								if (next.done) {
									controller.close();
									client.destroy();
								} else {
									controller.enqueue(next.value);
								}
							} catch (error) {
								controller.error(error);
								client.destroy();
							}
						},
						async cancel(reason) {
							try {
								await reader.cancel(reason);
							} finally {
								client.destroy();
							}
						},
					}),
				};
			} catch (error) {
				client.destroy();
				if (
					(error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404
				) {
					throw new NoticePreviewError(
						"OPS_NOTICE_SOURCE_NOT_FOUND",
						"未找到已采集的正文或附件。",
						404,
						error,
					);
				}
				throw new NoticePreviewError(
					"OPS_NOTICE_PREVIEW_UNAVAILABLE",
					"通知来源暂时无法读取。",
					502,
					error,
				);
			}
		},
	};
}

export async function readNoticeSource(
	store: NoticePreviewStore,
	noticeId: number,
	sourceKey = `internal_portal/notices/${noticeId}.json`,
) {
	const object = await store.get(sourceKey);
	let value: unknown;
	try {
		value = await new Response(object.body).json();
	} catch (error) {
		throw new NoticePreviewError("OPS_NOTICE_SOURCE_INVALID", "通知来源格式无效。", 502, error);
	}
	if (
		!validateInternalPortalNoticeSource(value).ok ||
		(value as InternalPortalNoticeSource).notice_id !== noticeId
	) {
		throw new NoticePreviewError("OPS_NOTICE_SOURCE_INVALID", "通知来源格式或编号不匹配。", 502);
	}
	return value as InternalPortalNoticeSource;
}

export function prepareNoticePreview(source: InternalPortalNoticeSource) {
	const content = normalizeNoticeContent({
		html: source.is_external ? null : source.notice_content_html,
		title: source.notice_title,
		portalHost: new URL(portal.portal_base_url).hostname,
	});
	const base = `/api/ops/notices/${source.notice_id}`;
	const preview: NoticePreview = {
		noticeId: source.notice_id,
		contentHtml: content.contentHtml,
		isExternal: source.is_external,
		externalUrl: source.external_url,
		images: content.images.map(({ ordinal }) => ({ ordinal, url: `${base}/images/${ordinal}` })),
		attachments: source.is_external
			? []
			: source.attachments.map((a, ordinal) => ({
					ordinal,
					name: a.notice_annex_name,
					suffix: a.suffix,
					url: `${base}/attachments/${ordinal}`,
				})),
	};
	return { preview, images: content.images };
}
