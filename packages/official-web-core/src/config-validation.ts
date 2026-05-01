import {
	ENABLED_PUBLIC_KINDS,
	OFFICIAL_WEB_CONSUMER_FAMILIES,
	OFFICIAL_WEB_RUN_INTENTS,
	OFFICIAL_WEB_SHELL_PAGE_FAMILIES,
	OFFICIAL_WEB_SOURCE_CHANNEL,
	type OfficialWebConfigBundle,
} from "./config-models.ts";

function assertNonEmpty(value: string, fieldName: string): void {
	if (!value) {
		throw new Error(`${fieldName} is required`);
	}
}

function ensureUnique(values: string[], fieldName: string): void {
	if (new Set(values).size !== values.length) {
		throw new Error(`${fieldName} must not contain duplicates`);
	}
}

function ensureSameSet(left: string[], right: string[], fieldName: string): void {
	const leftSet = new Set(left);
	const rightSet = new Set(right);
	if (leftSet.size !== rightSet.size) {
		throw new Error(`${fieldName} set mismatch`);
	}
	for (const item of leftSet) {
		if (!rightSet.has(item)) {
			throw new Error(`${fieldName} set mismatch`);
		}
	}
}

function validateRegexList(values: string[], fieldName: string): void {
	for (const value of values) {
		try {
			new RegExp(value, "i");
		} catch (error) {
			throw new Error(
				`${fieldName} contains invalid regex ${value}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}
}

function validateHostName(value: string, fieldName: string): void {
	assertNonEmpty(value, fieldName);
	if (value !== value.toLowerCase()) {
		throw new Error(`${fieldName} must be lowercase`);
	}
	if (value.includes("*") || value.includes("/") || value.includes(":")) {
		throw new Error(`${fieldName} must be a bare host name`);
	}
}

function validateSeedUrl(
	rawUrl: string,
	expectedHost: string,
	queryParamAllowlist: string[],
): void {
	const parsed = new URL(rawUrl);
	if (parsed.protocol !== "https:") {
		throw new Error(`seed ${rawUrl} must use https`);
	}
	if (parsed.hostname !== expectedHost) {
		throw new Error(`seed ${rawUrl} must stay on host ${expectedHost}`);
	}
	if (parsed.hash) {
		throw new Error(`seed ${rawUrl} must not include a fragment`);
	}
	for (const name of parsed.searchParams.keys()) {
		if (!queryParamAllowlist.includes(name)) {
			throw new Error(`seed ${rawUrl} uses unapproved query parameter ${name}`);
		}
	}
}

export function validateOfficialWebConfig(bundle: OfficialWebConfigBundle): void {
	assertNonEmpty(bundle.site.schemaVersion, "site.schemaVersion");
	assertNonEmpty(bundle.site.configVersion, "site.configVersion");
	assertNonEmpty(bundle.site.siteId, "site.siteId");
	assertNonEmpty(bundle.site.displayName, "site.displayName");
	if (bundle.site.sourceChannel !== OFFICIAL_WEB_SOURCE_CHANNEL) {
		throw new Error(`site.sourceChannel must equal ${OFFICIAL_WEB_SOURCE_CHANNEL}`);
	}
	validateHostName(bundle.site.entryHost, "site.entryHost");
	if (bundle.site.allowedHosts.length === 0) {
		throw new Error("site.allowedHosts must not be empty");
	}
	ensureUnique(bundle.site.allowedHosts, "site.allowedHosts");
	bundle.site.allowedHosts.forEach((host) => {
		validateHostName(host, "site.allowedHosts");
	});
	if (!bundle.site.allowedHosts.includes(bundle.site.entryHost)) {
		throw new Error("site.entryHost must appear in site.allowedHosts");
	}

	if (bundle.hosts.siteId !== bundle.site.siteId) {
		throw new Error("hosts.siteId must match site.siteId");
	}
	if (bundle.hosts.hostPolicyVersion !== bundle.site.hostPolicyVersion) {
		throw new Error("hosts.hostPolicyVersion must match site.hostPolicyVersion");
	}
	if (bundle.hosts.hosts.length === 0) {
		throw new Error("hosts.hosts must not be empty");
	}
	ensureUnique(
		bundle.hosts.hosts.map((item) => item.host),
		"hosts.hosts[].host",
	);

	const enabledHosts = bundle.hosts.hosts.filter((item) => item.enabled);
	const enabledHostNames = enabledHosts.map((item) => item.host);
	ensureSameSet(bundle.site.allowedHosts, enabledHostNames, "site.allowedHosts");

	for (const host of bundle.hosts.hosts) {
		validateHostName(host.host, "hosts.host");
		assertNonEmpty(host.ownerLabel, `host ${host.host} ownerLabel`);
		if (host.rolloutOrder <= 0) {
			throw new Error(`host ${host.host} must have rolloutOrder > 0`);
		}
		if (!host.enabled && host.hostGroup !== "excluded") {
			throw new Error(`disabled host ${host.host} must use hostGroup=excluded`);
		}
		if (host.enabled && host.hostGroup === "excluded") {
			throw new Error(`enabled host ${host.host} must not use hostGroup=excluded`);
		}
		if (
			host.enabled &&
			!ENABLED_PUBLIC_KINDS.includes(host.publicKind as (typeof ENABLED_PUBLIC_KINDS)[number])
		) {
			throw new Error(`enabled host ${host.host} must be content_site or directory_site`);
		}
		if (!host.enabled && host.seedUrls.length > 0) {
			throw new Error(`disabled host ${host.host} must not define seedUrls`);
		}
		if (!host.respectRobots) {
			throw new Error(`host ${host.host} must keep respectRobots=true`);
		}
		if (host.enabled) {
			if (host.maxDepth <= 0) {
				throw new Error(`enabled host ${host.host} must have maxDepth > 0`);
			}
			if (host.maxPagesPerRun <= 0) {
				throw new Error(`enabled host ${host.host} must have maxPagesPerRun > 0`);
			}
			if (host.allowedPathPrefixes.length === 0) {
				throw new Error(`enabled host ${host.host} must define allowedPathPrefixes`);
			}
			for (const seedUrl of host.seedUrls) {
				validateSeedUrl(seedUrl, host.host, host.queryParamAllowlist);
			}
		}
		for (const sitemap of host.explicitSitemaps) {
			const parsed = new URL(sitemap);
			if (parsed.protocol !== "https:") {
				throw new Error(`explicit sitemap ${sitemap} must use https`);
			}
			if (parsed.hostname !== host.host) {
				throw new Error(`explicit sitemap ${sitemap} must stay on host ${host.host}`);
			}
		}
		if (host.dynamicShellDiscovery?.enabled) {
			if (host.dynamicShellDiscovery.waitAfterLoadMs <= 0) {
				throw new Error(`host ${host.host} dynamicShellDiscovery.waitAfterLoadMs must be > 0`);
			}
			if (host.dynamicShellDiscovery.networkObservationTimeoutMs <= 0) {
				throw new Error(
					`host ${host.host} dynamicShellDiscovery.networkObservationTimeoutMs must be > 0`,
				);
			}
			if (host.dynamicShellDiscovery.maxPromotedUrls <= 0) {
				throw new Error(`host ${host.host} dynamicShellDiscovery.maxPromotedUrls must be > 0`);
			}
			if (host.dynamicShellDiscovery.allowedRequestUrlPatterns.length === 0) {
				throw new Error(
					`host ${host.host} dynamicShellDiscovery.allowedRequestUrlPatterns must not be empty`,
				);
			}
			if (host.dynamicShellDiscovery.promotedUrlPatterns.length === 0) {
				throw new Error(
					`host ${host.host} dynamicShellDiscovery.promotedUrlPatterns must not be empty`,
				);
			}
			validateRegexList(
				host.dynamicShellDiscovery.allowedRequestUrlPatterns,
				`host ${host.host} dynamicShellDiscovery.allowedRequestUrlPatterns`,
			);
			validateRegexList(
				host.dynamicShellDiscovery.ignoredRequestUrlPatterns,
				`host ${host.host} dynamicShellDiscovery.ignoredRequestUrlPatterns`,
			);
			validateRegexList(
				host.dynamicShellDiscovery.promotedUrlPatterns,
				`host ${host.host} dynamicShellDiscovery.promotedUrlPatterns`,
			);
			validateRegexList(
				host.dynamicShellDiscovery.waitForResponseUrlPatterns,
				`host ${host.host} dynamicShellDiscovery.waitForResponseUrlPatterns`,
			);
		}
	}

	if (bundle.seeds.siteId !== bundle.site.siteId) {
		throw new Error("seeds.siteId must match site.siteId");
	}
	if (bundle.seeds.seedSetVersion !== bundle.site.seedSetVersion) {
		throw new Error("seeds.seedSetVersion must match site.seedSetVersion");
	}
	ensureUnique(
		bundle.seeds.seeds.map((seed) => seed.seedId),
		"seeds.seeds[].seedId",
	);
	ensureUnique(
		bundle.seeds.seeds.map((seed) => seed.url),
		"seeds.seeds[].url",
	);

	const hostIndex = new Map(bundle.hosts.hosts.map((item) => [item.host, item]));
	for (const seed of bundle.seeds.seeds) {
		assertNonEmpty(seed.seedId, "seed.seedId");
		assertNonEmpty(seed.reason, "seed.reason");
		validateHostName(seed.host, "seed.host");
		const host = hostIndex.get(seed.host);
		if (!host) {
			throw new Error(`seed ${seed.seedId} references unknown host ${seed.host}`);
		}
		if (!host.enabled) {
			throw new Error(`seed ${seed.seedId} references disabled host ${seed.host}`);
		}
		if (!host.seedUrls.includes(seed.url)) {
			throw new Error(`seed ${seed.seedId} is missing from host.seedUrls for ${seed.host}`);
		}
		validateSeedUrl(seed.url, seed.host, host.queryParamAllowlist);
	}

	for (const host of bundle.hosts.hosts) {
		const seedUrlsForHost = bundle.seeds.seeds
			.filter((seed) => seed.host === host.host)
			.map((seed) => seed.url);
		ensureSameSet(host.seedUrls, seedUrlsForHost, `host.seedUrls(${host.host})`);
	}

	if (bundle.crawlPolicy.siteId !== bundle.site.siteId) {
		throw new Error("crawlPolicy.siteId must match site.siteId");
	}
	if (bundle.crawlPolicy.crawlPolicyVersion !== bundle.site.crawlPolicyVersion) {
		throw new Error("crawlPolicy.crawlPolicyVersion must match site.crawlPolicyVersion");
	}
	if (!bundle.crawlPolicy.schemeAllowlist.includes("https")) {
		throw new Error("crawlPolicy must include https in schemeAllowlist");
	}
	if (!bundle.crawlPolicy.contentTypeAllowlist.includes("text/html")) {
		throw new Error("crawlPolicy must include text/html in contentTypeAllowlist");
	}
	if (bundle.crawlPolicy.defaultQueryPolicy !== "deny_all") {
		throw new Error("crawlPolicy.defaultQueryPolicy must stay deny_all in v1");
	}
	if (bundle.crawlPolicy.frontierIdentityKey !== "normalized_canonical_url") {
		throw new Error("crawlPolicy.frontierIdentityKey must be normalized_canonical_url");
	}
	if (!bundle.crawlPolicy.respectRobotsByDefault) {
		throw new Error("crawlPolicy.respectRobotsByDefault must be true");
	}
	if (!bundle.crawlPolicy.expandWithinSameHostnameOnly) {
		throw new Error("crawlPolicy.expandWithinSameHostnameOnly must be true");
	}
	if (!bundle.crawlPolicy.crossHostExpansionRequiresAllowlist) {
		throw new Error("crawlPolicy.crossHostExpansionRequiresAllowlist must be true");
	}

	if (bundle.credentialsSchema.siteId !== bundle.site.siteId) {
		throw new Error("credentialsSchema.siteId must match site.siteId");
	}
	if (bundle.credentialsSchema.credentialsMode !== bundle.site.credentialsMode) {
		throw new Error("credentialsSchema.credentialsMode must match site.credentialsMode");
	}
	if (bundle.credentialsSchema.type !== "object") {
		throw new Error("credentialsSchema.type must be object");
	}
	if (bundle.site.credentialsMode === "public") {
		if (Object.keys(bundle.credentialsSchema.properties).length > 0) {
			throw new Error("public credentials schema must not define properties");
		}
		if (bundle.credentialsSchema.required.length > 0) {
			throw new Error("public credentials schema must not define required fields");
		}
	}

	if (bundle.projectionDeclarations.siteId !== bundle.site.siteId) {
		throw new Error("projectionDeclarations.siteId must match site.siteId");
	}
	if (
		bundle.projectionDeclarations.projectionPolicyVersion !== bundle.site.projectionPolicyVersion
	) {
		throw new Error(
			"projectionDeclarations.projectionPolicyVersion must match site.projectionPolicyVersion",
		);
	}
	ensureUnique(
		bundle.projectionDeclarations.declarations.map((item) => item.declarationId),
		"projectionDeclarations.declarations[].declarationId",
	);
	ensureUnique(
		bundle.projectionDeclarations.declarations.map((item) => item.pageFamily),
		"projectionDeclarations.declarations[].pageFamily",
	);
	for (const declaration of bundle.projectionDeclarations.declarations) {
		if (
			OFFICIAL_WEB_SHELL_PAGE_FAMILIES.includes(
				declaration.pageFamily as (typeof OFFICIAL_WEB_SHELL_PAGE_FAMILIES)[number],
			) &&
			declaration.action !== "manual_review"
		) {
			throw new Error(
				`shell-family projection ${declaration.declarationId} must use action=manual_review`,
			);
		}
	}

	if (bundle.consumerDenominator.siteId !== bundle.site.siteId) {
		throw new Error("consumerDenominator.siteId must match site.siteId");
	}
	assertNonEmpty(bundle.consumerDenominator.schemaVersion, "consumerDenominator.schemaVersion");
	assertNonEmpty(
		bundle.consumerDenominator.denominatorVersion,
		"consumerDenominator.denominatorVersion",
	);
	if (bundle.consumerDenominator.consumerFamilies.length === 0) {
		throw new Error("consumerDenominator.consumerFamilies must not be empty");
	}
	ensureUnique(
		bundle.consumerDenominator.consumerFamilies.map((item) => item.consumerFamily),
		"consumerDenominator.consumerFamilies[].consumerFamily",
	);
	for (const family of OFFICIAL_WEB_CONSUMER_FAMILIES) {
		if (
			!bundle.consumerDenominator.consumerFamilies.some((rule) => rule.consumerFamily === family)
		) {
			throw new Error(`consumerDenominator must include ${family}`);
		}
	}
	for (const rule of bundle.consumerDenominator.consumerFamilies) {
		assertNonEmpty(rule.ownerSurface, `consumerDenominator ${rule.consumerFamily} ownerSurface`);
		assertNonEmpty(
			rule.ownerAgentOrRuntime,
			`consumerDenominator ${rule.consumerFamily} ownerAgentOrRuntime`,
		);
		if (rule.pageFamilies.length === 0) {
			throw new Error(`consumerDenominator ${rule.consumerFamily} must define pageFamilies`);
		}
		ensureUnique(rule.pageFamilies, `consumerDenominator ${rule.consumerFamily}.pageFamilies`);
		ensureUnique(rule.titleKeywords, `consumerDenominator ${rule.consumerFamily}.titleKeywords`);
		ensureUnique(rule.pathPatterns, `consumerDenominator ${rule.consumerFamily}.pathPatterns`);
		ensureUnique(
			rule.requiredEvidence,
			`consumerDenominator ${rule.consumerFamily}.requiredEvidence`,
		);
		ensureUnique(
			rule.negativePatterns,
			`consumerDenominator ${rule.consumerFamily}.negativePatterns`,
		);
		if (rule.requiredEvidence.length === 0) {
			throw new Error(`consumerDenominator ${rule.consumerFamily} must define requiredEvidence`);
		}
		if (rule.minimumMatchedEvidenceCount < 1) {
			throw new Error(
				`consumerDenominator ${rule.consumerFamily}.minimumMatchedEvidenceCount must be positive`,
			);
		}
		validateRegexList(rule.pathPatterns, `consumerDenominator ${rule.consumerFamily}.pathPatterns`);
		validateRegexList(
			rule.negativePatterns,
			`consumerDenominator ${rule.consumerFamily}.negativePatterns`,
		);
		if (rule.consumerFamily === "notice_news_candidate") {
			if (rule.materializationPolicy !== "inventory_only") {
				throw new Error("notice_news_candidate must use materializationPolicy=inventory_only");
			}
			if (rule.selectedWriteTarget) {
				throw new Error("notice_news_candidate selectedWriteTarget must be empty");
			}
		} else {
			assertNonEmpty(
				rule.selectedWriteTarget,
				`consumerDenominator ${rule.consumerFamily} selectedWriteTarget`,
			);
		}
	}
	ensureUnique(
		bundle.consumerDenominator.reportingCounters,
		"consumerDenominator.reportingCounters",
	);

	if (bundle.targetSourceMap.siteId !== bundle.site.siteId) {
		throw new Error("targetSourceMap.siteId must match site.siteId");
	}
	assertNonEmpty(bundle.targetSourceMap.schemaVersion, "targetSourceMap.schemaVersion");
	assertNonEmpty(bundle.targetSourceMap.mapVersion, "targetSourceMap.mapVersion");
	if (bundle.targetSourceMap.targets.length === 0) {
		throw new Error("targetSourceMap.targets must not be empty");
	}
	ensureUnique(
		bundle.targetSourceMap.targets.map((item) => item.targetId),
		"targetSourceMap.targets[].targetId",
	);
	const consumerRuleByFamily = new Map(
		bundle.consumerDenominator.consumerFamilies.map((rule) => [rule.consumerFamily, rule]),
	);
	for (const target of bundle.targetSourceMap.targets) {
		const consumerRule = consumerRuleByFamily.get(target.consumerFamily);
		if (!consumerRule) {
			throw new Error(
				`targetSourceMap ${target.targetId} references unknown consumerFamily ${target.consumerFamily}`,
			);
		}
		assertNonEmpty(target.ownerSurface, `targetSourceMap ${target.targetId} ownerSurface`);
		assertNonEmpty(target.notes, `targetSourceMap ${target.targetId} notes`);
		if (target.ownerSurface !== consumerRule.ownerSurface) {
			throw new Error(
				`targetSourceMap ${target.targetId} ownerSurface must match consumer denominator`,
			);
		}
		if (target.selectedWriteTarget !== consumerRule.selectedWriteTarget) {
			throw new Error(
				`targetSourceMap ${target.targetId} selectedWriteTarget must match consumer denominator`,
			);
		}
		if (target.sourceHosts.length === 0) {
			throw new Error(`targetSourceMap ${target.targetId} must define sourceHosts`);
		}
		if (target.requiredEvidence.length === 0) {
			throw new Error(`targetSourceMap ${target.targetId} must define requiredEvidence`);
		}
		ensureUnique(target.sourceHosts, `targetSourceMap ${target.targetId}.sourceHosts`);
		ensureUnique(target.urlPatterns, `targetSourceMap ${target.targetId}.urlPatterns`);
		ensureUnique(target.titleKeywords, `targetSourceMap ${target.targetId}.titleKeywords`);
		ensureUnique(
			target.requiredEvidence,
			`targetSourceMap ${target.targetId}.requiredEvidence`,
		);
		for (const sourceHost of target.sourceHosts) {
			validateHostName(sourceHost, `targetSourceMap ${target.targetId}.sourceHosts`);
			const host = hostIndex.get(sourceHost);
			if (!host || !host.enabled) {
				throw new Error(
					`targetSourceMap ${target.targetId} references unavailable host ${sourceHost}`,
				);
			}
		}
		for (const evidence of target.requiredEvidence) {
			if (!consumerRule.requiredEvidence.includes(evidence)) {
				throw new Error(
					`targetSourceMap ${target.targetId} requiredEvidence must be allowed by consumer denominator`,
				);
			}
		}
		validateRegexList(target.urlPatterns, `targetSourceMap ${target.targetId}.urlPatterns`);
	}

	if (bundle.qcPolicy.siteId !== bundle.site.siteId) {
		throw new Error("qcPolicy.siteId must match site.siteId");
	}
	assertNonEmpty(bundle.qcPolicy.qcPolicyVersion, "qcPolicy.qcPolicyVersion");
	ensureUnique(bundle.qcPolicy.allowedReviewIssueCodes, "qcPolicy.allowedReviewIssueCodes");
	ensureUnique(bundle.qcPolicy.allowedReviewPageFamilies, "qcPolicy.allowedReviewPageFamilies");
	ensureUnique(
		bundle.qcPolicy.hostOverrides.map((item) => item.host),
		"qcPolicy.hostOverrides[].host",
	);
	for (const hostOverride of bundle.qcPolicy.hostOverrides) {
		validateHostName(hostOverride.host, "qcPolicy.hostOverrides[].host");
		if (!hostIndex.has(hostOverride.host)) {
			throw new Error(`qcPolicy.hostOverrides references unknown host ${hostOverride.host}`);
		}
		ensureUnique(
			hostOverride.allowedReviewIssueCodes,
			`qcPolicy.hostOverrides(${hostOverride.host}).allowedReviewIssueCodes`,
		);
		ensureUnique(
			hostOverride.allowedReviewPageFamilies,
			`qcPolicy.hostOverrides(${hostOverride.host}).allowedReviewPageFamilies`,
		);
	}

	if (bundle.schedulerPolicy.siteId !== bundle.site.siteId) {
		throw new Error("schedulerPolicy.siteId must match site.siteId");
	}
	assertNonEmpty(
		bundle.schedulerPolicy.schedulerPolicyVersion,
		"schedulerPolicy.schedulerPolicyVersion",
	);
	assertNonEmpty(bundle.schedulerPolicy.timezone, "schedulerPolicy.timezone");
	if (bundle.schedulerPolicy.lanes.length === 0) {
		throw new Error("schedulerPolicy.lanes must not be empty");
	}
	ensureUnique(
		bundle.schedulerPolicy.lanes.map((lane) => lane.laneId),
		"schedulerPolicy.lanes[].laneId",
	);
	const enabledLaneIntents = bundle.schedulerPolicy.lanes
		.filter((lane) => lane.enabled)
		.map((lane) => lane.runIntent);
	for (const runIntent of OFFICIAL_WEB_RUN_INTENTS) {
		if (!enabledLaneIntents.includes(runIntent)) {
			throw new Error(`schedulerPolicy must include enabled ${runIntent} lane`);
		}
	}
	for (const lane of bundle.schedulerPolicy.lanes) {
		assertNonEmpty(lane.laneId, "scheduler lane laneId");
		if (lane.notes.length === 0) {
			throw new Error(`scheduler lane ${lane.laneId} must define notes`);
		}
		if (lane.maxTotalPages < lane.maxPagesPerHost) {
			throw new Error(`scheduler lane ${lane.laneId} must keep maxTotalPages >= maxPagesPerHost`);
		}
		for (const host of lane.hostFilter) {
			if (!bundle.site.allowedHosts.includes(host)) {
				throw new Error(`scheduler lane ${lane.runIntent} references unknown host ${host}`);
			}
		}
	}
}
