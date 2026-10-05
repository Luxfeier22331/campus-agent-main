package service

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/campus-search/campussearch"
)

type testIndexStore struct {
	index campussearch.Index
	found bool
	err   error
}

func (s testIndexStore) CurrentIndex(context.Context) (campussearch.Index, bool, error) {
	return s.index, s.found, s.err
}

type testSearcher struct {
	query campussearch.SearchQuery
}

func (s *testSearcher) Search(_ context.Context, _ campussearch.Index, query campussearch.SearchQuery, _ int) ([]campussearch.SearchResultItem, error) {
	s.query = query
	return []campussearch.SearchResultItem{{
		ResultRef:    "result://" + "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
		SourceKind:   "notice",
		NoticeID:     "notice-1",
		Title:        "通知",
		SectionTitle: "正文",
		CitationHref: "/notices/notice-1",
		Text:         "内容",
	}}, nil
}

func TestSearchUsesCurrentIndexAndExclusions(t *testing.T) {
	searcher := &testSearcher{}
	service := New(testIndexStore{index: campussearch.Index{Collection: "campus_docs_" + "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"}, found: true}, searcher)
	response, err := service.Search(context.Background(), SearchRequest{Query: "学籍规定", SearchGoal: "转专业", ExcludedResultRefs: []string{"result://old"}, ResultLimit: 5})
	if err != nil {
		t.Fatal(err)
	}
	if response.Collection == "" || len(response.Results) != 1 {
		t.Fatalf("unexpected response: %#v", response)
	}
	if searcher.query.RetrievalQuery != "学籍规定" || searcher.query.RerankQuery != "转专业" || len(searcher.query.ExcludedResultRefs) != 1 {
		t.Fatalf("unexpected search query: %#v", searcher.query)
	}
}

func TestSearchReturnsUnavailableWithoutCurrentIndex(t *testing.T) {
	service := New(testIndexStore{found: false}, &testSearcher{})
	_, err := service.Search(context.Background(), SearchRequest{Query: "通知"})
	if !errors.Is(err, ErrUnavailable) {
		t.Fatalf("error = %v, want ErrUnavailable", err)
	}
}

func TestSearchUsesQueryWhenGoalIsOmitted(t *testing.T) {
	for _, goal := range []string{"", "  "} {
		searcher := &testSearcher{}
		svc := New(testIndexStore{index: campussearch.Index{Collection: "campus_docs_" + "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"}, found: true}, searcher)
		response, err := svc.Search(t.Context(), SearchRequest{Query: "  学籍规定  ", SearchGoal: goal})
		if err != nil {
			t.Fatal(err)
		}
		if searcher.query.RerankQuery != "学籍规定" || response.Diagnostics.RerankQuery != "学籍规定" {
			t.Fatalf("omitted goal must use the search query: %#v", searcher.query)
		}
	}
}

func TestReadinessRequiresCurrentIndex(t *testing.T) {
	index := campussearch.Index{Collection: "campus_docs_" + "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"}
	if err := New(testIndexStore{index: index, found: true}, &testSearcher{}).Readiness(t.Context()); err != nil {
		t.Fatalf("readiness error = %v", err)
	}
	if err := New(testIndexStore{found: false}, &testSearcher{}).Readiness(t.Context()); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("readiness error = %v, want ErrUnavailable", err)
	}
}

func TestPublicResultOmitsAgentFields(t *testing.T) {
	item := campussearch.SearchResultItem{ResultRef: "result://internal", CitationIndex: 2, SourceKind: "notice", NoticeID: "n", Title: "标题", SectionTitle: "段落", CitationHref: "/notices/n", Text: "正文"}
	result := PublicResult([]campussearch.SearchResultItem{item})
	encoded := result["results"].([]map[string]any)[0]
	if _, ok := encoded["result_ref"]; ok {
		t.Fatal("public result leaked result_ref")
	}
	if _, ok := encoded["citation_index"]; ok {
		t.Fatal("public result leaked citation_index")
	}
}

func TestPublicResultUsesSourceLinks(t *testing.T) {
	section := "/docs/undergraduate/rules/registration/v/2026#section-1"
	results := PublicResult([]campussearch.SearchResultItem{
		{SourceKind: "document", SectionRef: section},
		{SourceKind: "notice", CitationHref: "/notices/notice-1"},
	})["results"].([]map[string]any)
	if results[0]["citation_href"] != section || results[0]["section_ref"] != section {
		t.Fatalf("document lost its versioned section link: %#v", results[0])
	}
	if results[1]["citation_href"] != "/notices/notice-1" {
		t.Fatalf("notice lost its link: %#v", results[1])
	}
}

type phaseSearcher struct {
	phases       []string
	failureStage string
	err          error
}

func (searcher phaseSearcher) Search(ctx context.Context, _ campussearch.Index, _ campussearch.SearchQuery, _ int) ([]campussearch.SearchResultItem, error) {
	observer := campussearch.SearchObservation(ctx)
	for _, phase := range searcher.phases {
		observer.Phase(phase)
	}
	observer.Snapshot.FailedStage = searcher.failureStage
	return []campussearch.SearchResultItem{}, searcher.err
}

func TestSearchRecordsOnlyCompletedPhases(t *testing.T) {
	for _, test := range []struct {
		name     string
		searcher phaseSearcher
	}{
		{"matched", phaseSearcher{phases: []string{"embedded", "retrieved", "reranked", "selected"}}},
		{"no candidates", phaseSearcher{phases: []string{"embedded", "retrieved", "selected"}}},
		{"embedding failed", phaseSearcher{failureStage: "embedding", err: errors.New("embedding failed")}},
		{"retrieval failed", phaseSearcher{phases: []string{"embedded"}, failureStage: "retrieval", err: errors.New("retrieval failed")}},
		{"rerank failed", phaseSearcher{phases: []string{"embedded", "retrieved"}, failureStage: "rerank", err: context.DeadlineExceeded}},
	} {
		t.Run(test.name, func(t *testing.T) {
			svc := New(testIndexStore{index: campussearch.Index{Collection: "campus_docs_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"}, found: true}, test.searcher)
			started := time.Now()
			response, err := svc.Search(t.Context(), SearchRequest{Query: "通知"})
			finished := time.Now()
			if !errors.Is(err, test.searcher.err) {
				t.Fatalf("error = %v, want %v", err, test.searcher.err)
			}
			phases := append([]string{"index_loaded"}, test.searcher.phases...)
			if len(response.Diagnostics.PhaseTimes) != len(phases) {
				t.Fatalf("unexpected phases: %#v", response.Diagnostics.PhaseTimes)
			}
			previous := started
			for _, phase := range phases {
				at := response.Diagnostics.PhaseTimes[phase]
				if at.Before(previous) || at.After(finished) {
					t.Fatalf("invalid completion time for %s: %v", phase, at)
				}
				previous = at
			}
		})
	}
}
