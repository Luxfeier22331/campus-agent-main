package main

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/rageval"
)

func TestRunWritesCandidateResultFromInjectedExecutor(t *testing.T) {
	dir := t.TempDir()
	qrelsPath := filepath.Join(dir, "qrels.json")
	outputPath := filepath.Join(dir, "candidate.json")
	if err := os.WriteFile(qrelsPath, []byte(`{
		"schema_version": 1,
		"corpus": "regulations",
		"collection": "student_rules",
		"cases": [{"case_id": "leave-policy", "query": "学生请假手续"}]
	}`), 0o644); err != nil {
		t.Fatalf("write qrels: %v", err)
	}
	var stdout bytes.Buffer
	executor := fakeFirstStageExecutor{
		result: rageval.LookupResult{
			LatencyMS: 12,
			PrefetchSources: []rageval.CandidateSource{{
				Rank: 1, Stage: rageval.StageDensePrefetch, DocID: "doc-leave", ChunkID: ptr("chunk-1"),
			}},
			FinalSources: []rageval.CandidateSource{{
				Rank: 1, Stage: rageval.StageRRFFinal, DocID: "doc-leave", ChunkID: ptr("chunk-1"),
			}},
		},
	}

	err := run(
		[]string{
			"--qrels", qrelsPath,
			"--output", outputPath,
			"--variant-id", "topk3-d20-s20",
			"--top-k", "3",
			"--dense-prefetch-limit", "20",
			"--sparse-prefetch-limit", "20",
			"--rrf-k", "60",
			"--rrf-dense-weight", "1",
			"--rrf-sparse-weight", "1",
			"--json",
		},
		&stdout,
		func(context.Context) (rageval.FirstStageExecutor, error) { return &executor, nil },
	)
	if err != nil {
		t.Fatalf("run: %v", err)
	}

	var candidate rageval.CandidateResult
	if err := json.Unmarshal(mustReadFile(t, outputPath), &candidate); err != nil {
		t.Fatalf("decode candidate: %v", err)
	}
	if candidate.SchemaVersion != rageval.CandidateSchemaVersion {
		t.Fatalf("schema = %q", candidate.SchemaVersion)
	}
	if candidate.SurfaceKey != "regulations/student_rules" || candidate.VariantID != "topk3-d20-s20" {
		t.Fatalf("candidate identity = %#v", candidate)
	}
	if len(candidate.Cases) != 1 || len(candidate.Cases[0].PrefetchSources) != 1 {
		t.Fatalf("cases = %#v", candidate.Cases)
	}
	if len(executor.requests) != 1 || executor.requests[0].RRFDenseWeight != 1 {
		t.Fatalf("executor requests = %#v", executor.requests)
	}
	var summary map[string]any
	if err := json.Unmarshal(stdout.Bytes(), &summary); err != nil {
		t.Fatalf("decode stdout: %v", err)
	}
	if summary["output_path"] != outputPath || summary["case_count"] != float64(1) {
		t.Fatalf("summary = %#v", summary)
	}
}

type fakeFirstStageExecutor struct {
	requests []rageval.LookupRequest
	result   rageval.LookupResult
}

func (f *fakeFirstStageExecutor) Lookup(
	_ context.Context,
	request rageval.LookupRequest,
) (rageval.LookupResult, error) {
	f.requests = append(f.requests, request)
	return f.result, nil
}

func mustReadFile(t *testing.T, path string) []byte {
	t.Helper()
	body, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	return body
}

func ptr(value string) *string {
	return &value
}
