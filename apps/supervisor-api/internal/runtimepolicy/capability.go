package runtimepolicy

import "strings"

func ResolveCapability(
	request CapabilityResolutionRequest,
	policy IntentPolicyArtifact,
) CapabilityResolution {
	effectiveCapability := effectiveCapability(request, policy)
	return CapabilityResolution{
		EffectiveCapability: effectiveCapability,
		Source: capabilitySource(
			request.RequestedCapability,
			effectiveCapability,
			request.HasRequestedScope,
			request.VersionQueryMode,
		),
	}
}

func InferCapabilityFromGoal(userGoal string, policy IntentPolicyArtifact) string {
	normalized := NormalizeGoal(userGoal)
	if normalized == "" {
		return "knowledge"
	}
	if isDirectoryLookupGuideQuery(normalized) {
		return "campus_services"
	}
	if containsAny(normalized, policy.Signals("structured_service_guide_subject")) &&
		containsAny(normalized, policy.Signals("structured_service_guide_action")) {
		return "campus_services"
	}
	if containsAny(normalized, policy.Signals("structured_transport")) &&
		containsAny(normalized, policy.Signals("structured_transport_boarding_status")) {
		return "campus_services"
	}
	if containsAny(normalized, policy.Signals("structured_non_spatial_where_action")) {
		return "knowledge"
	}
	if containsAny(normalized, policy.Signals("structured_place_lookup_action")) &&
		containsAny(normalized, policy.Signals("structured_place_entity")) {
		return "place_lookup"
	}
	if containsAny(normalized, policy.Signals("structured_place_entity")) &&
		containsAny(normalized, policy.Signals("structured_place_location_noun")) {
		return "place_lookup"
	}
	if containsAny(normalized, policy.Signals("structured_transport")) {
		return "campus_services"
	}
	if containsAny(normalized, policy.Signals("structured_contact_directory")) &&
		containsAny(normalized, policy.Signals("structured_contact_directory_action")) {
		return "campus_services"
	}
	if containsAny(normalized, policy.Signals("structured_service_status")) &&
		containsAny(normalized, policy.Signals("structured_service_subject")) {
		return "campus_services"
	}
	if containsAny(normalized, policy.Signals("structured_notice")) {
		return "notice"
	}
	return "knowledge"
}

func effectiveCapability(
	request CapabilityResolutionRequest,
	policy IntentPolicyArtifact,
) string {
	if request.HasRequestedScope ||
		(request.VersionQueryMode != "" && request.VersionQueryMode != "current") {
		if strings.TrimSpace(request.RequestedCapability) == "" {
			return "knowledge"
		}
		return request.RequestedCapability
	}
	if request.RequestedCapability != "" && request.RequestedCapability != "knowledge" {
		return request.RequestedCapability
	}

	inferred := InferCapabilityFromGoal(request.UserGoal, policy)
	if request.RequestedCapability == "knowledge" && inferred == "knowledge" {
		return "knowledge"
	}
	if inferred != "" {
		return inferred
	}
	return "knowledge"
}

func capabilitySource(
	requestedCapability string,
	effectiveCapability string,
	hasRequestedScope bool,
	versionQueryMode string,
) string {
	normalizedRequestedCapability := strings.TrimSpace(requestedCapability)
	if normalizedRequestedCapability != "" && normalizedRequestedCapability != "knowledge" {
		return "explicit"
	}
	if hasRequestedScope || (versionQueryMode != "" && versionQueryMode != "current") {
		return "explicit_knowledge"
	}
	if effectiveCapability != "" && effectiveCapability != "knowledge" {
		return "inferred"
	}
	if normalizedRequestedCapability == "knowledge" {
		return "explicit_knowledge"
	}
	return "default"
}
