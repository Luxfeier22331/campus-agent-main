import type {
	OfficialWebFailureRecord,
	OfficialWebHostSummaryRecord,
	OfficialWebPageObservationRecord,
	OfficialWebPageTargetMatch,
	OfficialWebUrlResultRecord,
} from "./core/index.ts";
import type { OfficialWebCrawlCandidate as OfficialWebPlannerPageCandidate } from "./crawl-candidates.ts";
import type { OfficialWebDynamicShellDiscoveryAudit } from "./dynamic-shell-discovery.ts";
import type { CollectedPageArtifact } from "./page-artifacts.ts";

export interface CollectorSourcePackLineageOverride {
	compositionGroup: string | null;
	compositionRole: string | null;
	sourcePackEntryId: string;
	sourcePackId: string;
}

export interface CollectorRequestUserData {
	configuredSeedUrl?: string | null;
	discoveryMethod:
		| "seed"
		| "robots_sitemap"
		| "configured_sitemap"
		| "navigation"
		| "manual_requeue";
	conditionalHeaders?: {
		ifModifiedSince?: string;
		ifNoneMatch?: string;
	};
	discoveredFromUrl: string | null;
	depth: number;
	knownPage?: OfficialWebPlannerPageCandidate;
	knownPages?: OfficialWebPlannerPageCandidate[];
	inheritedTargetLineages?: OfficialWebPageTargetMatch[];
}

export interface CollectorAggregatedResults {
	hostSummaries: OfficialWebHostSummaryRecord[];
	pageObservations?: OfficialWebPageObservationRecord[];
	urlResults: OfficialWebUrlResultRecord[];
	failures: OfficialWebFailureRecord[];
	pages: CollectedPageArtifact[];
	dynamicShellDiscoveryAudits?: OfficialWebDynamicShellDiscoveryAudit[];
}

export interface CollectorProgressCounts {
	[key: string]: number;
	urlsDiscovered: number;
	urlsFetched: number;
	pagesNormalized: number;
	artifactUploads: number;
	failures: number;
}

export interface CollectorHostCrawlResult extends CollectorAggregatedResults {
	completed: boolean;
}
