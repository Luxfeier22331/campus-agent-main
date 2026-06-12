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

func sortedLaneDecisionKeys(items map[laneDecisionKey]uint64) []laneDecisionKey {
	keys := make([]laneDecisionKey, 0, len(items))
	for key := range items {
		keys = append(keys, key)
	}
	sort.Slice(keys, func(left int, right int) bool {
		if keys[left].Lane != keys[right].Lane {
			return keys[left].Lane < keys[right].Lane
		}
		return keys[left].Decision < keys[right].Decision
	})
	return keys
}

func sortedStructuredQueryKeys(items map[structuredQueryKey]uint64) []structuredQueryKey {
	keys := make([]structuredQueryKey, 0, len(items))
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

func sortedCapabilityGateKeys(items map[capabilityGateKey]uint64) []capabilityGateKey {
	keys := make([]capabilityGateKey, 0, len(items))
	for key := range items {
		keys = append(keys, key)
	}
	sort.Slice(keys, func(left int, right int) bool {
		if keys[left].Capability != keys[right].Capability {
			return keys[left].Capability < keys[right].Capability
		}
		if keys[left].Gate != keys[right].Gate {
			return keys[left].Gate < keys[right].Gate
		}
		return keys[left].Decision < keys[right].Decision
	})
	return keys
}

func sortedRuntimeDecisionKeys(items map[runtimeDecisionKey]uint64) []runtimeDecisionKey {
	keys := make([]runtimeDecisionKey, 0, len(items))
	for key := range items {
		keys = append(keys, key)
	}
	sort.Slice(keys, func(left int, right int) bool {
		if keys[left].Capability != keys[right].Capability {
			return keys[left].Capability < keys[right].Capability
		}
		if keys[left].Lane != keys[right].Lane {
			return keys[left].Lane < keys[right].Lane
		}
		if keys[left].ScopeGate != keys[right].ScopeGate {
			return keys[left].ScopeGate < keys[right].ScopeGate
		}
		if keys[left].PolicyGate != keys[right].PolicyGate {
			return keys[left].PolicyGate < keys[right].PolicyGate
		}
		if keys[left].ContextPreflightState != keys[right].ContextPreflightState {
			return keys[left].ContextPreflightState < keys[right].ContextPreflightState
		}
		if keys[left].RoutingNextAction != keys[right].RoutingNextAction {
			return keys[left].RoutingNextAction < keys[right].RoutingNextAction
		}
		if keys[left].PlanningOutcome != keys[right].PlanningOutcome {
			return keys[left].PlanningOutcome < keys[right].PlanningOutcome
		}
		if keys[left].SelectedCapability != keys[right].SelectedCapability {
			return keys[left].SelectedCapability < keys[right].SelectedCapability
		}
		if keys[left].SelectedTool != keys[right].SelectedTool {
			return keys[left].SelectedTool < keys[right].SelectedTool
		}
		if keys[left].TerminalOutcome != keys[right].TerminalOutcome {
			return keys[left].TerminalOutcome < keys[right].TerminalOutcome
		}
		return keys[left].FailCloseReason < keys[right].FailCloseReason
	})
	return keys
}

func sortedAdmissionLaneNames(items map[string]AdmissionLaneSnapshot) []string {
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
