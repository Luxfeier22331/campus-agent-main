import type { IngestionArtifactRef, IngestionTaskEnvelope } from "ingestion-contracts";

import {
	buildAuthenticatedFileReleaseSourceTruthKeys,
	buildCanonicalVersionDigest,
	writeCanonicalJsonArtifact,
	writeCanonicalJsonLinesArtifact,
} from "./artifacts.ts";
import {
	assertArtifactRefBytes,
	buildObjectStoreArtifactRef,
	type ObjectStore,
	parseJsonArrayBytes,
	parseJsonObjectBytes,
	parseOptionalInteger,
	parseOptionalText,
	parseRecord,
	parseRequiredInteger,
	parseRequiredNonNegativeInteger,
	parseRequiredText,
	parseS3Uri,
	sha256Hex,
} from "./core.ts";
import {
	deriveFileReleaseBundleKeyForManifest,
	parseAuthenticatedFileReleaseManifest,
} from "./source-handoff.ts";

const SOURCE_CHANNEL = "internal_portal";
const SOURCE_SURFACE = "file_release";
const FILE_RELEASE_EXPORT_SCHEMA = "internal_portal_file_release_export_v1";
const FILE_RELEASE_MANIFEST_SCHEMA = "authenticated_notice_file_release_manifest_v1";
const FILE_RELEASE_BLOCK_SCHEMA = "authenticated_notice_file_release_block_v1";
const FILE_RELEASE_REF_SCHEMA = "authenticated_notice_file_release_ref_v1";

export async function materializeAuthenticatedFileReleaseSourceTruthFromTask(input: {
	objectStore: ObjectStore;
	outputBucket: string;
	task: IngestionTaskEnvelope;
}): Promise<IngestionArtifactRef[]> {
	const manifestInput = parseS3Uri(input.task.input_ref);
	const manifestBytes = await input.objectStore.getObject(manifestInput);
	const manifestSha256 = sha256Hex(manifestBytes);
	assertArtifactRefBytes({
		bytes: manifestBytes,
		label: "file-release manifest input_ref",
		ref: input.task.input_ref,
	});
	const exportManifest = parseJsonObjectBytes(manifestBytes, "file-release manifest");
	const parsedExportManifest = parseAuthenticatedFileReleaseManifest(exportManifest);
	const bundleKey = deriveFileReleaseBundleKeyForManifest(manifestInput.key);
	const bundleBytes = await input.objectStore.getObject({
		bucket: manifestInput.bucket,
		key: bundleKey,
	});
	const bundleRecords = parseJsonArrayBytes(bundleBytes, "file-release bundle").map((item) =>
		parseRecord(item, "file-release bundle record"),
	);

	const refs: IngestionArtifactRef[] = [
		buildObjectStoreArtifactRef({
			bucket: manifestInput.bucket,
			byteSize: manifestBytes.byteLength,
			key: manifestInput.key,
			contentSha256: manifestSha256,
		}),
	];
	for (const bundleRecord of bundleRecords) {
		refs.push(
			...(await materializeFileReleaseSourceTruth({
				bundleRecord,
				exportManifest,
				parsedExportManifest,
				objectStore: input.objectStore,
				outputBucket: input.outputBucket,
				sourceBucket: manifestInput.bucket,
				task: input.task,
			})),
		);
	}
	return refs;
}

async function materializeFileReleaseSourceTruth(input: {
	bundleRecord: Record<string, unknown>;
	exportManifest: Record<string, unknown>;
	parsedExportManifest: { exportedAt: string; siteId: string; sourceHomeUrl: string };
	objectStore: ObjectStore;
	outputBucket: string;
	sourceBucket: string;
	task: IngestionTaskEnvelope;
}): Promise<IngestionArtifactRef[]> {
	const fileReleaseId = parseRequiredInteger(input.bundleRecord.file_release_id, "file_release_id");
	const fileRelease = parseRecord(input.bundleRecord.file_release, "file_release");
	const releasedFile = parseRecord(input.bundleRecord.released_file, "released_file");
	validateReleasedFileObjectBacked(releasedFile);
	const sourceBucket = parseRequiredText(releasedFile.bucket, "released_file.bucket");
	const sourceKey = parseRequiredText(releasedFile.object_key, "released_file.object_key");
	if (sourceBucket !== input.sourceBucket) {
		throw new Error("file-release source bytes must use the input source bucket");
	}
	const sourceBytes = await input.objectStore.getObject({
		bucket: sourceBucket,
		key: sourceKey,
	});
	const sourceSha256 = parseRequiredText(releasedFile.sha256, "released_file.sha256");
	if (sha256Hex(sourceBytes) !== sourceSha256) {
		throw new Error("file-release source bytes sha256 mismatch");
	}
	const sourceByteSize = parseRequiredNonNegativeInteger(
		releasedFile.byte_size,
		"released_file.byte_size",
	);
	if (sourceBytes.byteLength !== sourceByteSize) {
		throw new Error("file-release source bytes byte_size mismatch");
	}

	const filename = parseRequiredText(fileRelease.filename, "file_release.filename");
	const sourceUri = parseRequiredText(
		fileRelease.resolved_download_url ?? releasedFile.source_url,
		"file_release.resolved_download_url",
	);
	const rawAssetId = `asset:file-release:${input.parsedExportManifest.siteId}:${fileReleaseId}`;
	const rawVersionId = buildCanonicalVersionDigest({
		file_release: fileRelease,
		released_file: {
			object_key: sourceKey,
			sha256: sourceSha256,
			byte_size: sourceByteSize,
		},
	});
	const year = inferYear(fileRelease.filetime ?? filename);
	const keys = buildAuthenticatedFileReleaseSourceTruthKeys({
		fileReleaseId,
		rawVersionId,
		year,
	});
	const contentBlocks = buildContentBlocks({
		fileRelease,
		rawAssetId,
		rawVersionId,
		releasedFile,
	});
	return Promise.all([
		writeCanonicalJsonArtifact({
			bucket: input.outputBucket,
			key: keys.manifestKey,
			objectStore: input.objectStore,
			value: {
				schema_version: FILE_RELEASE_MANIFEST_SCHEMA,
				source_channel: SOURCE_CHANNEL,
				source_surface: SOURCE_SURFACE,
				site_id: input.parsedExportManifest.siteId,
				file_release_id: fileReleaseId,
				raw_asset_id: rawAssetId,
				raw_version_id: rawVersionId,
				captured_at: input.parsedExportManifest.exportedAt,
				detail_observed_at:
					parseOptionalText(fileRelease.enrich_attempted_at) ??
					input.parsedExportManifest.exportedAt,
				fetcher_name: "authenticated_notice_file_release_materializer",
				fetcher_version: FILE_RELEASE_EXPORT_SCHEMA,
				capture_runtime_version: captureRuntimeVersion(input.exportManifest),
				credentials_mode: "authenticated",
				source_home_url: input.parsedExportManifest.sourceHomeUrl,
				source_file_url: sourceUri,
				filename,
				upfilename: parseOptionalText(fileRelease.upfilename),
				filecode: parseOptionalText(fileRelease.filecode),
				filetime: parseOptionalText(fileRelease.filetime),
				filedepartment: parseOptionalText(fileRelease.filedepartment),
				explain_department: parseOptionalText(fileRelease.explain_department),
				file_type_id: parseOptionalInteger(fileRelease.file_type_id),
				file_type_name: parseOptionalText(fileRelease.file_type_name),
				released_file_object_key: sourceKey,
				released_file_sha256: sourceSha256,
				released_file_byte_size: sourceByteSize,
				released_file_mime_type: parseOptionalText(releasedFile.mime_type),
				block_count: contentBlocks.length,
				materialized_by_task_id: input.task.task_id,
			},
		}),
		writeCanonicalJsonLinesArtifact({
			bucket: input.outputBucket,
			key: keys.contentBlocksKey,
			objectStore: input.objectStore,
			rows: contentBlocks,
		}),
		writeCanonicalJsonArtifact({
			bucket: input.outputBucket,
			key: keys.releasedFileRefKey,
			objectStore: input.objectStore,
			value: {
				schema_version: FILE_RELEASE_REF_SCHEMA,
				raw_asset_id: rawAssetId,
				raw_version_id: rawVersionId,
				file_release_id: fileReleaseId,
				source_url: parseOptionalText(releasedFile.source_url),
				final_url: parseOptionalText(releasedFile.final_url),
				original_filename: parseOptionalText(releasedFile.original_filename),
				mime_type: parseOptionalText(releasedFile.mime_type),
				byte_size: sourceByteSize,
				storage_provider: "object_store",
				bucket: sourceBucket,
				object_key: sourceKey,
				content_sha256: sourceSha256,
			},
		}),
	]);
}

function validateReleasedFileObjectBacked(releasedFile: Record<string, unknown>): void {
	if (releasedFile.storage_provider !== "object_store") {
		throw new Error("file-release source materialization requires object_store released_file");
	}
	parseRequiredText(releasedFile.bucket, "released_file.bucket");
	parseRequiredText(releasedFile.object_key, "released_file.object_key");
	parseRequiredText(releasedFile.sha256, "released_file.sha256");
	parseRequiredNonNegativeInteger(releasedFile.byte_size, "released_file.byte_size");
}

function buildContentBlocks(input: {
	fileRelease: Record<string, unknown>;
	rawAssetId: string;
	rawVersionId: string;
	releasedFile: Record<string, unknown>;
}): Record<string, unknown>[] {
	const lines = [
		["title", parseRequiredText(input.fileRelease.filename, "file_release.filename")],
		["metadata", metadataLine("文件编号", parseOptionalText(input.fileRelease.filecode))],
		["metadata", metadataLine("发布时间", parseOptionalText(input.fileRelease.filetime))],
		["metadata", metadataLine("发布部门", parseOptionalText(input.fileRelease.filedepartment))],
		["metadata", metadataLine("说明部门", parseOptionalText(input.fileRelease.explain_department))],
		["metadata", metadataLine("文件类型", parseOptionalText(input.fileRelease.file_type_name))],
		[
			"metadata",
			metadataLine("下载地址", parseOptionalText(input.fileRelease.resolved_download_url)),
		],
		["metadata", metadataLine("原始文件", parseOptionalText(input.releasedFile.original_filename))],
	] as const;
	const rows: Record<string, unknown>[] = [];
	for (const [role, text] of lines) {
		const normalized = normalizeText(text);
		if (!normalized) {
			continue;
		}
		rows.push({
			schema_version: FILE_RELEASE_BLOCK_SCHEMA,
			raw_asset_id: input.rawAssetId,
			raw_version_id: input.rawVersionId,
			row_id: `block-${String(rows.length + 1).padStart(4, "0")}`,
			row_index: rows.length,
			block_order: rows.length + 1,
			block_role: role,
			text_raw: text,
			text_normalized: normalized,
		});
	}
	return rows;
}

function captureRuntimeVersion(manifest: Record<string, unknown>): string {
	const captureRuntime = isRecord(manifest.capture_runtime) ? manifest.capture_runtime : {};
	return parseOptionalText(captureRuntime.export_contract_version) ?? FILE_RELEASE_EXPORT_SCHEMA;
}

function metadataLine(label: string, value: string | null): string {
	return value ? `${label}：${value}` : "";
}

function normalizeText(value: string): string {
	return value.replace(/\s+/gu, " ").trim();
}

function inferYear(value: unknown): string {
	const text = typeof value === "string" ? value : "";
	const match = /(?<!\d)((?:19|20)\d{2})(?!\d)/u.exec(text);
	return match?.[1] ?? "unknown-year";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
