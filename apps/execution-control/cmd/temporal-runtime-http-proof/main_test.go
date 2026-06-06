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

func TestParseOptionsRequiresExecutionControlURLSharedSecretAndEvidencePath(t *testing.T) {
	_, err := parseOptions([]string{
		"--execution-control-url", "http://127.0.0.1:27051",
		"--shared-secret", "secret",
	})
	if !errors.Is(err, errInvalidOptions) {
		t.Fatalf("parse missing evidence path error = %v, want errInvalidOptions", err)
	}

	_, err = parseOptions([]string{
		"--execution-control-url", "http://127.0.0.1:27051",
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

func TestHTTPProofRejectsReadyzWithoutTemporalWorkers(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.Header.Get("x-worker-origin-auth") != "secret" {
			t.Fatalf("missing worker origin auth header")
		}
		response.Header().Set("content-type", "application/json")
		_, _ = response.Write([]byte(`{
			"status":"ready",
			"durable_runtime":{"configured":true,"healthy":true},
			"temporal_runtime":{"configured":true,"healthy":false,"workers":{"started":false}}
		}`))
	}))
	defer server.Close()

	_, err := runProof(t.Context(), proofOptions{
		EvidencePath:  filepath.Join(t.TempDir(), "http-proof.json"),
		Now:           time.Date(2026, 6, 4, 23, 0, 0, 0, time.UTC),
		SharedSecret:  "secret",
		GatewayURL:    server.URL,
	})
	if !errors.Is(err, errTemporalReadyzBlocked) {
		t.Fatalf("runProof error = %v, want errTemporalReadyzBlocked", err)
	}
}

func TestHTTPProofWritesReadyzEvidenceForTemporalRuntime(t *testing.T) {
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
			"temporal_runtime":{
				"configured":true,
				"healthy":true,
				"namespace":"campus-agent-staging",
				"task_queue":"campus-agent.workflow",
				"worker_id":"staging:execution-control:001",
				"workers":{"started":true}
			}
		}`))
	}))
	defer server.Close()

	evidencePath := filepath.Join(t.TempDir(), "http-proof.json")
	report, err := runProof(t.Context(), proofOptions{
		EvidencePath:  evidencePath,
		Now:           time.Date(2026, 6, 4, 23, 1, 0, 0, time.UTC),
		SharedSecret:  "secret",
		GatewayURL:    server.URL,
	})
	if err != nil {
		t.Fatalf("runProof: %v", err)
	}
	if !report.Passed ||
		report.Readyz.Status != "ready" ||
		report.Readyz.TemporalRuntime.WorkerID != "staging:execution-control:001" {
		t.Fatalf("report = %#v, want Temporal ready evidence", report)
	}
	if _, err := os.Stat(evidencePath); err != nil {
		t.Fatalf("stat evidence: %v", err)
	}
}
