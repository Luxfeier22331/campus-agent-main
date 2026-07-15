import type { OfficialWebCrawlPlan } from "./core/index.ts";

export interface OfficialWebCrawlCandidate {
	cadenceClass: string;
	configuredSeedUrl?: string | null;
	consumerFamily: string;
	contentType: string | null;
	discoveredFromUrl: string | null;
	discoveryMethod:
		| "seed"
		| "robots_sitemap"
		| "configured_sitemap"
		| "navigation"
		| "manual_requeue";
	etag: string | null;
	fetchProfile: string;
	host: string;
	hostPolicy: { host: string; sourceHost: string };
	inventoryOnly: boolean;
	lastChangeReason: string;
	lastChangedAt: string | null;
	lastFetchDisposition: "fetched" | "not_modified" | "deleted" | "fetch_failed" | "never_fetched";
	lastHttpStatus: number | null;
	lastModified: string | null;
	lastNotModifiedAt: string | null;
	lastSeenAt: string;
	lastSuccessfulRunId: string | null;
	mainContentHash: string | null;
	materializationPolicy: string;
	nextEligibleFetchAt: string;
	normalizedCanonicalUrl: string;
	pageFamily: string;
	pageTitleNormalized: string;
	priorityScore: number;
	responseBodyHash: string | null;
	retentionPolicy: string;
	reviewPolicy: string;
	selectedWriteTarget: string;
	siteId: string;
	targetCandidateId: string | null;
	targetDeclarationVersion: string;
	targetId: string;
	targetJobId: string;
	worksetReason: string;
}

export function buildConfiguredSeedCandidates(
	plan: OfficialWebCrawlPlan,
): OfficialWebCrawlCandidate[] {
	return plan.seeds.map((seed, index) => ({
		cadenceClass: "configured",
		configuredSeedUrl: seed.url,
		consumerFamily: "source_inventory",
		contentType: null,
		discoveredFromUrl: null,
		discoveryMethod: "seed",
		etag: null,
		fetchProfile: "default",
		host: seed.host,
		hostPolicy: { host: seed.host, sourceHost: seed.host },
		inventoryOnly: true,
		lastChangeReason: "configured_seed",
		lastChangedAt: null,
		lastFetchDisposition: "never_fetched",
		lastHttpStatus: null,
		lastModified: null,
		lastNotModifiedAt: null,
		lastSeenAt: plan.generatedAt,
		lastSuccessfulRunId: null,
		mainContentHash: null,
		materializationPolicy: "inventory_only",
		nextEligibleFetchAt: plan.generatedAt,
		normalizedCanonicalUrl: seed.url,
		pageFamily: "unknown",
		pageTitleNormalized: "",
		priorityScore: plan.seeds.length - index,
		responseBodyHash: null,
		retentionPolicy: "retain_source_truth",
		reviewPolicy: "manual",
		selectedWriteTarget: "",
		siteId: plan.siteId,
		targetCandidateId: null,
		targetDeclarationVersion: plan.configVersion,
		targetId: `source:${seed.seedId}`,
		targetJobId: `source:${seed.seedId}`,
		worksetReason: "configured_seed",
	}));
}
