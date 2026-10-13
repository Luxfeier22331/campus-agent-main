package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executionreadmodel"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/answerstream"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executionpersistence"
)

func TestLiveEventsWakeOnAnswerWithoutAdvancingDurableCursor(t *testing.T) {
	store := executionpersistence.NewInMemoryRunProjectionStore()
	now := time.Now().UTC()
	_, err := store.CreateRun(t.Context(), execution.DurableRun{RequestID: "r", ConversationID: "c", OwnerUserID: "u", Surface: "campus", TaskQueue: "q", Status: execution.DurableRunStatusCreated, CreatedAt: now, UpdatedAt: now, RuntimeVersions: map[string]any{}, Metadata: map[string]any{"execution_contract_version": "tool_execution_v7", "execution_input_ref": "app-api://execution-inputs/r", "execution_input_sha256": strings.Repeat("a", 64)}})
	if err != nil {
		t.Fatal(err)
	}
	server := NewServerWithOptions(config.Config{IngressSharedSecret: "test"}, ServerOptions{RunProjectionStore: store})
	ctx, cancel := context.WithTimeout(t.Context(), time.Second)
	defer cancel()
	done := make(chan error, 1)
	go func() {
		events, deltas, err := server.liveRunEvents(ctx, "r", 0, 0, time.Second)
		if err == nil && (len(events) != 0 || len(deltas) != 1 || deltas[0].Text != "你好") {
			t.Errorf("events=%v deltas=%v", events, deltas)
		}
		done <- err
	}()
	if err = store.PublishAnswerDelta(ctx, answerstream.Delta{RequestID: "r", MessageID: "m", Index: 1, Text: "你好", OccurredAt: now}); err != nil {
		t.Fatal(err)
	}
	select {
	case err = <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	events, deltas, err := server.liveRunEvents(ctx, "r", 0, 1, 5*time.Millisecond)
	if err != nil || len(events) != 0 || len(deltas) != 0 {
		t.Fatalf("cursor replay: %v %v %v", events, deltas, err)
	}
}

func TestLiveEventsWireKeepsHistoricalReadsSeparate(t *testing.T) {
	store := executionpersistence.NewInMemoryRunProjectionStore()
	now := time.Now().UTC()
	_, err := store.CreateRun(t.Context(), execution.DurableRun{RequestID: "r", ConversationID: "c", OwnerUserID: "u", Surface: "campus", TaskQueue: "q", Status: execution.DurableRunStatusCreated, CreatedAt: now, UpdatedAt: now, RuntimeVersions: map[string]any{}, Metadata: map[string]any{"execution_contract_version": "tool_execution_v7", "execution_input_ref": "app-api://execution-inputs/r", "execution_input_sha256": strings.Repeat("a", 64)}})
	if err != nil {
		t.Fatal(err)
	}
	if err = store.PublishAnswerDelta(t.Context(), answerstream.Delta{RequestID: "r", MessageID: "m", Index: 4, Text: "正文", OccurredAt: now}); err != nil {
		t.Fatal(err)
	}
	server := NewServerWithOptions(config.Config{IngressSharedSecret: "test"}, ServerOptions{RunProjectionStore: store})
	for _, live := range []bool{false, true} {
		path := "/internal/execution/requests/r/events?after_sequence=0"
		if live {
			path += "&after_answer_index=0"
		}
		req := httptest.NewRequestWithContext(t.Context(), "GET", path, nil)
		req.Header.Set("x-worker-origin-auth", "test")
		out := httptest.NewRecorder()
		server.ServeHTTP(out, req)
		if out.Code != 200 {
			t.Fatalf("status=%d body=%s", out.Code, out.Body.String())
		}
		var body struct {
			Events []any                `json:"events"`
			Next   int                  `json:"next_sequence"`
			Deltas []answerstream.Delta `json:"answer_deltas"`
		}
		if err = json.Unmarshal(out.Body.Bytes(), &body); err != nil {
			t.Fatal(err)
		}
		if body.Next != 0 || len(body.Events) != 0 || (live && len(body.Deltas) != 1) || (!live && body.Deltas != nil) {
			t.Fatalf("body=%s", out.Body.String())
		}
	}
}

type unavailableAnswers struct{}

func (unavailableAnswers) ReadAnswerDeltas(context.Context, string, int) ([]answerstream.Delta, error) {
	return nil, answerstream.ErrUnavailable
}
func (unavailableAnswers) WaitForAnswerDeltas(context.Context, string, int) ([]answerstream.Delta, error) {
	return nil, answerstream.ErrUnavailable
}

type eventReader struct {
	executionreadmodel.Reader
	events []execution.DurableRunEvent
	err    error
}

func (r eventReader) ListRunEventsAfter(context.Context, string, int64) ([]execution.DurableRunEvent, error) {
	return r.events, r.err
}
func (r eventReader) WaitForRunEventsAfter(ctx context.Context, _ string, _ int64) ([]execution.DurableRunEvent, error) {
	<-ctx.Done()
	return nil, ctx.Err()
}
func TestUnavailableAnswersPreserveDurableEventsAndPollingBudget(t *testing.T) {
	terminal := execution.DurableRunEvent{Sequence: 12, EventType: execution.DurableRunEventTypeRunCompleted}
	server := NewServerWithOptions(config.Config{}, ServerOptions{Answers: unavailableAnswers{}})
	server.runReader = eventReader{events: []execution.DurableRunEvent{terminal}}
	events, deltas, err := server.liveRunEvents(t.Context(), "r", 11, 0, time.Second)
	if err != nil || len(events) != 1 || events[0].Sequence != 12 || len(deltas) != 0 {
		t.Fatalf("events=%v deltas=%v err=%v", events, deltas, err)
	}
	server.runReader = eventReader{}
	start := time.Now()
	events, deltas, err = server.liveRunEvents(t.Context(), "r", 12, 0, 25*time.Millisecond)
	if err != nil || len(events) != 0 || len(deltas) != 0 || time.Since(start) < 20*time.Millisecond {
		t.Fatalf("hot poll: %v %v %v", events, deltas, err)
	}
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	if _, _, err = server.liveRunEvents(ctx, "r", 12, 0, time.Second); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancel=%v", err)
	}
	failure := errors.New("durable query failed")
	server.runReader = eventReader{err: failure}
	if _, _, err = server.liveRunEvents(t.Context(), "r", 12, 0, 0); !errors.Is(err, failure) {
		t.Fatalf("query=%v", err)
	}
}
