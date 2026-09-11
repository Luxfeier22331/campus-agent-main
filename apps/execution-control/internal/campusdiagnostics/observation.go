// Package campusdiagnostics owns the bounded, non-authoritative Campus Search
// projection consumed by Ops Web. It is not part of the tool result contract.
package campusdiagnostics

import (
	"context"
	"errors"
	"regexp"
	"time"
	"unicode/utf8"
)

type Candidate struct {
	ResultRef       string   `json:"resultRef"`
	SourceKind      string   `json:"sourceKind"`
	Title           string   `json:"title"`
	Section         string   `json:"section"`
	FusionScore     float64  `json:"fusionScore"`
	RerankScore     *float64 `json:"rerankScore"`
	RetrievalRank   int      `json:"retrievalRank"`
	RerankRank      *int     `json:"rerankRank"`
	Returned        bool     `json:"returned"`
	ExclusionReason string   `json:"exclusionReason,omitempty"`
	Text            string   `json:"text"`
	CitationIndex   *int     `json:"citationIndex"`
}

type Snapshot struct {
	IndexCollection   string           `json:"indexCollection,omitempty"`
	EffectiveQuery    string           `json:"effectiveQuery"`
	CitationStart     int              `json:"citationStart"`
	ResultLimit       int              `json:"resultLimit"`
	RetrievalMode     string           `json:"retrievalMode,omitempty"`
	Durations         map[string]int64 `json:"durations"`
	RetrievedCount    int              `json:"retrievedCount"`
	DeduplicatedCount int              `json:"deduplicatedCount"`
	RerankInputCount  int              `json:"rerankInputCount"`
	RerankKeptCount   int              `json:"rerankKeptCount"`
	ReturnedCount     int              `json:"returnedCount"`
	ExcludedCount     int              `json:"excludedCount"`
	Candidates        []Candidate      `json:"candidates"`
	SnapshotTruncated bool             `json:"snapshotTruncated"`
}

type Observation struct {
	RequestID       string    `json:"-"`
	InvocationID    string    `json:"invocationId"`
	WorkflowStepID  string    `json:"workflowStepId"`
	ActivityAttempt int       `json:"activityAttempt"`
	SearchQuery     string    `json:"searchQuery"`
	Phase           string    `json:"phase"`
	At              time.Time `json:"at"`
	FailureCode     string    `json:"failureCode,omitempty"`
	HTTPStatus      *int      `json:"httpStatus,omitempty"`
	Snapshot        *Snapshot `json:"-"`
}

var phaseRanks = map[string]int{
	"queued": 1, "dispatching": 2, "received": 3, "index_loaded": 4,
	"embedded": 5, "retrieved": 6, "reranked": 7, "selected": 8,
	"completed": 9, "failed": 9, "canceled": 9,
}
var codePattern = regexp.MustCompile(`^[a-z0-9_.-]{1,128}$`)

func (o Observation) Rank() int { return phaseRanks[o.Phase] }
func (o Observation) Status() string {
	if o.Rank() == 9 {
		return o.Phase
	}
	return "running"
}
func (o Observation) ValidateRuntime() error {
	if o.Phase != "queued" && o.Phase != "dispatching" && o.Phase != "completed" && o.Phase != "failed" && o.Phase != "canceled" {
		return errors.New("unsupported campus search observation phase")
	}
	if o.InvocationID == "" || len(o.InvocationID) > 128 || o.WorkflowStepID == "" || len(o.WorkflowStepID) > 128 || o.ActivityAttempt < 1 || utf8.RuneCountInString(o.SearchQuery) > 400 || o.At.IsZero() || (o.FailureCode != "" && !codePattern.MatchString(o.FailureCode)) || (o.HTTPStatus != nil && (*o.HTTPStatus < 100 || *o.HTTPStatus > 599)) {
		return errors.New("invalid campus search observation")
	}
	return nil
}

type Store interface {
	ObserveCampusSearch(context.Context, Observation) error
	MarkCampusSearchCitations(context.Context, string, []string) error
}

// No retry and no background queue: a diagnostic outage cannot change a tool
// result or prevent cancellation. Each write has its own short deadline.
func Record(ctx context.Context, store any, observation Observation) {
	writer, ok := store.(Store)
	if !ok {
		return
	}
	bounded, cancel := context.WithTimeout(context.WithoutCancel(ctx), 200*time.Millisecond)
	defer cancel()
	_ = writer.ObserveCampusSearch(bounded, observation)
}

func MarkCitations(ctx context.Context, store any, requestID string, refs []string) {
	writer, ok := store.(Store)
	if !ok {
		return
	}
	bounded, cancel := context.WithTimeout(context.WithoutCancel(ctx), 200*time.Millisecond)
	defer cancel()
	_ = writer.MarkCampusSearchCitations(bounded, requestID, refs)
}

func Bound(text string, limit int) string {
	runes := []rune(text)
	if len(runes) > limit {
		return string(runes[:limit])
	}
	return text
}
