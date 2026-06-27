package toolreadmodel

import "strings"

func selectTransportRoute(
	routes []transportRouteRecord,
	request transportScheduleRequest,
) transportRouteSelection {
	if len(routes) == 0 {
		return transportRouteSelection{outcome: "not_found"}
	}
	if request.RouteSelector == nil || transportRouteSelectorEmpty(*request.RouteSelector) {
		return transportRouteSelection{
			outcome:             "clarification_required",
			clarificationReason: "route_family_required",
			candidateRoutes:     transportCandidatesFromRoutes(routes),
		}
	}

	selector := *request.RouteSelector
	candidates := append([]transportRouteRecord(nil), routes...)
	if selector.RouteID != "" {
		candidates = filterTransportRoutes(candidates, func(route transportRouteRecord) bool {
			return route.RouteID == selector.RouteID
		})
	}
	if selector.ServiceFamily != "" {
		candidates = filterTransportRoutes(candidates, func(route transportRouteRecord) bool {
			return normalizeTransportServiceFamily(route.ServiceFamily) == selector.ServiceFamily ||
				matchesNormalizedAlias(selector.ServiceFamily, route.Aliases)
		})
	}
	if selector.OriginCampus != "" {
		candidates = filterTransportRoutes(candidates, func(route transportRouteRecord) bool {
			return normalizeSearchText(route.OriginCampus) == normalizeSearchText(selector.OriginCampus)
		})
	}
	if selector.DestinationCampus != "" {
		candidates = filterTransportRoutes(candidates, func(route transportRouteRecord) bool {
			return normalizeSearchText(route.DestinationCampus) ==
				normalizeSearchText(selector.DestinationCampus)
		})
	}
	if selector.RouteVariantQuery != "" {
		needle := normalizeSearchText(selector.RouteVariantQuery)
		candidates = filterTransportRoutes(candidates, func(route transportRouteRecord) bool {
			return matchesTransportRouteText(route, needle)
		})
	}

	originStopMatches := []transportStopRef(nil)
	originStopID := ""
	if selector.OriginStopQuery != "" {
		stopIDs, stopRefs := matchingTransportStopIDs(candidates, selector.OriginStopQuery)
		if len(stopIDs) > 1 {
			return transportRouteSelection{
				outcome:             "clarification_required",
				clarificationReason: "origin_stop_ambiguous",
				stopRefs:            stopRefs,
			}
		}
		if len(stopIDs) == 0 {
			return transportRouteSelection{outcome: "not_found"}
		}
		originStopID = stopIDs[0]
		originStopMatches = stopRefs
		candidates = filterTransportRoutes(candidates, func(route transportRouteRecord) bool {
			return routeContainsStop(route, originStopID)
		})
	}
	destinationStopMatches := []transportStopRef(nil)
	destinationStopID := ""
	if selector.DestinationStopQuery != "" {
		stopIDs, stopRefs := matchingTransportStopIDs(candidates, selector.DestinationStopQuery)
		if len(stopIDs) > 1 {
			return transportRouteSelection{
				outcome:             "clarification_required",
				clarificationReason: "destination_stop_ambiguous",
				stopRefs:            stopRefs,
			}
		}
		if len(stopIDs) == 0 {
			return transportRouteSelection{outcome: "not_found"}
		}
		destinationStopID = stopIDs[0]
		destinationStopMatches = stopRefs
		candidates = filterTransportRoutes(candidates, func(route transportRouteRecord) bool {
			return routeContainsStop(route, destinationStopID)
		})
	}
	if originStopID != "" && destinationStopID != "" {
		candidates = filterTransportRoutes(candidates, func(route transportRouteRecord) bool {
			return routeContainsStopsInOrder(route, originStopID, destinationStopID)
		})
	}

	if len(candidates) == 0 {
		return transportRouteSelection{outcome: "not_found"}
	}
	if len(candidates) > 1 {
		return transportRouteSelection{
			outcome:             "clarification_required",
			clarificationReason: routeClarificationReason(selector),
			candidateRoutes:     transportCandidatesFromRoutes(candidates),
			stopRefs:            append(originStopMatches, destinationStopMatches...),
		}
	}
	return transportRouteSelection{
		record:  candidates[0],
		outcome: "resolved",
		stopRefs: append(
			append([]transportStopRef(nil), originStopMatches...),
			destinationStopMatches...,
		),
	}
}

func routeClarificationReason(selector transportRouteSelector) string {
	if selector.RouteVariantQuery != "" || selector.OriginCampus != "" ||
		selector.DestinationCampus != "" {
		return "route_variant_ambiguous"
	}
	if selector.ServiceFamily != "" {
		return "route_direction_required"
	}
	return "route_family_required"
}

func transportRouteSelectorEmpty(selector transportRouteSelector) bool {
	return selector.RouteID == "" &&
		selector.ServiceFamily == "" &&
		selector.RouteVariantQuery == "" &&
		selector.OriginCampus == "" &&
		selector.DestinationCampus == "" &&
		selector.OriginStopQuery == "" &&
		selector.DestinationStopQuery == ""
}

func filterTransportRoutes(
	routes []transportRouteRecord,
	predicate func(transportRouteRecord) bool,
) []transportRouteRecord {
	filtered := make([]transportRouteRecord, 0, len(routes))
	for _, route := range routes {
		if predicate(route) {
			filtered = append(filtered, route)
		}
	}
	return filtered
}

func matchesTransportRouteText(route transportRouteRecord, needle string) bool {
	candidates := append([]string{route.RouteID, route.DisplayName, route.ServiceFamily}, route.Aliases...)
	for _, candidate := range candidates {
		normalized := normalizeSearchText(candidate)
		if normalized == "" {
			continue
		}
		if strings.Contains(needle, normalized) || strings.Contains(normalized, needle) {
			return true
		}
	}
	return false
}

func matchesNormalizedAlias(needle string, aliases []string) bool {
	for _, alias := range aliases {
		if normalizeTransportServiceFamily(alias) == needle || normalizeSearchText(alias) == needle {
			return true
		}
	}
	return false
}

func matchingTransportStopIDs(
	routes []transportRouteRecord,
	query string,
) ([]string, []transportStopRef) {
	needle := normalizeSearchText(query)
	seen := map[string]bool{}
	stopIDs := []string{}
	stopRefs := []transportStopRef{}
	for _, route := range routes {
		for _, stop := range route.Stops {
			if !matchesTransportStopText(stop, needle) || seen[stop.StopID] {
				continue
			}
			seen[stop.StopID] = true
			stopIDs = append(stopIDs, stop.StopID)
			stopRefs = append(stopRefs, transportStopRefFromRecord(stop))
		}
	}
	return stopIDs, stopRefs
}

func matchesTransportStopText(stop transportStopRecord, needle string) bool {
	candidates := append([]string{stop.StopID, stop.DisplayName}, stop.Aliases...)
	for _, candidate := range candidates {
		normalized := normalizeSearchText(candidate)
		if normalized == "" {
			continue
		}
		if strings.Contains(needle, normalized) || strings.Contains(normalized, needle) {
			return true
		}
	}
	return false
}

func routeContainsStop(route transportRouteRecord, stopID string) bool {
	for _, stop := range route.Stops {
		if stop.StopID == stopID {
			return true
		}
	}
	return false
}

func routeContainsStopsInOrder(route transportRouteRecord, originStopID string, destinationStopID string) bool {
	originIndex := -1
	destinationIndex := -1
	for index, stop := range route.Stops {
		if stop.StopID == originStopID {
			originIndex = index
		}
		if stop.StopID == destinationStopID {
			destinationIndex = index
		}
	}
	return originIndex >= 0 && destinationIndex >= 0 && originIndex < destinationIndex
}
