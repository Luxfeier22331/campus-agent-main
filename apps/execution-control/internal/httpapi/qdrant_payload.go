package httpapi

func qdrantMatchCondition(key string, value any) map[string]any {
	return map[string]any{
		"key":   key,
		"match": map[string]any{"value": value},
	}
}

func qdrantMatchAnyCondition(key string, values []string) map[string]any {
	return map[string]any{
		"key":   key,
		"match": map[string]any{"any": values},
	}
}
