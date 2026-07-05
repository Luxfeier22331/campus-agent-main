package httpapi

import (
	"fmt"
	"strings"
)

func firstNonEmptyText(values ...any) string {
	for _, value := range values {
		text := strings.TrimSpace(optionalStringFromAny(value))
		if text != "" {
			return text
		}
	}
	return ""
}

func optionalStringFromAny(value any) string {
	switch typed := value.(type) {
	case string:
		return typed
	case fmt.Stringer:
		return typed.String()
	case nil:
		return ""
	default:
		return fmt.Sprint(typed)
	}
}
