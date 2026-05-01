import type { RobotsTxtFile } from "crawlee";
import type { OfficialWebPlannerPageCandidate } from "./control-plane.ts";
import type { OfficialWebDynamicShellDiscoveryAudit } from "./dynamic-shell-discovery.ts";
import type {
	OfficialWebFailureRecord,
	OfficialWebHostSummaryRecord,
	OfficialWebPageObservationRecord,
	OfficialWebUrlResultRecord,
} from "./official-web-core.ts";
import type { CollectedPageArtifact } from "./page-artifacts.ts";

export interface CollectorRequestUserData {
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

export interface CollectorRobotsState {
	robots: RobotsTxtFile | null;
	sitemaps: string[];
	blocked: boolean;
	failure: OfficialWebFailureRecord | null;
}

export interface CollectorHostCrawlResult extends CollectorAggregatedResults {
	completed: boolean;
}
