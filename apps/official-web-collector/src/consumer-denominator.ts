import type {
	OfficialWebConsumerDenominator,
	OfficialWebConsumerFamilyRule,
	OfficialWebConsumerMatch,
	OfficialWebConsumerRequiredEvidence,
} from "./official-web-core.ts";
import type { CollectedPageArtifact } from "./page-artifacts-contract.ts";

export interface OfficialWebConsumerDenominatorEvaluation {
	consumerDenominatorVersion: string;
	consumerMatches: OfficialWebConsumerMatch[];
	retentionDecision: "retain_source_truth" | "discovery_only" | "reject";
	rejectionReason: string | null;
}

export interface OfficialWebConsumerDenominatorSummary {
	fetchedPages: number;
	retainedSourceTruthPages: number;
	discoveryOnlyPages: number;
	rejectedPages: number;
	consumerFamilyCounts: Record<string, number>;
	rejectedReasonCounts: Record<string, number>;
}

type PageForConsumerEvaluation = Pick<CollectedPageArtifact, "pageManifest" | "contentBlocks">;

const PHONE_RE = /(?<!\d)(?:0\d{2,3}[-\s]?)?\d{7,8}(?!\d)/u;
const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/iu;
const TIME_RE = /(?:[01]?\d|2[0-3])[:：][0-5]\d/u;

export function evaluateOfficialWebConsumerDenominator(input: {
	consumerDenominator: OfficialWebConsumerDenominator;
	page: PageForConsumerEvaluation;
}): OfficialWebConsumerDenominatorEvaluation {
	const pageText = buildConsumerText(input.page);
	const normalizedUrl = input.page.pageManifest.normalizedCanonicalUrl;
	const consumerMatches = input.consumerDenominator.consumerFamilies
		.map((rule) => matchConsumerFamily(rule, input.page, pageText, normalizedUrl))
		.filter((item): item is OfficialWebConsumerMatch => item != null);

	if (consumerMatches.length > 0) {
		return {
			consumerDenominatorVersion: input.consumerDenominator.denominatorVersion,
			consumerMatches,
			retentionDecision: "retain_source_truth",
			rejectionReason: null,
		};
	}

	if (input.page.pageManifest.pageFamily === "listing_page") {
		return {
			consumerDenominatorVersion: input.consumerDenominator.denominatorVersion,
			consumerMatches,
			retentionDecision: "discovery_only",
			rejectionReason: "listing_page_without_consumer_denominator_match",
		};
	}

	return {
		consumerDenominatorVersion: input.consumerDenominator.denominatorVersion,
		consumerMatches,
		retentionDecision: "reject",
		rejectionReason: "no_consumer_denominator_match",
	};
}

export function applyOfficialWebConsumerDenominator(input: {
	consumerDenominator: OfficialWebConsumerDenominator;
	pages: CollectedPageArtifact[];
}): { retainedPages: CollectedPageArtifact[]; summary: OfficialWebConsumerDenominatorSummary } {
	const retainedPages: CollectedPageArtifact[] = [];
	const consumerFamilyCounts: Record<string, number> = {};
	const rejectedReasonCounts: Record<string, number> = {};
	let discoveryOnlyPages = 0;
	let rejectedPages = 0;

	for (const page of input.pages) {
		const evaluation = evaluateOfficialWebConsumerDenominator({
			consumerDenominator: input.consumerDenominator,
			page,
		});
		const targetRetentionOverride = hasTargetSourceTruthRetention(page);
		if (
			evaluation.retentionDecision === "retain_source_truth" ||
			targetRetentionOverride ||
			input.consumerDenominator.enforcementMode === "audit_only"
		) {
			const retainedDecision =
				evaluation.retentionDecision === "retain_source_truth" || targetRetentionOverride
					? "retain_source_truth"
					: evaluation.retentionDecision;
			const retainedRejectionReason =
				evaluation.rejectionReason && targetRetentionOverride
					? "target_workset_retention_policy"
					: evaluation.rejectionReason;
			const pageManifest = {
				...page.pageManifest,
				consumerDenominatorVersion: evaluation.consumerDenominatorVersion,
				consumerMatches: evaluation.consumerMatches,
				consumerRetentionDecision: retainedDecision,
				consumerRejectionReason: retainedRejectionReason,
			} satisfies CollectedPageArtifact["pageManifest"];
			const retainedPage = {
				...page,
				pageManifest,
				files: page.files.map((file) =>
					file.relativePath === "source-truth/page-manifest.json"
						? {
								...file,
								data: new TextEncoder().encode(JSON.stringify(pageManifest, null, 2)),
							}
						: file,
				),
			};
			retainedPages.push(retainedPage);
			for (const match of evaluation.consumerMatches) {
				consumerFamilyCounts[match.consumerFamily] =
					(consumerFamilyCounts[match.consumerFamily] ?? 0) + 1;
			}
			continue;
		}

		if (evaluation.retentionDecision === "discovery_only") {
			discoveryOnlyPages += 1;
		} else {
			rejectedPages += 1;
		}
		const reason = evaluation.rejectionReason ?? "unknown_consumer_denominator_rejection";
		rejectedReasonCounts[reason] = (rejectedReasonCounts[reason] ?? 0) + 1;
	}

	return {
		retainedPages,
		summary: {
			fetchedPages: input.pages.length,
			retainedSourceTruthPages: retainedPages.length,
			discoveryOnlyPages,
			rejectedPages,
			consumerFamilyCounts,
			rejectedReasonCounts,
		},
	};
}

function hasTargetSourceTruthRetention(page: CollectedPageArtifact): boolean {
	return (
		page.pageManifest.targetMatches?.some(
			(match) => match.retentionPolicy === "retain_source_truth",
		) ?? false
	);
}

function matchConsumerFamily(
	rule: OfficialWebConsumerFamilyRule,
	page: PageForConsumerEvaluation,
	pageText: string,
	normalizedUrl: string,
): OfficialWebConsumerMatch | null {
	if (!rule.pageFamilies.includes(page.pageManifest.pageFamily)) {
		return null;
	}
	const titleText = buildConsumerTitleText(page);
	const negativeMatches = matchedRegexes(rule.negativePatterns, titleText, normalizedUrl);
	if (negativeMatches.length > 0) {
		return null;
	}

	const matchedKeywords = rule.titleKeywords.filter((keyword) => titleText.includes(keyword));
	const matchedPatterns = matchedRegexes(rule.pathPatterns, normalizedUrl);
	const matchedEvidence = resolveMatchedEvidence(rule, page, pageText);
	if (matchedEvidence.length < rule.minimumMatchedEvidenceCount) {
		return null;
	}

	if (
		matchedKeywords.length === 0 &&
		matchedPatterns.length === 0 &&
		(rule.requiresKeywordOrPathMatch || !allowsEvidenceOnlyMatch(rule))
	) {
		return null;
	}
	if (
		rule.consumerFamily === "service_guide_candidate" &&
		!matchedEvidence.some((item) =>
			["service_process", "service_entry", "service_material"].includes(item),
		)
	) {
		return null;
	}
	if (
		rule.consumerFamily === "academic_calendar_candidate" &&
		!matchedEvidence.includes("calendar_arrangement")
	) {
		return null;
	}

	return {
		consumerFamily: rule.consumerFamily,
		ownerSurface: rule.ownerSurface,
		ownerAgentOrRuntime: rule.ownerAgentOrRuntime,
		materializationPolicy: rule.materializationPolicy,
		selectedWriteTarget: rule.selectedWriteTarget,
		reviewPolicy: rule.reviewPolicy,
		matchedEvidence,
		matchedKeywords,
		matchedPatterns,
	};
}

function resolveMatchedEvidence(
	rule: OfficialWebConsumerFamilyRule,
	page: PageForConsumerEvaluation,
	pageText: string,
): OfficialWebConsumerRequiredEvidence[] {
	const availableEvidence = new Set<OfficialWebConsumerRequiredEvidence>();
	if (PHONE_RE.test(pageText)) {
		availableEvidence.add("phone");
	}
	if (EMAIL_RE.test(pageText)) {
		availableEvidence.add("email");
	}
	if (/(办公地点|办理地点|地址|校区|楼|大厅|办公室|中心)/u.test(pageText)) {
		availableEvidence.add("location");
	}
	if (
		/(办公时间|办理时间|服务时间|开放时间|周一|周二|周三|周四|周五|周六|周日)/u.test(pageText) ||
		TIME_RE.test(pageText)
	) {
		availableEvidence.add("office_hours");
	}
	if (/(办理流程|流程|步骤|补办|挂失|报销|预约)/u.test(pageText)) {
		availableEvidence.add("service_process");
	}
	if (/(入口|系统|\bAPP\b|小程序|自助|线下|窗口|前台)/iu.test(pageText)) {
		availableEvidence.add("service_entry");
	}
	if (/(材料|申请表|证明|身份证|证件|附件)/u.test(pageText)) {
		availableEvidence.add("service_material");
	}
	if (/(校历|教学周|补课安排|放假安排|节假日安排|学期安排|学年安排)/u.test(pageText)) {
		availableEvidence.add("calendar_arrangement");
	}
	if (isStableReferenceCandidate(rule, page, pageText)) {
		availableEvidence.add("stable_reference");
	}
	if (isNoticeNewsCandidate(rule, page, pageText)) {
		availableEvidence.add("notice_news");
	}

	return [...rule.requiredEvidence, ...rule.optionalEvidence].filter((item) =>
		availableEvidence.has(item),
	);
}

function isStableReferenceCandidate(
	rule: OfficialWebConsumerFamilyRule,
	page: PageForConsumerEvaluation,
	pageText: string,
): boolean {
	return (
		rule.consumerFamily === "stable_reference_candidate" &&
		(page.pageManifest.pageFamily === "directory_page" ||
			page.pageManifest.pageFamily === "generic_content_page" ||
			page.pageManifest.pageFamily === "article_detail") &&
		!/(新闻|通知|公告|讲座|活动|公示)/u.test(pageText)
	);
}

function isNoticeNewsCandidate(
	rule: OfficialWebConsumerFamilyRule,
	page: PageForConsumerEvaluation,
	pageText: string,
): boolean {
	return (
		rule.consumerFamily === "notice_news_candidate" &&
		page.pageManifest.pageFamily === "article_detail" &&
		(Boolean(page.pageManifest.publishedAt) || /(新闻|通知|公告|讲座|活动|公示)/u.test(pageText))
	);
}

function buildConsumerText(page: PageForConsumerEvaluation): string {
	const title = page.pageManifest.pageTitleNormalized;
	const url = page.pageManifest.normalizedCanonicalUrl;
	const mainContent = page.contentBlocks
		.filter((block) => block.isMainContent || block.blockRole === "title")
		.map((block) => block.textNormalized ?? block.linkText ?? "")
		.filter(Boolean)
		.join("\n");
	return `${title}\n${url}\n${mainContent}`;
}

function buildConsumerTitleText(page: PageForConsumerEvaluation): string {
	const title = page.pageManifest.pageTitleNormalized;
	const titleBlocks = page.contentBlocks
		.filter((block) => block.blockRole === "title")
		.map((block) => block.textNormalized ?? block.linkText ?? "")
		.filter(Boolean)
		.join("\n");
	return `${title}\n${titleBlocks}`;
}

function matchedRegexes(patterns: string[], ...values: string[]): string[] {
	return patterns.filter((pattern) => {
		const regex = new RegExp(pattern, "iu");
		return values.some((value) => regex.test(value));
	});
}

function allowsEvidenceOnlyMatch(rule: OfficialWebConsumerFamilyRule): boolean {
	return (
		rule.consumerFamily === "contact_directory_candidate" ||
		rule.consumerFamily === "service_guide_candidate"
	);
}
