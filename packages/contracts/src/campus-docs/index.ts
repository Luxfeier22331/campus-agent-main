export { DOCS_SOURCE_KEY } from "./constants.ts";
export {
	assertReaderExtractionQuality,
	isStandaloneFormalDocumentNumber,
	isStandaloneSourceUrlMarker,
} from "./quality.ts";
export { parseDocsReaderContract } from "./reader.ts";
export type {
	CleanReaderSegmentationResult,
	ReaderSegmentationChange,
	ReaderSegmentationChangeKind,
	ReaderSegmentationUnresolvedBlock,
} from "./segmentation.ts";
export {
	assertReaderSegmentationQuality,
	cleanReaderSegmentation,
	matchHighConfidenceSegmentation,
} from "./segmentation.ts";
export {
	analyzeDocsTableLayout,
	assertDocsTableLayout,
} from "./table.ts";
export type {
	DocsCollection,
	DocsCourseMap,
	DocsCourseMaps,
	DocsDocument,
	DocsReader,
	DocsReaderElement,
	DocsReaderHeadingElement,
	DocsReaderTableCell,
	DocsReaderTableElement,
	DocsReaderTextElement,
	DocsRedirect,
	DocsSourceManifest,
	DocsSourceVersion,
	DocsSupplement,
	DocsSupplementAsset,
	DocsTopic,
	ObjectRef,
} from "./types.ts";
export {
	compareDocsVersionSlugs,
	formatDocsVersionLabel,
	parseDocsVersionOrder,
} from "./version.ts";
