package structuredquery

type transportScheduleRequest struct {
	QueryText        string                     `json:"query_text"`
	Intent           string                     `json:"intent"`
	RouteSelector    *transportRouteSelector    `json:"route_selector"`
	SnapshotQuery    temporalQuery              `json:"snapshot_query"`
	ServiceTimeQuery *transportServiceTimeQuery `json:"service_time_query"`
	ResultLimit      *int                       `json:"result_limit"`
}

type transportRouteSelector struct {
	RouteID              string `json:"route_id"`
	ServiceFamily        string `json:"service_family"`
	RouteVariantQuery    string `json:"route_variant_query"`
	OriginCampus         string `json:"origin_campus"`
	DestinationCampus    string `json:"destination_campus"`
	OriginStopQuery      string `json:"origin_stop_query"`
	DestinationStopQuery string `json:"destination_stop_query"`
}

type transportServiceTimeQuery struct {
	DateMode           string `json:"date_mode"`
	ServiceDate        string `json:"service_date"`
	Daypart            string `json:"daypart"`
	DepartureNotBefore string `json:"departure_not_before"`
	DepartureNotAfter  string `json:"departure_not_after"`
}

type transportScheduleResult struct {
	QueryText            string                        `json:"query_text"`
	Intent               string                        `json:"intent"`
	Outcome              string                        `json:"outcome"`
	ResolvedRoute        *transportRouteRef            `json:"resolved_route,omitempty"`
	QueriedTimeAnchor    string                        `json:"queried_time_anchor,omitempty"`
	RequestedServiceDate string                        `json:"requested_service_date,omitempty"`
	ServiceStatus        string                        `json:"service_status,omitempty"`
	SelectedDeparture    *scheduledDeparture           `json:"selected_departure,omitempty"`
	DepartureOptions     []scheduledDeparture          `json:"departure_options,omitempty"`
	ServiceWindow        *transportServiceWindow       `json:"service_window,omitempty"`
	ScheduleSnapshot     *transportScheduleSnapshotRef `json:"schedule_snapshot,omitempty"`
	TimetableEntries     []scheduledDeparture          `json:"timetable_entries,omitempty"`
	CandidateRoutes      []transportRouteCandidate     `json:"candidate_routes,omitempty"`
	ClarificationReason  string                        `json:"clarification_reason,omitempty"`
	StopRefs             []transportStopRef            `json:"stop_refs,omitempty"`
	RelatedNoticeRefs    []string                      `json:"related_notice_refs,omitempty"`
	OperationalNotices   []transportOperationalNotice  `json:"operational_notices,omitempty"`
	FailCloseReason      string                        `json:"fail_close_reason,omitempty"`
	ResultEnvelope       *campusServicesResultEnvelope `json:"result_envelope,omitempty"`
}

type campusServicesResultEnvelope struct {
	SchemaVersion        string                      `json:"schema_version"`
	Capability           string                      `json:"capability"`
	ToolName             string                      `json:"tool_name"`
	QueryKind            string                      `json:"query_kind"`
	Outcome              string                      `json:"outcome"`
	Facts                campusServicesScheduleFacts `json:"facts"`
	SourceRefs           []string                    `json:"source_refs"`
	ProjectionRef        string                      `json:"projection_ref"`
	ContentHash          string                      `json:"content_hash"`
	ClarificationOptions []string                    `json:"clarification_options"`
	FailCloseReason      string                      `json:"fail_close_reason,omitempty"`
}

type campusServicesScheduleFacts struct {
	Kind   string                  `json:"kind"`
	Result transportScheduleResult `json:"result"`
}

type transportRouteRef struct {
	RouteID       string `json:"route_id"`
	DisplayName   string `json:"display_name"`
	ServiceFamily string `json:"service_family"`
}

type transportStopRef struct {
	StopID      string `json:"stop_id"`
	DisplayName string `json:"display_name"`
}

type scheduledDeparture struct {
	DepartureAt        string            `json:"departure_at"`
	ArrivalAt          string            `json:"arrival_at,omitempty"`
	OriginStopRef      *transportStopRef `json:"origin_stop_ref,omitempty"`
	DestinationStopRef *transportStopRef `json:"destination_stop_ref,omitempty"`
	DepartureStatus    string            `json:"departure_status"`
	DepartureKind      string            `json:"departure_kind"`
	OperationalNote    string            `json:"operational_note,omitempty"`
	RelatedNoticeRefs  []string          `json:"related_notice_refs,omitempty"`
}

type transportServiceWindow struct {
	FirstDepartureAt string `json:"first_departure_at,omitempty"`
	LastDepartureAt  string `json:"last_departure_at,omitempty"`
}

type transportScheduleSnapshotRef struct {
	SnapshotID     string `json:"snapshot_id"`
	PublishedAt    string `json:"published_at"`
	EffectiveFrom  string `json:"effective_from,omitempty"`
	EffectiveUntil string `json:"effective_until,omitempty"`
	SourceRef      string `json:"source_ref"`
}

type transportRouteCandidate struct {
	Route             transportRouteRef `json:"route"`
	ClarificationHint string            `json:"clarification_hint,omitempty"`
}

type transportOperationalNotice struct {
	NoticeID           string   `json:"notice_id"`
	SourceRef          string   `json:"source_ref"`
	NoticeKind         string   `json:"notice_kind"`
	RouteIDs           []string `json:"route_ids"`
	EffectiveFrom      string   `json:"effective_from,omitempty"`
	EffectiveUntil     string   `json:"effective_until,omitempty"`
	OperationalComment string   `json:"operational_comment"`
}
