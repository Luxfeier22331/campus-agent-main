package main

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"reflect"
	"sync"
	"testing"
	"time"
)

func TestRequestTrackerCancelsInFlightRequestsAndRejectsNewRequests(t *testing.T) {
	entered := make(chan struct{})
	returned := make(chan struct{})
	tracker := newRequestTracker(http.HandlerFunc(func(_ http.ResponseWriter, request *http.Request) {
		close(entered)
		<-request.Context().Done()
		close(returned)
	}))

	go tracker.ServeHTTP(
		http.ResponseWriter(httptest.NewRecorder()),
		httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/healthz", nil),
	)
	select {
	case <-entered:
	case <-time.After(time.Second):
		t.Fatal("in-flight request did not enter handler")
	}

	tracker.BeginDraining()
	rejected := httptest.NewRecorder()
	tracker.ServeHTTP(
		rejected,
		httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/healthz", nil),
	)
	if rejected.Code != http.StatusServiceUnavailable {
		t.Fatalf("draining request status = %d, want 503", rejected.Code)
	}

	tracker.Cancel()
	waitContext, waitCancel := context.WithTimeout(context.Background(), time.Second)
	defer waitCancel()
	if err := tracker.Wait(waitContext); err != nil {
		t.Fatalf("wait for canceled request = %v", err)
	}
	select {
	case <-returned:
	case <-time.After(time.Second):
		t.Fatal("in-flight request did not observe forced cancellation")
	}
}

func TestRequestTrackerDrainingPreservesInFlightDeadline(t *testing.T) {
	entered := make(chan struct{})
	finish := make(chan struct{})
	observed := make(chan error, 1)
	ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
	defer cancel()
	deadline, _ := ctx.Deadline()
	tracker := newRequestTracker(http.HandlerFunc(func(_ http.ResponseWriter, request *http.Request) {
		close(entered)
		<-finish
		if got, ok := request.Context().Deadline(); !ok || !got.Equal(deadline) {
			observed <- errors.New("request deadline changed during draining")
			return
		}
		observed <- request.Context().Err()
	}))
	t.Cleanup(tracker.Cancel)
	t.Cleanup(func() { close(finish) })
	go tracker.ServeHTTP(httptest.NewRecorder(), httptest.NewRequestWithContext(ctx, http.MethodGet, "/internal/agent/runs", nil))
	select {
	case <-entered:
	case <-ctx.Done():
		t.Fatal("in-flight request did not enter handler")
	}
	tracker.BeginDraining()
	finish <- struct{}{}
	if err := tracker.Wait(ctx); err != nil {
		t.Fatalf("wait for request: %v", err)
	}
	if err := <-observed; err != nil {
		t.Fatalf("draining changed in-flight context: %v", err)
	}
}

type lifecycleEventLog struct {
	mu     sync.Mutex
	events []string
}

func (log *lifecycleEventLog) add(event string) {
	log.mu.Lock()
	log.events = append(log.events, event)
	log.mu.Unlock()
}

func (log *lifecycleEventLog) snapshot() []string {
	log.mu.Lock()
	defer log.mu.Unlock()
	return append([]string(nil), log.events...)
}

type lifecycleHTTPServer struct {
	log         *lifecycleEventLog
	shutdownErr error
	closeErr    error
}

func (server *lifecycleHTTPServer) Shutdown(context.Context) error {
	server.log.add("http-shutdown")
	return server.shutdownErr
}

func (server *lifecycleHTTPServer) Close() error {
	server.log.add("http-close")
	return server.closeErr
}

type lifecycleRuntime struct {
	log *lifecycleEventLog
}

func (runtime lifecycleRuntime) Stop() {
	runtime.log.add("runtime-stop")
}

type lifecycleHandler struct {
	log *lifecycleEventLog
}

func (handler lifecycleHandler) StartDraining() {
	handler.log.add("handler-drain")
}

func (handler lifecycleHandler) Shutdown(context.Context) error {
	handler.log.add("handler-shutdown")
	return nil
}

func TestShutdownExecutionRuntimeOrdersDrainBeforeRuntimeAndStoreShutdown(t *testing.T) {
	log := &lifecycleEventLog{}
	tracker := newRequestTracker(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	err := shutdownExecutionRuntime(
		&lifecycleHTTPServer{log: log},
		tracker,
		lifecycleRuntime{log: log},
		lifecycleHandler{log: log},
		func() {},
		time.Second,
	)
	if err != nil {
		t.Fatalf("shutdownExecutionRuntime returned error: %v", err)
	}

	want := []string{"handler-drain", "http-shutdown", "runtime-stop", "handler-shutdown"}
	if got := log.snapshot(); !reflect.DeepEqual(got, want) {
		t.Fatalf("shutdown order = %#v, want %#v", got, want)
	}
}

func TestShutdownExecutionRuntimeForcesHTTPCloseBeforeStoppingRuntime(t *testing.T) {
	log := &lifecycleEventLog{}
	entered := make(chan struct{})
	tracker := newRequestTracker(http.HandlerFunc(func(_ http.ResponseWriter, request *http.Request) {
		close(entered)
		<-request.Context().Done()
		log.add("request-returned")
	}))
	go tracker.ServeHTTP(
		http.ResponseWriter(httptest.NewRecorder()),
		httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/internal/agent/runs", nil),
	)
	select {
	case <-entered:
	case <-time.After(time.Second):
		t.Fatal("in-flight request did not enter handler")
	}

	shutdownErr := errors.New("http drain deadline")
	err := shutdownExecutionRuntime(
		&lifecycleHTTPServer{log: log, shutdownErr: shutdownErr},
		tracker,
		lifecycleRuntime{log: log},
		lifecycleHandler{log: log},
		func() {},
		time.Millisecond,
	)
	if !errors.Is(err, shutdownErr) {
		t.Fatalf("shutdown error = %v, want %v", err, shutdownErr)
	}

	events := log.snapshot()
	closeIndex := indexOfEvent(events, "http-close")
	requestReturnIndex := indexOfEvent(events, "request-returned")
	runtimeStopIndex := indexOfEvent(events, "runtime-stop")
	handlerShutdownIndex := indexOfEvent(events, "handler-shutdown")
	if closeIndex < 0 || requestReturnIndex < 0 || runtimeStopIndex < 0 || handlerShutdownIndex < 0 {
		t.Fatalf("forced shutdown events = %#v", events)
	}
	if closeIndex > runtimeStopIndex || requestReturnIndex > runtimeStopIndex || runtimeStopIndex > handlerShutdownIndex {
		t.Fatalf("forced shutdown order = %#v", events)
	}
}

func TestShutdownExecutionRuntimeDoesNotCloseStoresBehindStuckRequest(t *testing.T) {
	log := &lifecycleEventLog{}
	entered := make(chan struct{})
	release := make(chan struct{})
	tracker := newRequestTracker(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		close(entered)
		<-release
	}))
	go tracker.ServeHTTP(
		http.ResponseWriter(httptest.NewRecorder()),
		httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/internal/agent/runs", nil),
	)
	select {
	case <-entered:
	case <-time.After(time.Second):
		t.Fatal("stuck request did not enter handler")
	}

	err := shutdownExecutionRuntime(
		&lifecycleHTTPServer{log: log, shutdownErr: errors.New("http drain deadline")},
		tracker,
		lifecycleRuntime{log: log},
		lifecycleHandler{log: log},
		func() {},
		time.Millisecond,
	)
	if err == nil {
		t.Fatal("stuck request shutdown returned nil error")
	}
	if indexOfEvent(log.snapshot(), "handler-shutdown") >= 0 {
		t.Fatalf("handler resources were closed while request remained active: %#v", log.snapshot())
	}

	close(release)
}

func indexOfEvent(events []string, want string) int {
	for index, event := range events {
		if event == want {
			return index
		}
	}
	return -1
}
