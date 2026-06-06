package structuredquery

import (
	"context"
)

func (r *Runtime) Status(ctx context.Context) Status {
	hasPostgresProjection := r.serviceStatusReadModelStore != nil ||
		r.transportScheduleReadModelStore != nil ||
		r.serviceGuideReadModelStore != nil ||
		r.contactDirectoryReadModelStore != nil ||
		r.academicCalendarReadModelStore != nil
	status := Status{
		Configured:       hasPostgresProjection,
		ProjectionSource: projectionSourceLabel(hasPostgresProjection),
	}
	if r.serviceStatusReadModelStore != nil {
		status.ServiceStatusProjectionReady = projectionReady(ctx, r.serviceStatusReadModelStore)
	}
	if r.transportScheduleReadModelStore != nil {
		status.TransportScheduleImplemented = projectionReady(ctx, r.transportScheduleReadModelStore)
	}
	if r.serviceGuideReadModelStore != nil {
		status.ServiceGuideProjectionReady = projectionReady(ctx, r.serviceGuideReadModelStore)
	}
	if r.contactDirectoryReadModelStore != nil {
		status.ContactDirectoryProjectionReady = projectionReady(ctx, r.contactDirectoryReadModelStore)
	}
	if r.academicCalendarReadModelStore != nil {
		status.AcademicCalendarProjectionReady = projectionReady(ctx, r.academicCalendarReadModelStore)
	}
	status.ServiceStatusReadModelConfigured = r.serviceStatusReadModelStore != nil
	status.ServiceStatusReadModelHealthy, status.NoticeRuntimeLastError = noticeRuntimeComponentHealthy(
		ctx,
		r.serviceStatusReadModelStore,
		"service_status_read_model_unhealthy",
		status.NoticeRuntimeLastError,
	)
	status.TransportScheduleReadModelConfigured = r.transportScheduleReadModelStore != nil
	status.TransportScheduleReadModelHealthy, status.NoticeRuntimeLastError = noticeRuntimeComponentHealthy(
		ctx,
		r.transportScheduleReadModelStore,
		"transport_schedule_read_model_unhealthy",
		status.NoticeRuntimeLastError,
	)
	status.ServiceGuideReadModelConfigured = r.serviceGuideReadModelStore != nil
	status.ServiceGuideReadModelHealthy, status.NoticeRuntimeLastError = noticeRuntimeComponentHealthy(
		ctx,
		r.serviceGuideReadModelStore,
		"service_guide_read_model_unhealthy",
		status.NoticeRuntimeLastError,
	)
	status.ContactDirectoryReadModelConfigured = r.contactDirectoryReadModelStore != nil
	status.ContactDirectoryReadModelHealthy, status.NoticeRuntimeLastError = noticeRuntimeComponentHealthy(
		ctx,
		r.contactDirectoryReadModelStore,
		"contact_directory_read_model_unhealthy",
		status.NoticeRuntimeLastError,
	)
	status.AcademicCalendarReadModelConfigured = r.academicCalendarReadModelStore != nil
	status.AcademicCalendarReadModelHealthy, status.NoticeRuntimeLastError = noticeRuntimeComponentHealthy(
		ctx,
		r.academicCalendarReadModelStore,
		"academic_calendar_read_model_unhealthy",
		status.NoticeRuntimeLastError,
	)
	status.NoticeReadModelConfigured = r.noticeReadModelStore != nil
	status.NoticeBodyStoreConfigured = r.noticeBodyStore != nil
	status.NoticeReadModelHealthy, status.NoticeRuntimeLastError = noticeRuntimeComponentHealthy(
		ctx,
		r.noticeReadModelStore,
		"notice_read_model_unhealthy",
		status.NoticeRuntimeLastError,
	)
	status.NoticeBodyStoreHealthy, status.NoticeRuntimeLastError = noticeRuntimeComponentHealthy(
		ctx,
		r.noticeBodyStore,
		"notice_body_store_unhealthy",
		status.NoticeRuntimeLastError,
	)
	return status
}

func projectionSourceLabel(hasPostgresProjection bool) string {
	if hasPostgresProjection {
		return "postgres"
	}
	return ""
}

func projectionReady(
	ctx context.Context,
	store interface {
		ProjectionReady(context.Context) (bool, error)
	},
) bool {
	if store == nil {
		return false
	}
	ready, err := store.ProjectionReady(ctx)
	return err == nil && ready
}

func noticeRuntimeComponentHealthy(
	ctx context.Context,
	component any,
	unhealthyReason string,
	lastError string,
) (bool, string) {
	if component == nil {
		return false, lastError
	}
	checker, ok := component.(interface {
		HealthCheck(context.Context) error
	})
	if !ok {
		return true, lastError
	}
	if ctx == nil {
		ctx = context.Background()
	}
	checkCtx, cancel := context.WithTimeout(ctx, defaultStructuredRuntimeHealthTimeout)
	defer cancel()
	if err := checker.HealthCheck(checkCtx); err != nil {
		return false, appendNoticeRuntimeLastError(lastError, unhealthyReason)
	}
	return true, lastError
}

func appendNoticeRuntimeLastError(current string, reason string) string {
	if current == "" {
		return reason
	}
	return current + "," + reason
}
