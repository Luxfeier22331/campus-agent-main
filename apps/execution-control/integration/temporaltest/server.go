package temporaltest

import (
	"context"
	"flag"
	"fmt"
	"os"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/testsuite"
)

// Harness owns the package's isolated Dev Server. Each test owns its workers
// and request identities; tests sharing this server must run sequentially.
type Harness struct {
	Client    client.Client
	Namespace string
	Address   string
	server    *testsuite.DevServer
	sequence  atomic.Uint64
	mu        sync.Mutex
	workers   []*WorkerHandle
}

func NewHarness(ctx context.Context) (*Harness, error) {
	const namespace = "execution-control-integration"
	fmt.Fprintln(os.Stderr, "temporal fixture: server startup namespace="+namespace)
	server, err := testsuite.StartDevServer(ctx, testsuite.DevServerOptions{
		ClientOptions: &client.Options{Namespace: namespace}, LogLevel: "error",
	})
	if err != nil {
		return nil, fmt.Errorf("temporal server startup: %w", err)
	}
	return &Harness{Client: server.Client(), Namespace: namespace, Address: server.FrontendHostPort(), server: server}, nil
}

// RunPackage is called exactly once from TestMain. Reserve cleanup time before
// go test's own timeout, which otherwise panics without running TestMain cleanup.
func RunPackage(m *testing.M, target **Harness) int {
	flag.Parse()
	timeout, err := time.ParseDuration(flag.Lookup("test.timeout").Value.String())
	if err != nil || timeout <= 0 {
		timeout = 2 * time.Minute
	}
	cleanupTime := min(20*time.Second, timeout*3/4)
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	h, err := NewHarness(ctx)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	*target = h
	done := make(chan int, 1)
	go func() { done <- m.Run() }()
	code := 1
	select {
	case code = <-done:
	case <-time.After(timeout - cleanupTime):
		fmt.Fprintln(os.Stderr, "temporal fixture: suite deadline exceeded; stopping workers and server")
	}
	if err := h.Close(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		code = 1
	}
	return code
}

func (h *Harness) Close() error {
	h.mu.Lock()
	workers := append([]*WorkerHandle(nil), h.workers...)
	h.mu.Unlock()
	for i := len(workers) - 1; i >= 0; i-- {
		workers[i].Stop()
	}
	fmt.Fprintln(os.Stderr, "temporal fixture: server cleanup namespace="+h.Namespace)
	h.Client.Close()
	return h.server.Stop()
}
