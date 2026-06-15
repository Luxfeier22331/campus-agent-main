package main

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestParseOptionsRequiresModeEvidencePathAndPositiveTimeout(t *testing.T) {
	_, err := parseOptions([]string{"--mode", "check"})
	if !errors.Is(err, errInvalidOptions) {
		t.Fatalf("parse missing evidence path error = %v, want errInvalidOptions", err)
	}

	_, err = parseOptions([]string{"--evidence-path", "schema.json"})
	if !errors.Is(err, errInvalidOptions) {
		t.Fatalf("parse missing mode error = %v, want errInvalidOptions", err)
	}

	_, err = parseOptions([]string{
		"--mode", "check",
		"--evidence-path", "schema.json",
		"--timeout-seconds", "0",
	})
	if !errors.Is(err, errInvalidOptions) {
		t.Fatalf("parse zero timeout error = %v, want errInvalidOptions", err)
	}
}

func TestParseOptionsRejectsUnknownMode(t *testing.T) {
	_, err := parseOptions([]string{
		"--mode", "repair",
		"--evidence-path", "schema.json",
	})
	if !errors.Is(err, errInvalidOptions) {
		t.Fatalf("parse unknown mode error = %v, want errInvalidOptions", err)
	}
}

func TestWriteSchemaReport(t *testing.T) {
	path := filepath.Join(t.TempDir(), "schema.json")
	report := schemaReport{
		Collection:  "personal_memory_v1",
		GeneratedAt: "2026-06-15T00:00:00Z",
		Mode:        "check",
		Passed:      true,
		SchemaReady: true,
		Store:       "qdrant",
	}
	if err := writeSchemaReport(path, report); err != nil {
		t.Fatalf("write schema report: %v", err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read schema report: %v", err)
	}
	var decoded schemaReport
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("decode schema report: %v", err)
	}
	if decoded != report {
		t.Fatalf("schema report = %#v, want %#v", decoded, report)
	}
}
