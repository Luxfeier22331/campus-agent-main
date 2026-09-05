//go:build postgres_integration

package httpapi

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/model-config/internal/modelconfig"
	"github.com/jackc/pgx/v5"
	"github.com/testcontainers/testcontainers-go"
	tcpostgres "github.com/testcontainers/testcontainers-go/modules/postgres"
)

const postgresHTTPIntegrationImage = "postgres:17-alpine@sha256:742f40ea20b9ff2ff31db5458d127452988a2164df9e17441e191f3b72252193"

func TestPostgresHTTPPutPersistsEmbeddingAndReranker(t *testing.T) {
	ctx := t.Context()
	container, err := tcpostgres.Run(ctx, postgresHTTPIntegrationImage, tcpostgres.WithDatabase("postgres"), tcpostgres.WithUsername("postgres"), tcpostgres.WithPassword("postgres-integration-admin"), tcpostgres.BasicWaitStrategies())
	testcontainers.CleanupContainer(t, container)
	if err != nil {
		t.Fatalf("start PostgreSQL: %v", err)
	}
	adminURL, err := container.ConnectionString(ctx, "sslmode=disable")
	if err != nil {
		t.Fatal(err)
	}
	admin := connectHTTPIntegrationPostgres(t, adminURL)
	defer admin.Close(ctx)
	for _, statement := range []string{
		"create role campus_agent login password 'campus-agent-password'",
		"create role model_config login password 'model-config-password'",
		"create role app_api nologin",
		"create role execution_control nologin",
		"create role ops_web nologin",
	} {
		if _, err := admin.Exec(ctx, statement); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := admin.Exec(ctx, "create database model_config_http owner campus_agent"); err != nil {
		t.Fatal(err)
	}

	ownerURL := httpIntegrationDatabaseURL(adminURL, "model_config_http", "campus_agent", "campus-agent-password")
	runtimeURL := httpIntegrationDatabaseURL(adminURL, "model_config_http", "model_config", "model-config-password")
	keyPath := writeHTTPIntegrationKey(t, "01234567890123456789012345678901")
	installUnifiedSchema(t, ctx, ownerURL)
	cipher, err := modelconfig.LoadCipher(keyPath)
	if err != nil {
		t.Fatal(err)
	}
	store, err := modelconfig.NewStore(ctx, runtimeURL, cipher)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		wantAuthorization := map[string]string{
			"/v1/embeddings": "Bearer embedding-secret",
			"/v1/rerank":     "Bearer reranker-secret",
			"/v1/responses":  "Bearer notice-secret",
		}[r.URL.Path]
		if r.Header.Get("Authorization") != wantAuthorization {
			t.Errorf("provider authorization for %s was not the configured key", r.URL.Path)
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		switch r.URL.Path {
		case "/v1/embeddings":
			var body struct {
				Model      string   `json:"model"`
				Input      []string `json:"input"`
				Dimensions int      `json:"dimensions"`
			}
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Errorf("decode embedding request: %v", err)
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			if body.Model != "Qwen3-Embedding-4B" || !reflect.DeepEqual(body.Input, []string{"model-config validation"}) || body.Dimensions != 2560 {
				t.Errorf("embedding request = %#v", body)
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"data": []any{map[string]any{"embedding": make([]float64, 2560)}}})
		case "/v1/rerank":
			var body struct {
				Documents []string `json:"documents"`
				Model     string   `json:"model"`
				Query     string   `json:"query"`
			}
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Errorf("decode reranker request: %v", err)
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			if body.Model != "rerank-v4" || body.Query != "model-config validation" || !reflect.DeepEqual(body.Documents, []string{"model-config validation document"}) {
				t.Errorf("reranker request = %#v", body)
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"results": []any{map[string]any{"index": 0, "relevance_score": 0.9}}})
		case "/v1/responses":
			var body struct {
				Model string `json:"model"`
			}
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Errorf("decode notice classification request: %v", err)
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			if body.Model == "candidate-model" {
				w.WriteHeader(http.StatusUnprocessableEntity)
				_, _ = fmt.Fprint(w, `{"error":"candidate rejected"}`)
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]string{"output_text": `{"category":"campus_operations"}`})
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer provider.Close()

	server := httptest.NewServer(New(store))
	defer server.Close()
	client := server.Client()

	tests := []struct {
		name     string
		config   modelconfig.ConfigName
		provider string
		protocol string
		model    string
		key      string
	}{
		{name: "embedding", config: modelconfig.ConfigCampusDocsEmbedding, provider: "openai-compatible", protocol: "openai.embeddings", model: "Qwen3-Embedding-4B", key: "embedding-secret"},
		{name: "reranker", config: modelconfig.ConfigCampusDocsReranker, provider: "cohere-compatible", protocol: "cohere.rerank", model: "rerank-v4", key: "reranker-secret"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			body, err := json.Marshal(modelconfig.ConfigInput{
				APIKey:      stringPointer(test.key),
				Provider:    test.provider,
				APIProtocol: test.protocol,
				BaseURL:     provider.URL + "/v1",
				Model:       test.model,
			})
			if err != nil {
				t.Fatal(err)
			}
			request, err := http.NewRequestWithContext(ctx, http.MethodPut, server.URL+"/internal/admin/model-configs/"+string(test.config), bytes.NewReader(body))
			if err != nil {
				t.Fatal(err)
			}
			request.Header.Set("Content-Type", "application/json")
			request.Header.Set("X-Model-Config-Actor", "integration-test")
			response, err := client.Do(request)
			if err != nil {
				t.Fatal(err)
			}
			defer response.Body.Close()
			if response.StatusCode != http.StatusOK {
				t.Fatalf("PUT status = %d", response.StatusCode)
			}

			resolved, err := store.Resolve(ctx, test.config, "")
			if err != nil {
				t.Fatal(err)
			}
			if resolved.APIKey != test.key || resolved.Provider != test.provider || resolved.APIProtocol != test.protocol || resolved.Model != test.model || resolved.BaseURL != provider.URL+"/v1" {
				t.Fatalf("resolved target = %#v", resolved.Target)
			}

			getResponse, err := client.Get(server.URL + "/internal/model-configs/" + string(test.config))
			if err != nil {
				t.Fatal(err)
			}
			defer getResponse.Body.Close()
			if getResponse.StatusCode != http.StatusOK {
				t.Fatalf("GET status = %d", getResponse.StatusCode)
			}
			var runtime modelconfig.RuntimeConfig
			if err := json.NewDecoder(getResponse.Body).Decode(&runtime); err != nil {
				t.Fatal(err)
			}
			if runtime.APIKey != test.key || runtime.TargetSHA256 == "" {
				t.Fatalf("runtime response did not contain persisted config")
			}
		})
	}

	t.Run("failed candidate validation leaves the current database view unchanged", func(t *testing.T) {
		put := func(model string, includeAPIKey bool) *http.Response {
			t.Helper()
			input := map[string]any{
				"provider":     "openai-compatible",
				"api_protocol": "openai.responses",
				"base_url":     provider.URL + "/v1",
				"model":        model,
			}
			if includeAPIKey {
				input["api_key"] = "notice-secret"
			}
			body, err := json.Marshal(input)
			if err != nil {
				t.Fatal(err)
			}
			request, err := http.NewRequestWithContext(ctx, http.MethodPut, server.URL+"/internal/admin/model-configs/"+string(modelconfig.ConfigNoticeClassification), bytes.NewReader(body))
			if err != nil {
				t.Fatal(err)
			}
			request.Header.Set("Content-Type", "application/json")
			request.Header.Set("X-Model-Config-Actor", "integration-test")
			response, err := client.Do(request)
			if err != nil {
				t.Fatal(err)
			}
			return response
		}

		initial := put("current-model", true)
		if initial.StatusCode != http.StatusOK {
			initial.Body.Close()
			t.Fatalf("initial PUT status = %d", initial.StatusCode)
		}
		initial.Body.Close()

		beforeStatus, err := store.Status(ctx)
		if err != nil {
			t.Fatal(err)
		}
		before := beforeStatus.Configs[modelconfig.ConfigNoticeClassification]
		if before == nil {
			t.Fatal("initial notice classification view is missing")
		}

		candidate := put("candidate-model", false)
		defer candidate.Body.Close()
		if candidate.StatusCode != http.StatusUnprocessableEntity {
			t.Fatalf("candidate PUT status = %d", candidate.StatusCode)
		}

		afterStatus, err := store.Status(ctx)
		if err != nil {
			t.Fatal(err)
		}
		after := afterStatus.Configs[modelconfig.ConfigNoticeClassification]
		if after == nil {
			t.Fatal("current notice classification view is missing after candidate validation")
		}
		if !reflect.DeepEqual(*after, *before) {
			t.Fatalf("candidate validation changed current config: before=%#v after=%#v", *before, *after)
		}
	})
}

func installUnifiedSchema(t *testing.T, ctx context.Context, databaseURL string) {
	t.Helper()
	parsed, err := url.Parse(databaseURL)
	if err != nil {
		t.Fatalf("parse schema database URL: %v", err)
	}
	password, ok := parsed.User.Password()
	if !ok {
		t.Fatal("schema database URL is missing a password")
	}
	_, source, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("resolve integration test source path")
	}
	repositoryRoot := filepath.Clean(filepath.Join(filepath.Dir(source), "..", "..", "..", ".."))
	command := exec.CommandContext(ctx, "pnpm", "--dir", "jobs/campus-agent-schema", "migrate")
	command.Dir = repositoryRoot
	command.Env = append(os.Environ(),
		"PGHOST="+parsed.Hostname(),
		"PGPORT="+parsed.Port(),
		"PGDATABASE="+strings.TrimPrefix(parsed.Path, "/"),
		"PGUSER="+parsed.User.Username(),
		"PGPASSWORD="+password,
		"PGSSLMODE=disable",
	)
	if output, err := command.CombinedOutput(); err != nil {
		t.Fatalf("install unified schema: %v\n%s", err, output)
	}
}

func connectHTTPIntegrationPostgres(t *testing.T, databaseURL string) *pgx.Conn {
	t.Helper()
	ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
	defer cancel()
	conn, err := pgx.Connect(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	return conn
}

func httpIntegrationDatabaseURL(baseURL, database, user, password string) string {
	parsed, err := url.Parse(baseURL)
	if err != nil {
		panic(fmt.Sprintf("parse database URL: %v", err))
	}
	parsed.Path = "/" + database
	parsed.User = url.UserPassword(user, password)
	return parsed.String()
}

func writeHTTPIntegrationKey(t *testing.T, key string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "encryption.key")
	if err := os.WriteFile(path, []byte(base64.StdEncoding.EncodeToString([]byte(key))+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

func stringPointer(value string) *string {
	return &value
}
