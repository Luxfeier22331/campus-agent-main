package main

import (
	"bytes"
	"encoding/json"
	"testing"
)

func TestRunBuildsTrustedWorkerContextAcceptedByExecutionParser(t *testing.T) {
	input := []byte(`{
		"cases": [
			{
				"case_id": "intent-runner-knowledge-001",
				"user_goal": "奖学金怎么申请？",
				"requested_capability": "knowledge",
				"context": {
					"actor": {
						"user_id": "",
						"principal_id": "",
						"principal_type": "",
						"roles": [],
						"departments": []
					},
					"authorization": {
						"principal_id": "",
						"entitlement_groups": [],
						"ownership_scopes": [],
						"retrieval_filter": {
							"entitlement_groups": [],
							"visibility_level": "public",
							"policy_projection_version": "phase1-authorization-projection-v1"
						}
					},
					"session": {
						"confirmed_slots": [],
						"turn_count": 0
					}
				}
			}
		]
	}`)
	var output bytes.Buffer

	if err := run(bytes.NewReader(input), &output); err != nil {
		t.Fatalf("run returned error: %v", err)
	}

	var payload evalOutput
	if err := json.Unmarshal(output.Bytes(), &payload); err != nil {
		t.Fatalf("decode output: %v", err)
	}
	if len(payload.Results) != 1 {
		t.Fatalf("result count = %d, want 1", len(payload.Results))
	}
	observed := payload.Results[0].Observed
	if observed.ErrorCode != "" {
		t.Fatalf("error_code = %q, want empty", observed.ErrorCode)
	}
	if observed.Capability != "knowledge" {
		t.Fatalf("capability = %q, want knowledge", observed.Capability)
	}
	if observed.SelectedCapability != "knowledge" {
		t.Fatalf("selected_capability = %q, want knowledge", observed.SelectedCapability)
	}
}
