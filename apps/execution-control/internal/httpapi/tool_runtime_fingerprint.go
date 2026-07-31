package httpapi

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/runtimepolicy"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

const toolRuntimeFingerprintSchemaVersion = "tool_runtime_fingerprint.v2"

const (
	defaultToolRegistryRelativePath       = "configs/runtime/tools.v6.json"
	defaultToolFunctionSchemaRelativePath = "configs/runtime/tool-function-schemas.v3.json"
	packagedToolRegistryPath              = "/etc/campus-agent/tools.v6.json"
)

type toolRuntimeFingerprint struct {
	SchemaVersion         string `json:"schema_version"`
	ToolsSchemaVersion    string `json:"tools_schema_version"`
	ToolsRegistryVersion  string `json:"tools_registry_version"`
	ToolsSHA256           string `json:"tools_sha256"`
	FunctionSchemaVersion string `json:"function_schema_version"`
	FunctionSchemaSHA256  string `json:"function_schema_sha256"`
	RuntimeRelease        string `json:"runtime_release"`
	CombinedSHA256        string `json:"combined_sha256"`
}

func buildToolRuntimeFingerprint(runtimeRelease string) (toolRuntimeFingerprint, error) {
	return buildToolRuntimeFingerprintWithPaths(
		runtimeRelease,
		"",
		"",
	)
}

func buildToolRuntimeFingerprintWithPaths(
	runtimeRelease string,
	toolRegistryPath string,
	toolFunctionSchemaPath string,
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

	fingerprint := toolRuntimeFingerprint{
		SchemaVersion:         toolRuntimeFingerprintSchemaVersion,
		ToolsSchemaVersion:    strings.TrimSpace(toolsRegistry.SchemaVersion),
		ToolsRegistryVersion:  strings.TrimSpace(toolsRegistry.RegistryVersion),
		ToolsSHA256:           toolsHash,
		FunctionSchemaVersion: strings.TrimSpace(functionSchemas.SchemaVersion),
		FunctionSchemaSHA256:  functionHash,
		RuntimeRelease:        normalizedToolRuntimeRelease(runtimeRelease),
	}
	fingerprint.CombinedSHA256 = sha256JSONRef(map[string]any{
		"function_schema_sha256":  fingerprint.FunctionSchemaSHA256,
		"function_schema_version": fingerprint.FunctionSchemaVersion,
		"runtime_release":         fingerprint.RuntimeRelease,
		"schema_version":          fingerprint.SchemaVersion,
		"tools_registry_version":  fingerprint.ToolsRegistryVersion,
		"tools_schema_version":    fingerprint.ToolsSchemaVersion,
		"tools_sha256":            fingerprint.ToolsSHA256,
	})
	return fingerprint, nil
}

func (f toolRuntimeFingerprint) toMap() map[string]any {
	return map[string]any{
		"schema_version":          f.SchemaVersion,
		"tools_schema_version":    f.ToolsSchemaVersion,
		"tools_registry_version":  f.ToolsRegistryVersion,
		"tools_sha256":            f.ToolsSHA256,
		"function_schema_version": f.FunctionSchemaVersion,
		"function_schema_sha256":  f.FunctionSchemaSHA256,
		"runtime_release":         f.RuntimeRelease,
		"combined_sha256":         f.CombinedSHA256,
	}
}

func (f toolRuntimeFingerprint) toAdmissionSnapshot() temporalruntime.ToolRuntimeFingerprintSnapshot {
	return temporalruntime.ToolRuntimeFingerprintSnapshot{
		CombinedSHA256:        f.CombinedSHA256,
		FunctionSchemaSHA256:  f.FunctionSchemaSHA256,
		FunctionSchemaVersion: f.FunctionSchemaVersion,
		SchemaVersion:         f.SchemaVersion,
		ToolsRegistryVersion:  f.ToolsRegistryVersion,
		ToolsSchemaVersion:    f.ToolsSchemaVersion,
		ToolsSHA256:           f.ToolsSHA256,
		RuntimeRelease:        f.RuntimeRelease,
	}
}

func normalizedToolRuntimeRelease(runtimeRelease string) string {
	if release := strings.TrimSpace(runtimeRelease); release != "" {
		return release
	}
	return "unversioned-local"
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
