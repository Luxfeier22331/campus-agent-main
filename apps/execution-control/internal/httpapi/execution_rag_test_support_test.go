package httpapi

import (
	"context"
	"strings"
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/provider"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/ragruntime"
)

type fakeRAGLookupExecutor struct {
	err      error
	result   ragruntime.RetrievalLookupResult
	seenPlan ragruntime.PlanProjection
}

type fakeRAGVersionResolver struct {
	err      error
	resolved ragruntime.ResolvedVersionQueryProjection
}

func (f fakeRAGVersionResolver) ResolveRAGVersionQuery(
	_ context.Context,
	plan ragruntime.PlanProjection,
) (ragruntime.ResolvedVersionQueryProjection, error) {
	if f.err != nil {
		return ragruntime.ResolvedVersionQueryProjection{}, f.err
	}
	if f.resolved.Mode != "" {
		return f.resolved, nil
	}
	if plan.VersionQuery != nil && plan.QueryMode == "compare" {
		return ragruntime.ResolvedVersionQueryProjection{
			CompareToVersionID: plan.VersionQuery.CompareToVersionID,
			Mode:               "compare",
			TargetVersionIDs:   []string{plan.VersionQuery.VersionID, plan.VersionQuery.CompareToVersionID},
			VersionID:          plan.VersionQuery.VersionID,
		}, nil
	}
	if plan.VersionQuery != nil && plan.QueryMode == "historical" {
		return ragruntime.ResolvedVersionQueryProjection{
			Mode:             "historical",
			TargetVersionIDs: []string{plan.VersionQuery.VersionID},
			VersionID:        plan.VersionQuery.VersionID,
		}, nil
	}
	if plan.VersionQuery != nil && plan.QueryMode == "as_of" {
		return ragruntime.ResolvedVersionQueryProjection{
			AsOf:             plan.VersionQuery.AsOf,
			Mode:             "as_of",
			TargetVersionIDs: []string{"student_rules:v-as-of"},
			VersionID:        "student_rules:v-as-of",
		}, nil
	}
	return ragruntime.ResolvedVersionQueryProjection{
		Mode:             "current",
		TargetVersionIDs: []string{"student_rules:v-current"},
		VersionID:        "student_rules:v-current",
	}, nil
}

func (f *fakeRAGLookupExecutor) HealthCheck(context.Context) error {
	return f.err
}

func (f *fakeRAGLookupExecutor) Lookup(
	_ context.Context,
	plan ragruntime.PlanProjection,
) (ragruntime.RetrievalLookupResult, error) {
	f.seenPlan = plan
	if f.err != nil {
		return ragruntime.RetrievalLookupResult{}, f.err
	}
	result := f.result
	if result.SchemaVersion == "" {
		result = validLookupResultForTest(plan)
	}
	return result, nil
}

type fakeRAGSynthesisExecutor struct {
	answerText       string
	calls            int
	err              error
	grounding        string
	llmIOFingerprint map[string]any
	onExecute        func(context.Context)
	promptTrace      map[string]any
	status           int
	seenPacket       ragSynthesisPacket
	summary          provider.ExecutionSummary
	traceID          string
}

func (f *fakeRAGSynthesisExecutor) HealthCheck(context.Context) error {
	return f.err
}

func (f *fakeRAGSynthesisExecutor) ExecuteRAGSynthesis(
	ctx context.Context,
	packet ragSynthesisPacket,
) (ragSynthesisResult, error) {
	f.calls++
	f.seenPacket = packet
	if f.onExecute != nil {
		f.onExecute(ctx)
	}
	if f.err != nil {
		return ragSynthesisResult{ProviderStatus: f.status, ProviderSummary: f.summary}, f.err
	}
	answerText := f.answerText
	if answerText == "" {
		answerText = "学生应按学校规定办理请假手续。"
	}
	promptTrace := f.promptTrace
	if promptTrace == nil {
		promptTrace = ragSynthesisPromptTrace("openai", "gpt-5-mini")
	}
	llmIOFingerprint := f.llmIOFingerprint
	if llmIOFingerprint == nil {
		traceID := strings.TrimSpace(f.traceID)
		if traceID == "" {
			traceID = "trace-executor-001"
		}
		fingerprint, fingerprintErr := ragSynthesisLLMIOFingerprint(ragSynthesisFingerprintInput{
			modelName:     "gpt-5-mini",
			modelProvider: "openai",
			packet:        packet,
			providerProfileRevision: providerProfileRevisionFingerprint(providerConfigSnapshot{
				Role:      string(providerConfigRoleRAGSynthesis),
				ProfileID: "rag-default",
				Revision:  3,
			}),
			renderedInput: ragProviderInput(packet),
			requestID:     packet.RequestID,
			run: execution.DurableRun{
				RequestID: packet.RequestID,
				RunID:     packet.RunID,
				TraceID:   traceID,
			},
			runtimeRelease: "execution-control@test",
		})
		if fingerprintErr != nil {
			return ragSynthesisResult{}, fingerprintErr
		}
		llmIOFingerprint = fingerprint
	}
	return ragSynthesisResult{
		AnswerText:              answerText,
		Confidence:              "high",
		GroundingVerdict:        strings.TrimSpace(f.grounding),
		LLMIOFingerprint:        llmIOFingerprint,
		PromptTrace:             promptTrace,
		ProviderProfileRevision: "rag_synthesis:rag-default:3",
		ProviderStatus:          f.status,
		ProviderSummary:         f.summary,
		SemanticOutcome:         "answer_from_selected_evidence",
	}, nil
}

func validLookupResultForTest(plan ragruntime.PlanProjection) ragruntime.RetrievalLookupResult {
	result := ragruntime.RetrievalLookupResult{
		CandidateCount: 1,
		Candidates: []ragruntime.EvidenceRef{{
			Anchor:          "leave",
			ChunkID:         "student_rules:chunk-1",
			DocumentID:      "student_rules",
			Excerpt:         "学生应当按照学校规定办理请假手续。",
			IsAnswerBearing: true,
			RootUnitID:      "student_rules:root:leave",
			Score:           0.91,
			SourceID:        "student_rules",
			SourceRef:       "source://regulations/student_rules/student_rules",
			SourceTrustTier: "T1",
			SpanRef:         "span://student_rules/chunk-1#0-24",
			Title:           "学生手册",
			VersionID:       "student_rules:v-current",
		}},
		LookupRef:      temporalProjectionRef(plan.RunID, "retrieval/indexed-lookup"),
		QueryLatencyMS: 12,
		Request: ragruntime.RetrievalLookupRequest{
			CollectionAlias: plan.CollectionAlias,
			QueryMode:       plan.QueryMode,
			QueryText:       plan.QueryText,
			RunID:           plan.RunID,
			TopK:            plan.TopK,
		},
		SchemaVersion: "retrieval_lookup_result_v1",
	}
	hash, err := ragruntime.HashProjection(result)
	if err != nil {
		panic(err)
	}
	result.PayloadSHA256 = hash
	return result
}

func publicRetrievalAccessProjectionForTest() ragruntime.RetrievalAccessProjection {
	return ragruntime.RetrievalAccessProjection{
		PolicyProjectionVersion: "phase1-authorization-projection-v1",
		VisibilityLevel:         "public",
	}
}

func publicRetrievalFilterForTest() map[string]any {
	return map[string]any{
		"policy_projection_version": "phase1-authorization-projection-v1",
		"visibility_level":          "public",
	}
}

func addRequestedScopeForRunTest(
	t *testing.T,
	store *execution.InMemoryRunProjectionStore,
	runID string,
	corpus string,
	collection string,
) {
	t.Helper()
	run, err := store.GetRun(context.Background(), runID)
	if err != nil {
		t.Fatalf("get run for scope update: %v", err)
	}
	metadata := cloneTemporalMetadata(run.Metadata)
	payload, _ := metadata["execution_payload"].(map[string]any)
	if payload == nil {
		payload = map[string]any{}
	}
	payload["requested_scope"] = map[string]any{"corpus": corpus, "collection": collection}
	ensurePublicRetrievalAccessForRunTest(payload)
	metadata["execution_payload"] = payload
	if err := store.ReplaceRunMetadata(context.Background(), runID, metadata); err != nil {
		t.Fatalf("replace run metadata: %v", err)
	}
}

func setVersionQueryForRunTest(
	t *testing.T,
	store *execution.InMemoryRunProjectionStore,
	runID string,
	versionQuery map[string]any,
) {
	t.Helper()
	run, err := store.GetRun(context.Background(), runID)
	if err != nil {
		t.Fatalf("get run for version query update: %v", err)
	}
	metadata := cloneTemporalMetadata(run.Metadata)
	payload, _ := metadata["execution_payload"].(map[string]any)
	if payload == nil {
		payload = map[string]any{}
	}
	payload["version_query"] = versionQuery
	metadata["execution_payload"] = payload
	if err := store.ReplaceRunMetadata(context.Background(), runID, metadata); err != nil {
		t.Fatalf("replace run metadata: %v", err)
	}
}

func setFreshnessIntentForRunTest(
	t *testing.T,
	store *execution.InMemoryRunProjectionStore,
	runID string,
	freshnessIntent string,
) {
	t.Helper()
	run, err := store.GetRun(context.Background(), runID)
	if err != nil {
		t.Fatalf("get run for freshness intent update: %v", err)
	}
	metadata := cloneTemporalMetadata(run.Metadata)
	payload, _ := metadata["execution_payload"].(map[string]any)
	if payload == nil {
		payload = map[string]any{}
	}
	payload["freshness_intent"] = freshnessIntent
	metadata["execution_payload"] = payload
	if err := store.ReplaceRunMetadata(context.Background(), runID, metadata); err != nil {
		t.Fatalf("replace run metadata: %v", err)
	}
}

func ensurePublicRetrievalAccessForRunTest(payload map[string]any) {
	contextProjection, _ := payload["context"].(map[string]any)
	if contextProjection == nil {
		contextProjection = map[string]any{}
		payload["context"] = contextProjection
	}
	authorization, _ := contextProjection["authorization"].(map[string]any)
	if authorization == nil {
		authorization = map[string]any{}
		contextProjection["authorization"] = authorization
	}
	if _, ok := authorization["retrieval_filter"].(map[string]any); !ok {
		authorization["retrieval_filter"] = publicRetrievalFilterForTest()
	}
}

func assertStepIDs(t *testing.T, steps []execution.RunStepProjection, expected []string) {
	t.Helper()
	if len(steps) != len(expected) {
		t.Fatalf("step count = %d, want %d: %#v", len(steps), len(expected), steps)
	}
	seen := map[string]bool{}
	for _, step := range steps {
		seen[step.StepID] = true
	}
	for _, stepID := range expected {
		if !seen[stepID] {
			t.Fatalf("step %q missing from %#v", stepID, steps)
		}
	}
}
