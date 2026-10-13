package answerstream

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"
)

func TestBufferBoundedReplayDedupExpiryAndIsolation(t *testing.T) {
	b := New()
	now := time.Now()
	b.now = func() time.Time { return now }
	for i := 1; i <= 120; i++ {
		_ = b.PublishAnswerDelta(t.Context(), Delta{RequestID: "a", Index: i, Text: "中"})
	}
	_ = b.PublishAnswerDelta(t.Context(), Delta{RequestID: "a", Index: 120, Text: "duplicate"})
	ds, _ := b.ReadAnswerDeltas(t.Context(), "a", 0)
	if len(ds) != 100 || ds[0].Index != 21 || ds[99].Text != "中" {
		t.Fatalf("bounded replay: %#v", ds)
	}
	other, _ := b.ReadAnswerDeltas(t.Context(), "b", 0)
	if len(other) != 0 {
		t.Fatal("cross-run delivery")
	}
	for i := 121; i <= 160; i++ {
		_ = b.PublishAnswerDelta(t.Context(), Delta{RequestID: "a", Index: i, Text: strings.Repeat("中", 512)})
	}
	ds, _ = b.ReadAnswerDeltas(t.Context(), "a", 0)
	bytes := 0
	for _, d := range ds {
		bytes += len(d.Text)
	}
	if bytes > maxBytes {
		t.Fatalf("buffer bytes=%d", bytes)
	}
	now = now.Add(retention)
	ds, _ = b.ReadAnswerDeltas(t.Context(), "a", 0)
	if len(ds) != 0 {
		t.Fatal("expired replay")
	}
	for i := 0; i <= maxRuns; i++ {
		now = now.Add(time.Nanosecond)
		_ = b.PublishAnswerDelta(t.Context(), Delta{RequestID: fmt.Sprint(i), Index: 1, Text: "x"})
	}
	if len(b.runs) != maxRuns || b.runs["0"] != nil {
		t.Fatal("unbounded run retention")
	}
}
func TestWaitWakesAndCancellationUnsubscribes(t *testing.T) {
	b := New()
	ctx, cancel := context.WithTimeout(t.Context(), time.Second)
	defer cancel()
	done := make(chan []Delta, 1)
	go func() { ds, _ := b.WaitForAnswerDeltas(ctx, "a", 0); done <- ds }()
	_ = b.PublishAnswerDelta(ctx, Delta{RequestID: "a", Index: 1, Text: "hello"})
	select {
	case ds := <-done:
		if len(ds) != 1 {
			t.Fatal(ds)
		}
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	canceled, stop := context.WithCancel(t.Context())
	stop()
	_, err := b.WaitForAnswerDeltas(canceled, "a", 1)
	if !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
	if len(b.waiters) != 0 {
		t.Fatal("leaked subscription")
	}
}
