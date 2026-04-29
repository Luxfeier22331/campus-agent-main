import path from "node:path";

import type {
	CollectorFileReleaseExportMetadata,
	FileReleaseCodeTypeListResponse,
	FileReleaseDepartmentRecord,
	FileReleaseExplainDepartmentListResponse,
	FileReleaseExportManifest,
	FileReleaseTypeListResponse,
} from "./types";
export const AUTHENTICATED_NOTICE_SOURCE_CHANNEL = "authenticated_notice_portal";
export const FILE_RELEASE_EXPORT_SCHEMA_VERSION = "authenticated_notice_file_release_export_v1";
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

export function buildExportManifest(input: {
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

export function normalizeObservedFileTypes(
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

export function normalizeDepartments(input: FileReleaseDepartmentRecord[] | undefined): string[] {
	return (input ?? [])
		.map((item) => normalizeNullableText(item.filedepartment))
		.filter((item): item is string => item !== null);
}

export function normalizeObservedFileCodeTypes(
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

export function normalizeObservedExplainDepartments(
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

export function resolveFileReleaseFilename(input: {
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

export function resolveReleasedFileContentType(input: {
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

export function classifyOriginScope(urlValue: string): "internal" | "external" | "unsupported" {
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

export function normalizeUrlScheme(urlValue: string): string | null {
	try {
		return new URL(urlValue).protocol.replace(/:$/, "");
	} catch {
		return null;
	}
}

export function normalizeUrlHost(urlValue: string): string | null {
	try {
		return new URL(urlValue).hostname || null;
	} catch {
		return null;
	}
}

export function resolveAbsoluteUrl(urlValue: string | null, sourceHomeUrl: string): string | null {
	if (!urlValue) {
		return null;
	}
	try {
		return new URL(urlValue, sourceHomeUrl).toString();
	} catch {
		return null;
	}
}

export function normalizeOptionalId(value: number | string | null | undefined): number | null {
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

export function normalizeRequiredId(
	value: number | string | null | undefined,
	fieldName: string,
): number {
	const normalized = normalizeOptionalId(value);
	if (normalized === null) {
		throw new Error(`${fieldName} is required`);
	}
	return normalized;
}

export function normalizeRequiredText(value: string | null | undefined, fieldName: string): string {
	const normalized = normalizeNullableText(value);
	if (!normalized) {
		throw new Error(`${fieldName} is required`);
	}
	return normalized;
}

export function normalizeNullableText(value: string | null | undefined): string | null {
	if (typeof value !== "string") {
		return null;
	}
	const trimmed = value.trim();
	return trimmed || null;
}

export function normalizeNullableNumber(value: number | string | null | undefined): number | null {
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

export function inferYearLabel(value: string | null): string | null {
	if (!value) {
		return null;
	}
	const match = value.match(YEAR_RE);
	return match?.[1] ?? null;
}

export function safeBasename(value: string): string {
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

export function toTimestampLabel(value: string): string {
	return new Date(value).toISOString().replace(/[-:]/g, "").replace(".000", "");
}

export function parsePositiveInteger(
	raw: string | undefined,
	fallback: number | null,
): number | null {
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
