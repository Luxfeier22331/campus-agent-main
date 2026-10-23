package hindsightadapter

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

func TestHindsightHTTPClientDoesNotFollowRedirects(t *testing.T) {
	for _, testCase := range []struct {
		name     string
		location func(targetURL string) string
	}{
		{
			name: "same origin",
			location: func(_ string) string {
				return "/redirect-target"
			},
		},
		{
			name: "cross origin",
			location: func(targetURL string) string {
				return targetURL
			},
		},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			var targetRequests atomic.Int32
			target := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
				targetRequests.Add(1)
				response.WriteHeader(http.StatusOK)
			}))
			defer target.Close()

			source := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
				if request.URL.Path == "/redirect-target" {
					targetRequests.Add(1)
					response.WriteHeader(http.StatusOK)
					return
				}
				response.Header().Set("location", testCase.location(target.URL))
				response.WriteHeader(http.StatusTemporaryRedirect)
			}))
			defer source.Close()

			client := newHindsightHTTPClient(hindsightClientOptions{
				apiSecret: "hindsight-secret",
				baseURL:   source.URL,
			})
			if _, err := client.BankExists(context.Background(), "bank-01"); err == nil {
				t.Fatal("hindsight bank lookup succeeded through redirect")
			}
			if got := targetRequests.Load(); got != 0 {
				t.Fatalf("redirect target received %d requests, want 0", got)
			}
		})
	}
}

func TestHindsightHTTPClientSendsSynchronousReplaceRetain(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodPost || request.URL.Path != "/v1/default/banks/bank-01/memories" {
			t.Fatalf("request = %s %s", request.Method, request.URL.Path)
		}
		if request.Header.Get("Authorization") != "Bearer hindsight-secret" {
			t.Fatalf("authorization = %q", request.Header.Get("Authorization"))
		}
		var payload struct {
			Async *bool            `json:"async"`
			Items []map[string]any `json:"items"`
		}
		if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
			t.Fatal(err)
		}
		if payload.Async == nil || *payload.Async || len(payload.Items) != 1 {
			t.Fatalf("payload = %#v", payload)
		}
		item := payload.Items[0]
		if item["content"] != "user message" || item["update_mode"] != "replace" || item["document_id"] != "conversation:abc:message:def" {
			t.Errorf("item = %#v", item)
		}
		if _, ok := item["resolve_entities"]; ok {
			t.Errorf("retain unexpectedly sets resolve_entities: %#v", item)
		}
		response.Header().Set("content-type", "application/json")
		_, _ = response.Write([]byte(`{"success":true,"bank_id":"bank-01","items_count":1,"async":false}`))
	}))
	defer server.Close()

	client := newHindsightHTTPClient(hindsightClientOptions{apiSecret: "hindsight-secret", baseURL: server.URL})
	result, err := client.RetainMemories(context.Background(), "bank-01", hindsightRetainRequest{
		Async: boolPtr(false),
		Items: []hindsightMemoryItem{{
			Content: " user message ", DocumentID: "conversation:abc:message:def", UpdateMode: "replace",
		}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.Async || result.ItemsCount != 1 || result.BankID != "bank-01" {
		t.Fatalf("result = %#v", result)
	}
}

func TestHindsightHTTPClientClassifiesRetainRejectionsWithoutTreatingAmbiguousResponsesAsTerminal(t *testing.T) {
	for _, testCase := range []struct {
		status     int
		definitive bool
	}{
		{status: http.StatusBadRequest, definitive: true},
		{status: http.StatusUnprocessableEntity, definitive: true},
		{status: http.StatusRequestTimeout},
		{status: http.StatusConflict},
		{status: http.StatusTooManyRequests},
		{status: http.StatusInternalServerError},
	} {
		t.Run(http.StatusText(testCase.status), func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
				response.Header().Set("content-type", "application/json")
				response.WriteHeader(testCase.status)
				_, _ = response.Write([]byte(`{"detail":"retain rejected"}`))
			}))
			defer server.Close()
			client := newHindsightHTTPClient(hindsightClientOptions{apiSecret: "test", baseURL: server.URL})
			_, err := client.RetainMemories(context.Background(), "bank-01", hindsightRetainRequest{
				Async: boolPtr(true), OperationID: "4b5ef551-97f0-5d6b-9670-f839ad8cff4a",
				Items: []hindsightMemoryItem{{Content: "memory", DocumentID: "memory:one"}},
			})
			if err == nil || errors.Is(err, ErrHindsightRetainRejected) != testCase.definitive {
				t.Fatalf("retain error = %v, definitive = %t", err, testCase.definitive)
			}
		})
	}
}

func TestHindsightHTTPClientBankExists(t *testing.T) {
	for _, status := range []int{http.StatusOK, http.StatusNotFound, http.StatusUnauthorized, http.StatusForbidden, http.StatusGone, http.StatusInternalServerError} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
				if request.Method != http.MethodGet || request.URL.Path != "/v1/default/banks/bank-01/profile" {
					t.Errorf("request = %s %s", request.Method, request.URL.Path)
				}
				if request.Header.Get("Authorization") != "Bearer hindsight-secret" {
					t.Errorf("authorization = %q", request.Header.Get("Authorization"))
				}
				response.Header().Set("content-type", "application/json")
				response.WriteHeader(status)
				if status == http.StatusOK {
					_, _ = response.Write([]byte(`{"bank_id":"bank-01","name":"test","disposition":{"skepticism":3,"literalism":3,"empathy":3},"mission":"","background":""}`))
				} else {
					_, _ = response.Write([]byte(`{"detail":"lookup failed"}`))
				}
			}))
			defer server.Close()

			client := newHindsightHTTPClient(hindsightClientOptions{apiSecret: "hindsight-secret", baseURL: server.URL})
			exists, err := client.BankExists(context.Background(), " bank-01 ")
			wantError := status != http.StatusOK && status != http.StatusNotFound
			if exists != (status == http.StatusOK) || (err != nil) != wantError {
				t.Fatalf("BankExists = (%t, %v), status = %d", exists, err, status)
			}
		})
	}
}

func TestHindsightHTTPClientTreatsMissingBankAsDeleted(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		switch request.Method + " " + request.URL.Path {
		case "DELETE /v1/default/banks/bank-01":
			response.WriteHeader(http.StatusNotFound)
			_, _ = response.Write([]byte(`{"detail":"not found"}`))
		default:
			t.Fatalf("request = %s %s", request.Method, request.URL.Path)
		}
	}))
	defer server.Close()

	client := newHindsightHTTPClient(hindsightClientOptions{apiSecret: "hindsight-secret", baseURL: server.URL})
	if err := client.DeleteBank(context.Background(), "bank-01"); err != nil {
		t.Fatalf("delete missing bank: %v", err)
	}
}

func TestBankCreationSendsAndVerifiesRetainMission(t *testing.T) {
	for _, omitMission := range []bool{false, true} {
		t.Run(fmt.Sprint(omitMission), func(t *testing.T) {
			var updates map[string]any
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				if r.Method == http.MethodPut && strings.HasSuffix(r.URL.Path, "/bank") {
					_ = json.NewEncoder(w).Encode(map[string]any{"bank_id": "bank", "name": "campus-agent personal memory", "mission": "", "disposition": map[string]any{"skepticism": 3, "literalism": 3, "empathy": 3}})
					return
				}
				if r.Method == http.MethodPatch {
					var body struct {
						Updates map[string]any `json:"updates"`
					}
					_ = json.NewDecoder(r.Body).Decode(&body)
					updates = body.Updates
					if updates["retain_mission"] != defaultHindsightBankConfig().RetainMission {
						t.Error("mission missing from wire")
					}
				}
				config := map[string]any{}
				for k, v := range updates {
					config[k] = v
				}
				if omitMission {
					delete(config, "retain_mission")
				}
				_ = json.NewEncoder(w).Encode(map[string]any{"bank_id": "bank", "config": config, "overrides": config})
			}))
			defer server.Close()
			client := newHindsightHTTPClient(hindsightClientOptions{baseURL: server.URL, apiSecret: "test"})
			err := client.EnsureBank(context.Background(), "bank", defaultHindsightBankConfig())
			if (err != nil) != omitMission {
				t.Fatalf("error=%v omitMission=%v", err, omitMission)
			}
		})
	}
}
