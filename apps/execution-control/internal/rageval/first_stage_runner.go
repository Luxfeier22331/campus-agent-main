package rageval

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"
	"time"
)

const (
	CandidateSchemaVersion = "rag_first_stage_candidate_result.v1"
	CaseStatusCompleted    = "completed"
	CaseStatusFailed       = "failed"
	StageDensePrefetch     = "dense_prefetch"
	StageSparsePrefetch    = "sparse_prefetch"
	StageRRFFinal          = "rrf_final"
	StageRerankFinal       = "rerank_final"
)

type CandidateParameters struct {
	VariantID           string
	RetrievalTopK       int
	DensePrefetchLimit  int
	SparsePrefetchLimit int
	RRFK                int
	RRFDenseWeight      float64
	RRFSparseWeight     float64
	RerankerEnabled     bool
}

type FirstStageRunOptions struct {
	Candidate CandidateParameters
	Executor  FirstStageExecutor
	QrelsPath string
}

type FirstStageExecutor interface {
	Lookup(context.Context, LookupRequest) (LookupResult, error)
}

type LookupRequest struct {
	CaseID              string
	Collection          string
	Corpus              string
	DensePrefetchLimit  int
	QueryText           string
	RerankerEnabled     bool
	RetrievalTopK       int
	RRFDenseWeight      float64
	RRFK                int
	RRFSparseWeight     float64
	SparsePrefetchLimit int
	VariantID           string
}

type LookupResult struct {
	LatencyMS       int64
	PrefetchSources []CandidateSource
	FinalSources    []CandidateSource
}

type CandidateResult struct {
	SchemaVersion       string          `json:"schema_version"`
	SurfaceKey          string          `json:"surface_key"`
	VariantID           string          `json:"variant_id"`
	RetrievalTopK       int             `json:"retrieval_top_k"`
	DensePrefetchLimit  int             `json:"dense_prefetch_limit"`
	SparsePrefetchLimit int             `json:"sparse_prefetch_limit"`
	RRFK                int             `json:"rrf_k"`
	RRFDenseWeight      float64         `json:"rrf_dense_weight"`
	RRFSparseWeight     float64         `json:"rrf_sparse_weight"`
	RerankerEnabled     bool            `json:"reranker_enabled"`
	Cases               []CandidateCase `json:"cases"`
}

type CandidateCase struct {
	CaseID          string            `json:"case_id"`
	Status          string            `json:"status"`
	LatencyMS       int64             `json:"latency_ms"`
	PrefetchSources []CandidateSource `json:"prefetch_sources"`
	FinalSources    []CandidateSource `json:"final_sources"`
}

type CandidateSource struct {
	Rank      int      `json:"rank"`
	Stage     string   `json:"stage"`
	DocID     string   `json:"doc_id"`
	VersionID *string  `json:"version_id"`
	ChunkID   *string  `json:"chunk_id"`
	Score     *float64 `json:"score"`
}

type qrelsFixture struct {
	SchemaVersion int         `json:"schema_version"`
	Corpus        string      `json:"corpus"`
	Collection    string      `json:"collection"`
	Cases         []qrelsCase `json:"cases"`
}

type qrelsCase struct {
	CaseID string `json:"case_id"`
	Query  string `json:"query"`
}

func BuildFirstStageCandidateResult(
	ctx context.Context,
	options FirstStageRunOptions,
) (CandidateResult, error) {
	if options.Executor == nil {
		return CandidateResult{}, errors.New("first-stage executor is required")
	}
	if err := validateCandidateParameters(options.Candidate); err != nil {
		return CandidateResult{}, err
	}
	fixture, err := loadQrels(options.QrelsPath)
	if err != nil {
		return CandidateResult{}, err
	}
	result := CandidateResult{
		SchemaVersion:       CandidateSchemaVersion,
		SurfaceKey:          fixture.Corpus + "/" + fixture.Collection,
		VariantID:           options.Candidate.VariantID,
		RetrievalTopK:       options.Candidate.RetrievalTopK,
		DensePrefetchLimit:  options.Candidate.DensePrefetchLimit,
		SparsePrefetchLimit: options.Candidate.SparsePrefetchLimit,
		RRFK:                options.Candidate.RRFK,
		RRFDenseWeight:      options.Candidate.RRFDenseWeight,
		RRFSparseWeight:     options.Candidate.RRFSparseWeight,
		RerankerEnabled:     options.Candidate.RerankerEnabled,
		Cases:               make([]CandidateCase, 0, len(fixture.Cases)),
	}
	for _, item := range fixture.Cases {
		started := time.Now()
		lookup, err := options.Executor.Lookup(ctx, LookupRequest{
			CaseID:              item.CaseID,
			Collection:          fixture.Collection,
			Corpus:              fixture.Corpus,
			DensePrefetchLimit:  options.Candidate.DensePrefetchLimit,
			QueryText:           item.Query,
			RerankerEnabled:     options.Candidate.RerankerEnabled,
			RetrievalTopK:       options.Candidate.RetrievalTopK,
			RRFDenseWeight:      options.Candidate.RRFDenseWeight,
			RRFK:                options.Candidate.RRFK,
			RRFSparseWeight:     options.Candidate.RRFSparseWeight,
			SparsePrefetchLimit: options.Candidate.SparsePrefetchLimit,
			VariantID:           options.Candidate.VariantID,
		})
		if err != nil {
			result.Cases = append(result.Cases, CandidateCase{
				CaseID:          item.CaseID,
				Status:          CaseStatusFailed,
				LatencyMS:       elapsedMillis(started),
				PrefetchSources: []CandidateSource{},
				FinalSources:    []CandidateSource{},
			})
			continue
		}
		if lookup.LatencyMS <= 0 {
			return CandidateResult{}, fmt.Errorf("case %s latency_ms is required", item.CaseID)
		}
		if err := validateCandidateSources(lookup.PrefetchSources, "prefetch_sources"); err != nil {
			return CandidateResult{}, fmt.Errorf("case %s: %w", item.CaseID, err)
		}
		if err := validateCandidateSources(lookup.FinalSources, "final_sources"); err != nil {
			return CandidateResult{}, fmt.Errorf("case %s: %w", item.CaseID, err)
		}
		result.Cases = append(result.Cases, CandidateCase{
			CaseID:          item.CaseID,
			Status:          CaseStatusCompleted,
			LatencyMS:       lookup.LatencyMS,
			PrefetchSources: lookup.PrefetchSources,
			FinalSources:    lookup.FinalSources,
		})
	}
	return result, nil
}

func WriteCandidateResult(path string, result CandidateResult) error {
	body, err := json.MarshalIndent(result, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, append(body, '\n'), 0o644)
}

func loadQrels(path string) (qrelsFixture, error) {
	trimmedPath := strings.TrimSpace(path)
	if trimmedPath == "" {
		return qrelsFixture{}, errors.New("qrels path is required")
	}
	body, err := os.ReadFile(trimmedPath)
	if err != nil {
		return qrelsFixture{}, fmt.Errorf("read qrels: %w", err)
	}
	var fixture qrelsFixture
	if err := json.Unmarshal(body, &fixture); err != nil {
		return qrelsFixture{}, fmt.Errorf("parse qrels: %w", err)
	}
	if fixture.SchemaVersion <= 0 {
		return qrelsFixture{}, errors.New("qrels schema_version is required")
	}
	fixture.Corpus = strings.TrimSpace(fixture.Corpus)
	fixture.Collection = strings.TrimSpace(fixture.Collection)
	if fixture.Corpus == "" || fixture.Collection == "" {
		return qrelsFixture{}, errors.New("qrels corpus and collection are required")
	}
	if len(fixture.Cases) == 0 {
		return qrelsFixture{}, errors.New("qrels cases must be non-empty")
	}
	for index := range fixture.Cases {
		fixture.Cases[index].CaseID = strings.TrimSpace(fixture.Cases[index].CaseID)
		fixture.Cases[index].Query = strings.TrimSpace(fixture.Cases[index].Query)
		if fixture.Cases[index].CaseID == "" || fixture.Cases[index].Query == "" {
			return qrelsFixture{}, fmt.Errorf("qrels cases[%d] requires case_id and query", index)
		}
	}
	return fixture, nil
}

func validateCandidateParameters(candidate CandidateParameters) error {
	if strings.TrimSpace(candidate.VariantID) == "" {
		return errors.New("variant_id is required")
	}
	if candidate.RetrievalTopK <= 0 ||
		candidate.DensePrefetchLimit <= 0 ||
		candidate.SparsePrefetchLimit <= 0 ||
		candidate.RRFK <= 0 {
		return errors.New("retrieval_top_k, dense_prefetch_limit, sparse_prefetch_limit and rrf_k must be positive")
	}
	if candidate.RRFDenseWeight <= 0 || candidate.RRFSparseWeight <= 0 {
		return errors.New("rrf_dense_weight and rrf_sparse_weight must be positive")
	}
	return nil
}

func validateCandidateSources(sources []CandidateSource, field string) error {
	for index, source := range sources {
		if source.Rank <= 0 {
			return fmt.Errorf("%s[%d].rank must be positive", field, index)
		}
		switch source.Stage {
		case StageDensePrefetch, StageSparsePrefetch, StageRRFFinal, StageRerankFinal:
		default:
			return fmt.Errorf("%s[%d].stage is unsupported", field, index)
		}
		if strings.TrimSpace(source.DocID) == "" {
			return fmt.Errorf("%s[%d].doc_id is required", field, index)
		}
	}
	return nil
}

func elapsedMillis(started time.Time) int64 {
	elapsed := time.Since(started).Milliseconds()
	if elapsed <= 0 {
		return 1
	}
	return elapsed
}
