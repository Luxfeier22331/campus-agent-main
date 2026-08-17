import { readFile } from "node:fs/promises";

import type {
	DocsReaderElement,
	DocsReaderTableElement,
} from "../../../apps/campus-web/src/docs-reader-build/source-types.ts";
import {
	buildSections,
	sha256Text,
	sourceProjectionSha256,
} from "./indexing.ts";
import type {
	IndexChunk,
	IndexingSource,
	ReaderSection,
	SourceVersionSelection,
} from "./types.ts";
import { INDEX_DEFINITION } from "./types.ts";

const SHORT_CHUNK_CHAR_LIMIT = 100;
const SAMPLE_COUNT_PER_COLLECTION = 6;
const MANUAL_ACCEPTANCE_RATIO = 0.9;
const DEFAULT_QUERY_MAX_CHUNKS = 3;

export interface ChunkEvalQueryCase {
	case_id: string;
	max_chunk_count?: number;
	question: string;
	required_evidence: string[];
	target_document_id: string;
	target_root_unit_ids: string[];
}

export interface ChunkEvalReview {
	chunk_id: string;
	critical: boolean;
	notes: string;
	score: 0 | 1 | 2;
}

export interface ChunkEvalReport {
	algorithm: typeof INDEX_DEFINITION.chunking;
	collection_count: number;
	collection_stats: CollectionStats[];
	composition: ChunkComposition;
	document_count: number;
	document_stats: DocumentStats[];
	duplicate_stats: DuplicateStats;
	length_distributions: LengthDistributions;
	manual_review: ManualReviewReport;
	query_coverage: QueryCoverageReport;
	reader_element_count: number;
	section_count: number;
	section_stats: SectionStats[];
	source_digest: string;
	source_projection_sha256: string;
	sample_chunks: SampleChunk[];
	chunk_count: number;
	issues: ChunkEvalIssue[];
	passed: boolean;
	reader_version_count: number;
	schema_version: "campus_docs_chunk_eval.v1";
}

export interface ChunkComposition {
	blockquote: number;
	list: number;
	mixed: number;
	near_limit: number;
	paragraph: number;
	short: number;
	table: number;
	unknown: number;
}

export interface ChunkEvalIssue {
	chunk_id: string | null;
	code: string;
	document_id: string | null;
	message: string;
	root_unit_id: string | null;
	severity: "error" | "warning";
}

export interface CollectionStats {
	collection: string;
	corpus: string;
	document_count: number;
	list_chunk_count: number;
	short_chunk_count: number;
	table_chunk_count: number;
	chunk_count: number;
}

export interface DocumentStats {
	chunk_count: number;
	collection: string;
	corpus: string;
	doc_id: string;
	reader_element_count: number;
	section_count: number;
	title: string;
}

export interface DuplicateGroup {
	chunk_count: number;
	chunk_ids: string[];
	document_ids: string[];
	sha256: string;
}

export interface DuplicateStats {
	content_groups: DuplicateGroup[];
	retrieval_text_groups: DuplicateGroup[];
}

export interface LengthDistribution {
	count: number;
	max: number;
	min: number;
	p50: number;
	p90: number;
	p95: number;
	p99: number;
}

export interface LengthDistributions {
	content_bytes: LengthDistribution;
	content_chars: LengthDistribution;
	retrieval_text_bytes: LengthDistribution;
	retrieval_text_chars: LengthDistribution;
}

export interface ManualReviewReport {
	accepted_count: number;
	critical_count: number;
	reviewed_count: number;
	score_counts: { "0": number; "1": number; "2": number };
	status: "not_started" | "pending" | "failed" | "passed";
}

export interface QueryCoverageReport {
	case_count: number;
	covered_case_count: number;
	status: "not_started" | "failed" | "passed";
	results: QueryCoverageResult[];
}

export interface QueryCoverageResult {
	case_id: string;
	covered_evidence: string[];
	covered_root_unit_ids: string[];
	max_chunk_count: number;
	question: string;
	required_evidence: string[];
	target_chunk_ids: string[];
	target_document_id: string;
	target_root_unit_ids: string[];
	passed: boolean;
}

export interface SampleChunk {
	byte_length: number;
	char_length: number;
	chunk_id: string;
	collection: string;
	content: string;
	corpus: string;
	document_id: string;
	document_title: string;
	heading_depth: number;
	kind: ChunkKind;
	retrieval_text: string;
	root_unit_ids: string[];
	section_ref: string;
	section_title: string;
	roles: string[];
	review: ChunkEvalReview | null;
}

export interface SectionStats {
	chunk_count: number;
	document_id: string;
	heading_depth: number;
	section_id: string;
	section_title: string;
}

export type ChunkKind = "blockquote" | "list" | "mixed" | "paragraph" | "table" | "unknown";

interface ChunkContext {
	byteLength: number;
	charLength: number;
	chunk: IndexChunk;
	collection: string;
	corpus: string;
	headingDepth: number;
	kind: ChunkKind;
	retrievalTextByteLength: number;
	retrievalTextCharLength: number;
}

interface SelectionMetadata {
	document: SourceVersionSelection["document"];
	elementByRootUnitId: Map<string, DocsReaderElement>;
	ordinalByRootUnitId: Map<string, number>;
	sectionByRootUnitId: Map<string, ReaderSection>;
	sections: ReaderSection[];
	selection: SourceVersionSelection;
}

export async function readChunkEvalQueryCases(path: string): Promise<ChunkEvalQueryCase[]> {
	const value = JSON.parse(await readFile(path, "utf8")) as unknown;
	if (!isRecord(value) || !Array.isArray(value.cases)) {
		throw new Error("chunk eval query cases must contain a cases array");
	}
	const cases = value.cases.map((item, index) => parseQueryCase(item, `cases[${index}]`));
	assertUnique(cases.map((item) => item.case_id), "chunk eval case id");
	return cases;
}

export async function readChunkEvalReviews(path: string): Promise<ChunkEvalReview[]> {
	const value = JSON.parse(await readFile(path, "utf8")) as unknown;
	if (!isRecord(value) || !Array.isArray(value.reviews)) {
		throw new Error("chunk eval reviews must contain a reviews array");
	}
	const reviews = value.reviews.map((item, index) => parseReview(item, `reviews[${index}]`));
	assertUnique(reviews.map((item) => item.chunk_id), "chunk eval review chunk id");
	return reviews;
}

export function evaluateChunks(input: {
	chunks: readonly IndexChunk[];
	queryCases?: readonly ChunkEvalQueryCase[];
	reviews?: readonly ChunkEvalReview[];
	selections: readonly SourceVersionSelection[];
	source: IndexingSource;
}): ChunkEvalReport {
	const metadata = input.selections.map(buildSelectionMetadata);
	const metadataByDocument = new Map(metadata.map((item) => [item.document.docId, item]));
	const issues: ChunkEvalIssue[] = [];
	const contexts = input.chunks.map((chunk) => {
		const item = metadataByDocument.get(chunk.documentId);
		if (!item) {
			addIssue(issues, {
				chunkId: chunk.chunkId,
				code: "unknown_document",
				documentId: chunk.documentId,
				message: "chunk document is not a current source document",
				rootUnitId: null,
			});
		}
		return createChunkContext(chunk, item);
	});

	checkChunkIdentity(contexts, metadataByDocument, issues);
	checkChunkSections(contexts, metadataByDocument, issues);
	checkChunkProvenance(contexts, metadataByDocument, issues);
	checkDuplicateRetrievalText(contexts, issues);
	checkDetachedTableLeadIns(contexts, issues);
	checkSourceCoverage(metadata, contexts, issues);

	const reviewByChunkId = new Map((input.reviews ?? []).map((review) => [review.chunk_id, review]));
	const sampleChunks = selectSampleChunks(contexts).map((sample) =>
		toSampleChunk(sample, reviewByChunkId.get(sample.chunk.chunkId) ?? null),
	);
	const manualReview = evaluateManualReviews(sampleChunks, input.reviews);
	const queryCoverage = evaluateQueryCoverage(contexts, input.queryCases);
	const hardChecksPassed = !issues.some((issue) => issue.severity === "error");

	const collectionStats = buildCollectionStats(
		input.source.manifest.collections,
		input.selections,
		contexts,
	);
	return {
		algorithm: INDEX_DEFINITION.chunking,
		collection_count: collectionStats.length,
		collection_stats: collectionStats,
		composition: buildChunkComposition(contexts),
		document_count: input.selections.length,
		document_stats: buildDocumentStats(metadata, contexts),
		duplicate_stats: buildDuplicateStats(contexts),
		length_distributions: buildLengthDistributions(contexts),
		manual_review: manualReview,
		query_coverage: queryCoverage,
		reader_element_count: metadata.reduce(
			(total, item) => total + item.selection.reader.elements.length,
			0,
		),
		section_count: metadata.reduce((total, item) => total + item.sections.length, 0),
		section_stats: buildSectionStats(metadata, contexts),
		source_digest: input.source.sourceDigest,
		source_projection_sha256: sourceProjectionSha256(input.selections),
		sample_chunks: sampleChunks,
		chunk_count: input.chunks.length,
		issues,
		passed: hardChecksPassed && manualReview.status === "passed" && queryCoverage.status === "passed",
		reader_version_count: input.selections.length,
		schema_version: "campus_docs_chunk_eval.v1",
	};
}

export function renderChunkEvalMarkdown(report: ChunkEvalReport): string {
	const lines = [
		"# Campus Docs Chunk Eval",
		"",
		`- source digest: \`${report.source_digest}\``,
		`- source projection: \`${report.source_projection_sha256}\``,
		`- collections: ${report.collection_count}`,
		`- documents: ${report.document_count}`,
		`- sections: ${report.section_count}`,
		`- chunks: ${report.chunk_count}`,
		`- errors: ${report.issues.filter((issue) => issue.severity === "error").length}`,
		`- warnings: ${report.issues.filter((issue) => issue.severity === "warning").length}`,
		`- manual review: ${report.manual_review.status}`,
		`- query coverage: ${report.query_coverage.status}`,
		`- passed: ${report.passed ? "yes" : "no"}`,
		"",
		"## Collections",
		"",
		"| corpus | collection | documents | chunks | tables | lists | short |",
		"| --- | --- | ---: | ---: | ---: | ---: | ---: |",
		...report.collection_stats.map(
			(stat) =>
				`| ${stat.corpus} | ${stat.collection} | ${stat.document_count} | ${stat.chunk_count} | ${stat.table_chunk_count} | ${stat.list_chunk_count} | ${stat.short_chunk_count} |`,
		),
		"",
		"## Composition",
		"",
		`- paragraph: ${report.composition.paragraph}`,
		`- list: ${report.composition.list}`,
		`- blockquote: ${report.composition.blockquote}`,
		`- table: ${report.composition.table}`,
		`- mixed: ${report.composition.mixed}`,
		`- unknown: ${report.composition.unknown}`,
		`- shorter than ${SHORT_CHUNK_CHAR_LIMIT} chars: ${report.composition.short}`,
		`- at least ${INDEX_DEFINITION.chunking.targetChars} chars: ${report.composition.near_limit}`,
		`- duplicate content groups: ${report.duplicate_stats.content_groups.length}`,
		`- duplicate retrieval text groups: ${report.duplicate_stats.retrieval_text_groups.length}`,
		"",
		"## Lengths",
		"",
		"| metric | count | min | p50 | p90 | p95 | p99 | max |",
		"| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
		...Object.entries(report.length_distributions).map(([name, value]) =>
			`| ${name} | ${value.count} | ${value.min} | ${value.p50} | ${value.p90} | ${value.p95} | ${value.p99} | ${value.max} |`,
		),
		"",
		"## Issues",
		"",
	];
	if (report.issues.length === 0) {
		lines.push("No structural issues.");
	} else {
		lines.push(
			...report.issues.map(
				(issue) =>
					`- ${issue.severity.toUpperCase()} \`${issue.code}\` ${issue.document_id ?? ""} ${issue.chunk_id ?? ""}: ${issue.message}`,
			),
		);
	}

	lines.push(
		"",
		"## Query Coverage",
		"",
		`- status: ${report.query_coverage.status}`,
		`- covered: ${report.query_coverage.covered_case_count}/${report.query_coverage.case_count}`,
		"",
	);
	for (const result of report.query_coverage.results) {
		lines.push(
			`- ${result.passed ? "PASS" : "FAIL"} \`${result.case_id}\`: ${result.question}`,
		);
	}

	lines.push("", "## Samples", "");
	for (const sample of report.sample_chunks) {
		lines.push(
			`### ${sample.chunk_id}`,
			"",
			`- ${sample.corpus}/${sample.collection} · ${sample.document_title}`,
			`- section: ${sample.section_title}`,
			`- roles: ${sample.roles.join(", ")}`,
			`- review: ${sample.review ? `${sample.review.score}/2` : "pending"}`,
			...(sample.review ? [`- review notes: ${sample.review.notes}`] : []),
			"",
			"```text",
			sample.retrieval_text,
			"```",
			"",
		);
	}

	return `${lines.join("\n")}\n`;
}

function buildSelectionMetadata(selection: SourceVersionSelection): SelectionMetadata {
	const sections = buildSections(selection.document, selection.version, selection.reader);
	const elementByRootUnitId = new Map<string, DocsReaderElement>();
	const ordinalByRootUnitId = new Map<string, number>();
	for (const [ordinal, element] of selection.reader.elements.entries()) {
		elementByRootUnitId.set(element.rootUnitId, element);
		ordinalByRootUnitId.set(element.rootUnitId, ordinal);
	}
	const sectionByRootUnitId = new Map<string, ReaderSection>();
	for (const section of sections) {
		for (const element of section.elements) {
			sectionByRootUnitId.set(element.rootUnitId, section);
		}
	}
	return {
		document: selection.document,
		elementByRootUnitId,
		ordinalByRootUnitId,
		sectionByRootUnitId,
		sections,
		selection,
	};
}

function createChunkContext(
	chunk: IndexChunk,
	metadata: SelectionMetadata | undefined,
): ChunkContext {
	const elements = metadata
		? chunk.rootUnitIds.flatMap((rootUnitId) => {
				const element = metadata.elementByRootUnitId.get(rootUnitId);
				return element ? [element] : [];
			})
		: [];
	const kinds = new Set(elements.map((element) => element.kind));
	return {
		byteLength: Buffer.byteLength(chunk.content, "utf8"),
		charLength: [...chunk.content].length,
		chunk,
		collection: metadata?.document.collection ?? "",
		corpus: metadata?.document.corpus ?? "",
		headingDepth: metadata?.sectionByRootUnitId.get(chunk.rootUnitIds[0] ?? "")?.headingPath.length ?? 0,
		kind: chunkKind(kinds),
		retrievalTextByteLength: Buffer.byteLength(chunk.retrievalText, "utf8"),
		retrievalTextCharLength: [...chunk.retrievalText].length,
	};
}

function checkChunkIdentity(
	contexts: readonly ChunkContext[],
	metadataByDocument: ReadonlyMap<string, SelectionMetadata>,
	issues: ChunkEvalIssue[],
): void {
	const seenChunkIds = new Set<string>();
	for (const context of contexts) {
		const chunk = context.chunk;
		const metadata = metadataByDocument.get(chunk.documentId);
		if (seenChunkIds.has(chunk.chunkId)) {
			addIssue(issues, {
				chunkId: chunk.chunkId,
				code: "duplicate_chunk_id",
				documentId: chunk.documentId,
				message: "chunk id is duplicated",
				rootUnitId: null,
			});
		}
		seenChunkIds.add(chunk.chunkId);
		if (!chunk.content.trim()) {
			addIssue(issues, {
				chunkId: chunk.chunkId,
				code: "empty_chunk",
				documentId: chunk.documentId,
				message: "chunk content is empty",
				rootUnitId: null,
			});
		}
		if (chunk.rootUnitIds.length === 0) {
			addIssue(issues, {
				chunkId: chunk.chunkId,
				code: "empty_root_unit_ids",
				documentId: chunk.documentId,
				message: "chunk has no root unit ids",
				rootUnitId: null,
			});
		}
		if (metadata && chunk.versionId !== metadata.selection.version.versionId) {
			addIssue(issues, {
				chunkId: chunk.chunkId,
				code: "non_current_version",
				documentId: chunk.documentId,
				message: `chunk version ${chunk.versionId} is not current ${metadata.selection.version.versionId}`,
				rootUnitId: null,
			});
		}
	}
}

function checkChunkSections(
	contexts: readonly ChunkContext[],
	metadataByDocument: ReadonlyMap<string, SelectionMetadata>,
	issues: ChunkEvalIssue[],
): void {
	for (const context of contexts) {
		const metadata = metadataByDocument.get(context.chunk.documentId);
		if (!metadata) continue;
		const sectionIds = new Set<string>();
		const ordinals: number[] = [];
		const seenRootUnitIds = new Set<string>();
		for (const rootUnitId of context.chunk.rootUnitIds) {
			if (seenRootUnitIds.has(rootUnitId)) {
				addIssue(issues, {
					chunkId: context.chunk.chunkId,
					code: "duplicate_root_unit_id",
					documentId: context.chunk.documentId,
					message: "chunk repeats a root unit id",
					rootUnitId,
				});
			}
			seenRootUnitIds.add(rootUnitId);
			const element = metadata.elementByRootUnitId.get(rootUnitId);
			if (!element) {
				addIssue(issues, {
					chunkId: context.chunk.chunkId,
					code: "unknown_root_unit_id",
					documentId: context.chunk.documentId,
					message: "chunk root unit id is absent from the reader",
					rootUnitId,
				});
				continue;
			}
			if (element.kind === "heading") {
				addIssue(issues, {
					chunkId: context.chunk.chunkId,
					code: "heading_root_unit_id",
					documentId: context.chunk.documentId,
					message: "chunk references a heading root unit",
					rootUnitId,
				});
			}
			const section = metadata.sectionByRootUnitId.get(rootUnitId);
			if (!section) {
				addIssue(issues, {
					chunkId: context.chunk.chunkId,
					code: "unknown_section",
					documentId: context.chunk.documentId,
					message: "chunk root unit is not assigned to an indexable section",
					rootUnitId,
				});
			} else {
				sectionIds.add(section.sectionId);
			}
			const ordinal = metadata.ordinalByRootUnitId.get(rootUnitId);
			if (ordinal !== undefined) ordinals.push(ordinal);
		}
		if (sectionIds.size > 1) {
			addIssue(issues, {
				chunkId: context.chunk.chunkId,
				code: "cross_section_chunk",
				documentId: context.chunk.documentId,
				message: "chunk contains root units from multiple sections",
				rootUnitId: null,
			});
		}
		if (!isNondecreasing(ordinals)) {
			addIssue(issues, {
				chunkId: context.chunk.chunkId,
				code: "root_unit_order",
				documentId: context.chunk.documentId,
				message: "chunk root units are not in reader order",
				rootUnitId: null,
			});
		}
	}
}

function checkChunkProvenance(
	contexts: readonly ChunkContext[],
	metadataByDocument: ReadonlyMap<string, SelectionMetadata>,
	issues: ChunkEvalIssue[],
): void {
	for (const context of contexts) {
		const metadata = metadataByDocument.get(context.chunk.documentId);
		if (!metadata) continue;
		const section = metadata.sectionByRootUnitId.get(context.chunk.rootUnitIds[0] ?? "");
		if (!section) continue;
		const expected = [metadata.document.title, ...section.headingPath, context.chunk.content]
			.map(normalizeBlockText)
			.filter(Boolean)
			.join("\n");
		if (context.chunk.retrievalText !== expected) {
			addIssue(issues, {
				chunkId: context.chunk.chunkId,
				code: "retrieval_text_provenance",
				documentId: context.chunk.documentId,
				message: "retrieval text does not match document, heading path and chunk content",
				rootUnitId: null,
			});
		}
		if (context.charLength > INDEX_DEFINITION.chunking.maxChars) {
			addIssue(issues, {
				chunkId: context.chunk.chunkId,
				code: "chunk_char_limit",
				documentId: context.chunk.documentId,
				message: `chunk has ${context.charLength} Unicode characters; limit is ${INDEX_DEFINITION.chunking.maxChars}`,
				rootUnitId: null,
			});
		}
		if (context.byteLength > 16_000) {
			addIssue(issues, {
				chunkId: context.chunk.chunkId,
				code: "chunk_byte_limit",
				documentId: context.chunk.documentId,
				message: `chunk has ${context.byteLength} UTF-8 bytes; limit is 16000`,
				rootUnitId: null,
			});
		}
	}
}

function checkDuplicateRetrievalText(
	contexts: readonly ChunkContext[],
	issues: ChunkEvalIssue[],
): void {
	const groups = new Map<string, ChunkContext[]>();
	for (const context of contexts) {
		const existing = groups.get(context.chunk.retrievalText) ?? [];
		existing.push(context);
		groups.set(context.chunk.retrievalText, existing);
	}
	for (const duplicates of groups.values()) {
		if (duplicates.length < 2) continue;
		const documentIds = [...new Set(duplicates.map((item) => item.chunk.documentId))];
		addIssue(issues, {
			chunkId: null,
			code: "duplicate_retrieval_text",
			documentId: documentIds.length === 1 ? (documentIds[0] ?? null) : null,
			message: `chunks have identical retrieval text: ${duplicates.map((item) => item.chunk.chunkId).join(", ")}`,
			rootUnitId: null,
		});
	}
}

function checkDetachedTableLeadIns(
	contexts: readonly ChunkContext[],
	issues: ChunkEvalIssue[],
): void {
	for (let index = 0; index < contexts.length - 1; index += 1) {
		const leadIn = contexts[index];
		const table = contexts[index + 1];
		if (!(leadIn && table)) continue;
		if (
			leadIn.chunk.documentId !== table.chunk.documentId ||
			leadIn.chunk.sectionId !== table.chunk.sectionId ||
			table.kind !== "table" ||
			!/(?:如下|见下表|具体如下)[：:]?$/u.test(leadIn.chunk.content.trim())
		) {
			continue;
		}
		const leadInRootUnitId = leadIn.chunk.rootUnitIds.at(-1);
		if (leadInRootUnitId && table.chunk.rootUnitIds.includes(leadInRootUnitId)) {
			continue;
		}
		addIssue(issues, {
			chunkId: leadIn.chunk.chunkId,
			code: "detached_table_lead_in",
			documentId: leadIn.chunk.documentId,
			message: `table lead-in is detached from ${table.chunk.chunkId}`,
			rootUnitId: leadInRootUnitId ?? null,
		}, "warning");
	}
}

function checkSourceCoverage(
	metadata: readonly SelectionMetadata[],
	contexts: readonly ChunkContext[],
	issues: ChunkEvalIssue[],
): void {
	for (const item of metadata) {
		const documentChunks = contexts.filter(
			(context) => context.chunk.documentId === item.document.docId,
		);
		const chunksBySection = new Map<string, ChunkContext[]>();
		for (const context of documentChunks) {
			const section = item.sectionByRootUnitId.get(context.chunk.rootUnitIds[0] ?? "");
			if (!section) continue;
			const existing = chunksBySection.get(section.sectionId) ?? [];
			existing.push(context);
			chunksBySection.set(section.sectionId, existing);
		}

		for (const section of item.sections) {
			const sectionChunks = chunksBySection.get(section.sectionId) ?? [];
			const representedRootUnitIds = new Set(
				sectionChunks.flatMap((context) => context.chunk.rootUnitIds),
			);
			for (const element of section.elements) {
				if (!representedRootUnitIds.has(element.rootUnitId)) {
					addIssue(issues, {
						chunkId: null,
						code: "missing_root_unit",
						documentId: item.document.docId,
						message: "indexable reader element is absent from all chunks",
						rootUnitId: element.rootUnitId,
					});
				}
			}

			for (const element of section.elements) {
				if (element.kind === "table") continue;
				const expectedText = canonicalCoverage(element.text);
				const evidence = sectionChunks.filter((context) =>
					context.chunk.rootUnitIds.includes(element.rootUnitId),
				);
				const directlyCovered = evidence.some((context) =>
					canonicalCoverage(context.chunk.content).includes(expectedText),
				);
				const aggregateCoverage = canonicalCoverage(
					evidence.map((context) => context.chunk.content).join(""),
				);
				if (!directlyCovered && !aggregateCoverage.includes(expectedText)) {
					addIssue(issues, {
						chunkId: null,
						code: "text_coverage",
						documentId: item.document.docId,
						message: "reader text is absent from chunks",
						rootUnitId: element.rootUnitId,
					});
				}
			}

			for (const element of section.elements) {
				if (element.kind !== "table") continue;
				checkTableCoverage(element, sectionChunks, item.document.docId, issues);
			}
		}
	}
}

function checkTableCoverage(
	table: DocsReaderTableElement,
	sectionChunks: readonly ChunkContext[],
	documentId: string,
	issues: ChunkEvalIssue[],
): void {
	const chunks = sectionChunks.filter((context) => context.chunk.rootUnitIds.includes(table.rootUnitId));
	const content = canonicalCoverage(chunks.map((context) => context.chunk.content).join(""));
	for (const row of table.rows) {
		for (const cell of row) {
			const expected = canonicalCoverage(cell.text);
			if (expected && !content.includes(expected)) {
				addIssue(issues, {
					chunkId: null,
					code: "table_cell_coverage",
					documentId,
					message: `table cell text is absent from serialized table ${table.rootUnitId}`,
					rootUnitId: table.rootUnitId,
				});
			}
		}
	}
}

function selectSampleChunks(contexts: readonly ChunkContext[]): Array<ChunkContext & { roles: string[] }> {
	const byCollection = new Map<string, ChunkContext[]>();
	for (const context of contexts) {
		const key = `${context.corpus}/${context.collection}`;
		const existing = byCollection.get(key) ?? [];
		existing.push(context);
		byCollection.set(key, existing);
	}
	const samples: Array<ChunkContext & { roles: string[] }> = [];
	for (const collection of [...byCollection.keys()].sort()) {
		const candidates = [...(byCollection.get(collection) ?? [])].sort((left, right) =>
			left.chunk.chunkId.localeCompare(right.chunk.chunkId),
		);
		const selected = new Map<string, string[]>();
		const roles: Array<[string, (context: ChunkContext) => boolean, (left: ChunkContext, right: ChunkContext) => number]> = [
			["shortest", () => true, (left, right) => left.charLength - right.charLength],
			["longest", () => true, (left, right) => right.charLength - left.charLength],
			["table", (context) => context.kind === "table", stableOrder],
			["list", (context) => context.kind === "list", stableOrder],
			["deepest_heading", () => true, (left, right) => right.headingDepth - left.headingDepth],
			["stable_sample", () => true, stableOrder],
		];
		for (const [role, predicate, compare] of roles) {
			const candidate = candidates
				.filter((item) => predicate(item) && !selected.has(item.chunk.chunkId))
				.sort(compare)[0];
			if (!candidate) continue;
			selected.set(candidate.chunk.chunkId, [role]);
		}
		for (const candidate of candidates) {
			if (selected.size >= SAMPLE_COUNT_PER_COLLECTION) break;
			if (!selected.has(candidate.chunk.chunkId)) selected.set(candidate.chunk.chunkId, ["fallback"]);
		}
		for (const [chunkId, selectedRoles] of selected) {
			const context = candidates.find((item) => item.chunk.chunkId === chunkId);
			if (context) samples.push({ ...context, roles: selectedRoles });
		}
	}
	return samples;
}

function toSampleChunk(
	context: ChunkContext & { roles: string[] },
	review: ChunkEvalReview | null,
): SampleChunk {
	return {
		byte_length: context.byteLength,
		char_length: context.charLength,
		chunk_id: context.chunk.chunkId,
		collection: context.collection,
		content: context.chunk.content,
		corpus: context.corpus,
		document_id: context.chunk.documentId,
		document_title: context.chunk.documentTitle,
		heading_depth: context.headingDepth,
		kind: context.kind,
		retrieval_text: context.chunk.retrievalText,
		root_unit_ids: context.chunk.rootUnitIds,
		section_ref: context.chunk.sectionRef,
		section_title: context.chunk.sectionTitle,
		roles: context.roles,
		review,
	};
}

function evaluateManualReviews(
	samples: readonly SampleChunk[],
	reviews: readonly ChunkEvalReview[] | undefined,
): ManualReviewReport {
	if (!reviews) {
		return {
			accepted_count: 0,
			critical_count: 0,
			reviewed_count: 0,
			score_counts: { "0": 0, "1": 0, "2": 0 },
			status: "not_started",
		};
	}
	const sampleIds = new Set(samples.map((sample) => sample.chunk_id));
	const seen = new Set<string>();
	let criticalCount = 0;
	let acceptedCount = 0;
	const scoreCounts = { "0": 0, "1": 0, "2": 0 };
	for (const review of reviews) {
		if (seen.has(review.chunk_id) || !sampleIds.has(review.chunk_id)) continue;
		seen.add(review.chunk_id);
		scoreCounts[String(review.score) as "0" | "1" | "2"] += 1;
		if (review.score >= 1) acceptedCount += 1;
		if (review.critical) criticalCount += 1;
	}
	const reviewedCount = seen.size;
	const complete = reviewedCount === samples.length;
	const passed =
		complete &&
		criticalCount === 0 &&
		scoreCounts["0"] === 0 &&
		acceptedCount >= Math.ceil(samples.length * MANUAL_ACCEPTANCE_RATIO);
	return {
		accepted_count: acceptedCount,
		critical_count: criticalCount,
		reviewed_count: reviewedCount,
		score_counts: scoreCounts,
		status: !complete ? "pending" : passed ? "passed" : "failed",
	};
}

function evaluateQueryCoverage(
	contexts: readonly ChunkContext[],
	queryCases: readonly ChunkEvalQueryCase[] | undefined,
): QueryCoverageReport {
	if (!queryCases) {
		return { case_count: 0, covered_case_count: 0, results: [], status: "not_started" };
	}
	const results = queryCases.map((queryCase) => {
		const candidateChunks = contexts.filter(
			(context) =>
				context.chunk.documentId === queryCase.target_document_id &&
				context.chunk.rootUnitIds.some((rootUnitId) =>
					queryCase.target_root_unit_ids.includes(rootUnitId),
			),
		);
		const coveredEvidence = queryCase.required_evidence.filter((evidence) =>
			candidateChunks.some((context) => includesEvidence(context.chunk.retrievalText, evidence)),
		);
		const coveredRootUnitIds = queryCase.target_root_unit_ids.filter((rootUnitId) =>
			candidateChunks.some((context) => context.chunk.rootUnitIds.includes(rootUnitId)),
		);
		const maxChunkCount = queryCase.max_chunk_count ?? DEFAULT_QUERY_MAX_CHUNKS;
		const cover = findEvidenceCover(candidateChunks, queryCase, maxChunkCount);
		return {
			case_id: queryCase.case_id,
			covered_evidence: coveredEvidence,
			covered_root_unit_ids: coveredRootUnitIds,
			max_chunk_count: maxChunkCount,
			question: queryCase.question,
			required_evidence: queryCase.required_evidence,
			target_chunk_ids: cover?.map((context) => context.chunk.chunkId) ?? [],
			target_document_id: queryCase.target_document_id,
			target_root_unit_ids: queryCase.target_root_unit_ids,
			passed: cover !== null,
		};
	});
	const coveredCaseCount = results.filter((result) => result.passed).length;
	return {
		case_count: results.length,
		covered_case_count: coveredCaseCount,
		results,
		status: results.length > 0 && coveredCaseCount === results.length ? "passed" : "failed",
	};
}

function findEvidenceCover(
	candidates: readonly ChunkContext[],
	queryCase: ChunkEvalQueryCase,
	maxChunkCount: number,
): ChunkContext[] | null {
	const requirementCount = queryCase.required_evidence.length + queryCase.target_root_unit_ids.length;
	const required = new Set(Array.from({ length: requirementCount }, (_, index) => index));
	const coverage = candidates.map((context) => {
		const covered = new Set<number>();
		for (const [index, evidence] of queryCase.required_evidence.entries()) {
			if (includesEvidence(context.chunk.retrievalText, evidence)) covered.add(index);
		}
		for (const [index, rootUnitId] of queryCase.target_root_unit_ids.entries()) {
			if (context.chunk.rootUnitIds.includes(rootUnitId)) {
				covered.add(queryCase.required_evidence.length + index);
			}
		}
		return { context, covered };
	}).filter((item) => item.covered.size > 0);
	for (let count = 1; count <= maxChunkCount; count += 1) {
		const result = findCoverCombination(coverage, required, count, 0, [], new Set());
		if (result) return result.map((item) => item.context);
	}
	return null;
}

function findCoverCombination(
	candidates: ReadonlyArray<{ context: ChunkContext; covered: ReadonlySet<number> }>,
	required: ReadonlySet<number>,
	targetCount: number,
	start: number,
	selected: Array<{ context: ChunkContext; covered: ReadonlySet<number> }>,
	covered: ReadonlySet<number>,
): Array<{ context: ChunkContext; covered: ReadonlySet<number> }> | null {
	if (required.size === covered.size && [...required].every((item) => covered.has(item))) {
		return selected;
	}
	if (selected.length === targetCount) return null;
	for (let index = start; index < candidates.length; index += 1) {
		const candidate = candidates[index];
		if (!candidate) continue;
		const nextCovered = new Set(covered);
		for (const item of candidate.covered) nextCovered.add(item);
		const result = findCoverCombination(
			candidates,
			required,
			targetCount,
			index + 1,
			[...selected, candidate],
			nextCovered,
		);
		if (result) return result;
	}
	return null;
}

function includesEvidence(text: string, evidence: string): boolean {
	return canonicalCoverage(text).includes(canonicalCoverage(evidence));
}

function buildLengthDistributions(contexts: readonly ChunkContext[]): LengthDistributions {
	return {
		content_bytes: distribution(contexts.map((context) => context.byteLength)),
		content_chars: distribution(contexts.map((context) => context.charLength)),
		retrieval_text_bytes: distribution(
			contexts.map((context) => context.retrievalTextByteLength),
		),
		retrieval_text_chars: distribution(
			contexts.map((context) => context.retrievalTextCharLength),
		),
	};
}

function buildCollectionStats(
	collections: readonly IndexingSource["manifest"]["collections"][number][],
	selections: readonly SourceVersionSelection[],
	contexts: readonly ChunkContext[],
): CollectionStats[] {
	const result = new Map<string, CollectionStats>();
	for (const collection of collections) {
		result.set(`${collection.corpus}/${collection.collection}`, {
			collection: collection.collection,
			corpus: collection.corpus,
			document_count: 0,
			list_chunk_count: 0,
			short_chunk_count: 0,
			table_chunk_count: 0,
			chunk_count: 0,
		});
	}
	for (const selection of selections) {
		const key = `${selection.document.corpus}/${selection.document.collection}`;
		if (!result.has(key)) {
			result.set(key, {
				collection: selection.document.collection,
				corpus: selection.document.corpus,
				document_count: 0,
				list_chunk_count: 0,
				short_chunk_count: 0,
				table_chunk_count: 0,
				chunk_count: 0,
			});
		}
		const stat = result.get(key);
		if (stat) stat.document_count += 1;
	}
	for (const context of contexts) {
		const stat = result.get(`${context.corpus}/${context.collection}`);
		if (!stat) continue;
		stat.chunk_count += 1;
		if (context.kind === "list") stat.list_chunk_count += 1;
		if (context.kind === "table") stat.table_chunk_count += 1;
		if (context.charLength < SHORT_CHUNK_CHAR_LIMIT) stat.short_chunk_count += 1;
	}
	return [...result.values()].sort(compareCollectionStats);
}

function buildChunkComposition(contexts: readonly ChunkContext[]): ChunkComposition {
	const result: ChunkComposition = {
		blockquote: 0,
		list: 0,
		mixed: 0,
		near_limit: 0,
		paragraph: 0,
		short: 0,
		table: 0,
		unknown: 0,
	};
	for (const context of contexts) {
		result[context.kind] += 1;
		if (context.charLength < SHORT_CHUNK_CHAR_LIMIT) result.short += 1;
		if (context.charLength >= INDEX_DEFINITION.chunking.targetChars) result.near_limit += 1;
	}
	return result;
}

function buildDuplicateStats(contexts: readonly ChunkContext[]): DuplicateStats {
	return {
		content_groups: duplicateGroups(contexts, (context) => context.chunk.content),
		retrieval_text_groups: duplicateGroups(
			contexts,
			(context) => context.chunk.retrievalText,
		),
	};
}

function duplicateGroups(
	contexts: readonly ChunkContext[],
	value: (context: ChunkContext) => string,
): DuplicateGroup[] {
	const groups = new Map<string, ChunkContext[]>();
	for (const context of contexts) {
		const text = value(context);
		const existing = groups.get(text) ?? [];
		existing.push(context);
		groups.set(text, existing);
	}
	return [...groups]
		.filter(([, items]) => items.length > 1)
		.map(([text, items]) => ({
			chunk_count: items.length,
			chunk_ids: items.map((item) => item.chunk.chunkId).sort(),
			document_ids: [...new Set(items.map((item) => item.chunk.documentId))].sort(),
			sha256: sha256Text(text),
		}))
		.sort((left, right) => left.sha256.localeCompare(right.sha256));
}

function buildSectionStats(
	metadata: readonly SelectionMetadata[],
	contexts: readonly ChunkContext[],
): SectionStats[] {
	return metadata
		.flatMap((item) =>
			item.sections.map((section) => ({
				chunk_count: contexts.filter(
					(context) => context.chunk.sectionId === section.sectionId,
				).length,
				document_id: item.document.docId,
				heading_depth: section.headingPath.length,
				section_id: section.sectionId,
				section_title: section.sectionTitle,
			})),
		)
		.sort((left, right) => left.section_id.localeCompare(right.section_id));
}

function buildDocumentStats(
	metadata: readonly SelectionMetadata[],
	contexts: readonly ChunkContext[],
): DocumentStats[] {
	return metadata
		.map((item) => ({
			chunk_count: contexts.filter((context) => context.chunk.documentId === item.document.docId).length,
			collection: item.document.collection,
			corpus: item.document.corpus,
			doc_id: item.document.docId,
			reader_element_count: item.selection.reader.elements.length,
			section_count: item.sections.length,
			title: item.document.title,
		}))
		.sort((left, right) => left.doc_id.localeCompare(right.doc_id));
}

function distribution(values: readonly number[]): LengthDistribution {
	if (values.length === 0) {
		return { count: 0, max: 0, min: 0, p50: 0, p90: 0, p95: 0, p99: 0 };
	}
	const sorted = [...values].sort((left, right) => left - right);
	return {
		count: sorted.length,
		max: sorted.at(-1) ?? 0,
		min: sorted[0] ?? 0,
		p50: percentile(sorted, 0.5),
		p90: percentile(sorted, 0.9),
		p95: percentile(sorted, 0.95),
		p99: percentile(sorted, 0.99),
	};
}

function percentile(sorted: readonly number[], fraction: number): number {
	const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1));
	return sorted[index] ?? 0;
}

function chunkKind(kinds: ReadonlySet<DocsReaderElement["kind"]>): ChunkKind {
	if (kinds.size === 0) return "unknown";
	if (kinds.has("table")) return "table";
	if (kinds.size > 1) return "mixed";
	const [kind] = [...kinds];
	return !kind || kind === "heading" ? "unknown" : kind;
}

function canonicalCoverage(value: string): string {
	return value.replaceAll("\r\n", "\n").replaceAll("\r", "\n").replace(/\s+/gu, "");
}

function normalizeBlockText(value: string): string {
	return value.replaceAll("\r\n", "\n").replaceAll("\r", "\n").trim();
}

function isNondecreasing(values: readonly number[]): boolean {
	return values.every((value, index) => index === 0 || value >= (values[index - 1] ?? value));
}

function stableOrder(left: ChunkContext, right: ChunkContext): number {
	return left.chunk.chunkId.localeCompare(right.chunk.chunkId);
}

function compareCollectionStats(left: CollectionStats, right: CollectionStats): number {
	return `${left.corpus}/${left.collection}`.localeCompare(`${right.corpus}/${right.collection}`);
}

function addIssue(
	issues: ChunkEvalIssue[],
	issue: {
		chunkId: string | null;
		code: string;
		documentId: string | null;
		message: string;
		rootUnitId: string | null;
	},
	severity: ChunkEvalIssue["severity"] = "error",
): void {
	issues.push({
		chunk_id: issue.chunkId,
		code: issue.code,
		document_id: issue.documentId,
		message: issue.message,
		root_unit_id: issue.rootUnitId,
		severity,
	});
}

function parseQueryCase(value: unknown, label: string): ChunkEvalQueryCase {
	if (!isRecord(value)) throw new Error(`${label} must be an object`);
	const caseId = value.case_id;
	const maxChunkCount = value.max_chunk_count;
	const question = value.question;
	const requiredEvidence = value.required_evidence;
	const targetDocumentId = value.target_document_id;
	const targetRootUnitIds = value.target_root_unit_ids;
	if (
		typeof caseId !== "string" ||
		!caseId.trim() ||
		typeof question !== "string" ||
		!question.trim() ||
		!Array.isArray(requiredEvidence) ||
		requiredEvidence.length === 0 ||
		requiredEvidence.some((item) => typeof item !== "string" || !item.trim()) ||
		typeof targetDocumentId !== "string" ||
		!targetDocumentId.trim() ||
		!Array.isArray(targetRootUnitIds) ||
		targetRootUnitIds.length === 0 ||
		targetRootUnitIds.some((item) => typeof item !== "string" || !item.trim()) ||
		(maxChunkCount !== undefined &&
			(typeof maxChunkCount !== "number" || !Number.isSafeInteger(maxChunkCount) || maxChunkCount < 1))
	) {
		throw new Error(`${label} is invalid`);
	}
	return {
		case_id: caseId,
		...(maxChunkCount === undefined ? {} : { max_chunk_count: maxChunkCount }),
		question,
		required_evidence: requiredEvidence as string[],
		target_document_id: targetDocumentId,
		target_root_unit_ids: targetRootUnitIds as string[],
	};
}

function parseReview(value: unknown, label: string): ChunkEvalReview {
	if (!isRecord(value)) throw new Error(`${label} must be an object`);
	const chunkId = value.chunk_id;
	const critical = value.critical;
	const notes = value.notes;
	const score = value.score;
	if (
		typeof chunkId !== "string" ||
		!chunkId.trim() ||
		typeof critical !== "boolean" ||
		typeof notes !== "string" ||
		typeof score !== "number" ||
		!Number.isSafeInteger(score) ||
		score < 0 ||
		score > 2
	) {
		throw new Error(`${label} is invalid`);
	}
	return {
		chunk_id: chunkId,
		critical,
		notes,
		score: score as 0 | 1 | 2,
	};
}

function assertUnique(values: readonly string[], label: string): void {
	if (new Set(values).size !== values.length) throw new Error(`${label} is duplicated`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
