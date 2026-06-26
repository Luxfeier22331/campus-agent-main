import { type JsonObject, mappingList, optionalString, stringList } from "./shared";

export function sourceTitlesFromProjection(rag: JsonObject): string[] {
	const direct = stringList(rag.source_titles);
	const sources = Array.isArray(rag.source_refs)
		? mappingList(rag.source_refs, "agentRuntimeEvalProjection.rag.source_refs")
		: [];
	for (const source of sources) {
		const title =
			optionalString(source.canonical_source_title) ??
			optionalString(source.source_title) ??
			optionalString(source.title);
		if (title) {
			direct.push(title);
		}
	}
	return direct;
}
