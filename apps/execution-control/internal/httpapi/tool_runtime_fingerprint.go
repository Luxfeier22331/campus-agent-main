package httpapi

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/runtimepolicy"
)

const toolRuntimeFingerprintSchemaVersion = "tool_runtime_fingerprint.v1"

const (
	defaultToolRegistryRelativePath             = "configs/runtime/tools.v4.json"
	defaultToolFunctionSchemaRelativePath       = "configs/runtime/tool-function-schemas.v1.json"
	defaultWorkflowArtifactRegistryRelativePath = "configs/runtime/workflow-artifacts.v2.json"
	packagedToolRegistryPath                    = "/etc/campus-agent/tools.v4.json"
	packagedWorkflowArtifactRegistryPath        = "/etc/campus-agent/workflow-artifacts.v2.json"
)

type toolRuntimeFingerprint struct {
	SchemaVersion                   string `json:"schema_version"`
	ToolsSchemaVersion              string `json:"tools_schema_version"`
	ToolsRegistryVersion            string `json:"tools_registry_version"`
	ToolsSHA256                     string `json:"tools_sha256"`
	FunctionSchemaVersion           string `json:"function_schema_version"`
	FunctionSchemaSHA256            string `json:"function_schema_sha256"`
	WorkflowArtifactSchemaVersion   string `json:"workflow_artifact_schema_version"`
	WorkflowArtifactRegistryVersion string `json:"workflow_artifact_registry_version"`
	WorkflowArtifactSHA256          string `json:"workflow_artifact_sha256"`
	CombinedSHA256                  string `json:"combined_sha256"`
}

func buildToolRuntimeFingerprint(runtimeRelease string) (toolRuntimeFingerprint, error) {
	return buildToolRuntimeFingerprintWithPaths(
		runtimeRelease,
		"",
		"",
		"",
	)
}

func buildToolRuntimeFingerprintWithPaths(
	runtimeRelease string,
	toolRegistryPath string,
	toolFunctionSchemaPath string,
	workflowArtifactRegistryPath string,
) (toolRuntimeFingerprint, error) {
	toolsPath := resolveToolRegistryPathFrom(toolRegistryPath)
	if toolsPath == "" {
		return toolRuntimeFingerprint{}, fmt.Errorf("tool registry path is not configured")
	}
	toolsRegistry, err := runtimepolicy.LoadToolSpecRegistry(toolsPath)
	if err != nil {
		return toolRuntimeFingerprint{}, fmt.Errorf("load tool registry for runtime fingerprint: %w", err)
	}
	toolsHash, err := canonicalJSONFileSHA256Ref(toolsPath)
	if err != nil {
		return toolRuntimeFingerprint{}, fmt.Errorf("hash tool registry for runtime fingerprint: %w", err)
	}

	functionPath := resolveToolFunctionSchemaPathFrom(toolFunctionSchemaPath)
	if functionPath == "" {
		return toolRuntimeFingerprint{}, fmt.Errorf("tool function schema path is not configured")
	}
	functionSchemas, err := loadToolFunctionSchemaFile(functionPath)
	if err != nil {
		return toolRuntimeFingerprint{}, fmt.Errorf("load tool function schemas for runtime fingerprint: %w", err)
	}
	functionHash, err := canonicalJSONFileSHA256Ref(functionPath)
	if err != nil {
		return toolRuntimeFingerprint{}, fmt.Errorf("hash tool function schemas for runtime fingerprint: %w", err)
	}

	workflowPath := resolveWorkflowArtifactRegistryPathFrom(workflowArtifactRegistryPath)
	if workflowPath == "" {
		return toolRuntimeFingerprint{}, fmt.Errorf("workflow artifact registry path is not configured")
	}
	workflowRegistry, err := runtimepolicy.LoadWorkflowArtifactRegistry(workflowPath)
	if err != nil {
		return toolRuntimeFingerprint{}, fmt.Errorf("load workflow artifact registry for runtime fingerprint: %w", err)
	}
	workflowHash, err := canonicalJSONFileSHA256Ref(workflowPath)
	if err != nil {
		return toolRuntimeFingerprint{}, fmt.Errorf("hash workflow artifact registry for runtime fingerprint: %w", err)
	}

	fingerprint := toolRuntimeFingerprint{
		SchemaVersion:                   toolRuntimeFingerprintSchemaVersion,
		ToolsSchemaVersion:              strings.TrimSpace(toolsRegistry.SchemaVersion),
		ToolsRegistryVersion:            strings.TrimSpace(toolsRegistry.RegistryVersion),
		ToolsSHA256:                     toolsHash,
		FunctionSchemaVersion:           strings.TrimSpace(functionSchemas.SchemaVersion),
		FunctionSchemaSHA256:            functionHash,
		WorkflowArtifactSchemaVersion:   strings.TrimSpace(workflowRegistry.SchemaVersion),
		WorkflowArtifactRegistryVersion: strings.TrimSpace(workflowRegistry.RegistryVersion),
		WorkflowArtifactSHA256:          workflowHash,
	}
	fingerprint.CombinedSHA256 = sha256JSONRef(map[string]any{
		"function_schema_sha256":             fingerprint.FunctionSchemaSHA256,
		"function_schema_version":            fingerprint.FunctionSchemaVersion,
		"schema_version":                     fingerprint.SchemaVersion,
		"tools_registry_version":             fingerprint.ToolsRegistryVersion,
		"tools_schema_version":               fingerprint.ToolsSchemaVersion,
		"tools_sha256":                       fingerprint.ToolsSHA256,
		"workflow_artifact_registry_version": fingerprint.WorkflowArtifactRegistryVersion,
		"workflow_artifact_schema_version":   fingerprint.WorkflowArtifactSchemaVersion,
		"workflow_artifact_sha256":           fingerprint.WorkflowArtifactSHA256,
	})
	return fingerprint, nil
}

func (f toolRuntimeFingerprint) toMap() map[string]any {
	return map[string]any{
		"schema_version":                     f.SchemaVersion,
		"tools_schema_version":               f.ToolsSchemaVersion,
		"tools_registry_version":             f.ToolsRegistryVersion,
		"tools_sha256":                       f.ToolsSHA256,
		"function_schema_version":            f.FunctionSchemaVersion,
		"function_schema_sha256":             f.FunctionSchemaSHA256,
		"workflow_artifact_schema_version":   f.WorkflowArtifactSchemaVersion,
		"workflow_artifact_registry_version": f.WorkflowArtifactRegistryVersion,
		"workflow_artifact_sha256":           f.WorkflowArtifactSHA256,
		"combined_sha256":                    f.CombinedSHA256,
	}
}

func canonicalJSONFileSHA256Ref(path string) (string, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	var value any
	if err := json.Unmarshal(raw, &value); err != nil {
		return "", err
	}
	return sha256JSONRef(value), nil
}

func resolveToolRegistryPath() string {
	return resolveToolRegistryPathFrom("")
}

func resolveToolRegistryPathFrom(registryPath string) string {
	return resolveRuntimeConfigPath(
		registryPath,
		defaultToolRegistryRelativePath,
		packagedToolRegistryPath,
	)
}

func resolveWorkflowArtifactRegistryPath() string {
	return resolveWorkflowArtifactRegistryPathFrom("")
}

func resolveWorkflowArtifactRegistryPathFrom(registryPath string) string {
	return resolveRuntimeConfigPath(
		registryPath,
		defaultWorkflowArtifactRegistryRelativePath,
		packagedWorkflowArtifactRegistryPath,
	)
}

func resolveRuntimeConfigPath(explicitPath string, relativePath string, packagedPath string) string {
	if strings.TrimSpace(explicitPath) != "" {
		return strings.TrimSpace(explicitPath)
	}
	workingDir, err := os.Getwd()
	if err != nil {
		return ""
	}
	for dir := workingDir; ; dir = filepath.Dir(dir) {
		candidate := filepath.Join(dir, relativePath)
		if _, err := os.Stat(candidate); err == nil {
			return candidate
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			if _, err := os.Stat(packagedPath); err == nil {
				return packagedPath
			}
			return ""
		}
	}
}
