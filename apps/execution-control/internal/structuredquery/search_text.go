package structuredquery

import "strings"

func normalizeSearchText(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}
