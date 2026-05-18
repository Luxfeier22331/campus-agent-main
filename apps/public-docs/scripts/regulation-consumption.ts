import { readFileSync } from "node:fs";

import { REPO_ROOT } from "./sync-real-docs/shared";

export type RegulationNavGroup = "student" | "public_service" | "staff_governance";

export interface RegulationConsumptionEntry {
	audience_segment: RegulationNavGroup;
	canonical_scope: string;
	docs_nav_group: RegulationNavGroup;
	document_id: string;
	rag_default_exposure: "include" | "gated";
	source_url: string;
	title: string;
	title_aliases?: string[];
}

interface RegulationConsumptionManifest {
	docs_category: string;
	documents: RegulationConsumptionEntry[];
	nav_groups: Array<{
		display_name: string;
		group_id: RegulationNavGroup;
		slug: string;
	}>;
}

const MANIFEST_PATH = `${REPO_ROOT}/configs/ingestion/regulations/public-regulation-consumption.v1.json`;

let cachedManifest: RegulationConsumptionManifest | null = null;

export function loadRegulationConsumptionManifest(): RegulationConsumptionManifest {
	if (cachedManifest) {
		return cachedManifest;
	}
	cachedManifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as RegulationConsumptionManifest;
	return cachedManifest;
}

export function buildRegulationConsumptionByDocumentId(): Map<string, RegulationConsumptionEntry> {
	return new Map(
		loadRegulationConsumptionManifest().documents.map((entry) => [entry.document_id, entry]),
	);
}

export function resolveRegulationGroupMeta(groupId: RegulationNavGroup): {
	displayName: string;
	slug: string;
} {
	const group = loadRegulationConsumptionManifest().nav_groups.find(
		(candidate) => candidate.group_id === groupId,
	);
	if (!group) {
		throw new Error(`unknown regulation nav group: ${groupId}`);
	}
	return {
		displayName: group.display_name,
		slug: group.slug,
	};
}
