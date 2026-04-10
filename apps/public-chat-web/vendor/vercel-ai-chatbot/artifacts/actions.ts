import { getDocumentSuggestions } from "@platform/artifacts/suggestions";

export async function getSuggestions({ documentId }: { documentId: string }) {
  const suggestions = await getDocumentSuggestions(documentId);
  return suggestions ?? [];
}
