package runtimepolicy

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const defaultIntentPolicyPath = "configs/runtime/intent-policy.v1.json"

var requiredIntentSignalGroups = []string{
	"campus_scope",
	"contextual_follow_up",
	"curriculum_semester",
	"delegated_action_prefix",
	"external_institution",
	"follow_up_leading",
	"general_world",
	"geopolitical_entity",
	"high_risk_transaction_action",
	"notice_context_reference",
	"political_influence_action",
	"political_message_writing",
	"political_office",
	"political_position",
	"political_target_audience",
	"political_topic",
	"structured_notice",
	"structured_service_guide_action",
	"structured_service_guide_subject",
	"structured_service_status",
	"structured_service_subject",
	"structured_transport",
}

type IntentPolicyArtifact struct {
	SchemaVersion       string              `json:"schema_version"`
	PolicyVersion       string              `json:"policy_version"`
	ClassifierVersion   string              `json:"classifier_version"`
	IntentSchemaVersion string              `json:"intent_schema_version"`
	CaseSetVersion      string              `json:"case_set_version"`
	ReasonCodes         []string            `json:"reason_codes"`
	SignalGroups        map[string][]string `json:"signal_groups"`
}

func (p IntentPolicyArtifact) Signals(group string) []string {
	signals := p.SignalGroups[group]
	return append([]string(nil), signals...)
}

func LoadIntentPolicy(policyPath string) (IntentPolicyArtifact, error) {
	resolvedPath := resolveIntentPolicyPath(policyPath)
	if resolvedPath == "" {
		return IntentPolicyArtifact{}, fmt.Errorf("intent policy path is not configured and %s was not found", defaultIntentPolicyPath)
	}
	raw, err := os.ReadFile(resolvedPath)
	if err != nil {
		return IntentPolicyArtifact{}, fmt.Errorf("read intent policy: %w", err)
	}
	var artifact IntentPolicyArtifact
	if err := json.Unmarshal(raw, &artifact); err != nil {
		return IntentPolicyArtifact{}, fmt.Errorf("parse intent policy: %w", err)
	}
	if err := artifact.Validate(); err != nil {
		return IntentPolicyArtifact{}, err
	}
	return artifact, nil
}

func (p IntentPolicyArtifact) Validate() error {
	if p.SchemaVersion != "intent-policy-artifact-v1" {
		return fmt.Errorf("intent policy schema_version = %q, want intent-policy-artifact-v1", p.SchemaVersion)
	}
	if p.PolicyVersion != PolicyVersion {
		return fmt.Errorf("intent policy policy_version = %q, want %q", p.PolicyVersion, PolicyVersion)
	}
	if p.ClassifierVersion != ClassifierVersion {
		return fmt.Errorf("intent policy classifier_version = %q, want %q", p.ClassifierVersion, ClassifierVersion)
	}
	if p.IntentSchemaVersion != IntentSchema {
		return fmt.Errorf("intent policy intent_schema_version = %q, want %q", p.IntentSchemaVersion, IntentSchema)
	}
	if p.CaseSetVersion == "" {
		return fmt.Errorf("intent policy case_set_version must not be empty")
	}
	if len(p.ReasonCodes) == 0 {
		return fmt.Errorf("intent policy reason_codes must not be empty")
	}
	if p.SignalGroups == nil {
		return fmt.Errorf("intent policy signal_groups must not be empty")
	}
	for _, group := range requiredIntentSignalGroups {
		if _, ok := p.SignalGroups[group]; !ok {
			return fmt.Errorf("intent policy signal_groups.%s is required", group)
		}
	}
	return nil
}

func resolveIntentPolicyPath(policyPath string) string {
	if policyPath != "" {
		return policyPath
	}
	if envPolicyPath := strings.TrimSpace(os.Getenv("SUPERVISOR_API_INTENT_POLICY_PATH")); envPolicyPath != "" {
		return envPolicyPath
	}
	workingDir, err := os.Getwd()
	if err != nil {
		return ""
	}
	for dir := workingDir; ; dir = filepath.Dir(dir) {
		candidate := filepath.Join(dir, defaultIntentPolicyPath)
		if _, err := os.Stat(candidate); err == nil {
			return candidate
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return ""
		}
	}
}
