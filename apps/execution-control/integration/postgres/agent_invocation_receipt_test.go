//go:build postgres_integration

package postgres_test

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
	"testing"
	"time"

	temporaladapter "github.com/MUC-WIKI/campus-agent/apps/execution-control/integration/adaptertest"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/integration/agenttest"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionapplication"
	workflowcontract "github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporaladapter/contract"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

func testAgentInvocationReceipt(t *testing.T, harness *postgresHarness) {
	_, databaseURL := harness.ownerDatabase(t)
	store := newRunProjectionStore(t, databaseURL, true)
	now := time.Date(2026, 8, 20, 8, 0, 0, 0, time.UTC)
	if _, err := store.CreateRun(t.Context(), durableRun("run-receipt", "conversation-receipt", now)); err != nil {
		t.Fatalf("create run: %v", err)
	}
	output := json.RawMessage(`{"status":"completed","final_output":"完整回答","evidence":[{"id":"source-1","excerpt":"来源正文"}],"usage":{"input_tokens":12}}`)
	digest := sha256.Sum256(output)
	receipt := execution.AgentInvocationReceipt{
		InvocationID: "invocation-receipt",
		RequestID:    "run-receipt",
		InputSHA256:  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		CreatedAt:    now,
		UpdatedAt:    now,
	}
	claimed, disposition, err := store.Receipts.BeginAgentInvocation(t.Context(), receipt)
	if err != nil || disposition != execution.AgentInvocationDispositionClaimed {
		t.Fatalf("begin receipt = %#v, %s, %v", claimed, disposition, err)
	}
	if claimed.State != execution.AgentInvocationReceiptStateStarted || len(claimed.OutputJSON) != 0 {
		t.Fatalf("started receipt = %#v", claimed)
	}
	_, disposition, err = store.Receipts.BeginAgentInvocation(t.Context(), receipt)
	if err != nil || disposition != execution.AgentInvocationDispositionAmbiguous {
		t.Fatalf("unfinished receipt must not authorize a second execution: %s %v", disposition, err)
	}
	completed, err := store.Receipts.CompleteAgentInvocation(t.Context(), execution.AgentInvocationReceipt{
		InvocationID: receipt.InvocationID,
		RequestID:    receipt.RequestID,
		InputSHA256:  receipt.InputSHA256,
		OutputJSON:   output,
		OutputSHA256: hex.EncodeToString(digest[:]),
		CreatedAt:    now,
		CompletedAt:  now.Add(time.Second),
		UpdatedAt:    now.Add(time.Second),
	})
	if err != nil || string(completed.OutputJSON) != string(output) {
		t.Fatalf("complete receipt = %#v, %v", completed, err)
	}
	replayed, disposition, err := store.Receipts.BeginAgentInvocation(t.Context(), receipt)
	if err != nil || disposition != execution.AgentInvocationDispositionReplay ||
		replayed.State != execution.AgentInvocationReceiptStateCompleted ||
		replayed.OutputSHA256 != hex.EncodeToString(digest[:]) ||
		!replayed.CompletedAt.Equal(now.Add(time.Second)) {
		t.Fatalf("replay receipt = %#v, %s, %v", replayed, disposition, err)
	}
	// PostgreSQL jsonb normalizes whitespace and key order; compare full content.
	var want, got any
	if err := json.Unmarshal(output, &want); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(replayed.OutputJSON, &got); err != nil {
		t.Fatal(err)
	}
	if execution.HashAdmissionJSON(got) != execution.HashAdmissionJSON(want) {
		t.Fatalf("full output changed: %s", replayed.OutputJSON)
	}
	conflict := receipt
	conflict.InputSHA256 = strings.Repeat("b", 64)
	if _, _, err := store.Receipts.BeginAgentInvocation(t.Context(), conflict); !errors.Is(err, execution.ErrAgentInvocationConflict) {
		t.Fatalf("input conflict = %v", err)
	}
	conflict = receipt
	conflict.RequestID = "different-owner-run"
	if _, _, err := store.Receipts.BeginAgentInvocation(t.Context(), conflict); !errors.Is(err, execution.ErrAgentInvocationConflict) {
		t.Fatalf("identity conflict = %v", err)
	}
	conflict = completed
	conflict.OutputJSON = json.RawMessage(`{"status":"completed","final_output":"changed"}`)
	conflictDigest := sha256.Sum256(conflict.OutputJSON)
	conflict.OutputSHA256 = hex.EncodeToString(conflictDigest[:])
	if _, err := store.Receipts.CompleteAgentInvocation(t.Context(), conflict); !errors.Is(err, execution.ErrAgentInvocationConflict) {
		t.Fatalf("output conflict = %v", err)
	}
	service := executionapplication.NewReceiptService(store.Receipts)
	failed, _, err := service.Begin(t.Context(), "invocation-failed", receipt.RequestID, receipt.InputSHA256)
	if err != nil {
		t.Fatal(err)
	}
	if err := service.Fail(t.Context(), failed, "provider_failed"); err != nil {
		t.Fatal(err)
	}
	failed, disposition, err = service.Begin(t.Context(), failed.InvocationID, failed.RequestID, failed.InputSHA256)
	if err != nil || disposition != execution.AgentInvocationDispositionReplay || failed.State != execution.AgentInvocationReceiptStateFailed {
		t.Fatalf("failed receipt reopened: %#v %v", failed, err)
	}
	var failureOutput struct {
		Status  string `json:"status"`
		Failure struct {
			Code string `json:"code"`
		} `json:"failure"`
	}
	if err := json.Unmarshal(failed.OutputJSON, &failureOutput); err != nil || failureOutput.Status != "failed" || failureOutput.Failure.Code != "provider_failed" {
		t.Fatalf("failed receipt lost its output: %s %v", failed.OutputJSON, err)
	}
	if err := service.Complete(t.Context(), failed, map[string]string{"answer": "changed"}); !errors.Is(err, execution.ErrAgentInvocationConflict) {
		t.Fatalf("failed receipt changed state: %v", err)
	}
	// Retention is owned by the parent run: there is no separate receipt TTL.
	if err := store.DeleteRun(t.Context(), receipt.RequestID); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Receipts.GetAgentInvocationReceipt(t.Context(), receipt.InvocationID); !errors.Is(err, execution.ErrAgentInvocationNotFound) {
		t.Fatalf("receipt survived parent deletion: %v", err)
	}
	if _, err := store.Receipts.GetAgentInvocationReceipt(t.Context(), failed.InvocationID); !errors.Is(err, execution.ErrAgentInvocationNotFound) {
		t.Fatalf("failed receipt survived parent deletion: %v", err)
	}

	t.Run("adapter replay repairs projection without repeating provider execution", func(t *testing.T) {
		input := agenttest.CreateQueuedRun(t, store, "run-provider-replay")
		snapshot := agenttest.AdmissionSnapshot(t)
		provider := &receiptProvider{requestID: input.Wire.RequestID, fingerprint: execution.ToolContractFingerprintSnapshotMap(snapshot.ToolContractFingerprint)}
		adapter := temporaladapter.New(temporaladapter.Options{
			Config:             config.Config{AgentRuntimeBaseURL: "http://fixture.invalid", AgentRuntimeSharedSecret: "integration-secret"},
			RunProjectionStore: &receiptProjectionFailureStore{RunStore: store},
			ReceiptStore:       store.Receipts, ExecutionInputLoader: input, AgentRuntimeClient: provider,
		})
		request := temporalruntime.SolveTaskActivityInput{
			WorkflowOperationActivityInputBase: temporalruntime.WorkflowOperationActivityInputBase{
				RequestID: input.Wire.RequestID, ConversationID: input.Wire.ConversationID, AdmissionSnapshot: workflowcontract.AdmissionToWorkflow(snapshot),
			}, MaxSteps: 2,
		}
		_, err := adapter.SolveTask(t.Context(), request)
		if err == nil {
			t.Fatal("expected injected projection failure after receipt completion")
		}
		completedReceipt, err := store.Receipts.GetAgentInvocationReceipt(t.Context(), input.Wire.RequestID+":solve.initial")
		if err != nil {
			t.Fatal(err)
		}
		var first temporalruntime.WorkflowOperationActivityOutput
		if err := json.Unmarshal(completedReceipt.OutputJSON, &first); err != nil {
			t.Fatal(err)
		}
		restored, err := adapter.SolveTask(t.Context(), request)
		if err != nil {
			t.Fatal(err)
		}
		if provider.calls != 1 || execution.HashAdmissionJSON(first) != execution.HashAdmissionJSON(restored) {
			t.Fatalf("provider calls=%d; first=%#v restored=%#v", provider.calls, first, restored)
		}
		stored, err := store.Receipts.GetAgentInvocationReceipt(t.Context(), input.Wire.RequestID+":solve.initial")
		if err != nil {
			t.Fatal(err)
		}
		var persisted temporalruntime.WorkflowOperationActivityOutput
		if err := json.Unmarshal(stored.OutputJSON, &persisted); err != nil {
			t.Fatal(err)
		}
		if execution.HashAdmissionJSON(persisted) != execution.HashAdmissionJSON(first) || stored.OutputSHA256 != execution.HashAdmissionJSON(first) {
			t.Fatalf("receipt did not retain full operation result and hash: %#v", stored)
		}
		conn := connect(t, databaseURL)
		defer closeConn(t, conn)
		if _, err := conn.Exec(t.Context(), "update execution_control.agent_invocation_receipts set output_json=$1::jsonb where invocation_id=$2", "{broken", stored.InvocationID); err == nil {
			t.Fatal("PostgreSQL accepted malformed receipt JSON")
		}
		for _, kind := range []string{"unknown", "type", "digest", "oversize"} {
			t.Run(kind, func(t *testing.T) {
				var payload map[string]any
				if err := json.Unmarshal(stored.OutputJSON, &payload); err != nil {
					t.Fatal(err)
				}
				switch kind {
				case "unknown":
					payload["raw_debug"] = "private receipt debug"
				case "type":
					payload["status"] = 42
				case "digest":
					payload["final_output"] = "tampered answer"
				case "oversize":
					payload["final_output"] = strings.Repeat("x", execution.MaxAgentOperationPayloadBytes)
				}
				encoded, err := json.Marshal(payload)
				if err != nil {
					t.Fatal(err)
				}
				if _, err := conn.Exec(t.Context(), "update execution_control.agent_invocation_receipts set output_json=$1::jsonb where invocation_id=$2", string(encoded), stored.InvocationID); err != nil {
					t.Fatal(err)
				}
				if _, err := adapter.SolveTask(t.Context(), request); err == nil {
					t.Fatal("invalid receipt was replayed")
				}
				if provider.calls != 1 {
					t.Fatal("invalid receipt invoked provider")
				}
				if _, err := conn.Exec(t.Context(), "update execution_control.agent_invocation_receipts set output_json=$1::jsonb where invocation_id=$2", string(stored.OutputJSON), stored.InvocationID); err != nil {
					t.Fatal(err)
				}
			})
		}
		if _, err := adapter.SolveTask(t.Context(), request); err != nil {
			t.Fatal(err)
		}
	})
}

type receiptProjectionFailureStore struct {
	executionapplication.RunStore
	failed bool
}

func (s *receiptProjectionFailureStore) UpsertStepResult(ctx context.Context, result execution.StepResultProjection) (execution.StepResultProjection, error) {
	if result.StepID == "solve.initial" && result.Status == "completed" && !s.failed {
		s.failed = true
		return execution.StepResultProjection{}, errors.New("injected projection failure after completed receipt")
	}
	return s.RunStore.UpsertStepResult(ctx, result)
}

type receiptProvider struct {
	calls       int
	requestID   string
	fingerprint map[string]any
}

func (p *receiptProvider) Execute(context.Context, executionapplication.AgentRuntimeRequest) (executionapplication.AgentRuntimeResponse, error) {
	p.calls++
	completed, err := json.Marshal(map[string]any{
		"request_id": p.requestID, "operation": "solve", "solve_outcome": "answer", "status": "completed",
		"final_output": "保存在 receipt 中的完整回答", "tool_contract_fingerprint": p.fingerprint,
		"usage": map[string]any{"input_tokens": 12, "output_tokens": 8, "model_request_count": 1, "usage_observed": true},
	})
	if err != nil {
		return executionapplication.AgentRuntimeResponse{}, err
	}
	body := fmt.Sprintf("event: solve_decision\ndata: {\"schema_version\":\"workflow_runtime_solve_decision.v1\",\"outcome\":\"answer\"}\n\nevent: completed\ndata: %s\n\n", completed)
	return executionapplication.AgentRuntimeResponse{StatusCode: 200, Body: io.NopCloser(strings.NewReader(body))}, nil
}
