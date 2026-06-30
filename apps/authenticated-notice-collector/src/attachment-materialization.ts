import { createHash } from "node:crypto";
import path from "node:path";

import { parse as parseContentDisposition } from "content-disposition";
import { lookup as lookupMimeType, extension as mimeExtension } from "mime-types";

import {
	type FetchAttachmentBinaryResult,
	isAttachmentDownloadTerminalUnavailableError,
} from "./api.js";
import type { AuthenticatedNoticeArtifactStore } from "./artifact-store.js";
import {
	type AttachmentDownloadCrawlerFactory,
	type AttachmentDownloadFetchMode,
	runAttachmentCrawleeDownloads,
} from "./attachment-crawlee-runner.js";
import type { AuthenticatedNoticeAttachmentFetchStatusStore } from "./attachment-fetch-status.js";
import type {
	ApiRequestContextLike,
	BundleAttachmentObservation,
	BundleLinkObservation,
	BundleNoticeRecord,
} from "./types.js";

const YEAR_RE = /(?<!\d)((?:19|20)\d{2})(?!\d)/;
const GENERIC_BINARY_MIME_TYPES = new Set(["application/octet-stream", "binary/octet-stream"]);
const DEFAULT_EXTERNAL_VISUAL_CAPTURE_HOSTS = new Set(["mmbiz.qpic.cn"]);
const EXTERNAL_VISUAL_MAX_BYTES = 10 * 1024 * 1024;

export interface MaterializeBundleAttachmentsInput {
	apiContext: ApiRequestContextLike;
	artifactStore: AuthenticatedNoticeArtifactStore;
	attachmentCrawlerFactory?: AttachmentDownloadCrawlerFactory;
	attachmentFetchAdmissions?: AttachmentFetchAdmission[];
	attachmentFetchStatusStore?: AuthenticatedNoticeAttachmentFetchStatusStore;
	defaultInlineVisualCapture?: boolean;
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

interface MaterializationCandidate {
	fetchMode: AttachmentDownloadFetchMode;
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
	const downloadCache = new Map<string, Promise<FetchAttachmentBinaryResult>>();
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
			const candidateUrl =
				clonedAttachment.final_url ??
				clonedAttachment.normalized_source_url ??
				clonedAttachment.source_url;
			const relation = relationByAttachmentId.get(clonedAttachment.attachment_id);
			const shouldFetch =
				Boolean(fetchAdmission) ||
				(input.defaultInlineVisualCapture === true &&
					isDefaultInlineVisualCaptureCandidate({
						attachment: clonedAttachment,
						relation,
					}));
			if (!shouldFetch) {
				attachmentsById.set(clonedAttachment.attachment_id, clonedAttachment);
				continue;
			}
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
					artifactStore: input.artifactStore,
					attachment: clonedAttachment,
					attachmentFetchStatusStore: input.attachmentFetchStatusStore,
					attachmentRefId,
					fetchMode: materializationCandidate.fetchMode,
					noticeId: String(record.notice_id),
					observedAt: input.observedAt,
					originHost: materializationCandidate.originHost,
					requiredAdmission: Boolean(fetchAdmission),
					requireVisualContent: !fetchAdmission,
					resolveDownload: async () =>
						await downloadAttachmentOnce({
							apiContext: input.apiContext,
							attachmentUrl: candidateUrl,
							cacheKey,
							crawlerFactory: input.attachmentCrawlerFactory,
							downloadCache,
							fetchMode: materializationCandidate.fetchMode,
							requestMaxRetries: input.requestMaxRetries,
							siteId: input.siteId,
						}),
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
	artifactStore: AuthenticatedNoticeArtifactStore;
	attachment: BundleAttachmentObservation;
	attachmentFetchStatusStore?: AuthenticatedNoticeAttachmentFetchStatusStore;
	attachmentRefId: string;
	fetchMode: AttachmentDownloadFetchMode;
	noticeId: string;
	observedAt: string;
	originHost: string | null;
	requiredAdmission: boolean;
	requireVisualContent: boolean;
	resolveDownload: () => Promise<FetchAttachmentBinaryResult>;
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
				provenance_status: "terminal_unavailable",
				ingest_status: "terminal_unavailable",
				terminal_reason: terminalStatus.terminalReason,
				last_error_class: "terminal_unavailable",
				last_http_status: terminalStatus.lastHttpStatus,
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
		const result = await input.resolveDownload();
		const contentSha256 = createHash("sha256").update(result.body).digest("hex");
		const initialFilename = resolveAttachmentFilename({
			attachmentFilename: input.attachment.original_filename,
			contentDisposition: result.contentDisposition,
			sourceUrl: input.attachment.final_url,
		});
		const extensionContentType = normalizeContentType(lookupMimeType(initialFilename) || null);
		const responseContentType = normalizeContentType(result.contentType);
		const resolvedContentType =
			(responseContentType && !GENERIC_BINARY_MIME_TYPES.has(responseContentType)
				? responseContentType
				: extensionContentType) ??
			responseContentType ??
			"application/octet-stream";
		if (
			input.requireVisualContent &&
			(!resolvedContentType.startsWith("image/") ||
				result.body.byteLength > EXTERNAL_VISUAL_MAX_BYTES)
		) {
			const message = `default_inline_visual_capture_skipped:${resolvedContentType}`;
			return {
				attachment: {
					...input.attachment,
					mime_type: resolvedContentType,
					byte_size: result.body.byteLength,
					last_error: message,
					updated_at: input.observedAt,
				},
				uploaded: false,
				linkPatch: {
					status_code: result.statusCode,
					content_type: resolvedContentType,
					downloaded: false,
					download_path: null,
					file_size: result.body.byteLength,
					fetched_at: input.observedAt,
					error_message: message,
				},
			};
		}
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
		if (isAttachmentDownloadTerminalUnavailableError(error)) {
			const terminalMessage = `terminal_unavailable:${error.terminalReason}`;
			return {
				attachment: {
					...input.attachment,
					provenance_status: "terminal_unavailable",
					ingest_status: "terminal_unavailable",
					terminal_reason: error.terminalReason,
					last_error_class: "terminal_unavailable",
					last_http_status: error.lastHttpStatus,
					last_error: terminalMessage,
					updated_at: input.observedAt,
				},
				uploaded: false,
				linkPatch: {
					status_code: error.lastHttpStatus,
					content_type: null,
					downloaded: false,
					download_path: null,
					file_size: null,
					fetched_at: input.observedAt,
					error_message: terminalMessage,
				},
			};
		}
		if (input.requiredAdmission) {
			throw new Error(
				[
					"attachment_materialization_failed",
					`notice=${input.noticeId}`,
					`attachment=${input.attachmentRefId}`,
					message,
				].join(":"),
				{ cause: error },
			);
		}
		return {
			attachment: {
				...input.attachment,
				last_error: message,
				last_error_class: "transient_failed",
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

function isDefaultInlineVisualCaptureCandidate(input: {
	attachment: BundleAttachmentObservation;
	relation: BundleNoticeRecord["notice_attachments"][number] | undefined;
}): boolean {
	if (input.attachment.storage_provider !== "reference_only") {
		return false;
	}
	const role = input.relation?.resource_role;
	return role === "inline_image";
}

async function downloadAttachmentOnce(input: {
	apiContext: ApiRequestContextLike;
	attachmentUrl: string;
	cacheKey: string;
	crawlerFactory?: AttachmentDownloadCrawlerFactory;
	downloadCache: Map<string, Promise<FetchAttachmentBinaryResult>>;
	fetchMode: AttachmentDownloadFetchMode;
	requestMaxRetries: number;
	siteId: string;
}): Promise<FetchAttachmentBinaryResult> {
	const existing = input.downloadCache.get(input.cacheKey);
	if (existing) {
		return await existing;
	}
	const task = runAttachmentCrawleeDownloads({
		apiContext: input.apiContext,
		crawlerFactory: input.crawlerFactory,
		requestMaxRetries: input.requestMaxRetries,
		requests: [
			{
				attachmentUrl: input.attachmentUrl,
				cacheKey: input.cacheKey,
				fetchMode: input.fetchMode,
				siteId: input.siteId,
			},
		],
	}).then((results) => {
		const result = results.get(input.cacheKey);
		if (!result) {
			throw new Error(`missing attachment download result:${input.cacheKey}`);
		}
		return result;
	});
	input.downloadCache.set(input.cacheKey, task);
	return await task;
}

function resolveAttachmentFilename(input: {
	attachmentFilename: string | null;
	contentDisposition: string | null;
	sourceUrl: string | null;
}): string {
	const attachmentFilename = normalizeAttachmentFilename(input.attachmentFilename, input.sourceUrl);
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
	const extension = mimeExtension(input.contentType);
	if (!extension) {
		return input.filename;
	}
	return safeBasename(`${input.filename}.${extension}`);
}

function contentDispositionFilename(
	result: Pick<FetchAttachmentBinaryResult, "contentDisposition">,
): string | null {
	const value = result.contentDisposition?.trim();
	if (!value) {
		return null;
	}
	try {
		const filename = parseContentDisposition(value).parameters.filename;
		return filename ? safeBasename(repairMojibakeUtf8(filename)) : null;
	} catch {
		return null;
	}
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

function normalizeAttachmentFilename(filename: string | null, sourceUrl: string | null): string {
	const sourceBasename = sourceUrl ? safeBasename(sourceUrl) : "";
	const candidate = (filename ?? "").trim() || sourceBasename || "attachment";
	return safeBasename(candidate);
}

function safeBasename(value: string): string {
	const normalized = value.replace(/\\/g, "/");
	const basename = path.posix.basename(normalized).trim().replace(/\//g, "_");
	return basename || "attachment";
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
