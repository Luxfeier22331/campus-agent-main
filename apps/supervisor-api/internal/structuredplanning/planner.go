package structuredplanning

import (
	"regexp"
	"strings"

	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/runtimepolicy"
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
	NoticeID     string
	SourceFamily string
	Title        string
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
		if containsAny(normalizedGoal, policy.Signals("structured_transport")) {
			if isTransportNoticeKnowledgePilot(normalizedGoal, request, policy) {
				noticePayload := map[string]any{
					"notice_id": request.SelectedNoticeRef.NoticeID,
				}
				if request.SelectedNoticeRef.SourceFamily != "" {
					noticePayload["source_family"] = request.SelectedNoticeRef.SourceFamily
				}
				return MultiStepTransportNoticeKnowledgePilotPlan(
					Handoff{
						Target:       "campus-services-agent",
						PayloadKind:  "transport_schedule_lookup",
						Payload:      transportSchedulePayload(request.UserGoal, normalizedGoal, request.VersionQuery, policy),
						AllowedTools: runtimepolicy.AllowedToolsForPayloadKind("campus-services-agent", "transport_schedule_lookup"),
					},
					Handoff{
						Target:       "notice-agent",
						PayloadKind:  "campus_notice_get",
						Payload:      noticePayload,
						AllowedTools: runtimepolicy.AllowedToolsForPayloadKind("notice-agent", "campus_notice_get"),
					},
					Handoff{
						Target:       "rag-agent",
						PayloadKind:  "rag_request",
						Payload:      ragRequestPayload(request),
						AllowedTools: runtimepolicy.AllowedToolsForTarget("rag-agent"),
					},
				)
			}
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
		if containsAny(normalizedGoal, policy.Signals("structured_service_status")) {
			return SingleHandoffPlan(Handoff{
				Target:       "campus-services-agent",
				PayloadKind:  "service_status_lookup",
				Payload:      serviceStatusPayload(request.UserGoal, normalizedGoal, request.VersionQuery, policy),
				AllowedTools: runtimepolicy.AllowedToolsForPayloadKind("campus-services-agent", "service_status_lookup"),
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
			noticePayload := map[string]any{
				"notice_id": request.SelectedNoticeRef.NoticeID,
			}
			if request.SelectedNoticeRef.SourceFamily != "" {
				noticePayload["source_family"] = request.SelectedNoticeRef.SourceFamily
			}
			return MultiStepNoticeKnowledgeFollowthroughPlan(
				Handoff{
					Target:       "notice-agent",
					PayloadKind:  "campus_notice_get",
					Payload:      noticePayload,
					AllowedTools: runtimepolicy.AllowedToolsForPayloadKind("notice-agent", "campus_notice_get"),
				},
				Handoff{
					Target:       "rag-agent",
					PayloadKind:  "rag_request",
					Payload:      ragRequestPayload(request),
					AllowedTools: runtimepolicy.AllowedToolsForTarget("rag-agent"),
				},
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

var academicYearLabelPattern = regexp.MustCompile(`(20\d{2}-20\d{2}学年)`)
var isoDatePattern = regexp.MustCompile(`20\d{2}-\d{2}-\d{2}`)

func academicCalendarPayload(
	userGoal string,
	normalizedGoal string,
	versionQuery VersionQuery,
) map[string]any {
	payload := map[string]any{
		"query_text":     userGoal,
		"temporal_query": temporalQueryPayload(versionQuery, normalizedGoal, runtimepolicy.IntentPolicyArtifact{}),
	}
	if academicYearLabel := extractAcademicYearLabel(userGoal); academicYearLabel != "" {
		payload["academic_year_label"] = academicYearLabel
	}
	queryKind := academicCalendarQueryKindForPlanning(normalizedGoal)
	payload["query_kind"] = queryKind
	if targetDate := isoDatePattern.FindString(userGoal); targetDate != "" {
		payload["target_date"] = targetDate
	}
	if eventQuery := academicCalendarEventQueryForPlanning(normalizedGoal); eventQuery != "" {
		payload["event_query"] = eventQuery
	}
	if queryKind == "term_window" {
		payload["term_label"] = academicCalendarTermLabelForPlanning(normalizedGoal)
	}
	return payload
}

func extractAcademicYearLabel(userGoal string) string {
	return academicYearLabelPattern.FindString(strings.TrimSpace(userGoal))
}

func academicCalendarQueryKindForPlanning(normalizedGoal string) string {
	if strings.Contains(normalizedGoal, "教学周") || strings.Contains(normalizedGoal, "第几周") {
		return "date_week"
	}
	if strings.Contains(normalizedGoal, "补课") ||
		strings.Contains(normalizedGoal, "上周几的课") ||
		strings.Contains(normalizedGoal, "上星期几的课") ||
		strings.Contains(normalizedGoal, "调休上课") ||
		strings.Contains(normalizedGoal, "执行周") ||
		(strings.Contains(normalizedGoal, "执行") && strings.Contains(normalizedGoal, "课表")) {
		return "class_day_pattern"
	}
	if (strings.Contains(normalizedGoal, "本学期") ||
		strings.Contains(normalizedGoal, "春季学期") ||
		strings.Contains(normalizedGoal, "秋季学期")) &&
		(strings.Contains(normalizedGoal, "什么时候") ||
			strings.Contains(normalizedGoal, "哪天") ||
			strings.Contains(normalizedGoal, "开始") ||
			strings.Contains(normalizedGoal, "结束") ||
			strings.Contains(normalizedGoal, "哪段时间")) {
		return "term_window"
	}
	if academicCalendarEventQueryForPlanning(normalizedGoal) != "" {
		if strings.Contains(normalizedGoal, "上课") || strings.Contains(normalizedGoal, "吗") {
			return "day_status"
		}
		return "named_event_range"
	}
	if strings.Contains(normalizedGoal, "上课") &&
		(strings.Contains(normalizedGoal, "吗") || strings.Contains(normalizedGoal, "不上课")) {
		return "day_status"
	}
	return "date_week"
}

func academicCalendarEventQueryForPlanning(normalizedGoal string) string {
	for _, candidate := range []string{"春假", "五一", "劳动节", "国庆", "十一", "元旦", "清明", "端午", "中秋", "寒假", "暑假"} {
		if strings.Contains(normalizedGoal, candidate) {
			return candidate
		}
	}
	return ""
}

func academicCalendarTermLabelForPlanning(normalizedGoal string) string {
	if strings.Contains(normalizedGoal, "秋季学期") {
		return "秋季学期"
	}
	return "春季学期"
}

func isNoticeKnowledgeFollowthrough(
	normalizedGoal string,
	request Request,
	policy runtimepolicy.IntentPolicyArtifact,
) bool {
	return request.MultiStepWorkflowEnabled &&
		request.HasRequestedScope &&
		request.SelectedNoticeRef.NoticeID != "" &&
		containsAny(normalizedGoal, policy.Signals("notice_get_reference")) &&
		containsAny(normalizedGoal, policy.Signals("notice_knowledge_followthrough"))
}

func isTransportNoticeKnowledgePilot(
	normalizedGoal string,
	request Request,
	policy runtimepolicy.IntentPolicyArtifact,
) bool {
	return request.MultiStepWorkflowEnabled &&
		request.HasRequestedScope &&
		request.RequestedScope.Corpus == "regulations" &&
		request.RequestedScope.Collection == "student_rules" &&
		request.SelectedNoticeRef.NoticeID != "" &&
		containsAny(normalizedGoal, policy.Signals("structured_transport")) &&
		containsAny(normalizedGoal, policy.Signals("notice_knowledge_followthrough"))
}

func isDelegatedTransactionAction(
	normalizedGoal string,
	policy runtimepolicy.IntentPolicyArtifact,
) bool {
	return containsAny(normalizedGoal, policy.Signals("delegated_action_prefix")) &&
		containsAny(normalizedGoal, policy.Signals("high_risk_transaction_action"))
}

func (h Handoff) Map() map[string]any {
	return map[string]any{
		"target":        h.Target,
		"payload_kind":  h.PayloadKind,
		"payload":       h.Payload,
		"allowed_tools": h.AllowedTools,
	}
}

func transportSchedulePayload(
	userGoal string,
	normalizedGoal string,
	versionQuery VersionQuery,
	policy runtimepolicy.IntentPolicyArtifact,
) map[string]any {
	payload := map[string]any{
		"query_text":     userGoal,
		"intent":         classifyTransportIntent(normalizedGoal, policy),
		"snapshot_query": temporalQueryPayload(versionQuery, normalizedGoal, policy),
	}
	if routeSelector := transportRouteSelectorPayload(normalizedGoal, policy); len(routeSelector) > 0 {
		payload["route_selector"] = routeSelector
	}
	if serviceTimeQuery := transportServiceTimeQueryPayload(normalizedGoal, policy); len(serviceTimeQuery) > 0 {
		payload["service_time_query"] = serviceTimeQuery
	}
	return payload
}

func serviceStatusPayload(
	userGoal string,
	normalizedGoal string,
	versionQuery VersionQuery,
	policy runtimepolicy.IntentPolicyArtifact,
) map[string]any {
	payload := map[string]any{
		"subject_query":  userGoal,
		"temporal_query": temporalQueryPayload(versionQuery, normalizedGoal, policy),
	}
	if campusScope := campusScopeFromGoal(normalizedGoal, policy); campusScope != "" {
		payload["campus_scope"] = campusScope
	}
	return payload
}

func serviceGuidePayload(
	userGoal string,
	normalizedGoal string,
	versionQuery VersionQuery,
	policy runtimepolicy.IntentPolicyArtifact,
) map[string]any {
	return serviceGuidePayloadWithFocus(
		userGoal,
		normalizedGoal,
		versionQuery,
		policy,
		classifyServiceGuideFocus(normalizedGoal, policy),
	)
}

func serviceGuidePayloadWithFocus(
	userGoal string,
	normalizedGoal string,
	versionQuery VersionQuery,
	policy runtimepolicy.IntentPolicyArtifact,
	guideFocus string,
) map[string]any {
	payload := map[string]any{
		"service_query":  userGoal,
		"guide_focus":    guideFocus,
		"temporal_query": temporalQueryPayload(versionQuery, normalizedGoal, policy),
		"audience":       "unknown",
	}
	if campusScope := campusScopeFromGoal(normalizedGoal, policy); campusScope != "" {
		payload["campus_scope"] = campusScope
	}
	return payload
}

func contactDirectoryPayload(
	userGoal string,
	normalizedGoal string,
	policy runtimepolicy.IntentPolicyArtifact,
) map[string]any {
	payload := map[string]any{
		"query_text":    userGoal,
		"contact_focus": classifyContactDirectoryFocus(normalizedGoal, policy),
		"temporal_query": map[string]any{
			"mode": "current",
		},
		"audience": "unknown",
	}
	if campusScope := campusScopeFromGoal(normalizedGoal, policy); campusScope != "" {
		payload["campus_scope"] = campusScope
	}
	if entitySelector := contactDirectoryEntitySelectorPayload(normalizedGoal, policy); len(entitySelector) > 0 {
		payload["entity_selector"] = entitySelector
	}
	return payload
}

func contactDirectoryEntitySelectorPayload(
	normalizedGoal string,
	policy runtimepolicy.IntentPolicyArtifact,
) map[string]any {
	subject := firstPlanningSignal(normalizedGoal, policy.Signals("structured_contact_directory"))
	if subject == "" {
		return nil
	}
	return map[string]any{
		"department_query": subject,
	}
}

func firstPlanningSignal(normalizedValue string, signals []string) string {
	for _, signal := range signals {
		normalizedSignal := runtimepolicy.NormalizeGoal(signal)
		if normalizedSignal != "" && strings.Contains(normalizedValue, normalizedSignal) {
			return signal
		}
	}
	return ""
}

func noticeDiscoverPayload(
	userGoal string,
	normalizedGoal string,
	versionQuery VersionQuery,
	policy runtimepolicy.IntentPolicyArtifact,
) map[string]any {
	return map[string]any{
		"query_text":     userGoal,
		"temporal_query": temporalQueryPayload(versionQuery, normalizedGoal, policy),
	}
}

func ragRequestPayload(request Request) map[string]any {
	payload := map[string]any{
		"scope":         nil,
		"version_query": versionQueryPayload(request.VersionQuery),
	}
	if request.HasRequestedScope {
		payload["scope"] = map[string]any{
			"corpus":     request.RequestedScope.Corpus,
			"collection": request.RequestedScope.Collection,
		}
	}
	return payload
}

func versionQueryPayload(versionQuery VersionQuery) map[string]any {
	payload := map[string]any{
		"mode": defaultString(versionQuery.Mode, "current"),
	}
	if versionQuery.AsOf != "" {
		payload["as_of"] = versionQuery.AsOf
	}
	if versionQuery.VersionID != "" {
		payload["version_id"] = versionQuery.VersionID
	}
	if versionQuery.CompareToVersionID != "" {
		payload["compare_to_version_id"] = versionQuery.CompareToVersionID
	}
	return payload
}

func classifyTransportIntent(
	normalizedGoal string,
	policy runtimepolicy.IntentPolicyArtifact,
) string {
	if containsAny(normalizedGoal, policy.Signals("transport_intent_timetable")) {
		if containsAny(normalizedGoal, policy.Signals("transport_intent_snapshot_metadata")) {
			return "schedule_snapshot_metadata"
		}
		return "timetable"
	}
	if containsAny(normalizedGoal, policy.Signals("transport_intent_first_departure")) {
		return "first_departure"
	}
	if containsAny(normalizedGoal, policy.Signals("transport_intent_last_departure")) {
		return "last_departure"
	}
	if containsAny(normalizedGoal, policy.Signals("transport_intent_departure_list")) {
		return "departure_list"
	}
	if containsAny(normalizedGoal, policy.Signals("transport_intent_service_window")) {
		return "service_window"
	}
	return "next_departure"
}

func transportRouteSelectorPayload(
	normalizedGoal string,
	policy runtimepolicy.IntentPolicyArtifact,
) map[string]any {
	selector := map[string]any{}
	if containsAny(normalizedGoal, policy.Signals("transport_route_metro_shuttle")) {
		selector["service_family"] = "metro_shuttle"
	} else if containsAny(normalizedGoal, policy.Signals("transport_route_intercampus_commute")) {
		selector["service_family"] = "intercampus_commute"
	}
	if containsAny(normalizedGoal, policy.Signals("transport_route_to_fengtai")) {
		selector["destination_campus"] = "fengtai"
		if containsAny(normalizedGoal, policy.Signals("campus_scope_haidian")) {
			selector["origin_campus"] = "haidian"
		}
	} else if containsAny(normalizedGoal, policy.Signals("transport_route_to_haidian")) {
		selector["destination_campus"] = "haidian"
		if containsAny(normalizedGoal, policy.Signals("campus_scope_fengtai")) {
			selector["origin_campus"] = "fengtai"
		}
	}
	return selector
}

func transportServiceTimeQueryPayload(
	normalizedGoal string,
	policy runtimepolicy.IntentPolicyArtifact,
) map[string]any {
	if containsAny(normalizedGoal, policy.Signals("transport_intent_timetable")) &&
		!containsAny(normalizedGoal, policy.Signals("temporal_today")) &&
		!containsAny(normalizedGoal, policy.Signals("temporal_tomorrow")) {
		return nil
	}
	if yearPattern.MatchString(normalizedGoal) &&
		!containsAny(normalizedGoal, policy.Signals("temporal_today")) &&
		!containsAny(normalizedGoal, policy.Signals("temporal_tomorrow")) {
		return nil
	}
	query := map[string]any{
		"date_mode": "today",
		"daypart":   "all_day",
	}
	if containsAny(normalizedGoal, policy.Signals("temporal_tomorrow")) {
		query["date_mode"] = "tomorrow"
	}
	if containsAny(normalizedGoal, policy.Signals("temporal_daypart_morning")) {
		query["daypart"] = "morning"
	} else if containsAny(normalizedGoal, policy.Signals("temporal_daypart_afternoon")) {
		query["daypart"] = "afternoon"
	} else if containsAny(normalizedGoal, policy.Signals("temporal_daypart_evening")) {
		query["daypart"] = "evening"
	}
	return query
}

func temporalQueryPayload(
	versionQuery VersionQuery,
	normalizedGoal string,
	policy runtimepolicy.IntentPolicyArtifact,
) map[string]any {
	if versionQuery.Mode == "as_of" {
		return map[string]any{
			"mode":  "as_of",
			"as_of": versionQuery.AsOf,
		}
	}
	if match := yearPattern.FindStringSubmatch(normalizedGoal); len(match) == 2 {
		return map[string]any{
			"mode":      "current_year",
			"year_hint": match[1],
		}
	}
	return map[string]any{"mode": "current"}
}

func campusScopeFromGoal(
	normalizedGoal string,
	policy runtimepolicy.IntentPolicyArtifact,
) string {
	if containsAny(normalizedGoal, policy.Signals("campus_scope_haidian")) {
		return "haidian"
	}
	if containsAny(normalizedGoal, policy.Signals("campus_scope_fengtai")) {
		return "fengtai"
	}
	return ""
}

func isServiceGuideLookup(
	normalizedGoal string,
	policy runtimepolicy.IntentPolicyArtifact,
) bool {
	if runtimepolicyDirectoryLookupGuideQuery(normalizedGoal) {
		return true
	}
	if isAcademicCalendarGuideQuery(normalizedGoal) {
		return true
	}
	return containsAny(normalizedGoal, policy.Signals("structured_service_guide_subject")) &&
		containsAny(normalizedGoal, policy.Signals("structured_service_guide_action"))
}

func isContactDirectoryLookup(
	normalizedGoal string,
	policy runtimepolicy.IntentPolicyArtifact,
) bool {
	return containsAny(normalizedGoal, policy.Signals("structured_contact_directory")) &&
		containsAny(normalizedGoal, policy.Signals("structured_contact_directory_action"))
}

func shouldPreferServiceGuideOverContactDirectory(
	normalizedGoal string,
	policy runtimepolicy.IntentPolicyArtifact,
) bool {
	return containsAny(normalizedGoal, policy.Signals("structured_service_guide_subject")) &&
		containsAny(normalizedGoal, policy.Signals("structured_service_guide_action")) &&
		containsAny(normalizedGoal, policy.Signals("service_guide_focus_entry"))
}

func isTransportBoardingStatusLookup(
	normalizedGoal string,
	policy runtimepolicy.IntentPolicyArtifact,
) bool {
	return containsAny(normalizedGoal, policy.Signals("structured_transport")) &&
		containsAny(normalizedGoal, policy.Signals("structured_transport_boarding_status"))
}

func isTransportServiceGuideLookup(
	normalizedGoal string,
	policy runtimepolicy.IntentPolicyArtifact,
) bool {
	return containsAny(normalizedGoal, policy.Signals("structured_transport")) &&
		containsAny(normalizedGoal, policy.Signals("structured_transport_service_guide_action"))
}

func classifyServiceGuideFocus(
	normalizedGoal string,
	policy runtimepolicy.IntentPolicyArtifact,
) string {
	if runtimepolicyDirectoryLookupGuideQuery(normalizedGoal) {
		return "procedure"
	}
	if isAcademicCalendarGuideQuery(normalizedGoal) {
		return "procedure"
	}
	if containsAny(normalizedGoal, policy.Signals("service_guide_focus_required_materials")) {
		return "required_materials"
	}
	if containsAny(normalizedGoal, policy.Signals("service_guide_focus_entry")) {
		return "entry"
	}
	if containsAny(normalizedGoal, policy.Signals("service_guide_focus_office_hours")) {
		return "office_hours"
	}
	if containsAny(normalizedGoal, policy.Signals("service_guide_focus_contact")) {
		return "contact"
	}
	if containsAny(normalizedGoal, policy.Signals("service_guide_focus_eligibility")) ||
		strings.Contains(normalizedGoal, "哪些人能办") ||
		strings.Contains(normalizedGoal, "哪些人可以办") ||
		strings.Contains(normalizedGoal, "什么人能办") ||
		strings.Contains(normalizedGoal, "谁可以办") {
		return "eligibility"
	}
	if containsAny(normalizedGoal, policy.Signals("service_guide_focus_full_guide")) {
		return "full_guide"
	}
	return "procedure"
}

func classifyContactDirectoryFocus(
	normalizedGoal string,
	policy runtimepolicy.IntentPolicyArtifact,
) string {
	if containsAny(normalizedGoal, policy.Signals("contact_directory_focus_email")) {
		return "email"
	}
	if containsAny(normalizedGoal, policy.Signals("contact_directory_focus_location")) {
		return "location"
	}
	if containsAny(normalizedGoal, policy.Signals("contact_directory_focus_office_hours")) {
		return "office_hours"
	}
	if containsAny(normalizedGoal, policy.Signals("contact_directory_focus_contact_person")) {
		return "contact_person"
	}
	if containsAny(normalizedGoal, policy.Signals("contact_directory_focus_phone")) {
		return "phone"
	}
	return "all_contacts"
}

func containsAny(value string, signals []string) bool {
	for _, signal := range signals {
		normalizedSignal := runtimepolicy.NormalizeGoal(signal)
		if normalizedSignal != "" && strings.Contains(value, normalizedSignal) {
			return true
		}
	}
	return false
}

func runtimepolicyDirectoryLookupGuideQuery(normalizedGoal string) bool {
	if !(strings.Contains(normalizedGoal, "办公电话") || strings.Contains(normalizedGoal, "通讯录")) {
		return false
	}
	return strings.Contains(normalizedGoal, "怎么查") ||
		strings.Contains(normalizedGoal, "如何查") ||
		strings.Contains(normalizedGoal, "怎么找") ||
		strings.Contains(normalizedGoal, "如何找") ||
		strings.Contains(normalizedGoal, "在哪里找") ||
		strings.Contains(normalizedGoal, "在哪找") ||
		strings.Contains(normalizedGoal, "在哪儿找")
}

func isAcademicCalendarGuideQuery(normalizedGoal string) bool {
	if !strings.Contains(normalizedGoal, "校历") {
		return false
	}
	return strings.Contains(normalizedGoal, "怎么看") ||
		strings.Contains(normalizedGoal, "如何看") ||
		strings.Contains(normalizedGoal, "在哪里看") ||
		strings.Contains(normalizedGoal, "在哪看") ||
		strings.Contains(normalizedGoal, "在哪儿看") ||
		strings.Contains(normalizedGoal, "怎么查") ||
		strings.Contains(normalizedGoal, "如何查")
}

func defaultString(value string, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return value
}
