package campussearch

import (
	"context"
	"time"
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
	PhaseTimes                 map[string]time.Time `json:"phaseTimes"`
	FailureDetail              string               `json:"failureDetail,omitempty"`
	EffectiveQuery             string               `json:"effectiveQuery"`
	RerankQuery                string               `json:"rerankQuery"`
	CitationStart              int                  `json:"citationStart"`
	ResultLimit                int                  `json:"resultLimit"`
	RetrievalMode              string               `json:"retrievalMode,omitempty"`
	Durations                  map[string]int64     `json:"durations"`
	RetrievedCount             int                  `json:"retrievedCount"`
	DeduplicatedCount          int                  `json:"deduplicatedCount"`
	RerankInputCount           int                  `json:"rerankInputCount"`
	RerankKeptCount            int                  `json:"rerankKeptCount"`
	SourceGroupedCount         int                  `json:"sourceGroupedCount"`
	SourceGroupedExcludedCount int                  `json:"sourceGroupedExcludedCount"`
	ReturnedCount              int                  `json:"returnedCount"`
	ExcludedCount              int                  `json:"excludedCount"`
	Candidates                 []Candidate          `json:"candidates"`
	SnapshotTruncated          bool                 `json:"snapshotTruncated"`
	Embedding                  *EmbeddingMeta       `json:"embedding,omitempty"`
	Retrieval                  *RetrievalMeta       `json:"retrieval,omitempty"`
	Rerank                     *RerankMeta          `json:"rerank,omitempty"`
	FailedStage                string               `json:"failedStage,omitempty"`
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
	HTTPStatus    *int     `json:"httpStatus,omitempty"`
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

type SearchObserver struct {
	Snapshot *Snapshot
	Phase    func(string)
}

type searchObserverKey struct{}

func WithSearchObserver(ctx context.Context, observer *SearchObserver) context.Context {
	return context.WithValue(ctx, searchObserverKey{}, observer)
}

func SearchObservation(ctx context.Context) *SearchObserver {
	if observer, ok := ctx.Value(searchObserverKey{}).(*SearchObserver); ok {
		return observer
	}
	return &SearchObserver{Snapshot: &Snapshot{Durations: map[string]int64{}}, Phase: func(string) {}}
}

func Bound(text string, limit int) string {
	runes := []rune(text)
	if len(runes) > limit {
		return string(runes[:limit])
	}
	return text
}

// SearchErrorResponse carries diagnostics only on the authenticated internal API.
type SearchErrorResponse struct {
	Error       SearchErrorDetail `json:"error"`
	Diagnostics *Snapshot         `json:"diagnostics,omitempty"`
}

type SearchErrorDetail struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}
