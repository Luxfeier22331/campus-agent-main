package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
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
			Async *bool                 `json:"async"`
			Items []hindsightMemoryItem `json:"items"`
		}
		if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
			t.Fatal(err)
		}
		if payload.Async == nil || *payload.Async || len(payload.Items) != 1 || payload.Items[0].UpdateMode != "replace" {
			t.Fatalf("payload = %#v", payload)
		}
		response.Header().Set("content-type", "application/json")
		_, _ = response.Write([]byte(`{"success":true,"bank_id":"bank-01","items_count":1,"async":false}`))
	}))
	defer server.Close()

	client := newHindsightHTTPClient(hindsightClientOptions{apiSecret: "hindsight-secret", baseURL: server.URL})
	result, err := client.RetainMemories(context.Background(), "bank-01", hindsightRetainRequest{
		Async: boolPtr(false),
		Items: []hindsightMemoryItem{{
			Content: "user message", DocumentID: "conversation:abc:message:def", UpdateMode: "replace",
		}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.Async || result.ItemsCount != 1 || result.BankID != "bank-01" {
		t.Fatalf("result = %#v", result)
	}
}

func TestHindsightHTTPClientTreatsMissingSourceAndBankAsDeleted(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		switch request.Method + " " + request.URL.Path {
		case "DELETE /v1/default/banks/bank-01/documents/conversation:abc:message:def":
			response.WriteHeader(http.StatusNotFound)
			_, _ = response.Write([]byte(`{"detail":"not found"}`))
		case "DELETE /v1/default/banks/bank-01":
			response.WriteHeader(http.StatusNotFound)
			_, _ = response.Write([]byte(`{"detail":"not found"}`))
		default:
			t.Fatalf("request = %s %s", request.Method, request.URL.Path)
		}
	}))
	defer server.Close()

	client := newHindsightHTTPClient(hindsightClientOptions{apiSecret: "hindsight-secret", baseURL: server.URL})
	if err := client.DeleteDocument(context.Background(), "bank-01", "conversation:abc:message:def"); err != nil {
		t.Fatalf("delete missing document: %v", err)
	}
	if err := client.DeleteBank(context.Background(), "bank-01"); err != nil {
		t.Fatalf("delete missing bank: %v", err)
	}
}
