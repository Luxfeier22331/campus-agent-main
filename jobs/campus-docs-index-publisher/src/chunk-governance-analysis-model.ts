import type { DocsReaderElement } from "campus-contracts/campus-docs";
import type {
	CampusDocsChunkCensus,
	CampusDocsReviewCandidate,
	CampusDocsReviewDocument,
	CampusDocsReviewItem,
	CampusDocsReviewItemSummary,
	CampusDocsSectionCensus,
} from "./chunk-governance-types.ts";
import type { ReaderSection, SourceVersionSelection } from "./types.ts";

export interface SelectionMetadata {
	document: SourceVersionSelection["document"];
	elementByRootUnitId: Map<string, DocsReaderElement>;
	sectionById: Map<string, ReaderSection>;
	sections: ReaderSection[];
	version: SourceVersionSelection["version"];
}

export interface DocumentAnalysis {
	document: SourceVersionSelection["document"];
	metadata: SelectionMetadata;
	review: CampusDocsReviewDocument;
	sections: CampusDocsSectionCensus[];
	candidates: CampusDocsReviewCandidate[];
}

export interface CorpusAnalysis {
	census: CampusDocsChunkCensus;
	documents: DocumentAnalysis[];
	candidates: CampusDocsReviewCandidate[];
	reviewItems: CampusDocsReviewItem[];
	reviewItemSummary: CampusDocsReviewItemSummary;
	sample: CampusDocsReviewDocument[];
	sampleSummary: Record<string, unknown>;
}
