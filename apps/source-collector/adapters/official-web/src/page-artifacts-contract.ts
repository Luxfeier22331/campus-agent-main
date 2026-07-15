import type {
	OfficialWebConsumerMatch,
	OfficialWebConsumerMaterializationPolicy,
	OfficialWebContentBlockRow,
	OfficialWebCredentialsMode,
	OfficialWebDiscoveredLinkRecord,
	OfficialWebDiscoveryMethod,
	OfficialWebPageManifest,
	OfficialWebPageTargetMatch,
	OfficialWebProviderPageExtraction,
} from "./core/index.ts";

export interface CollectedPageObservation {
	contentType: string;
	crawlPolicyVersion: string;
	credentialsMode: OfficialWebCredentialsMode;
	declaredCanonicalUrl: string | null;
	discoveredFromUrl: string | null;
	discoveryMethod: OfficialWebDiscoveryMethod;
	etag: string | null;
	fetchedAt: string;
	finalUrl: string;
	hostPolicyVersion: string;
	httpStatus: number;
	lastModified: string | null;
	redirectChain: string[];
	requestedUrl: string;
}

export interface CollectedPageTargeting {
	compositionGroup?: string | null;
	compositionRole?: string | null;
	consumerDenominatorVersion: string;
	consumerMatches: OfficialWebConsumerMatch[];
	consumerRejectionReason: string | null;
	consumerRetentionDecision?: "retain_source_truth" | "discovery_only" | "reject";
	materializationPolicy?: OfficialWebConsumerMaterializationPolicy;
	reviewPolicy?: string;
	selectedWriteTarget?: string;
	sourcePackEntryId?: string | null;
	sourcePackId?: string | null;
	targetCandidateId?: string | null;
	targetDeclarationVersion?: string;
	targetJobId?: string;
	targetMatches: OfficialWebPageTargetMatch[];
}

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
	observation: CollectedPageObservation;
	providerExtraction: OfficialWebProviderPageExtraction;
	targeting: CollectedPageTargeting;
	files: CollectorArtifactFile[];
}
