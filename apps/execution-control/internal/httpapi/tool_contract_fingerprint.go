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

const toolContractFingerprintSchemaVersion = "tool_contract_fingerprint.v1"

const (
	defaultToolRegistryRelativePath       = "configs/runtime/tools.v6.json"
	defaultToolFunctionSchemaRelativePath = "configs/runtime/tool-function-schemas.v3.json"
	packagedToolRegistryPath              = "/etc/campus-agent/tools.v6.json"
)

type toolContractFingerprint struct {
	SchemaVersion        string `json:"schema_version"`
	ToolsSHA256          string `json:"tools_sha256"`
	FunctionSchemaSHA256 string `json:"function_schema_sha256"`
}

func buildToolContractFingerprint() (toolContractFingerprint, error) {
	return buildToolContractFingerprintWithPaths("", "")
}

func buildToolContractFingerprintWithPaths(
	toolRegistryPath string,
	toolFunctionSchemaPath string,
) (toolContractFingerprint, error) {
	toolsPath := resolveToolRegistryPathFrom(toolRegistryPath)
	if toolsPath == "" {
		return toolContractFingerprint{}, fmt.Errorf("tool registry path is not configured")
	}
	_, err := runtimepolicy.LoadToolSpecRegistry(toolsPath)
	if err != nil {
		return toolContractFingerprint{}, fmt.Errorf("load tool registry for contract fingerprint: %w", err)
	}
	toolsHash, err := canonicalJSONFileSHA256Ref(toolsPath)
	if err != nil {
		return toolContractFingerprint{}, fmt.Errorf("hash tool registry for contract fingerprint: %w", err)
	}

	functionPath := resolveToolFunctionSchemaPathFrom(toolFunctionSchemaPath)
	if functionPath == "" {
		return toolContractFingerprint{}, fmt.Errorf("tool function schema path is not configured")
	}
	_, err = loadToolFunctionSchemaFile(functionPath)
	if err != nil {
		return toolContractFingerprint{}, fmt.Errorf("load tool function schemas for contract fingerprint: %w", err)
	}
	functionHash, err := canonicalJSONFileSHA256Ref(functionPath)
	if err != nil {
		return toolContractFingerprint{}, fmt.Errorf("hash tool function schemas for contract fingerprint: %w", err)
	}

	return toolContractFingerprint{
		SchemaVersion:        toolContractFingerprintSchemaVersion,
		ToolsSHA256:          toolsHash,
		FunctionSchemaSHA256: functionHash,
	}, nil
}

func (f toolContractFingerprint) toMap() map[string]any {
	return map[string]any{
		"schema_version":         f.SchemaVersion,
		"tools_sha256":           f.ToolsSHA256,
		"function_schema_sha256": f.FunctionSchemaSHA256,
	}
}

func (f toolContractFingerprint) toAdmissionSnapshot() temporalruntime.ToolContractFingerprintSnapshot {
	return temporalruntime.ToolContractFingerprintSnapshot{
		FunctionSchemaSHA256: f.FunctionSchemaSHA256,
		SchemaVersion:        f.SchemaVersion,
		ToolsSHA256:          f.ToolsSHA256,
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
