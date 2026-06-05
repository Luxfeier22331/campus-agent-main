package main

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestParseOptionsRequiresModeDatabaseURLAndEvidencePath(t *testing.T) {
	_, err := parseOptions([]string{
		"--mode", "check",
		"--database-url", "postgres://example",
	})
	if !errors.Is(err, errInvalidOptions) {
		t.Fatalf("parse missing evidence path error = %v, want errInvalidOptions", err)
	}

	_, err = parseOptions([]string{
		"--mode", "check",
		"--evidence-path", "schema.json",
	})
	if !errors.Is(err, errInvalidOptions) {
		t.Fatalf("parse missing database url error = %v, want errInvalidOptions", err)
	}

	_, err = parseOptions([]string{
		"--database-url", "postgres://example",
		"--evidence-path", "schema.json",
	})
	if !errors.Is(err, errInvalidOptions) {
		t.Fatalf("parse missing mode error = %v, want errInvalidOptions", err)
	}
}

func TestParseOptionsRejectsUnknownMode(t *testing.T) {
	_, err := parseOptions([]string{
		"--mode", "repair",
		"--database-url", "postgres://example",
		"--evidence-path", "schema.json",
	})
	if !errors.Is(err, errInvalidOptions) {
		t.Fatalf("parse unknown mode error = %v, want errInvalidOptions", err)
	}
}

func TestDurableRuntimeSchemaInstallAndCheckWriteEvidence(t *testing.T) {
	databaseURL := os.Getenv("SUPERVISOR_API_DURABLE_RUNTIME_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("SUPERVISOR_API_DURABLE_RUNTIME_TEST_DATABASE_URL is not configured")
	}

	installPath := filepath.Join(t.TempDir(), "install.json")
	installReport, err := runSchemaCommand(t.Context(), schemaOptions{
		DatabaseURL:  databaseURL,
		EvidencePath: installPath,
		Mode:         "install",
		Now:          time.Date(2026, 6, 5, 10, 0, 0, 0, time.UTC),
	})
	if err != nil {
		t.Fatalf("install schema: %v", err)
	}
	if !installReport.Passed || installReport.Mode != "install" || !installReport.SchemaReady {
		t.Fatalf("install report = %#v, want passed install schema-ready", installReport)
	}
	assertEvidenceReport(t, installPath, "install")

	checkPath := filepath.Join(t.TempDir(), "check.json")
	checkReport, err := runSchemaCommand(t.Context(), schemaOptions{
		DatabaseURL:  databaseURL,
		EvidencePath: checkPath,
		Mode:         "check",
		Now:          time.Date(2026, 6, 5, 10, 1, 0, 0, time.UTC),
	})
	if err != nil {
		t.Fatalf("check schema: %v", err)
	}
	if !checkReport.Passed || checkReport.Mode != "check" || !checkReport.SchemaReady {
		t.Fatalf("check report = %#v, want passed check schema-ready", checkReport)
	}
	assertEvidenceReport(t, checkPath, "check")
}

func assertEvidenceReport(t *testing.T, path string, mode string) {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read evidence %s: %v", path, err)
	}
	var report schemaReport
	if err := json.Unmarshal(data, &report); err != nil {
		t.Fatalf("decode evidence %s: %v", path, err)
	}
	if report.Mode != mode || !report.Passed || report.Store != "postgres" || !report.SchemaReady {
		t.Fatalf("evidence report = %#v, want mode=%s passed postgres schema-ready", report, mode)
	}
}
