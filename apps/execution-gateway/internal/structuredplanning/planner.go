package structuredplanning

import (
	"regexp"

	"github.com/MUC-WIKI/campus-agent/apps/execution-gateway/internal/runtimepolicy"
)

var yearPattern = regexp.MustCompile(`(20\d{2})年`)

type Request struct {
	EffectiveCapability      string
	UserGoal                 string
	HasRequestedScope        bool
	RequestedScope           Scope
	VersionQuery             VersionQuery
	SelectedNoticeRef        SelectedNoticeRef
	MultiStepWorkflowEnabled bool
}

type Scope struct {
	Corpus     string
	Collection string
}

type VersionQuery struct {
	Mode               string
	AsOf               string
	VersionID          string
	CompareToVersionID string
}

type SelectedNoticeRef struct {
	NoticeID      string
	SourceFamily  string
	Title         string
	TargetSurface string
}

type Handoff struct {
	Target       string
	PayloadKind  string
	Payload      map[string]any
	AllowedTools []string
}

func PlanWithPolicy(request Request, policy runtimepolicy.IntentPolicyArtifact) *WorkflowPlan {
	normalizedGoal := runtimepolicy.NormalizeGoal(request.UserGoal)
	if normalizedGoal == "" || isDelegatedTransactionAction(normalizedGoal, policy) {
		return nil
	}
	if request.EffectiveCapability == "campus_services" {
		if isTransportNoticeOverrideQuestion(normalizedGoal, request, policy) {
			return MultiStepCapabilityPreplan(
				"plan:capability_preplan:campus_services:transport_notice_override",
				transportNoticeOverrideCapabilityPlan(request),
			)
		}
		serviceGuideFocus := classifyServiceGuideFocus(normalizedGoal, policy)
		if runtimepolicy.IsAcademicCalendarFactQueryForPlanning(normalizedGoal, policy) {
			return SingleHandoffPlan(Handoff{
				Target:       "campus-services-agent",
				PayloadKind:  "academic_calendar_lookup",
				Payload:      academicCalendarPayload(request.UserGoal, normalizedGoal, request.VersionQuery),
				AllowedTools: runtimepolicy.AllowedToolsForPayloadKind("campus-services-agent", "academic_calendar_lookup"),
			})
		}
		if isContactDirectoryLookup(normalizedGoal, policy) &&
			!shouldPreferServiceGuideOverContactDirectory(normalizedGoal, policy) {
			return SingleHandoffPlan(Handoff{
				Target:       "campus-services-agent",
				PayloadKind:  "contact_directory_lookup",
				Payload:      contactDirectoryPayload(request.UserGoal, normalizedGoal, policy),
				AllowedTools: runtimepolicy.AllowedToolsForPayloadKind("campus-services-agent", "contact_directory_lookup"),
			})
		}
		if isTransportBoardingStatusLookup(normalizedGoal, policy) {
			return SingleHandoffPlan(Handoff{
				Target:       "campus-services-agent",
				PayloadKind:  "service_status_lookup",
				Payload:      serviceStatusPayload(request.UserGoal, normalizedGoal, request.VersionQuery, policy),
				AllowedTools: runtimepolicy.AllowedToolsForPayloadKind("campus-services-agent", "service_status_lookup"),
			})
		}
		if isTransportServiceGuideLookup(normalizedGoal, policy) {
			return SingleHandoffPlan(Handoff{
				Target:       "campus-services-agent",
				PayloadKind:  "service_guide_lookup",
				Payload:      serviceGuidePayloadWithFocus(request.UserGoal, normalizedGoal, request.VersionQuery, policy, serviceGuideFocus),
				AllowedTools: runtimepolicy.AllowedToolsForPayloadKind("campus-services-agent", "service_guide_lookup"),
			})
		}
		if shouldPreferServiceStatusLookup(normalizedGoal, policy) {
			return SingleHandoffPlan(Handoff{
				Target:       "campus-services-agent",
				PayloadKind:  "service_status_lookup",
				Payload:      serviceStatusPayload(request.UserGoal, normalizedGoal, request.VersionQuery, policy),
				AllowedTools: runtimepolicy.AllowedToolsForPayloadKind("campus-services-agent", "service_status_lookup"),
			})
		}
		if containsAny(normalizedGoal, policy.Signals("structured_transport")) {
			return SingleHandoffPlan(Handoff{
				Target:       "campus-services-agent",
				PayloadKind:  "transport_schedule_lookup",
				Payload:      transportSchedulePayload(request.UserGoal, normalizedGoal, request.VersionQuery, policy),
				AllowedTools: runtimepolicy.AllowedToolsForPayloadKind("campus-services-agent", "transport_schedule_lookup"),
			})
		}
		if isServiceGuideLookup(normalizedGoal, policy) &&
			serviceGuideFocus != "contact" &&
			serviceGuideFocus != "procedure" {
			return SingleHandoffPlan(Handoff{
				Target:       "campus-services-agent",
				PayloadKind:  "service_guide_lookup",
				Payload:      serviceGuidePayloadWithFocus(request.UserGoal, normalizedGoal, request.VersionQuery, policy, serviceGuideFocus),
				AllowedTools: runtimepolicy.AllowedToolsForPayloadKind("campus-services-agent", "service_guide_lookup"),
			})
		}
		if isServiceGuideLookup(normalizedGoal, policy) {
			return SingleHandoffPlan(Handoff{
				Target:       "campus-services-agent",
				PayloadKind:  "service_guide_lookup",
				Payload:      serviceGuidePayloadWithFocus(request.UserGoal, normalizedGoal, request.VersionQuery, policy, serviceGuideFocus),
				AllowedTools: runtimepolicy.AllowedToolsForPayloadKind("campus-services-agent", "service_guide_lookup"),
			})
		}
		return nil
	}
	if request.EffectiveCapability == "notice" {
		selectedNoticeRef := request.SelectedNoticeRef
		if selectedNoticeRef.NoticeID != "" &&
			containsAny(normalizedGoal, policy.Signals("notice_get_reference")) {
			payload := map[string]any{
				"notice_id": selectedNoticeRef.NoticeID,
			}
			if selectedNoticeRef.SourceFamily != "" {
				payload["source_family"] = selectedNoticeRef.SourceFamily
			}
			return SingleHandoffPlan(Handoff{
				Target:       "notice-agent",
				PayloadKind:  "campus_notice_get",
				Payload:      payload,
				AllowedTools: runtimepolicy.AllowedToolsForPayloadKind("notice-agent", "campus_notice_get"),
			})
		}
		return SingleHandoffPlan(Handoff{
			Target:       "notice-agent",
			PayloadKind:  "campus_notice_discover",
			Payload:      noticeDiscoverPayload(request.UserGoal, normalizedGoal, request.VersionQuery, policy),
			AllowedTools: runtimepolicy.AllowedToolsForPayloadKind("notice-agent", "campus_notice_discover"),
		})
	}
	if request.EffectiveCapability == "knowledge" {
		if isNoticeKnowledgeFollowthrough(normalizedGoal, request, policy) {
			return MultiStepCapabilityPreplan(
				"plan:capability_preplan:knowledge:selected_notice_followthrough",
				selectedNoticeKnowledgeFollowthroughCapabilityPlan(request),
			)
		}
		return SingleHandoffPlan(Handoff{
			Target:       "rag-agent",
			PayloadKind:  "rag_request",
			Payload:      ragRequestPayload(request),
			AllowedTools: runtimepolicy.AllowedToolsForTarget("rag-agent"),
		})
	}
	return nil
}
