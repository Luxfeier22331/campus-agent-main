package operation

import (
	"context"
	"crypto/rand"
	"fmt"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executionapplication"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executioncontract"
)

type retrievalStreamProjection struct {
	adapter  *OperationService
	run      execution.DurableRun
	id       string
	sequence int
	active   map[string]bool
}

func newRetrievalStreamProjection(adapter *OperationService, run execution.DurableRun) *retrievalStreamProjection {
	return &retrievalStreamProjection{adapter: adapter, run: run, id: rand.Text(), active: map[string]bool{}}
}
func (p *retrievalStreamProjection) consume(ctx context.Context, operation executioncontract.WorkflowOperation, event executionapplication.RuntimeRetrievalStatus) error {
	if (operation != executioncontract.WorkflowOperationSolve && operation != executioncontract.WorkflowOperationExecuteStep) || event.OccurredAt.IsZero() || !execution.ValidRetrievalStatus(event.Source, event.Status) {
		return fmt.Errorf("invalid retrieval status event")
	}
	if event.Status != "started" && !p.active[event.Source] {
		return fmt.Errorf("retrieval ended without starting")
	}
	if event.Status == "started" && p.active[event.Source] {
		return nil
	}
	if err := p.append(ctx, event.Source, event.Status, event.OccurredAt); err != nil {
		return err
	}
	p.active[event.Source] = event.Status == "started"
	return nil
}
func (p *retrievalStreamProjection) append(ctx context.Context, source, status string, at time.Time) error {
	run, err := p.adapter.RunProjectionStore.GetRun(ctx, p.run.RequestID)
	if err != nil {
		return err
	}
	switch run.Status {
	case execution.DurableRunStatusCompleted, execution.DurableRunStatusFailed, execution.DurableRunStatusCanceled, execution.DurableRunStatusExpired:
		return nil
	}
	p.sequence++
	return p.adapter.AppendRunEvent(ctx, execution.DurableRunEvent{
		EventID: fmt.Sprintf("%s:retrieval:%s:%d", run.RequestID, p.id, p.sequence), RequestID: run.RequestID, ConversationID: run.ConversationID,
		EventType: execution.DurableRunEventTypeRunRetrievalStatus, Visibility: execution.DurableRunEventVisibilityBrowser,
		OccurredAt: at, PayloadSchemaVersion: "run-retrieval-status-v1", Payload: map[string]any{"source": source, "status": status},
	})
}
func (p *retrievalStreamProjection) close(ctx context.Context) {
	status := "failed"
	if ctx.Err() == context.Canceled {
		status = "canceled"
	}
	bounded, cancel := context.WithTimeout(context.WithoutCancel(ctx), time.Second)
	defer cancel()
	for _, source := range []string{"campus"} {
		if p.active[source] {
			_ = p.append(bounded, source, status, time.Now().UTC())
		}
	}
}
