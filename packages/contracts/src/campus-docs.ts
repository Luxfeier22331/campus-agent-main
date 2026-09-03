export {
	assertReaderExtractionQuality,
	isStandaloneFormalDocumentNumber,
	isStandaloneSourceUrlMarker,
} from "./campus-docs-quality.ts";
export { parseDocsReaderContract } from "./campus-docs-reader.ts";
export type {
	CleanReaderSegmentationResult,
	ReaderSegmentationChange,
	ReaderSegmentationChangeKind,
	ReaderSegmentationUnresolvedBlock,
} from "./campus-docs-segmentation.ts";
export {
	assertReaderSegmentationQuality,
	cleanReaderSegmentation,
	matchHighConfidenceSegmentation,
} from "./campus-docs-segmentation.ts";
export {
	analyzeDocsTableLayout,
	assertDocsTableLayout,
} from "./campus-docs-table.ts";
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
} from "./campus-docs-types.ts";
export { DOCS_SOURCE_KEY } from "./campus-docs-types.ts";
export {
	compareDocsVersionSlugs,
	formatDocsVersionLabel,
	parseDocsVersionOrder,
} from "./campus-docs-version.ts";
