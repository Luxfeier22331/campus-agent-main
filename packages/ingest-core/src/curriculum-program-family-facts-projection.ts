import {
	buildDigestVersionId,
	type CurriculumProgramFamilyConfig,
	type CurriculumProgramFamilyConfigEntry,
	type CurriculumProjectionDocument,
	type CurriculumRawAssetRecord,
	type CurriculumSplitManifestDocument,
	firstVisibilityLevel,
	firstVisibilityScope,
	MANUAL_CURATED_SOURCE_CHANNEL,
	POLICY_PROJECTION_VERSION,
	projectionDocument,
	sourceStatus,
	unionEntitlementGroups,
} from "./curriculum-facts-shared.ts";

export function buildCurriculumProgramFamilyFactsDocuments(input: {
	familyConfig: CurriculumProgramFamilyConfig;
	rawAssetRecord: CurriculumRawAssetRecord;
	sourcePdf: string;
	splitManifestDocuments: readonly CurriculumSplitManifestDocument[];
	importSource?: string;
}): CurriculumProjectionDocument[] {
	const activeDocuments = new Map(
		input.splitManifestDocuments
			.filter((document) => sourceStatus(document) === "active")
			.map((document) => [document.document_id, document]),
	);
	const documents: CurriculumProjectionDocument[] = [];
	for (const family of input.familyConfig.families) {
		if (family.mode !== "direct_answer_family") {
			continue;
		}
		const memberDocuments = (family.member_program_ids ?? [])
			.map((documentId) => activeDocuments.get(documentId))
			.filter((document): document is CurriculumSplitManifestDocument => Boolean(document));
		if (memberDocuments.length === 0) {
			continue;
		}
		const documentId = buildProgramFamilyDocumentId(family.canonical_program_family_id);
		const versionId = buildDigestVersionId(
			`${input.rawAssetRecord.raw_version_id}|${family.canonical_program_family_id}`,
			`${input.rawAssetRecord.raw_version_id}:program-family`,
		);
		const row = programFamilyDocumentUnit({
			documentId,
			family,
			memberDocuments,
			sourcePdf: input.sourcePdf,
			versionId,
		});
		documents.push(
			projectionDocument({
				additionalProcessedObjectKeys: [],
				collection: "program_family_facts",
				corpus: "curriculum",
				importSource: input.importSource ?? "provider_response_replay",
				providerResponseObjectKey: null,
				rawAssetRecord: input.rawAssetRecord,
				row,
				sourceChannel: MANUAL_CURATED_SOURCE_CHANNEL,
				sourceLabel: `${input.rawAssetRecord.object_key}#${documentId}`,
				status: "active",
				title: family.source_title,
				visibilityScope: firstVisibilityScope(memberDocuments),
				year: null,
			}),
		);
	}
	return documents;
}

function programFamilyDocumentUnit(input: {
	documentId: string;
	family: CurriculumProgramFamilyConfigEntry;
	memberDocuments: readonly CurriculumSplitManifestDocument[];
	sourcePdf: string;
	versionId: string;
}): Record<string, unknown> {
	const sourceUrl = `campus-agent://rag-data/canonical/curriculum_plan/program-family/${input.family.canonical_program_family_title}.md`;
	return {
		doc_id: input.documentId,
		version_id: input.versionId,
		chunk_id: `${input.documentId}:row-0001`,
		clean_text: input.family.answer_snippet,
		source_pdf: input.sourcePdf,
		source_url: sourceUrl,
		source: { id: sourceUrl },
		page_start: Math.min(...input.memberDocuments.map((document) => document.page_start)),
		page_end: Math.max(...input.memberDocuments.map((document) => document.page_end)),
		entitlement_groups: unionEntitlementGroups(input.memberDocuments),
		visibility_scope: firstVisibilityScope(input.memberDocuments),
		visibility_level: firstVisibilityLevel(input.memberDocuments),
		policy_projection_version: POLICY_PROJECTION_VERSION,
		anchor: {
			fact_type: "family_membership",
			section_path: [input.family.canonical_program_family_title],
			detail_label: "成员专业",
		},
		unit_type: "program_family_fact",
		root_unit_id: `${input.documentId}:root`,
		metadata: {
			source_title: input.family.source_title,
			content_kind: "program_family_fact",
			content_role: "family_membership",
			detail_label: "成员专业",
			is_answer_bearing: true,
			canonical_program_family_id: input.family.canonical_program_family_id,
			canonical_program_family_title: input.family.canonical_program_family_title,
			program_family_mode: input.family.mode,
			member_program_ids: [...(input.family.member_program_ids ?? [])],
			member_program_titles: [...(input.family.member_program_titles ?? [])],
			source_doc_ids: input.memberDocuments.map((document) => document.document_id),
		},
	};
}

function buildProgramFamilyDocumentId(canonicalProgramFamilyId: string): string {
	return `program_family_facts:${canonicalProgramFamilyId.replace(/^program_family:/u, "")}:membership`;
}
