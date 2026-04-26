package structuredquery

import (
	"context"
)

func (r *Runtime) Status(ctx context.Context) Status {
	status := Status{
		Configured:       r.projectionPath != "" || r.serviceGuideProjectionPath != "",
		ProjectionSource: "file",
	}
	if r.projectionPath == "" && r.serviceGuideProjectionPath == "" {
		status.ProjectionSource = ""
	}
	if r.projectionPath != "" {
		bundle, err := r.loadBundle()
		status.ServiceStatusProjectionReady = err == nil && len(bundle.ServiceStatusRecords) > 0
		status.TransportScheduleImplemented = err == nil && len(bundle.TransportScheduleSnapshots) > 0
	}
	if r.serviceGuideProjectionPath != "" || r.projectionPath != "" {
		bundle, err := r.loadServiceGuideBundle()
		status.ServiceGuideProjectionReady = err == nil && len(bundle.ServiceGuideRecords) > 0
	}
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
