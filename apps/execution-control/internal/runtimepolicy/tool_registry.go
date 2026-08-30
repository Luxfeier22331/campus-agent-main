package runtimepolicy

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

const (
	ToolRegistrySchemaVersion = "tool-registry-v7"
	defaultToolRegistryPath   = "configs/runtime/tools.v7.json"
	packagedToolRegistryPath  = "/etc/campus-agent/tools.v7.json"
)

var toolSchemaRefPattern = regexp.MustCompile(
	`^https://muc\.wiki/campus-agent/schemas/[A-Za-z0-9.-]+\.schema\.json#/\$defs/[A-Za-z0-9_]+$`,
)

var supportedToolExposures = map[string]struct{}{
	"model_visible": {},
	"closed":        {},
}

var supportedToolHandlerTypes = map[string]struct{}{
	"execution_control_internal_query": {},
}

type ToolSpec struct {
	Name                   string          `json:"name"`
	Description            string          `json:"description"`
	Exposure               string          `json:"exposure"`
	ReadOnly               bool            `json:"read_only"`
	RequiresApproval       bool            `json:"requires_approval"`
	PayloadSchemaRef       string          `json:"payload_schema_ref"`
	ResultSchemaRef        string          `json:"result_schema_ref"`
	Handler                ToolSpecHandler `json:"handler"`
	TimeoutMS              int             `json:"timeout_ms"`
	ResultProjectionPolicy string          `json:"result_projection_policy"`
}

type ToolSpecHandler struct {
	Type     string `json:"type"`
	Endpoint string `json:"endpoint,omitempty"`
	Target   string `json:"target,omitempty"`
}

type ToolSpecRegistry struct {
	SchemaVersion   string     `json:"schema_version"`
	RegistryVersion string     `json:"registry_version"`
	Tools           []ToolSpec `json:"tools"`
}

func LoadToolSpecRegistry(registryPath string) (ToolSpecRegistry, error) {
	resolvedPath := resolveToolSpecPath(registryPath)
	if resolvedPath == "" {
		return ToolSpecRegistry{}, fmt.Errorf("tool registry path is not configured and %s was not found", defaultToolRegistryPath)
	}
	raw, err := os.ReadFile(resolvedPath)
	if err != nil {
		return ToolSpecRegistry{}, fmt.Errorf("read tool registry: %w", err)
	}
	var registry ToolSpecRegistry
	if err := json.Unmarshal(raw, &registry); err != nil {
		return ToolSpecRegistry{}, fmt.Errorf("parse tool registry: %w", err)
	}
	if err := registry.Validate(); err != nil {
		return ToolSpecRegistry{}, err
	}
	return registry, nil
}

func (r ToolSpecRegistry) Validate() error {
	if r.SchemaVersion != ToolRegistrySchemaVersion {
		return fmt.Errorf("tool registry schema_version = %q, want %s", r.SchemaVersion, ToolRegistrySchemaVersion)
	}
	if strings.TrimSpace(r.RegistryVersion) == "" {
		return fmt.Errorf("tool registry registry_version must not be empty")
	}
	if len(r.Tools) == 0 {
		return fmt.Errorf("tool registry tools must not be empty")
	}
	seen := map[string]struct{}{}
	for index, tool := range r.Tools {
		if err := tool.Validate(); err != nil {
			return fmt.Errorf("tool registry tools[%d]: %w", index, err)
		}
		if _, ok := seen[tool.Name]; ok {
			return fmt.Errorf("tool registry duplicate tool name: %s", tool.Name)
		}
		seen[tool.Name] = struct{}{}
	}
	return nil
}

func (t ToolSpec) Validate() error {
	if strings.TrimSpace(t.Name) == "" {
		return fmt.Errorf("name must not be empty")
	}
	if strings.TrimSpace(t.Description) == "" {
		return fmt.Errorf("%s description must not be empty", t.Name)
	}
	if _, ok := supportedToolExposures[t.Exposure]; !ok {
		return fmt.Errorf("%s exposure is unsupported: %s", t.Name, t.Exposure)
	}
	if !toolSchemaRefPattern.MatchString(strings.TrimSpace(t.PayloadSchemaRef)) {
		return fmt.Errorf("%s payload_schema_ref must reference a registered JSON Schema definition", t.Name)
	}
	if !toolSchemaRefPattern.MatchString(strings.TrimSpace(t.ResultSchemaRef)) {
		return fmt.Errorf("%s result_schema_ref must reference a registered JSON Schema definition", t.Name)
	}
	if _, ok := supportedToolHandlerTypes[t.Handler.Type]; !ok {
		return fmt.Errorf("%s handler.type is unsupported: %s", t.Name, t.Handler.Type)
	}
	switch t.Handler.Type {
	case "execution_control_internal_query":
		if !strings.HasPrefix(strings.TrimSpace(t.Handler.Endpoint), "/internal/") {
			return fmt.Errorf("%s handler.endpoint must be an /internal/ path", t.Name)
		}
		if strings.TrimSpace(t.Handler.Target) != "" {
			return fmt.Errorf("%s handler.target must be empty for execution_control_internal_query", t.Name)
		}
	}
	if t.Exposure == "model_visible" && !t.ReadOnly {
		return fmt.Errorf("%s model-visible tools must be read_only", t.Name)
	}
	if t.Exposure == "closed" && t.RequiresApproval {
		return fmt.Errorf("%s closed tools must not require approval", t.Name)
	}
	if t.TimeoutMS <= 0 {
		return fmt.Errorf("%s timeout_ms must be positive", t.Name)
	}
	if t.ResultProjectionPolicy != "bounded_json" {
		return fmt.Errorf("%s result_projection_policy is unsupported: %s", t.Name, t.ResultProjectionPolicy)
	}
	return nil
}

func (r ToolSpecRegistry) ModelVisibleToolNames() []string {
	allowed := make([]string, 0)
	for _, tool := range r.Tools {
		if tool.Exposure == "model_visible" && tool.ReadOnly {
			allowed = append(allowed, tool.Name)
		}
	}
	return allowed
}

func (r ToolSpecRegistry) ModelVisibleToolByName(name string) (ToolSpec, bool) {
	tool, ok := r.ToolByName(name)
	if !ok || tool.Exposure != "model_visible" || !tool.ReadOnly {
		return ToolSpec{}, false
	}
	return tool, true
}

func (r ToolSpecRegistry) ToolNamesByHandlerEndpoint(endpoint string) []string {
	normalized := strings.TrimSpace(endpoint)
	if normalized == "" {
		return nil
	}
	names := make([]string, 0)
	for _, tool := range r.Tools {
		if tool.Handler.Type == "execution_control_internal_query" &&
			strings.TrimSpace(tool.Handler.Endpoint) == normalized {
			names = append(names, tool.Name)
		}
	}
	return names
}

func (r ToolSpecRegistry) ToolByName(name string) (ToolSpec, bool) {
	for _, tool := range r.Tools {
		if tool.Name == name {
			return tool, true
		}
	}
	return ToolSpec{}, false
}

func resolveToolSpecPath(registryPath string) string {
	if registryPath != "" {
		return registryPath
	}
	workingDir, err := os.Getwd()
	if err != nil {
		return ""
	}
	for dir := workingDir; ; dir = filepath.Dir(dir) {
		candidate := filepath.Join(dir, defaultToolRegistryPath)
		if _, err := os.Stat(candidate); err == nil {
			return candidate
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			if _, err := os.Stat(packagedToolRegistryPath); err == nil {
				return packagedToolRegistryPath
			}
			return ""
		}
	}
}
