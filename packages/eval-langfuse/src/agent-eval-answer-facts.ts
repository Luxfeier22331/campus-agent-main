export function matchedExpectedFacts(
	expectedFacts: string[],
	answerText: string,
	projectedFacts: string[],
): string[] {
	const matched = [...projectedFacts];
	for (const fact of expectedFacts) {
		if (answerText.includes(fact)) {
			matched.push(fact);
		}
	}
	return unique(matched);
}

function unique(items: string[]): string[] {
	return Array.from(new Set(items.filter(Boolean)));
}
