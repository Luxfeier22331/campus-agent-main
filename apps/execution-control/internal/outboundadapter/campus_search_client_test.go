package outboundadapter

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/campus-search/campussearch"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionapplication"
)

func TestCampusSearchHTTPClientDecodesInternalResponse(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/internal/v1/search" || r.Header.Get("authorization") != "Bearer secret" {
			t.Fatalf("unexpected request: %s %s", r.Method, r.URL.Path)
		}
		w.Header().Set("content-type", "application/json")
		_, _ = w.Write([]byte(`{"collection":"campus_docs_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef","outcome":"matched","results":[{"citation_href":"/notices/n","citation_index":1,"notice_id":"n","result_ref":"result://0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef","section_title":"正文","source_kind":"notice","text":"内容","title":"标题"}],"diagnostics":{"effectiveQuery":"通知","rerankQuery":"条件","citationStart":1,"resultLimit":5,"retrievalMode":"hybrid_rrf","durations":{"embedding":4},"retrievedCount":2,"deduplicatedCount":1,"returnedCount":1,"excludedCount":1,"candidates":[{"resultRef":"result://0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef","sourceKind":"notice","title":"标题","section":"正文","returned":true,"citationIndex":1}],"retrieval":{"collection":"campus_docs_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"}}}`))
	}))
	defer server.Close()
	client, err := NewCampusSearchHTTPClient(server.URL, "secret", 0)
	if err != nil {
		t.Fatal(err)
	}
	response, err := client.Search(context.Background(), executionapplication.CampusSearchClientRequest{RetrievalQuery: "通知", ResultLimit: 5})
	if err != nil {
		t.Fatal(err)
	}
	if response.Collection == "" || len(response.Results) != 1 || response.Results[0].NoticeID != "n" {
		t.Fatalf("unexpected response: %#v", response)
	}
	if response.Diagnostics == nil || response.Diagnostics.EffectiveQuery != "通知" || response.Diagnostics.RerankQuery != "条件" || response.Diagnostics.RetrievedCount != 2 || response.Diagnostics.DeduplicatedCount != 1 || response.Diagnostics.Retrieval == nil || response.Diagnostics.Retrieval.Collection != response.Collection {
		t.Fatalf("diagnostics projection lost fields: %#v", response.Diagnostics)
	}
	if len(response.Diagnostics.Candidates) != 1 || response.Diagnostics.Candidates[0].CitationIndex == nil || *response.Diagnostics.Candidates[0].CitationIndex != 1 {
		t.Fatalf("diagnostic candidate projection lost fields: %#v", response.Diagnostics.Candidates)
	}
}

func TestCampusSearchHTTPClientRejectsServiceError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "unavailable", http.StatusServiceUnavailable)
	}))
	defer server.Close()
	client, err := NewCampusSearchHTTPClient(strings.TrimSpace(server.URL), "secret", 0)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := client.Search(context.Background(), executionapplication.CampusSearchClientRequest{RetrievalQuery: "通知"}); err == nil {
		t.Fatal("expected service error")
	}
}

func TestCampusSearchHTTPClientPreservesFailureDiagnosticsAndIdentity(t *testing.T) {
	for _, test := range []struct {
		stage, code string
		status      int
		identity    error
	}{
		{"embedding", "campus_search_failed", http.StatusServiceUnavailable, nil},
		{"retrieval", "campus_search_failed", http.StatusServiceUnavailable, nil},
		{"rerank", "campus_search_timeout", http.StatusGatewayTimeout, context.DeadlineExceeded},
		{"index", "campus_search_unavailable", http.StatusServiceUnavailable, executionapplication.ErrCampusSearchUnavailable},
	} {
		t.Run(test.stage, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(test.status)
				_ = json.NewEncoder(w).Encode(campussearch.SearchErrorResponse{
					Error:       campussearch.SearchErrorDetail{Code: test.code, Message: "Campus Search failed."},
					Diagnostics: &campussearch.Snapshot{FailedStage: test.stage, FailureDetail: "provider detail", Durations: map[string]int64{"embedding": 12}, Candidates: []campussearch.Candidate{{ResultRef: "result://candidate"}}},
				})
			}))
			defer server.Close()
			client, err := NewCampusSearchHTTPClient(server.URL, "secret", 0)
			if err != nil {
				t.Fatal(err)
			}
			_, err = client.Search(t.Context(), executionapplication.CampusSearchClientRequest{RetrievalQuery: "通知"})
			var failure *executionapplication.CampusSearchClientError
			if !errors.As(err, &failure) || failure.Diagnostics == nil || failure.Diagnostics.FailedStage != test.stage || failure.Diagnostics.FailureDetail != "provider detail" || failure.Diagnostics.Durations["embedding"] != 12 || len(failure.Diagnostics.Candidates) != 1 {
				t.Fatalf("lost upstream diagnostic error: %#v, %v", failure, err)
			}
			if test.identity != nil && !errors.Is(err, test.identity) {
				t.Fatalf("error identity lost: %v", err)
			}
		})
	}
}
