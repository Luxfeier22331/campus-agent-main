import type { Suggestion } from "@/lib/db/schema";

function normalizeSuggestion(input: Suggestion): Suggestion {
	return {
		...input,
		createdAt: new Date(input.createdAt),
		documentCreatedAt: new Date(input.documentCreatedAt),
	};
}

export async function getDocumentSuggestions(documentId: string): Promise<Suggestion[]> {
	const response = await fetch(
		`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/suggestions?documentId=${encodeURIComponent(documentId)}`,
		{
			credentials: "same-origin",
			headers: {
				accept: "application/json",
			},
		},
	);

	if (!response.ok) {
		throw new Error("Failed to load document suggestions.");
	}

	const payload = (await response.json()) as Suggestion[];
	return payload.map(normalizeSuggestion);
}
