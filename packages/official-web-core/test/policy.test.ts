import { describe, expect, it } from "vitest";

import * as officialWebCore from "../src/index";

function buildBundle(): officialWebCore.OfficialWebConfigBundle {
	return {
		paths: {
			siteId: "campus_public",
			siteRoot: "/tmp/campus_public",
			sitePath: "/tmp/campus_public/site.json",
			hostsPath: "/tmp/campus_public/hosts.json",
			seedsPath: "/tmp/campus_public/seeds.json",
			crawlPolicyPath: "/tmp/campus_public/crawl-policy.json",
			credentialsSchemaPath: "/tmp/campus_public/credentials.schema.json",
			projectionDeclarationsPath: "/tmp/campus_public/projection-declarations.json",
			consumerDenominatorPath: "/tmp/campus_public/consumer-denominator.json",
			targetSourceMapPath: "/tmp/campus_public/target-source-map.json",
			targetInventoryPath: "/tmp/campus_public/target-inventory.json",
			sourcePackId: "tool-driven-first-slice.v1",
			sourcePackManifestPath: "/tmp/campus_public/source-packs/tool-driven-first-slice.v1.json",
			schedulerPolicyPath: "/tmp/campus_public/scheduler-policy.json",
			qcPolicyPath: "/tmp/campus_public/qc-policy.json",
		},
		site: {
			schemaVersion: "official_web_site_config.v1",
			configVersion: "campus_public.v1",
			siteId: "campus_public",
			displayName: "Campus public",
			sourceChannel: "official_web",
			entryHost: "www.example.edu",
			allowedHosts: ["www.example.edu", "docs.example.edu", "portal.example.edu"],
			seedSetVersion: "campus_public_seeds_v1",
			hostPolicyVersion: "campus_public_hosts_v1",
			crawlPolicyVersion: "campus_public_crawl_policy_v1",
			projectionPolicyVersion: "campus_public_projection_v1",
			credentialsMode: "public",
			userAgent: "collector-test/1.0",
			requestTimeoutMs: 15000,
			requestHandlerTimeoutMs: 30000,
			maxRequestRetries: 2,
			maxRedirectHops: 5,
		},
		hosts: {
			schemaVersion: "official_web_host_policy.v1",
			siteId: "campus_public",
			hostPolicyVersion: "campus_public_hosts_v1",
			hosts: [
				{
					host: "www.example.edu",
					publicKind: "directory_site",
					hostGroup: "university_core",
					ownerLabel: "Example homepage",
					rolloutOrder: 10,
					enabled: true,
					seedUrls: ["https://www.example.edu/"],
					allowedPathPrefixes: ["/", "/news"],
					deniedPathPatterns: ["^/login", "\\.(pdf|zip)$"],
					queryParamAllowlist: ["id"],
					maxDepth: 4,
					maxPagesPerRun: 50,
					maxConcurrency: 1,
					minDelayMs: 1000,
					respectRobots: true,
					explicitSitemaps: [],
					dynamicShellDiscovery: null,
				},
				{
					host: "docs.example.edu",
					publicKind: "content_site",
					hostGroup: "college",
					ownerLabel: "Example docs",
					rolloutOrder: 20,
					enabled: true,
					seedUrls: ["https://docs.example.edu/"],
					allowedPathPrefixes: ["/"],
					deniedPathPatterns: [],
					queryParamAllowlist: [],
					maxDepth: 3,
					maxPagesPerRun: 20,
					maxConcurrency: 1,
					minDelayMs: 1200,
					respectRobots: true,
					explicitSitemaps: [],
					dynamicShellDiscovery: null,
				},
				{
					host: "portal.example.edu",
					publicKind: "portal",
					hostGroup: "excluded",
					ownerLabel: "Example portal",
					rolloutOrder: 30,
					enabled: false,
					seedUrls: [],
					allowedPathPrefixes: ["/"],
					deniedPathPatterns: [".*"],
					queryParamAllowlist: [],
					maxDepth: 0,
					maxPagesPerRun: 0,
					maxConcurrency: 1,
					minDelayMs: 1000,
					respectRobots: true,
					explicitSitemaps: [],
					dynamicShellDiscovery: null,
				},
			],
		},
		seeds: {
			schemaVersion: "official_web_seed_set.v1",
			siteId: "campus_public",
			seedSetVersion: "campus_public_seeds_v1",
			seeds: [],
		},
		sourcePackManifest: {
			schemaVersion: "official_web_source_pack_manifest.v1",
			siteId: "campus_public",
			sourcePackId: "tool-driven-first-slice.v1",
			entries: [],
		},
		crawlPolicy: {
			schemaVersion: "official_web_crawl_policy.v1",
			siteId: "campus_public",
			crawlPolicyVersion: "campus_public_crawl_policy_v1",
			schemeAllowlist: ["https"],
			contentTypeAllowlist: ["text/html"],
			discoveryOrder: ["seed", "robots_sitemap", "configured_sitemap", "navigation"],
			defaultQueryPolicy: "deny_all",
			defaultQueryParamAllowlist: [],
			defaultDeniedPathPatterns: ["^/search", "^/api/", "^/feed"],
			frontierIdentityKey: "normalized_canonical_url",
			expandWithinSameHostnameOnly: true,
			crossHostExpansionRequiresAllowlist: true,
			allowCrossHostRedirectOnlyIfAllowlisted: true,
			respectRobotsByDefault: true,
			robots4xxBehavior: "allow",
			robots429Behavior: "backoff_host",
			robots5xxBehavior: "fail_closed_host",
			recordRedirectChain: true,
			useConditionalFetch: true,
			maxTotalPagesPerRun: 500,
			maxTotalFailuresPerRun: 50,
			maxRuntimeMinutes: 30,
		},
		credentialsSchema: {
			schemaVersion: "official_web_credentials_schema.v1",
			siteId: "campus_public",
			credentialsMode: "public",
			title: "test",
			description: "test",
			type: "object",
			additionalProperties: false,
			properties: {},
			required: [],
		},
		projectionDeclarations: {
			schemaVersion: "official_web_projection_declarations.v1",
			siteId: "campus_public",
			projectionPolicyVersion: "campus_public_projection_v1",
			declarations: [],
		},
		consumerDenominator: {
			schemaVersion: "official_web_consumer_denominator.v1",
			siteId: "campus_public",
			denominatorVersion: "campus_public_consumer_denominator_v1",
			enforcementMode: "retain_matching_only",
			defaultRejectedPolicy: "reject",
			consumerFamilies: [
				{
					consumerFamily: "contact_directory_candidate",
					ownerSurface: "contact_directory_lookup",
					ownerAgentOrRuntime: "campus-services-agent",
					materializationPolicy: "candidate_only",
					pageFamilies: [
						"article_detail",
						"directory_page",
						"contact_widget_page",
						"generic_content_page",
					],
					titleKeywords: ["联系", "联系我们", "联系方式"],
					pathPatterns: ["contact", "lianxi"],
					requiredEvidence: ["phone", "email", "location", "office_hours"],
					optionalEvidence: [],
					minimumMatchedEvidenceCount: 2,
					requiresKeywordOrPathMatch: true,
					negativePatterns: ["采购", "招标", "中标", "通知", "公告"],
					selectedWriteTarget: "campus_services/contact_directory",
					reviewPolicy: "selected_write_requires_review",
				},
				{
					consumerFamily: "service_guide_candidate",
					ownerSurface: "service_guide_lookup",
					ownerAgentOrRuntime: "campus-services-agent",
					materializationPolicy: "candidate_only",
					pageFamilies: ["article_detail", "directory_page", "generic_content_page"],
					titleKeywords: ["办理", "申请", "指南", "服务"],
					pathPatterns: ["service", "guide", "apply"],
					requiredEvidence: [
						"service_process",
						"service_entry",
						"service_material",
						"phone",
						"location",
						"office_hours",
					],
					optionalEvidence: [],
					minimumMatchedEvidenceCount: 2,
					requiresKeywordOrPathMatch: true,
					negativePatterns: ["采购", "招标", "中标", "通知", "公告"],
					selectedWriteTarget: "campus_services/service_guide",
					reviewPolicy: "selected_write_requires_review",
				},
				{
					consumerFamily: "stable_reference_candidate",
					ownerSurface: "official_web/stable_reference",
					ownerAgentOrRuntime: "rag-agent",
					materializationPolicy: "release_gate_required",
					pageFamilies: ["article_detail", "directory_page", "generic_content_page"],
					titleKeywords: ["学校简介", "学校概况", "现任领导", "机构设置"],
					pathPatterns: ["about", "intro", "leader"],
					requiredEvidence: ["stable_reference"],
					optionalEvidence: [],
					minimumMatchedEvidenceCount: 1,
					requiresKeywordOrPathMatch: false,
					negativePatterns: ["新闻", "通知", "公告"],
					selectedWriteTarget: "official_web/stable_reference",
					reviewPolicy: "release_gate_required",
				},
				{
					consumerFamily: "regulation_candidate",
					ownerSurface: "regulations/institutional_rules",
					ownerAgentOrRuntime: "rag-agent",
					materializationPolicy: "release_gate_required",
					pageFamilies: ["article_detail", "generic_content_page"],
					titleKeywords: ["办法", "规定", "细则", "制度"],
					pathPatterns: ["gzzd", "rule", "policy"],
					requiredEvidence: ["regulation_text"],
					optionalEvidence: [],
					minimumMatchedEvidenceCount: 1,
					requiresKeywordOrPathMatch: false,
					negativePatterns: ["新闻", "通知", "公告"],
					selectedWriteTarget: "regulations/institutional_rules",
					reviewPolicy: "release_gate_required",
				},
				{
					consumerFamily: "notice_news_candidate",
					ownerSurface: "future_notice_runtime",
					ownerAgentOrRuntime: "notice-agent",
					materializationPolicy: "inventory_only",
					pageFamilies: ["article_detail"],
					titleKeywords: ["新闻", "通知", "公告", "讲座", "活动"],
					pathPatterns: ["news", "info"],
					requiredEvidence: ["notice_news"],
					optionalEvidence: [],
					minimumMatchedEvidenceCount: 1,
					requiresKeywordOrPathMatch: false,
					negativePatterns: [],
					selectedWriteTarget: "",
					reviewPolicy: "inventory_only",
				},
			],
			reportingCounters: [
				"fetched_pages",
				"retained_source_truth_pages",
				"discovery_only_pages",
				"rejected_pages",
				"consumer_family_counts",
				"rejected_reason_counts",
			],
		},
		targetSourceMap: {
			schemaVersion: "official_web_target_source_map.v2",
			siteId: "campus_public",
			mapVersion: "campus_public_target_source_map_v2",
			targets: [
				{
					targetId: "contact-directory",
					consumerFamily: "contact_directory_candidate",
					ownerSurface: "contact_directory_lookup",
					selectedWriteTarget: "campus_services/contact_directory",
					sourceHosts: ["www.example.edu"],
					urlHints: ["contact"],
					titleHints: ["联系"],
					requiredEvidence: ["phone", "email", "location", "office_hours"],
					optionalEvidence: [],
					retentionPolicy: "retain_source_truth",
					reviewPolicy: "selected_write_requires_review",
					materializationPolicy: "candidate_only",
					inventoryOnly: false,
					notes: "test target",
				},
				{
					targetId: "institutional-rules",
					consumerFamily: "regulation_candidate",
					ownerSurface: "regulations/institutional_rules",
					selectedWriteTarget: "regulations/institutional_rules",
					sourceHosts: ["www.example.edu"],
					urlHints: ["rule"],
					titleHints: ["办法"],
					requiredEvidence: ["regulation_text"],
					optionalEvidence: [],
					retentionPolicy: "retain_source_truth",
					reviewPolicy: "release_gate_required",
					materializationPolicy: "release_gate_required",
					inventoryOnly: false,
					notes: "rules target",
				},
			],
		},
		targetInventory: {
			schemaVersion: "official_web_target_inventory.v1",
			siteId: "campus_public",
			inventoryVersion: "campus_public_target_inventory_v1",
			entries: [
				{
					admissionTargetId: "contact-directory",
					consumerFamily: "contact_directory_candidate",
					inventoryId: "contact-directory-homepage",
					inventoryOnly: false,
					materializationPolicy: "candidate_only",
					notes: "test inventory target",
					ownerAgentOrRuntime: "campus-services-agent",
					ownerSurface: "contact_directory_lookup",
					previewStatus: "candidate",
					releaseBlockers: ["no_preview_evidence"],
					requiredEvidence: ["phone", "email", "location", "office_hours"],
					optionalEvidence: [],
					requiredFields: ["phone", "email", "location", "office_hours", "source_url"],
					optionalFields: [],
					selectedWriteTarget: "campus_services/contact_directory",
					sourceHosts: ["www.example.edu"],
					sourceUrls: ["https://www.example.edu/contact"],
					targetLabel: "Contact directory homepage",
				},
			],
		},
		schedulerPolicy: {
			schemaVersion: "official_web_scheduler_policy.v1",
			siteId: "campus_public",
			schedulerPolicyVersion: "campus_public_scheduler_v1",
			timezone: "Asia/Shanghai",
			lanes: [
				{
					laneId: "baseline",
					enabled: true,
					hostFilter: [],
					maxPagesPerHost: 50,
					maxTotalPages: 500,
					notes: "baseline coverage",
					runIntent: "baseline",
					cadenceMinutes: 1440,
				},
				{
					laneId: "hot",
					enabled: true,
					hostFilter: ["www.example.edu", "docs.example.edu"],
					maxPagesPerHost: 20,
					maxTotalPages: 100,
					notes: "hot coverage",
					runIntent: "hot",
					cadenceMinutes: 30,
				},
				{
					laneId: "repair",
					enabled: true,
					hostFilter: [],
					maxPagesPerHost: 10,
					maxTotalPages: 80,
					notes: "repair coverage",
					runIntent: "repair",
					cadenceMinutes: 120,
				},
			],
		},
		qcPolicy: {
			schemaVersion: "official_web_qc_policy.v1",
			siteId: "campus_public",
			qcPolicyVersion: "campus_public_qc_v1",
			allowedReviewIssueCodes: [],
			allowedReviewPageFamilies: [],
			hostOverrides: [],
		},
	};
}

describe("official-web-core policy", () => {
	it("normalizes canonical URL identity and strips tracking params", () => {
		const buildOfficialWebUrlIdentity = (
			officialWebCore as {
				buildOfficialWebUrlIdentity?: (
					bundle: officialWebCore.OfficialWebConfigBundle,
					input: {
						requestedUrl: string;
						finalUrl?: string | null;
						declaredCanonicalUrl?: string | null;
					},
				) => {
					normalizedCanonicalUrl: string;
					urlIdentityBasis: string;
					declaredCanonicalUrl: string | null;
				};
			}
		).buildOfficialWebUrlIdentity;

		expect(buildOfficialWebUrlIdentity).toBeTypeOf("function");
		if (!buildOfficialWebUrlIdentity) {
			return;
		}

		const result = buildOfficialWebUrlIdentity(buildBundle(), {
			requestedUrl: "https://www.example.edu/news/article?id=9&utm_source=email#intro",
			finalUrl: "https://WWW.EXAMPLE.EDU/news/../news/article?id=9&utm_campaign=spring",
			declaredCanonicalUrl: "https://www.example.edu/news/article?utm_medium=email&id=9",
		});

		expect(result.declaredCanonicalUrl).toBe(
			"https://www.example.edu/news/article?utm_medium=email&id=9",
		);
		expect(result.normalizedCanonicalUrl).toBe("https://www.example.edu/news/article?id=9");
		expect(result.urlIdentityBasis).toBe("declared_canonical");
	});

	it("uses final URL when declared canonical is not acceptable", () => {
		const buildOfficialWebUrlIdentity = (
			officialWebCore as {
				buildOfficialWebUrlIdentity?: (
					bundle: officialWebCore.OfficialWebConfigBundle,
					input: {
						requestedUrl: string;
						finalUrl?: string | null;
						declaredCanonicalUrl?: string | null;
					},
				) => {
					normalizedCanonicalUrl: string;
					urlIdentityBasis: string;
				};
			}
		).buildOfficialWebUrlIdentity;

		expect(buildOfficialWebUrlIdentity).toBeTypeOf("function");
		if (!buildOfficialWebUrlIdentity) {
			return;
		}

		const result = buildOfficialWebUrlIdentity(buildBundle(), {
			requestedUrl: "https://www.example.edu/news/article?id=9",
			finalUrl: "https://www.example.edu/news/article?id=9",
			declaredCanonicalUrl: "/news/article?id=9",
		});

		expect(result.normalizedCanonicalUrl).toBe("https://www.example.edu/news/article?id=9");
		expect(result.urlIdentityBasis).toBe("final_url");
	});

	it("collapses default index pages into a stable canonical URL identity", () => {
		const buildOfficialWebUrlIdentity = (
			officialWebCore as {
				buildOfficialWebUrlIdentity?: (
					bundle: officialWebCore.OfficialWebConfigBundle,
					input: {
						requestedUrl: string;
						finalUrl?: string | null;
						declaredCanonicalUrl?: string | null;
					},
				) => {
					normalizedCanonicalUrl: string;
					urlIdentityBasis: string;
				};
			}
		).buildOfficialWebUrlIdentity;

		expect(buildOfficialWebUrlIdentity).toBeTypeOf("function");
		if (!buildOfficialWebUrlIdentity) {
			return;
		}

		const homepage = buildOfficialWebUrlIdentity(buildBundle(), {
			requestedUrl: "https://www.example.edu/",
			finalUrl: "https://www.example.edu/",
			declaredCanonicalUrl: null,
		});
		const indexPage = buildOfficialWebUrlIdentity(buildBundle(), {
			requestedUrl: "https://www.example.edu/index.htm",
			finalUrl: "https://www.example.edu/index.htm",
			declaredCanonicalUrl: null,
		});

		expect(homepage.normalizedCanonicalUrl).toBe("https://www.example.edu/");
		expect(indexPage.normalizedCanonicalUrl).toBe("https://www.example.edu/");
		expect(indexPage.urlIdentityBasis).toBe("final_url");
	});

	it("admits query URLs only when the remaining params are allowlisted", () => {
		const admitOfficialWebUrl = (
			officialWebCore as {
				admitOfficialWebUrl?: (
					bundle: officialWebCore.OfficialWebConfigBundle,
					input: {
						url: string;
						discoveryMethod: officialWebCore.OfficialWebDiscoveryMethod;
						sourceHost?: string | null;
					},
				) => {
					admitted: boolean;
					normalizedUrl: string | null;
					reason: string;
				};
			}
		).admitOfficialWebUrl;

		expect(admitOfficialWebUrl).toBeTypeOf("function");
		if (!admitOfficialWebUrl) {
			return;
		}

		const admitted = admitOfficialWebUrl(buildBundle(), {
			url: "https://www.example.edu/news/article?id=9&utm_source=wechat",
			discoveryMethod: "navigation",
			sourceHost: "www.example.edu",
		});
		const rejected = admitOfficialWebUrl(buildBundle(), {
			url: "https://www.example.edu/news/article?id=9&sort=desc",
			discoveryMethod: "navigation",
			sourceHost: "www.example.edu",
		});

		expect(admitted.admitted).toBe(true);
		expect(admitted.normalizedUrl).toBe("https://www.example.edu/news/article?id=9");
		expect(rejected.admitted).toBe(false);
		expect(rejected.reason).toBe("query_params_not_allowed");
	});

	it("rejects disabled hosts and denied paths", () => {
		const admitOfficialWebUrl = (
			officialWebCore as {
				admitOfficialWebUrl?: (
					bundle: officialWebCore.OfficialWebConfigBundle,
					input: {
						url: string;
						discoveryMethod: officialWebCore.OfficialWebDiscoveryMethod;
					},
				) => {
					admitted: boolean;
					reason: string;
				};
			}
		).admitOfficialWebUrl;

		expect(admitOfficialWebUrl).toBeTypeOf("function");
		if (!admitOfficialWebUrl) {
			return;
		}

		const disabledHost = admitOfficialWebUrl(buildBundle(), {
			url: "https://portal.example.edu/",
			discoveryMethod: "seed",
		});
		const deniedPath = admitOfficialWebUrl(buildBundle(), {
			url: "https://www.example.edu/login",
			discoveryMethod: "navigation",
		});

		expect(disabledHost.admitted).toBe(false);
		expect(disabledHost.reason).toBe("host_disabled");
		expect(deniedPath.admitted).toBe(false);
		expect(deniedPath.reason).toBe("path_denied");
	});

	it("rejects cross-host navigation when same-host expansion is enabled", () => {
		const admitOfficialWebUrl = (
			officialWebCore as {
				admitOfficialWebUrl?: (
					bundle: officialWebCore.OfficialWebConfigBundle,
					input: {
						url: string;
						discoveryMethod: officialWebCore.OfficialWebDiscoveryMethod;
						sourceHost?: string | null;
					},
				) => {
					admitted: boolean;
					reason: string;
				};
			}
		).admitOfficialWebUrl;

		expect(admitOfficialWebUrl).toBeTypeOf("function");
		if (!admitOfficialWebUrl) {
			return;
		}

		const crossHost = admitOfficialWebUrl(buildBundle(), {
			url: "https://docs.example.edu/guide",
			discoveryMethod: "navigation",
			sourceHost: "www.example.edu",
		});

		expect(crossHost.admitted).toBe(false);
		expect(crossHost.reason).toBe("cross_host_navigation_not_allowed");
	});

	it("builds stable url result and failure artifacts", () => {
		const buildOfficialWebUrlResultRecord = officialWebCore as {
			buildOfficialWebUrlResultRecord?: (input: {
				siteId: string;
				crawlRunId: string;
				requestedUrl: string;
				finalUrl: string;
				declaredCanonicalUrl: string | null;
				normalizedCanonicalUrl: string;
				urlIdentityBasis: string;
				discoveryMethod: officialWebCore.OfficialWebDiscoveryMethod;
				discoveredFromUrl?: string | null;
				host: string;
				depth: number;
				httpStatus: number;
				contentType: string;
				outcome: string;
			}) => { schemaVersion: string; normalizedCanonicalUrl: string; outcome: string };
			buildOfficialWebFailureRecord?: (input: {
				siteId: string;
				crawlRunId: string;
				url: string;
				phase: string;
				reason: string;
				message: string;
				retryable: boolean;
			}) => { schemaVersion: string; phase: string; reason: string };
		};

		expect(buildOfficialWebUrlResultRecord.buildOfficialWebUrlResultRecord).toBeTypeOf("function");
		expect(buildOfficialWebUrlResultRecord.buildOfficialWebFailureRecord).toBeTypeOf("function");
		if (
			!(
				buildOfficialWebUrlResultRecord.buildOfficialWebUrlResultRecord &&
				buildOfficialWebUrlResultRecord.buildOfficialWebFailureRecord
			)
		) {
			return;
		}

		const urlResult = buildOfficialWebUrlResultRecord.buildOfficialWebUrlResultRecord({
			siteId: "campus_public",
			crawlRunId: "campus_public-TEST",
			requestedUrl: "https://www.example.edu/news/article?id=9",
			finalUrl: "https://www.example.edu/news/article?id=9",
			declaredCanonicalUrl: null,
			normalizedCanonicalUrl: "https://www.example.edu/news/article?id=9",
			urlIdentityBasis: "final_url",
			discoveryMethod: "seed",
			discoveredFromUrl: null,
			host: "www.example.edu",
			depth: 0,
			httpStatus: 200,
			contentType: "text/html",
			outcome: "fetched",
		});
		const failure = buildOfficialWebUrlResultRecord.buildOfficialWebFailureRecord({
			siteId: "campus_public",
			crawlRunId: "campus_public-TEST",
			url: "https://www.example.edu/news/article?id=9",
			phase: "fetch",
			reason: "timeout",
			message: "request timed out",
			retryable: true,
		});

		expect(urlResult.schemaVersion).toBe("official_web_url_result.v1");
		expect(urlResult.normalizedCanonicalUrl).toBe("https://www.example.edu/news/article?id=9");
		expect(urlResult.outcome).toBe("fetched");
		expect(failure.schemaVersion).toBe("official_web_failure.v1");
		expect(failure.phase).toBe("fetch");
		expect(failure.reason).toBe("timeout");
	});

	it("rejects inventory-only target declarations with selected-write output", () => {
		const bundle = officialWebCore.loadOfficialWebConfig("muc_public");
		const noticeTarget = bundle.targetSourceMap.targets.find(
			(target) => target.consumerFamily === "notice_news_candidate",
		);
		if (!noticeTarget) {
			throw new Error("notice target is required");
		}
		noticeTarget.selectedWriteTarget = "official_web/public_notice";

		expect(() => officialWebCore.validateOfficialWebConfig(bundle)).toThrowError(
			/selectedWriteTarget/u,
		);
	});

	it("rejects target declarations with owner or host drift", () => {
		const ownerDriftBundle = officialWebCore.loadOfficialWebConfig("muc_public");
		const ownerTarget = ownerDriftBundle.targetSourceMap.targets[0];
		if (!ownerTarget) {
			throw new Error("owner drift target is required");
		}
		ownerDriftBundle.targetSourceMap.targets[0] = {
			...ownerTarget,
			ownerSurface: "unknown_owner_surface",
		};

		expect(() => officialWebCore.validateOfficialWebConfig(ownerDriftBundle)).toThrowError(
			/ownerSurface/u,
		);

		const hostDriftBundle = officialWebCore.loadOfficialWebConfig("muc_public");
		const hostTarget = hostDriftBundle.targetSourceMap.targets[0];
		if (!hostTarget) {
			throw new Error("host drift target is required");
		}
		hostDriftBundle.targetSourceMap.targets[0] = {
			...hostTarget,
			sourceHosts: ["unknown.muc.edu.cn"],
		};

		expect(() => officialWebCore.validateOfficialWebConfig(hostDriftBundle)).toThrowError(
			/references unavailable host/u,
		);
	});

	it("rejects target-source-map required evidence drift from consumer denominator", () => {
		const bundle = officialWebCore.loadOfficialWebConfig("muc_public");
		const contactTarget = bundle.targetSourceMap.targets.find(
			(target) => target.targetId === "campus-services-contact-directory",
		);
		if (!contactTarget) {
			throw new Error("contact target is required");
		}
		contactTarget.requiredEvidence = ["phone", "location"];
		contactTarget.optionalEvidence = ["email", "office_hours"];

		expect(() => officialWebCore.validateOfficialWebConfig(bundle)).toThrowError(
			/requiredEvidence must match consumer denominator/u,
		);
	});

	it("rejects target inventory required evidence drift from admission target", () => {
		const bundle = officialWebCore.loadOfficialWebConfig("muc_public");
		const contactEntry = bundle.targetInventory.entries.find(
			(entry) => entry.inventoryId === "muc-main-homepage-contact",
		);
		if (!contactEntry) {
			throw new Error("contact inventory entry is required");
		}
		contactEntry.requiredEvidence = ["phone", "location"];
		contactEntry.optionalEvidence = ["email", "office_hours"];

		expect(() => officialWebCore.validateOfficialWebConfig(bundle)).toThrowError(
			/requiredEvidence must be allowed by admission target/u,
		);
	});
});
