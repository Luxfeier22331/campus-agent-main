package runtimeassembly

import (
	"context"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/temporalclient"
)

func TestNewStarterDefersConnectivityToReadiness(t *testing.T) {
	starter, err := NewStarter(context.Background(), temporalclient.StarterOptions{
		Address:   "127.0.0.1:1",
		Namespace: "default",
		TaskQueue: temporalclient.WorkflowTaskQueue,
	})
	if err != nil {
		t.Fatalf("NewStarter returned error: %v", err)
	}
	defer starter.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	readiness := starter.CheckReadiness(ctx)
	if readiness.Healthy {
		t.Fatal("CheckReadiness reported healthy for unavailable Temporal")
	}
}
