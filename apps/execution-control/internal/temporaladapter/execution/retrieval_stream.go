package execution

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

type retrievalStreamProjection struct {
	adapter  *Adapter
	run      execution.DurableRun
	id       string
	sequence int
	active   map[string]bool
}

func newRetrievalStreamProjection(adapter *Adapter, run execution.DurableRun) *retrievalStreamProjection {
	return &retrievalStreamProjection{adapter: adapter, run: run, id: rand.Text(), active: map[string]bool{}}
}
func (p *retrievalStreamProjection) consume(ctx context.Context, operation temporalruntime.WorkflowOperation, raw json.RawMessage) error {
	var event struct {
		SchemaVersion string    `json:"schema_version"`
		Source        string    `json:"source"`
		Status        string    `json:"status"`
		OccurredAt    time.Time `json:"occurred_at"`
	}
	if err := decodeOperationJSON(raw, &event); err != nil {
		return err
	}
	if (operation != temporalruntime.WorkflowOperationSolve && operation != temporalruntime.WorkflowOperationExecuteStep) || event.SchemaVersion != "workflow_runtime_retrieval_status.v1" || event.OccurredAt.IsZero() || !execution.ValidRetrievalStatus(event.Source, event.Status) {
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
	return p.adapter.AppendTemporalRunEvent(ctx, execution.DurableRunEvent{
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
