import type { PublishedReaderManifestEntry } from "./published-reader-types.ts";

type ReaderLabelEntry = Pick<PublishedReaderManifestEntry, "collection" | "corpus">;

export function resolveDocumentDisplayTitle(title: string): string {
	const trimmed = typeof title === "string" ? title.trim() : "";
	if (!trimmed) {
		throw new Error("campus docs reader manifest entry requires title");
	}
	const displayTitle = trimmed.replace(/^中央民族大学/u, "").trim();
	return displayTitle || trimmed;
}

export function resolveDocumentKind(entry: ReaderLabelEntry): string {
	if (entry.collection === "curriculum_plan") {
		return "curriculumPlan";
	}
	if (entry.collection === "student_rules") {
		return "studentHandbookArticle";
	}
	return "publicRegulation";
}

export function resolveReaderLayout(entry: ReaderLabelEntry): string {
	return entry.collection === "curriculum_plan" ? "tabular" : "article";
}

export function resolveReaderMeasure(entry: ReaderLabelEntry): string {
	return entry.collection === "curriculum_plan" ? "wide" : "standard";
}

export function resolveCorpusLabel(corpus: string): string {
	return corpus === "curriculum" ? "培养方案" : corpus === "regulations" ? "规章制度" : corpus;
}

export function resolveCollectionLabel(entry: ReaderLabelEntry): string {
	if (entry.collection === "curriculum_plan") {
		return "培养方案";
	}
	if (entry.collection === "student_rules") {
		return "学生手册";
	}
	if (entry.collection === "institutional_rules") {
		return "校级规章";
	}
	if (entry.collection === "scoped_rules") {
		return "专项规章";
	}
	return entry.collection;
}
