package executionapplication

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/campusdiagnostics"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/campus-search/campussearch"
)

const CampusSearchToolName = "campus_search"
const CampusSearchResultLimit = campussearch.SearchResultLimit
const campusDocsIndexBindingKey = "campus_docs_index_collection"

var ErrCampusSearchUnavailable = errors.New("campus search index is not available")

type CampusSearchBindingStore interface {
	GetRun(context.Context, string) (execution.DurableRun, error)
	ReplaceRunMetadata(context.Context, string, map[string]any) error
}
type CampusSearchToolServiceOptions struct {
	Authorizer         *RunToolAuthorizer
	CampusSearchClient CampusSearchClient
	Store              CampusSearchBindingStore
	Diagnostics        campusdiagnostics.Store
}
type CampusSearchToolService struct {
	authorizer         *RunToolAuthorizer
	campusSearchClient CampusSearchClient
	store              CampusSearchBindingStore
	diagnostics        campusdiagnostics.Store
	indexBindingMu     sync.Mutex
}

func NewCampusSearchToolService(o CampusSearchToolServiceOptions) *CampusSearchToolService {
	return &CampusSearchToolService{authorizer: o.Authorizer, campusSearchClient: o.CampusSearchClient, store: o.Store, diagnostics: o.Diagnostics}
}

type campusSearchStageError struct {
	stage string
	cause error
}

func (e campusSearchStageError) Error() string { return e.cause.Error() }
func (e campusSearchStageError) Unwrap() error { return e.cause }

// CampusSearchFailureCode returns a stable, stage-specific code for the
// internal tool transport. It deliberately does not expose provider details.
func CampusSearchFailureCode(err error) string {
	var stageErr campusSearchStageError
	if !errors.As(err, &stageErr) {
		return "campus_search_failed"
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return "campus_search_" + stageErr.stage + "_timeout"
	}
	return "campus_search_" + stageErr.stage + "_failed"
}

func (s *CampusSearchToolService) CampusSearch(
	ctx context.Context,
	request CampusSearchRequest,
) (map[string]any, error) {
	access := request.AccessContext
	if !access.DeadlineAt.IsZero() {
		var cancel context.CancelFunc
		ctx, cancel = context.WithDeadline(ctx, access.DeadlineAt)
		defer cancel()
	}
	query := campussearch.SearchQuery{
		RetrievalQuery:     strings.TrimSpace(request.SearchQuery),
		RerankQuery:        strings.TrimSpace(request.SearchGoal),
		ExcludedResultRefs: access.ExcludedResultRefs,
	}
	if query.RerankQuery == "" {
		query.RerankQuery = strings.TrimSpace(access.UserGoal)
	}
	snapshot := &campusdiagnostics.Snapshot{
		EffectiveQuery: campusdiagnostics.Bound(query.RetrievalQuery, 1024),
		RerankQuery:    campusdiagnostics.Bound(query.RerankQuery, 1024), CitationStart: access.CitationStart,
		ResultLimit: access.ResultLimit, Durations: map[string]int64{}, Candidates: []campusdiagnostics.Candidate{},
		FailedStage:       "validation",
		SnapshotTruncated: len([]rune(query.RetrievalQuery)) > 1024 || len([]rune(query.RerankQuery)) > 1024,
	}
	var phaseTimes map[string]time.Time
	observe := func(phase string) {
		campusdiagnostics.Record(ctx, s.diagnostics, campusdiagnostics.Observation{
			RequestID: access.RequestID, InvocationID: access.InvocationID,
			WorkflowStepID: access.WorkflowStepID, ActivityAttempt: access.ActivityAttempt,
			SearchQuery: request.SearchQuery, Phase: phase, At: time.Now(), Snapshot: snapshot, PhaseTimes: phaseTimes,
		})
	}
	finishFailure := func(err error) error {
		if err == nil {
			return nil
		}
		phase := "failed"
		if errors.Is(err, context.Canceled) {
			phase = "canceled"
		}
		if snapshot.FailureDetail == "" {
			snapshot.FailureDetail = err.Error()
		}
		observe(phase)
		stage := snapshot.FailedStage
		if stage == "" {
			stage = "unknown"
		}
		return campusSearchStageError{stage: stage, cause: err}
	}
	observe("received")
	run, err := s.authorizer.validateRun(ctx, request.AccessContext, CampusSearchToolName)
	if err != nil {
		return nil, finishFailure(err)
	}
	query.RetrievalQuery = NormalizeRelativeNoticeYears(query.RetrievalQuery, run.CreatedAt)
	query.RerankQuery = NormalizeRelativeNoticeYears(query.RerankQuery, run.CreatedAt)
	snapshot.EffectiveQuery = campusdiagnostics.Bound(query.RetrievalQuery, 1024)
	snapshot.RerankQuery = campusdiagnostics.Bound(query.RerankQuery, 1024)
	snapshot.FailedStage = "index"
	if s.campusSearchClient == nil {
		return nil, finishFailure(ErrCampusSearchUnavailable)
	}
	clientResult, clientErr := s.campusSearchClient.Search(ctx, CampusSearchClientRequest{
		RetrievalQuery:     query.RetrievalQuery,
		RerankQuery:        query.RerankQuery,
		ExcludedResultRefs: query.ExcludedResultRefs,
		ResultLimit:        request.AccessContext.ResultLimit,
	})
	if clientErr != nil {
		var upstreamError *CampusSearchClientError
		if errors.As(clientErr, &upstreamError) {
			if upstreamError.Diagnostics != nil {
				phaseTimes = upstreamError.Diagnostics.PhaseTimes
			}
			mergeCampusSearchDiagnostics(snapshot, upstreamError.Diagnostics, nil, access.CitationStart)
		}
		return nil, finishFailure(clientErr)
	}
	if clientResult.Diagnostics != nil {
		phaseTimes = clientResult.Diagnostics.PhaseTimes
	}
	index := campussearch.Index{Collection: clientResult.Collection}
	results := clientResult.Results
	if err := campussearch.ValidateIndex(index); err != nil {
		return nil, finishFailure(err)
	}
	run, err = s.bindCampusSearchCollection(ctx, run, index.Collection)
	if err != nil {
		return nil, finishFailure(err)
	}
	snapshot.Retrieval = &campusdiagnostics.RetrievalMeta{Collection: index.Collection}
	mergeCampusSearchDiagnostics(snapshot, clientResult.Diagnostics, results, access.CitationStart)
	snapshot.FailedStage = ""
	observe("completed")
	return campussearch.EncodeSearchResult(results, request.AccessContext.CitationStart), nil
}

func mergeCampusSearchDiagnostics(snapshot *campusdiagnostics.Snapshot, upstream *campussearch.Snapshot, results []campussearch.SearchResultItem, citationStart int) {
	if upstream == nil {
		return
	}
	if raw, err := json.Marshal(upstream); err == nil {
		_ = json.Unmarshal(raw, snapshot)
	}
	snapshot.CitationStart = citationStart
	indexes := make(map[string]int, len(results))
	for offset, result := range results {
		indexes[result.ResultRef] = citationStart + offset
	}
	for i := range snapshot.Candidates {
		candidate := &snapshot.Candidates[i]
		candidate.CitationIndex = nil
		if index, ok := indexes[candidate.ResultRef]; ok && candidate.Returned {
			candidate.CitationIndex = &index
		}
	}
}

func (s *CampusSearchToolService) bindCampusSearchCollection(
	ctx context.Context,
	run execution.DurableRun,
	collection string,
) (execution.DurableRun, error) {
	s.indexBindingMu.Lock()
	defer s.indexBindingMu.Unlock()
	current, err := s.store.GetRun(ctx, run.RequestID)
	if err != nil {
		return execution.DurableRun{}, err
	}
	boundCollection := execution.StringValue(current.Metadata[campusDocsIndexBindingKey])
	if boundCollection != "" && boundCollection != collection {
		return execution.DurableRun{}, newAgentToolConflict(fmt.Errorf(
			"campus docs index binding changed during run: bound=%s current=%s",
			boundCollection,
			collection,
		))
	}
	if boundCollection == "" {
		metadata := execution.CloneAnyMapFromValue(current.Metadata)
		metadata[campusDocsIndexBindingKey] = collection
		if err := s.store.ReplaceRunMetadata(ctx, current.RequestID, metadata); err != nil {
			return execution.DurableRun{}, err
		}
		current.Metadata = metadata
	}
	return current, nil
}

// NormalizeRelativeNoticeYears expands the narrow set of relative year terms
// used in notice questions against the run's frozen creation date. Retrieval
// and reranking must receive the same resolved wording.
func NormalizeRelativeNoticeYears(value string, asOf time.Time) string {
	if value == "" || asOf.IsZero() {
		return value
	}
	year := asOf.UTC().Year()
	value = strings.ReplaceAll(value, "前年", fmt.Sprintf("%d年", year-2))
	value = strings.ReplaceAll(value, "去年", fmt.Sprintf("%d年", year-1))
	value = strings.ReplaceAll(value, "今年", fmt.Sprintf("%d年", year))
	return value
}
