import { getDocumentSuggestions } from "@platform/artifacts/suggestions";
import type { Suggestion } from "@/lib/db/schema";

export async function getSuggestionsByDocumentId({
	documentId,
}: {
	documentId: string;
}): Promise<Suggestion[]> {
	return getDocumentSuggestions(documentId);
}
