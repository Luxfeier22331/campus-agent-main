import { createHash } from "node:crypto";

import type { IngestionArtifactRef } from "ingestion-contracts";

import {
	buildObjectStoreArtifactRef,
	canonicalJsonSha256Digest,
	encodeCanonicalJson,
	encodeJsonLines,
	type ObjectStore,
	type Sha256Digest,
	sha256Hex,
} from "./core.ts";

const MAX_DOCUMENT_DIRECTORY_SEGMENT_BYTES = 180;

export function buildCanonicalVersionDigest(value: unknown): Sha256Digest {
	return canonicalJsonSha256Digest(value);
}

export function joinObjectKeySegments(...segments: readonly string[]): string {
	const cleaned = segments.map((segment) => {
		const value = segment.trim().replace(/^\/+|\/+$/gu, "");
		if (!value) {
			throw new Error("object key segment must be non-empty");
		}
		if (value === "." || value.includes("..")) {
			throw new Error("object key segment must not contain ..");
		}
		return value;
	});
	return cleaned.join("/");
}

export function buildAuthenticatedNoticeSourceTruthKeys(input: {
	rawAssetId: string;
	rawVersionId: string;
	year: string | null;
}): {
	attachmentRefsKey: string;
	contentBlocksKey: string;
	manifestKey: string;
} {
	const prefix = joinObjectKeySegments(
		"internal_portal",
		sourceAssetSlug(input.rawAssetId),
		input.year ?? "undated",
		...identitySegments(input.rawVersionId),
		"source-truth",
	);
	return {
		attachmentRefsKey: joinObjectKeySegments(prefix, "attachment-refs.jsonl"),
		contentBlocksKey: joinObjectKeySegments(prefix, "content-blocks.jsonl"),
		manifestKey: joinObjectKeySegments(prefix, "notice-manifest.json"),
	};
}

export function buildAuthenticatedFileReleaseSourceTruthKeys(input: {
	fileReleaseId: number;
	rawVersionId: string;
	year: string;
}): {
	contentBlocksKey: string;
	manifestKey: string;
	releasedFileRefKey: string;
} {
	const prefix = joinObjectKeySegments(
		"internal_portal",
		`file-release-${input.fileReleaseId}`,
		input.year,
		input.rawVersionId,
		"source-truth",
	);
	return {
		contentBlocksKey: joinObjectKeySegments(prefix, "content-blocks.jsonl"),
		manifestKey: joinObjectKeySegments(prefix, "file-release-manifest.json"),
		releasedFileRefKey: joinObjectKeySegments(prefix, "released-file-ref.json"),
	};
}

export function buildDocumentArtifactKey(input: {
	collection: string;
	corpus: string;
	documentId: string;
	filename: string;
	revisionTrack: string;
	title?: string | null;
	versionId: string;
	year?: string | null;
}): string {
	const prefix = joinObjectKeySegments(
		input.corpus,
		"documents",
		input.collection,
		documentDirectoryName(input.documentId, input.title ?? ""),
		input.revisionTrack,
		normalizeYearLabel(input.year ?? ""),
	);
	return joinObjectKeySegments(prefix, input.filename);
}

export async function writeCanonicalJsonArtifact(input: {
	bucket: string;
	key: string;
	objectStore: ObjectStore;
	value: unknown;
}): Promise<IngestionArtifactRef> {
	return writeCanonicalArtifact({
		bucket: input.bucket,
		body: encodeCanonicalJson(input.value),
		contentType: "application/json",
		key: input.key,
		objectStore: input.objectStore,
	});
}

export async function writeCanonicalJsonLinesArtifact(input: {
	bucket: string;
	key: string;
	objectStore: ObjectStore;
	rows: readonly unknown[];
}): Promise<IngestionArtifactRef> {
	return writeCanonicalArtifact({
		bucket: input.bucket,
		body: encodeJsonLines(input.rows),
		contentType: "application/x-ndjson",
		key: input.key,
		objectStore: input.objectStore,
	});
}

export async function writeUtf8Artifact(input: {
	body: string;
	bucket: string;
	contentType: string;
	key: string;
	objectStore: ObjectStore;
}): Promise<IngestionArtifactRef> {
	return writeCanonicalArtifact({
		bucket: input.bucket,
		body: new TextEncoder().encode(input.body),
		contentType: input.contentType,
		key: input.key,
		objectStore: input.objectStore,
	});
}

async function writeCanonicalArtifact(input: {
	bucket: string;
	body: Uint8Array;
	contentType: string;
	key: string;
	objectStore: ObjectStore;
}): Promise<IngestionArtifactRef> {
	const actualSha256 = sha256Hex(input.body);
	const result = await input.objectStore.createOrVerifyObject({
		bucket: input.bucket,
		key: input.key,
		body: input.body,
		contentType: input.contentType,
	});
	if (result.contentSha256 !== actualSha256) {
		throw new Error("artifact writer checksum mismatch");
	}
	return buildObjectStoreArtifactRef({
		bucket: input.bucket,
		byteSize: result.byteSize,
		key: input.key,
		contentSha256: actualSha256,
	});
}

function sourceAssetSlug(value: string): string {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9._:-]+/gu, "-")
		.replace(/^-+|-+$/gu, "");
}

function identitySegments(rawVersionId: string): string[] {
	const value = rawVersionId.startsWith("sha256:")
		? rawVersionId.slice("sha256:".length)
		: rawVersionId;
	return [value.slice(0, 2), value];
}

function documentDirectoryName(documentId: string, title: string): string {
	const documentSuffix = documentIdSuffix(documentId);
	const titleSlug = slugifyPathLabel(title || documentSuffix);
	const docid8 = documentIdShortLabel({ documentId, documentSuffix });
	const suffix = `--${docid8}`;
	const titleBudget =
		MAX_DOCUMENT_DIRECTORY_SEGMENT_BYTES - new TextEncoder().encode(suffix).length;
	return `${truncateUtf8PathSegment(titleSlug, titleBudget)}${suffix}`;
}

function normalizeYearLabel(value: string): string {
	const match = value.match(/(?<!\d)((?:19|20)\d{2})(?!\d)/u);
	return match?.[1] ?? "undated";
}

function documentIdSuffix(documentId: string): string {
	return identitySegmentsFromColonValue(documentId).at(-1) ?? documentId;
}

function documentIdShortLabel(input: { documentId: string; documentSuffix: string }): string {
	const normalizedSuffix = slugifyPathLabel(input.documentSuffix);
	if (looksLikeHash(normalizedSuffix) && normalizedSuffix.length > 8) {
		return normalizedSuffix.slice(0, 8);
	}
	const normalizedDocumentId = slugifyPathLabel(input.documentId);
	if (looksLikeHash(normalizedDocumentId) && normalizedDocumentId.length > 8) {
		return normalizedDocumentId.slice(0, 8);
	}
	if (input.documentSuffix.startsWith("attachment-")) {
		return createHash("sha1").update(input.documentId).digest("hex").slice(0, 8);
	}
	return normalizedSuffix;
}

function identitySegmentsFromColonValue(value: string): string[] {
	return value
		.trim()
		.split(":")
		.map((segment) => segment.trim())
		.filter(Boolean);
}

function truncateUtf8PathSegment(value: string, maxBytes: number): string {
	if (maxBytes <= 0) {
		throw new Error("document directory title budget must be greater than zero");
	}
	if (new TextEncoder().encode(value).length <= maxBytes) {
		return value;
	}
	let output = "";
	let usedBytes = 0;
	for (const char of value) {
		const charSize = new TextEncoder().encode(char).length;
		if (usedBytes + charSize > maxBytes) {
			break;
		}
		output += char;
		usedBytes += charSize;
	}
	return output.replace(/-+$/gu, "") || "document";
}

function looksLikeHash(value: string): boolean {
	return value.length >= 8 && /^[0-9a-f]+$/u.test(value);
}

function slugifyPathLabel(value: string): string {
	return value
		.trim()
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, "-")
		.replace(/^-+|-+$/gu, "");
}
