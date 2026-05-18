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
	targetWorksetExpansion: string | null;
	targetMatches: SourcePackExecutionTargetMatch[];
	url: string;
}

export interface SourcePackExecutionPlan {
	entryCount: number;
	rows: SourcePackExecutionPlanEntry[];
	siteId: string;
	sourcePackId: string;
}

export function buildSourcePackExecutionPlan(
	siteId: string,
	options: { configRoot?: string; repoRoot?: string; sourcePackId?: string } = {},
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
		const target = config.targetSourceMap.targets.find(
			(item) =>
				item.ownerSurface === ownerSurface &&
				item.selectedWriteTarget === normalizedWriteTarget(releaseTarget),
		);
		if (!target) {
			throw new Error(
				`source-pack entry ${entry.entryId} cannot resolve admitted target for ${ownerSurface} -> ${releaseTarget}`,
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
		targetWorksetExpansion: entry.targetWorksetExpansion,
		targetMatches,
		url: entry.url,
	};
}

function buildTargetJobId(siteId: string, targetId: string): string {
	return `owtarget_${siteId}_${targetId}`.toLowerCase().replace(/[^a-z0-9]+/g, "_");
}

function normalizedWriteTarget(releaseTarget: OfficialWebSourcePackReleaseTarget): string {
	if (
		releaseTarget === "official_web/fresh_news" ||
		releaseTarget === "official_web/news_archive"
	) {
		return "";
	}
	return releaseTarget;
}
