package rageval

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestBuildFirstStageCandidateResultRunsAllQrelsCases(t *testing.T) {
	dir := t.TempDir()
	qrelsPath := filepath.Join(dir, "retrieval_qrels.json")
	if err := os.WriteFile(qrelsPath, []byte(`{
		"schema_version": 1,
		"corpus": "regulations",
		"collection": "student_rules",
		"cases": [
			{
				"case_id": "positive",
				"query": "学生证丢了怎么办",
				"expected_sources": [{"doc_id": "doc-expected", "version_id": "v1"}]
			},
			{
				"case_id": "no-hit",
				"query": "不存在的问题",
				"expected_sources": []
			}
		]
	}`), 0o644); err != nil {
		t.Fatalf("write qrels: %v", err)
	}
	executor := &fakeExecutor{
		results: map[string]LookupResult{
			"positive": {
				LatencyMS: 17,
				PrefetchSources: []CandidateSource{{
					Rank: 1, Stage: StageDensePrefetch, DocID: "doc-expected", VersionID: ptr("v1"), ChunkID: ptr("chunk-1"), Score: ptrFloat(0.91),
				}},
				FinalSources: []CandidateSource{{
					Rank: 1, Stage: StageRRFFinal, DocID: "doc-expected", VersionID: ptr("v1"), ChunkID: ptr("chunk-1"), Score: ptrFloat(0.91),
				}},
			},
			"no-hit": {
				LatencyMS:       11,
				PrefetchSources: []CandidateSource{},
				FinalSources:    []CandidateSource{},
			},
		},
	}

	result, err := BuildFirstStageCandidateResult(context.Background(), FirstStageRunOptions{
		Candidate: CandidateParameters{
			DensePrefetchLimit:  20,
			RerankerEnabled:     false,
			RetrievalTopK:       3,
			RRFDenseWeight:      1,
			RRFK:                60,
			RRFSparseWeight:     1,
			SparsePrefetchLimit: 20,
			VariantID:           "topk3-d20-s20",
		},
		Executor:  executor,
		QrelsPath: qrelsPath,
	})
	if err != nil {
		t.Fatalf("build candidate result: %v", err)
	}

	if result.SchemaVersion != CandidateSchemaVersion {
		t.Fatalf("schema = %q", result.SchemaVersion)
	}
	if result.SurfaceKey != "regulations/student_rules" {
		t.Fatalf("surface = %q", result.SurfaceKey)
	}
	if len(result.Cases) != 2 {
		t.Fatalf("cases = %d, want 2", len(result.Cases))
	}
	if len(executor.requests) != 2 {
		t.Fatalf("requests = %d, want 2", len(executor.requests))
	}
	if executor.requests[0].RetrievalTopK != 3 || executor.requests[0].DensePrefetchLimit != 20 {
		t.Fatalf("request params = %#v", executor.requests[0])
	}
	if result.Cases[0].Status != CaseStatusCompleted || result.Cases[0].LatencyMS != 17 {
		t.Fatalf("positive case = %#v", result.Cases[0])
	}
	encoded, err := json.Marshal(result)
	if err != nil {
		t.Fatalf("marshal result: %v", err)
	}
	var decoded map[string]any
	if err := json.Unmarshal(encoded, &decoded); err != nil {
		t.Fatalf("decode result: %v", err)
	}
	if decoded["schema_version"] != CandidateSchemaVersion {
		t.Fatalf("encoded schema = %#v", decoded["schema_version"])
	}
}

func TestBuildFirstStageCandidateResultFailsClosedWithoutLatency(t *testing.T) {
	dir := t.TempDir()
	qrelsPath := filepath.Join(dir, "retrieval_qrels.json")
	if err := os.WriteFile(qrelsPath, []byte(`{
		"schema_version": 1,
		"corpus": "regulations",
		"collection": "student_rules",
		"cases": [{"case_id": "positive", "query": "学生证", "expected_sources": []}]
	}`), 0o644); err != nil {
		t.Fatalf("write qrels: %v", err)
	}

	_, err := BuildFirstStageCandidateResult(context.Background(), FirstStageRunOptions{
		Candidate: CandidateParameters{
			DensePrefetchLimit:  20,
			RetrievalTopK:       3,
			RRFK:                60,
			RRFDenseWeight:      1,
			RRFSparseWeight:     1,
			SparsePrefetchLimit: 20,
			VariantID:           "topk3-d20-s20",
		},
		Executor: fakeExecutorFunc(func(context.Context, LookupRequest) (LookupResult, error) {
			return LookupResult{}, nil
		}),
		QrelsPath: qrelsPath,
	})
	if err == nil {
		t.Fatal("missing latency must fail closed")
	}
}

type fakeExecutor struct {
	requests []LookupRequest
	results  map[string]LookupResult
}

func (f *fakeExecutor) Lookup(ctx context.Context, request LookupRequest) (LookupResult, error) {
	f.requests = append(f.requests, request)
	return f.results[request.CaseID], nil
}

type fakeExecutorFunc func(context.Context, LookupRequest) (LookupResult, error)

func (f fakeExecutorFunc) Lookup(ctx context.Context, request LookupRequest) (LookupResult, error) {
	return f(ctx, request)
}

func ptr(value string) *string {
	return &value
}

func ptrFloat(value float64) *float64 {
	return &value
}
