package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/httpapi"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/rageval"
)

type firstStageExecutorFactory func(context.Context) (rageval.FirstStageExecutor, error)

func main() {
	if err := run(os.Args[1:], os.Stdout, defaultExecutorFactory); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run(args []string, output io.Writer, factory firstStageExecutorFactory) error {
	flags := flag.NewFlagSet("rag-first-stage-eval-runner", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	qrelsPath := flags.String("qrels", "", "retrieval qrels fixture path")
	outputPath := flags.String("output", "", "candidate result output path")
	variantID := flags.String("variant-id", "", "candidate variant id")
	topK := flags.Int("top-k", 0, "retrieval top k")
	densePrefetchLimit := flags.Int("dense-prefetch-limit", 0, "dense prefetch limit")
	sparsePrefetchLimit := flags.Int("sparse-prefetch-limit", 0, "sparse prefetch limit")
	rrfK := flags.Int("rrf-k", 60, "RRF k")
	rrfDenseWeight := flags.Float64("rrf-dense-weight", 1, "RRF dense weight")
	rrfSparseWeight := flags.Float64("rrf-sparse-weight", 1, "RRF sparse weight")
	rerankerEnabled := flags.Bool("reranker-enabled", false, "enable reranker for final sources")
	jsonOutput := flags.Bool("json", false, "write JSON summary to stdout")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if *qrelsPath == "" {
		return fmt.Errorf("--qrels is required")
	}
	if *outputPath == "" {
		return fmt.Errorf("--output is required")
	}
	ctx := context.Background()
	executor, err := factory(ctx)
	if err != nil {
		return err
	}
	result, err := rageval.BuildFirstStageCandidateResult(ctx, rageval.FirstStageRunOptions{
		Candidate: rageval.CandidateParameters{
			DensePrefetchLimit:  *densePrefetchLimit,
			RerankerEnabled:     *rerankerEnabled,
			RetrievalTopK:       *topK,
			RRFDenseWeight:      *rrfDenseWeight,
			RRFK:                *rrfK,
			RRFSparseWeight:     *rrfSparseWeight,
			SparsePrefetchLimit: *sparsePrefetchLimit,
			VariantID:           *variantID,
		},
		Executor:  executor,
		QrelsPath: *qrelsPath,
	})
	if err != nil {
		return err
	}
	if err := rageval.WriteCandidateResult(*outputPath, result); err != nil {
		return err
	}
	summary := map[string]any{
		"case_count":      len(result.Cases),
		"output_path":     *outputPath,
		"schema_version":  result.SchemaVersion,
		"surface_key":     result.SurfaceKey,
		"variant_id":      result.VariantID,
		"failed_case_ids": failedCaseIDs(result.Cases),
	}
	if *jsonOutput {
		encoder := json.NewEncoder(output)
		encoder.SetIndent("", "  ")
		return encoder.Encode(summary)
	}
	_, err = fmt.Fprintf(
		output,
		"wrote %s for %s (%d cases)\n",
		*outputPath,
		result.SurfaceKey,
		len(result.Cases),
	)
	return err
}

func defaultExecutorFactory(context.Context) (rageval.FirstStageExecutor, error) {
	cfg, err := config.LoadFromEnv()
	if err != nil {
		return nil, err
	}
	return httpapi.NewRAGFirstStageEvalExecutor(cfg)
}

func failedCaseIDs(cases []rageval.CandidateCase) []string {
	failed := []string{}
	for _, item := range cases {
		if item.Status != rageval.CaseStatusCompleted {
			failed = append(failed, item.CaseID)
		}
	}
	return failed
}
