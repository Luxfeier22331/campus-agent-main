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

	it("falls back to final URL when declared canonical is not acceptable", () => {
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
});
