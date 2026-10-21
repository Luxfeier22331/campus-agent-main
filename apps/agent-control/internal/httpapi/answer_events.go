package httpapi

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/answerstream"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/execution"
)

// The two cursors are independent: losing a temporary answer never skips a durable event.
func (s *Server) liveRunEvents(ctx context.Context, requestID string, after int64, answerAfter int, wait time.Duration) ([]execution.DurableRunEvent, []answerstream.Delta, error) {
	deadline := time.Now().Add(wait)
	read := func() ([]execution.DurableRunEvent, []answerstream.Delta, error) {
		events, err := s.runReader.ListRunEventsAfter(ctx, requestID, after)
		if err != nil {
			return nil, nil, err
		}
		readCtx, release := context.WithTimeout(ctx, time.Second)
		deltas, answerErr := s.answers.ReadAnswerDeltas(readCtx, requestID, answerAfter)
		release()
		if ctx.Err() != nil {
			return nil, nil, ctx.Err()
		}
		if answerErr != nil {
			s.logger.Warn("temporary answer read unavailable", "request_id", requestID)
			deltas = []answerstream.Delta{}
		}
		return events, deltas, nil
	}
	events, deltas, err := read()
	if err != nil || len(events) > 0 || len(deltas) > 0 || wait <= 0 {
		return events, deltas, err
	}
	waitCtx, cancel := context.WithDeadline(ctx, deadline)
	defer cancel()
	results := make(chan error, 2)
	go func() { _, err := s.runReader.WaitForRunEventsAfter(waitCtx, requestID, after); results <- err }()
	go func() { _, err := s.answers.WaitForAnswerDeltas(waitCtx, requestID, answerAfter); results <- err }()
	wakeErr := <-results
	cancel()
	<-results //nolint:errcheck // The second listener only reports the cancellation above.
	if ctx.Err() != nil {
		return nil, nil, ctx.Err()
	}
	events, deltas, err = read()
	if err != nil || len(events) > 0 || len(deltas) > 0 {
		return events, deltas, err
	}
	// A failed listener must not turn the existing long poll into a hot loop.
	if wakeErr != nil && time.Now().Before(deadline) {
		timer := time.NewTimer(time.Until(deadline))
		defer timer.Stop()
		select {
		case <-ctx.Done():
			return nil, nil, ctx.Err()
		case <-timer.C:
		}
		return read()
	}
	return events, deltas, nil
}

func (s *Server) handleLiveRunEvents(w http.ResponseWriter, r *http.Request, id string, after int64, wait time.Duration) {
	answerAfter, err := strconv.Atoi(r.URL.Query().Get("after_answer_index"))
	if err != nil || answerAfter < 0 {
		writeError(w, 400, "invalid_request", "after_answer_index must be a non-negative integer", false)
		return
	}
	if s.answers == nil {
		writeError(w, 503, "answer_transport_unavailable", "Answer transport is not configured", true)
		return
	}
	events, deltas, err := s.liveRunEvents(r.Context(), id, after, answerAfter, wait)
	if err != nil {
		if errors.Is(err, execution.ErrDurableRunNotFound) {
			writeError(w, 404, "durable_run_not_found", "Durable run not found", false)
			return
		}
		writeError(w, 500, "run_events_query_failed", err.Error(), true)
		return
	}
	body := make([]map[string]any, 0, len(events))
	next := after
	for _, event := range events {
		body = append(body, durableRunEventResponse(event))
		next = event.Sequence
	}
	writeJSON(w, 200, map[string]any{"events": body, "next_sequence": next, "answer_deltas": deltas})
}
