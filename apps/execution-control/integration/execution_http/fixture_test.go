//go:build temporal_integration

package execution_http_test

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"

	temporaladapter "github.com/MUC-WIKI/campus-agent/apps/execution-control/integration/adaptertest"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/integration/temporalfake"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/integration/temporaltest"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/contracts"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionapplication"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionreadmodel"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionreconciler"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/httpapi"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/runtimeassembly"
	workflowcontract "github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporaladapter/contract"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporaladapter/control"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

var packageHarness *temporaltest.Harness

func TestMain(m *testing.M) {
	os.Exit(temporaltest.RunPackage(m, &packageHarness))
}

// Assemble production HTTP commands, reconciliation and Temporal startup through
// public ports. Upstream inputs, model configuration and activities are fake.
func newExecutionServer(t *testing.T, ctx context.Context, store executionapplication.RunStore) (*httpapi.Server, *executionreconciler.Reconciler) {
	t.Helper()
	starter, err := runtimeassembly.NewStarter(ctx, temporalruntime.StarterOptions{
		Address:      packageHarness.Address,
		Namespace:    packageHarness.Namespace,
		TaskQueue:    temporalruntime.WorkflowTaskQueue,
		StartTimeout: 5 * time.Second,
	})
	if err != nil {
		t.Fatalf("create Temporal starter: %v", err)
	}
	t.Cleanup(starter.Close)
	cfg := config.Config{
		AppAPIExecutionSharedSecret: "secret",
		TemporalNamespace:           packageHarness.Namespace,
		TemporalTaskQueue:           temporalruntime.WorkflowTaskQueue,
	}
	adapter := temporaladapter.New(temporaladapter.Options{
		Config:                    cfg,
		RunProjectionStore:        store,
		ProductFinalizationWriter: func(context.Context, execution.DurableRun, time.Time, map[string]any) error { return nil },
	})
	reconciler := executionreconciler.New(executionreconciler.Options{Store: store, Starter: &control.Gateway{Starter: starter}, Finalizer: control.NewFinalizer(adapter)})
	service := executionapplication.NewRunService(executionapplication.RunServiceOptions{
		Store:                    store,
		Namespace:                packageHarness.Namespace,
		TaskQueue:                temporalruntime.WorkflowTaskQueue,
		InputLoader:              executionInputLoader{},
		AdmissionSnapshotBuilder: admissionSnapshotBuilder{},
	})
	server := httpapi.NewServerWithOptions(cfg, httpapi.ServerOptions{RunService: service, RunReader: executionreadmodel.NewStoreReader(store), TemporalStarter: &control.Gateway{Starter: starter}})
	return server, reconciler
}

type executionInputLoader struct{}

func (executionInputLoader) Load(_ context.Context, run execution.DurableRun) (contracts.ExecutionPayloadWire, error) {
	return contracts.ExecutionPayloadWire{
		ExecutionContractVersion: contracts.ExecutionContractVersion,
		ResponseContract:         contracts.ResponseContract,
		RequestID:                run.RequestID,
		ConversationID:           run.ConversationID,
		UserGoal:                 "校园服务指南",
		Context:                  map[string]any{},
	}, nil
}

type admissionSnapshotBuilder struct{}

func (admissionSnapshotBuilder) BuildAgentAdmissionSnapshot(context.Context, bool) (execution.AgentAdmissionSnapshot, error) {
	snapshot := temporalfake.WorkflowInput("admission").AdmissionSnapshot
	snapshot.AgentLimits = temporalruntime.AgentRuntimeLimitsSnapshot{AgentDeadlineMS: 1000, ContextCharLimit: 1000, CurrentInputCharLimit: 1000, MaxOutputTokens: 1000}
	snapshot.ModelTargetSHA256 = strings.Repeat("a", 64)
	snapshot.ToolContractFingerprint = temporalruntime.ToolContractFingerprintSnapshot{
		SchemaVersion:        execution.ToolContractFingerprintSchemaVersion,
		FunctionSchemaSHA256: "sha256:" + strings.Repeat("b", 64),
		ToolsSHA256:          "sha256:" + strings.Repeat("c", 64),
	}
	return workflowcontract.AdmissionToDomain(snapshot), nil
}
