package runtimeassembly

import (
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
)

func TestTemporalClientOptionsUseRuntimeIdentity(t *testing.T) {
	options := temporalClientOptions(config.Config{
		TemporalAddress:        "temporal:7233",
		TemporalNamespace:      "campus-agent-staging",
		TemporalWorkerIdentity: "staging:activity-core:001",
	})

	if options.HostPort != "temporal:7233" {
		t.Fatalf("host port = %q, want temporal:7233", options.HostPort)
	}
	if options.Namespace != "campus-agent-staging" {
		t.Fatalf("namespace = %q, want campus-agent-staging", options.Namespace)
	}
	if options.Identity != "staging:activity-core:001" {
		t.Fatalf("identity = %q, want staging:activity-core:001", options.Identity)
	}
}

func TestWorkerOptionsForRolePreservesProfile(t *testing.T) {
	options, err := workerOptionsForRole(
		config.Config{
			WorkerProfiles: map[string]config.WorkerProfile{
				string(RoleAgent): {
					ActivitySlots:       3,
					ActivityTaskPollers: 2,
				},
			},
		},
		RoleAgent,
		func(error) {},
	)
	if err != nil {
		t.Fatalf("workerOptionsForRole returned error: %v", err)
	}

	if options.MaxConcurrentActivityExecutionSize != 3 {
		t.Fatalf("activity slots = %d, want 3", options.MaxConcurrentActivityExecutionSize)
	}
	if options.MaxConcurrentActivityTaskPollers != 2 {
		t.Fatalf("activity task pollers = %d, want 2", options.MaxConcurrentActivityTaskPollers)
	}
	if options.OnFatalError == nil {
		t.Fatal("worker fatal error callback is not configured")
	}
	if options.WorkerStopTimeout != 50*time.Second {
		t.Fatalf("worker stop timeout = %s, want 50s", options.WorkerStopTimeout)
	}
}

func TestWorkerOptionsForRoleConfiguresUnprofiledWorkers(t *testing.T) {
	options, err := workerOptionsForRole(config.Config{}, RoleCore, func(error) {})
	if err != nil {
		t.Fatalf("workerOptionsForRole returned error: %v", err)
	}

	if options.OnFatalError == nil {
		t.Fatal("worker fatal error callback is not configured")
	}
}
