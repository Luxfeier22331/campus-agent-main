package executionapplication

import (
	"context"

	"github.com/MUC-WIKI/campus-agent/apps/campus-search/campussearch"
)

// CampusSearchClient is the narrow retrieval port used by the Agent adapter.
// It deliberately returns the current collection so the Agent can preserve
// its run-level index binding without exposing that choice to model callers.
type CampusSearchClient interface {
	Search(context.Context, CampusSearchClientRequest) (CampusSearchClientResponse, error)
}

type CampusSearchClientRequest struct {
	RetrievalQuery     string
	RerankQuery        string
	ExcludedResultRefs []string
	ResultLimit        int
}

type CampusSearchClientResponse struct {
	Collection  string
	Results     []campussearch.SearchResultItem
	Diagnostics *campussearch.Snapshot
}

// CampusSearchClientError preserves the upstream diagnostic snapshot and error identity.
type CampusSearchClientError struct {
	Cause       error
	Diagnostics *campussearch.Snapshot
}

func (e *CampusSearchClientError) Error() string { return e.Cause.Error() }
func (e *CampusSearchClientError) Unwrap() error { return e.Cause }
