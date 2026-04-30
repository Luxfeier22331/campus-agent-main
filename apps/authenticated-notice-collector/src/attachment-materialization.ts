import { createHash } from "node:crypto";
import path from "node:path";

import { type FetchAttachmentBinaryResult, fetchAttachmentBinary } from "./api";
import type { AuthenticatedNoticeArtifactStore } from "./artifact-store";
import type { AuthenticatedNoticeAttachmentFetchStatusStore } from "./attachment-fetch-status";
import type {
	ApiRequestContextLike,
	BundleAttachmentObservation,
	BundleLinkObservation,
	BundleNoticeRecord,
} from "./types";

const YEAR_RE = /(?<!\d)((?:19|20)\d{2})(?!\d)/;
const MIME_TYPE_BY_EXTENSION: Record<string, string> = {
	".7z": "application/x-7z-compressed",
	".avif": "image/avif",
	".bmp": "image/bmp",
	".csv": "text/csv",
	".doc": "application/msword",
	".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	".gif": "image/gif",
	".jpeg": "image/jpeg",
	".jpg": "image/jpeg",
	".pdf": "application/pdf",
	".png": "image/png",
	".ppt": "application/vnd.ms-powerpoint",
	".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
	".rar": "application/vnd.rar",
	".svg": "image/svg+xml",
	".tif": "image/tiff",
	".tiff": "image/tiff",
	".txt": "text/plain",
	".webp": "image/webp",
	".xls": "application/vnd.ms-excel",
	".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
	".zip": "application/zip",
};
const GENERIC_BINARY_MIME_TYPES = new Set(["application/octet-stream", "binary/octet-stream"]);
const DEFAULT_EXTERNAL_VISUAL_CAPTURE_HOSTS = new Set(["mmbiz.qpic.cn"]);
const EXTERNAL_VISUAL_MAX_BYTES = 10 * 1024 * 1024;
const PREFERRED_EXTENSION_BY_MIME_TYPE: Record<string, string> = {
	"image/avif": ".avif",
	"image/bmp": ".bmp",
	"image/gif": ".gif",
	"image/jpeg": ".jpg",
	"image/png": ".png",
	"image/svg+xml": ".svg",
	"image/tiff": ".tiff",
	"image/webp": ".webp",
};

export interface MaterializeBundleAttachmentsInput {
	apiContext: ApiRequestContextLike;
	artifactStore: AuthenticatedNoticeArtifactStore;
	attachmentFetchAdmissions?: AttachmentFetchAdmission[];
	attachmentFetchStatusStore?: AuthenticatedNoticeAttachmentFetchStatusStore;
	bundleRecords: BundleNoticeRecord[];
	observedAt: string;
	requestBackoffBaseMs: number;
	requestMaxRetries: number;
	siteId: string;
}

export interface MaterializeBundleAttachmentsResult {
	bundleRecords: BundleNoticeRecord[];
	downloadedAttachmentCount: number;
	uploadedAttachmentCount: number;
}

export type AttachmentCapturePolicy =
	| "metadata_only"
	| "fetch_to_quarantine"
	| "fetch_required_for_source_truth"
	| "fetch_required_for_admitted_owner";

export interface AttachmentFetchAdmission {
	noticeId: string;
	attachmentRefId: string;
	attachmentCapturePolicy: AttachmentCapturePolicy;
}

interface MaterializedAttachment {
	attachment: BundleAttachmentObservation;
	uploaded: boolean;
	linkPatch?: Pick<
		BundleLinkObservation,
		| "status_code"
		| "content_type"
		| "downloaded"
		| "download_path"
		| "file_size"
		| "fetched_at"
		| "error_message"
	>;
}

type AttachmentFetchMode = "portal_internal" | "trusted_external_visual";

interface MaterializationCandidate {
	fetchMode: AttachmentFetchMode;
	originHost: string | null;
}

const FETCH_REQUIRED_ATTACHMENT_POLICIES = new Set<AttachmentCapturePolicy>([
	"fetch_to_quarantine",
	"fetch_required_for_source_truth",
	"fetch_required_for_admitted_owner",
]);

export async function materializeBundleAttachments(
	input: MaterializeBundleAttachmentsInput,
): Promise<MaterializeBundleAttachmentsResult> {
	const cache = new Map<string, Promise<MaterializedAttachment>>();
	const fetchAdmissions = buildFetchAdmissionMap(input.attachmentFetchAdmissions ?? []);
	const bundleRecords: BundleNoticeRecord[] = [];

	for (const record of input.bundleRecords) {
		const linksById = new Map(record.links.map((link) => [link.id, { ...link }]));
		const attachmentsById = new Map<number, BundleAttachmentObservation>();
		const attachmentRefIdByAttachmentId = new Map<number, string>();
		const relationByAttachmentId = new Map<
			number,
			BundleNoticeRecord["notice_attachments"][number]
		>();
		record.notice_attachments.forEach((relation, index) => {
			relationByAttachmentId.set(relation.attachment_id, relation);
			attachmentRefIdByAttachmentId.set(
				relation.attachment_id,
				`attachment-${String(index + 1).padStart(4, "0")}`,
			);
		});

		for (const attachment of record.attachments) {
			const clonedAttachment = { ...attachment };
			const attachmentRefId =
				attachmentRefIdByAttachmentId.get(clonedAttachment.attachment_id) ??
				`attachment-${String(clonedAttachment.attachment_id).padStart(4, "0")}`;
			const fetchAdmission = fetchAdmissions.get(
				attachmentFetchAdmissionKey({
					noticeId: String(record.notice_id),
					attachmentRefId,
				}),
			);
			if (!fetchAdmission) {
				attachmentsById.set(clonedAttachment.attachment_id, clonedAttachment);
				continue;
			}
			const candidateUrl =
				clonedAttachment.final_url ??
				clonedAttachment.normalized_source_url ??
				clonedAttachment.source_url;
			const relation = relationByAttachmentId.get(clonedAttachment.attachment_id);
			const materializationCandidate = classifyMaterializationCandidate({
				attachment: clonedAttachment,
				candidateUrl,
				relation,
			});
			if (!(candidateUrl && materializationCandidate)) {
				attachmentsById.set(clonedAttachment.attachment_id, clonedAttachment);
				continue;
			}

			const cacheKey = `${materializationCandidate.fetchMode}:${candidateUrl}`;
			let task = cache.get(cacheKey);
			if (!task) {
				task = materializeSingleAttachment({
					apiContext: input.apiContext,
					artifactStore: input.artifactStore,
					attachment: clonedAttachment,
					attachmentFetchStatusStore: input.attachmentFetchStatusStore,
					attachmentRefId,
					fetchMode: materializationCandidate.fetchMode,
					noticeId: String(record.notice_id),
					observedAt: input.observedAt,
					originHost: materializationCandidate.originHost,
					requestBackoffBaseMs: input.requestBackoffBaseMs,
					requestMaxRetries: input.requestMaxRetries,
					siteId: input.siteId,
					year: inferAuthenticatedNoticeYear(record),
				});
				cache.set(cacheKey, task);
			}

			const materialized = await task;
			attachmentsById.set(clonedAttachment.attachment_id, materialized.attachment);

			if (relation?.link_id != null && materialized.linkPatch) {
				const existingLink = linksById.get(relation.link_id);
				if (existingLink) {
					linksById.set(relation.link_id, {
						...existingLink,
						...materialized.linkPatch,
					});
				}
			}
		}

		bundleRecords.push({
			...record,
			attachments: record.attachments.map(
				(attachment) => attachmentsById.get(attachment.attachment_id) ?? attachment,
			),
			links: record.links.map((link) => linksById.get(link.id) ?? link),
		});
	}

	const materializedResults = await Promise.all(cache.values());
	const uploadedAttachmentCount = materializedResults.filter((result) => result.uploaded).length;

	return {
		bundleRecords,
		downloadedAttachmentCount: uploadedAttachmentCount,
		uploadedAttachmentCount,
	};
}

async function materializeSingleAttachment(input: {
	apiContext: ApiRequestContextLike;
	artifactStore: AuthenticatedNoticeArtifactStore;
	attachment: BundleAttachmentObservation;
	attachmentFetchStatusStore?: AuthenticatedNoticeAttachmentFetchStatusStore;
	attachmentRefId: string;
	fetchMode: AttachmentFetchMode;
	noticeId: string;
	observedAt: string;
	originHost: string | null;
	requestBackoffBaseMs: number;
	requestMaxRetries: number;
	siteId: string;
	year: string | null;
}): Promise<MaterializedAttachment> {
	const sourceUrl =
		input.attachment.final_url ??
		input.attachment.normalized_source_url ??
		input.attachment.source_url;
	const terminalStatus = input.attachmentFetchStatusStore
		? await input.attachmentFetchStatusStore.getTerminalUnavailable({
				siteId: input.siteId,
				noticeId: input.noticeId,
				attachmentRefId: input.attachmentRefId,
				sourceUrl,
			})
		: null;
	if (terminalStatus) {
		const message = `terminal_unavailable:${terminalStatus.terminalReason}`;
		return {
			attachment: {
				...input.attachment,
				last_error: message,
				updated_at: input.observedAt,
			},
			uploaded: false,
			linkPatch: {
				status_code: terminalStatus.lastHttpStatus,
				content_type: null,
				downloaded: false,
				download_path: null,
				file_size: null,
				fetched_at: input.observedAt,
				error_message: message,
			},
		};
	}
	try {
		const result =
			input.fetchMode === "trusted_external_visual"
				? await fetchExternalVisualBinary({
						attachmentUrl: sourceUrl,
						requestBackoffBaseMs: input.requestBackoffBaseMs,
						requestMaxRetries: input.requestMaxRetries,
					})
				: await fetchAttachmentBinary({
						apiContext: input.apiContext,
						attachmentUrl: sourceUrl,
						requestBackoffBaseMs: input.requestBackoffBaseMs,
						requestMaxRetries: input.requestMaxRetries,
					});
		const contentSha256 = createHash("sha256").update(result.body).digest("hex");
		const initialFilename = resolveAttachmentFilename({
			attachmentFilename: input.attachment.original_filename,
			contentDisposition: result.contentDisposition,
			fallbackUrl: input.attachment.final_url,
		});
		const extensionContentType =
			MIME_TYPE_BY_EXTENSION[path.posix.extname(initialFilename).toLowerCase()] ?? null;
		const responseContentType = normalizeContentType(result.contentType);
		const resolvedContentType =
			(responseContentType && !GENERIC_BINARY_MIME_TYPES.has(responseContentType)
				? responseContentType
				: extensionContentType) ??
			responseContentType ??
			"application/octet-stream";
		const resolvedFilename = ensureFilenameExtensionForContentType({
			contentType: resolvedContentType,
			filename: initialFilename,
		});
		const objectKey =
			input.fetchMode === "trusted_external_visual"
				? buildAuthenticatedNoticeExternalVisualCaptureKey({
						contentSha256,
						filename: resolvedFilename,
						originHost: input.originHost,
						year: input.year,
					})
				: buildAuthenticatedNoticeAttachmentCaptureKey({
						contentSha256,
						filename: resolvedFilename,
						year: input.year,
					});
		const metadata: Record<string, string> =
			input.fetchMode === "trusted_external_visual"
				? {
						"content-sha256": contentSha256,
						"origin-host": input.originHost ?? "unknown-host",
						"origin-scope": "external",
					}
				: {
						"content-sha256": contentSha256,
					};
		const stored = await input.artifactStore.putObject({
			objectKey,
			data: result.body,
			contentType: resolvedContentType,
			metadata,
		});
		const updatedAttachment: BundleAttachmentObservation = {
			...input.attachment,
			original_filename: resolvedFilename,
			mime_type: resolvedContentType,
			byte_size: stored.byteSize,
			sha256: contentSha256,
			storage_provider: input.artifactStore.storageProvider,
			bucket: stored.bucket,
			object_key: stored.objectKey,
			etag: stored.etag,
			version_id: stored.versionId,
			provenance_status: "collected_internal",
			ingest_status: "uploaded",
			downloaded_at: input.observedAt,
			uploaded_at: input.observedAt,
			updated_at: input.observedAt,
			last_error: null,
		};
		return {
			attachment: updatedAttachment,
			uploaded: true,
			linkPatch: {
				status_code: result.statusCode,
				content_type: resolvedContentType,
				downloaded: true,
				download_path: null,
				file_size: stored.byteSize,
				fetched_at: input.observedAt,
				error_message: null,
			},
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			attachment: {
				...input.attachment,
				last_error: message,
				updated_at: input.observedAt,
			},
			uploaded: false,
			linkPatch: {
				status_code: null,
				content_type: null,
				downloaded: false,
				download_path: null,
				file_size: null,
				fetched_at: input.observedAt,
				error_message: message,
			},
		};
	}
}

function buildFetchAdmissionMap(
	admissions: AttachmentFetchAdmission[],
): Map<string, AttachmentFetchAdmission> {
	const map = new Map<string, AttachmentFetchAdmission>();
	for (const admission of admissions) {
		if (!FETCH_REQUIRED_ATTACHMENT_POLICIES.has(admission.attachmentCapturePolicy)) {
			continue;
		}
		map.set(attachmentFetchAdmissionKey(admission), admission);
	}
	return map;
}

function attachmentFetchAdmissionKey(input: { noticeId: string; attachmentRefId: string }): string {
	return `${input.noticeId}:${input.attachmentRefId}`;
}

function classifyMaterializationCandidate(input: {
	attachment: BundleAttachmentObservation;
	candidateUrl: string | null;
	relation: BundleNoticeRecord["notice_attachments"][number] | undefined;
}): MaterializationCandidate | null {
	if (!input.candidateUrl || input.attachment.storage_provider !== "reference_only") {
		return null;
	}
	if (input.attachment.origin_scope === "internal") {
		return {
			fetchMode: "portal_internal",
			originHost: input.attachment.origin_host,
		};
	}
	if (
		input.attachment.origin_scope !== "external" ||
		input.relation?.resource_role !== "inline_image"
	) {
		return null;
	}
	const originHost =
		normalizeUrlHost(input.candidateUrl) ?? normalizeHost(input.attachment.origin_host);
	if (!(originHost && DEFAULT_EXTERNAL_VISUAL_CAPTURE_HOSTS.has(originHost))) {
		return null;
	}
	return {
		fetchMode: "trusted_external_visual",
		originHost,
	};
}

async function fetchExternalVisualBinary(input: {
	attachmentUrl: string;
	requestBackoffBaseMs: number;
	requestMaxRetries: number;
	sleep?: (ms: number) => Promise<void>;
}): Promise<FetchAttachmentBinaryResult> {
	let lastError: Error | null = null;
	for (let attempt = 1; attempt <= input.requestMaxRetries; attempt += 1) {
		try {
			const response = await fetch(input.attachmentUrl, {
				redirect: "follow",
			});
			if (!response.ok) {
				throw new Error(`downloadExternalVisual failed: ${response.status} ${response.statusText}`);
			}
			const contentType = normalizeHeaderValue(response.headers.get("content-type"));
			const normalizedContentType = normalizeContentType(contentType);
			if (!normalizedContentType?.startsWith("image/")) {
				throw new Error(
					`downloadExternalVisual returned non-image content-type: ${contentType ?? "unknown"}`,
				);
			}
			const contentLength = parseContentLength(response.headers.get("content-length"));
			if (contentLength !== null && contentLength > EXTERNAL_VISUAL_MAX_BYTES) {
				throw new Error(
					`downloadExternalVisual exceeded max size before download: ${contentLength}`,
				);
			}
			const body = Buffer.from(await response.arrayBuffer());
			if (body.byteLength > EXTERNAL_VISUAL_MAX_BYTES) {
				throw new Error(`downloadExternalVisual exceeded max size: ${body.byteLength}`);
			}
			return {
				body,
				contentType,
				contentDisposition: normalizeHeaderValue(response.headers.get("content-disposition")),
				etag: normalizeHeaderValue(response.headers.get("etag")),
				statusCode: response.status,
			};
		} catch (error) {
			lastError = error instanceof Error ? error : new Error(String(error));
			if (attempt >= input.requestMaxRetries) {
				throw lastError;
			}
			await (input.sleep ?? defaultSleep)(backoffDelayMs(input.requestBackoffBaseMs, attempt));
		}
	}
	throw lastError ?? new Error("fetchExternalVisualBinary failed with unknown error");
}

function resolveAttachmentFilename(input: {
	attachmentFilename: string | null;
	contentDisposition: string | null;
	fallbackUrl: string | null;
}): string {
	const attachmentFilename = normalizeAttachmentFilename(
		input.attachmentFilename,
		input.fallbackUrl,
	);
	if (attachmentFilename !== "attachment") {
		return attachmentFilename;
	}
	return (
		contentDispositionFilename({ contentDisposition: input.contentDisposition }) ??
		attachmentFilename
	);
}

function ensureFilenameExtensionForContentType(input: {
	contentType: string;
	filename: string;
}): string {
	if (path.posix.extname(input.filename)) {
		return input.filename;
	}
	const extension = PREFERRED_EXTENSION_BY_MIME_TYPE[input.contentType];
	if (!extension) {
		return input.filename;
	}
	return safeBasename(`${input.filename}${extension}`);
}

function contentDispositionFilename(
	result: Pick<FetchAttachmentBinaryResult, "contentDisposition">,
): string | null {
	const value = result.contentDisposition?.trim();
	if (!value) {
		return null;
	}
	const encodedMatch = value.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
	if (encodedMatch?.[1]) {
		return safeBasename(repairMojibakeUtf8(safeDecodeURIComponent(encodedMatch[1])));
	}
	const quotedMatch = value.match(/filename\s*=\s*"([^"]+)"/i);
	if (quotedMatch?.[1]) {
		return safeBasename(repairMojibakeUtf8(quotedMatch[1]));
	}
	const plainMatch = value.match(/filename\s*=\s*([^;]+)/i);
	if (plainMatch?.[1]) {
		return safeBasename(repairMojibakeUtf8(plainMatch[1].trim()));
	}
	return null;
}

function inferAuthenticatedNoticeYear(record: BundleNoticeRecord): string | null {
	return (
		inferYearLabel(record.notice.notice_release_time) ??
		inferYearLabel(record.notice.notice_create_time) ??
		inferYearLabel(record.notice.notice_first_time)
	);
}

function inferYearLabel(value: string | null): string | null {
	if (!value) {
		return null;
	}
	const match = value.match(YEAR_RE);
	return match?.[1] ?? null;
}

function normalizeAttachmentFilename(filename: string | null, fallbackUrl: string | null): string {
	const fallback = fallbackUrl ? safeBasename(fallbackUrl) : "";
	const candidate = (filename ?? "").trim() || fallback || "attachment";
	return safeBasename(candidate);
}

function safeBasename(value: string): string {
	const normalized = value.replace(/\\/g, "/");
	const basename = path.posix.basename(normalized).trim().replace(/\//g, "_");
	return basename || "attachment";
}

function safeDecodeURIComponent(value: string): string {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}

function repairMojibakeUtf8(value: string): string {
	if (!value) {
		return value;
	}
	const repaired = Buffer.from(value, "latin1").toString("utf8");
	if (!repaired || repaired.includes("\uFFFD")) {
		return value;
	}
	return countCjkCharacters(repaired) > countCjkCharacters(value) ? repaired : value;
}

function countCjkCharacters(value: string): number {
	return [...value].filter((char) => /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/u.test(char))
		.length;
}

function normalizeContentType(value: string | null): string | null {
	if (!value) {
		return null;
	}
	const normalized = value.split(";")[0]?.trim().toLowerCase() ?? "";
	return normalized || null;
}

function normalizeHeaderValue(value: string | null): string | null {
	if (!value) {
		return null;
	}
	const trimmed = value.trim();
	return trimmed || null;
}

function normalizeUrlHost(value: string): string | null {
	try {
		return normalizeHost(new URL(value).host);
	} catch {
		return null;
	}
}

function normalizeHost(value: string | null): string | null {
	const host = value?.trim().toLowerCase();
	return host || null;
}

function parseContentLength(value: string | null): number | null {
	if (!value) {
		return null;
	}
	const parsed = Number(value.trim());
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

const defaultSleep = async (ms: number) =>
	new Promise<void>((resolve) => {
		setTimeout(resolve, ms);
	});

function backoffDelayMs(baseMs: number, attempt: number): number {
	return baseMs * attempt;
}

export function buildAuthenticatedNoticeAttachmentCaptureKey(input: {
	contentSha256: string;
	filename: string;
	year: string | null;
}): string {
	const digest = input.contentSha256.trim().toLowerCase();
	if (!digest) {
		throw new Error("contentSha256 is required");
	}
	const year = input.year?.trim() || "unknown-year";
	return [
		"authenticated_notice_portal",
		`attachment-${digest.slice(0, 12)}`,
		year,
		"sha256",
		digest,
		"capture",
		safeBasename(input.filename),
	].join("/");
}

export function buildAuthenticatedNoticeExternalVisualCaptureKey(input: {
	contentSha256: string;
	filename: string;
	originHost: string | null;
	year: string | null;
}): string {
	const digest = input.contentSha256.trim().toLowerCase();
	if (!digest) {
		throw new Error("contentSha256 is required");
	}
	const year = input.year?.trim() || "unknown-year";
	return [
		"authenticated_notice_portal",
		"external-visual",
		safePathSegment(input.originHost ?? "unknown-host"),
		year,
		"sha256",
		digest,
		"capture",
		safeBasename(input.filename),
	].join("/");
}

function safePathSegment(value: string): string {
	const normalized = value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/g, "-");
	return normalized.replace(/^-+|-+$/g, "") || "unknown";
}
