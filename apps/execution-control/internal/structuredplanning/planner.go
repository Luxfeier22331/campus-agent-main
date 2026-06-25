package structuredplanning

import (
	"regexp"
	"strings"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/runtimepolicy"
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
	Capability   string
	PayloadKind  string
	Payload      map[string]any
	AllowedTools []string
}

func PlanWithPolicy(request Request, policy runtimepolicy.IntentPolicyArtifact) *WorkflowPlan {
	normalizedGoal := runtimepolicy.NormalizeGoal(request.UserGoal)
	if normalizedGoal == "" || isDelegatedTransactionAction(normalizedGoal, policy) {
		return nil
	}
	if !capabilityOpenForPlanning(request.EffectiveCapability) {
		return nil
	}
	if request.EffectiveCapability == "campus_services" {
		if isTransportNoticeOverrideQuestion(normalizedGoal, request, policy) {
			return MultiStepCapabilityPreplan(
				"plan:capability_preplan:campus_services:transport_notice_override",
				transportNoticeOverrideCapabilityPlan(request),
			)
		}
		if runtimepolicy.IsTransportScheduleLookupQueryForPlanning(normalizedGoal, policy) {
			return SingleStepPlan(Handoff{
				Capability:   "campus_services",
				PayloadKind:  "transport_schedule_lookup",
				Payload:      transportSchedulePayload(request.UserGoal, normalizedGoal, request.VersionQuery, policy),
				AllowedTools: runtimepolicy.AllowedToolsForCapabilityPayloadKind("campus_services", "transport_schedule_lookup"),
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
			return SingleStepPlan(Handoff{
				Capability:   "notice",
				PayloadKind:  "campus_notice_get",
				Payload:      payload,
				AllowedTools: runtimepolicy.AllowedToolsForCapabilityPayloadKind("notice", "campus_notice_get"),
			})
		}
		return SingleStepPlan(Handoff{
			Capability:   "notice",
			PayloadKind:  "campus_notice_discover",
			Payload:      noticeDiscoverPayload(request.UserGoal, normalizedGoal, request.VersionQuery, policy),
			AllowedTools: runtimepolicy.AllowedToolsForCapabilityPayloadKind("notice", "campus_notice_discover"),
		})
	}
	if request.EffectiveCapability == "knowledge" {
		if isNoticeKnowledgeFollowthrough(normalizedGoal, request, policy) {
			return MultiStepCapabilityPreplan(
				"plan:capability_preplan:knowledge:selected_notice_followthrough",
				selectedNoticeKnowledgeFollowthroughCapabilityPlan(request),
			)
		}
		return SingleStepPlan(Handoff{
			Capability:   "knowledge",
			PayloadKind:  "rag_request",
			Payload:      ragRequestPayload(request),
			AllowedTools: runtimepolicy.AllowedToolsForCapability("knowledge"),
		})
	}
	return nil
}

func capabilityOpenForPlanning(capability string) bool {
	if strings.TrimSpace(capability) == "" {
		return true
	}
	registry, ok := runtimepolicy.DefaultCapabilitySpecRegistry()
	if !ok {
		return false
	}
	spec, ok := registry.CapabilityByID(capability)
	return ok && spec.Active && spec.OpeningGate == "open"
}
