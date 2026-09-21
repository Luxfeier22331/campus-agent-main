package campusdiagnostics

import (
	"context"
	"strings"
	"testing"
	"time"
)

func TestRuntimeObservationBoundary(t *testing.T) {
	valid := Observation{InvocationID: "call", WorkflowStepID: "step", ActivityAttempt: 1, SearchQuery: "图书馆", Phase: "queued", At: time.Now()}
	if err := valid.ValidateRuntime(); err != nil {
		t.Fatal(err)
	}
	for _, phase := range []string{"dispatching", "completed", "failed", "canceled"} {
		o := valid
		o.Phase = phase
		if err := o.ValidateRuntime(); err != nil {
			t.Fatal(err)
		}
	}
	for _, change := range []func(*Observation){
		func(o *Observation) { o.Phase = "selected" },
		func(o *Observation) { o.ActivityAttempt = 0 },
		func(o *Observation) { o.SearchQuery = strings.Repeat("字", 401) },
		func(o *Observation) { o.FailureCode = "raw exception with private content" },
		func(o *Observation) { o.At = time.Time{} },
	} {
		o := valid
		change(&o)
		if o.ValidateRuntime() == nil {
			t.Fatalf("accepted %#v", o)
		}
	}
}

type blockedStore struct{ calls int }

func (s *blockedStore) ObserveCampusSearch(ctx context.Context, _ Observation) error {
	s.calls++
	<-ctx.Done()
	return ctx.Err()
}
func (s *blockedStore) MarkCampusSearchCitations(ctx context.Context, _ string, _ []string) error {
	<-ctx.Done()
	return ctx.Err()
}

func TestBestEffortWriteIsBoundedAndDoesNotRetry(t *testing.T) {
	ctx := t.Context()
	store := &blockedStore{}
	Record(ctx, store, Observation{})
	deadline := time.Now().Add(time.Second)
	for store.calls == 0 && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	if store.calls != 1 {
		t.Fatalf("diagnostic write was not scheduled: %d", store.calls)
	}
}
