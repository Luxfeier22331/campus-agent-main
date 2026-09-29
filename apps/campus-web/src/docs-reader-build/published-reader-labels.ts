import type { PublishedReaderManifestEntry } from "./published-reader-types.ts";

type ReaderLabelEntry = Pick<PublishedReaderManifestEntry, "collection" | "corpus">;

const CURRICULUM_COLLECTIONS = new Set(["undergraduate", "second_degree", "general_education"]);

export function resolveDocumentDisplayTitle(title: string): string {
	const trimmed = typeof title === "string" ? title.trim() : "";
	if (!trimmed) {
		throw new Error("campus docs reader manifest entry requires title");
	}
	const displayTitle = trimmed.replace(/^中央民族大学/u, "").trim() || trimmed;
	return displayTitle
		.replace(/\(([^()\n]*\p{Script=Han}[^()\n]*)\)/gu, "（$1）")
		.replace(/([\p{Script=Han}）\d]):(?=\s*(?:[\p{Script=Han}（]|$))/gu, "$1：");
}

export function resolveReaderLayout(entry: ReaderLabelEntry): string {
	return isCurriculumCollection(entry) ? "tabular" : "article";
}

export function resolveReaderMeasure(entry: ReaderLabelEntry): string {
	return isCurriculumCollection(entry) ? "wide" : "standard";
}

export function resolveCorpusLabel(corpus: string): string {
	return corpus === "curriculum" ? "培养方案" : corpus === "regulations" ? "规章制度" : corpus;
}

export function resolveCollectionLabel(entry: ReaderLabelEntry): string {
	if (isCurriculumCollection(entry)) {
		if (entry.collection === "undergraduate") {
			return "本科培养方案";
		}
		if (entry.collection === "second_degree") {
			return "二学位培养方案";
		}
		return "通识教育";
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

function isCurriculumCollection(entry: ReaderLabelEntry): boolean {
	return entry.corpus === "curriculum" && CURRICULUM_COLLECTIONS.has(entry.collection);
}
