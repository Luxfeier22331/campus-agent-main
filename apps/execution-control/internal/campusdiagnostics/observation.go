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
	NoticeID        string   `json:"noticeId,omitempty"`
	DocumentID      string   `json:"documentId,omitempty"`
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
	EffectiveQuery             string           `json:"effectiveQuery"`
	RerankQuery                string           `json:"rerankQuery"`
	CitationStart              int              `json:"citationStart"`
	ResultLimit                int              `json:"resultLimit"`
	RetrievalMode              string           `json:"retrievalMode,omitempty"`
	Durations                  map[string]int64 `json:"durations"`
	RetrievedCount             int              `json:"retrievedCount"`
	DeduplicatedCount          int              `json:"deduplicatedCount"`
	RerankInputCount           int              `json:"rerankInputCount"`
	RerankKeptCount            int              `json:"rerankKeptCount"`
	SourceGroupedCount         int              `json:"sourceGroupedCount"`
	SourceGroupedExcludedCount int              `json:"sourceGroupedExcludedCount"`
	ReturnedCount              int              `json:"returnedCount"`
	ExcludedCount              int              `json:"excludedCount"`
	Candidates                 []Candidate      `json:"candidates"`
	SnapshotTruncated          bool             `json:"snapshotTruncated"`
	Embedding                  *EmbeddingMeta   `json:"embedding,omitempty"`
	Retrieval                  *RetrievalMeta   `json:"retrieval,omitempty"`
	Rerank                     *RerankMeta      `json:"rerank,omitempty"`
	FailedStage                string           `json:"failedStage,omitempty"`
}

type EmbeddingMeta struct {
	Provider           string `json:"provider,omitempty"`
	Model              string `json:"model,omitempty"`
	ServiceOrigin      string `json:"serviceOrigin,omitempty"`
	Dimensions         int    `json:"dimensions,omitempty"`
	InstructionVersion string `json:"instructionVersion,omitempty"`
	CacheOutcome       string `json:"cacheOutcome,omitempty"`
	CacheWaitMs        int64  `json:"cacheWaitMs,omitempty"`
	EstimatedSavedMs   int64  `json:"estimatedSavedMs,omitempty"`
}

type RetrievalMeta struct {
	Collection    string   `json:"collection,omitempty"`
	HTTPMs        *int64   `json:"httpMs"`
	QdrantMs      *float64 `json:"qdrantMs"`
	DecodeMs      *int64   `json:"decodeMs"`
	PostprocessMs *int64   `json:"postprocessMs"`
}

type RerankMeta struct {
	Provider   string `json:"provider,omitempty"`
	Model      string `json:"model,omitempty"`
	HTTPMs     *int64 `json:"httpMs"`
	InputCount int    `json:"inputCount,omitempty"`
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
	_ = RecordError(ctx, store, observation)
}

func RecordError(ctx context.Context, store any, observation Observation) error {
	writer, ok := store.(Store)
	if !ok {
		return nil
	}
	bounded, cancel := context.WithTimeout(context.WithoutCancel(ctx), 200*time.Millisecond)
	defer cancel()
	return writer.ObserveCampusSearch(bounded, observation)
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
