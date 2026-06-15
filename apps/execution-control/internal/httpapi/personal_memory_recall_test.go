package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/memoryruntime"
)

func TestQdrantPersonalMemoryRecallFiltersByActorStatusAndCapability(t *testing.T) {
	var captured map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/collections/personal_memory_v1/points/query" {
			t.Fatalf("qdrant path = %q, want personal memory collection query", request.URL.Path)
		}
		if request.Header.Get("api-key") != "readonly-key" {
			t.Fatalf("api-key = %q, want read-only query key", request.Header.Get("api-key"))
		}
		if err := json.NewDecoder(request.Body).Decode(&captured); err != nil {
			t.Fatalf("decode query body: %v", err)
		}
		response.Header().Set("content-type", "application/json")
		_, _ = response.Write([]byte(`{"result":{"points":[
			{"id":"mem-1","score":0.91,"payload":{"memory_id":"mem-1","user_id":"user_01","tenant_id":"tenant-muc","memory_type":"preference","capability":"knowledge","status":"active","source":"explicit","compact_text":"用户优先关注保研和培养方案。","updated_at":"2026-06-01T00:00:00Z"}},
			{"id":"mem-2","score":0.81,"payload":{"memory_id":"mem-2","user_id":"user_01","tenant_id":"tenant-muc","memory_type":"goal","capability":"any","status":"active","source":"inferred","compact_text":"用户正在准备推免材料，需要优先看官方规则和学院通知。","updated_at":"2026-06-02T00:00:00Z"}},
			{"id":"mem-3","score":0.71,"payload":{"memory_id":"mem-3","user_id":"user_01","tenant_id":"tenant-muc","memory_type":"profile","capability":"knowledge","status":"active","source":"explicit","compact_text":"这一条会因为字符预算被截断。","updated_at":"2026-06-03T00:00:00Z"}}
		]},"status":"ok"}`))
	}))
	defer server.Close()

	embedding := newStaticEmbeddingServer(t)
	executor := qdrantPersonalMemoryExecutor{
		configResolver:      memoryEmbeddingResolverForTest(embedding.URL, "embedding-model", 3),
		httpClient:          server.Client(),
		qdrantQueryAPIKey:   "readonly-key",
		qdrantURL:           server.URL,
		collection:          "personal_memory_v1",
		defaultTopK:         5,
		defaultMaxChars:     48,
		embeddingHTTPClient: embedding.Client(),
		timeout:             time.Second,
	}

	result, err := executor.Recall(context.Background(), memoryruntime.RecallRequest{
		RequestedCapability: "knowledge",
		RunID:               "run-memory-001",
		TenantID:            "tenant-muc",
		UserGoal:            "我该怎么看保研政策？",
		UserID:              "user_01",
	})
	if err != nil {
		t.Fatalf("recall memory: %v", err)
	}
	if result.SelectedMemoryCount != 2 {
		t.Fatalf("selected memory count = %d, want 2", result.SelectedMemoryCount)
	}
	if result.SelectedMemoryChars > 48 {
		t.Fatalf("selected chars = %d, want <= 48", result.SelectedMemoryChars)
	}
	if result.Items[0].MemoryID != "mem-1" || result.Items[1].MemoryID != "mem-2" {
		t.Fatalf("memory items = %#v", result.Items)
	}
	if result.MemoryRef != "projection://runs/run-memory-001/memory/recall" {
		t.Fatalf("memory ref = %q", result.MemoryRef)
	}

	if captured["limit"] != float64(5) {
		t.Fatalf("limit = %#v, want 5", captured["limit"])
	}
	must := qdrantMustConditionsForTest(t, captured)
	assertQdrantMatchConditionForTest(t, must, "user_id", "user_01")
	assertQdrantMatchConditionForTest(t, must, "status", "active")
	filter := captured["filter"].(map[string]any)
	should, ok := filter["should"].([]any)
	if !ok || len(should) != 2 {
		t.Fatalf("filter.should = %#v, want capability or any", filter["should"])
	}
	serialized, _ := json.Marshal(should)
	if !strings.Contains(string(serialized), "knowledge") || !strings.Contains(string(serialized), "any") {
		t.Fatalf("filter.should = %s, want requested capability and any", serialized)
	}
}

func TestQdrantPersonalMemoryEmbeddingUsesActiveProviderSnapshot(t *testing.T) {
	var captured map[string]any
	var authorization string
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		authorization = request.Header.Get("authorization")
		if err := json.NewDecoder(request.Body).Decode(&captured); err != nil {
			t.Fatalf("decode embedding body: %v", err)
		}
		response.Header().Set("content-type", "application/json")
		_, _ = response.Write([]byte(`{"data":[{"embedding":[0.1,0.2,0.3]}]}`))
	}))
	defer server.Close()
	executor := qdrantPersonalMemoryExecutor{
		configResolver: staticProviderConfigResolver{
			"personal_memory_embedding": {
				APIKey:     "snapshot-memory-embedding-key",
				BaseURL:    server.URL,
				Dimensions: 3,
				Model:      "snapshot-memory-embedding-model",
				ProfileID:  "provider_profile_memory_embedding",
				Provider:   "openai-compatible",
				Revision:   5,
				Role:       "personal_memory_embedding",
				TimeoutMS:  30000,
				Transport:  "embeddings",
			},
		},
		embeddingHTTPClient: server.Client(),
		embeddingRole:       providerConfigRolePersonalMemoryEmbedding,
		timeout:             time.Second,
	}

	embedding, err := executor.embedMemoryText(context.Background(), "用户偏好官方来源")
	if err != nil {
		t.Fatalf("embed memory text: %v", err)
	}
	if len(embedding) != 3 {
		t.Fatalf("embedding dim = %d, want snapshot dim 3", len(embedding))
	}
	if authorization != "Bearer snapshot-memory-embedding-key" {
		t.Fatalf("authorization = %q, want snapshot key", authorization)
	}
	if captured["model"] != "snapshot-memory-embedding-model" ||
		captured["dimensions"] != float64(3) {
		t.Fatalf("embedding request = %#v", captured)
	}
}

func TestQdrantPersonalMemoryEmbeddingFailsClosedWithoutProviderResolver(t *testing.T) {
	executor := qdrantPersonalMemoryExecutor{
		embeddingHTTPClient: http.DefaultClient,
		timeout:             time.Second,
	}

	_, err := executor.embedMemoryText(context.Background(), "用户偏好官方来源")
	if err == nil {
		t.Fatal("online personal memory embedding must require active provider config resolver")
	}
	if !strings.Contains(err.Error(), "provider config resolver is not configured") {
		t.Fatalf("error = %v, want provider resolver diagnostic", err)
	}
}

func TestQdrantPersonalMemoryHealthCheckRequiresCollection(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/readyz":
			_, _ = response.Write([]byte("all shards are ready"))
		case "/collections/personal_memory_v1":
			http.Error(response, "collection not found", http.StatusNotFound)
		default:
			t.Fatalf("unexpected qdrant path = %q", request.URL.Path)
		}
	}))
	defer server.Close()

	executor := qdrantPersonalMemoryExecutor{
		collection:        "personal_memory_v1",
		httpClient:        server.Client(),
		qdrantQueryAPIKey: "readonly-key",
		qdrantURL:         server.URL,
	}

	err := executor.HealthCheck(context.Background())
	if err == nil {
		t.Fatal("health check must fail when personal memory collection is missing")
	}
	if !strings.Contains(err.Error(), "personal memory collection is missing") {
		t.Fatalf("health check error = %v, want collection missing diagnostic", err)
	}
}

func TestQdrantPersonalMemoryEnsureSchemaCreatesMissingCollection(t *testing.T) {
	var createBody map[string]any
	collectionExists := false
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		switch {
		case request.URL.Path == "/readyz":
			_, _ = response.Write([]byte("all shards are ready"))
		case request.URL.Path == "/collections/personal_memory_v1" && request.Method == http.MethodGet:
			if request.Header.Get("api-key") != "readonly-key" {
				t.Fatalf("query api-key = %q, want readonly-key", request.Header.Get("api-key"))
			}
			if !collectionExists {
				http.Error(response, "collection not found", http.StatusNotFound)
				return
			}
			_, _ = response.Write([]byte(`{"result":{"status":"green","config":{"params":{"vectors":{"dense":{"size":2560,"distance":"Cosine"}}}}},"status":"ok"}`))
		case request.URL.Path == "/collections/personal_memory_v1" && request.Method == http.MethodPut:
			if request.Header.Get("api-key") != "write-key" {
				t.Fatalf("write api-key = %q, want write-key", request.Header.Get("api-key"))
			}
			if err := json.NewDecoder(request.Body).Decode(&createBody); err != nil {
				t.Fatalf("decode create collection body: %v", err)
			}
			collectionExists = true
			_, _ = response.Write([]byte(`{"result":true,"status":"ok"}`))
		default:
			t.Fatalf("unexpected qdrant request %s %s", request.Method, request.URL.Path)
		}
	}))
	defer server.Close()

	executor := qdrantPersonalMemoryExecutor{
		configResolver:    memoryEmbeddingResolverForTest("https://provider.example/v1", "embedding-model", 2560),
		collection:        "personal_memory_v1",
		httpClient:        server.Client(),
		qdrantQueryAPIKey: "readonly-key",
		qdrantURL:         server.URL,
		qdrantWriteAPIKey: "write-key",
	}

	if err := executor.EnsureSchema(context.Background()); err != nil {
		t.Fatalf("ensure schema: %v", err)
	}
	vectors, ok := createBody["vectors"].(map[string]any)
	if !ok {
		t.Fatalf("vectors = %#v, want object", createBody["vectors"])
	}
	dense, ok := vectors["dense"].(map[string]any)
	if !ok {
		t.Fatalf("dense vector = %#v, want named dense vector", vectors["dense"])
	}
	if dense["size"] != float64(2560) || dense["distance"] != "Cosine" {
		t.Fatalf("dense config = %#v, want size 2560 cosine", dense)
	}
	if err := executor.HealthCheck(context.Background()); err != nil {
		t.Fatalf("health check after ensure: %v", err)
	}
}

func TestQdrantPersonalMemoryHealthCheckRequiresDenseVectorSchema(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/readyz":
			_, _ = response.Write([]byte("all shards are ready"))
		case "/collections/personal_memory_v1":
			_, _ = response.Write([]byte(`{"result":{"status":"green","config":{"params":{"vectors":{"dense":{"size":1536,"distance":"Cosine"}}}}},"status":"ok"}`))
		default:
			t.Fatalf("unexpected qdrant path = %q", request.URL.Path)
		}
	}))
	defer server.Close()

	executor := qdrantPersonalMemoryExecutor{
		configResolver:    memoryEmbeddingResolverForTest("https://provider.example/v1", "embedding-model", 2560),
		collection:        "personal_memory_v1",
		httpClient:        server.Client(),
		qdrantQueryAPIKey: "readonly-key",
		qdrantURL:         server.URL,
	}

	err := executor.HealthCheck(context.Background())
	if err == nil {
		t.Fatal("health check must fail when personal memory dense vector schema does not match embeddings")
	}
	if !strings.Contains(err.Error(), "dense vector size = 1536, want 2560") {
		t.Fatalf("health check error = %v, want dense vector size diagnostic", err)
	}
}

func TestQdrantPersonalMemoryUpsertUsesWriteKeyAndNamedDenseVector(t *testing.T) {
	var captured map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/collections/personal_memory_v1/points" {
			t.Fatalf("qdrant path = %q, want personal memory collection upsert", request.URL.Path)
		}
		if request.URL.Query().Get("wait") != "true" {
			t.Fatalf("wait = %q, want true", request.URL.Query().Get("wait"))
		}
		if request.Method != http.MethodPut {
			t.Fatalf("method = %s, want PUT", request.Method)
		}
		if request.Header.Get("api-key") != "write-key" {
			t.Fatalf("api-key = %q, want write key", request.Header.Get("api-key"))
		}
		if err := json.NewDecoder(request.Body).Decode(&captured); err != nil {
			t.Fatalf("decode upsert body: %v", err)
		}
		response.Header().Set("content-type", "application/json")
		_, _ = response.Write([]byte(`{"result":{"operation_id":7,"status":"completed"},"status":"ok"}`))
	}))
	defer server.Close()

	embedding := newStaticEmbeddingServer(t)
	executor := qdrantPersonalMemoryExecutor{
		configResolver:      memoryEmbeddingResolverForTest(embedding.URL, "embedding-model", 3),
		httpClient:          server.Client(),
		qdrantQueryAPIKey:   "readonly-key",
		qdrantWriteAPIKey:   "write-key",
		qdrantURL:           server.URL,
		collection:          "personal_memory_v1",
		embeddingHTTPClient: embedding.Client(),
		timeout:             time.Second,
	}

	result, err := executor.Upsert(context.Background(), memoryruntime.UpsertRequest{
		Capability:  "any",
		CompactText: "answer_style: 先给结论",
		MemoryID:    "mem_01HQ",
		MemoryType:  "profile",
		Source:      "explicit",
		Status:      "active",
		TenantID:    "",
		UpdatedAt:   "2026-06-10T08:00:00.000Z",
		UserID:      "user_01HQ",
	})
	if err != nil {
		t.Fatalf("upsert memory: %v", err)
	}
	if result.MemoryID != "mem_01HQ" || result.Status != "active" {
		t.Fatalf("result = %#v", result)
	}

	points, ok := captured["points"].([]any)
	if !ok || len(points) != 1 {
		t.Fatalf("points = %#v, want one point", captured["points"])
	}
	point, ok := points[0].(map[string]any)
	if !ok {
		t.Fatalf("point = %#v, want object", points[0])
	}
	vector, ok := point["vector"].(map[string]any)
	if !ok {
		t.Fatalf("vector = %#v, want named vector object", point["vector"])
	}
	dense, ok := vector["dense"].([]any)
	if !ok || len(dense) != 3 {
		t.Fatalf("dense vector = %#v, want embedding vector", vector["dense"])
	}
	payload, ok := point["payload"].(map[string]any)
	if !ok {
		t.Fatalf("payload = %#v, want object", point["payload"])
	}
	for key, want := range map[string]string{
		"memory_id":    "mem_01HQ",
		"user_id":      "user_01HQ",
		"memory_type":  "profile",
		"capability":   "any",
		"status":       "active",
		"source":       "explicit",
		"compact_text": "answer_style: 先给结论",
		"updated_at":   "2026-06-10T08:00:00.000Z",
	} {
		if got := optionalStringFromAny(payload[key]); got != want {
			t.Fatalf("payload[%s] = %q, want %q", key, got, want)
		}
	}
}

func TestQdrantPersonalMemoryDisableUsesWriteKeyAndPointID(t *testing.T) {
	var captured map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/collections/personal_memory_v1/points/payload" {
			t.Fatalf("qdrant path = %q, want personal memory payload update", request.URL.Path)
		}
		if request.Method != http.MethodPost {
			t.Fatalf("method = %s, want POST", request.Method)
		}
		if request.Header.Get("api-key") != "write-key" {
			t.Fatalf("api-key = %q, want write key", request.Header.Get("api-key"))
		}
		if err := json.NewDecoder(request.Body).Decode(&captured); err != nil {
			t.Fatalf("decode disable body: %v", err)
		}
		response.Header().Set("content-type", "application/json")
		_, _ = response.Write([]byte(`{"result":{"operation_id":8,"status":"completed"},"status":"ok"}`))
	}))
	defer server.Close()

	executor := qdrantPersonalMemoryExecutor{
		httpClient:        server.Client(),
		qdrantWriteAPIKey: "write-key",
		qdrantURL:         server.URL,
		collection:        "personal_memory_v1",
		timeout:           time.Second,
	}

	result, err := executor.Disable(context.Background(), memoryruntime.DisableRequest{
		MemoryID:  "mem_01HQ",
		UpdatedAt: "2026-06-10T09:00:00.000Z",
		UserID:    "user_01HQ",
	})
	if err != nil {
		t.Fatalf("disable memory: %v", err)
	}
	if result.Status != "disabled" {
		t.Fatalf("status = %q, want disabled", result.Status)
	}
	payload, ok := captured["payload"].(map[string]any)
	if !ok {
		t.Fatalf("payload = %#v, want object", captured["payload"])
	}
	if payload["status"] != "disabled" || payload["updated_at"] != "2026-06-10T09:00:00.000Z" {
		t.Fatalf("payload = %#v, want disabled status update", payload)
	}
	points, ok := captured["points"].([]any)
	if !ok || len(points) != 1 || optionalStringFromAny(points[0]) == "" {
		t.Fatalf("points = %#v, want stable point id", captured["points"])
	}
}

func TestQdrantPersonalMemoryDisableOwnerUsesWriteKeyAndPayloadFilter(t *testing.T) {
	var captured map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/collections/personal_memory_v1/points/payload" {
			t.Fatalf("qdrant path = %q, want personal memory payload update", request.URL.Path)
		}
		if request.Method != http.MethodPost {
			t.Fatalf("method = %s, want POST", request.Method)
		}
		if request.Header.Get("api-key") != "write-key" {
			t.Fatalf("api-key = %q, want write key", request.Header.Get("api-key"))
		}
		if err := json.NewDecoder(request.Body).Decode(&captured); err != nil {
			t.Fatalf("decode owner disable body: %v", err)
		}
		response.Header().Set("content-type", "application/json")
		_, _ = response.Write([]byte(`{"result":{"operation_id":9,"status":"completed"},"status":"ok"}`))
	}))
	defer server.Close()

	executor := qdrantPersonalMemoryExecutor{
		httpClient:        server.Client(),
		qdrantWriteAPIKey: "write-key",
		qdrantURL:         server.URL,
		collection:        "personal_memory_v1",
		timeout:           time.Second,
	}

	result, err := executor.DisableOwner(context.Background(), memoryruntime.DisableOwnerRequest{
		TenantID:  "tenant-muc",
		UpdatedAt: "2026-06-10T10:00:00.000Z",
		UserID:    "user_01HQ",
	})
	if err != nil {
		t.Fatalf("disable owner memory: %v", err)
	}
	if result.Status != "disabled" || result.UserID != "user_01HQ" {
		t.Fatalf("result = %#v", result)
	}
	payload, ok := captured["payload"].(map[string]any)
	if !ok {
		t.Fatalf("payload = %#v, want object", captured["payload"])
	}
	if payload["status"] != "disabled" || payload["updated_at"] != "2026-06-10T10:00:00.000Z" {
		t.Fatalf("payload = %#v, want disabled status update", payload)
	}
	if _, hasPoints := captured["points"]; hasPoints {
		t.Fatalf("owner disable must use a payload filter, not explicit points: %#v", captured)
	}
	must := qdrantMustConditionsForTest(t, captured)
	assertQdrantMatchConditionForTest(t, must, "user_id", "user_01HQ")
	assertQdrantMatchConditionForTest(t, must, "tenant_id", "tenant-muc")
	assertQdrantMatchConditionForTest(t, must, "status", "active")
}

func TestPersonalMemoryUpsertEndpointRequiresInternalAuth(t *testing.T) {
	server := NewServer(config.Config{WorkerSharedSecret: "shared-secret"})
	server.personalMemoryExecutor = &fakePersonalMemoryExecutor{}
	server.personalMemoryErr = nil

	request := httptest.NewRequestWithContext(
		context.Background(),
		http.MethodPost,
		"/internal/memory/personal/items:upsert",
		bytes.NewReader([]byte(`{"memory_id":"mem_01HQ","user_id":"user_01HQ","memory_type":"profile","capability":"any","status":"active","source":"explicit","compact_text":"answer_style: 先给结论","updated_at":"2026-06-10T08:00:00Z"}`)),
	)
	response := httptest.NewRecorder()

	server.ServeHTTP(response, request)

	if response.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", response.Code)
	}
}

func TestPersonalMemoryUpsertEndpointIndexesViaExecutor(t *testing.T) {
	executor := &fakePersonalMemoryExecutor{}
	server := NewServer(config.Config{WorkerSharedSecret: "shared-secret"})
	server.personalMemoryExecutor = executor
	server.personalMemoryErr = nil

	request := httptest.NewRequestWithContext(
		context.Background(),
		http.MethodPost,
		"/internal/memory/personal/items:upsert",
		bytes.NewReader([]byte(`{"memory_id":"mem_01HQ","user_id":"user_01HQ","memory_type":"profile","capability":"any","status":"active","source":"explicit","compact_text":"answer_style: 先给结论","updated_at":"2026-06-10T08:00:00Z"}`)),
	)
	request.Header.Set("x-worker-origin-auth", "shared-secret")
	response := httptest.NewRecorder()

	server.ServeHTTP(response, request)

	if response.Code != http.StatusAccepted {
		t.Fatalf("status = %d body = %s, want 202", response.Code, response.Body.String())
	}
	if executor.seenUpsert.MemoryID != "mem_01HQ" ||
		executor.seenUpsert.UserID != "user_01HQ" ||
		executor.seenUpsert.CompactText != "answer_style: 先给结论" {
		t.Fatalf("seen upsert = %#v", executor.seenUpsert)
	}
	var payload map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload["schema_version"] != "personal_memory_upsert_result_v1" ||
		payload["status"] != "active" {
		t.Fatalf("response payload = %#v", payload)
	}
}

func TestPersonalMemoryDisableEndpointDisablesViaExecutor(t *testing.T) {
	executor := &fakePersonalMemoryExecutor{}
	server := NewServer(config.Config{WorkerSharedSecret: "shared-secret"})
	server.personalMemoryExecutor = executor
	server.personalMemoryErr = nil

	request := httptest.NewRequestWithContext(
		context.Background(),
		http.MethodPost,
		"/internal/memory/personal/items:disable",
		bytes.NewReader([]byte(`{"memory_id":"mem_01HQ","user_id":"user_01HQ","updated_at":"2026-06-10T09:00:00Z"}`)),
	)
	request.Header.Set("x-worker-origin-auth", "shared-secret")
	response := httptest.NewRecorder()

	server.ServeHTTP(response, request)

	if response.Code != http.StatusAccepted {
		t.Fatalf("status = %d body = %s, want 202", response.Code, response.Body.String())
	}
	if executor.seenDisable.MemoryID != "mem_01HQ" ||
		executor.seenDisable.UserID != "user_01HQ" {
		t.Fatalf("seen disable = %#v", executor.seenDisable)
	}
}

func TestPersonalMemoryOwnerDisableEndpointDisablesViaExecutor(t *testing.T) {
	executor := &fakePersonalMemoryExecutor{}
	server := NewServer(config.Config{WorkerSharedSecret: "shared-secret"})
	server.personalMemoryExecutor = executor
	server.personalMemoryErr = nil

	request := httptest.NewRequestWithContext(
		context.Background(),
		http.MethodPost,
		"/internal/memory/personal/owner:disable",
		bytes.NewReader([]byte(`{"user_id":"user_01HQ","tenant_id":"tenant-muc","updated_at":"2026-06-10T10:00:00Z"}`)),
	)
	request.Header.Set("x-worker-origin-auth", "shared-secret")
	response := httptest.NewRecorder()

	server.ServeHTTP(response, request)

	if response.Code != http.StatusAccepted {
		t.Fatalf("status = %d body = %s, want 202", response.Code, response.Body.String())
	}
	if executor.seenDisableOwner.UserID != "user_01HQ" ||
		executor.seenDisableOwner.TenantID != "tenant-muc" {
		t.Fatalf("seen owner disable = %#v", executor.seenDisableOwner)
	}
	var payload map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload["schema_version"] != "personal_memory_owner_disable_result_v1" ||
		payload["status"] != "disabled" ||
		payload["user_id"] != "user_01HQ" {
		t.Fatalf("response payload = %#v", payload)
	}
}

func newStaticEmbeddingServer(t *testing.T) *httptest.Server {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/embeddings" {
			t.Fatalf("embedding path = %q, want /embeddings", request.URL.Path)
		}
		response.Header().Set("content-type", "application/json")
		_, _ = response.Write([]byte(`{"data":[{"embedding":[0.1,0.2,0.3]}]}`))
	}))
	t.Cleanup(server.Close)
	return server
}

func memoryEmbeddingResolverForTest(
	baseURL string,
	model string,
	dimensions int,
) providerConfigResolver {
	return staticProviderConfigResolver{
		"personal_memory_embedding": embeddingProviderConfigSnapshotForTest(
			providerConfigRolePersonalMemoryEmbedding,
			baseURL,
			model,
			dimensions,
		),
	}
}
