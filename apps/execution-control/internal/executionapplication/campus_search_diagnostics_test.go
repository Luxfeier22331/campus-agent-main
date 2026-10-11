package executionapplication

import (
	"context"
	"errors"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/campus-search/campussearch"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/campusdiagnostics"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionpersistence"
)

type diagnosticSearchClient func(context.Context, CampusSearchClientRequest) (CampusSearchClientResponse, error)

func (client diagnosticSearchClient) Search(ctx context.Context, request CampusSearchClientRequest) (CampusSearchClientResponse, error) {
	return client(ctx, request)
}

type terminalDiagnosticStore struct {
	*executionpersistence.InMemoryRunProjectionStore
	terminal chan campusdiagnostics.Observation
}

func (s *terminalDiagnosticStore) ObserveCampusSearch(_ context.Context, observation campusdiagnostics.Observation) error {
	if observation.Phase == "completed" || observation.Phase == "failed" {
		s.terminal <- observation
	}
	return nil
}
func (*terminalDiagnosticStore) MarkCampusSearchCitations(context.Context, string, []string) error {
	return nil
}

func TestCampusSearchRecordsUpstreamFailureStage(t *testing.T) {
	for _, test := range []struct {
		stage string
		cause error
		code  string
	}{
		{"embedding", errors.New("provider failed"), "campus_search_embedding_failed"},
		{"retrieval", errors.New("provider failed"), "campus_search_retrieval_failed"},
		{"rerank", context.DeadlineExceeded, "campus_search_rerank_timeout"},
	} {
		t.Run(test.stage, func(t *testing.T) {
			base, run, _ := applicationTestRunningRun(t, false)
			store := &terminalDiagnosticStore{base, make(chan campusdiagnostics.Observation, 1)}
			phaseTimes := map[string]time.Time{"index_loaded": time.Date(2026, 10, 3, 1, 0, 0, 0, time.UTC)}
			if test.stage != "embedding" {
				phaseTimes["embedded"] = phaseTimes["index_loaded"].Add(time.Second)
			}
			if test.stage == "rerank" {
				phaseTimes["retrieved"] = phaseTimes["index_loaded"].Add(2 * time.Second)
			}
			client := diagnosticSearchClient(func(context.Context, CampusSearchClientRequest) (CampusSearchClientResponse, error) {
				return CampusSearchClientResponse{}, &CampusSearchClientError{Cause: test.cause, Diagnostics: &campussearch.Snapshot{
					PhaseTimes:  phaseTimes,
					FailedStage: test.stage, FailureDetail: "upstream failure detail", CitationStart: 1,
					Durations: map[string]int64{"embedding": 12}, Candidates: []campussearch.Candidate{{ResultRef: "result://candidate"}},
				}}
			})
			svc := NewCampusSearchToolService(CampusSearchToolServiceOptions{Authorizer: NewRunToolAuthorizer(RunToolAuthorizerOptions{Store: store}), Store: store, CampusSearchClient: client, Diagnostics: store})
			_, err := svc.CampusSearch(t.Context(), CampusSearchRequest{SearchQuery: "通知", AccessContext: AgentToolAccessContext{RequestID: run.RequestID, ActivityAttempt: 1, CitationStart: 6, InvocationID: "failure-diagnostic", WorkflowStepID: "task.step.step.lookup", ResultLimit: 5, UserGoal: "通知"}})
			if CampusSearchFailureCode(err) != test.code || !errors.Is(err, test.cause) {
				t.Fatalf("failure identity lost: %v, %s", err, CampusSearchFailureCode(err))
			}
			select {
			case observation := <-store.terminal:
				if !reflect.DeepEqual(observation.PhaseTimes, phaseTimes) {
					t.Fatalf("lost failure phase times: %#v", observation.PhaseTimes)
				}
				snapshot := observation.Snapshot
				if snapshot.FailedStage != test.stage || snapshot.FailureDetail != "upstream failure detail" || snapshot.Durations["embedding"] != 12 || len(snapshot.Candidates) != 1 || snapshot.CitationStart != 6 {
					t.Fatalf("lost failure diagnostics: %#v", snapshot)
				}
			case <-time.After(time.Second):
				t.Fatal("missing failure observation")
			}
		})
	}
}

func TestCampusSearchDiagnosticCitationsMatchRunResults(t *testing.T) {
	base, run, _ := applicationTestRunningRun(t, false)
	store := &terminalDiagnosticStore{base, make(chan campusdiagnostics.Observation, 1)}
	first, second := "result://"+strings.Repeat("a", 64), "result://"+strings.Repeat("b", 64)
	one, two := 1, 2
	phaseTimes := map[string]time.Time{}
	for offset, phase := range []string{"index_loaded", "embedded", "retrieved", "reranked", "selected"} {
		phaseTimes[phase] = time.Date(2026, 10, 3, 1, 0, offset, 0, time.UTC)
	}
	client := diagnosticSearchClient(func(context.Context, CampusSearchClientRequest) (CampusSearchClientResponse, error) {
		return CampusSearchClientResponse{Collection: "campus_docs_" + strings.Repeat("a", 64), Results: []campussearch.SearchResultItem{
			{ResultRef: first, SourceKind: "notice", NoticeID: "a", Title: "标题", SectionTitle: "正文", Text: "内容", CitationHref: "/notices/a"},
			{ResultRef: second, SourceKind: "notice", NoticeID: "b", Title: "标题", SectionTitle: "正文", Text: "内容", CitationHref: "/notices/b"},
		}, Diagnostics: &campussearch.Snapshot{PhaseTimes: phaseTimes, CitationStart: 1, Candidates: []campussearch.Candidate{
			{ResultRef: second, Returned: true, CitationIndex: &two},
			{ResultRef: "result://excluded", Returned: false},
			{ResultRef: first, Returned: true, CitationIndex: &one},
		}}}, nil
	})
	svc := NewCampusSearchToolService(CampusSearchToolServiceOptions{Authorizer: NewRunToolAuthorizer(RunToolAuthorizerOptions{Store: store}), Store: store, CampusSearchClient: client, Diagnostics: store})
	result, err := svc.CampusSearch(t.Context(), CampusSearchRequest{SearchQuery: "通知", AccessContext: AgentToolAccessContext{RequestID: run.RequestID, ActivityAttempt: 1, CitationStart: 6, InvocationID: "citation-diagnostic", WorkflowStepID: "task.step.step.lookup", ResultLimit: 5, UserGoal: "通知"}})
	if err != nil {
		t.Fatal(err)
	}
	_, items, err := campussearch.DecodeSearchResult(result)
	if err != nil {
		t.Fatal(err)
	}
	if items[0].CitationIndex != 6 || items[1].CitationIndex != 7 {
		t.Fatalf("wrong tool citations: %#v", items)
	}
	select {
	case observation := <-store.terminal:
		if !reflect.DeepEqual(observation.PhaseTimes, phaseTimes) {
			t.Fatalf("lost successful phase times: %#v", observation.PhaseTimes)
		}
		snapshot := observation.Snapshot
		if snapshot.CitationStart != 6 || *snapshot.Candidates[0].CitationIndex != items[1].CitationIndex || snapshot.Candidates[1].CitationIndex != nil || *snapshot.Candidates[2].CitationIndex != items[0].CitationIndex {
			t.Fatalf("diagnostic citations differ from results: %#v", snapshot)
		}
	case <-time.After(time.Second):
		t.Fatal("missing completed observation")
	}
}
