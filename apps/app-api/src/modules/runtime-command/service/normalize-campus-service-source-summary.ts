import { isRecord, normalizeOptionalString, recordStringArray } from "./normalize-record-utils";

function dedupeStringList(values: string[]): string[] {
	return Array.from(new Set(values.filter((value) => value.length > 0)));
}

function normalizeSourceRefCategory(reference: string): string | null {
	const prefix = reference.split(":", 1)[0]?.toLowerCase() ?? "";
	if (prefix === "authenticated_notice" || prefix === "internal_notice" || prefix === "notice") {
		return "校内通知";
	}
	if (prefix === "service_catalog" || prefix === "campus_services") {
		return "服务目录";
	}
	return null;
}

function normalizeSourceRefSummary(referenceCandidates: string[]): string {
	const categories = dedupeStringList(
		referenceCandidates
			.map((reference) => normalizeSourceRefCategory(reference))
			.filter((category): category is string => category !== null),
	);
	return categories.length > 0 ? `来源：${categories.join("、")}` : "";
}

export function collectNestedSourceRefs(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return [];
	}
	return value.flatMap((entry) => {
		if (!isRecord(entry)) {
			return [];
		}
		return [
			...recordStringArray(entry, "source_refs", "sourceRefs"),
			...collectNestedSourceRefs(entry.steps),
			...collectNestedSourceRefs(entry.procedure_groups ?? entry.procedureGroups),
		];
	});
}

export function appendSourceSummary(text: string, referenceCandidates: string[]): string {
	const summary = normalizeSourceRefSummary(referenceCandidates);
	if (!summary) {
		return text;
	}
	return `${text}（${summary}）`;
}

export function ensureSentenceEnd(text: string): string {
	const normalized = normalizeOptionalString(text);
	if (!normalized) {
		return "";
	}
	return /[。！？!?）)]$/u.test(normalized) ? normalized : `${normalized}。`;
}
