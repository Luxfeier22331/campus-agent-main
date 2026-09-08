//go:build temporal_integration

package temporal_test

import (
	"context"
	"errors"
	"fmt"
	"net"
	"os"
	"os/exec"
	"strings"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/integration/temporalfake"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
	"go.temporal.io/sdk/client"
)

// Run failing and stuck tests in a child test process so the real TestMain
// cleanup path can be asserted without turning the parent suite red.
func TestHarnessCleansUpFailedAndTimedOutTests(t *testing.T) {
	binary, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	for _, mode := range []string{"failure", "timeout"} {
		t.Run(mode, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(t.Context(), 35*time.Second)
			defer cancel()
			command := exec.CommandContext(ctx, binary, "-test.run=^TestHarnessCleanupProbe$", "-test.timeout=20s", "-test.v")
			command.Env = append(os.Environ(), "TEMPORAL_HARNESS_CLEANUP_PROBE="+mode)
			output, err := command.CombinedOutput()
			var exit *exec.ExitError
			if ctx.Err() != nil || !errors.As(err, &exit) || exit.ExitCode() != 1 {
				t.Fatalf("probe must exit through TestMain with code 1: %v\n%s", err, output)
			}
			log := string(output)
			if !strings.Contains(log, "server cleanup namespace=") || strings.Count(log, "Stopped Worker") != 3 {
				t.Fatalf("probe did not stop all workers and server:\n%s", output)
			}
			if mode == "timeout" && !strings.Contains(log, "suite deadline exceeded") {
				t.Fatalf("probe did not exercise the fixture watchdog:\n%s", output)
			}
			address := ""
			for _, line := range strings.Split(log, "\n") {
				if strings.HasPrefix(line, "fixture-address=") {
					address = strings.TrimPrefix(line, "fixture-address=")
				}
			}
			if address == "" {
				t.Fatalf("missing probe address:\n%s", output)
			}
			dialer := net.Dialer{Timeout: time.Second}
			connection, err := dialer.DialContext(ctx, "tcp", address)
			if err == nil {
				_ = connection.Close()
				t.Fatalf("Temporal server still accepts connections after %s cleanup", mode)
			}
		})
	}
}

func TestHarnessCleanupProbe(t *testing.T) {
	mode := os.Getenv("TEMPORAL_HARNESS_CLEANUP_PROBE")
	if mode == "" {
		t.Skip("subprocess-only failure/timeout probe")
	}
	fmt.Println("fixture-address=" + packageHarness.Address)
	activities := &blockingAgentActivities{started: make(chan struct{})}
	packageHarness.StartStandardWorkers(t, activities)
	input := temporalfake.WorkflowInput(packageHarness.NewWorkflowID("cleanup-probe"))
	input.WorkflowID = input.RequestID
	run, err := packageHarness.Client.ExecuteWorkflow(t.Context(), client.StartWorkflowOptions{
		ID: input.WorkflowID, TaskQueue: temporalruntime.WorkflowTaskQueue,
	}, temporalruntime.ToolExecutionWorkflow, input)
	if err != nil {
		t.Fatal(err)
	}
	packageHarness.CleanupRun(t, run.GetID(), run.GetRunID())
	select {
	case <-activities.started:
	case <-t.Context().Done():
		t.Fatal(t.Context().Err())
	}
	if mode == "failure" {
		t.Fatal("intentional fixture failure probe")
	}
	select {}
}
