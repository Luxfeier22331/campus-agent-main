package service

import (
	"context"
	"errors"
	"fmt"
	searchapi "github.com/MUC-WIKI/campus-agent/packages/search-api-go"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/MUC-WIKI/campus-agent/apps/campus-search/campussearch"
)

var ErrUnavailable = errors.New("campus search index is not available")

type SearchRequest struct {
	Query              string
	SearchGoal         string
	ExcludedResultRefs []string
	ResultLimit        int
	CitationStart      int
	QueryLimit         int
	SearchGoalLimit    int
}

type SearchResponse struct {
	Collection  string
	Results     []searchapi.SearchResultItem
	Diagnostics *campussearch.Snapshot
}

type Service struct {
	indexStore campussearch.IndexStore
	searcher   campussearch.Searcher
}

func New(indexStore campussearch.IndexStore, searcher campussearch.Searcher) *Service {
	return &Service{indexStore: indexStore, searcher: searcher}
}

func (s *Service) Readiness(ctx context.Context) error {
	if s == nil || s.indexStore == nil || s.searcher == nil {
		return ErrUnavailable
	}
	_, found, err := s.indexStore.CurrentIndex(ctx)
	if err != nil {
		return err
	}
	if !found {
		return ErrUnavailable
	}
	return nil
}

func (s *Service) Search(ctx context.Context, request SearchRequest) (response SearchResponse, err error) {
	query := strings.TrimSpace(request.Query)
	goal := strings.TrimSpace(request.SearchGoal)
	limit := request.ResultLimit
	if limit <= 0 || limit > searchapi.SearchResultLimit {
		limit = searchapi.SearchResultLimit
	}
	snapshot := &campussearch.Snapshot{
		PhaseTimes:     map[string]time.Time{},
		EffectiveQuery: query, RerankQuery: goal,
		CitationStart: request.CitationStart, ResultLimit: limit,
		Durations: map[string]int64{}, Candidates: []campussearch.Candidate{},
		FailedStage: "validation",
	}
	// Retain the partial snapshot on failures as well as successful searches.
	defer func() {
		response.Diagnostics = snapshot
		if err != nil {
			snapshot.FailureDetail = err.Error()
		}
	}()
	if query == "" {
		return response, errors.New("query is required")
	}
	queryLimit := request.QueryLimit
	if queryLimit <= 0 {
		queryLimit = searchapi.SearchQueryLimit
	}
	searchGoalLimit := request.SearchGoalLimit
	if searchGoalLimit <= 0 {
		searchGoalLimit = searchapi.SearchGoalLimit
	}
	if utf8.RuneCountInString(query) > queryLimit {
		return response, fmt.Errorf("query must not exceed %d characters", queryLimit)
	}
	if utf8.RuneCountInString(goal) > searchGoalLimit {
		return response, fmt.Errorf("search_goal must not exceed %d characters", searchGoalLimit)
	}
	if goal == "" {
		goal = query
		snapshot.RerankQuery = goal
	}
	snapshot.FailedStage = "index"
	if s == nil || s.indexStore == nil || s.searcher == nil {
		return response, ErrUnavailable
	}
	index, found, err := s.indexStore.CurrentIndex(ctx)
	if err != nil {
		return response, err
	}
	if !found {
		return response, ErrUnavailable
	}
	response.Collection = index.Collection
	snapshot.Retrieval = &campussearch.RetrievalMeta{Collection: index.Collection}
	recordPhase := func(phase string) {
		snapshot.PhaseTimes[phase] = time.Now().UTC()
	}
	recordPhase("index_loaded")
	observed := campussearch.WithSearchObserver(ctx, &campussearch.SearchObserver{Snapshot: snapshot, Phase: recordPhase})
	response.Results, err = s.searcher.Search(observed, index, campussearch.SearchQuery{
		RetrievalQuery: query, RerankQuery: goal, ExcludedResultRefs: request.ExcludedResultRefs,
	}, limit)
	if err == nil {
		snapshot.FailedStage = ""
	}
	return response, err
}

func PublicResult(results []searchapi.SearchResultItem) map[string]any {
	items := make([]map[string]any, 0, len(results))
	for _, item := range results {
		citationHref := item.CitationHref
		if item.SourceKind == "document" {
			citationHref = item.SectionRef
		}
		value := map[string]any{
			"source_kind":   item.SourceKind,
			"title":         item.Title,
			"text":          item.Text,
			"citation_href": citationHref,
			"section_title": item.SectionTitle,
		}
		if item.NoticeID != "" {
			value["notice_id"] = item.NoticeID
		}
		if item.DocumentID != "" {
			value["document_id"] = item.DocumentID
		}
		if item.ReleasedAt != "" {
			value["released_at"] = item.ReleasedAt
		}
		if item.SectionRef != "" {
			value["section_ref"] = item.SectionRef
		}
		if item.VersionID != "" {
			value["version_id"] = item.VersionID
		}
		if item.VersionSlug != "" {
			value["version_slug"] = item.VersionSlug
		}
		if len(item.RootUnitIDs) > 0 {
			value["root_unit_ids"] = item.RootUnitIDs
		}
		items = append(items, value)
	}
	outcome := "no_match"
	if len(items) > 0 {
		outcome = "matched"
	}
	return map[string]any{"outcome": outcome, "results": items}
}

func InternalResult(response SearchResponse) map[string]any {
	citationStart := 1
	if response.Diagnostics != nil {
		citationStart = response.Diagnostics.CitationStart
	}
	encoded := searchapi.EncodeSearchResult(response.Results, citationStart)
	encoded["collection"] = response.Collection
	if response.Diagnostics != nil {
		encoded["diagnostics"] = response.Diagnostics
	}
	return encoded
}
