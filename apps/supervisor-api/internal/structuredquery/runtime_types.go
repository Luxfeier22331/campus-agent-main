package structuredquery

import "time"

const (
	ToolServiceStatusLookup     = "service_status_lookup"
	ToolServiceGuideLookup      = "service_guide_lookup"
	ToolTransportScheduleLookup = "transport_schedule_lookup"
	ToolCampusNoticeDiscover    = "campus_notice_discover"
	ToolCampusNoticeGet         = "campus_notice_get"

	defaultStructuredRuntimeHealthTimeout = 250 * time.Millisecond
)

type Options struct {
	ProjectionPath                   string
	ServiceGuideProjectionPath       string
	ServiceGuideReadModelStore       ServiceGuideReadModelStore
	ServiceGuideReadModelDatabaseURL string
	ServiceGuideReadModelTable       string
	TrustedTimeRFC3339               string
	NoticeReadModelStore             NoticeReadModelStore
	NoticeBodyStore                  NoticeBodyStore
	NoticeReadModelDatabaseURL       string
	NoticeReadModelTable             string
	NoticeObjectStoreEndpoint        string
	NoticeObjectStoreAccessKey       string
	NoticeObjectStoreSecretKey       string
	NoticeObjectStoreRegion          string
	NoticeObjectStoreBucketDerived   string
	NoticeObjectStoreBodyLimitBytes  int64
}

type Runtime struct {
	projectionPath             string
	serviceGuideProjectionPath string
	serviceGuideReadModelStore ServiceGuideReadModelStore
	trustedTime                time.Time
	noticeReadModelStore       NoticeReadModelStore
	noticeBodyStore            NoticeBodyStore
}

type Status struct {
	Configured                      bool   `json:"configured"`
	ProjectionSource                string `json:"projection_source"`
	ServiceStatusProjectionReady    bool   `json:"service_status_projection_ready"`
	ServiceGuideProjectionReady     bool   `json:"service_guide_projection_ready"`
	ServiceGuideReadModelConfigured bool   `json:"service_guide_read_model_configured"`
	ServiceGuideReadModelHealthy    bool   `json:"service_guide_read_model_healthy"`
	TransportScheduleImplemented    bool   `json:"transport_schedule_implemented"`
	NoticeReadModelConfigured       bool   `json:"notice_read_model_configured"`
	NoticeBodyStoreConfigured       bool   `json:"notice_body_store_configured"`
	NoticeReadModelHealthy          bool   `json:"notice_read_model_healthy"`
	NoticeBodyStoreHealthy          bool   `json:"notice_body_store_healthy"`
	NoticeRuntimeLastError          string `json:"notice_runtime_last_error"`
}

type Response struct {
	StatusCode int
	Outcome    string
	Body       any
}

type HTTPError struct {
	Status  int
	Code    string
	Message string
}

type temporalQuery struct {
	Mode     string `json:"mode"`
	AsOf     string `json:"as_of"`
	YearHint string `json:"year_hint"`
}

type projectionBundle struct {
	SchemaVersion              string                            `json:"schema_version"`
	ServiceStatusRecords       []serviceStatusRecord             `json:"service_status_records"`
	ServiceGuideRecords        []serviceGuideRecord              `json:"service_guide_records"`
	ServiceGuideConflicts      []serviceGuideConflictRecord      `json:"conflict_records"`
	ServiceGuideManualReviews  []serviceGuideManualReviewRecord  `json:"manual_review_sources"`
	TransportScheduleSnapshots []transportScheduleSnapshotRecord `json:"transport_schedule_snapshots"`
	TransportRoutes            []transportRouteRecord            `json:"transport_routes"`
	ScheduledDepartures        []scheduledDepartureRecord        `json:"scheduled_departures"`
	TransportServiceExceptions []transportServiceExceptionRecord `json:"transport_service_exceptions"`
}
