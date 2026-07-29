package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
)

func TestQdrantDocumentEvidenceHealthCheckUsesCollectionsEndpoint(t *testing.T) {
	var path string
	qdrant := httptest.NewTLSServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		path = request.URL.Path
		response.Header().Set("content-type", "application/json")
		_, _ = response.Write([]byte(`{"result":{"collections":[]},"status":"ok"}`))
	}))
	defer qdrant.Close()
	caPath := writeTestCACert(t, qdrant)

	executor, err := newQdrantDocumentEvidenceExecutor(config.Config{
		QdrantQueryAPIKey:   "readonly-key",
		QdrantTLSCACertPath: caPath,
		QdrantURL:           qdrant.URL,
	}, nil, knowledgeReadModelForTest())
	if err != nil {
		t.Fatalf("new qdrant executor: %v", err)
	}

	if err := executor.HealthCheck(context.Background()); err != nil {
		t.Fatalf("qdrant health check: %v", err)
	}
	if path != "/collections" {
		t.Fatalf("health check path = %q, want /collections", path)
	}
}

func TestQdrantDocumentEvidenceHealthCheckReportsHTTPStatus(t *testing.T) {
	qdrant := httptest.NewTLSServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		http.NotFound(response, request)
	}))
	defer qdrant.Close()
	caPath := writeTestCACert(t, qdrant)

	executor, err := newQdrantDocumentEvidenceExecutor(config.Config{
		QdrantQueryAPIKey:   "readonly-key",
		QdrantTLSCACertPath: caPath,
		QdrantURL:           qdrant.URL,
	}, nil, knowledgeReadModelForTest())
	if err != nil {
		t.Fatalf("new qdrant executor: %v", err)
	}

	err = executor.HealthCheck(context.Background())
	if err == nil {
		t.Fatal("qdrant health check must fail on HTTP 404")
	}
	if !strings.Contains(err.Error(), "qdrant collections status 404") {
		t.Fatalf("error = %v, want qdrant collections status 404", err)
	}
}
