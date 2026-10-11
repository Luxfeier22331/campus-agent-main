package main

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"sync"
	"time"
)

type executionHTTPServer interface {
	Shutdown(context.Context) error
	Close() error
}

type executionRuntime interface {
	Stop()
}

type executionHandler interface {
	StartDraining()
	Shutdown(context.Context) error
}

const forcedRequestDrainGrace = time.Second

// requestTracker keeps the shared stores alive until every HTTP handler has
// returned. The root context is only canceled on a forced shutdown; normal
// draining lets existing requests finish with their original deadline.
type requestTracker struct {
	handler http.Handler
	root    context.Context
	cancel  context.CancelFunc

	mu       sync.Mutex
	active   int
	draining bool
	idle     chan struct{}
}

func newRequestTracker(handler http.Handler) *requestTracker {
	root, cancel := context.WithCancel(context.Background())
	idle := make(chan struct{})
	close(idle)
	return &requestTracker{
		handler: handler,
		root:    root,
		cancel:  cancel,
		idle:    idle,
	}
}

func (tracker *requestTracker) ServeHTTP(response http.ResponseWriter, request *http.Request) {
	if tracker == nil || tracker.handler == nil {
		http.Error(response, "execution-control handler is not configured", http.StatusServiceUnavailable)
		return
	}

	tracker.mu.Lock()
	if tracker.draining {
		tracker.mu.Unlock()
		http.Error(response, "execution-control is draining", http.StatusServiceUnavailable)
		return
	}
	if tracker.active == 0 {
		tracker.idle = make(chan struct{})
	}
	tracker.active++
	tracker.mu.Unlock()

	requestContext, requestCancel := context.WithCancel(request.Context())
	stopRootPropagation := context.AfterFunc(tracker.root, requestCancel)
	defer func() {
		stopRootPropagation()
		requestCancel()
		tracker.complete()
	}()

	tracker.handler.ServeHTTP(response, request.WithContext(requestContext))
}

func (tracker *requestTracker) BeginDraining() {
	if tracker == nil {
		return
	}
	tracker.mu.Lock()
	tracker.draining = true
	tracker.mu.Unlock()
}

func (tracker *requestTracker) Cancel() {
	if tracker == nil || tracker.cancel == nil {
		return
	}
	tracker.cancel()
}

func (tracker *requestTracker) Wait(ctx context.Context) error {
	if tracker == nil {
		return nil
	}
	if ctx == nil {
		ctx = context.Background()
	}
	tracker.mu.Lock()
	idle := tracker.idle
	tracker.mu.Unlock()
	select {
	case <-idle:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (tracker *requestTracker) complete() {
	tracker.mu.Lock()
	defer tracker.mu.Unlock()
	tracker.active--
	if tracker.active == 0 {
		close(tracker.idle)
	}
}

func shutdownExecutionRuntime(
	gatewayServer executionHTTPServer,
	requests *requestTracker,
	runtime executionRuntime,
	handler executionHandler,
	runtimeCancel context.CancelFunc,
	grace time.Duration,
) error {
	if handler != nil {
		handler.StartDraining()
	}
	if requests != nil {
		requests.BeginDraining()
		defer requests.Cancel()
	}
	if grace <= 0 {
		grace = time.Second
	}

	shutdownContext, cancelShutdown := context.WithTimeout(context.Background(), grace)
	defer cancelShutdown()

	var shutdownErr error
	if gatewayServer != nil {
		if err := gatewayServer.Shutdown(shutdownContext); err != nil {
			shutdownErr = errors.Join(shutdownErr, fmt.Errorf("shutdown execution-control HTTP server: %w", err))
			if requests != nil {
				requests.Cancel()
			}
			if err := gatewayServer.Close(); err != nil {
				shutdownErr = errors.Join(shutdownErr, fmt.Errorf("force close execution-control HTTP server: %w", err))
			}
		}
	}

	requestsDrained := true
	if requests != nil {
		waitContext, cancelWait := context.WithTimeout(context.Background(), forcedRequestDrainGrace)
		if err := requests.Wait(waitContext); err != nil {
			requestsDrained = false
			shutdownErr = errors.Join(shutdownErr, fmt.Errorf("wait for execution-control HTTP requests: %w", err))
		}
		cancelWait()
	}

	if runtimeCancel != nil {
		runtimeCancel()
	}
	if runtime != nil {
		runtime.Stop()
	}
	if handler != nil && requestsDrained {
		if err := handler.Shutdown(context.Background()); err != nil {
			shutdownErr = errors.Join(shutdownErr, fmt.Errorf("shutdown execution runtime: %w", err))
		}
	} else if handler != nil {
		shutdownErr = errors.Join(
			shutdownErr,
			errors.New("skip execution runtime resource shutdown while HTTP requests remain active"),
		)
	}
	return shutdownErr
}
