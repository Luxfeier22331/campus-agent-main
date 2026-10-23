//go:build postgres_integration

package postgres_test

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executionapplication"
	"strings"
	"testing"
	"time"
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

}
