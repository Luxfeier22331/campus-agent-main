package runtimepolicy

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const (
	ToolSpecSchemaVersion = "tool-spec-registry-v2"
	defaultToolSpecPath   = "configs/runtime/tools.v2.json"
)

var supportedToolOwnerCapabilities = map[string]string{
	"rag-agent":             "knowledge",
	"navigation-agent":      "place_lookup",
	"campus-services-agent": "campus_services",
	"notice-agent":          "notice",
}

var supportedToolBackends = map[string]struct{}{
	"internal_structured_query_service": {},
	"retrieval_core":                    {},
}

var supportedToolSurfaces = map[string]struct{}{
	"structured_handoff": {},
	"agent_internal":     {},
}

var supportedRuntimePostures = map[string]struct{}{
	"closed":                {},
	"typed_handoff_only":    {},
	"sdk_adapter_admitted":  {},
	"sdk_internal_admitted": {},
	"internal_function":     {},
}

type ToolFunctionSchemaSpec struct {
	Available bool `json:"available"`
	Strict    bool `json:"strict"`
}

type ToolSpec struct {
	Name             string                 `json:"name"`
	OwnerAgent       string                 `json:"owner_agent"`
	Capability       string                 `json:"capability"`
	PayloadKind      string                 `json:"payload_kind"`
	PayloadSchemaRef string                 `json:"payload_schema_ref"`
	ResultSchemaRef  string                 `json:"result_schema_ref"`
	Backend          string                 `json:"backend"`
	Surface          string                 `json:"surface"`
	ReadOnly         bool                   `json:"read_only"`
	Active           bool                   `json:"active"`
	FunctionSchema   ToolFunctionSchemaSpec `json:"function_schema"`
	RuntimePosture   string                 `json:"runtime_posture"`
	Description      string                 `json:"description"`
}

type ToolSpecRegistry struct {
	SchemaVersion   string     `json:"schema_version"`
	RegistryVersion string     `json:"registry_version"`
	Tools           []ToolSpec `json:"tools"`
}

func LoadToolSpecRegistry(registryPath string) (ToolSpecRegistry, error) {
	resolvedPath := resolveToolSpecPath(registryPath)
	if resolvedPath == "" {
		return ToolSpecRegistry{}, fmt.Errorf("tool spec path is not configured and %s was not found", defaultToolSpecPath)
	}
	raw, err := os.ReadFile(resolvedPath)
	if err != nil {
		return ToolSpecRegistry{}, fmt.Errorf("read tool spec registry: %w", err)
	}
	var registry ToolSpecRegistry
	if err := json.Unmarshal(raw, &registry); err != nil {
		return ToolSpecRegistry{}, fmt.Errorf("parse tool spec registry: %w", err)
	}
	if err := registry.Validate(); err != nil {
		return ToolSpecRegistry{}, err
	}
	return registry, nil
}

func (r ToolSpecRegistry) Validate() error {
	if r.SchemaVersion != ToolSpecSchemaVersion {
		return fmt.Errorf("tool spec schema_version = %q, want %s", r.SchemaVersion, ToolSpecSchemaVersion)
	}
	if strings.TrimSpace(r.RegistryVersion) == "" {
		return fmt.Errorf("tool spec registry_version must not be empty")
	}
	if len(r.Tools) == 0 {
		return fmt.Errorf("tool spec tools must not be empty")
	}
	seen := map[string]struct{}{}
	for index, tool := range r.Tools {
		if err := tool.Validate(); err != nil {
			return fmt.Errorf("tool spec tools[%d]: %w", index, err)
		}
		if _, ok := seen[tool.Name]; ok {
			return fmt.Errorf("tool spec duplicate tool name: %s", tool.Name)
		}
		seen[tool.Name] = struct{}{}
	}
	return nil
}

func (t ToolSpec) Validate() error {
	if strings.TrimSpace(t.Name) == "" {
		return fmt.Errorf("name must not be empty")
	}
	if strings.TrimSpace(t.OwnerAgent) == "" {
		return fmt.Errorf("%s owner_agent must not be empty", t.Name)
	}
	expectedCapability, ok := supportedToolOwnerCapabilities[t.OwnerAgent]
	if !ok {
		return fmt.Errorf("%s owner_agent is unsupported: %s", t.Name, t.OwnerAgent)
	}
	if t.Capability != expectedCapability {
		return fmt.Errorf("%s capability = %q, want %q", t.Name, t.Capability, expectedCapability)
	}
	if strings.TrimSpace(t.PayloadKind) == "" {
		return fmt.Errorf("%s payload_kind must not be empty", t.Name)
	}
	if strings.TrimSpace(t.PayloadSchemaRef) == "" {
		return fmt.Errorf("%s payload_schema_ref must not be empty", t.Name)
	}
	if strings.TrimSpace(t.ResultSchemaRef) == "" {
		return fmt.Errorf("%s result_schema_ref must not be empty", t.Name)
	}
	if _, ok := supportedToolBackends[t.Backend]; !ok {
		return fmt.Errorf("%s backend is unsupported: %s", t.Name, t.Backend)
	}
	if _, ok := supportedToolSurfaces[t.Surface]; !ok {
		return fmt.Errorf("%s surface is unsupported: %s", t.Name, t.Surface)
	}
	if t.Active && !t.ReadOnly {
		return fmt.Errorf("%s active tools must be read_only", t.Name)
	}
	functionSchema := t.effectiveFunctionSchema()
	if t.Surface == "structured_handoff" {
		if t.PayloadKind != t.Name {
			return fmt.Errorf("%s structured_handoff payload_kind must match tool name", t.Name)
		}
		if t.Backend != "internal_structured_query_service" {
			return fmt.Errorf("%s structured_handoff backend must be internal_structured_query_service", t.Name)
		}
	}
	if functionSchema.Available {
		if !functionSchema.Strict {
			return fmt.Errorf("%s function_schema.strict must be true when available", t.Name)
		}
		if t.Surface != "structured_handoff" &&
			(t.Surface != "agent_internal" || t.RuntimePosture != "sdk_internal_admitted") {
			return fmt.Errorf(
				"%s function_schema can only be available for structured_handoff or sdk_internal_admitted agent_internal tools",
				t.Name,
			)
		}
	}
	runtimePosture := t.effectiveRuntimePosture()
	if _, ok := supportedRuntimePostures[runtimePosture]; !ok {
		return fmt.Errorf("%s runtime_posture is unsupported: %s", t.Name, runtimePosture)
	}
	if runtimePosture == "sdk_internal_admitted" && t.Surface != "agent_internal" {
		return fmt.Errorf("%s sdk_internal_admitted posture requires agent_internal surface", t.Name)
	}
	if runtimePosture == "internal_function" && t.Surface != "agent_internal" {
		return fmt.Errorf("%s internal_function posture requires agent_internal surface", t.Name)
	}
	if runtimePosture == "internal_function" && functionSchema.Available {
		return fmt.Errorf("%s internal_function posture must not expose function_schema", t.Name)
	}
	if strings.HasPrefix(runtimePosture, "sdk_") && !functionSchema.Available {
		return fmt.Errorf("%s runtime posture requires function_schema.available", t.Name)
	}
	return nil
}

func (r ToolSpecRegistry) AllowedToolsForTarget(target string) []string {
	allowed := make([]string, 0)
	for _, tool := range r.Tools {
		if tool.Active && tool.Surface == "structured_handoff" && tool.OwnerAgent == target {
			allowed = append(allowed, tool.Name)
		}
	}
	return allowed
}

func (r ToolSpecRegistry) AllowedToolsForPayloadKind(target string, payloadKind string) []string {
	for _, tool := range r.Tools {
		if tool.Active &&
			tool.Surface == "structured_handoff" &&
			tool.OwnerAgent == target &&
			tool.PayloadKind == payloadKind {
			return []string{tool.Name}
		}
	}
	return nil
}

func (r ToolSpecRegistry) PayloadKindsForTarget(target string) []string {
	seen := map[string]struct{}{}
	result := make([]string, 0)
	for _, tool := range r.Tools {
		if tool.OwnerAgent != target {
			continue
		}
		if _, ok := seen[tool.PayloadKind]; ok {
			continue
		}
		seen[tool.PayloadKind] = struct{}{}
		result = append(result, tool.PayloadKind)
	}
	return result
}

func (r ToolSpecRegistry) PayloadKindBelongsToTarget(target string, payloadKind string) bool {
	for _, candidate := range r.PayloadKindsForTarget(target) {
		if candidate == payloadKind {
			return true
		}
	}
	return false
}

func (r ToolSpecRegistry) ToolByName(name string) (ToolSpec, bool) {
	for _, tool := range r.Tools {
		if tool.Name == name {
			tool.FunctionSchema = tool.effectiveFunctionSchema()
			tool.RuntimePosture = tool.effectiveRuntimePosture()
			return tool, true
		}
	}
	return ToolSpec{}, false
}

func (t ToolSpec) effectiveRuntimePosture() string {
	posture := strings.TrimSpace(t.RuntimePosture)
	if posture != "" {
		return posture
	}
	if t.Surface == "agent_internal" {
		return "closed"
	}
	return "typed_handoff_only"
}

func (t ToolSpec) effectiveFunctionSchema() ToolFunctionSchemaSpec {
	return ToolFunctionSchemaSpec{
		Available: t.FunctionSchema.Available,
		Strict:    t.FunctionSchema.Strict,
	}
}

func resolveToolSpecPath(registryPath string) string {
	if registryPath != "" {
		return registryPath
	}
	if envRegistryPath := strings.TrimSpace(os.Getenv("EXECUTION_GATEWAY_TOOL_SPEC_PATH")); envRegistryPath != "" {
		return envRegistryPath
	}
	workingDir, err := os.Getwd()
	if err != nil {
		return ""
	}
	for dir := workingDir; ; dir = filepath.Dir(dir) {
		candidate := filepath.Join(dir, defaultToolSpecPath)
		if _, err := os.Stat(candidate); err == nil {
			return candidate
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return ""
		}
	}
}
