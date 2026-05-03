import {
	loadOfficialWebConfig,
	type OfficialWebConfigBundle,
	type OfficialWebConsumerFamily,
	type OfficialWebConsumerMaterializationPolicy,
	type OfficialWebSourcePackManifestEntry,
	type OfficialWebSourcePackOwnerSurface,
	type OfficialWebSourcePackReleaseTarget,
	type OfficialWebTargetRetentionPolicy,
} from "official-web-core";

export interface SourcePackExecutionTargetMatch {
	compositionGroup: string | null;
	compositionRole: string | null;
	consumerFamily: OfficialWebConsumerFamily;
	materializationPolicy: OfficialWebConsumerMaterializationPolicy;
	ownerSurface: string;
	releaseTarget: OfficialWebSourcePackReleaseTarget;
	retentionPolicy: OfficialWebTargetRetentionPolicy;
	reviewPolicy: string;
	selectedWriteTarget: string;
	sourcePackEntryId: string;
	sourcePackId: string;
	targetId: string;
	targetJobId: string;
}

export interface SourcePackExecutionPlanEntry {
	answerBearing: boolean;
	compositionGroup: string | null;
	compositionRole: string | null;
	contentFamily: string;
	demandIds: string[];
	entryId: string;
	evalQuestions: string[];
	expectedFacts: string[];
	host: string;
	ownerSurfaces: OfficialWebSourcePackOwnerSurface[];
	refreshPosture: string;
	releaseTargets: OfficialWebSourcePackReleaseTarget[];
	sourceKind: string;
	targetMatches: SourcePackExecutionTargetMatch[];
	url: string;
}

export interface SourcePackExecutionPlan {
	entryCount: number;
	rows: SourcePackExecutionPlanEntry[];
	siteId: string;
	sourcePackId: string;
}

const OWNER_TO_TARGET_ID: Record<OfficialWebSourcePackOwnerSurface, string> = {
	"contact_directory_lookup": "campus-services-contact-directory",
	"future_notice_runtime": "official-web-notice-news-inventory",
	"official_web/stable_reference": "official-web-stable-reference",
	"regulations/institutional_rules": "official-web-institutional-rules",
	"regulations/scoped_rules": "official-web-stable-reference",
	"service_guide_lookup": "campus-services-service-guide",
};

export function buildSourcePackExecutionPlan(
	siteId: string,
	options: { configRoot?: string; repoRoot?: string } = {},
): SourcePackExecutionPlan {
	const config = loadOfficialWebConfig(siteId, options);
	return {
		entryCount: config.sourcePackManifest.entries.length,
		rows: config.sourcePackManifest.entries.map((entry) => buildExecutionPlanEntry(config, entry)),
		siteId: config.sourcePackManifest.siteId,
		sourcePackId: config.sourcePackManifest.sourcePackId,
	};
}

function buildExecutionPlanEntry(
	config: OfficialWebConfigBundle,
	entry: OfficialWebSourcePackManifestEntry,
): SourcePackExecutionPlanEntry {
	const targetMatches = entry.ownerSurfaces.map((ownerSurface, index) => {
		const releaseTarget = entry.releaseTargets[index];
		const targetId = OWNER_TO_TARGET_ID[ownerSurface];
		const target = config.targetSourceMap.targets.find((item) => item.targetId === targetId);
		if (!target) {
			throw new Error(
				`source-pack entry ${entry.entryId} cannot resolve admitted target ${targetId}`,
			);
		}
		return {
			compositionGroup: entry.compositionGroup,
			compositionRole: entry.compositionRole,
			consumerFamily: target.consumerFamily,
			materializationPolicy: target.materializationPolicy,
			ownerSurface: target.ownerSurface,
			releaseTarget,
			retentionPolicy: target.retentionPolicy,
			reviewPolicy: target.reviewPolicy,
			selectedWriteTarget: target.selectedWriteTarget,
			sourcePackEntryId: entry.entryId,
			sourcePackId: config.sourcePackManifest.sourcePackId,
			targetId: target.targetId,
			targetJobId: buildTargetJobId(config.site.siteId, target.targetId),
		} satisfies SourcePackExecutionTargetMatch;
	});
	return {
		answerBearing: entry.answerBearing,
		compositionGroup: entry.compositionGroup,
		compositionRole: entry.compositionRole,
		contentFamily: entry.contentFamily,
		demandIds: [...entry.demandIds],
		entryId: entry.entryId,
		evalQuestions: [...entry.evalQuestions],
		expectedFacts: [...entry.expectedFacts],
		host: new URL(entry.url).hostname.toLowerCase(),
		ownerSurfaces: [...entry.ownerSurfaces],
		refreshPosture: entry.refreshPosture,
		releaseTargets: [...entry.releaseTargets],
		sourceKind: entry.sourceKind,
		targetMatches,
		url: entry.url,
	};
}

function buildTargetJobId(siteId: string, targetId: string): string {
	return `owtarget_${siteId}_${targetId}`.toLowerCase().replace(/[^a-z0-9]+/g, "_");
}
