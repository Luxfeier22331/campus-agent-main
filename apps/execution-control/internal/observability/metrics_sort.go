package observability

import "sort"

func sortedRoutes[T any](items map[string]T) []string {
	return sortedStringKeys(items)
}

func sortedRoutesInt64(items map[string]int64) []string {
	return sortedStringKeys(items)
}

func sortedStringKeys[V any](items map[string]V) []string {
	keys := make([]string, 0, len(items))
	for key := range items {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

func sortedGroupDecisionKeys(items map[groupDecisionKey]uint64) []groupDecisionKey {
	keys := make([]groupDecisionKey, 0, len(items))
	for key := range items {
		keys = append(keys, key)
	}
	sort.Slice(keys, func(left int, right int) bool {
		if keys[left].Group != keys[right].Group {
			return keys[left].Group < keys[right].Group
		}
		return keys[left].Decision < keys[right].Decision
	})
	return keys
}

func sortedToolReadModelKeys(items map[toolReadModelKey]uint64) []toolReadModelKey {
	keys := make([]toolReadModelKey, 0, len(items))
	for key := range items {
		keys = append(keys, key)
	}
	sort.Slice(keys, func(left int, right int) bool {
		if keys[left].Tool != keys[right].Tool {
			return keys[left].Tool < keys[right].Tool
		}
		if keys[left].Outcome != keys[right].Outcome {
			return keys[left].Outcome < keys[right].Outcome
		}
		return keys[left].StatusClass < keys[right].StatusClass
	})
	return keys
}

func sortedToolGateKeys(items map[toolGateKey]uint64) []toolGateKey {
	keys := make([]toolGateKey, 0, len(items))
	for key := range items {
		keys = append(keys, key)
	}
	sort.Slice(keys, func(left int, right int) bool {
		if keys[left].Tool != keys[right].Tool {
			return keys[left].Tool < keys[right].Tool
		}
		if keys[left].Gate != keys[right].Gate {
			return keys[left].Gate < keys[right].Gate
		}
		return keys[left].Decision < keys[right].Decision
	})
	return keys
}

func sortedPersonalMemoryOperationKeys(
	items map[personalMemoryOperationKey]uint64,
) []personalMemoryOperationKey {
	keys := make([]personalMemoryOperationKey, 0, len(items))
	for key := range items {
		keys = append(keys, key)
	}
	sort.Slice(keys, func(left int, right int) bool {
		if keys[left].Operation != keys[right].Operation {
			return keys[left].Operation < keys[right].Operation
		}
		if keys[left].Outcome != keys[right].Outcome {
			return keys[left].Outcome < keys[right].Outcome
		}
		return keys[left].FailureKind < keys[right].FailureKind
	})
	return keys
}

func sortedAdmissionGroupNames(items map[string]AdmissionGroupSnapshot) []string {
	keys := make([]string, 0, len(items))
	for key := range items {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

func sortedRequestKeys(items map[requestKey]uint64) []requestKey {
	keys := make([]requestKey, 0, len(items))
	for key := range items {
		keys = append(keys, key)
	}
	sort.Slice(keys, func(left int, right int) bool {
		if keys[left].Route != keys[right].Route {
			return keys[left].Route < keys[right].Route
		}
		if keys[left].Outcome != keys[right].Outcome {
			return keys[left].Outcome < keys[right].Outcome
		}
		return keys[left].StatusClass < keys[right].StatusClass
	})
	return keys
}
