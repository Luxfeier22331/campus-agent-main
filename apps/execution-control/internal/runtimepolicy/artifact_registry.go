package runtimepolicy

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const (
	WorkflowArtifactRegistrySchemaVersion = "workflow-artifact-registry-v3"
	defaultWorkflowArtifactRegistryPath   = "configs/runtime/workflow-artifacts.v3.json"
	packagedWorkflowArtifactRegistryPath  = "/etc/campus-agent/workflow-artifacts.v3.json"
)

var supportedArtifactProjectionStatuses = map[string]struct{}{
	"supported_go_runtime": {},
}

var supportedArtifactVisibilities = map[string]struct{}{
	"tool_private":          {},
	"operator_safe_summary": {},
	"finalizer_input":       {},
}

var supportedBindingOpeningGates = map[string]struct{}{
	"open":   {},
	"closed": {},
}

var supportedRequiredInputPrefixes = []string{
	"request:",
	"artifact:",
}

type WorkflowArtifactRegistry struct {
	SchemaVersion         string                `json:"schema_version"`
	RegistryVersion       string                `json:"registry_version"`
	VisibilityValues      []string              `json:"visibility_values"`
	SupportStatusValues   []string              `json:"support_status_values"`
	ForbiddenRawKeyTokens []string              `json:"forbidden_raw_key_tokens"`
	Artifacts             []WorkflowArtifact    `json:"artifacts"`
	Bindings              []WorkflowToolBinding `json:"bindings"`
}

type WorkflowArtifact struct {
	Kind                     string   `json:"kind"`
	DisplayName              string   `json:"display_name"`
	OwnerToolBoundary        string   `json:"owner_tool_boundary"`
	ProducerTools            []string `json:"producer_tools"`
	SourceTruthOwner         string   `json:"source_truth_owner"`
	Visibility               string   `json:"visibility"`
	CurrentProjectionSupport string   `json:"current_projection_support"`
	AnswerEligible           bool     `json:"answer_eligible"`
	RequiresGrounding        bool     `json:"requires_grounding"`
	FreshnessPolicy          string   `json:"freshness_policy"`
	AllowedConsumers         []string `json:"allowed_consumers"`
	KnownAliases             []string `json:"known_aliases"`
	ForbiddenRawPayloadKeys  []string `json:"forbidden_raw_payload_keys"`
	Notes                    string   `json:"notes"`
}

type WorkflowToolBinding struct {
	BindingID         string   `json:"binding_id"`
	OwnerToolBoundary string   `json:"owner_tool_boundary"`
	ToolName          string   `json:"tool_name"`
	Produces          []string `json:"produces"`
	Consumes          []string `json:"consumes"`
	RequiredInputs    []string `json:"required_inputs"`
	StateChanging     bool     `json:"state_changing"`
	OpeningGate       string   `json:"opening_gate"`
	EvalDenominator   []string `json:"eval_denominator"`
	Priority          int      `json:"priority"`
	Notes             string   `json:"notes"`
}

func LoadWorkflowArtifactRegistry(registryPath string) (WorkflowArtifactRegistry, error) {
	resolvedPath := resolveWorkflowArtifactRegistryPath(registryPath)
	if resolvedPath == "" {
		return WorkflowArtifactRegistry{}, fmt.Errorf(
			"workflow artifact registry path is not configured and %s was not found",
			defaultWorkflowArtifactRegistryPath,
		)
	}
	raw, err := os.ReadFile(resolvedPath)
	if err != nil {
		return WorkflowArtifactRegistry{}, fmt.Errorf("read workflow artifact registry: %w", err)
	}
	var registry WorkflowArtifactRegistry
	if err := json.Unmarshal(raw, &registry); err != nil {
		return WorkflowArtifactRegistry{}, fmt.Errorf("parse workflow artifact registry: %w", err)
	}
	if err := registry.Validate(); err != nil {
		return WorkflowArtifactRegistry{}, err
	}
	return registry, nil
}

func (r WorkflowArtifactRegistry) Validate() error {
	if r.SchemaVersion != WorkflowArtifactRegistrySchemaVersion {
		return fmt.Errorf(
			"workflow artifact registry schema_version = %q, want %s",
			r.SchemaVersion,
			WorkflowArtifactRegistrySchemaVersion,
		)
	}
	if strings.TrimSpace(r.RegistryVersion) == "" {
		return fmt.Errorf("workflow artifact registry_version must not be empty")
	}
	if len(r.Artifacts) == 0 {
		return fmt.Errorf("workflow artifact artifacts must not be empty")
	}
	if len(r.Bindings) == 0 {
		return fmt.Errorf("workflow artifact bindings must not be empty")
	}
	rawTokens := stringSet(r.ForbiddenRawKeyTokens)
	if len(rawTokens) == 0 {
		return fmt.Errorf("workflow artifact forbidden_raw_key_tokens must not be empty")
	}
	seenKinds := map[string]struct{}{}
	seenAliases := map[string]string{}
	for index, artifact := range r.Artifacts {
		if err := artifact.Validate(rawTokens); err != nil {
			return fmt.Errorf("workflow artifact artifacts[%d]: %w", index, err)
		}
		if _, exists := seenKinds[artifact.Kind]; exists {
			return fmt.Errorf("workflow artifact duplicate kind: %s", artifact.Kind)
		}
		seenKinds[artifact.Kind] = struct{}{}
		for _, alias := range artifact.KnownAliases {
			alias = strings.TrimSpace(alias)
			if alias == "" {
				return fmt.Errorf("%s known_aliases must not include empty values", artifact.Kind)
			}
			if alias == artifact.Kind {
				return fmt.Errorf("%s known_aliases must not include own kind", artifact.Kind)
			}
			if owner, exists := seenAliases[alias]; exists {
				return fmt.Errorf(
					"workflow artifact alias %s is assigned to both %s and %s",
					alias,
					owner,
					artifact.Kind,
				)
			}
			seenAliases[alias] = artifact.Kind
		}
	}
	for alias := range seenAliases {
		if _, exists := seenKinds[alias]; exists {
			return fmt.Errorf("workflow artifact alias conflicts with artifact kind: %s", alias)
		}
	}
	return nil
}

func (a WorkflowArtifact) Validate(globalRawTokens map[string]struct{}) error {
	if strings.TrimSpace(a.Kind) == "" {
		return fmt.Errorf("kind must not be empty")
	}
	if strings.TrimSpace(a.DisplayName) == "" {
		return fmt.Errorf("%s display_name must not be empty", a.Kind)
	}
	if strings.TrimSpace(a.OwnerToolBoundary) == "" {
		return fmt.Errorf("%s owner_tool_boundary must not be empty", a.Kind)
	}
	if strings.TrimSpace(a.SourceTruthOwner) == "" {
		return fmt.Errorf("%s source_truth_owner must not be empty", a.Kind)
	}
	if _, ok := supportedArtifactVisibilities[a.Visibility]; !ok {
		return fmt.Errorf("%s visibility is unsupported: %s", a.Kind, a.Visibility)
	}
	if _, ok := supportedArtifactProjectionStatuses[a.CurrentProjectionSupport]; !ok {
		return fmt.Errorf(
			"%s current_projection_support is unsupported: %s",
			a.Kind,
			a.CurrentProjectionSupport,
		)
	}
	if strings.TrimSpace(a.FreshnessPolicy) == "" {
		return fmt.Errorf("%s freshness_policy must not be empty", a.Kind)
	}
	if len(a.AllowedConsumers) == 0 {
		return fmt.Errorf("%s allowed_consumers must not be empty", a.Kind)
	}
	if len(a.ForbiddenRawPayloadKeys) == 0 {
		return fmt.Errorf("%s forbidden_raw_payload_keys must not be empty", a.Kind)
	}
	for _, key := range a.ForbiddenRawPayloadKeys {
		if _, ok := globalRawTokens[key]; !ok {
			return fmt.Errorf("%s forbidden raw key is outside global tokens: %s", a.Kind, key)
		}
	}
	return nil
}

func (r WorkflowArtifactRegistry) ArtifactByKind(kind string) (WorkflowArtifact, bool) {
	kind = strings.TrimSpace(kind)
	for _, artifact := range r.Artifacts {
		if artifact.Kind == kind {
			return artifact, true
		}
		for _, alias := range artifact.KnownAliases {
			if alias == kind {
				return artifact, true
			}
		}
	}
	return WorkflowArtifact{}, false
}

func (r WorkflowArtifactRegistry) RegisteredKindOrAlias(kind string) bool {
	_, ok := r.ArtifactByKind(kind)
	return ok
}

func ValidateToolSpecProducerToolsAgainstArtifacts(
	toolRegistry ToolSpecRegistry,
	artifactRegistry WorkflowArtifactRegistry,
) error {
	for _, artifact := range artifactRegistry.Artifacts {
		for _, toolName := range artifact.ProducerTools {
			if !registeredToolOrRouteReadOnly(toolRegistry, toolName) {
				return fmt.Errorf("%s producer tool is not an admitted read-only tool or route: %s", artifact.Kind, toolName)
			}
		}
	}
	return nil
}

func ValidateWorkflowArtifactBindings(
	toolRegistry ToolSpecRegistry,
	artifactRegistry WorkflowArtifactRegistry,
) error {
	artifactsByKind := map[string]WorkflowArtifact{}
	for _, artifact := range artifactRegistry.Artifacts {
		artifactsByKind[artifact.Kind] = artifact
	}
	seenBindingIDs := map[string]struct{}{}
	openProducers := map[string]WorkflowToolBinding{}
	for _, binding := range artifactRegistry.Bindings {
		if _, exists := seenBindingIDs[binding.BindingID]; exists {
			return fmt.Errorf("workflow tool binding duplicate binding_id: %s", binding.BindingID)
		}
		seenBindingIDs[binding.BindingID] = struct{}{}
		if _, ok := supportedBindingOpeningGates[binding.OpeningGate]; !ok {
			return fmt.Errorf(
				"%s opening_gate is unsupported: %s",
				binding.BindingID,
				binding.OpeningGate,
			)
		}
		if binding.StateChanging {
			return fmt.Errorf("%s must remain read-only in workflow harness", binding.BindingID)
		}
		if binding.OpeningGate == "open" && strings.TrimSpace(binding.ToolName) == "" {
			return fmt.Errorf("%s open binding must declare tool_name", binding.BindingID)
		}
		if strings.TrimSpace(binding.ToolName) != "" {
			if !registeredToolOrRouteReadOnly(toolRegistry, binding.ToolName) {
				return fmt.Errorf(
					"%s tool is not an admitted read-only tool or route: %s",
					binding.BindingID,
					binding.ToolName,
				)
			}
		}
		for _, kind := range append(append([]string{}, binding.Produces...), binding.Consumes...) {
			if _, ok := artifactsByKind[kind]; !ok {
				return fmt.Errorf("%s references unknown artifact kind: %s", binding.BindingID, kind)
			}
		}
		for _, requiredInput := range binding.RequiredInputs {
			matched := false
			for _, prefix := range supportedRequiredInputPrefixes {
				if strings.HasPrefix(requiredInput, prefix) {
					matched = true
					break
				}
			}
			if !matched {
				return fmt.Errorf(
					"%s required_input is unsupported: %s",
					binding.BindingID,
					requiredInput,
				)
			}
		}
		if len(binding.EvalDenominator) == 0 {
			return fmt.Errorf("%s eval_denominator must not be empty", binding.BindingID)
		}
		if binding.OpeningGate != "open" {
			continue
		}
		for _, producedKind := range binding.Produces {
			artifact := artifactsByKind[producedKind]
			if artifact.CurrentProjectionSupport != "supported_go_runtime" {
				return fmt.Errorf(
					"%s open binding produces unsupported projection %s current_projection_support=%s",
					binding.BindingID,
					producedKind,
					artifact.CurrentProjectionSupport,
				)
			}
			prior, exists := openProducers[producedKind]
			if exists && prior.Priority == binding.Priority {
				return fmt.Errorf(
					"ambiguous open producer bindings for %s: %s and %s",
					producedKind,
					prior.BindingID,
					binding.BindingID,
				)
			}
			if !exists || binding.Priority < prior.Priority {
				openProducers[producedKind] = binding
			}
		}
	}
	return nil
}

func registeredToolOrRouteReadOnly(toolRegistry ToolSpecRegistry, name string) bool {
	name = strings.TrimSpace(name)
	if name == "" {
		return false
	}
	tool, ok := toolRegistry.ToolByName(name)
	return ok && tool.ReadOnly
}

func ValidateModelVisibleToolArtifactGate(
	tool ToolSpec,
	artifactRegistry WorkflowArtifactRegistry,
) error {
	if tool.Exposure != "model_visible" || !tool.ReadOnly {
		return fmt.Errorf(
			"%s model-visible tool must be model_visible and read_only",
			tool.Name,
		)
	}
	for _, binding := range artifactRegistry.Bindings {
		if binding.ToolName != tool.Name {
			continue
		}
		if binding.OpeningGate != "open" {
			continue
		}
		if len(binding.Produces) == 0 {
			return fmt.Errorf("%s open binding must produce at least one artifact", binding.BindingID)
		}
		for _, producedKind := range binding.Produces {
			artifact, ok := artifactRegistry.ArtifactByKind(producedKind)
			if !ok {
				return fmt.Errorf("%s produces unknown artifact %s", binding.BindingID, producedKind)
			}
			if artifact.CurrentProjectionSupport != "supported_go_runtime" {
				return fmt.Errorf(
					"%s produces unsupported artifact %s current_projection_support=%s",
					binding.BindingID,
					producedKind,
					artifact.CurrentProjectionSupport,
				)
			}
		}
		return nil
	}
	return fmt.Errorf("%s has no open supported workflow artifact binding", tool.Name)
}

func resolveWorkflowArtifactRegistryPath(registryPath string) string {
	if registryPath != "" {
		return registryPath
	}
	workingDir, err := os.Getwd()
	if err != nil {
		return ""
	}
	for dir := workingDir; ; dir = filepath.Dir(dir) {
		candidate := filepath.Join(dir, defaultWorkflowArtifactRegistryPath)
		if _, err := os.Stat(candidate); err == nil {
			return candidate
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			if _, err := os.Stat(packagedWorkflowArtifactRegistryPath); err == nil {
				return packagedWorkflowArtifactRegistryPath
			}
			return ""
		}
	}
}

func stringSet(values []string) map[string]struct{} {
	set := map[string]struct{}{}
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		set[value] = struct{}{}
	}
	return set
}
