package httpapi

import (
	"encoding/json"
	"fmt"
	"os"
)

const toolFunctionSchemaVersion = "tool-function-schemas-v4"

const packagedToolFunctionSchemaPath = "/etc/campus-agent/tool-function-schemas.v4.json"

type toolFunctionSchemaFile struct {
	SchemaVersion string               `json:"schema_version"`
	Tools         []toolFunctionSchema `json:"tools"`
}

// Agent Runtime owns function argument validation. Execution Control only
// loads this file to fingerprint the admitted tool contract.
type toolFunctionSchema struct {
	Type       string          `json:"type"`
	Name       string          `json:"name"`
	Strict     bool            `json:"strict"`
	Parameters json.RawMessage `json:"parameters"`
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

func resolveToolFunctionSchemaPath() string {
	return resolveToolFunctionSchemaPathFrom("")
}

func resolveToolFunctionSchemaPathFrom(schemaPath string) string {
	return resolveRuntimeConfigPath(
		schemaPath,
		defaultToolFunctionSchemaRelativePath,
		packagedToolFunctionSchemaPath,
	)
}
