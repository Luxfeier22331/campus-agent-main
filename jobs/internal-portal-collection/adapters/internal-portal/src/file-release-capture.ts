import path from "node:path";

import { parse as parseContentDisposition } from "content-disposition";
import { encodeObjectKeySegment } from "ingest-core";
import type { InternalPortalFileReleaseSource } from "ingestion-contracts";
import { validateInternalPortalFileReleaseSource } from "ingestion-contracts";
import { lookup as lookupMimeType } from "mime-types";

import type { InternalPortalCollectionObjectStore } from "../../../src/object-store.js";
import { fetchFileReleaseDetail, fetchFileReleaseDownloadUrl } from "./api.js";
import { bindApiContextCancellation } from "./api-context-cancellation.js";
import { downloadAttachment } from "./attachment-runner.js";
import type { InternalPortalConfig } from "./config.js";
import { createPortalApiContext } from "./portal.js";
import type {
	ApiRequestContextLike,
	DisposableApiContextLike,
	FileReleaseDetailResponse,
	FileReleaseDownloadUrlResponse,
} from "./types.js";

const GENERIC_BINARY_MIME_TYPES = new Set(["application/octet-stream", "binary/octet-stream"]);

export interface CaptureInternalPortalFileReleaseInput {
	abortSignal?: AbortSignal;
	config: InternalPortalConfig;
	fileReleaseId: number;
	objectStore: InternalPortalCollectionObjectStore;
}

export interface CaptureInternalPortalFileReleaseDependencies {
	createApiContext?: () => Promise<ApiRequestContextLike & DisposableApiContextLike>;
	downloadFile?: typeof downloadAttachment;
	fetchDetail?: (input: {
		apiContext: ApiRequestContextLike;
		fileReleaseId: number;
	}) => Promise<FileReleaseDetailResponse>;
	fetchDownloadUrl?: (input: {
		apiContext: ApiRequestContextLike;
		fileReleaseId: number;
	}) => Promise<FileReleaseDownloadUrlResponse>;
}

export interface CaptureInternalPortalFileReleaseResult {
	disposition: "reused" | "written";
	fileReleaseId: number;
	sourceKey: string;
}

export async function captureInternalPortalFileRelease(
	input: CaptureInternalPortalFileReleaseInput,
	dependencies: CaptureInternalPortalFileReleaseDependencies = {},
): Promise<CaptureInternalPortalFileReleaseResult> {
	assertFileReleaseId(input.fileReleaseId);
	input.abortSignal?.throwIfAborted();
	const prefix = [
		"internal_portal",
		encodeObjectKeySegment(input.config.siteId),
		"file-releases",
		String(input.fileReleaseId),
	].join("/");
	const fileKey = `${prefix}/file`;
	const sourceKey = `${prefix}/source.json`;
	const existingSource = await input.objectStore.getObjectIfExists({
		...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
		bucket: input.objectStore.sourceBucket,
		key: sourceKey,
	});
	if (existingSource) {
		parseStoredSource(existingSource, input.config.siteId, input.fileReleaseId);
		return { disposition: "reused", fileReleaseId: input.fileReleaseId, sourceKey };
	}

	const apiContext = await (
		dependencies.createApiContext ??
		(() =>
			createPortalApiContext(
				input.config,
				input.abortSignal ? { abortSignal: input.abortSignal } : {},
			))
	)();
	const disposeApiContext = bindApiContextCancellation(apiContext, input.abortSignal);
	try {
		const detail = await (dependencies.fetchDetail ?? fetchFileReleaseDetail)({
			apiContext,
			fileReleaseId: input.fileReleaseId,
		});
		const detailId = normalizePositiveId(detail.id);
		if (detailId !== input.fileReleaseId) {
			throw new Error(
				`file-release detail returned id ${String(detail.id)} for requested ${input.fileReleaseId}`,
			);
		}
		const downloadUrlResponse = await (
			dependencies.fetchDownloadUrl ?? fetchFileReleaseDownloadUrl
		)({
			apiContext,
			fileReleaseId: input.fileReleaseId,
		});
		const downloadUrl = resolveDownloadUrl(
			downloadUrlResponse.url ?? detail.fileurl,
			input.config.sourceHomeUrl,
			input.fileReleaseId,
		);
		const downloaded = await (dependencies.downloadFile ?? downloadAttachment)({
			...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
			apiContext,
			attachmentUrl: downloadUrl,
		});
		try {
			const originalFilename = resolveFilename({
				contentDisposition: downloaded.contentDisposition,
				sourceFilename: detail.upfilename,
				sourceUrl: downloadUrl,
			});
			const contentType = resolveContentType(downloaded.contentType, originalFilename);
			const stream = downloaded.openReadStream();
			const storedFile = await input.objectStore
				.createOrVerifyStream({
					...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
					body: stream,
					bucket: input.objectStore.sourceBucket,
					byteSize: downloaded.byteSize,
					contentSha256: downloaded.contentSha256,
					contentType,
					key: fileKey,
				})
				.finally(() => stream.destroy());
			input.abortSignal?.throwIfAborted();
			const source: InternalPortalFileReleaseSource = {
				schema_version: "internal_portal_file_release_source.v1",
				site_id: input.config.siteId,
				file_release_id: input.fileReleaseId,
				title: requiredText(detail.filename, "filename"),
				file_code: nullableText(detail.filecode),
				department: nullableText(detail.filedepartment),
				explanation_department: nullableText(detail.explainDept),
				published_at: nullableText(detail.filetime),
				file: {
					object_key: fileKey,
					original_filename: originalFilename,
					content_type: contentType,
					byte_size: storedFile.byteSize,
					digest: `sha256:${storedFile.contentSha256}`,
				},
			};
			assertValidSource(source);
			const sourceBytes = new TextEncoder().encode(`${JSON.stringify(source, null, 2)}\n`);
			await input.objectStore.createOrVerifyObject({
				...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
				body: sourceBytes,
				bucket: input.objectStore.sourceBucket,
				contentType: "application/json",
				key: sourceKey,
			});
			return { disposition: "written", fileReleaseId: input.fileReleaseId, sourceKey };
		} finally {
			await downloaded.remove();
		}
	} finally {
		await disposeApiContext();
	}
}

function parseStoredSource(
	bytes: Uint8Array,
	siteId: string,
	fileReleaseId: number,
): InternalPortalFileReleaseSource {
	let value: unknown;
	try {
		value = JSON.parse(new TextDecoder().decode(bytes));
	} catch (error) {
		throw new Error("stored internal portal file-release source is not valid JSON", {
			cause: error,
		});
	}
	assertValidSource(value);
	if (value.site_id !== siteId || value.file_release_id !== fileReleaseId) {
		throw new Error("stored internal portal file-release source identity does not match its key");
	}
	return value;
}

function assertValidSource(value: unknown): asserts value is InternalPortalFileReleaseSource {
	const validation = validateInternalPortalFileReleaseSource(value);
	if (!validation.ok) {
		throw new Error(`invalid internal portal file-release source: ${validation.errors.join("; ")}`);
	}
}

function resolveDownloadUrl(
	value: string | null | undefined,
	sourceHomeUrl: string,
	fileReleaseId: number,
): string {
	const normalized = nullableText(value);
	if (!normalized) {
		throw new Error(`file release ${fileReleaseId} missing downloadable url`);
	}
	const resolved = new URL(normalized, sourceHomeUrl);
	if (resolved.origin !== new URL(sourceHomeUrl).origin) {
		throw new Error(`file release ${fileReleaseId} returned an external download url`);
	}
	return resolved.toString();
}

function resolveFilename(input: {
	contentDisposition: string | null;
	sourceFilename: string | null | undefined;
	sourceUrl: string;
}): string {
	const sourceFilename = nullableText(input.sourceFilename);
	if (sourceFilename) {
		return safeBasename(sourceFilename);
	}
	if (input.contentDisposition) {
		try {
			const filename = parseContentDisposition(input.contentDisposition).parameters.filename;
			if (filename) {
				return safeBasename(filename);
			}
		} catch {
			// The URL basename remains the source-provided filename when this header is malformed.
		}
	}
	return safeBasename(new URL(input.sourceUrl).pathname);
}

function resolveContentType(value: string | null, filename: string): string {
	const provided = normalizeContentType(value);
	if (provided && !GENERIC_BINARY_MIME_TYPES.has(provided)) {
		return provided;
	}
	return (
		normalizeContentType(lookupMimeType(filename) || null) ?? provided ?? "application/octet-stream"
	);
}

function normalizeContentType(value: string | null): string | null {
	const normalized = value?.split(";")[0]?.trim().toLowerCase() ?? "";
	return normalized || null;
}

function safeBasename(value: string): string {
	const basename = path.posix.basename(value.replace(/\\/g, "/")).trim();
	return basename || "file-release";
}

function nullableText(value: string | null | undefined): string | null {
	const normalized = typeof value === "string" ? value.trim() : "";
	return normalized || null;
}

function requiredText(value: string | null | undefined, field: string): string {
	const normalized = nullableText(value);
	if (!normalized) {
		throw new Error(`${field} is required`);
	}
	return normalized;
}

function normalizePositiveId(value: number | string | null | undefined): number | null {
	if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) {
		return value;
	}
	if (typeof value !== "string" || !/^[1-9]\d*$/u.test(value.trim())) {
		return null;
	}
	const parsed = Number(value.trim());
	return Number.isSafeInteger(parsed) ? parsed : null;
}

function assertFileReleaseId(value: number): void {
	if (!Number.isSafeInteger(value) || value <= 0) {
		throw new Error("fileReleaseId must be a positive safe integer");
	}
}
