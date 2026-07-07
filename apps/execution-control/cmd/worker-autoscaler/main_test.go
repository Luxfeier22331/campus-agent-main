package main

import (
	"strings"
	"testing"
	"time"
)

func TestParseOptionsFailsClosedWithoutRuntimeConfig(t *testing.T) {
	_, err := parseOptions([]string{})
	if err == nil {
		t.Fatal("missing runtime config must fail closed")
	}
	message := err.Error()
	for _, want := range []string{
		"app-api-base-url",
		"shared-secret",
		"compose-project-name",
		"compose-project-directory",
	} {
		if !strings.Contains(message, want) {
			t.Fatalf("error = %q, want %s", message, want)
		}
	}
}

func TestParseOptionsBuildsDefaultServicePolicies(t *testing.T) {
	opts, err := parseOptions([]string{
		"--app-api-base-url", "http://app-api:27031",
		"--shared-secret", "secret",
		"--compose-project-name", "campus-agent-staging",
		"--compose-project-directory", "/srv/campus-agent",
		"--mode", "dry-run",
		"--snapshot-limit", "10",
		"--timeout-ms", "2500",
	})
	if err != nil {
		t.Fatalf("parseOptions returned error: %v", err)
	}
	if opts.mode != "dry-run" {
		t.Fatalf("mode = %q", opts.mode)
	}
	if opts.timeout != 2500*time.Millisecond {
		t.Fatalf("timeout = %s", opts.timeout)
	}
	if opts.snapshotLimit != 10 {
		t.Fatalf("snapshot limit = %d", opts.snapshotLimit)
	}
	if opts.cooldownSeconds != 180 ||
		opts.scaleUpBacklogThreshold != 8 ||
		opts.scaleUpOldestAgeMS != 30000 ||
		opts.scaleUpWindows != 2 ||
		opts.scaleDownWindows != 6 {
		t.Fatalf("policy options = %#v", opts)
	}
	policies := defaultServicePolicies(opts.workflowTaskQueue)
	for _, service := range []string{
		"workflow-worker",
		"activity-worker-core",
		"activity-worker-agent",
		"activity-worker-knowledge",
	} {
		if _, ok := policies[service]; !ok {
			t.Fatalf("missing service policy for %s", service)
		}
	}
}

func TestParseOptionsRejectsLegacyInputPathMode(t *testing.T) {
	_, err := parseOptions([]string{
		"--input-path", "/tmp/autoscaler-input.json",
		"--evidence-path", "/tmp/autoscaler-evidence.json",
	})
	if err == nil {
		t.Fatal("legacy input path mode must be rejected")
	}
	if !strings.Contains(err.Error(), "flag provided but not defined") {
		t.Fatalf("error = %q", err.Error())
	}
}

func TestParseOptionsReadsModeFromEnvironment(t *testing.T) {
	t.Setenv("EXECUTION_CONTROL_APP_API_BASE_URL", "http://app-api:27031")
	t.Setenv("EXECUTION_CONTROL_APP_API_INTERNAL_SHARED_SECRET", "secret")
	t.Setenv("EXECUTION_CONTROL_COMPOSE_PROJECT_NAME", "campus-agent-staging")
	t.Setenv("EXECUTION_CONTROL_COMPOSE_PROJECT_DIRECTORY", "/srv/campus-agent")
	t.Setenv("EXECUTION_CONTROL_WORKER_AUTOSCALER_COOLDOWN_SECONDS", "120")
	t.Setenv("EXECUTION_CONTROL_WORKER_AUTOSCALER_MODE", "apply")

	opts, err := parseOptions([]string{})
	if err != nil {
		t.Fatalf("parseOptions returned error: %v", err)
	}
	if opts.mode != "apply" {
		t.Fatalf("mode = %q", opts.mode)
	}
	if opts.cooldownSeconds != 120 {
		t.Fatalf("cooldown = %d", opts.cooldownSeconds)
	}
}

func TestParseOptionsFailsClosedOnInvalidPolicyEnvironment(t *testing.T) {
	t.Setenv("EXECUTION_CONTROL_WORKER_AUTOSCALER_COOLDOWN_SECONDS", "not-an-int")

	_, err := parseOptions([]string{})
	if err == nil {
		t.Fatal("invalid policy environment must fail closed")
	}
	if !strings.Contains(err.Error(), "must be an integer") {
		t.Fatalf("error = %q", err.Error())
	}
}
