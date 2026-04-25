package structuredplanning

import (
	"regexp"
	"strings"

	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/runtimepolicy"
)

var yearPattern = regexp.MustCompile(`(20\d{2})年`)

var transportSignals = []string{"校车", "班车", "通勤车", "接驳车"}

var transactionalActionSignals = []string{
	"提交",
	"办理",
	"申请",
	"报名",
	"预约",
	"缴费",
	"代办",
	"帮我办",
}

var serviceStatusSignals = []string{
	"开门",
	"开放",
	"营业",
	"办公时间",
	"开放时间",
	"开到几点",
	"状态",
}

var noticeGetSignals = []string{
	"这条通知",
	"这则通知",
	"通知原文",
	"通知详情",
	"读取这条通知",
	"打开这条通知",
}

type Request struct {
	EffectiveCapability string
	UserGoal            string
	VersionQuery        VersionQuery
	SelectedNoticeRef   SelectedNoticeRef
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

func Plan(request Request) *Handoff {
	normalizedGoal := normalizeGoal(request.UserGoal)
	if normalizedGoal == "" || containsAny(normalizedGoal, transactionalActionSignals) {
		return nil
	}
	if request.EffectiveCapability == "campus_services" {
		if containsAny(normalizedGoal, transportSignals) {
			return &Handoff{
				Target:       "campus-services-agent",
				PayloadKind:  "transport_schedule_lookup",
				Payload:      transportSchedulePayload(request.UserGoal, normalizedGoal, request.VersionQuery),
				AllowedTools: runtimepolicy.AllowedToolsForPayloadKind("campus-services-agent", "transport_schedule_lookup"),
			}
		}
		if containsAny(normalizedGoal, serviceStatusSignals) {
			return &Handoff{
				Target:       "campus-services-agent",
				PayloadKind:  "service_status_lookup",
				Payload:      serviceStatusPayload(request.UserGoal, normalizedGoal, request.VersionQuery),
				AllowedTools: runtimepolicy.AllowedToolsForPayloadKind("campus-services-agent", "service_status_lookup"),
			}
		}
		return nil
	}
	if request.EffectiveCapability == "notice" {
		selectedNoticeRef := request.SelectedNoticeRef
		if selectedNoticeRef.NoticeID != "" && containsAny(normalizedGoal, noticeGetSignals) {
			payload := map[string]any{
				"notice_id": selectedNoticeRef.NoticeID,
			}
			if selectedNoticeRef.SourceFamily != "" {
				payload["source_family"] = selectedNoticeRef.SourceFamily
			}
			return &Handoff{
				Target:       "notice-agent",
				PayloadKind:  "campus_notice_get",
				Payload:      payload,
				AllowedTools: runtimepolicy.AllowedToolsForPayloadKind("notice-agent", "campus_notice_get"),
			}
		}
		return &Handoff{
			Target:       "notice-agent",
			PayloadKind:  "campus_notice_discover",
			Payload:      noticeDiscoverPayload(request.UserGoal, normalizedGoal, request.VersionQuery),
			AllowedTools: runtimepolicy.AllowedToolsForPayloadKind("notice-agent", "campus_notice_discover"),
		}
	}
	return nil
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
) map[string]any {
	payload := map[string]any{
		"query_text":     userGoal,
		"intent":         classifyTransportIntent(normalizedGoal),
		"snapshot_query": temporalQueryPayload(versionQuery, normalizedGoal),
	}
	if routeSelector := transportRouteSelectorPayload(normalizedGoal); len(routeSelector) > 0 {
		payload["route_selector"] = routeSelector
	}
	if serviceTimeQuery := transportServiceTimeQueryPayload(normalizedGoal); len(serviceTimeQuery) > 0 {
		payload["service_time_query"] = serviceTimeQuery
	}
	return payload
}

func serviceStatusPayload(
	userGoal string,
	normalizedGoal string,
	versionQuery VersionQuery,
) map[string]any {
	payload := map[string]any{
		"subject_query":  userGoal,
		"temporal_query": temporalQueryPayload(versionQuery, normalizedGoal),
	}
	if campusScope := campusScopeFromGoal(normalizedGoal); campusScope != "" {
		payload["campus_scope"] = campusScope
	}
	return payload
}

func noticeDiscoverPayload(
	userGoal string,
	normalizedGoal string,
	versionQuery VersionQuery,
) map[string]any {
	return map[string]any{
		"query_text":     userGoal,
		"temporal_query": temporalQueryPayload(versionQuery, normalizedGoal),
	}
}

func classifyTransportIntent(normalizedGoal string) string {
	if containsAny(normalizedGoal, []string{"时刻表"}) {
		if containsAny(normalizedGoal, []string{"最新", "最近"}) {
			return "schedule_snapshot_metadata"
		}
		return "timetable"
	}
	if containsAny(normalizedGoal, []string{"最早"}) {
		return "first_departure"
	}
	if containsAny(normalizedGoal, []string{"最后", "最晚"}) {
		return "last_departure"
	}
	if containsAny(normalizedGoal, []string{"还有哪些", "哪些班次", "以后有哪些"}) {
		return "departure_list"
	}
	if containsAny(normalizedGoal, []string{"停运", "还跑不跑", "运营时间"}) {
		return "service_window"
	}
	return "next_departure"
}

func transportRouteSelectorPayload(normalizedGoal string) map[string]any {
	selector := map[string]any{}
	if containsAny(normalizedGoal, []string{"地铁"}) {
		selector["service_family"] = "metro_shuttle"
	} else if containsAny(normalizedGoal, []string{"通勤车"}) {
		selector["service_family"] = "intercampus_commute"
	}
	if containsAny(normalizedGoal, []string{"去丰台", "到丰台"}) {
		selector["destination_campus"] = "fengtai"
		if containsAny(normalizedGoal, []string{"海淀"}) {
			selector["origin_campus"] = "haidian"
		}
	} else if containsAny(normalizedGoal, []string{"回海淀", "到海淀"}) {
		selector["destination_campus"] = "haidian"
		if containsAny(normalizedGoal, []string{"丰台"}) {
			selector["origin_campus"] = "fengtai"
		}
	}
	return selector
}

func transportServiceTimeQueryPayload(normalizedGoal string) map[string]any {
	if containsAny(normalizedGoal, []string{"时刻表"}) &&
		!containsAny(normalizedGoal, []string{"今天", "明天"}) {
		return nil
	}
	if yearPattern.MatchString(normalizedGoal) &&
		!containsAny(normalizedGoal, []string{"今天", "明天"}) {
		return nil
	}
	query := map[string]any{
		"date_mode": "today",
		"daypart":   "all_day",
	}
	if containsAny(normalizedGoal, []string{"明天"}) {
		query["date_mode"] = "tomorrow"
	}
	if containsAny(normalizedGoal, []string{"早上", "上午"}) {
		query["daypart"] = "morning"
	} else if containsAny(normalizedGoal, []string{"下午"}) {
		query["daypart"] = "afternoon"
	} else if containsAny(normalizedGoal, []string{"晚上", "傍晚"}) {
		query["daypart"] = "evening"
	}
	return query
}

func temporalQueryPayload(versionQuery VersionQuery, normalizedGoal string) map[string]any {
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

func campusScopeFromGoal(normalizedGoal string) string {
	if containsAny(normalizedGoal, []string{"海淀"}) {
		return "haidian"
	}
	if containsAny(normalizedGoal, []string{"丰台"}) {
		return "fengtai"
	}
	return ""
}

func normalizeGoal(userGoal string) string {
	return strings.ToLower(strings.Join(strings.Fields(userGoal), ""))
}

func containsAny(value string, signals []string) bool {
	for _, signal := range signals {
		normalizedSignal := normalizeGoal(signal)
		if normalizedSignal != "" && strings.Contains(value, normalizedSignal) {
			return true
		}
	}
	return false
}
