import {
	ENABLED_PUBLIC_KINDS,
	OFFICIAL_WEB_RUN_INTENTS,
	OFFICIAL_WEB_SHELL_PAGE_FAMILIES,
	OFFICIAL_WEB_SOURCE_CHANNEL,
	type OfficialWebConfigBundle,
} from "./config-models.ts";
import {
	assertNonEmpty,
	ensureNoOverlap,
	ensureSameSet,
	ensureUnique,
	validateHostName,
	validateRegexList,
	validateSeedUrl,
	validateSourceUrl,
} from "./config-validation-common.ts";
import { validateOfficialWebConsumerTargets } from "./config-validation-targets.ts";

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

	const consumerRuleByFamily = validateOfficialWebConsumerTargets({ bundle, hostIndex });

	if (bundle.targetInventory.siteId !== bundle.site.siteId) {
		throw new Error("targetInventory.siteId must match site.siteId");
	}
	assertNonEmpty(bundle.targetInventory.schemaVersion, "targetInventory.schemaVersion");
	assertNonEmpty(bundle.targetInventory.inventoryVersion, "targetInventory.inventoryVersion");
	if (bundle.targetInventory.entries.length === 0) {
		throw new Error("targetInventory.entries must not be empty");
	}
	ensureUnique(
		bundle.targetInventory.entries.map((entry) => entry.inventoryId),
		"targetInventory.entries[].inventoryId",
	);
	const targetSourceMapById = new Map(
		bundle.targetSourceMap.targets.map((target) => [target.targetId, target]),
	);
	for (const entry of bundle.targetInventory.entries) {
		assertNonEmpty(entry.targetLabel, `targetInventory ${entry.inventoryId} targetLabel`);
		assertNonEmpty(entry.ownerSurface, `targetInventory ${entry.inventoryId} ownerSurface`);
		assertNonEmpty(
			entry.ownerCapabilityOrRuntime,
			`targetInventory ${entry.inventoryId} ownerCapabilityOrRuntime`,
		);
		assertNonEmpty(entry.previewStatus, `targetInventory ${entry.inventoryId} previewStatus`);
		assertNonEmpty(entry.notes, `targetInventory ${entry.inventoryId} notes`);
		if (entry.requiredFields.length === 0) {
			throw new Error(`targetInventory ${entry.inventoryId} must define required_fields`);
		}
		if (entry.requiredEvidence.length === 0) {
			throw new Error(`targetInventory ${entry.inventoryId} must define required_evidence`);
		}
		if (!entry.inventoryOnly && entry.sourceUrls.length === 0) {
			throw new Error(`targetInventory ${entry.inventoryId} must define source_urls`);
		}
		ensureUnique(entry.sourceHosts, `targetInventory ${entry.inventoryId}.sourceHosts`);
		ensureUnique(entry.sourceUrls, `targetInventory ${entry.inventoryId}.sourceUrls`);
		ensureUnique(entry.requiredFields, `targetInventory ${entry.inventoryId}.requiredFields`);
		ensureUnique(entry.optionalFields, `targetInventory ${entry.inventoryId}.optionalFields`);
		ensureNoOverlap(
			entry.requiredFields,
			entry.optionalFields,
			`targetInventory ${entry.inventoryId} requiredFields and optionalFields`,
		);
		ensureUnique(entry.requiredEvidence, `targetInventory ${entry.inventoryId}.requiredEvidence`);
		ensureUnique(entry.optionalEvidence, `targetInventory ${entry.inventoryId}.optionalEvidence`);
		ensureNoOverlap(
			entry.requiredEvidence,
			entry.optionalEvidence,
			`targetInventory ${entry.inventoryId} requiredEvidence and optionalEvidence`,
		);
		ensureUnique(entry.releaseBlockers, `targetInventory ${entry.inventoryId}.releaseBlockers`);

		const admissionTarget = targetSourceMapById.get(entry.admissionTargetId);
		if (!admissionTarget) {
			throw new Error(
				`targetInventory ${entry.inventoryId} references unknown admission target ${entry.admissionTargetId}`,
			);
		}
		const consumerRule = consumerRuleByFamily.get(entry.consumerFamily);
		if (!consumerRule) {
			throw new Error(
				`targetInventory ${entry.inventoryId} references unknown consumerFamily ${entry.consumerFamily}`,
			);
		}
		if (entry.consumerFamily !== admissionTarget.consumerFamily) {
			throw new Error(
				`targetInventory ${entry.inventoryId} consumerFamily must match admission target`,
			);
		}
		if (entry.ownerSurface !== admissionTarget.ownerSurface) {
			throw new Error(
				`targetInventory ${entry.inventoryId} ownerSurface must match admission target`,
			);
		}
		if (entry.ownerCapabilityOrRuntime !== consumerRule.ownerCapabilityOrRuntime) {
			throw new Error(
				`targetInventory ${entry.inventoryId} ownerCapabilityOrRuntime must match consumer denominator`,
			);
		}
		if (entry.selectedWriteTarget !== admissionTarget.selectedWriteTarget) {
			throw new Error(
				`targetInventory ${entry.inventoryId} selectedWriteTarget must match admission target`,
			);
		}
		if (entry.materializationPolicy !== admissionTarget.materializationPolicy) {
			throw new Error(
				`targetInventory ${entry.inventoryId} materializationPolicy must match admission target`,
			);
		}
		if (entry.inventoryOnly !== admissionTarget.inventoryOnly) {
			throw new Error(
				`targetInventory ${entry.inventoryId} inventoryOnly must match admission target`,
			);
		}
		if (entry.inventoryOnly && entry.selectedWriteTarget) {
			throw new Error(
				`targetInventory ${entry.inventoryId} inventory-only selectedWriteTarget must be empty`,
			);
		}
		for (const sourceHost of entry.sourceHosts) {
			validateHostName(sourceHost, `targetInventory ${entry.inventoryId}.sourceHosts`);
			if (!admissionTarget.sourceHosts.includes(sourceHost)) {
				throw new Error(
					`targetInventory ${entry.inventoryId} sourceHosts must be admitted by target-source-map`,
				);
			}
			const host = hostIndex.get(sourceHost);
			if (!host?.enabled) {
				throw new Error(
					`targetInventory ${entry.inventoryId} references unavailable host ${sourceHost}`,
				);
			}
		}
		for (const sourceUrl of entry.sourceUrls) {
			validateSourceUrl(
				sourceUrl,
				entry.sourceHosts,
				`targetInventory ${entry.inventoryId}.sourceUrls`,
			);
		}
		for (const evidence of entry.requiredEvidence) {
			if (!admissionTarget.requiredEvidence.includes(evidence)) {
				throw new Error(
					`targetInventory ${entry.inventoryId} requiredEvidence must be allowed by admission target`,
				);
			}
		}
		for (const evidence of entry.optionalEvidence) {
			if (!admissionTarget.optionalEvidence.includes(evidence)) {
				throw new Error(
					`targetInventory ${entry.inventoryId} optionalEvidence must be allowed by admission target`,
				);
			}
		}
		ensureSameSet(
			entry.requiredEvidence,
			admissionTarget.requiredEvidence,
			`targetInventory ${entry.inventoryId} requiredEvidence must match admission target`,
		);
		ensureSameSet(
			entry.optionalEvidence,
			admissionTarget.optionalEvidence,
			`targetInventory ${entry.inventoryId} optionalEvidence must match admission target`,
		);
		if (entry.previewStatus === "ready_for_selected_write" && entry.releaseBlockers.length > 0) {
			throw new Error(
				`targetInventory ${entry.inventoryId} ready_for_selected_write cannot have releaseBlockers`,
			);
		}
	}

	if (bundle.sourcePackManifest.siteId !== bundle.site.siteId) {
		throw new Error("sourcePackManifest.siteId must match site.siteId");
	}
	assertNonEmpty(bundle.sourcePackManifest.schemaVersion, "sourcePackManifest.schemaVersion");
	assertNonEmpty(bundle.sourcePackManifest.sourcePackId, "sourcePackManifest.sourcePackId");
	if (bundle.sourcePackManifest.entries.length === 0) {
		throw new Error("sourcePackManifest.entries must not be empty");
	}
	ensureUnique(
		bundle.sourcePackManifest.entries.map((entry) => entry.entryId),
		"sourcePackManifest.entries[].entryId",
	);
	const allowedOwnerToTarget = new Map<string, string>([
		["service_guide_lookup", "campus_services/service_guide"],
		["contact_directory_lookup", "campus_services/contact_directory"],
		["academic_calendar_lookup", "calendar/academic_calendar"],
		["official_web/stable_reference", "official_web/stable_reference"],
		["future_notice_runtime", "official_web/fresh_news"],
		["regulations/institutional_rules", "regulations/institutional_rules"],
		["regulations/student_rules", "regulations/student_rules"],
		["regulations/scoped_rules", "regulations/scoped_rules"],
	]);
	for (const entry of bundle.sourcePackManifest.entries) {
		assertNonEmpty(entry.url, `sourcePackManifest ${entry.entryId} url`);
		validateSourceUrl(
			entry.url,
			bundle.site.allowedHosts,
			`sourcePackManifest ${entry.entryId}.url`,
		);
		ensureUnique(entry.demandIds, `sourcePackManifest ${entry.entryId}.demandIds`);
		ensureUnique(entry.ownerSurfaces, `sourcePackManifest ${entry.entryId}.ownerSurfaces`);
		ensureUnique(entry.releaseTargets, `sourcePackManifest ${entry.entryId}.releaseTargets`);
		ensureUnique(entry.expectedFacts, `sourcePackManifest ${entry.entryId}.expectedFacts`);
		ensureUnique(entry.evalQuestions, `sourcePackManifest ${entry.entryId}.evalQuestions`);
		if (entry.targetWorksetExpansion != null && entry.answerBearing) {
			throw new Error(
				`sourcePackManifest ${entry.entryId} target-workset expansion row must not be answer-bearing`,
			);
		}
		if (entry.answerBearing) {
			if (entry.demandIds.length === 0) {
				throw new Error(`sourcePackManifest ${entry.entryId} must define demandIds`);
			}
			if (entry.ownerSurfaces.length === 0) {
				throw new Error(`sourcePackManifest ${entry.entryId} must define ownerSurfaces`);
			}
			if (entry.releaseTargets.length === 0) {
				throw new Error(`sourcePackManifest ${entry.entryId} must define releaseTargets`);
			}
			if (entry.expectedFacts.length === 0) {
				throw new Error(`sourcePackManifest ${entry.entryId} must define expectedFacts`);
			}
			if (entry.evalQuestions.length === 0) {
				throw new Error(`sourcePackManifest ${entry.entryId} must define evalQuestions`);
			}
		} else if (entry.targetWorksetExpansion == null && entry.evalQuestions.length > 0) {
			// Non-answer-bearing rows stay discovery-only; eval questions only belong to answer-bearing rows
			throw new Error(
				`sourcePackManifest ${entry.entryId} non-answer-bearing row must not define evalQuestions`,
			);
		}
		if (entry.sourceKind === "dynamic_shell_excluded" && entry.answerBearing) {
			throw new Error(
				`sourcePackManifest ${entry.entryId} dynamic shell page must not be answer-bearing`,
			);
		}
		if (entry.releaseTargets.includes("official_web/fresh_news")) {
			throw new Error(
				`sourcePackManifest ${entry.entryId} attempts to open official_web/fresh_news or official_web/news_archive`,
			);
		}
		if (entry.releaseTargets.includes("official_web/news_archive")) {
			throw new Error(
				`sourcePackManifest ${entry.entryId} attempts to open official_web/fresh_news or official_web/news_archive`,
			);
		}
		if (
			entry.contentFamily === "public_notice_news" &&
			entry.answerBearing &&
			entry.releaseTargets.some(
				(target) => target === "official_web/fresh_news" || target === "official_web/news_archive",
			)
		) {
			throw new Error(
				`sourcePackManifest ${entry.entryId} attempts to open official_web/fresh_news or official_web/news_archive`,
			);
		}
		if (
			(entry.ownerSurfaces.includes("academic_calendar_lookup") ||
				entry.releaseTargets.includes("calendar/academic_calendar")) &&
			entry.contentFamily !== "academic_calendar_reference"
		) {
			throw new Error(
				`sourcePackManifest ${entry.entryId} academic calendar row must use academic_calendar_reference content_family`,
			);
		}
		if (entry.ownerSurfaces.length !== entry.releaseTargets.length) {
			throw new Error(
				`sourcePackManifest ${entry.entryId} multi-owner row must map each owner surface to a compatible release target`,
			);
		}
		for (let index = 0; index < entry.ownerSurfaces.length; index += 1) {
			const ownerSurface = entry.ownerSurfaces[index];
			const releaseTarget = entry.releaseTargets[index];
			const expectedTarget = allowedOwnerToTarget.get(ownerSurface);
			if (expectedTarget !== releaseTarget) {
				throw new Error(
					`sourcePackManifest ${entry.entryId} multi-owner row must map each owner surface to a compatible release target`,
				);
			}
		}
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
