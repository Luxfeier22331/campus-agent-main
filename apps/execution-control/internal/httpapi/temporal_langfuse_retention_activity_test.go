package httpapi

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
	"go.temporal.io/sdk/temporal"
)

func TestLangfuseTraceRetentionActivitiesUseBothFixedProjectStores(t *testing.T) {
	cutoff := time.Date(2026, 7, 10, 3, 0, 0, 0, time.UTC)
	runtimeStore := &fakePersonalMemoryTraceMaintenance{deleted: 5, count: 1}
	hindsightStore := &fakePersonalMemoryTraceMaintenance{deleted: 3, count: 2}
	server := &Server{
		runtimeTraceStore:        runtimeStore,
		personalMemoryTraceStore: hindsightStore,
	}
	input := temporalruntime.LangfuseTraceRetentionActivityInput{Cutoff: cutoff}

	purged, err := server.PurgeLangfuseTraceRetentionActivity(context.Background(), input)
	if err != nil {
		t.Fatal(err)
	}
	if purged.RuntimeTraceCount != 5 || purged.HindsightTraceCount != 3 {
		t.Fatalf("purge output = %#v", purged)
	}
	verified, err := server.VerifyLangfuseTraceRetentionActivity(context.Background(), input)
	if err != nil {
		t.Fatal(err)
	}
	if verified.RuntimeTraceCount != 1 || verified.HindsightTraceCount != 2 {
		t.Fatalf("verification output = %#v", verified)
	}
	if !runtimeStore.lastCutoff.Equal(cutoff) || !hindsightStore.lastCutoff.Equal(cutoff) {
		t.Fatalf("cutoffs runtime=%s hindsight=%s", runtimeStore.lastCutoff, hindsightStore.lastCutoff)
	}
}

func TestLangfuseTraceRetentionActivityFailsClosedWithoutBothProjects(t *testing.T) {
	server := &Server{runtimeTraceStore: &fakePersonalMemoryTraceMaintenance{}}
	_, err := server.PurgeLangfuseTraceRetentionActivity(
		context.Background(),
		temporalruntime.LangfuseTraceRetentionActivityInput{Cutoff: time.Now().UTC()},
	)
	var applicationError *temporal.ApplicationError
	if !errors.As(err, &applicationError) ||
		applicationError.Type() != "langfuse_trace_maintenance_not_configured" ||
		!applicationError.NonRetryable() {
		t.Fatalf("error = %v", err)
	}
}
