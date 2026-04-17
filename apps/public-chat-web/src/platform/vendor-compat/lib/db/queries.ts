import type { Suggestion } from "@/lib/db/schema";

import { getDocumentSuggestions } from "@platform/artifacts/suggestions";

export async function getSuggestionsByDocumentId({
  documentId,
}: {
  documentId: string;
}): Promise<Suggestion[]> {
  return getDocumentSuggestions(documentId);
}
