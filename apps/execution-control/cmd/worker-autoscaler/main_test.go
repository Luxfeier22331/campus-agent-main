package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRunRequiresInputAndEvidencePath(t *testing.T) {
	err := run([]string{})

	if err == nil {
		t.Fatal("run without paths must fail closed")
	}
	message := err.Error()
	for _, want := range []string{"input-path", "evidence-path"} {
		if !strings.Contains(message, want) {
			t.Fatalf("error = %q, want mention %s", message, want)
		}
	}
}

func TestDryRunComputesReplicaDecisionsWithoutExecutionStateWrites(t *testing.T) {
	dir := t.TempDir()
	inputPath := filepath.Join(dir, "autoscaler-input.json")
	evidencePath := filepath.Join(dir, "autoscaler-evidence.json")
	writeFixture(t, inputPath, `{
		"environment": "staging",
		"generated_at": "2026-06-04T23:00:00Z",
		"queues": [
			{
				"name": "campus-agent.workflow",
				"role": "workflow",
				"pollers": 0,
				"backlog": 0,
				"schedule_to_start_ms": 10,
				"current_replicas": 1,
				"min_replicas": 1,
				"max_replicas": 3,
				"target_schedule_to_start_ms": 500
			},
			{
				"name": "campus-agent.activity.knowledge",
				"role": "knowledge",
				"pollers": 1,
				"backlog": 9,
				"schedule_to_start_ms": 1000,
				"current_replicas": 1,
				"min_replicas": 1,
				"max_replicas": 5,
				"target_schedule_to_start_ms": 500
			},
			{
				"name": "campus-agent.activity.finalization",
				"role": "finalization",
				"pollers": 1,
				"backlog": 0,
				"schedule_to_start_ms": 50,
				"current_replicas": 2,
				"min_replicas": 1,
				"max_replicas": 4,
				"target_schedule_to_start_ms": 500
			}
		],
		"downstream_budgets": {
			"knowledge": {"available": true, "max_replicas": 2},
			"finalization": {"available": true, "max_replicas": 4}
		}
	}`)

	if err := run([]string{"--input-path", inputPath, "--evidence-path", evidencePath}); err != nil {
		t.Fatalf("run returned error: %v", err)
	}

	body := readJSONRecord(t, evidencePath)
	if body["mode"] != "dry_run" {
		t.Fatalf("mode = %v, want dry_run", body["mode"])
	}
	if body["writes_execution_state"] != false {
		t.Fatalf("writes_execution_state = %v, want false", body["writes_execution_state"])
	}
	decisions := expectArray(t, body["decisions"], "decisions")
	if len(decisions) != 3 {
		t.Fatalf("decision count = %d, want 3", len(decisions))
	}
	workflow := expectRecord(t, decisions[0], "decisions[0]")
	if workflow["desired_replicas"] != float64(2) || workflow["reason"] != "pollers_missing" {
		t.Fatalf("workflow decision = %#v", workflow)
	}
	rag := expectRecord(t, decisions[1], "decisions[1]")
	if rag["desired_replicas"] != float64(2) || rag["reason"] != "backlog_or_latency" {
		t.Fatalf("rag decision = %#v", rag)
	}
	finalization := expectRecord(t, decisions[2], "decisions[2]")
	if finalization["desired_replicas"] != float64(2) || finalization["reason"] != "within_target" {
		t.Fatalf("finalization decision = %#v", finalization)
	}
	serialized, err := os.ReadFile(evidencePath)
	if err != nil {
		t.Fatalf("read evidence: %v", err)
	}
	for _, forbidden := range []string{
		"write_run_state",
		"write_workflow_state",
		"write_step_state",
		"write_event_state",
		"terminal_state_write",
	} {
		if strings.Contains(string(serialized), forbidden) {
			t.Fatalf("evidence contains forbidden state-write wording %q: %s", forbidden, serialized)
		}
	}
}

func TestApplyModeRequiresExplicitActuatorAndWritesNoEvidence(t *testing.T) {
	dir := t.TempDir()
	inputPath := filepath.Join(dir, "autoscaler-input.json")
	evidencePath := filepath.Join(dir, "autoscaler-evidence.json")
	writeFixture(t, inputPath, `{
		"environment": "staging",
		"generated_at": "2026-06-04T23:00:00Z",
		"queues": [
			{
				"name": "campus-agent.activity.knowledge",
				"role": "knowledge",
				"pollers": 1,
				"backlog": 9,
				"schedule_to_start_ms": 1000,
				"current_replicas": 1,
				"min_replicas": 1,
				"max_replicas": 5,
				"target_schedule_to_start_ms": 500
			}
		],
		"downstream_budgets": {
			"knowledge": {"available": true, "max_replicas": 2}
		}
	}`)

	err := run([]string{
		"--mode", "apply",
		"--input-path", inputPath,
		"--evidence-path", evidencePath,
	})

	if err == nil {
		t.Fatal("apply mode without explicit actuator must fail closed")
	}
	if !strings.Contains(err.Error(), "actuator-evidence-path") {
		t.Fatalf("error = %q, want mention actuator-evidence-path", err.Error())
	}
	if _, statErr := os.Stat(evidencePath); !os.IsNotExist(statErr) {
		t.Fatalf("decision evidence should not be written without actuator, stat err = %v", statErr)
	}
}

func TestApplyModeWritesOpsPlaneActuationEvidenceOnly(t *testing.T) {
	dir := t.TempDir()
	inputPath := filepath.Join(dir, "autoscaler-input.json")
	evidencePath := filepath.Join(dir, "autoscaler-evidence.json")
	actuatorEvidencePath := filepath.Join(dir, "autoscaler-actuation-evidence.json")
	writeFixture(t, inputPath, `{
		"environment": "staging",
		"generated_at": "2026-06-04T23:00:00Z",
		"queues": [
			{
				"name": "campus-agent.activity.knowledge",
				"role": "knowledge",
				"pollers": 1,
				"backlog": 9,
				"schedule_to_start_ms": 1000,
				"current_replicas": 1,
				"min_replicas": 1,
				"max_replicas": 5,
				"target_schedule_to_start_ms": 500
			}
		],
		"downstream_budgets": {
			"knowledge": {"available": true, "max_replicas": 2}
		}
	}`)

	err := run([]string{
		"--mode", "apply",
		"--input-path", inputPath,
		"--evidence-path", evidencePath,
		"--actuator-evidence-path", actuatorEvidencePath,
	})
	if err != nil {
		t.Fatalf("run returned error: %v", err)
	}

	decision := readJSONRecord(t, evidencePath)
	if decision["mode"] != "apply" {
		t.Fatalf("mode = %v, want apply", decision["mode"])
	}
	if decision["writes_execution_state"] != false {
		t.Fatalf("writes_execution_state = %v, want false", decision["writes_execution_state"])
	}
	decisions := expectArray(t, decision["decisions"], "decisions")
	queueDecision := expectRecord(t, decisions[0], "decisions[0]")
	if queueDecision["evidence_contract"] != "worker-autoscaler-actuation-decision-v1" {
		t.Fatalf("evidence_contract = %v", queueDecision["evidence_contract"])
	}

	actuation := readJSONRecord(t, actuatorEvidencePath)
	if actuation["evidence_contract"] != "worker-autoscaler-actuation-evidence-v1" {
		t.Fatalf("actuation evidence_contract = %v", actuation["evidence_contract"])
	}
	if actuation["writes_execution_state"] != false {
		t.Fatalf("actuation writes_execution_state = %v, want false", actuation["writes_execution_state"])
	}
	operations := expectArray(t, actuation["operations"], "operations")
	operation := expectRecord(t, operations[0], "operations[0]")
	if operation["task_queue"] != "campus-agent.activity.knowledge" {
		t.Fatalf("operation task_queue = %v", operation["task_queue"])
	}
	if operation["current_replicas"] != float64(1) || operation["desired_replicas"] != float64(2) {
		t.Fatalf("operation replicas = %#v", operation)
	}
	if operation["action"] != "scale" {
		t.Fatalf("operation action = %v, want scale", operation["action"])
	}
	for _, path := range []string{evidencePath, actuatorEvidencePath} {
		serialized, err := os.ReadFile(path)
		if err != nil {
			t.Fatalf("read evidence %s: %v", path, err)
		}
		for _, forbidden := range []string{
			"write_run_state",
			"write_workflow_state",
			"write_step_state",
			"write_event_state",
			"terminal_state_write",
		} {
			if strings.Contains(string(serialized), forbidden) {
				t.Fatalf("evidence contains forbidden state-write wording %q: %s", forbidden, serialized)
			}
		}
	}
}

func TestDryRunRejectsUnavailableDownstreamBudget(t *testing.T) {
	dir := t.TempDir()
	inputPath := filepath.Join(dir, "autoscaler-input.json")
	evidencePath := filepath.Join(dir, "autoscaler-evidence.json")
	writeFixture(t, inputPath, `{
		"environment": "staging",
		"generated_at": "2026-06-04T23:00:00Z",
		"queues": [
			{
				"name": "campus-agent.activity.knowledge",
				"role": "knowledge",
				"pollers": 1,
				"backlog": 20,
				"schedule_to_start_ms": 5000,
				"current_replicas": 1,
				"min_replicas": 1,
				"max_replicas": 5,
				"target_schedule_to_start_ms": 500
			}
		],
		"downstream_budgets": {
			"knowledge": {"available": false, "max_replicas": 5}
		}
	}`)

	err := run([]string{"--input-path", inputPath, "--evidence-path", evidencePath})

	if err == nil {
		t.Fatal("unavailable downstream budget must fail closed")
	}
	if !strings.Contains(err.Error(), "downstream budget for role knowledge is unavailable") {
		t.Fatalf("error = %q", err.Error())
	}
	if _, statErr := os.Stat(evidencePath); !os.IsNotExist(statErr) {
		t.Fatalf("evidence should not be written on invalid input, stat err = %v", statErr)
	}
}

func writeFixture(t *testing.T, path string, body string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatalf("write fixture: %v", err)
	}
}

func readJSONRecord(t *testing.T, path string) map[string]any {
	t.Helper()
	body, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read json: %v", err)
	}
	var record map[string]any
	if err := json.Unmarshal(body, &record); err != nil {
		t.Fatalf("decode json: %v", err)
	}
	return record
}

func expectArray(t *testing.T, value any, name string) []any {
	t.Helper()
	values, ok := value.([]any)
	if !ok {
		t.Fatalf("%s = %#v, want array", name, value)
	}
	return values
}

func expectRecord(t *testing.T, value any, name string) map[string]any {
	t.Helper()
	record, ok := value.(map[string]any)
	if !ok {
		t.Fatalf("%s = %#v, want object", name, value)
	}
	return record
}
