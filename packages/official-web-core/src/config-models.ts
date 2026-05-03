export const OFFICIAL_WEB_SOURCE_CHANNEL = "official_web";
export const ALLOWED_PUBLIC_KINDS = [
	"content_site",
	"directory_site",
	"portal",
	"app_shell",
] as const;
export const ENABLED_PUBLIC_KINDS = ["content_site", "directory_site"] as const;
export const OFFICIAL_WEB_HOST_GROUPS = [
	"university_core",
	"university_support",
	"college",
	"topic",
	"excluded",
] as const;
export const ALLOWED_CREDENTIALS_MODES = ["public", "authenticated"] as const;
export const ALLOWED_DISCOVERY_METHODS = [
	"seed",
	"robots_sitemap",
	"configured_sitemap",
	"navigation",
	"manual_requeue",
] as const;
export const OFFICIAL_WEB_RUN_INTENTS = ["baseline", "hot", "repair"] as const;
export const OFFICIAL_WEB_PROJECTION_ACTIONS = ["emit_document", "manual_review"] as const;
export const OFFICIAL_WEB_CONSUMER_FAMILIES = [
	"contact_directory_candidate",
	"service_guide_candidate",
	"stable_reference_candidate",
	"notice_news_candidate",
] as const;
export const OFFICIAL_WEB_CONSUMER_MATERIALIZATION_POLICIES = [
	"candidate_only",
	"release_gate_required",
	"inventory_only",
] as const;
export const OFFICIAL_WEB_TARGET_RETENTION_POLICIES = [
	"retain_source_truth",
	"inventory_only",
] as const;
export const OFFICIAL_WEB_CONSUMER_REQUIRED_EVIDENCE = [
	"phone",
	"email",
	"location",
	"office_hours",
	"service_process",
	"service_entry",
	"service_material",
	"stable_reference",
	"notice_news",
] as const;
export const OFFICIAL_WEB_CONSUMER_REJECTED_POLICIES = ["reject"] as const;
export const OFFICIAL_WEB_CONSUMER_ENFORCEMENT_MODES = [
	"audit_only",
	"retain_matching_only",
] as const;
export const OFFICIAL_WEB_SOURCE_PACK_CONTENT_FAMILIES = [
	"campus_service_guide",
	"service_contact_directory",
	"institutional_policy_reference",
	"university_core_reference",
	"public_fee_reference",
	"service_material_reference",
	"public_notice_news",
] as const;
export const OFFICIAL_WEB_SOURCE_PACK_SOURCE_KINDS = [
	"html_page",
	"html_table_page",
	"download_reference_page",
	"dynamic_shell_excluded",
	"file_asset_reference_only",
] as const;
export const OFFICIAL_WEB_SOURCE_PACK_CAPTURE_POLICIES = ["one_time"] as const;
export const OFFICIAL_WEB_SOURCE_PACK_REFRESH_POSTURES = ["manifest_refresh_only"] as const;
export const OFFICIAL_WEB_SOURCE_PACK_EXTRACTION_GATES = ["deterministic_source_backed"] as const;
export const OFFICIAL_WEB_SOURCE_PACK_OWNER_SURFACES = [
	"service_guide_lookup",
	"contact_directory_lookup",
	"official_web/stable_reference",
	"future_notice_runtime",
	"regulations/institutional_rules",
	"regulations/scoped_rules",
] as const;
export const OFFICIAL_WEB_SOURCE_PACK_RELEASE_TARGETS = [
	"campus_services/service_guide",
	"campus_services/contact_directory",
	"official_web/stable_reference",
	"official_web/fresh_news",
	"official_web/news_archive",
	"regulations/institutional_rules",
	"regulations/scoped_rules",
] as const;
export const OFFICIAL_WEB_SOURCE_PACK_EXPECTED_FACTS = [
	"service_process",
	"service_entry",
	"service_material",
	"phone",
	"email",
	"location",
	"office_hours",
	"stable_reference",
	"notice_news",
] as const;
export const OFFICIAL_WEB_DECLARABLE_PAGE_FAMILIES = [
	"article_detail",
	"listing_page",
	"directory_page",
	"sitemap_navigation_page",
	"data_table_page",
	"gallery_page",
	"contact_widget_page",
	"structural_shell_page",
	"dynamic_shell_page",
	"generic_content_page",
] as const;
export const OFFICIAL_WEB_SHELL_PAGE_FAMILIES = [
	"structural_shell_page",
	"dynamic_shell_page",
] as const;

export type OfficialWebPublicKind = (typeof ALLOWED_PUBLIC_KINDS)[number];
export type OfficialWebHostGroup = (typeof OFFICIAL_WEB_HOST_GROUPS)[number];
export type OfficialWebCredentialsMode = (typeof ALLOWED_CREDENTIALS_MODES)[number];
export type OfficialWebDiscoveryMethod = (typeof ALLOWED_DISCOVERY_METHODS)[number];
export type OfficialWebRunIntent = (typeof OFFICIAL_WEB_RUN_INTENTS)[number];
export type OfficialWebProjectionAction = (typeof OFFICIAL_WEB_PROJECTION_ACTIONS)[number];
export type OfficialWebConsumerFamily = (typeof OFFICIAL_WEB_CONSUMER_FAMILIES)[number];
export type OfficialWebConsumerMaterializationPolicy =
	(typeof OFFICIAL_WEB_CONSUMER_MATERIALIZATION_POLICIES)[number];
export type OfficialWebTargetRetentionPolicy =
	(typeof OFFICIAL_WEB_TARGET_RETENTION_POLICIES)[number];
export type OfficialWebConsumerRequiredEvidence =
	(typeof OFFICIAL_WEB_CONSUMER_REQUIRED_EVIDENCE)[number];
export type OfficialWebConsumerRejectedPolicy =
	(typeof OFFICIAL_WEB_CONSUMER_REJECTED_POLICIES)[number];
export type OfficialWebConsumerEnforcementMode =
	(typeof OFFICIAL_WEB_CONSUMER_ENFORCEMENT_MODES)[number];
export type OfficialWebDeclarablePageFamily =
	(typeof OFFICIAL_WEB_DECLARABLE_PAGE_FAMILIES)[number];
export type OfficialWebSourcePackContentFamily =
	(typeof OFFICIAL_WEB_SOURCE_PACK_CONTENT_FAMILIES)[number];
export type OfficialWebSourcePackSourceKind =
	(typeof OFFICIAL_WEB_SOURCE_PACK_SOURCE_KINDS)[number];
export type OfficialWebSourcePackCapturePolicy =
	(typeof OFFICIAL_WEB_SOURCE_PACK_CAPTURE_POLICIES)[number];
export type OfficialWebSourcePackRefreshPosture =
	(typeof OFFICIAL_WEB_SOURCE_PACK_REFRESH_POSTURES)[number];
export type OfficialWebSourcePackExtractionGate =
	(typeof OFFICIAL_WEB_SOURCE_PACK_EXTRACTION_GATES)[number];
export type OfficialWebSourcePackOwnerSurface =
	(typeof OFFICIAL_WEB_SOURCE_PACK_OWNER_SURFACES)[number];
export type OfficialWebSourcePackReleaseTarget =
	(typeof OFFICIAL_WEB_SOURCE_PACK_RELEASE_TARGETS)[number];
export type OfficialWebSourcePackExpectedFact =
	(typeof OFFICIAL_WEB_SOURCE_PACK_EXPECTED_FACTS)[number];

export interface OfficialWebSiteConfig {
	schemaVersion: string;
	configVersion: string;
	siteId: string;
	displayName: string;
	sourceChannel: string;
	entryHost: string;
	allowedHosts: string[];
	seedSetVersion: string;
	hostPolicyVersion: string;
	crawlPolicyVersion: string;
	projectionPolicyVersion: string;
	credentialsMode: OfficialWebCredentialsMode;
	userAgent: string;
	requestTimeoutMs: number;
	requestHandlerTimeoutMs: number;
	maxRequestRetries: number;
	maxRedirectHops: number;
}

export interface OfficialWebHostPolicy {
	host: string;
	publicKind: OfficialWebPublicKind;
	hostGroup: OfficialWebHostGroup;
	ownerLabel: string;
	rolloutOrder: number;
	enabled: boolean;
	seedUrls: string[];
	allowedPathPrefixes: string[];
	deniedPathPatterns: string[];
	queryParamAllowlist: string[];
	maxDepth: number;
	maxPagesPerRun: number;
	maxConcurrency: number;
	minDelayMs: number;
	respectRobots: boolean;
	explicitSitemaps: string[];
	dynamicShellDiscovery: OfficialWebDynamicShellDiscoveryPolicy | null;
}

export interface OfficialWebDynamicShellDiscoveryPolicy {
	enabled: boolean;
	engine: "playwright";
	waitAfterLoadMs: number;
	networkObservationTimeoutMs: number;
	maxPromotedUrls: number;
	allowedRequestUrlPatterns: string[];
	ignoredRequestUrlPatterns: string[];
	promotedUrlPatterns: string[];
	waitForResponseUrlPatterns: string[];
	waitForSelectorPatterns: string[];
}

export interface OfficialWebHostPolicyDocument {
	schemaVersion: string;
	siteId: string;
	hostPolicyVersion: string;
	hosts: OfficialWebHostPolicy[];
}

export interface OfficialWebSeed {
	seedId: string;
	url: string;
	host: string;
	reason: string;
	discoveryMethod: OfficialWebDiscoveryMethod;
}

export interface OfficialWebSeedSet {
	schemaVersion: string;
	siteId: string;
	seedSetVersion: string;
	seeds: OfficialWebSeed[];
}

export interface OfficialWebCrawlPolicy {
	schemaVersion: string;
	siteId: string;
	crawlPolicyVersion: string;
	schemeAllowlist: string[];
	contentTypeAllowlist: string[];
	discoveryOrder: OfficialWebDiscoveryMethod[];
	defaultQueryPolicy: string;
	defaultQueryParamAllowlist: string[];
	defaultDeniedPathPatterns: string[];
	frontierIdentityKey: string;
	expandWithinSameHostnameOnly: boolean;
	crossHostExpansionRequiresAllowlist: boolean;
	allowCrossHostRedirectOnlyIfAllowlisted: boolean;
	respectRobotsByDefault: boolean;
	robots4xxBehavior: string;
	robots429Behavior: string;
	robots5xxBehavior: string;
	recordRedirectChain: boolean;
	useConditionalFetch: boolean;
	maxTotalPagesPerRun: number;
	maxTotalFailuresPerRun: number;
	maxRuntimeMinutes: number;
}

export interface OfficialWebCredentialsSchema {
	schemaVersion: string;
	siteId: string;
	credentialsMode: OfficialWebCredentialsMode;
	title: string;
	description: string;
	type: string;
	additionalProperties: boolean;
	properties: Record<string, unknown>;
	required: string[];
}

export interface OfficialWebProjectionDeclaration {
	declarationId: string;
	pageFamily: OfficialWebDeclarablePageFamily;
	targetCorpus: string;
	targetCollection: string;
	projectionFamily: string;
	documentKind: string;
	action: OfficialWebProjectionAction;
}

export interface OfficialWebProjectionDeclarations {
	schemaVersion: string;
	siteId: string;
	projectionPolicyVersion: string;
	declarations: OfficialWebProjectionDeclaration[];
}

export interface OfficialWebConsumerFamilyRule {
	consumerFamily: OfficialWebConsumerFamily;
	ownerSurface: string;
	ownerAgentOrRuntime: string;
	materializationPolicy: OfficialWebConsumerMaterializationPolicy;
	pageFamilies: OfficialWebDeclarablePageFamily[];
	titleKeywords: string[];
	pathPatterns: string[];
	requiredEvidence: OfficialWebConsumerRequiredEvidence[];
	optionalEvidence: OfficialWebConsumerRequiredEvidence[];
	minimumMatchedEvidenceCount: number;
	requiresKeywordOrPathMatch: boolean;
	negativePatterns: string[];
	selectedWriteTarget: string;
	reviewPolicy: string;
}

export interface OfficialWebConsumerDenominator {
	schemaVersion: string;
	siteId: string;
	denominatorVersion: string;
	enforcementMode: OfficialWebConsumerEnforcementMode;
	defaultRejectedPolicy: OfficialWebConsumerRejectedPolicy;
	consumerFamilies: OfficialWebConsumerFamilyRule[];
	reportingCounters: string[];
}

export interface OfficialWebTargetSourceMapTarget {
	targetId: string;
	consumerFamily: OfficialWebConsumerFamily;
	ownerSurface: string;
	selectedWriteTarget: string;
	sourceHosts: string[];
	urlHints: string[];
	titleHints: string[];
	requiredEvidence: OfficialWebConsumerRequiredEvidence[];
	optionalEvidence: OfficialWebConsumerRequiredEvidence[];
	retentionPolicy: OfficialWebTargetRetentionPolicy;
	reviewPolicy: string;
	materializationPolicy: OfficialWebConsumerMaterializationPolicy;
	inventoryOnly: boolean;
	notes: string;
}

export interface OfficialWebTargetSourceMap {
	schemaVersion: string;
	siteId: string;
	mapVersion: string;
	targets: OfficialWebTargetSourceMapTarget[];
}

export interface OfficialWebTargetInventoryEntry {
	admissionTargetId: string;
	consumerFamily: OfficialWebConsumerFamily;
	inventoryId: string;
	inventoryOnly: boolean;
	materializationPolicy: OfficialWebConsumerMaterializationPolicy;
	notes: string;
	ownerAgentOrRuntime: string;
	ownerSurface: string;
	previewStatus: string;
	releaseBlockers: string[];
	requiredEvidence: OfficialWebConsumerRequiredEvidence[];
	optionalEvidence: OfficialWebConsumerRequiredEvidence[];
	requiredFields: string[];
	optionalFields: string[];
	selectedWriteTarget: string;
	sourceHosts: string[];
	sourceUrls: string[];
	targetLabel: string;
}

export interface OfficialWebTargetInventory {
	entries: OfficialWebTargetInventoryEntry[];
	inventoryVersion: string;
	schemaVersion: string;
	siteId: string;
}

export interface OfficialWebSourcePackManifestEntry {
	entryId: string;
	url: string;
	contentFamily: OfficialWebSourcePackContentFamily;
	sourceKind: OfficialWebSourcePackSourceKind;
	answerBearing: boolean;
	demandIds: string[];
	ownerSurfaces: OfficialWebSourcePackOwnerSurface[];
	releaseTargets: OfficialWebSourcePackReleaseTarget[];
	expectedFacts: OfficialWebSourcePackExpectedFact[];
	compositionGroup: string | null;
	compositionRole: string | null;
	capturePolicy: OfficialWebSourcePackCapturePolicy;
	refreshPosture: OfficialWebSourcePackRefreshPosture;
	extractionGate: OfficialWebSourcePackExtractionGate;
	evalQuestions: string[];
}

export interface OfficialWebSourcePackManifest {
	entries: OfficialWebSourcePackManifestEntry[];
	schemaVersion: string;
	siteId: string;
	sourcePackId: string;
}

export interface OfficialWebQcHostOverride {
	host: string;
	allowedReviewIssueCodes: string[];
	allowedReviewPageFamilies: OfficialWebDeclarablePageFamily[];
}

export interface OfficialWebQcPolicy {
	schemaVersion: string;
	siteId: string;
	qcPolicyVersion: string;
	allowedReviewIssueCodes: string[];
	allowedReviewPageFamilies: OfficialWebDeclarablePageFamily[];
	hostOverrides: OfficialWebQcHostOverride[];
}

export interface OfficialWebSchedulerLanePolicy {
	laneId: string;
	enabled: boolean;
	hostFilter: string[];
	maxPagesPerHost: number;
	maxTotalPages: number;
	notes: string;
	runIntent: OfficialWebRunIntent;
	cadenceMinutes: number;
}

export interface OfficialWebSchedulerPolicy {
	schemaVersion: string;
	siteId: string;
	schedulerPolicyVersion: string;
	timezone: string;
	lanes: OfficialWebSchedulerLanePolicy[];
}

export interface OfficialWebConfigPaths {
	siteId: string;
	siteRoot: string;
	sitePath: string;
	hostsPath: string;
	seedsPath: string;
	crawlPolicyPath: string;
	credentialsSchemaPath: string;
	projectionDeclarationsPath: string;
	consumerDenominatorPath: string;
	targetSourceMapPath: string;
	targetInventoryPath: string;
	sourcePackManifestPath: string;
	schedulerPolicyPath: string;
	qcPolicyPath: string;
}

export interface OfficialWebConfigBundle {
	paths: OfficialWebConfigPaths;
	site: OfficialWebSiteConfig;
	hosts: OfficialWebHostPolicyDocument;
	seeds: OfficialWebSeedSet;
	crawlPolicy: OfficialWebCrawlPolicy;
	credentialsSchema: OfficialWebCredentialsSchema;
	projectionDeclarations: OfficialWebProjectionDeclarations;
	consumerDenominator: OfficialWebConsumerDenominator;
	targetSourceMap: OfficialWebTargetSourceMap;
	targetInventory: OfficialWebTargetInventory;
	sourcePackManifest: OfficialWebSourcePackManifest;
	schedulerPolicy: OfficialWebSchedulerPolicy;
	qcPolicy: OfficialWebQcPolicy;
}

export interface OfficialWebPlannedHost {
	host: string;
	publicKind: OfficialWebPublicKind;
	hostGroup: OfficialWebHostGroup;
	ownerLabel: string;
	rolloutOrder: number;
	maxDepth: number;
	maxPagesPerRun: number;
	maxConcurrency: number;
	minDelayMs: number;
}

export interface OfficialWebPlannedSeed {
	seedId: string;
	url: string;
	host: string;
	reason: string;
}

export interface OfficialWebCrawlPlan {
	siteId: string;
	crawlRunId: string;
	runIntent: OfficialWebRunIntent;
	generatedAt: string;
	configVersion: string;
	hostPolicyVersion: string;
	crawlPolicyVersion: string;
	schedulerPolicyVersion: string;
	seedSetVersion: string;
	credentialsMode: OfficialWebCredentialsMode;
	entryHost: string;
	enabledHosts: OfficialWebPlannedHost[];
	seeds: OfficialWebPlannedSeed[];
	discoveryOrder: OfficialWebDiscoveryMethod[];
	runLimits: {
		maxTotalPagesPerRun: number;
		maxTotalFailuresPerRun: number;
		maxRuntimeMinutes: number;
	};
	requiredArtifacts: string[];
}

export interface OfficialWebSchedulerPlan {
	generatedAt: string;
	schedulerPolicyVersion: string;
	siteId: string;
	timezone: string;
	lanes: Array<
		OfficialWebSchedulerLanePolicy & {
			schedulerRunKeyPattern: string;
			siteId: string;
		}
	>;
}
