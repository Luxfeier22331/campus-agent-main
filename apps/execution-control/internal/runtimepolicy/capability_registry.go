package runtimepolicy

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

const (
	CapabilitySpecSchemaVersion = "capability-spec-registry-v1"
	defaultCapabilitySpecPath   = "configs/runtime/capabilities.v1.json"
)

var (
	defaultCapabilitySpecRegistryOnce sync.Once
	defaultCapabilitySpecRegistry     CapabilitySpecRegistry
	defaultCapabilitySpecRegistryOK   bool
)

type CapabilitySpec struct {
	ID                     string   `json:"id"`
	OwnerPackage           string   `json:"owner_package"`
	WorkerRole             string   `json:"worker_role"`
	RuntimeAdapter         string   `json:"runtime_adapter"`
	Active                 bool     `json:"active"`
	OpeningGate            string   `json:"opening_gate"`
	AllowedStructuredTools []string `json:"allowed_structured_tools"`
	ContextProjectionKinds []string `json:"context_projection_kinds"`
	Description            string   `json:"description"`
}

type CapabilitySpecRegistry struct {
	SchemaVersion   string           `json:"schema_version"`
	RegistryVersion string           `json:"registry_version"`
	Capabilities    []CapabilitySpec `json:"capabilities"`
}

func LoadCapabilitySpecRegistry(registryPath string) (CapabilitySpecRegistry, error) {
	resolvedPath := resolveCapabilitySpecPath(registryPath)
	if resolvedPath == "" {
		return CapabilitySpecRegistry{}, fmt.Errorf("capability spec path is not configured and %s was not found", defaultCapabilitySpecPath)
	}
	raw, err := os.ReadFile(resolvedPath)
	if err != nil {
		return CapabilitySpecRegistry{}, fmt.Errorf("read capability spec registry: %w", err)
	}
	var registry CapabilitySpecRegistry
	if err := json.Unmarshal(raw, &registry); err != nil {
		return CapabilitySpecRegistry{}, fmt.Errorf("parse capability spec registry: %w", err)
	}
	if err := registry.Validate(); err != nil {
		return CapabilitySpecRegistry{}, err
	}
	return registry, nil
}

func DefaultCapabilitySpecRegistry() (CapabilitySpecRegistry, bool) {
	defaultCapabilitySpecRegistryOnce.Do(func() {
		registry, err := LoadCapabilitySpecRegistry("")
		if err != nil {
			defaultCapabilitySpecRegistryOK = false
			return
		}
		defaultCapabilitySpecRegistry = registry
		defaultCapabilitySpecRegistryOK = true
	})
	return defaultCapabilitySpecRegistry, defaultCapabilitySpecRegistryOK
}

func (r CapabilitySpecRegistry) Validate() error {
	if r.SchemaVersion != CapabilitySpecSchemaVersion {
		return fmt.Errorf("capability spec schema_version = %q, want %s", r.SchemaVersion, CapabilitySpecSchemaVersion)
	}
	if strings.TrimSpace(r.RegistryVersion) == "" {
		return fmt.Errorf("capability spec registry_version must not be empty")
	}
	if len(r.Capabilities) == 0 {
		return fmt.Errorf("capability spec capabilities must not be empty")
	}
	seen := map[string]struct{}{}
	for index, capability := range r.Capabilities {
		if err := capability.Validate(); err != nil {
			return fmt.Errorf("capability spec capabilities[%d]: %w", index, err)
		}
		if _, exists := seen[capability.ID]; exists {
			return fmt.Errorf("capability spec duplicate capability id: %s", capability.ID)
		}
		seen[capability.ID] = struct{}{}
	}
	return nil
}

func (c CapabilitySpec) Validate() error {
	if strings.TrimSpace(c.ID) == "" {
		return fmt.Errorf("id must not be empty")
	}
	if !SupportedCapability(c.ID) {
		return fmt.Errorf("%s id is unsupported", c.ID)
	}
	if strings.TrimSpace(c.OwnerPackage) == "" {
		return fmt.Errorf("%s owner_package must not be empty", c.ID)
	}
	if strings.TrimSpace(c.WorkerRole) == "" {
		return fmt.Errorf("%s worker_role must not be empty", c.ID)
	}
	if c.WorkerRole != WorkerRoleForCapability(c.ID) {
		return fmt.Errorf("%s worker_role = %q, want %q", c.ID, c.WorkerRole, WorkerRoleForCapability(c.ID))
	}
	if c.RuntimeAdapter != "temporal_activity_worker" {
		return fmt.Errorf("%s runtime_adapter is unsupported: %s", c.ID, c.RuntimeAdapter)
	}
	if c.OpeningGate != "open" && c.OpeningGate != "closed" {
		return fmt.Errorf("%s opening_gate is unsupported: %s", c.ID, c.OpeningGate)
	}
	if c.OpeningGate == "closed" && c.Active {
		return fmt.Errorf("%s closed opening_gate cannot be active", c.ID)
	}
	if c.ID == "knowledge" && len(c.AllowedStructuredTools) > 0 {
		return fmt.Errorf("knowledge must not expose structured tools")
	}
	for _, tool := range c.AllowedStructuredTools {
		if tool == "campus_notice_get" {
			return fmt.Errorf("notice must not expose campus_notice_get as structured handoff tool")
		}
	}
	return nil
}

func (r CapabilitySpecRegistry) CapabilityByID(capabilityID string) (CapabilitySpec, bool) {
	for _, capability := range r.Capabilities {
		if capability.ID == capabilityID {
			return capability, true
		}
	}
	return CapabilitySpec{}, false
}

func resolveCapabilitySpecPath(registryPath string) string {
	if registryPath != "" {
		return registryPath
	}
	if envRegistryPath := strings.TrimSpace(os.Getenv("EXECUTION_CONTROL_CAPABILITY_SPEC_PATH")); envRegistryPath != "" {
		return envRegistryPath
	}
	workingDir, err := os.Getwd()
	if err != nil {
		return ""
	}
	for dir := workingDir; ; dir = filepath.Dir(dir) {
		candidate := filepath.Join(dir, defaultCapabilitySpecPath)
		if _, err := os.Stat(candidate); err == nil {
			return candidate
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return ""
		}
	}
}
