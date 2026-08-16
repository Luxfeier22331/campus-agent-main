package httpapi

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

type finalizationResultMutatingStore struct {
	*execution.InMemoryRunProjectionStore
	mutateStepResults func([]execution.StepResultProjection) []execution.StepResultProjection
}

func (s *finalizationResultMutatingStore) ListStepResults(
	ctx context.Context,
	runID string,
) ([]execution.StepResultProjection, error) {
	results, err := s.InMemoryRunProjectionStore.ListStepResults(ctx, runID)
	if err == nil && s.mutateStepResults != nil {
		results = s.mutateStepResults(results)
	}
	return results, err
}

func TestWriteFinalizationActivityRejectsInvalidWorkflowAgentResult(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(*temporalruntime.WriteFinalizationActivityInput)
	}{
		{
			name: "agent result ref drift",
			mutate: func(input *temporalruntime.WriteFinalizationActivityInput) {
				input.AgentResult.AgentResultRef = "projection://runs/other/agent/primary/result"
			},
		},
		{
			name: "agent run id drift",
			mutate: func(input *temporalruntime.WriteFinalizationActivityInput) {
				input.AgentResult.RunID = "other-run"
			},
		},
		{
			name: "retrieval admission without result",
			mutate: func(input *temporalruntime.WriteFinalizationActivityInput) {
				input.AdmissionSnapshot.CampusDocsRetrieval = temporalruntime.CampusDocsRetrievalAdmission{}
			},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			server, store, input := primaryAgentFinalizationTrustChainFixture(t, test.name)
			test.mutate(&input)

			if _, err := server.WriteFinalizationActivity(context.Background(), input); err == nil {
				t.Fatal("finalization unexpectedly accepted invalid workflow agent result")
			}
			run, err := store.GetRun(context.Background(), input.RunID)
			if err != nil {
				t.Fatalf("get run after rejected finalization: %v", err)
			}
			if run.Status != execution.DurableRunStatusRunning {
				t.Fatalf("run status = %q, want running after fail-closed finalization", run.Status)
			}
		})
	}
}

func TestCompletedFinalizationReplayOnlyValidatesCanonicalResult(t *testing.T) {
	tests := []struct {
		name   string
		mutate func([]execution.StepResultProjection) []execution.StepResultProjection
	}{
		{
			name: "missing finalization result",
			mutate: func(results []execution.StepResultProjection) []execution.StepResultProjection {
				filtered := make([]execution.StepResultProjection, 0, len(results))
				for _, result := range results {
					if result.StepID != "finalization.write" {
						filtered = append(filtered, result)
					}
				}
				return filtered
			},
		},
		{
			name: "arbitrary completed result",
			mutate: func(results []execution.StepResultProjection) []execution.StepResultProjection {
				for index := range results {
					if results[index].StepID == "finalization.write" {
						results[index].ResultID += ":other"
					}
				}
				return results
			},
		},
		{
			name: "finalization ref drift",
			mutate: func(results []execution.StepResultProjection) []execution.StepResultProjection {
				for index := range results {
					if results[index].StepID == "finalization.write" {
						results[index].ProjectionRef = "projection://runs/other/finalization/write"
					}
				}
				return results
			},
		},
		{
			name: "finalization fingerprint drift",
			mutate: func(results []execution.StepResultProjection) []execution.StepResultProjection {
				for index := range results {
					if results[index].StepID == "finalization.write" {
						results[index].SanitizedPayload["finalization_fingerprint_sha256"] = strings.Repeat("0", 64)
					}
				}
				return results
			},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			server, baseStore, input := primaryAgentFinalizationTrustChainFixture(t, test.name)
			if _, err := server.WriteFinalizationActivity(context.Background(), input); err != nil {
				t.Fatalf("seed completed finalization: %v", err)
			}
			before, err := baseStore.ListStepResults(context.Background(), input.RunID)
			if err != nil {
				t.Fatalf("list finalization results before replay: %v", err)
			}
			server.runProjectionStore = &finalizationResultMutatingStore{
				InMemoryRunProjectionStore: baseStore,
				mutateStepResults:          test.mutate,
			}
			if _, err := server.WriteFinalizationActivity(context.Background(), input); err == nil {
				t.Fatal("completed finalization replay unexpectedly accepted invalid result")
			}
			after, err := baseStore.ListStepResults(context.Background(), input.RunID)
			if err != nil {
				t.Fatalf("list finalization results after replay: %v", err)
			}
			if len(after) != len(before) {
				t.Fatalf("completed replay wrote step results: before=%d after=%d", len(before), len(after))
			}
		})
	}
}

func primaryAgentFinalizationTrustChainFixture(
	t *testing.T,
	suffix string,
) (*Server, *execution.InMemoryRunProjectionStore, temporalruntime.WriteFinalizationActivityInput) {
	t.Helper()
	runID := "run-finalization-trust-" + strings.ReplaceAll(suffix, " ", "-")
	now := time.Date(2026, 7, 23, 16, 0, 0, 0, time.UTC)
	store := execution.NewInMemoryRunProjectionStore()
	createHTTPAPIQueuedDurableRunForTest(
		t,
		store,
		runID,
		"conv-"+runID,
		now,
		agentRequestForDurableWorkerTest("请回答当前问题"),
	)
	server := NewServer(config.Config{TemporalWorkerIdentity: "test:finalization:trust"})
	attachRunProjectionStoreForHandlerTest(server, store)
	agentResultRef := temporalProjectionRef(runID, "agent/primary/result")
	input := preparePrimaryAgentFinalizationRunForTest(t, server, store, runID, now, map[string]any{
		"agent_result_ref":  agentResultRef,
		"final_output":      "这是受信任的最终答案。",
		"status":            "completed",
		"terminal_envelope": map[string]any{"kind": "answer", "answer_text": "这是受信任的最终答案。"},
		"terminal_reason":   "answer_completed",
		"tool_results":      []map[string]any{},
	})
	server.productFinalizationWriter = func(
		context.Context,
		execution.DurableRun,
		time.Time,
		map[string]any,
	) error {
		return nil
	}
	return server, store, input
}
