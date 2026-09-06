package temporaladapter

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

func TestWritePersonalMemoryCommandResultDoesNotFollowRedirect(t *testing.T) {
	var targetRequests atomic.Int32
	target := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		targetRequests.Add(1)
		response.WriteHeader(http.StatusNoContent)
	}))
	defer target.Close()

	redirect := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		response.Header().Set("location", target.URL)
		response.WriteHeader(http.StatusTemporaryRedirect)
		_, _ = response.Write([]byte("redirect"))
	}))
	defer redirect.Close()

	server := newAdapterForTest(config.Config{
		ProductCallbackBaseURL:      redirect.URL,
		AppAPIExecutionSharedSecret: "callback-secret",
		ProductCallbackTimeoutMS:    1000,
	})
	err := server.WritePersonalMemoryCommandResult(
		context.Background(),
		temporalruntime.PersonalMemoryCommandActivityOutput{
			CommandID: "memory-command-redirect",
			Status:    "succeeded",
		},
	)
	if err == nil {
		t.Fatal("personal memory callback succeeded through redirect")
	}
	if got := targetRequests.Load(); got != 0 {
		t.Fatalf("personal memory redirect target received %d requests, want 0", got)
	}
}

func TestWriteChatProductFinalizationDoesNotFollowRedirect(t *testing.T) {
	var targetRequests atomic.Int32
	target := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		targetRequests.Add(1)
		response.WriteHeader(http.StatusNoContent)
	}))
	defer target.Close()

	redirect := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		response.Header().Set("location", target.URL)
		response.WriteHeader(http.StatusTemporaryRedirect)
		_, _ = response.Write([]byte("redirect"))
	}))
	defer redirect.Close()

	server := newAdapterForTest(config.Config{
		ProductCallbackBaseURL:      redirect.URL,
		AppAPIExecutionSharedSecret: "callback-secret",
		ProductCallbackTimeoutMS:    1000,
	})
	err := server.writeChatProductFinalization(
		context.Background(),
		execution.DurableRun{RequestID: "run-product-finalization-redirect"},
		time.Date(2026, 7, 23, 0, 0, 0, 0, time.UTC),
		map[string]any{"answer": "private final answer"},
	)
	if err == nil {
		t.Fatal("chat product callback succeeded through redirect")
	}
	if got := targetRequests.Load(); got != 0 {
		t.Fatalf("chat callback redirect target received %d requests, want 0", got)
	}
}
