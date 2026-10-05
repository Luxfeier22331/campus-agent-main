package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/campus-search/campussearch"
	"github.com/MUC-WIKI/campus-agent/apps/campus-search/internal/service"
)

type testIndexStore struct {
	found bool
}

func (s testIndexStore) CurrentIndex(context.Context) (campussearch.Index, bool, error) {
	return campussearch.Index{Collection: "campus_docs_" + "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"}, s.found, nil
}

type testSearcher struct {
	query        campussearch.SearchQuery
	results      []campussearch.SearchResultItem
	err          error
	failureStage string
}

type blockingSearcher struct {
	started chan struct{}
}

func (s blockingSearcher) Search(ctx context.Context, _ campussearch.Index, _ campussearch.SearchQuery, _ int) ([]campussearch.SearchResultItem, error) {
	close(s.started)
	<-ctx.Done()
	return nil, ctx.Err()
}

func (s *testSearcher) Search(ctx context.Context, _ campussearch.Index, query campussearch.SearchQuery, _ int) ([]campussearch.SearchResultItem, error) {
	s.query = query
	if s.err != nil {
		snapshot := campussearch.SearchObservation(ctx).Snapshot
		snapshot.FailedStage = s.failureStage
		snapshot.Durations["embedding"] = 12
		snapshot.Candidates = []campussearch.Candidate{{ResultRef: "result://candidate", Text: "internal candidate"}}
		return nil, s.err
	}
	if s.results != nil {
		return s.results, nil
	}
	return []campussearch.SearchResultItem{{SourceKind: "notice", NoticeID: "n", Title: "标题", SectionTitle: "正文", CitationHref: "/notices/n", Text: "内容", ResultRef: "result://0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"}}, nil
}

func TestPublicSearchRequiresMCPClientTokenAndOmitsInternalFields(t *testing.T) {
	handler := New(service.New(testIndexStore{found: true}, &testSearcher{}), "internal", map[string]string{"astrbot": "mcp-client-token"}).Handler()
	request := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/v1/search", strings.NewReader(`{"query":"通知"}`))
	request.Header.Set("authorization", "Bearer mcp-client-token")
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	if strings.Contains(recorder.Body.String(), "result_ref") || strings.Contains(recorder.Body.String(), "citation_index") || strings.Contains(recorder.Body.String(), "phaseTimes") {
		t.Fatalf("public response leaked internal fields: %s", recorder.Body.String())
	}
}

func TestInternalSearchRequiresInternalToken(t *testing.T) {
	handler := New(service.New(testIndexStore{found: true}, &testSearcher{}), "internal", nil).Handler()
	request := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/internal/v1/search", strings.NewReader(`{"query":"通知"}`))
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", recorder.Code)
	}
}

func TestSearchCredentialsAreScopedToTheirEndpoints(t *testing.T) {
	for _, test := range []struct {
		name   string
		path   string
		token  string
		status int
	}{
		{"public accepts MCP", "/v1/search", "mcp-client-token", http.StatusOK},
		{"public rejects internal", "/v1/search", "internal", http.StatusUnauthorized},
		{"public requires token", "/v1/search", "", http.StatusUnauthorized},
		{"internal accepts internal", "/internal/v1/search", "internal", http.StatusOK},
		{"internal rejects MCP", "/internal/v1/search", "mcp-client-token", http.StatusUnauthorized},
	} {
		t.Run(test.name, func(t *testing.T) {
			handler := New(service.New(testIndexStore{found: true}, &testSearcher{}), "internal", map[string]string{"astrbot": "mcp-client-token"}).Handler()
			request := httptest.NewRequestWithContext(context.Background(), http.MethodPost, test.path, strings.NewReader(`{"query":"通知"}`))
			if test.token != "" {
				request.Header.Set("authorization", "Bearer "+test.token)
			}
			recorder := httptest.NewRecorder()
			handler.ServeHTTP(recorder, request)
			if recorder.Code != test.status {
				t.Fatalf("status = %d, want %d", recorder.Code, test.status)
			}
		})
	}
}

func TestPublicSearchRejectsUnknownFieldsAndInvalidLengths(t *testing.T) {
	for _, test := range []struct {
		name string
		body string
	}{
		{name: "unknown field", body: `{"query":"通知","extra":true}`},
		{name: "empty query", body: `{"query":"   "}`},
		{name: "query too long", body: `{"query":"` + strings.Repeat("字", 401) + `"}`},
		{name: "goal too long", body: `{"query":"通知","search_goal":"` + strings.Repeat("字", 801) + `"}`},
	} {
		t.Run(test.name, func(t *testing.T) {
			handler := New(service.New(testIndexStore{found: true}, &testSearcher{}), "internal", map[string]string{"astrbot": "mcp-client-token"}).Handler()
			request := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/v1/search", strings.NewReader(test.body))
			request.Header.Set("authorization", "Bearer mcp-client-token")
			recorder := httptest.NewRecorder()
			handler.ServeHTTP(recorder, request)
			if recorder.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
			}
		})
	}
}

func TestPublicSearchMapsAvailabilityTimeoutAndNoMatch(t *testing.T) {
	requestFor := func(handler http.Handler) *httptest.ResponseRecorder {
		request := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/v1/search", strings.NewReader(`{"query":"通知"}`))
		request.Header.Set("authorization", "Bearer mcp-client-token")
		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, request)
		return recorder
	}
	if response := requestFor(New(service.New(testIndexStore{found: false}, &testSearcher{}), "internal", map[string]string{"astrbot": "mcp-client-token"}).Handler()); response.Code != http.StatusServiceUnavailable {
		t.Fatalf("unavailable status = %d", response.Code)
	}
	if response := requestFor(New(service.New(testIndexStore{found: true}, &testSearcher{err: context.DeadlineExceeded}), "internal", map[string]string{"astrbot": "mcp-client-token"}).Handler()); response.Code != http.StatusGatewayTimeout {
		t.Fatalf("timeout status = %d", response.Code)
	}
	if response := requestFor(New(service.New(testIndexStore{found: true}, &testSearcher{results: []campussearch.SearchResultItem{}}), "internal", map[string]string{"astrbot": "mcp-client-token"}).Handler()); response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"outcome":"no_match"`) {
		t.Fatalf("no-match response = %d %s", response.Code, response.Body.String())
	}
}

func TestPublicSearchRejectsWhenCallerConcurrencyIsFull(t *testing.T) {
	server := New(service.New(testIndexStore{found: true}, &testSearcher{}), "internal", map[string]string{"astrbot": "mcp-client-token"})
	slots := make(chan struct{}, 8)
	for index := 0; index < cap(slots); index++ {
		slots <- struct{}{}
	}
	server.slots["astrbot"] = slots
	request := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/v1/search", strings.NewReader(`{"query":"通知"}`))
	request.Header.Set("authorization", "Bearer mcp-client-token")
	recorder := httptest.NewRecorder()
	server.Handler().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusTooManyRequests {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
}

func TestInternalSearchForwardsExclusionsAndIncludesDiagnostics(t *testing.T) {
	searcher := &testSearcher{}
	handler := New(service.New(testIndexStore{found: true}, searcher), "internal", nil).Handler()
	request := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/internal/v1/search", strings.NewReader(`{"query":"通知","search_goal":"条件","exclude_result_refs":["result://old"],"result_limit":3}`))
	request.Header.Set("authorization", "Bearer internal")
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	if len(searcher.query.ExcludedResultRefs) != 1 || searcher.query.ExcludedResultRefs[0] != "result://old" || searcher.query.RerankQuery != "条件" {
		t.Fatalf("query = %#v", searcher.query)
	}
	var body map[string]any
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body["collection"] == nil || body["diagnostics"] == nil {
		t.Fatalf("internal response omitted collection or diagnostics: %s", recorder.Body.String())
	}
	phases := body["diagnostics"].(map[string]any)["phaseTimes"].(map[string]any)
	if phases["index_loaded"] == nil {
		t.Fatalf("internal response omitted phase times: %s", recorder.Body.String())
	}
	results, ok := body["results"].([]any)
	if !ok || len(results) != 1 || !strings.Contains(recorder.Body.String(), "result_ref") || !strings.Contains(recorder.Body.String(), "citation_index") {
		t.Fatalf("internal response omitted result identity: %s", recorder.Body.String())
	}
}

func TestInternalSearchAllowsNormalizedInputBounds(t *testing.T) {
	handler := New(service.New(testIndexStore{found: true}, &testSearcher{}), "internal", nil).Handler()
	request := httptest.NewRequestWithContext(
		context.Background(),
		http.MethodPost,
		"/internal/v1/search",
		strings.NewReader(`{"query":"`+strings.Repeat("字", campussearch.InternalSearchQueryLimit)+`","search_goal":"`+strings.Repeat("条", campussearch.InternalSearchGoalLimit)+`"}`),
	)
	request.Header.Set("authorization", "Bearer internal")
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
}

func TestSearchTimeoutReturnsGatewayTimeout(t *testing.T) {
	started := make(chan struct{})
	server := New(service.New(testIndexStore{found: true}, blockingSearcher{started: started}), "internal", map[string]string{"bot": "token"})
	server.searchTimeout = 10 * time.Millisecond
	recorder := httptest.NewRecorder()
	request := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/v1/search", strings.NewReader(`{"query":"通知"}`))
	request.Header.Set("authorization", "Bearer token")
	server.Handler().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusGatewayTimeout {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("searcher was not called")
	}
}

func TestReadyzRequiresSearchDependencies(t *testing.T) {
	ready := New(service.New(testIndexStore{found: true}, &testSearcher{}), "internal", nil).Handler()
	recorder := httptest.NewRecorder()
	ready.ServeHTTP(recorder, httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/readyz", nil))
	if recorder.Code != http.StatusOK {
		t.Fatalf("ready status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	notReady := New(service.New(testIndexStore{found: false}, &testSearcher{}), "internal", nil).Handler()
	recorder = httptest.NewRecorder()
	notReady.ServeHTTP(recorder, httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/readyz", nil))
	if recorder.Code != http.StatusServiceUnavailable {
		t.Fatalf("not-ready status = %d", recorder.Code)
	}
}

func TestSearchFailureDiagnosticsStayOnInternalAPI(t *testing.T) {
	for _, test := range []struct {
		stage  string
		cause  error
		status int
		code   string
	}{
		{"embedding", errors.New("embedding provider status 401"), http.StatusServiceUnavailable, "campus_search_failed"},
		{"retrieval", errors.New("Qdrant payload section_ref is required"), http.StatusServiceUnavailable, "campus_search_failed"},
		{"rerank", context.DeadlineExceeded, http.StatusGatewayTimeout, "campus_search_timeout"},
	} {
		t.Run(test.stage, func(t *testing.T) {
			handler := New(service.New(testIndexStore{found: true}, &testSearcher{err: test.cause, failureStage: test.stage}), "internal", map[string]string{"mcp": "mcp-client-token"}).Handler()
			for _, endpoint := range []struct {
				path, token string
				internal    bool
			}{
				{"/internal/v1/search", "internal", true}, {"/v1/search", "mcp-client-token", false},
			} {
				request := httptest.NewRequestWithContext(t.Context(), http.MethodPost, endpoint.path, strings.NewReader(`{"query":"通知"}`))
				request.Header.Set("authorization", "Bearer "+endpoint.token)
				recorder := httptest.NewRecorder()
				handler.ServeHTTP(recorder, request)
				var body campussearch.SearchErrorResponse
				if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
					t.Fatal(err)
				}
				if recorder.Code != test.status || body.Error.Code != test.code {
					t.Fatalf("unexpected error: %d %s", recorder.Code, recorder.Body.String())
				}
				if endpoint.internal {
					if body.Diagnostics == nil || body.Diagnostics.FailedStage != test.stage || body.Diagnostics.FailureDetail != test.cause.Error() || body.Diagnostics.Durations["embedding"] != 12 || len(body.Diagnostics.Candidates) != 1 || body.Diagnostics.Retrieval == nil {
						t.Fatalf("lost partial diagnostics: %s", recorder.Body.String())
					}
					if body.Diagnostics.PhaseTimes["index_loaded"].IsZero() {
						t.Fatalf("failure omitted completed phases: %s", recorder.Body.String())
					}
				} else if body.Diagnostics != nil || strings.Contains(recorder.Body.String(), test.cause.Error()) || strings.Contains(recorder.Body.String(), "internal candidate") {
					t.Fatalf("public error exposes internal diagnostics: %s", recorder.Body.String())
				}
			}
		})
	}
}
