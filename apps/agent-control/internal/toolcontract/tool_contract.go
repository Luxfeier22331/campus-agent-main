package toolcontract

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/runtimepolicy"
)

const (
	defaultToolRegistryRelativePath       = "configs/runtime/tools.v7.json"
	defaultToolFunctionSchemaRelativePath = "configs/runtime/tool-function-schemas.v4.json"
	packagedToolRegistryPath              = "/etc/campus-agent/tools.v7.json"
	packagedToolFunctionSchemaPath        = "/etc/campus-agent/tool-function-schemas.v4.json"
	toolFunctionSchemaVersion             = "tool-function-schemas-v4"
)

type toolFunctionSchemaFile struct {
	SchemaVersion string               `json:"schema_version"`
	Tools         []toolFunctionSchema `json:"tools"`
}

type toolFunctionSchema struct {
	Type       string          `json:"type"`
	Name       string          `json:"name"`
	Strict     bool            `json:"strict"`
	Parameters json.RawMessage `json:"parameters"`
}

func buildToolContractFingerprint(
	toolRegistryPath string,
	toolFunctionSchemaPath string,
) (execution.ToolContractFingerprintSnapshot, error) {
	toolsPath := resolveRuntimeConfigPath(
		toolRegistryPath,
		defaultToolRegistryRelativePath,
		packagedToolRegistryPath,
	)
	if toolsPath == "" {
		return execution.ToolContractFingerprintSnapshot{}, errors.New("tool registry path is not configured")
	}
	if _, err := runtimepolicy.LoadToolSpecRegistry(toolsPath); err != nil {
		return execution.ToolContractFingerprintSnapshot{}, fmt.Errorf("load tool registry for contract fingerprint: %w", err)
	}
	toolsHash, err := canonicalJSONFileSHA256Ref(toolsPath)
	if err != nil {
		return execution.ToolContractFingerprintSnapshot{}, fmt.Errorf("hash tool registry for contract fingerprint: %w", err)
	}

	functionPath := resolveRuntimeConfigPath(
		toolFunctionSchemaPath,
		defaultToolFunctionSchemaRelativePath,
		packagedToolFunctionSchemaPath,
	)
	if functionPath == "" {
		return execution.ToolContractFingerprintSnapshot{}, errors.New("tool function schema path is not configured")
	}
	if _, err := loadToolFunctionSchemaFile(functionPath); err != nil {
		return execution.ToolContractFingerprintSnapshot{}, fmt.Errorf("load tool function schemas for contract fingerprint: %w", err)
	}
	functionHash, err := canonicalJSONFileSHA256Ref(functionPath)
	if err != nil {
		return execution.ToolContractFingerprintSnapshot{}, fmt.Errorf("hash tool function schemas for contract fingerprint: %w", err)
	}

	return execution.ToolContractFingerprintSnapshot{
		SchemaVersion:        execution.ToolContractFingerprintSchemaVersion,
		ToolsSHA256:          toolsHash,
		FunctionSchemaSHA256: functionHash,
	}, nil
}

func loadToolFunctionSchemaFile(path string) (toolFunctionSchemaFile, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return toolFunctionSchemaFile{}, fmt.Errorf("read tool function schemas: %w", err)
	}
	var file toolFunctionSchemaFile
	if err := json.Unmarshal(raw, &file); err != nil {
		return toolFunctionSchemaFile{}, fmt.Errorf("parse tool function schemas: %w", err)
	}
	if file.SchemaVersion != toolFunctionSchemaVersion {
		return toolFunctionSchemaFile{}, fmt.Errorf("tool function schema_version = %q", file.SchemaVersion)
	}
	if len(file.Tools) == 0 {
		return toolFunctionSchemaFile{}, fmt.Errorf("tool function schemas tools must not be empty")
	}
	return file, nil
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
	return execution.SHA256JSONRef(value), nil
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

type Files struct{ RegistryPath, FunctionSchemaPath string }

func (f Files) Fingerprint() (execution.ToolContractFingerprintSnapshot, error) {
	return buildToolContractFingerprint(f.RegistryPath, f.FunctionSchemaPath)
}
