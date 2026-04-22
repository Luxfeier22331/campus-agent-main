import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
	fetchAttachmentBinary,
	fetchFileReleaseCodeTypes,
	fetchFileReleaseDetail,
	fetchFileReleaseDownloadUrl,
	fetchFileReleaseExplainDepartments,
	fetchFileReleasePage,
	fetchFileReleaseTypes,
} from "./api";
import {
	type AuthenticatedNoticeArtifactStore,
	createAuthenticatedNoticeArtifactStoreFromEnv,
} from "./artifact-store";
import { ensureRuntimeDirs, loadCollectorEnv, resolveCollectorConfig } from "./config";
import { createApiContextFromStorageState } from "./portal";
import type {
	ApiRequestContextLike,
	BundleFileReleaseRecord,
	CollectorFileReleaseExportMetadata,
	DisposableApiContextLike,
	FileReleaseCodeTypeListResponse,
	FileReleaseDepartmentRecord,
	FileReleaseDetailResponse,
	FileReleaseExplainDepartmentListResponse,
	FileReleaseExportManifest,
	FileReleaseListItem,
	FileReleasePageResponse,
	FileReleaseTypeListResponse,
} from "./types";

const AUTHENTICATED_NOTICE_SOURCE_CHANNEL = "authenticated_notice_portal";
const FILE_RELEASE_EXPORT_SCHEMA_VERSION = "authenticated_notice_file_release_export_v1";
const YEAR_RE = /(?<!\d)((?:19|20)\d{2})(?!\d)/;
const GENERIC_BINARY_MIME_TYPES = new Set(["application/octet-stream", "binary/octet-stream"]);
const MIME_TYPE_BY_EXTENSION: Record<string, string> = {
	".doc": "application/msword",
	".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	".pdf": "application/pdf",
	".ppt": "application/vnd.ms-powerpoint",
	".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
	".xls": "application/vnd.ms-excel",
	".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

export interface CollectFileReleaseBundleInput {
	attachmentArtifactStore?: AuthenticatedNoticeArtifactStore;
	createApiContext?: () => Promise<ApiRequestContextLike & DisposableApiContextLike>;
	exportedAt: string;
	fetchFileReleaseDetail?: (input: {
		apiContext: ApiRequestContextLike;
		fileReleaseId: number;
	}) => Promise<FileReleaseDetailResponse>;
	fetchFileReleaseDownloadUrl?: (input: {
		apiContext: ApiRequestContextLike;
		fileReleaseId: number;
	}) => Promise<{ state?: boolean; url?: string | null }>;
	fetchFileReleasePage?: (input: {
		apiContext: ApiRequestContextLike;
		currentPage: number;
		pageSize: number;
	}) => Promise<FileReleasePageResponse>;
	fetchFileReleaseCodeTypes?: (input: {
		apiContext: ApiRequestContextLike;
	}) => Promise<FileReleaseCodeTypeListResponse>;
	fetchFileReleaseExplainDepartments?: (input: {
		apiContext: ApiRequestContextLike;
	}) => Promise<FileReleaseExplainDepartmentListResponse>;
	fetchFileReleaseTypes?: (input: {
		apiContext: ApiRequestContextLike;
	}) => Promise<FileReleaseTypeListResponse>;
	maxFileReleases?: number | null;
	maxPages?: number | null;
	pageSize: number;
	requestBackoffBaseMs: number;
	requestMaxRetries: number;
	siteId: string;
	sourceHomeUrl: string;
	targetFileReleaseId?: number | null;
}

export interface CollectFileReleaseBundleResult {
	bundleRecords: BundleFileReleaseRecord[];
	exportManifest: FileReleaseExportManifest;
	stats: {
		detailFetched: number;
		fileUrlsResolved: number;
		fileReleasesCollected: number;
		fileObjectsUploaded: number;
		pagesFetched: number;
	};
}

export interface WriteFileReleaseArtifactsInput {
	bundleRecords: BundleFileReleaseRecord[];
	exportManifest: FileReleaseExportManifest;
	outputDir: string;
}

export interface WriteFileReleaseArtifactsResult {
	bundlePath: string;
	manifestPath: string;
}

export function buildFileReleaseRecord(input: {
	detail: FileReleaseDetailResponse;
	downloadUrl: string | null;
	fileTypeNameById: Map<number, string>;
	item: FileReleaseListItem;
	observedAt: string;
	sourceHomeUrl: string;
}): BundleFileReleaseRecord {
	const fileReleaseId = normalizeRequiredId(input.item.id ?? input.detail.id, "file_release_id");
	const filename = normalizeRequiredText(input.item.filename ?? input.detail.filename, "filename");
	const fileTypeId = normalizeNullableNumber(input.detail.filetypeid);
	const fileTypeName =
		(fileTypeId !== null ? input.fileTypeNameById.get(fileTypeId) : null) ??
		normalizeNullableText(input.item.typename);
	const originalPortalFileUrl = normalizeNullableText(input.detail.fileurl ?? input.item.fileurl);
	const resolvedDownloadUrl = resolveAbsoluteUrl(
		normalizeNullableText(input.downloadUrl) ?? originalPortalFileUrl,
		input.sourceHomeUrl,
	);
	if (!resolvedDownloadUrl) {
		throw new Error(`file release ${fileReleaseId} missing downloadable url`);
	}
	const originalFilename =
		normalizeNullableText(input.detail.upfilename) ?? safeBasename(resolvedDownloadUrl);

	return {
		file_release_id: fileReleaseId,
		file_release: {
			source_surface: "file_release",
			filename,
			filecode: normalizeNullableText(input.detail.filecode ?? input.item.filecode),
			filetime: normalizeNullableText(input.detail.filetime ?? input.item.filetime),
			filedepartment: normalizeNullableText(
				input.detail.filedepartment ?? input.item.filedepartment,
			),
			explain_department: normalizeNullableText(input.detail.explainDept ?? input.item.explainDept),
			publisher_user_name: normalizeNullableText(input.item.user_name),
			file_type_id: fileTypeId,
			file_type_name: fileTypeName,
			original_portal_file_url: originalPortalFileUrl,
			resolved_download_url: resolvedDownloadUrl,
			upfilename: originalFilename,
			important: normalizeNullableNumber(input.detail.important),
			det_important: normalizeNullableNumber(input.detail.detImportant),
			role: normalizeNullableNumber(input.detail.role),
			last_seen_at: input.observedAt,
			enrich_attempted_at: input.observedAt,
		},
		released_file: {
			source_url: resolvedDownloadUrl,
			normalized_source_url: resolvedDownloadUrl,
			final_url: resolvedDownloadUrl,
			original_filename: originalFilename,
			mime_type: null,
			byte_size: null,
			sha256: null,
			storage_provider: "reference_only",
			bucket: null,
			object_key: null,
			etag: null,
			version_id: null,
			origin_url_scheme: normalizeUrlScheme(resolvedDownloadUrl),
			origin_host: normalizeUrlHost(resolvedDownloadUrl),
			origin_scope: classifyOriginScope(resolvedDownloadUrl),
			provenance_status: "reference_only",
			ingest_status: "reference_only",
			local_path: null,
			downloaded_at: null,
			uploaded_at: null,
			last_error: null,
			created_at: input.observedAt,
			updated_at: input.observedAt,
		},
	};
}

export async function collectFileReleaseBundle(
	input: CollectFileReleaseBundleInput,
): Promise<CollectFileReleaseBundleResult> {
	const createApiContext =
		input.createApiContext ??
		(() => createApiContextFromStorageState(resolveCollectorConfig(process.env)));
	const apiContext = await createApiContext();
	const fetchPage =
		input.fetchFileReleasePage ??
		((pageInput) =>
			fetchFileReleasePage({
				...pageInput,
				requestBackoffBaseMs: input.requestBackoffBaseMs,
				requestMaxRetries: input.requestMaxRetries,
			}));
	const fetchDetail =
		input.fetchFileReleaseDetail ??
		((detailInput) =>
			fetchFileReleaseDetail({
				...detailInput,
				requestBackoffBaseMs: input.requestBackoffBaseMs,
				requestMaxRetries: input.requestMaxRetries,
			}));
	const fetchDownloadUrl =
		input.fetchFileReleaseDownloadUrl ??
		((detailInput) =>
			fetchFileReleaseDownloadUrl({
				...detailInput,
				requestBackoffBaseMs: input.requestBackoffBaseMs,
				requestMaxRetries: input.requestMaxRetries,
			}));
	const fetchTypes =
		input.fetchFileReleaseTypes ??
		((typeInput) =>
			fetchFileReleaseTypes({
				...typeInput,
				requestBackoffBaseMs: input.requestBackoffBaseMs,
				requestMaxRetries: input.requestMaxRetries,
			}));
	const fetchCodeTypes =
		input.fetchFileReleaseCodeTypes ??
		((typeInput) =>
			fetchFileReleaseCodeTypes({
				...typeInput,
				requestBackoffBaseMs: input.requestBackoffBaseMs,
				requestMaxRetries: input.requestMaxRetries,
			}));
	const fetchExplainDepartments =
		input.fetchFileReleaseExplainDepartments ??
		((deptInput) =>
			fetchFileReleaseExplainDepartments({
				...deptInput,
				requestBackoffBaseMs: input.requestBackoffBaseMs,
				requestMaxRetries: input.requestMaxRetries,
			}));

	const bundleMap = new Map<number, BundleFileReleaseRecord>();
	const observedDepartments = new Set<string>();
	const targetFileReleaseId = input.targetFileReleaseId ?? null;
	let detailFetched = 0;
	let fileUrlsResolved = 0;
	let itemsSeen = 0;
	let pagesFetched = 0;

	try {
		const fileTypeResponse = await fetchTypes({ apiContext });
		const observedFileTypes = normalizeObservedFileTypes(fileTypeResponse);
		const fileCodeTypeResponse = await fetchCodeTypes({ apiContext });
		const observedFileCodeTypes = normalizeObservedFileCodeTypes(fileCodeTypeResponse);
		const explainDepartmentResponse = await fetchExplainDepartments({ apiContext });
		const observedExplainDepartments =
			normalizeObservedExplainDepartments(explainDepartmentResponse);
		const fileTypeNameById = new Map(observedFileTypes.map((item) => [item.id, item.typename]));

		for (let currentPage = 1; ; currentPage += 1) {
			if (input.maxPages !== null && input.maxPages !== undefined && currentPage > input.maxPages) {
				break;
			}
			if (targetFileReleaseId !== null && bundleMap.has(targetFileReleaseId)) {
				break;
			}
			if (input.maxFileReleases && bundleMap.size >= input.maxFileReleases) {
				break;
			}

			const pageResponse = await fetchPage({
				apiContext,
				currentPage,
				pageSize: input.pageSize,
			});
			pagesFetched += 1;
			itemsSeen += pageResponse.data?.length ?? 0;
			for (const department of normalizeDepartments(pageResponse.dws)) {
				observedDepartments.add(department);
			}

			const pageItems = pageResponse.data ?? [];
			if (pageItems.length === 0) {
				break;
			}

			for (const item of pageItems) {
				const fileReleaseId = normalizeOptionalId(item.id);
				if (fileReleaseId === null || bundleMap.has(fileReleaseId)) {
					continue;
				}
				if (targetFileReleaseId !== null && fileReleaseId !== targetFileReleaseId) {
					continue;
				}
				if (input.maxFileReleases && bundleMap.size >= input.maxFileReleases) {
					break;
				}
				const detail = await fetchDetail({
					apiContext,
					fileReleaseId,
				});
				detailFetched += 1;
				const downloadUrl = await fetchDownloadUrl({
					apiContext,
					fileReleaseId,
				});
				fileUrlsResolved += 1;
				bundleMap.set(
					fileReleaseId,
					buildFileReleaseRecord({
						detail,
						downloadUrl: normalizeNullableText(downloadUrl.url),
						fileTypeNameById,
						item,
						observedAt: input.exportedAt,
						sourceHomeUrl: input.sourceHomeUrl,
					}),
				);
			}

			if (targetFileReleaseId !== null && bundleMap.has(targetFileReleaseId)) {
				break;
			}
			if (input.maxFileReleases && bundleMap.size >= input.maxFileReleases) {
				break;
			}

			if (pageItems.length < input.pageSize) {
				break;
			}
			if (
				typeof pageResponse.size === "number" &&
				currentPage * input.pageSize >= pageResponse.size
			) {
				break;
			}
		}

		const bundleRecords = [...bundleMap.values()];
		if (targetFileReleaseId !== null && !bundleMap.has(targetFileReleaseId)) {
			throw new Error(
				`target file_release_id ${targetFileReleaseId} was not found in file_release export scope`,
			);
		}
		const materialized =
			input.attachmentArtifactStore === undefined
				? {
						bundleRecords,
						uploadedCount: 0,
					}
				: await materializeReleasedFiles({
						apiContext,
						artifactStore: input.attachmentArtifactStore,
						bundleRecords,
						observedAt: input.exportedAt,
					});

		return {
			bundleRecords: materialized.bundleRecords,
			exportManifest: buildExportManifest({
				exportedAt: input.exportedAt,
				detailFetched,
				fileUrlsResolved,
				itemsInserted: materialized.bundleRecords.length,
				itemsSeen,
				maxFileReleases: input.maxFileReleases ?? null,
				maxPages: input.maxPages ?? null,
				observedExplainDepartments,
				observedFileCodeTypes,
				observedDepartments: [...observedDepartments].sort((left, right) =>
					left.localeCompare(right, "zh-Hans-CN"),
				),
				observedFileTypes,
				pageSize: input.pageSize,
				pagesFetched,
				siteId: input.siteId,
				sourceHomeUrl: input.sourceHomeUrl,
				targetFileReleaseId,
				fileStorageMode:
					input.attachmentArtifactStore === undefined ? "reference_only" : "object_store_write",
			}),
			stats: {
				detailFetched,
				fileUrlsResolved,
				fileReleasesCollected: materialized.bundleRecords.length,
				fileObjectsUploaded: materialized.uploadedCount,
				pagesFetched,
			},
		};
	} finally {
		await apiContext.dispose();
	}
}

export function writeFileReleaseArtifacts(
	input: WriteFileReleaseArtifactsInput,
): WriteFileReleaseArtifactsResult {
	fs.mkdirSync(input.outputDir, { recursive: true });
	const timestamp = toTimestampLabel(input.exportManifest.exported_at);
	const bundlePath = path.join(input.outputDir, `file-releases-bundle-${timestamp}.json`);
	const manifestPath = path.join(input.outputDir, `file-releases-manifest-${timestamp}.json`);

	fs.writeFileSync(bundlePath, `${JSON.stringify(input.bundleRecords, null, 2)}\n`, "utf-8");
	fs.writeFileSync(manifestPath, `${JSON.stringify(input.exportManifest, null, 2)}\n`, "utf-8");

	return {
		bundlePath,
		manifestPath,
	};
}

export function buildAuthenticatedNoticeFileReleaseCaptureKey(input: {
	contentSha256: string;
	fileReleaseId: number;
	filename: string;
	year: string | null;
}): string {
	const digest = input.contentSha256.trim().toLowerCase();
	if (!digest) {
		throw new Error("contentSha256 is required");
	}
	const year = input.year?.trim() || "unknown-year";
	return [
		AUTHENTICATED_NOTICE_SOURCE_CHANNEL,
		`file-release-${input.fileReleaseId}`,
		year,
		`sha256-${digest}`,
		"capture",
		safeBasename(input.filename),
	].join("/");
}

async function materializeReleasedFiles(input: {
	apiContext: ApiRequestContextLike;
	artifactStore: AuthenticatedNoticeArtifactStore;
	bundleRecords: BundleFileReleaseRecord[];
	observedAt: string;
}): Promise<{ bundleRecords: BundleFileReleaseRecord[]; uploadedCount: number }> {
	const bundleRecords: BundleFileReleaseRecord[] = [];
	let uploadedCount = 0;

	for (const record of input.bundleRecords) {
		const candidateUrl =
			record.released_file.final_url ??
			record.released_file.normalized_source_url ??
			record.released_file.source_url;
		if (
			!candidateUrl ||
			record.released_file.origin_scope !== "internal" ||
			record.released_file.storage_provider !== "reference_only"
		) {
			bundleRecords.push(record);
			continue;
		}

		try {
			const result = await fetchAttachmentBinary({
				apiContext: input.apiContext,
				attachmentUrl: candidateUrl,
				requestBackoffBaseMs: 1,
				requestMaxRetries: 1,
			});
			const contentSha256 = createHash("sha256").update(result.body).digest("hex");
			const resolvedFilename = resolveFileReleaseFilename({
				contentDisposition: result.contentDisposition,
				fallbackFilename: record.file_release.upfilename,
				fallbackUrl: candidateUrl,
			});
			const resolvedContentType =
				resolveReleasedFileContentType({
					contentType: result.contentType,
					filename: resolvedFilename,
				}) ?? "application/octet-stream";
			const objectKey = buildAuthenticatedNoticeFileReleaseCaptureKey({
				contentSha256,
				fileReleaseId: record.file_release_id,
				filename: resolvedFilename,
				year: inferYearLabel(record.file_release.filetime),
			});
			const stored = await input.artifactStore.putObject({
				objectKey,
				data: result.body,
				contentType: resolvedContentType,
				metadata: {
					"content-sha256": contentSha256,
					"source-surface": "file_release",
				},
			});
			uploadedCount += 1;
			bundleRecords.push({
				...record,
				released_file: {
					...record.released_file,
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
				},
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			bundleRecords.push({
				...record,
				released_file: {
					...record.released_file,
					last_error: message,
					updated_at: input.observedAt,
				},
			});
		}
	}

	return {
		bundleRecords,
		uploadedCount,
	};
}

function buildExportManifest(input: {
	exportedAt: string;
	detailFetched: number;
	fileUrlsResolved: number;
	itemsInserted: number;
	itemsSeen: number;
	maxFileReleases: number | null;
	maxPages: number | null;
	observedExplainDepartments: string[];
	observedFileCodeTypes: Array<{ id: number; name: string; sort: number | null }>;
	observedDepartments: string[];
	observedFileTypes: Array<{ id: number; typename: string; sort: number | null }>;
	pageSize: number;
	pagesFetched: number;
	siteId: string;
	sourceHomeUrl: string;
	targetFileReleaseId: number | null;
	fileStorageMode: CollectorFileReleaseExportMetadata["file_storage_mode"];
}): FileReleaseExportManifest {
	const timestamp = toTimestampLabel(input.exportedAt);
	return {
		schema_version: FILE_RELEASE_EXPORT_SCHEMA_VERSION,
		exported_at: input.exportedAt,
		export_date: timestamp.slice(0, 8),
		export_scope:
			input.targetFileReleaseId === null
				? `file-release-${timestamp}`
				: `file-release-target-${input.targetFileReleaseId}-${timestamp}`,
		source_channel: AUTHENTICATED_NOTICE_SOURCE_CHANNEL,
		source_surface: "file_release",
		site_id: input.siteId,
		source_home_url: input.sourceHomeUrl,
		collector: {
			runtime_shell: "repo_local_node",
			export_contract_version: FILE_RELEASE_EXPORT_SCHEMA_VERSION,
			file_release_collection_mode:
				input.fileStorageMode === "reference_only"
					? "prompt_portlet_reference_only"
					: "prompt_portlet_materialized",
			file_storage_mode: input.fileStorageMode,
		},
		filters: {
			page_size: input.pageSize,
			max_pages: input.maxPages,
			max_file_releases: input.maxFileReleases,
			target_file_release_id: input.targetFileReleaseId,
		},
		observed_file_types: input.observedFileTypes,
		observed_departments: input.observedDepartments,
		observed_file_code_types: input.observedFileCodeTypes,
		observed_explain_departments: input.observedExplainDepartments,
		run: {
			mode: "file_release_export",
			status: "success",
			started_at: input.exportedAt,
			finished_at: input.exportedAt,
			pages_fetched: input.pagesFetched,
			items_seen: input.itemsSeen,
			items_inserted: input.itemsInserted,
			detail_fetched: input.detailFetched,
			file_urls_resolved: input.fileUrlsResolved,
			errors: 0,
		},
	};
}

function normalizeObservedFileTypes(
	response: FileReleaseTypeListResponse,
): Array<{ id: number; typename: string; sort: number | null }> {
	const normalized: Array<{ id: number; typename: string; sort: number | null }> = [];
	const seen = new Set<number>();
	for (const item of response.data ?? []) {
		const id = normalizeOptionalId(item.id);
		const typename = normalizeNullableText(item.typename);
		if (id === null || !typename || seen.has(id)) {
			continue;
		}
		seen.add(id);
		normalized.push({
			id,
			typename,
			sort: normalizeNullableNumber(item.sort),
		});
	}
	return normalized.sort((left, right) => left.id - right.id);
}

function normalizeDepartments(input: FileReleaseDepartmentRecord[] | undefined): string[] {
	return (input ?? [])
		.map((item) => normalizeNullableText(item.filedepartment))
		.filter((item): item is string => item !== null);
}

function normalizeObservedFileCodeTypes(
	response: FileReleaseCodeTypeListResponse,
): Array<{ id: number; name: string; sort: number | null }> {
	const normalized: Array<{ id: number; name: string; sort: number | null }> = [];
	const seen = new Set<number>();
	for (const item of response.data ?? []) {
		const id = normalizeOptionalId(item.id);
		const name = normalizeNullableText(item.name);
		if (id === null || !name || seen.has(id)) {
			continue;
		}
		seen.add(id);
		normalized.push({
			id,
			name,
			sort: normalizeNullableNumber(item.sort),
		});
	}
	return normalized.sort((left, right) => left.id - right.id);
}

function normalizeObservedExplainDepartments(
	response: FileReleaseExplainDepartmentListResponse,
): string[] {
	return [
		...new Set(
			(response.data ?? [])
				.map((item) => normalizeNullableText(item.ORGANIZATION_NAME))
				.filter((item): item is string => item !== null),
		),
	].sort((left, right) => left.localeCompare(right, "zh-Hans-CN"));
}

function resolveFileReleaseFilename(input: {
	contentDisposition: string | null;
	fallbackFilename: string | null;
	fallbackUrl: string;
}): string {
	const preferred = normalizeNullableText(input.fallbackFilename);
	if (preferred) {
		return safeBasename(preferred);
	}
	const fromHeader = contentDispositionFilename(input.contentDisposition);
	if (fromHeader) {
		return fromHeader;
	}
	return safeBasename(input.fallbackUrl);
}

function resolveReleasedFileContentType(input: {
	contentType: string | null;
	filename: string;
}): string | null {
	const normalizedContentType = normalizeContentType(input.contentType);
	if (normalizedContentType && !GENERIC_BINARY_MIME_TYPES.has(normalizedContentType)) {
		return normalizedContentType;
	}
	return (
		MIME_TYPE_BY_EXTENSION[path.posix.extname(input.filename).toLowerCase()] ??
		normalizedContentType
	);
}

function contentDispositionFilename(value: string | null): string | null {
	const trimmed = value?.trim();
	if (!trimmed) {
		return null;
	}
	const encodedMatch = trimmed.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
	if (encodedMatch?.[1]) {
		return safeBasename(safeDecodeURIComponent(encodedMatch[1]));
	}
	const quotedMatch = trimmed.match(/filename\s*=\s*"([^"]+)"/i);
	if (quotedMatch?.[1]) {
		return safeBasename(quotedMatch[1]);
	}
	const plainMatch = trimmed.match(/filename\s*=\s*([^;]+)/i);
	if (plainMatch?.[1]) {
		return safeBasename(plainMatch[1].trim());
	}
	return null;
}

function classifyOriginScope(urlValue: string): "internal" | "external" | "unsupported" {
	try {
		const url = new URL(urlValue);
		if (url.protocol !== "http:" && url.protocol !== "https:") {
			return "unsupported";
		}
		return url.hostname.endsWith("muc.edu.cn") || url.hostname === "portal.example.edu"
			? "internal"
			: "external";
	} catch {
		return "unsupported";
	}
}

function normalizeUrlScheme(urlValue: string): string | null {
	try {
		return new URL(urlValue).protocol.replace(/:$/, "");
	} catch {
		return null;
	}
}

function normalizeUrlHost(urlValue: string): string | null {
	try {
		return new URL(urlValue).hostname || null;
	} catch {
		return null;
	}
}

function resolveAbsoluteUrl(urlValue: string | null, sourceHomeUrl: string): string | null {
	if (!urlValue) {
		return null;
	}
	try {
		return new URL(urlValue, sourceHomeUrl).toString();
	} catch {
		return null;
	}
}

function normalizeOptionalId(value: number | string | null | undefined): number | null {
	if (typeof value === "number" && Number.isFinite(value)) {
		return Math.trunc(value);
	}
	if (typeof value === "string" && value.trim()) {
		const parsed = Number(value.trim());
		if (Number.isFinite(parsed)) {
			return Math.trunc(parsed);
		}
	}
	return null;
}

function normalizeRequiredId(value: number | string | null | undefined, fieldName: string): number {
	const normalized = normalizeOptionalId(value);
	if (normalized === null) {
		throw new Error(`${fieldName} is required`);
	}
	return normalized;
}

function normalizeRequiredText(value: string | null | undefined, fieldName: string): string {
	const normalized = normalizeNullableText(value);
	if (!normalized) {
		throw new Error(`${fieldName} is required`);
	}
	return normalized;
}

function normalizeNullableText(value: string | null | undefined): string | null {
	if (typeof value !== "string") {
		return null;
	}
	const trimmed = value.trim();
	return trimmed || null;
}

function normalizeNullableNumber(value: number | string | null | undefined): number | null {
	if (typeof value === "number" && Number.isFinite(value)) {
		return value;
	}
	if (typeof value === "string" && value.trim()) {
		const parsed = Number(value.trim());
		if (Number.isFinite(parsed)) {
			return parsed;
		}
	}
	return null;
}

function normalizeContentType(value: string | null): string | null {
	if (!value) {
		return null;
	}
	const normalized = value.split(";")[0]?.trim().toLowerCase() ?? "";
	return normalized || null;
}

function inferYearLabel(value: string | null): string | null {
	if (!value) {
		return null;
	}
	const match = value.match(YEAR_RE);
	return match?.[1] ?? null;
}

function safeBasename(value: string): string {
	const normalized = value.replace(/\\/g, "/");
	const basename = path.posix.basename(normalized).trim().replace(/\//g, "_");
	return basename || "file-release";
}

function safeDecodeURIComponent(value: string): string {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}

function toTimestampLabel(value: string): string {
	return new Date(value).toISOString().replace(/[-:]/g, "").replace(".000", "");
}

function parsePositiveInteger(raw: string | undefined, fallback: number | null): number | null {
	if (!raw?.trim()) {
		return fallback;
	}
	const parsed = Number(raw);
	if (!Number.isFinite(parsed) || parsed <= 0) {
		return fallback;
	}
	return Math.floor(parsed);
}

export function resolveFileReleaseExportFiltersFromEnv(env: NodeJS.ProcessEnv): {
	maxFileReleases: number | null;
	maxPages: number | null;
	pageSize: number;
	targetFileReleaseId: number | null;
} {
	return {
		pageSize: parsePositiveInteger(env.AUTHENTICATED_NOTICE_FILE_RELEASE_PAGE_SIZE, 100) ?? 100,
		maxPages: parsePositiveInteger(env.AUTHENTICATED_NOTICE_FILE_RELEASE_MAX_PAGES, null),
		maxFileReleases: parsePositiveInteger(env.AUTHENTICATED_NOTICE_FILE_RELEASE_MAX_ITEMS, null),
		targetFileReleaseId: parsePositiveInteger(
			env.AUTHENTICATED_NOTICE_FILE_RELEASE_TARGET_ID,
			null,
		),
	};
}

export async function main(): Promise<void> {
	loadCollectorEnv();
	const config = resolveCollectorConfig(process.env);
	ensureRuntimeDirs(config);
	const exportedAt = new Date().toISOString();
	const attachmentArtifactStore = createAuthenticatedNoticeArtifactStoreFromEnv(process.env);
	const { pageSize, maxPages, maxFileReleases, targetFileReleaseId } =
		resolveFileReleaseExportFiltersFromEnv(process.env);
	const result = await collectFileReleaseBundle({
		attachmentArtifactStore,
		exportedAt,
		maxFileReleases,
		maxPages,
		pageSize,
		requestBackoffBaseMs: config.requestBackoffBaseMs,
		requestMaxRetries: config.requestMaxRetries,
		siteId: config.siteId,
		sourceHomeUrl: config.sourceHomeUrl,
		targetFileReleaseId,
	});
	const written = writeFileReleaseArtifacts({
		bundleRecords: result.bundleRecords,
		exportManifest: result.exportManifest,
		outputDir: config.exportsDir,
	});
	console.log(
		JSON.stringify(
			{
				...result.stats,
				bundlePath: written.bundlePath,
				manifestPath: written.manifestPath,
			},
			null,
			2,
		),
	);
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	});
}
