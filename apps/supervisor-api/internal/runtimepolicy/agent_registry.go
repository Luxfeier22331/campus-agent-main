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
	AgentSpecSchemaVersion = "agent-spec-registry-v1"
	defaultAgentSpecPath   = "configs/runtime/agents.v1.json"
)

var (
	defaultAgentSpecRegistryOnce sync.Once
	defaultAgentSpecRegistry     AgentSpecRegistry
	defaultAgentSpecRegistryOK   bool
)

type AgentSpec struct {
	ID                           string   `json:"id"`
	Capability                   string   `json:"capability"`
	OwnerPackage                 string   `json:"owner_package"`
	RuntimeAdapter               string   `json:"runtime_adapter"`
	Active                       bool     `json:"active"`
	OpeningGate                  string   `json:"opening_gate"`
	PayloadKinds                 []string `json:"payload_kinds"`
	AllowedStructuredHandoffTools []string `json:"allowed_structured_handoff_tools"`
	ContextProjectionKinds       []string `json:"context_projection_kinds"`
	Description                  string   `json:"description"`
}

type AgentSpecRegistry struct {
	SchemaVersion   string      `json:"schema_version"`
	RegistryVersion string      `json:"registry_version"`
	Agents          []AgentSpec `json:"agents"`
}

func LoadAgentSpecRegistry(registryPath string) (AgentSpecRegistry, error) {
	resolvedPath := resolveAgentSpecPath(registryPath)
	if resolvedPath == "" {
		return AgentSpecRegistry{}, fmt.Errorf("agent spec path is not configured and %s was not found", defaultAgentSpecPath)
	}
	raw, err := os.ReadFile(resolvedPath)
	if err != nil {
		return AgentSpecRegistry{}, fmt.Errorf("read agent spec registry: %w", err)
	}
	var registry AgentSpecRegistry
	if err := json.Unmarshal(raw, &registry); err != nil {
		return AgentSpecRegistry{}, fmt.Errorf("parse agent spec registry: %w", err)
	}
	if err := registry.Validate(); err != nil {
		return AgentSpecRegistry{}, err
	}
	return registry, nil
}

func DefaultAgentSpecRegistry() (AgentSpecRegistry, bool) {
	defaultAgentSpecRegistryOnce.Do(func() {
		registry, err := LoadAgentSpecRegistry("")
		if err != nil {
			defaultAgentSpecRegistryOK = false
			return
		}
		defaultAgentSpecRegistry = registry
		defaultAgentSpecRegistryOK = true
	})
	return defaultAgentSpecRegistry, defaultAgentSpecRegistryOK
}

func (r AgentSpecRegistry) Validate() error {
	if r.SchemaVersion != AgentSpecSchemaVersion {
		return fmt.Errorf("agent spec schema_version = %q, want %s", r.SchemaVersion, AgentSpecSchemaVersion)
	}
	if strings.TrimSpace(r.RegistryVersion) == "" {
		return fmt.Errorf("agent spec registry_version must not be empty")
	}
	if len(r.Agents) == 0 {
		return fmt.Errorf("agent spec agents must not be empty")
	}
	seen := map[string]struct{}{}
	seenCapabilities := map[string]struct{}{}
	for index, agent := range r.Agents {
		if err := agent.Validate(); err != nil {
			return fmt.Errorf("agent spec agents[%d]: %w", index, err)
		}
		if _, exists := seen[agent.ID]; exists {
			return fmt.Errorf("agent spec duplicate agent id: %s", agent.ID)
		}
		if _, exists := seenCapabilities[agent.Capability]; exists {
			return fmt.Errorf("agent spec duplicate capability assignment: %s", agent.Capability)
		}
		seen[agent.ID] = struct{}{}
		seenCapabilities[agent.Capability] = struct{}{}
	}
	return nil
}

func (a AgentSpec) Validate() error {
	if strings.TrimSpace(a.ID) == "" {
		return fmt.Errorf("id must not be empty")
	}
	expectedCapability, ok := supportedToolOwnerCapabilities[a.ID]
	if !ok {
		return fmt.Errorf("%s id is unsupported", a.ID)
	}
	if a.Capability != expectedCapability {
		return fmt.Errorf("%s capability = %q, want %q", a.ID, a.Capability, expectedCapability)
	}
	if strings.TrimSpace(a.OwnerPackage) == "" {
		return fmt.Errorf("%s owner_package must not be empty", a.ID)
	}
	if a.RuntimeAdapter != "worker_dispatch" {
		return fmt.Errorf("%s runtime_adapter is unsupported: %s", a.ID, a.RuntimeAdapter)
	}
	if a.OpeningGate != "open" && a.OpeningGate != "closed" {
		return fmt.Errorf("%s opening_gate is unsupported: %s", a.ID, a.OpeningGate)
	}
	if a.OpeningGate == "closed" && a.Active {
		return fmt.Errorf("%s closed opening_gate cannot be active", a.ID)
	}
	if len(a.PayloadKinds) == 0 {
		return fmt.Errorf("%s payload_kinds must not be empty", a.ID)
	}
	if a.ID == "rag-agent" && len(a.AllowedStructuredHandoffTools) > 0 {
		return fmt.Errorf("rag-agent must not expose structured handoff tools")
	}
	for _, tool := range a.AllowedStructuredHandoffTools {
		if tool == "campus_notice_get" {
			return fmt.Errorf("notice-agent must not expose campus_notice_get as structured handoff tool")
		}
	}
	return nil
}

func (r AgentSpecRegistry) AgentByID(agentID string) (AgentSpec, bool) {
	for _, agent := range r.Agents {
		if agent.ID == agentID {
			return agent, true
		}
	}
	return AgentSpec{}, false
}

func resolveAgentSpecPath(registryPath string) string {
	if registryPath != "" {
		return registryPath
	}
	if envRegistryPath := strings.TrimSpace(os.Getenv("SUPERVISOR_API_AGENT_SPEC_PATH")); envRegistryPath != "" {
		return envRegistryPath
	}
	workingDir, err := os.Getwd()
	if err != nil {
		return ""
	}
	for dir := workingDir; ; dir = filepath.Dir(dir) {
		candidate := filepath.Join(dir, defaultAgentSpecPath)
		if _, err := os.Stat(candidate); err == nil {
			return candidate
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return ""
		}
	}
}
