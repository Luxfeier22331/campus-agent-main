import { ArtifactValidationError } from "@campus-agent/embedding-runtime";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
	NOTICE_CHUNK_RUN_SCHEMA_VERSION,
	NOTICE_CHUNK_VALIDATION_SCHEMA_VERSION,
} from "./definitions.ts";
import { sha256 } from "./encoding.ts";
import { noticeChunkRunPrefix } from "./artifacts.ts";
import type {
	NoticeArtifactReader,
	NoticeChunk,
	NoticeChunkRunManifest,
	NoticeChunkValidationReport,
	NoticeReviewSample,
	Sha256Ref,
} from "./types.ts";

export interface NoticeChunkRunData {
	chunks: NoticeChunk[];
	chunksByNoticeId: Map<string, NoticeChunk[]>;
	manifest: NoticeChunkRunManifest;
	reviewSamples: NoticeReviewSample[];
	validation: NoticeChunkValidationReport;
}

export async function readNoticeChunkRun(
	artifactRoot: string,
	run: Sha256Ref,
): Promise<NoticeChunkRunData> {
	assertSha256Ref(run, "notice chunk run");
	const directory = join(
		artifactRoot,
		"notices",
		"chunking",
		"sha256",
		artifactHex(run),
	);
	return readNoticeChunkRunFiles(run, (file) => readFile(join(directory, file)));
}

export async function readStoredNoticeChunkRun(
	store: NoticeArtifactReader,
	run: Sha256Ref,
): Promise<NoticeChunkRunData> {
	assertSha256Ref(run, "notice chunk run");
	const prefix = noticeChunkRunPrefix(run);
	return readNoticeChunkRunFiles(run, (file) => store.read(`${prefix}/${file}`));
}

async function readNoticeChunkRunFiles(
	run: Sha256Ref,
	read: (file: string) => Promise<Uint8Array>,
): Promise<NoticeChunkRunData> {
	const manifestBytes = await read("manifest.json");
	if (sha256(manifestBytes) !== run) {
		throw new ArtifactValidationError(`notice chunk run manifest digest does not match ${run}`);
	}
	const manifest = parseManifest(manifestBytes);
	const chunkBytes = await readVerifiedFile(read, manifest.chunks, "notice chunk data");
	const validationBytes = await readVerifiedFile(
		read,
		manifest.validation,
		"notice chunk validation",
	);
	const reviewBytes = await readVerifiedFile(
		read,
		manifest.reviewSamples,
		"notice review samples",
	);
	const chunks = decodeChunks(chunkBytes);
	const validation = decodeValidation(validationBytes);
	const reviewSamples = decodeReviewSamples(reviewBytes);
	if (chunks.length !== manifest.chunkCount) {
		throw new ArtifactValidationError(
			`notice chunk data count ${chunks.length} does not match ${manifest.chunkCount}`,
		);
	}
	if (validation.chunkCount !== chunks.length || validation.noticeCount !== manifest.noticeCount) {
		throw new ArtifactValidationError("notice chunk validation count does not match the run manifest");
	}
	const chunksByNoticeId = groupChunks(chunks);
	if (chunksByNoticeId.size !== manifest.noticeCount) {
		throw new ArtifactValidationError(
			`notice chunk notice count ${chunksByNoticeId.size} does not match ${manifest.noticeCount}`,
		);
	}
	return { chunks, chunksByNoticeId, manifest, reviewSamples, validation };
}

export function artifactHex(value: Sha256Ref): string {
	return value.slice("sha256:".length);
}

function parseManifest(bytes: Uint8Array): NoticeChunkRunManifest {
	const value = parseJson(bytes, "notice chunk run manifest");
	if (!isRecord(value) || value.schemaVersion !== NOTICE_CHUNK_RUN_SCHEMA_VERSION) {
		throw new ArtifactValidationError("notice chunk run manifest schema is invalid");
	}
	const manifest = value as unknown as NoticeChunkRunManifest;
	if (
		!positiveInteger(manifest.chunkCount) ||
		!positiveInteger(manifest.noticeCount) ||
		!validChunkDefinition(manifest.definition)
	) {
		throw new ArtifactValidationError("notice chunk run manifest definition is invalid");
	}
	assertArtifactReference(manifest.chunks, "notice chunk data");
	assertArtifactReference(manifest.reviewSamples, "notice review samples");
	assertArtifactReference(manifest.validation, "notice chunk validation");
	return manifest;
}

function decodeChunks(bytes: Uint8Array): NoticeChunk[] {
	const chunks = decodeNdjson(bytes, (value, index) => {
		if (!isRecord(value)) throw new ArtifactValidationError(`notice chunk record ${index} is invalid`);
		for (const field of ["chunkId", "content", "noticeId", "retrievalText"] as const) {
			if (!nonEmptyString(value[field])) {
				throw new ArtifactValidationError(`notice chunk record ${index} has invalid ${field}`);
			}
		}
		if (!isSha256Ref(value.chunkId)) {
			throw new ArtifactValidationError(`notice chunk record ${index} has invalid chunkId`);
		}
		if (!nonNegativeInteger(value.chunkIndex)) {
			throw new ArtifactValidationError(`notice chunk record ${index} has invalid chunkIndex`);
		}
		if (
			!Array.isArray(value.headingPath) ||
			value.headingPath.some((heading) => !nonEmptyString(heading))
		) {
			throw new ArtifactValidationError(`notice chunk record ${index} has invalid headingPath`);
		}
		return value as unknown as NoticeChunk;
	});
	const chunkIds = new Set<string>();
	for (const chunk of chunks) {
		if (chunkIds.has(chunk.chunkId)) {
			throw new ArtifactValidationError(`notice chunk identity is duplicated: ${chunk.chunkId}`);
		}
		chunkIds.add(chunk.chunkId);
	}
	return chunks;
}
function decodeValidation(bytes: Uint8Array): NoticeChunkValidationReport {
	const value = parseJson(bytes, "notice chunk validation");
	const schemaVersion = isRecord(value) ? value.schemaVersion : undefined;
	if (
		!isRecord(value) ||
		!isSupportedValidationSchema(schemaVersion) ||
		!positiveInteger(value.chunkCount) ||
		!positiveInteger(value.noticeCount)
	) {
		throw new ArtifactValidationError("notice chunk validation schema is invalid");
	}
	const beforeV2 = schemaVersion === "notice_chunk_validation.v1";
	const beforeV3 = beforeV2 || schemaVersion === "notice_chunk_validation.v2";
	return {
		...value,
		fieldValueSplitCount: diagnosticCount(
			value.fieldValueSplitCount,
			beforeV3,
			"fieldValueSplitCount",
		),
		footerOnlyChunkCount: diagnosticCount(
			value.footerOnlyChunkCount,
			beforeV2,
			"footerOnlyChunkCount",
		),
		headingContentDuplicateCount: diagnosticCount(
			value.headingContentDuplicateCount,
			beforeV2,
			"headingContentDuplicateCount",
		),
		formalHeadingPathViolationCount: diagnosticCount(
			value.formalHeadingPathViolationCount,
			beforeV2,
			"formalHeadingPathViolationCount",
		),
		listContinuationSplitCount: diagnosticCount(
			value.listContinuationSplitCount,
			beforeV3,
			"listContinuationSplitCount",
		),
		orphanLabelCount: diagnosticCount(value.orphanLabelCount, beforeV2, "orphanLabelCount"),
		secondaryBoundaryCrossingCount: diagnosticCount(
			value.secondaryBoundaryCrossingCount,
			beforeV2,
			"secondaryBoundaryCrossingCount",
		),
		standaloneUrlCount: diagnosticCount(
			value.standaloneUrlCount,
			beforeV2,
			"standaloneUrlCount",
		),
		tableHeaderContextMissingCount: diagnosticCount(
			value.tableHeaderContextMissingCount,
			beforeV3,
			"tableHeaderContextMissingCount",
		),
		tableRowSplitCount: diagnosticCount(
			value.tableRowSplitCount,
			beforeV3,
			"tableRowSplitCount",
		),
		urlOwnerSplitCount: diagnosticCount(
			value.urlOwnerSplitCount,
			beforeV3,
			"urlOwnerSplitCount",
		),
		schemaVersion: NOTICE_CHUNK_VALIDATION_SCHEMA_VERSION,
	} as unknown as NoticeChunkValidationReport;
}

function isSupportedValidationSchema(
	value: unknown,
): value is
	| "notice_chunk_validation.v1"
	| "notice_chunk_validation.v2"
	| typeof NOTICE_CHUNK_VALIDATION_SCHEMA_VERSION {
	return (
		value === "notice_chunk_validation.v1" ||
		value === "notice_chunk_validation.v2" ||
		value === NOTICE_CHUNK_VALIDATION_SCHEMA_VERSION
	);
}

function decodeReviewSamples(bytes: Uint8Array): NoticeReviewSample[] {
	return decodeNdjson(bytes, (value, index) => {
		if (!isRecord(value)) throw new ArtifactValidationError(`notice review sample ${index} is invalid`);
		if (
			!nonEmptyString(value.contentText) ||
			!nonEmptyString(value.noticeId) ||
			!nonEmptyString(value.title) ||
			!nonEmptyString(value.stratum) ||
			!Array.isArray(value.chunks)
		) {
			throw new ArtifactValidationError(`notice review sample ${index} is invalid`);
		}
		const chunks = value.chunks.map((chunk, chunkIndex) => {
			if (!isRecord(chunk)) {
				throw new ArtifactValidationError(`notice review sample ${index} chunk ${chunkIndex} is invalid`);
			}
			return decodeStoredChunk(chunk, `notice review sample ${index} chunk ${chunkIndex}`);
		});
		return {
			chunks,
			contentText: value.contentText,
			noticeId: value.noticeId,
			stratum: value.stratum as NoticeReviewSample["stratum"],
			title: value.title,
		};
	});
}

function decodeStoredChunk(value: Record<string, unknown>, label: string): NoticeChunk {
	for (const field of ["chunkId", "content", "noticeId", "retrievalText"] as const) {
		if (!nonEmptyString(value[field])) throw new ArtifactValidationError(`${label} has invalid ${field}`);
	}
	if (!isSha256Ref(value.chunkId) || !nonNegativeInteger(value.chunkIndex)) {
		throw new ArtifactValidationError(`${label} has invalid identity`);
	}
	if (
		!Array.isArray(value.headingPath) ||
		value.headingPath.some((heading) => !nonEmptyString(heading))
	) {
		throw new ArtifactValidationError(`${label} has invalid headingPath`);
	}
	return value as unknown as NoticeChunk;
}

function groupChunks(chunks: readonly NoticeChunk[]): Map<string, NoticeChunk[]> {
	const grouped = new Map<string, NoticeChunk[]>();
	for (const chunk of chunks) {
		const noticeChunks = grouped.get(chunk.noticeId) ?? [];
		noticeChunks.push(chunk);
		grouped.set(chunk.noticeId, noticeChunks);
	}
	for (const [noticeId, noticeChunks] of grouped) {
		noticeChunks.sort((left, right) => left.chunkIndex - right.chunkIndex);
		for (const [index, chunk] of noticeChunks.entries()) {
			if (chunk.chunkIndex !== index) {
				throw new ArtifactValidationError(`notice chunk indexes are not contiguous: ${noticeId}`);
			}
		}
	}
	return grouped;
}

async function readVerifiedFile(
	read: (file: string) => Promise<Uint8Array>,
	ref: { byteSize: number; file: string; sha256: Sha256Ref },
	label: string,
): Promise<Uint8Array> {
	const bytes = await read(ref.file);
	if (bytes.byteLength !== ref.byteSize) {
		throw new ArtifactValidationError(`${label} byte size does not match ${ref.byteSize}`);
	}
	if (sha256(bytes) !== ref.sha256) {
		throw new ArtifactValidationError(`${label} digest does not match ${ref.sha256}`);
	}
	return bytes;
}

function decodeNdjson<T>(
	bytes: Uint8Array,
	parse: (value: unknown, index: number) => T,
): T[] {
	const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	if (!text.endsWith("\n")) throw new ArtifactValidationError("notice chunk NDJSON must end with a newline");
	const lines = text.slice(0, -1).split("\n");
	if (lines.length === 0 || lines.some((line) => line === "")) {
		throw new ArtifactValidationError("notice chunk NDJSON contains an empty record");
	}
	return lines.map((line, index) => {
		try {
			return parse(JSON.parse(line) as unknown, index);
		} catch (error) {
			if (error instanceof Error && error.message.startsWith("notice ")) throw error;
			throw new ArtifactValidationError(`notice chunk NDJSON record ${index} is not valid JSON`, { cause: error });
		}
	});
}

function parseJson(bytes: Uint8Array, label: string): unknown {
	try {
		return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
	} catch (error) {
		throw new ArtifactValidationError(`${label} is not valid UTF-8 JSON`, { cause: error });
	}
}

function assertArtifactReference(value: unknown, label: string): asserts value is {
	byteSize: number;
	file: string;
	sha256: Sha256Ref;
} {
	if (
		!isRecord(value) ||
		!positiveInteger(value.byteSize) ||
		!nonEmptyString(value.file) ||
		!isSha256Ref(value.sha256)
	) {
		throw new ArtifactValidationError(`${label} reference is invalid`);
	}
}

function validChunkDefinition(value: unknown): boolean {
	return (
		isRecord(value) &&
		nonEmptyString(value.algorithm) &&
		positiveInteger(value.maxChars) &&
		nonNegativeInteger(value.overlapChars) &&
		positiveInteger(value.targetChars)
	);
}

function assertSha256Ref(value: string, label: string): asserts value is Sha256Ref {
	if (!isSha256Ref(value)) throw new ArtifactValidationError(`${label} must be sha256:<64 lowercase hex characters>`);
}

function isSha256Ref(value: unknown): value is Sha256Ref {
	return typeof value === "string" && /^sha256:[0-9a-f]{64}$/u.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function nonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.trim() !== "";
}

function positiveInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function nonNegativeInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function diagnosticCount(value: unknown, legacy: boolean, field: string): number {
	if (value === undefined && legacy) return 0;
	if (!nonNegativeInteger(value)) {
		throw new ArtifactValidationError(`notice chunk validation ${field} is invalid`);
	}
	return value;
}
