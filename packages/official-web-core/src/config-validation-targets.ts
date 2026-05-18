import {
	OFFICIAL_WEB_CONSUMER_FAMILIES,
	type OfficialWebConfigBundle,
	type OfficialWebConsumerFamily,
	type OfficialWebConsumerFamilyRule,
	type OfficialWebHostPolicy,
} from "./config-models.ts";
import {
	assertNonEmpty,
	ensureNoOverlap,
	ensureSameSet,
	ensureUnique,
	validateHostName,
	validateRegexList,
} from "./config-validation-common.ts";

export function validateOfficialWebConsumerTargets(input: {
	bundle: OfficialWebConfigBundle;
	hostIndex: Map<string, OfficialWebHostPolicy>;
}): Map<OfficialWebConsumerFamily, OfficialWebConsumerFamilyRule> {
	const { bundle, hostIndex } = input;
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
			rule.optionalEvidence,
			`consumerDenominator ${rule.consumerFamily}.optionalEvidence`,
		);
		ensureNoOverlap(
			rule.requiredEvidence,
			rule.optionalEvidence,
			`consumerDenominator ${rule.consumerFamily} requiredEvidence and optionalEvidence`,
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
		} else if (rule.consumerFamily === "regulation_candidate") {
			if (rule.materializationPolicy !== "release_gate_required") {
				throw new Error(
					"regulation_candidate must use materializationPolicy=release_gate_required",
				);
			}
			if (rule.selectedWriteTarget !== "regulations/institutional_rules") {
				throw new Error(
					"regulation_candidate selectedWriteTarget must be regulations/institutional_rules",
				);
			}
		} else if (rule.consumerFamily === "student_regulation_candidate") {
			if (rule.materializationPolicy !== "release_gate_required") {
				throw new Error(
					"student_regulation_candidate must use materializationPolicy=release_gate_required",
				);
			}
			if (rule.selectedWriteTarget !== "regulations/student_rules") {
				throw new Error(
					"student_regulation_candidate selectedWriteTarget must be regulations/student_rules",
				);
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

	const consumerRuleByFamily = new Map(
		bundle.consumerDenominator.consumerFamilies.map((rule) => [rule.consumerFamily, rule]),
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
		if (target.materializationPolicy !== consumerRule.materializationPolicy) {
			throw new Error(
				`targetSourceMap ${target.targetId} materializationPolicy must match consumer denominator`,
			);
		}
		if (target.reviewPolicy !== consumerRule.reviewPolicy) {
			throw new Error(
				`targetSourceMap ${target.targetId} reviewPolicy must match consumer denominator`,
			);
		}
		if (target.sourceHosts.length === 0) {
			throw new Error(`targetSourceMap ${target.targetId} must define sourceHosts`);
		}
		if (target.urlHints.length === 0 && target.titleHints.length === 0) {
			throw new Error(`targetSourceMap ${target.targetId} must define urlHints or titleHints`);
		}
		if (target.requiredEvidence.length === 0) {
			throw new Error(`targetSourceMap ${target.targetId} must define requiredEvidence`);
		}
		ensureUnique(target.sourceHosts, `targetSourceMap ${target.targetId}.sourceHosts`);
		ensureUnique(target.urlHints, `targetSourceMap ${target.targetId}.urlHints`);
		ensureUnique(target.titleHints, `targetSourceMap ${target.targetId}.titleHints`);
		ensureUnique(target.requiredEvidence, `targetSourceMap ${target.targetId}.requiredEvidence`);
		ensureUnique(target.optionalEvidence, `targetSourceMap ${target.targetId}.optionalEvidence`);
		ensureNoOverlap(
			target.requiredEvidence,
			target.optionalEvidence,
			`targetSourceMap ${target.targetId} requiredEvidence and optionalEvidence`,
		);
		ensureSameSet(
			target.requiredEvidence,
			consumerRule.requiredEvidence,
			`targetSourceMap ${target.targetId} requiredEvidence must match consumer denominator`,
		);
		ensureSameSet(
			target.optionalEvidence,
			consumerRule.optionalEvidence,
			`targetSourceMap ${target.targetId} optionalEvidence must match consumer denominator`,
		);
		if (target.inventoryOnly) {
			if (target.selectedWriteTarget) {
				throw new Error(
					`targetSourceMap ${target.targetId} inventory-only selectedWriteTarget must be empty`,
				);
			}
			if (target.materializationPolicy !== "inventory_only") {
				throw new Error(
					`targetSourceMap ${target.targetId} inventoryOnly requires materializationPolicy=inventory_only`,
				);
			}
			if (target.retentionPolicy !== "inventory_only") {
				throw new Error(
					`targetSourceMap ${target.targetId} inventoryOnly requires retentionPolicy=inventory_only`,
				);
			}
		} else if (target.materializationPolicy === "inventory_only") {
			throw new Error(
				`targetSourceMap ${target.targetId} materializationPolicy=inventory_only requires inventoryOnly=true`,
			);
		} else if (target.retentionPolicy === "inventory_only") {
			throw new Error(
				`targetSourceMap ${target.targetId} retentionPolicy=inventory_only requires inventoryOnly=true`,
			);
		}
		for (const sourceHost of target.sourceHosts) {
			validateHostName(sourceHost, `targetSourceMap ${target.targetId}.sourceHosts`);
			const host = hostIndex.get(sourceHost);
			if (!host?.enabled) {
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
		for (const evidence of target.optionalEvidence) {
			if (!consumerRule.optionalEvidence.includes(evidence)) {
				throw new Error(
					`targetSourceMap ${target.targetId} optionalEvidence must be allowed by consumer denominator`,
				);
			}
		}
		validateRegexList(target.urlHints, `targetSourceMap ${target.targetId}.urlHints`);
	}
	return consumerRuleByFamily;
}
