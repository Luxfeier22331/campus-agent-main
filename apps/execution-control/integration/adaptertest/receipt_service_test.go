package adaptertest

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionapplication"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionpersistence"
)

func TestReceiptServiceOwnsTerminalOutputAndDeletion(t *testing.T) {
	store := executionpersistence.NewInMemoryRunProjectionStore()
	createQueuedDurableRunForTest(t, store, "run-service-receipt", "conversation-service-receipt", time.Now().UTC(), agentRequestForDurableWorkerTest("hello"))
	service := executionapplication.NewReceiptService(store.Receipts)
	ctx := t.Context()
	inputHash := strings.Repeat("a", 64)
	receipt, disposition, err := service.Begin(ctx, "run-service-receipt:solve", "run-service-receipt", inputHash)
	if err != nil || disposition != execution.AgentInvocationDispositionClaimed {
		t.Fatalf("claim: %s %v", disposition, err)
	}
	if _, disposition, err := service.Begin(ctx, receipt.InvocationID, receipt.RequestID, inputHash); err != nil || disposition != execution.AgentInvocationDispositionAmbiguous {
		t.Fatalf("ambiguous invocation: %s %v", disposition, err)
	}
	output := map[string]any{"answer": "完整输出", "evidence": []string{"source-1"}, "usage": map[string]int{"input_tokens": 12}}
	if err := service.Complete(ctx, receipt, output); err != nil {
		t.Fatal(err)
	}
	replay, disposition, err := service.Begin(ctx, receipt.InvocationID, receipt.RequestID, inputHash)
	if err != nil || disposition != execution.AgentInvocationDispositionReplay {
		t.Fatalf("replay: %s %v", disposition, err)
	}
	encoded, err := json.Marshal(output)
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(encoded)
	if string(replay.OutputJSON) != string(encoded) || replay.OutputSHA256 != hex.EncodeToString(digest[:]) || replay.CompletedAt.IsZero() {
		t.Fatalf("incomplete receipt: %#v", replay)
	}
	if err := service.Complete(ctx, receipt, map[string]string{"answer": "different"}); !errors.Is(err, execution.ErrAgentInvocationConflict) {
		t.Fatalf("output conflict: %v", err)
	}
	if _, _, err := service.Begin(ctx, receipt.InvocationID, receipt.RequestID, strings.Repeat("b", 64)); !errors.Is(err, execution.ErrAgentInvocationConflict) {
		t.Fatalf("identity conflict: %v", err)
	}
	failed, _, err := service.Begin(ctx, "run-service-receipt:execute", "run-service-receipt", inputHash)
	if err != nil {
		t.Fatal(err)
	}
	if err := service.Fail(ctx, failed, "provider_failed"); err != nil {
		t.Fatal(err)
	}
	failed, disposition, err = service.Begin(ctx, failed.InvocationID, failed.RequestID, inputHash)
	if err != nil || disposition != execution.AgentInvocationDispositionReplay || failed.State != execution.AgentInvocationReceiptStateFailed {
		t.Fatalf("failed invocation was reopened: %#v %v", failed, err)
	}
	if err := service.Complete(ctx, failed, output); !errors.Is(err, execution.ErrAgentInvocationConflict) {
		t.Fatalf("failed terminal mutation: %v", err)
	}
	if err := store.DeleteRun(ctx, receipt.RequestID); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{receipt.InvocationID, failed.InvocationID} {
		if _, err := store.Receipts.GetAgentInvocationReceipt(ctx, id); !errors.Is(err, execution.ErrAgentInvocationNotFound) {
			t.Fatalf("receipt retained after deletion: %s %v", id, err)
		}
	}
}
