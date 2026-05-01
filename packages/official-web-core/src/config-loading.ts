import type { OfficialWebConfigBundle, OfficialWebDiscoveryMethod } from "./config-models.ts";
import {
	asArray,
	asConsumerEnforcementMode,
	asConsumerFamily,
	asConsumerMaterializationPolicy,
	asConsumerRejectedPolicy,
	asConsumerRequiredEvidence,
	asCredentialsMode,
	asDiscoveryMethod,
	asDynamicShellDiscoveryPolicy,
	asHostGroup,
	asNonNegativeInt,
	asPathSegment,
	asPositiveInt,
	asProjectionAction,
	asProjectionPageFamily,
	asPublicKind,
	asRecord,
	asRunIntent,
	asString,
	asStringArray,
	readJson,
} from "./config-parsing.ts";
import { resolveOfficialWebConfigPaths } from "./config-paths.ts";
import { validateOfficialWebConfig } from "./config-validation.ts";

export function loadOfficialWebConfig(
	siteId: string,
	options: { repoRoot?: string; configRoot?: string } = {},
): OfficialWebConfigBundle {
	const paths = resolveOfficialWebConfigPaths(siteId, options);
	const sitePayload = readJson(paths.sitePath);
	const hostsPayload = readJson(paths.hostsPath);
	const seedsPayload = readJson(paths.seedsPath);
	const crawlPolicyPayload = readJson(paths.crawlPolicyPath);
	const credentialsSchemaPayload = readJson(paths.credentialsSchemaPath);
	const projectionDeclarationsPayload = readJson(paths.projectionDeclarationsPath);
	const consumerDenominatorPayload = readJson(paths.consumerDenominatorPath);
	const schedulerPolicyPayload = readJson(paths.schedulerPolicyPath);
	const qcPolicyPayload = readJson(paths.qcPolicyPath);

	const bundle: OfficialWebConfigBundle = {
		paths,
		site: {
			schemaVersion: asString(sitePayload.schema_version),
			configVersion: asString(sitePayload.config_version),
			siteId: asString(sitePayload.site_id),
			displayName: asString(sitePayload.display_name),
			sourceChannel: asString(sitePayload.source_channel),
			entryHost: asString(sitePayload.entry_host),
			allowedHosts: asStringArray(sitePayload.allowed_hosts),
			seedSetVersion: asString(sitePayload.seed_set_version),
			hostPolicyVersion: asString(sitePayload.host_policy_version),
			crawlPolicyVersion: asString(sitePayload.crawl_policy_version),
			projectionPolicyVersion: asString(sitePayload.projection_policy_version),
			credentialsMode: asCredentialsMode(sitePayload.credentials_mode),
			userAgent: asString(sitePayload.user_agent),
			requestTimeoutMs: asPositiveInt(sitePayload.request_timeout_ms, "request_timeout_ms"),
			requestHandlerTimeoutMs: asPositiveInt(
				sitePayload.request_handler_timeout_ms,
				"request_handler_timeout_ms",
			),
			maxRequestRetries: asNonNegativeInt(sitePayload.max_request_retries, "max_request_retries"),
			maxRedirectHops: asPositiveInt(sitePayload.max_redirect_hops, "max_redirect_hops"),
		},
		hosts: {
			schemaVersion: asString(hostsPayload.schema_version),
			siteId: asString(hostsPayload.site_id),
			hostPolicyVersion: asString(hostsPayload.host_policy_version),
			hosts: asArray(hostsPayload.hosts).map((item) => ({
				host: asString(item.host),
				publicKind: asPublicKind(item.public_kind),
				hostGroup: asHostGroup(item.host_group),
				ownerLabel: asString(item.owner_label),
				rolloutOrder: asPositiveInt(item.rollout_order, "rollout_order"),
				enabled: Boolean(item.enabled),
				seedUrls: asStringArray(item.seed_urls),
				allowedPathPrefixes: asStringArray(item.allowed_path_prefixes),
				deniedPathPatterns: asStringArray(item.denied_path_patterns),
				queryParamAllowlist: asStringArray(item.query_param_allowlist),
				maxDepth: asNonNegativeInt(item.max_depth, "max_depth"),
				maxPagesPerRun: asNonNegativeInt(item.max_pages_per_run, "max_pages_per_run"),
				maxConcurrency: asPositiveInt(item.max_concurrency, "max_concurrency"),
				minDelayMs: asNonNegativeInt(item.min_delay_ms, "min_delay_ms"),
				respectRobots: Boolean(item.respect_robots),
				explicitSitemaps: asStringArray(item.explicit_sitemaps),
				dynamicShellDiscovery: asDynamicShellDiscoveryPolicy(item.dynamic_shell_discovery),
			})),
		},
		seeds: {
			schemaVersion: asString(seedsPayload.schema_version),
			siteId: asString(seedsPayload.site_id),
			seedSetVersion: asString(seedsPayload.seed_set_version),
			seeds: asArray(seedsPayload.seeds).map((item) => ({
				seedId: asString(item.seed_id),
				url: asString(item.url),
				host: asString(item.host),
				reason: asString(item.reason),
				discoveryMethod: (item.discovery_method == null
					? "seed"
					: asDiscoveryMethod(item.discovery_method)) as OfficialWebDiscoveryMethod,
			})),
		},
		crawlPolicy: {
			schemaVersion: asString(crawlPolicyPayload.schema_version),
			siteId: asString(crawlPolicyPayload.site_id),
			crawlPolicyVersion: asString(crawlPolicyPayload.crawl_policy_version),
			schemeAllowlist: asStringArray(crawlPolicyPayload.scheme_allowlist),
			contentTypeAllowlist: asStringArray(crawlPolicyPayload.content_type_allowlist),
			discoveryOrder: asStringArray(crawlPolicyPayload.discovery_order).map(asDiscoveryMethod),
			defaultQueryPolicy: asString(crawlPolicyPayload.default_query_policy),
			defaultQueryParamAllowlist: asStringArray(crawlPolicyPayload.default_query_param_allowlist),
			defaultDeniedPathPatterns: asStringArray(crawlPolicyPayload.default_denied_path_patterns),
			frontierIdentityKey: asString(crawlPolicyPayload.frontier_identity_key),
			expandWithinSameHostnameOnly: Boolean(crawlPolicyPayload.expand_within_same_hostname_only),
			crossHostExpansionRequiresAllowlist: Boolean(
				crawlPolicyPayload.cross_host_expansion_requires_allowlist,
			),
			allowCrossHostRedirectOnlyIfAllowlisted: Boolean(
				crawlPolicyPayload.allow_cross_host_redirect_only_if_allowlisted,
			),
			respectRobotsByDefault: Boolean(crawlPolicyPayload.respect_robots_by_default),
			robots4xxBehavior: asString(crawlPolicyPayload.robots_4xx_behavior),
			robots429Behavior: asString(crawlPolicyPayload.robots_429_behavior),
			robots5xxBehavior: asString(crawlPolicyPayload.robots_5xx_behavior),
			recordRedirectChain: Boolean(crawlPolicyPayload.record_redirect_chain),
			useConditionalFetch: Boolean(crawlPolicyPayload.use_conditional_fetch),
			maxTotalPagesPerRun: asPositiveInt(
				crawlPolicyPayload.max_total_pages_per_run,
				"max_total_pages_per_run",
			),
			maxTotalFailuresPerRun: asPositiveInt(
				crawlPolicyPayload.max_total_failures_per_run,
				"max_total_failures_per_run",
			),
			maxRuntimeMinutes: asPositiveInt(
				crawlPolicyPayload.max_runtime_minutes,
				"max_runtime_minutes",
			),
		},
		credentialsSchema: {
			schemaVersion: asString(credentialsSchemaPayload.schema_version),
			siteId: asString(credentialsSchemaPayload.site_id),
			credentialsMode: asCredentialsMode(credentialsSchemaPayload.credentials_mode),
			title: asString(credentialsSchemaPayload.title),
			description: asString(credentialsSchemaPayload.description),
			type: asString(credentialsSchemaPayload.type),
			additionalProperties: Boolean(credentialsSchemaPayload.additionalProperties),
			properties: asRecord(credentialsSchemaPayload.properties),
			required: asStringArray(credentialsSchemaPayload.required),
		},
		projectionDeclarations: {
			schemaVersion: asString(projectionDeclarationsPayload.schema_version),
			siteId: asString(projectionDeclarationsPayload.site_id),
			projectionPolicyVersion: asString(projectionDeclarationsPayload.projection_policy_version),
			declarations: asArray(projectionDeclarationsPayload.declarations).map((item) => ({
				declarationId: asString(item.declaration_id),
				pageFamily: asProjectionPageFamily(item.page_family),
				targetCorpus: asPathSegment(item.target_corpus, "projection.target_corpus"),
				targetCollection: asPathSegment(item.target_collection, "projection.target_collection"),
				projectionFamily: asPathSegment(item.projection_family, "projection.projection_family"),
				documentKind: asPathSegment(item.document_kind, "projection.document_kind"),
				action: asProjectionAction(item.action),
			})),
		},
		consumerDenominator: {
			schemaVersion: asString(consumerDenominatorPayload.schema_version),
			siteId: asString(consumerDenominatorPayload.site_id),
			denominatorVersion: asString(consumerDenominatorPayload.denominator_version),
			enforcementMode: asConsumerEnforcementMode(consumerDenominatorPayload.enforcement_mode),
			defaultRejectedPolicy: asConsumerRejectedPolicy(
				consumerDenominatorPayload.default_rejected_policy,
			),
			consumerFamilies: asArray(consumerDenominatorPayload.consumer_families).map((item) => ({
				consumerFamily: asConsumerFamily(item.consumer_family),
				ownerSurface: asString(item.owner_surface),
				ownerAgentOrRuntime: asString(item.owner_agent_or_runtime),
				materializationPolicy: asConsumerMaterializationPolicy(item.materialization_policy),
				pageFamilies: asStringArray(item.page_families).map(asProjectionPageFamily),
				titleKeywords: asStringArray(item.title_keywords),
				pathPatterns: asStringArray(item.path_patterns),
				requiredEvidence: asStringArray(item.required_evidence).map(asConsumerRequiredEvidence),
				minimumMatchedEvidenceCount:
					item.minimum_matched_evidence_count == null
						? 1
						: asPositiveInt(
								item.minimum_matched_evidence_count,
								"consumer_denominator.minimum_matched_evidence_count",
							),
				requiresKeywordOrPathMatch: Boolean(item.requires_keyword_or_path_match),
				negativePatterns: asStringArray(item.negative_patterns),
				selectedWriteTarget: asString(item.selected_write_target),
				reviewPolicy: asString(item.review_policy),
			})),
			reportingCounters: asStringArray(consumerDenominatorPayload.reporting_counters),
		},
		schedulerPolicy: {
			schemaVersion: asString(schedulerPolicyPayload.schema_version),
			siteId: asString(schedulerPolicyPayload.site_id),
			schedulerPolicyVersion: asString(schedulerPolicyPayload.scheduler_policy_version),
			timezone: asString(schedulerPolicyPayload.timezone),
			lanes: asArray(schedulerPolicyPayload.lanes).map((item) => ({
				laneId: asPathSegment(item.lane_id, "scheduler.lane_id"),
				enabled: Boolean(item.enabled),
				hostFilter: asStringArray(item.host_filter).map((host) => host.toLowerCase()),
				maxPagesPerHost: asPositiveInt(item.max_pages_per_host, "max_pages_per_host"),
				maxTotalPages: asPositiveInt(item.max_total_pages, "max_total_pages"),
				notes: asString(item.notes),
				runIntent: asRunIntent(item.run_intent),
				cadenceMinutes: asPositiveInt(item.cadence_minutes, "cadence_minutes"),
			})),
		},
		qcPolicy: {
			schemaVersion: asString(qcPolicyPayload.schema_version),
			siteId: asString(qcPolicyPayload.site_id),
			qcPolicyVersion: asString(qcPolicyPayload.qc_policy_version),
			allowedReviewIssueCodes: asStringArray(qcPolicyPayload.allowed_review_issue_codes),
			allowedReviewPageFamilies: asStringArray(qcPolicyPayload.allowed_review_page_families).map(
				asProjectionPageFamily,
			),
			hostOverrides: asArray(qcPolicyPayload.host_overrides).map((item) => ({
				host: asString(item.host),
				allowedReviewIssueCodes: asStringArray(item.allowed_review_issue_codes),
				allowedReviewPageFamilies: asStringArray(item.allowed_review_page_families).map(
					asProjectionPageFamily,
				),
			})),
		},
	};

	validateOfficialWebConfig(bundle);
	return bundle;
}
