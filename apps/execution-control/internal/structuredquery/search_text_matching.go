package structuredquery

import "strings"

const minimumSharedSearchRuneLength = 3

func sharedSearchTextScore(query string, candidate string) int {
	normalizedQuery := normalizeSearchText(query)
	normalizedCandidate := normalizeSearchText(candidate)
	if normalizedQuery == "" || normalizedCandidate == "" {
		return 0
	}
	queryRunes := []rune(normalizedQuery)
	best := 0
	for start := range queryRunes {
		for end := start + minimumSharedSearchRuneLength; end <= len(queryRunes); end++ {
			fragment := strings.TrimSpace(string(queryRunes[start:end]))
			if len([]rune(fragment)) < minimumSharedSearchRuneLength {
				continue
			}
			if strings.Contains(normalizedCandidate, fragment) && len([]rune(fragment)) > best {
				best = len([]rune(fragment))
			}
		}
	}
	return best
}
