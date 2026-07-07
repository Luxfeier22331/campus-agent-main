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

	_, err = parseOptions([]string{"--evidence-path", "runtime.json"})
	if !errors.Is(err, errInvalidOptions) {
		t.Fatalf("parse missing mode error = %v, want errInvalidOptions", err)
	}

	_, err = parseOptions([]string{
		"--mode", "check",
		"--evidence-path", "runtime.json",
		"--timeout-seconds", "0",
	})
	if !errors.Is(err, errInvalidOptions) {
		t.Fatalf("parse zero timeout error = %v, want errInvalidOptions", err)
	}
}

func TestParseOptionsRejectsUnknownMode(t *testing.T) {
	_, err := parseOptions([]string{
		"--mode", "repair",
		"--evidence-path", "runtime.json",
	})
	if !errors.Is(err, errInvalidOptions) {
		t.Fatalf("parse unknown mode error = %v, want errInvalidOptions", err)
	}
}

func TestWriteRuntimeReport(t *testing.T) {
	path := filepath.Join(t.TempDir(), "runtime.json")
	report := runtimeReport{
		GeneratedAt:  "2026-06-15T00:00:00Z",
		Mode:         "check",
		Passed:       true,
		RuntimeReady: true,
		Store:        "hindsight",
	}
	if err := writeRuntimeReport(path, report); err != nil {
		t.Fatalf("write runtime report: %v", err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read runtime report: %v", err)
	}
	var decoded runtimeReport
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("decode runtime report: %v", err)
	}
	if decoded != report {
		t.Fatalf("runtime report = %#v, want %#v", decoded, report)
	}
}
