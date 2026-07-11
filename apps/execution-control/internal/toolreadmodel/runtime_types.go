package toolreadmodel

import "time"

const (
	ToolTransportScheduleLookup = "transport_schedule_lookup"

	defaultToolReadModelHealthTimeout = 250 * time.Millisecond
)

type Options struct {
	CampusServicesOpsReleaseStore   CampusServicesOpsReleaseStore
	TransportScheduleReadModelStore TransportScheduleReadModelStore
	StructuredProjectionDatabaseURL string
	TrustedTimeRFC3339              string
}

type Runtime struct {
	campusServicesOpsReleaseStore   CampusServicesOpsReleaseStore
	campusServicesOpsReleaseCache   campusServicesOpsReleaseCache
	transportScheduleReadModelStore TransportScheduleReadModelStore
	transportScheduleBundleCache    projectionBundleCache
	trustedTime                     time.Time
}

type Status struct {
	Configured                           bool   `json:"configured"`
	ProjectionSource                     string `json:"projection_source"`
	CampusServicesOpsReleaseConfigured   bool   `json:"campus_services_ops_release_configured"`
	CampusServicesOpsReleaseReady        bool   `json:"campus_services_ops_release_ready"`
	CampusServicesOpsReleaseHealthy      bool   `json:"campus_services_ops_release_healthy"`
	TransportScheduleReadModelConfigured bool   `json:"transport_schedule_read_model_configured"`
	TransportScheduleReadModelHealthy    bool   `json:"transport_schedule_read_model_healthy"`
	TransportScheduleImplemented         bool   `json:"transport_schedule_implemented"`
	ProjectionRuntimeLastError           string `json:"projection_runtime_last_error"`
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
	SchemaVersion               string                             `json:"schema_version"`
	TransportScheduleSnapshots  []transportScheduleSnapshotRecord  `json:"transport_schedule_snapshots"`
	TransportRoutes             []transportRouteRecord             `json:"transport_routes"`
	ScheduledDepartures         []scheduledDepartureRecord         `json:"scheduled_departures"`
	TransportServiceExceptions  []transportServiceExceptionRecord  `json:"transport_service_exceptions"`
	TransportOperationalNotices []transportOperationalNoticeRecord `json:"transport_operational_notices"`
	TransportReleaseNotices     []transportReleaseNoticeRecord     `json:"transport_release_notices"`
}

type ProjectionBundle = projectionBundle
