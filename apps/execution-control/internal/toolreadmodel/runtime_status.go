package toolreadmodel

import (
	"context"
)

func (r *Runtime) Status(ctx context.Context) Status {
	hasPostgresProjection := r.campusServicesOpsReleaseStore != nil ||
		r.transportScheduleReadModelStore != nil
	status := Status{
		Configured:       hasPostgresProjection,
		ProjectionSource: projectionSourceLabel(hasPostgresProjection),
	}
	if r.campusServicesOpsReleaseStore != nil {
		status.CampusServicesOpsReleaseReady = projectionReady(ctx, r.campusServicesOpsReleaseStore)
	}
	if r.transportScheduleReadModelStore != nil {
		status.TransportScheduleImplemented = projectionReady(ctx, r.transportScheduleReadModelStore)
	}
	status.CampusServicesOpsReleaseConfigured = r.campusServicesOpsReleaseStore != nil
	status.CampusServicesOpsReleaseHealthy, status.ProjectionRuntimeLastError = projectionRuntimeComponentHealthy(
		ctx,
		r.campusServicesOpsReleaseStore,
		"campus_services_ops_release_unhealthy",
		status.ProjectionRuntimeLastError,
	)
	status.TransportScheduleReadModelConfigured = r.transportScheduleReadModelStore != nil
	status.TransportScheduleReadModelHealthy, status.ProjectionRuntimeLastError = projectionRuntimeComponentHealthy(
		ctx,
		r.transportScheduleReadModelStore,
		"transport_schedule_read_model_unhealthy",
		status.ProjectionRuntimeLastError,
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

func projectionRuntimeComponentHealthy(
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
	checkCtx, cancel := context.WithTimeout(ctx, defaultToolReadModelHealthTimeout)
	defer cancel()
	if err := checker.HealthCheck(checkCtx); err != nil {
		return false, appendProjectionRuntimeLastError(lastError, unhealthyReason)
	}
	return true, lastError
}

func appendProjectionRuntimeLastError(current string, reason string) string {
	if current == "" {
		return reason
	}
	return current + "," + reason
}
