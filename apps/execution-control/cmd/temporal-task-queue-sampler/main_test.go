package main

import (
	"strings"
	"testing"
)

func TestParseOptionsFailsClosedWithoutRequiredConfig(t *testing.T) {
	_, err := parseOptions([]string{})
	if err == nil {
		t.Fatal("missing config must fail closed")
	}
	message := err.Error()
	for _, want := range []string{"temporal-address", "temporal-namespace", "app-api-base-url", "shared-secret"} {
		if !strings.Contains(message, want) {
			t.Fatalf("error = %q, want %s", message, want)
		}
	}
}

func TestParseOptionsAcceptsExplicitConfig(t *testing.T) {
	opts, err := parseOptions([]string{
		"--temporal-address", "temporal:7233",
		"--temporal-namespace", "campus-agent-staging",
		"--app-api-base-url", "http://app-api:27031",
		"--shared-secret", "secret",
		"--timeout-ms", "2500",
		"--workflow-task-queue", "custom.workflow",
	})
	if err != nil {
		t.Fatalf("parseOptions returned error: %v", err)
	}
	if opts.timeout.String() != "2.5s" {
		t.Fatalf("timeout = %s", opts.timeout)
	}
	if opts.workflowTaskQueue != "custom.workflow" {
		t.Fatalf("workflow task queue = %q", opts.workflowTaskQueue)
	}
}
