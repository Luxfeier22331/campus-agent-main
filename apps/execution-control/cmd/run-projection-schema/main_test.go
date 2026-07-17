package main

import (
	"errors"
	"testing"
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
