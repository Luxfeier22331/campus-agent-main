import type {
	OfficialWebContentBlockRow,
	OfficialWebDiscoveredLinkRecord,
	OfficialWebPageManifest,
	OfficialWebProviderPageExtraction,
} from "./core/index.ts";

export interface CollectorArtifactFile {
	relativePath: string;
	objectKey: string;
	contentType: string;
	data: Uint8Array;
	recordCount?: number;
}

export interface CollectedPageArtifact {
	rawAssetId: string;
	rawVersionId: string;
	pageManifest: OfficialWebPageManifest;
	contentBlocks: OfficialWebContentBlockRow[];
	discoveredLinks: OfficialWebDiscoveredLinkRecord[];
	providerExtraction: OfficialWebProviderPageExtraction;
	files: CollectorArtifactFile[];
}
