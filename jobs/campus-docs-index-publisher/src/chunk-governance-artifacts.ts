import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
	chunkSetManifestKey,
	decodeChunkNDJSON,
	encodeNDJSON,
} from "./artifacts.ts";
import {
	CAMPUS_DOCS_CHUNK_CENSUS_SCHEMA_VERSION,
	CAMPUS_DOCS_CHUNK_GOVERNANCE_SCHEMA_VERSION,
} from "./chunk-governance-definitions.ts";
import type {
	CampusDocsChunkCensus,
	CampusDocsChunkGovernanceRunData,
	CampusDocsChunkGovernanceRunManifest,
	CampusDocsGovernanceChunkSetData,
	CampusDocsGovernanceChunkSetManifest,
	CampusDocsReviewCandidate,
	CampusDocsReviewDocument,
	CampusDocsReviewItem,
	CampusDocsReviewItemSummary,
	GovernanceArtifactReference,
} from "./chunk-governance-types.ts";
import {
	sha256,
} from "../../../apps/campus-web/src/docs-reader-build/source-catalog.ts";
import { sha256Text } from "./indexing/content-digest.ts";
import type { ArtifactObjectStore, Sha256Ref } from "./types.ts";

export const CAMPUS_DOCS_CHUNK_GOVERNANCE_ROOT = "campus-docs/chunk-governance";

export async function readGovernanceChunkSet(
	store: ArtifactObjectStore,
	id: Sha256Ref,
): Promise<CampusDocsGovernanceChunkSetData> {
	const manifestBytes = await store.read(chunkSetManifestKey(id));
	if (sha256(manifestBytes) !== id) {
		throw new Error(`Campus docs chunk set manifest digest does not match ${id}`);
	}
	const manifest = parseGovernanceChunkSetManifest(parseJson(manifestBytes, "Campus docs chunk set manifest"));
	const chunkBytes = await store.read(manifest.chunks.key);
	if (chunkBytes.byteLength !== manifest.chunks.byteSize) {
		throw new Error("Campus docs chunk data byte size does not match the manifest");
	}
	if (sha256(chunkBytes) !== manifest.chunks.sha256) {
		throw new Error("Campus docs chunk data digest does not match the manifest");
	}
	const chunks = decodeChunkNDJSON(chunkBytes);
	if (chunks.length !== manifest.chunkCount) {
		throw new Error(`Campus docs chunk data count = ${chunks.length}, want ${manifest.chunkCount}`);
	}
	const documentCount = new Set(chunks.map((chunk) => chunk.documentId)).size;
	if (documentCount !== manifest.documentCount) {
		throw new Error(`Campus docs chunk document count = ${documentCount}, want ${manifest.documentCount}`);
	}
	for (const chunk of chunks) {
		if (chunk.retrievalTextSha256 !== sha256Text(chunk.retrievalText)) {
			throw new Error(`Campus docs chunk retrieval text digest is invalid: ${chunk.chunkId}`);
		}
	}
	return { chunks, id, manifest };
}

export function reference(
	file: string,
	bytes: Uint8Array,
): GovernanceArtifactReference {
	return { byteSize: bytes.byteLength, file, sha256: sha256(bytes) };
}

export function encodeGovernanceNdjson(records: readonly unknown[]): Uint8Array {
	if (records.length === 0) return new TextEncoder().encode("");
	return encodeNDJSON(records);
}

export function decodeGovernanceNdjson(bytes: Uint8Array): unknown[] {
	const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	if (text === "") return [];
	if (!text.endsWith("\n")) throw new Error("Campus docs governance NDJSON must end with a newline");
	const lines = text.slice(0, -1).split("\n");
	if (lines.some((line) => line === "")) {
		throw new Error("Campus docs governance NDJSON contains an empty record");
	}
	return lines.map((line) => JSON.parse(line) as unknown);
}

export async function readVerifiedGovernanceFile(
	directory: string,
	referenceValue: GovernanceArtifactReference,
	label: string,
): Promise<Uint8Array> {
	const bytes = new Uint8Array(await readFile(join(directory, referenceValue.file)));
	if (bytes.byteLength !== referenceValue.byteSize) {
		throw new Error(`${label} byte size does not match`);
	}
	if (sha256(bytes) !== referenceValue.sha256) {
		throw new Error(`${label} digest does not match`);
	}
	return bytes;
}

export async function writeImmutableGovernanceFile(
	path: string,
	bytes: Uint8Array,
): Promise<void> {
	try {
		await writeFile(path, bytes, { flag: "wx" });
		return;
	} catch (error) {
		if (!isFileExistsError(error)) throw error;
	}
	const existing = new Uint8Array(await readFile(path));
	if (!Buffer.from(existing).equals(Buffer.from(bytes))) {
		throw new Error(`Campus docs governance artifact conflicts: ${path}`);
	}
}

export function artifactHex(value: Sha256Ref): string {
	return value.slice("sha256:".length);
}
export async function readCampusDocsChunkGovernanceRun(
	artifactRoot: string,
	run: Sha256Ref,
): Promise<CampusDocsChunkGovernanceRunData> {
	const directory = join(
		artifactRoot,
		CAMPUS_DOCS_CHUNK_GOVERNANCE_ROOT,
		"reviews",
		"sha256",
		artifactHex(run),
	);
	const manifestBytes = new Uint8Array(await readFile(join(directory, "manifest.json")));
	if (sha256(manifestBytes) !== run) {
		throw new Error(`Campus docs chunk governance manifest digest does not match ${run}`);
	}
	const manifest = parseGovernanceManifest(JSON.parse(new TextDecoder().decode(manifestBytes)) as unknown);
	const [censusBytes, sampleBytes, candidatesBytes, reviewItemsBytes, reviewItemSummaryBytes] =
		await Promise.all([
			readVerifiedGovernanceFile(directory, manifest.census, "Campus docs chunk governance census"),
			readVerifiedGovernanceFile(directory, manifest.sample, "Campus docs chunk governance sample"),
			readVerifiedGovernanceFile(directory, manifest.candidates, "Campus docs chunk governance candidates"),
			readVerifiedGovernanceFile(directory, manifest.reviewItems, "Campus docs chunk governance review items"),
			readVerifiedGovernanceFile(
				directory,
				manifest.reviewItemSummary,
				"Campus docs chunk governance review item summary",
			),
		]);
	return {
		candidates: decodeGovernanceNdjson(candidatesBytes) as CampusDocsReviewCandidate[],
		census: parseCensus(JSON.parse(new TextDecoder().decode(censusBytes)) as unknown),
		manifest,
		reviewItems: decodeGovernanceNdjson(reviewItemsBytes) as CampusDocsReviewItem[],
		reviewItemSummary: JSON.parse(
			new TextDecoder().decode(reviewItemSummaryBytes),
		) as CampusDocsReviewItemSummary,
		sample: decodeGovernanceNdjson(sampleBytes) as CampusDocsReviewDocument[],
		run,
	};
}

export function parseGovernanceManifest(
	value: unknown,
): CampusDocsChunkGovernanceRunManifest {
	if (!isRecord(value) || value.schemaVersion !== CAMPUS_DOCS_CHUNK_GOVERNANCE_SCHEMA_VERSION) {
		throw new Error("Campus docs chunk governance manifest schema is invalid");
	}
	if (
		!isSha256Ref(value.chunkSet) ||
		!isSha256Ref(value.sourceProjectionSha256) ||
		(value.embeddingEvaluation !== undefined && !isSha256Ref(value.embeddingEvaluation)) ||
		!positiveInteger(value.reviewItemCount) ||
		!positiveInteger(value.sampleCount)
	) {
		throw new Error("Campus docs chunk governance manifest definition is invalid");
	}
	for (const [field, label] of [
		["candidates", "governance candidates"],
		["census", "governance census"],
		["reviewItems", "governance review items"],
		["reviewItemSummary", "governance review item summary"],
		["sample", "governance sample"],
		["sampleSummary", "governance sample summary"],
	] as const) {
		assertArtifactReference(value[field], label);
	}
	return value as unknown as CampusDocsChunkGovernanceRunManifest;
}

export function parseCensus(value: unknown): CampusDocsChunkCensus {
	if (!isRecord(value) || value.schemaVersion !== CAMPUS_DOCS_CHUNK_CENSUS_SCHEMA_VERSION) {
		throw new Error("Campus docs chunk census schema is invalid");
	}
	return value as unknown as CampusDocsChunkCensus;
}


function parseGovernanceChunkSetManifest(
	value: unknown,
): CampusDocsGovernanceChunkSetManifest {
	if (!isRecord(value) || value.schemaVersion !== "campus_docs_chunk_set.v2") {
		throw new Error("Campus docs governance chunk set manifest schema is invalid");
	}
	if (
		!positiveInteger(value.chunkCount) ||
		!positiveInteger(value.documentCount) ||
		!nonEmptyString(value.readerSchemaVersion) ||
		!nonEmptyString(value.sourceSchemaVersion) ||
		!isSha256Ref(value.sourceProjectionSha256) ||
		!isRecord(value.chunkDefinition) ||
		!nonEmptyString(value.chunkDefinition.algorithm) ||
		!positiveInteger(value.chunkDefinition.maxChars) ||
		!nonNegativeInteger(value.chunkDefinition.overlapChars) ||
		!positiveInteger(value.chunkDefinition.targetChars) ||
		value.chunkDefinition.targetChars > value.chunkDefinition.maxChars ||
		!isObjectRef(value.chunks)
	) {
		throw new Error("Campus docs governance chunk set manifest definition is invalid");
	}
	return value as unknown as CampusDocsGovernanceChunkSetManifest;
}

function isObjectRef(value: unknown): boolean {
	return (
		isRecord(value) &&
		positiveInteger(value.byteSize) &&
		nonEmptyString(value.key) &&
		isSha256Ref(value.sha256)
	);
}

function parseJson(bytes: Uint8Array, label: string): unknown {
	try {
		return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
	} catch (error) {
		throw new Error(`${label} is not valid UTF-8 JSON`, { cause: error });
	}
}

function assertArtifactReference(
	value: unknown,
	label: string,
): asserts value is GovernanceArtifactReference {
	if (
		!isRecord(value) ||
		!positiveInteger(value.byteSize) ||
		typeof value.file !== "string" ||
		!value.file ||
		!isSha256Ref(value.sha256)
	) {
		throw new Error(`${label} reference is invalid`);
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isSha256Ref(value: unknown): value is Sha256Ref {
	return typeof value === "string" && /^sha256:[0-9a-f]{64}$/u.test(value);
}

function nonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.trim() !== "";
}

function nonNegativeInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function positiveInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isFileExistsError(error: unknown): error is NodeJS.ErrnoException {
	return error instanceof Error && "code" in error && error.code === "EEXIST";
}
