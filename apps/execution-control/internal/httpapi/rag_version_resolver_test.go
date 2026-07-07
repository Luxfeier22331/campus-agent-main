package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/ragruntime"
)

func TestQdrantMetadataVersionResolverUsesCollectionMetadataRecords(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		response.Header().Set("content-type", "application/json")
		if request.URL.Path != "/collections/student_rules" {
			t.Fatalf("qdrant path = %q, want collection metadata", request.URL.Path)
		}
		metadata := releaseMetadataFixtureForHTTPTest(
			mustRetrievalServingConfigForTest(t, "regulations", "student_rules"),
			"student_rules",
		)
		metadata["version_records"] = []map[string]any{
			{
				"collection":     "student_rules",
				"corpus":         "regulations",
				"effective_from": "2024-09-01T00:00:00Z",
				"effective_to":   "2025-08-31T23:59:59Z",
				"version_id":     "student_rules:v2024",
				"visibility":     "public",
			},
			{
				"collection":     "student_rules",
				"corpus":         "regulations",
				"effective_from": "2025-09-01T00:00:00Z",
				"is_current":     true,
				"version_id":     "student_rules:v2025",
				"visibility":     "public",
			},
		}
		body, err := json.Marshal(map[string]any{
			"result": map[string]any{"payload": metadata},
			"status": "ok",
		})
		if err != nil {
			t.Fatalf("marshal metadata fixture: %v", err)
		}
		_, _ = response.Write(body)
	}))
	defer server.Close()
	resolver := qdrantMetadataVersionResolver{
		httpClient:        server.Client(),
		qdrantQueryAPIKey: "test-qdrant-key",
		qdrantURL:         server.URL,
	}

	resolved, err := resolver.ResolveRAGVersionQuery(context.Background(), ragruntime.PlanProjection{
		Collection:      "student_rules",
		CollectionAlias: "student_rules",
		Corpus:          "regulations",
		QueryMode:       "as_of",
		VersionQuery: &ragruntime.VersionQueryProjection{
			Mode: "as_of",
			AsOf: "2025-09-10T00:00:00Z",
		},
	})
	if err != nil {
		t.Fatalf("resolve qdrant metadata version query: %v", err)
	}
	if resolved.Mode != "as_of" || resolved.VersionID != "student_rules:v2025" {
		t.Fatalf("resolved = %#v, want as_of student_rules:v2025", resolved)
	}
}

func TestQdrantMetadataVersionResolverAllowsCurrentWithoutRegistry(t *testing.T) {
	resolved, err := qdrantMetadataVersionResolver{}.ResolveRAGVersionQuery(
		context.Background(),
		ragruntime.PlanProjection{
			Collection:      "student_rules",
			CollectionAlias: "student_rules",
			Corpus:          "regulations",
			QueryMode:       "current",
		},
	)
	if err != nil {
		t.Fatalf("resolve current without registry: %v", err)
	}
	if resolved.Mode != "current" || resolved.VersionID != "" || len(resolved.TargetVersionIDs) != 0 {
		t.Fatalf("resolved current = %#v, want unbound current mode", resolved)
	}
}

func TestNewQdrantMetadataVersionResolverReportsTLSConfigurationErrors(t *testing.T) {
	resolver := newQdrantMetadataVersionResolver(config.Config{
		QdrantQueryAPIKey:    "readonly-key",
		QdrantTLSCACertPath:  "/path/does/not/exist.pem",
		QdrantTimeoutSeconds: 10,
		QdrantURL:            "https://qdrant.example.edu",
	})
	_, err := resolver.ResolveRAGVersionQuery(context.Background(), ragruntime.PlanProjection{
		Collection:      "student_rules",
		CollectionAlias: "student_rules",
		Corpus:          "regulations",
		QueryMode:       "historical",
		VersionQuery: &ragruntime.VersionQueryProjection{
			Mode:      "historical",
			VersionID: "student_rules:v2025",
		},
	})
	if err == nil {
		t.Fatal("misconfigured qdrant version resolver must fail with configuration diagnostic")
	}
	if !strings.Contains(err.Error(), "QDRANT_TLS_CA_CERT_PATH") {
		t.Fatalf("error = %v, want TLS CA diagnostic", err)
	}
}
