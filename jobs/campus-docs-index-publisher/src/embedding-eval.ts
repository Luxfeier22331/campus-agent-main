import { includesEvidence, type ChunkEvalQueryCase } from "./chunk-eval.ts";
import { COLLECTION_DEFINITION, EMBEDDING_SPACE } from "./definitions.ts";
import { embedTexts } from "./embedding.ts";
import { sha256Text } from "./indexing.ts";
import type {
	EmbeddingClient,
	Sha256Ref,
	StoredChunk,
	StoredEmbedding,
} from "./types.ts";

const DEFAULT_QUERY_MAX_CHUNKS = 3;

export interface EmbeddingEvalMetrics {
	evidence_coverage_at_k: number;
	first_relevant_mrr: number;
	root_unit_recall_at_k: number;
}

export interface EmbeddingEvalResult extends EmbeddingEvalMetrics {
	case_id: string;
	covered_evidence: string[];
	covered_root_unit_ids: string[];
	first_relevant_rank: number | null;
	k: number;
	question: string;
	top_chunks: Array<{
		chunk_id: string;
		document_id: string;
		rank: number;
		root_unit_ids: string[];
		score: number;
	}>;
}

export interface EmbeddingEvalReport {
	case_count: number;
	chunk_count: number;
	chunk_set: Sha256Ref;
	embedding_count: number;
	embedding_set: Sha256Ref;
	embedding_space: typeof EMBEDDING_SPACE;
	metrics: EmbeddingEvalMetrics;
	query_instruction: typeof COLLECTION_DEFINITION.dense.queryInstruction;
	results: EmbeddingEvalResult[];
	schema_version: "campus_docs_embedding_eval.v1";
}

export async function evaluateEmbeddingSet(input: {
	chunkSet: Sha256Ref;
	chunks: readonly StoredChunk[];
	embedding: EmbeddingClient;
	embeddingSet: Sha256Ref;
	embeddings: readonly StoredEmbedding[];
	queryCases: readonly ChunkEvalQueryCase[];
}): Promise<EmbeddingEvalReport> {
	if (input.queryCases.length === 0) {
		throw new Error("embedding eval requires at least one query case");
	}
	const queryVectors = await embedTexts(
		input.embedding,
		input.queryCases.map((queryCase) => buildDenseQueryText(queryCase.question)),
	);
	return evaluateDenseRanking({ ...input, queryVectors });
}

export function evaluateDenseRanking(input: {
	chunkSet: Sha256Ref;
	chunks: readonly StoredChunk[];
	embeddingSet: Sha256Ref;
	embeddings: readonly StoredEmbedding[];
	queryCases: readonly ChunkEvalQueryCase[];
	queryVectors: readonly number[][];
}): EmbeddingEvalReport {
	if (input.queryCases.length === 0) {
		throw new Error("embedding eval requires at least one query case");
	}
	if (input.queryVectors.length !== input.queryCases.length) {
		throw new Error("embedding eval query vector count does not match query cases");
	}
	const denseByRetrievalText = loadDenseVectors(input.chunks, input.embeddings);
	const results = input.queryCases.map((queryCase, index) => {
		const queryVector = input.queryVectors[index];
		if (!queryVector) throw new Error(`embedding eval query vector is missing: ${queryCase.case_id}`);
		assertVector(queryVector, `embedding eval query ${queryCase.case_id}`);
		const ranked = input.chunks
			.map((chunk) => {
				const dense = denseByRetrievalText.get(chunk.retrievalTextSha256);
				if (!dense) throw new Error(`embedding data is missing chunk ${chunk.chunkId}`);
				return { chunk, score: cosineSimilarity(queryVector, dense) };
			})
			.sort((left, right) => right.score - left.score || left.chunk.chunkId.localeCompare(right.chunk.chunkId));
		const k = queryCase.max_chunk_count ?? DEFAULT_QUERY_MAX_CHUNKS;
		const top = ranked.slice(0, k);
		const coveredRootUnitIds = queryCase.target_root_unit_ids.filter((rootUnitId) =>
			top.some(
				(item) =>
					item.chunk.documentId === queryCase.target_document_id &&
					item.chunk.rootUnitIds.includes(rootUnitId),
			),
		);
		const coveredEvidence = queryCase.required_evidence.filter((evidence) =>
			top.some((item) => includesEvidence(item.chunk.retrievalText, evidence)),
		);
		const firstRelevantIndex = ranked.findIndex(
			(item) =>
				item.chunk.documentId === queryCase.target_document_id &&
				item.chunk.rootUnitIds.some((rootUnitId) =>
					queryCase.target_root_unit_ids.includes(rootUnitId),
				),
		);
		const firstRelevantRank = firstRelevantIndex < 0 ? null : firstRelevantIndex + 1;
		return {
			case_id: queryCase.case_id,
			covered_evidence: coveredEvidence,
			covered_root_unit_ids: coveredRootUnitIds,
			evidence_coverage_at_k: coveredEvidence.length / queryCase.required_evidence.length,
			first_relevant_mrr: firstRelevantRank === null ? 0 : 1 / firstRelevantRank,
			first_relevant_rank: firstRelevantRank,
			k,
			question: queryCase.question,
			root_unit_recall_at_k: coveredRootUnitIds.length / queryCase.target_root_unit_ids.length,
			top_chunks: top.map((item, rank) => ({
				chunk_id: item.chunk.chunkId,
				document_id: item.chunk.documentId,
				rank: rank + 1,
				root_unit_ids: item.chunk.rootUnitIds,
				score: item.score,
			})),
		};
	});
	return {
		case_count: results.length,
		chunk_count: input.chunks.length,
		chunk_set: input.chunkSet,
		embedding_count: input.embeddings.length,
		embedding_set: input.embeddingSet,
		embedding_space: EMBEDDING_SPACE,
		metrics: {
			evidence_coverage_at_k: average(results.map((result) => result.evidence_coverage_at_k)),
			first_relevant_mrr: average(results.map((result) => result.first_relevant_mrr)),
			root_unit_recall_at_k: average(results.map((result) => result.root_unit_recall_at_k)),
		},
		query_instruction: COLLECTION_DEFINITION.dense.queryInstruction,
		results,
		schema_version: "campus_docs_embedding_eval.v1",
	};
}

export function buildDenseQueryText(queryText: string): string {
	return `Instruct: ${COLLECTION_DEFINITION.dense.queryInstruction}\nQuery:${queryText.trim()}`;
}

export function renderEmbeddingEvalMarkdown(report: EmbeddingEvalReport): string {
	const lines = [
		"# Campus Docs Embedding Eval",
		"",
		`- embedding set: \`${report.embedding_set}\``,
		`- chunk set: \`${report.chunk_set}\``,
		`- chunks: ${report.chunk_count}`,
		`- cases: ${report.case_count}`,
		`- root unit recall@K: ${formatMetric(report.metrics.root_unit_recall_at_k)}`,
		`- evidence coverage@K: ${formatMetric(report.metrics.evidence_coverage_at_k)}`,
		`- first relevant MRR: ${formatMetric(report.metrics.first_relevant_mrr)}`,
		"",
		"## Cases",
		"",
		"| case | K | root recall | evidence coverage | first rank | reciprocal rank |",
		"| --- | ---: | ---: | ---: | ---: | ---: |",
		...report.results.map(
			(result) =>
				`| ${result.case_id} | ${result.k} | ${formatMetric(result.root_unit_recall_at_k)} | ${formatMetric(result.evidence_coverage_at_k)} | ${result.first_relevant_rank ?? "-"} | ${formatMetric(result.first_relevant_mrr)} |`,
		),
		"",
	];
	return `${lines.join("\n")}\n`;
}

function loadDenseVectors(
	chunks: readonly StoredChunk[],
	embeddings: readonly StoredEmbedding[],
): Map<Sha256Ref, number[]> {
	const expected = new Set<Sha256Ref>();
	for (const chunk of chunks) {
		if (sha256Text(chunk.retrievalText) !== chunk.retrievalTextSha256) {
			throw new Error(`chunk retrieval text digest does not match: ${chunk.chunkId}`);
		}
		expected.add(chunk.retrievalTextSha256);
	}
	const result = new Map<Sha256Ref, number[]>();
	for (const embedding of embeddings) {
		if (result.has(embedding.retrievalTextSha256)) {
			throw new Error(`embedding data repeats retrieval text: ${embedding.retrievalTextSha256}`);
		}
		assertVector(embedding.dense, `embedding ${embedding.retrievalTextSha256}`);
		result.set(embedding.retrievalTextSha256, embedding.dense);
	}
	if (result.size !== expected.size) {
		throw new Error("embedding data count does not match unique chunk retrieval texts");
	}
	for (const digest of result.keys()) {
		if (!expected.has(digest)) {
			throw new Error(`embedding data contains unexpected retrieval text: ${digest}`);
		}
	}
	return result;
}

function assertVector(vector: readonly number[], label: string): void {
	if (
		vector.length !== EMBEDDING_SPACE.dimensions ||
		vector.some((value) => !Number.isFinite(value))
	) {
		throw new Error(`${label} vector is invalid`);
	}
}

function cosineSimilarity(left: readonly number[], right: readonly number[]): number {
	let dot = 0;
	let leftNorm = 0;
	let rightNorm = 0;
	for (let index = 0; index < left.length; index += 1) {
		const leftValue = left[index] as number;
		const rightValue = right[index] as number;
		dot += leftValue * rightValue;
		leftNorm += leftValue * leftValue;
		rightNorm += rightValue * rightValue;
	}
	if (leftNorm === 0 || rightNorm === 0) {
		throw new Error("embedding eval cannot rank a zero vector");
	}
	return dot / Math.sqrt(leftNorm * rightNorm);
}

function average(values: readonly number[]): number {
	return values.reduce((total, value) => total + value, 0) / values.length;
}

function formatMetric(value: number): string {
	return value.toFixed(3);
}
