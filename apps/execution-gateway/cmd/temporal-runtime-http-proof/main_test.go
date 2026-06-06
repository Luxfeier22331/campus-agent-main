package main

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestParseOptionsRequiresSupervisorURLSharedSecretAndEvidencePath(t *testing.T) {
	_, err := parseOptions([]string{
		"--supervisor-url", "http://127.0.0.1:27051",
		"--shared-secret", "secret",
	})
	if !errors.Is(err, errInvalidOptions) {
		t.Fatalf("parse missing evidence path error = %v, want errInvalidOptions", err)
	}

	_, err = parseOptions([]string{
		"--supervisor-url", "http://127.0.0.1:27051",
		"--evidence-path", "proof.json",
	})
	if !errors.Is(err, errInvalidOptions) {
		t.Fatalf("parse missing shared secret error = %v, want errInvalidOptions", err)
	}

	_, err = parseOptions([]string{
		"--shared-secret", "secret",
		"--evidence-path", "proof.json",
	})
	if !errors.Is(err, errInvalidOptions) {
		t.Fatalf("parse missing supervisor url error = %v, want errInvalidOptions", err)
	}
}

func TestHTTPProofRejectsDurableReadyzWithoutStartedWorkerLoop(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.Header.Get("x-worker-origin-auth") != "secret" {
			t.Fatalf("missing worker origin auth header")
		}
		response.Header().Set("content-type", "application/json")
		_, _ = response.Write([]byte(`{
			"status":"ready",
			"durable_runtime":{"configured":true,"healthy":true},
			"durable_worker_loop":{"enabled":true,"configured":true,"healthy":true,"started":false},
			"durable_recovery_loop":{"enabled":true,"configured":true,"healthy":true,"started":true}
		}`))
	}))
	defer server.Close()

	_, err := runProof(t.Context(), proofOptions{
		EvidencePath:  filepath.Join(t.TempDir(), "http-proof.json"),
		Now:           time.Date(2026, 6, 4, 23, 0, 0, 0, time.UTC),
		SharedSecret:  "secret",
		SupervisorURL: server.URL,
	})
	if !errors.Is(err, errDurableReadyzBlocked) {
		t.Fatalf("runProof error = %v, want errDurableReadyzBlocked", err)
	}
}

func TestHTTPProofWritesReadyzEvidenceForDurableRuntime(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/readyz" {
			t.Fatalf("path = %s, want /readyz", request.URL.Path)
		}
		if request.Header.Get("x-worker-origin-auth") != "secret" {
			t.Fatalf("missing worker origin auth header")
		}
		response.Header().Set("content-type", "application/json")
		_, _ = response.Write([]byte(`{
			"status":"ready",
			"durable_runtime":{"configured":true,"healthy":true},
			"durable_worker_loop":{"enabled":true,"configured":true,"healthy":true,"started":true,"worker_id":"worker-a"},
			"durable_recovery_loop":{"enabled":true,"configured":true,"healthy":true,"started":true}
		}`))
	}))
	defer server.Close()

	evidencePath := filepath.Join(t.TempDir(), "http-proof.json")
	report, err := runProof(t.Context(), proofOptions{
		EvidencePath:  evidencePath,
		Now:           time.Date(2026, 6, 4, 23, 1, 0, 0, time.UTC),
		SharedSecret:  "secret",
		SupervisorURL: server.URL,
	})
	if err != nil {
		t.Fatalf("runProof: %v", err)
	}
	if !report.Passed || report.Readyz.Status != "ready" || report.Readyz.DurableWorkerLoop.WorkerID != "worker-a" {
		t.Fatalf("report = %#v, want durable ready evidence", report)
	}
	if _, err := os.Stat(evidencePath); err != nil {
		t.Fatalf("stat evidence: %v", err)
	}
}
