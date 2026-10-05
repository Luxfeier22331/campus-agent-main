package outbound

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/campus-search/campussearch"
)

func TestOptionalQdrantTimingCannotFailRetrieval(t *testing.T) {
	for _, value := range []string{"null", "\"unknown\"", "-1", "1e400", "true"} {
		meta := &campussearch.RetrievalMeta{}
		points, err := decodeCampusDocsQdrantQueryResponse([]byte(`{"time":`+value+`,"result":{"points":[]}}`), meta)
		if err != nil || len(points) != 0 || meta.QdrantMs != nil {
			t.Fatalf("optional time %s changed retrieval: %v %v", value, points, err)
		}
	}
}

func TestCampusSearchKeepsComplementaryNoticeSectionsAndExcludesPriorEvidence(t *testing.T) {
	notice := func(id, chunk, section string) qdrantPoint {
		return qdrantPoint{ID: chunk, Score: .1, Payload: map[string]any{
			"source_kind": "notice", "schema_version": "campus_rag_point.v1",
			"notice_id": id, "chunk_id": chunk, "title": "通知", "section_title": section,
			"citation_href": "/notices/" + id, "text": chunk,
			"text_sha256":           SHA256TextRef(chunk),
			"retrieval_text_sha256": SHA256TextRef("通知\n" + chunk),
		}}
	}
	points := []qdrantPoint{notice("1", "first", "正文"), notice("1", "sibling", "申请条件"), validCampusDocsPointAtTest(0), validCampusDocsPointAtTest(1), notice("2", "other", "正文")}
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/embeddings":
			writeJSON(w, 200, map[string]any{"data": []any{map[string]any{"embedding": make([]float64, campussearch.EmbeddingDimensions)}}})
		case "/v1/rerank":
			// Equal top scores arrive reversed. Retrieval order is the tie breaker.
			writeJSON(w, 200, map[string]any{"results": []any{
				map[string]any{"index": 1, "relevance_score": .9}, map[string]any{"index": 0, "relevance_score": .9},
				map[string]any{"index": 2, "relevance_score": .8}, map[string]any{"index": 3, "relevance_score": .7}, map[string]any{"index": 4, "relevance_score": .6},
			}})
		default:
			writeJSON(w, 200, map[string]any{"time": 0, "result": map[string]any{"points": points}})
		}
	}))
	defer provider.Close()
	client := newCampusDocsHTTPClientForTest(t, Config{DeploymentEnvironment: "local", QdrantURL: provider.URL, QdrantReadOnlyAPIKey: "key"}, campusDocsRuntimeConfigResolverForTest(provider.URL+"/v1"))
	snapshot := &campussearch.Snapshot{CitationStart: 4, Durations: map[string]int64{}}
	ctx := campussearch.WithSearchObserver(t.Context(), &campussearch.SearchObserver{Snapshot: snapshot, Phase: func(string) {}})
	results, err := client.Search(ctx, campussearch.Index{Collection: "campus_docs_" + strings.Repeat("a", 64)}, campussearch.SearchQuery{RetrievalQuery: "查询", RerankQuery: "查询"}, 3)
	if err != nil {
		t.Fatal(err)
	}
	if len(results) != 3 || results[0].Text != "first" || results[1].Text != "sibling" || results[2].SourceKind != "document" {
		t.Fatalf("selection=%+v", results)
	}
	if snapshot.Candidates[1].ExclusionReason != "" || snapshot.Candidates[4].ExclusionReason != "result_limit" {
		t.Fatalf("exclusions=%+v", snapshot.Candidates)
	}
	if snapshot.SourceGroupedCount != 5 || snapshot.SourceGroupedExcludedCount != 0 || snapshot.ExcludedCount != 2 || snapshot.ReturnedCount != 3 {
		t.Fatalf("counts=%+v", snapshot)
	}
	for i, candidateIndex := range []int{0, 1, 2} {
		if got := snapshot.Candidates[candidateIndex].CitationIndex; got == nil || *got != i+4 {
			t.Fatalf("citation %d=%v", candidateIndex, got)
		}
	}
	if snapshot.Retrieval.QdrantMs == nil || *snapshot.Retrieval.QdrantMs != 0 || snapshot.Retrieval.DecodeMs == nil || snapshot.Retrieval.PostprocessMs == nil {
		t.Fatal("zero/missing timing conflated")
	}
	prior := results[0].ResultRef
	snapshot = &campussearch.Snapshot{CitationStart: 11, Durations: map[string]int64{}}
	ctx = campussearch.WithSearchObserver(t.Context(), &campussearch.SearchObserver{Snapshot: snapshot, Phase: func(string) {}})
	results, err = client.Search(ctx, campussearch.Index{Collection: "campus_docs_" + strings.Repeat("a", 64)}, campussearch.SearchQuery{RetrievalQuery: "费用", RerankQuery: "项目费用是什么", ExcludedResultRefs: []string{prior}}, 3)
	if err != nil || len(results) != 3 || results[0].Text != "sibling" || snapshot.Candidates[0].ExclusionReason != "already_returned" {
		t.Fatalf("prior evidence consumed a result slot: %+v %v", results, err)
	}
}

func TestCampusSearchRecordsActualFailureStageAndTimings(t *testing.T) {
	for _, stage := range []string{"embedding", "retrieval", "rerank"} {
		t.Run(stage, func(t *testing.T) {
			provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				current := "retrieval"
				if r.URL.Path == "/v1/embeddings" {
					current = "embedding"
				}
				if r.URL.Path == "/v1/rerank" {
					current = "rerank"
				}
				if current == stage {
					w.WriteHeader(503)
					return
				}
				switch current {
				case "embedding":
					writeJSON(w, 200, map[string]any{"data": []any{map[string]any{"embedding": make([]float64, campussearch.EmbeddingDimensions)}}})
				default:
					writeJSON(w, 200, map[string]any{"time": 0.001, "result": map[string]any{"points": []qdrantPoint{validCampusDocsPointAtTest(0)}}})
				}
			}))
			defer provider.Close()
			client := newCampusDocsHTTPClientForTest(t, Config{DeploymentEnvironment: "local", QdrantURL: provider.URL, QdrantReadOnlyAPIKey: "secret"}, campusDocsRuntimeConfigResolverForTest(provider.URL+"/v1"))
			snapshot := &campussearch.Snapshot{Durations: map[string]int64{}}
			ctx := campussearch.WithSearchObserver(t.Context(), &campussearch.SearchObserver{Snapshot: snapshot, Phase: func(string) {}})
			_, err := client.Search(ctx, campussearch.Index{Collection: "campus_docs_" + strings.Repeat("c", 64)}, campussearch.SearchQuery{RetrievalQuery: "查询", RerankQuery: "查询"}, 5)
			if err == nil || snapshot.FailedStage != stage {
				t.Fatalf("err=%v stage=%s", err, snapshot.FailedStage)
			}
			if _, ok := snapshot.Durations[stage]; !ok {
				t.Fatal("failed stage duration missing")
			}
			if stage == "embedding" && snapshot.Retrieval.HTTPMs != nil {
				t.Fatal("unexecuted retrieval has a duration")
			}
			if stage != "embedding" && snapshot.Retrieval.HTTPMs == nil {
				t.Fatal("attempted HTTP duration missing")
			}
			if stage == "rerank" && (snapshot.Rerank.HTTPMs == nil || snapshot.Retrieval.QdrantMs == nil || *snapshot.Retrieval.QdrantMs != 1) {
				t.Fatal("upstream durations missing or wrong units")
			}
			bytes, _ := json.Marshal(snapshot)
			if strings.Contains(string(bytes), "secret") || strings.Contains(snapshot.Embedding.ServiceOrigin, "/v1") {
				t.Fatal("credentials or provider path leaked")
			}
		})
	}
}

func TestCampusSearchDiagnosticsRecordsEvidenceBudgetExclusion(t *testing.T) {
	collection := "campus_docs_" + strings.Repeat("c", 64)
	points := []qdrantPoint{validCampusDocsPointAtTest(0), validCampusDocsPointAtTest(1)}
	for index := range points {
		text := strings.Repeat("字", 3000)
		points[index].Payload["text"] = text
		points[index].Payload["text_sha256"] = SHA256TextRef(text)
	}
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/embeddings":
			writeJSON(w, 200, map[string]any{"data": []map[string]any{{"embedding": make([]float64, campussearch.EmbeddingDimensions)}}})
		case "/v1/rerank":
			writeJSON(w, 200, map[string]any{"results": []map[string]any{{"index": 0, "relevance_score": 0.9}, {"index": 1, "relevance_score": 0.8}}})
		default:
			writeJSON(w, 200, map[string]any{"result": map[string]any{"points": points}})
		}
	}))
	defer provider.Close()
	client := newCampusDocsHTTPClientForTest(t, Config{
		DeploymentEnvironment: "local", QdrantURL: provider.URL, QdrantReadOnlyAPIKey: "test-key",
	}, campusDocsRuntimeConfigResolverForTest(provider.URL+"/v1"))
	snapshot := &campussearch.Snapshot{CitationStart: 1, Durations: map[string]int64{}}
	ctx := campussearch.WithSearchObserver(t.Context(), &campussearch.SearchObserver{Snapshot: snapshot, Phase: func(string) {}})
	results, err := client.Search(ctx, campussearch.Index{Collection: collection}, campussearch.SearchQuery{RetrievalQuery: "查询", RerankQuery: "查询"}, 5)
	if err != nil {
		t.Fatal(err)
	}
	if len(results) != 1 || len(snapshot.Candidates) != 2 {
		t.Fatalf("unexpected selection: %d results, %d candidates", len(results), len(snapshot.Candidates))
	}
	if len([]rune(snapshot.Candidates[0].Text)) != 3000 || len([]rune(snapshot.Candidates[1].Text)) != 160 || snapshot.Candidates[1].ExclusionReason != "evidence_char_budget" {
		t.Fatal("diagnostic body bounds or exclusion reason are incorrect")
	}
	encoded := campussearch.EncodeSearchResult(results, 1)
	if len(encoded) != 2 {
		t.Fatal("diagnostics leaked into tool response")
	}
}

func TestNoticeEvidenceContextSurvivesResultBudget(t *testing.T) {
	collection := "campus_docs_" + strings.Repeat("c", 64)
	points := make([]qdrantPoint, 5)
	for i := range points {
		text := "（二）秋季批次\n第三批、第四批：\n" + strings.Repeat("安排", 560) + "\n证书发放：12月中旬、次年1月中旬"
		points[i] = qdrantPoint{ID: fmt.Sprint(i), Score: .9, Payload: map[string]any{
			"source_kind": "notice", "schema_version": "campus_rag_point.v3",
			"released_at": "2026-08-23T10:00:00.000Z",
			"notice_id":   "355696", "chunk_id": fmt.Sprint(i), "title": "毕业安排", "section_title": "秋季批次",
			"citation_href": "/notices/355696", "text": text,
			"text_sha256": SHA256TextRef(text), "retrieval_text_sha256": SHA256TextRef("毕业安排\n" + text),
		}}
	}
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/embeddings":
			writeJSON(w, 200, map[string]any{"data": []any{map[string]any{"embedding": make([]float64, campussearch.EmbeddingDimensions)}}})
		case "/v1/rerank":
			var request struct {
				Documents []string `json:"documents"`
			}
			if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
				t.Error(err)
			}
			for _, text := range request.Documents {
				if !strings.Contains(text, "第三批、第四批") {
					t.Error("reranker lost context")
				}
			}
			results := make([]map[string]any, len(points))
			for i := range points {
				results[i] = map[string]any{"index": i, "relevance_score": .9 - float64(i)*.01}
			}
			writeJSON(w, 200, map[string]any{"results": results})
		default:
			writeJSON(w, 200, map[string]any{"result": map[string]any{"points": points}})
		}
	}))
	defer provider.Close()
	client := newCampusDocsHTTPClientForTest(t, Config{DeploymentEnvironment: "local", QdrantURL: provider.URL, QdrantReadOnlyAPIKey: "key"}, campusDocsRuntimeConfigResolverForTest(provider.URL+"/v1"))
	results, err := client.Search(t.Context(), campussearch.Index{Collection: collection}, campussearch.SearchQuery{RetrievalQuery: "秋季授位", RerankQuery: "秋季证书发放"}, 5)
	if err != nil {
		t.Fatal(err)
	}
	if len(results) != 3 {
		t.Fatalf("budget must retain three complete results, got %d", len(results))
	}
	_, decoded, err := campussearch.DecodeSearchResult(campussearch.EncodeSearchResult(results, 1))
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range decoded {
		if item.Text != points[0].Payload["text"] {
			t.Fatal("evidence was truncated")
		}
	}
}

func TestCampusSearchDiversityCapLimitsSameNoticeAndSection(t *testing.T) {
	notice := func(id, chunk, section string) qdrantPoint {
		return qdrantPoint{ID: chunk, Score: .1, Payload: map[string]any{
			"source_kind": "notice", "schema_version": "campus_rag_point.v1",
			"notice_id": id, "chunk_id": chunk, "title": "通知" + id, "section_title": section,
			"citation_href": "/notices/" + id, "text": chunk,
			"text_sha256":           SHA256TextRef(chunk),
			"retrieval_text_sha256": SHA256TextRef("通知\n" + chunk),
		}}
	}
	points := []qdrantPoint{
		notice("1", "n1-s1-a", "正文"),
		notice("1", "n1-s1-b", "正文"),
		notice("1", "n1-s2", "申请条件"),
		notice("1", "n1-s3", "费用"),
		notice("2", "n2-s1", "正文"),
		notice("3", "n3-s1", "正文"),
	}
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/embeddings":
			writeJSON(w, 200, map[string]any{"data": []any{map[string]any{"embedding": make([]float64, campussearch.EmbeddingDimensions)}}})
		case "/v1/rerank":
			results := make([]map[string]any, len(points))
			for i := range points {
				results[i] = map[string]any{"index": i, "relevance_score": .95 - float64(i)*.05}
			}
			writeJSON(w, 200, map[string]any{"results": results})
		default:
			writeJSON(w, 200, map[string]any{"time": 0, "result": map[string]any{"points": points}})
		}
	}))
	defer provider.Close()
	client := newCampusDocsHTTPClientForTest(t, Config{DeploymentEnvironment: "local", QdrantURL: provider.URL, QdrantReadOnlyAPIKey: "key"}, campusDocsRuntimeConfigResolverForTest(provider.URL+"/v1"))
	snapshot := &campussearch.Snapshot{CitationStart: 1, Durations: map[string]int64{}}
	ctx := campussearch.WithSearchObserver(t.Context(), &campussearch.SearchObserver{Snapshot: snapshot, Phase: func(string) {}})
	results, err := client.Search(ctx, campussearch.Index{Collection: "campus_docs_" + strings.Repeat("a", 64)}, campussearch.SearchQuery{RetrievalQuery: "查询", RerankQuery: "查询"}, 5)
	if err != nil {
		t.Fatal(err)
	}
	// Expect: n1-s1-a (notice-1 正文), n1-s2 (notice-1 申请条件),
	// n2-s1 (notice-2 正文), n3-s1 (notice-3 正文) = 4 results.
	// n1-s1-b capped by same_section_cap, n1-s3 capped by same_notice_cap.
	// Backfill fills the 5th slot with n1-s1-b.
	if len(results) != 5 {
		t.Fatalf("results=%d, want 5", len(results))
	}
	if results[0].Text != "n1-s1-a" || results[1].Text != "n1-s2" || results[2].Text != "n2-s1" || results[3].Text != "n3-s1" || results[4].Text != "n1-s1-b" {
		texts := make([]string, len(results))
		for i, r := range results {
			texts[i] = r.Text
		}
		t.Fatalf("selection order = %v", texts)
	}
	// Verify diagnostic exclusion reasons for the capped candidates.
	var s1b, s3 *campussearch.Candidate
	for i := range snapshot.Candidates {
		switch snapshot.Candidates[i].ResultRef {
		case results[4].ResultRef:
			s1b = &snapshot.Candidates[i]
		default:
			for _, r := range results {
				if snapshot.Candidates[i].ResultRef == r.ResultRef {
					break
				}
			}
		}
		if snapshot.Candidates[i].NoticeID == "1" && snapshot.Candidates[i].Section == "费用" {
			s3 = &snapshot.Candidates[i]
		}
	}
	if s1b == nil || s1b.ExclusionReason != "" {
		t.Fatalf("backfilled candidate should have no exclusion reason: %+v", s1b)
	}
	if s3 == nil || s3.ExclusionReason != "same_notice_cap" {
		t.Fatalf("same_notice_cap exclusion: %+v", s3)
	}
	if snapshot.SourceGroupedExcludedCount != 2 {
		t.Fatalf("deferred count = %d, want 2", snapshot.SourceGroupedExcludedCount)
	}
}

func TestCampusSearchDiversityCapsSeparateNoticeAndDocumentIDs(t *testing.T) {
	var points []qdrantPoint
	for i, section := range []string{"正文", "申请条件"} {
		notice := publishedNoticePointForTest(t)
		notice.ID = "notice-" + section
		notice.Payload["chunk_id"] = notice.ID
		notice.Payload["section_title"] = section
		document := validCampusDocsPointAtTest(i)
		document.Payload["document_id"] = notice.Payload["notice_id"]
		document.Payload["section_title"] = section
		points = append(points, notice, document)
	}
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/embeddings":
			writeJSON(w, 200, map[string]any{"data": []any{map[string]any{"embedding": make([]float64, campussearch.EmbeddingDimensions)}}})
		case "/v1/rerank":
			ranked := make([]map[string]any, len(points))
			for i := range points {
				ranked[i] = map[string]any{"index": i, "relevance_score": .95 - float64(i)*.05}
			}
			writeJSON(w, 200, map[string]any{"results": ranked})
		default:
			writeJSON(w, 200, map[string]any{"result": map[string]any{"points": points}})
		}
	}))
	defer provider.Close()
	client := newCampusDocsHTTPClientForTest(t, Config{DeploymentEnvironment: "local", QdrantURL: provider.URL, QdrantReadOnlyAPIKey: "key"}, campusDocsRuntimeConfigResolverForTest(provider.URL+"/v1"))
	snapshot := &campussearch.Snapshot{CitationStart: 1, Durations: map[string]int64{}}
	ctx := campussearch.WithSearchObserver(t.Context(), &campussearch.SearchObserver{Snapshot: snapshot, Phase: func(string) {}})
	results, err := client.Search(ctx, campussearch.Index{Collection: "campus_docs_" + strings.Repeat("a", 64)}, campussearch.SearchQuery{RetrievalQuery: "申请条件", RerankQuery: "申请条件"}, 5)
	if err != nil || len(results) != 4 {
		t.Fatalf("mixed retrieval failed: %+v %v", results, err)
	}
	if snapshot.SourceGroupedExcludedCount != 0 {
		t.Fatalf("different source kinds shared diversity caps: %+v", snapshot)
	}
	for i, result := range results {
		if result.Text != points[i].Payload["text"] || result.SectionTitle != points[i].Payload["section_title"] {
			t.Fatalf("candidate %d was deferred: %+v", i, results)
		}
	}
}

func publishedNoticePointForTest(t *testing.T) qdrantPoint {
	t.Helper()
	data, err := os.ReadFile("../../../../packages/contracts/fixtures/campus_rag/notice-point.v3.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Point qdrantPoint `json:"point"`
	}
	if err := json.Unmarshal(data, &fixture); err != nil {
		t.Fatal(err)
	}
	fixture.Point.Score = .9
	return fixture.Point
}

func TestPublishedNoticePayloadSupportsCurrentAndPreviousSchema(t *testing.T) {
	index := campussearch.Index{Collection: "campus_docs_" + strings.Repeat("c", 64)}
	for _, schema := range []string{"campus_rag_point.v3", "campus_rag_point.v2", "campus_rag_point.v1"} {
		t.Run(schema, func(t *testing.T) {
			point := publishedNoticePointForTest(t)
			point.Payload["schema_version"] = schema
			result, err := campusDocsCandidateFromQdrantPoint(index, point)
			if err != nil || result.result.NoticeID != "900001" {
				t.Fatalf("publisher notice rejected: %+v %v", result, err)
			}
			for name, mutate := range map[string]func(map[string]any){
				"citation":           func(p map[string]any) { p["citation_href"] = "/notices/999" },
				"hash":               func(p map[string]any) { p["text"] = "changed" },
				"missing text":       func(p map[string]any) { delete(p, "text") },
				"unsupported schema": func(p map[string]any) { p["schema_version"] = "campus_rag_point.v999" },
				"release time":       func(p map[string]any) { delete(p, "released_at") },
			} {
				t.Run(name, func(t *testing.T) {
					invalid := publishedNoticePointForTest(t)
					invalid.Payload["schema_version"] = schema
					mutate(invalid.Payload)
					if _, err := campusDocsCandidateFromQdrantPoint(index, invalid); err == nil && (schema == "campus_rag_point.v3" || name != "release time") {
						t.Fatal("invalid payload accepted")
					}
				})
			}
		})
	}
}

func TestCampusSearchConsumesMixedPublisherNoticeAndDocument(t *testing.T) {
	notice := publishedNoticePointForTest(t)
	document := validCampusDocsPointForTest()
	document.Payload["schema_version"] = "campus_rag_point.v2"
	document.Payload["corpus"] = "regulations"
	document.Payload["is_current"] = true
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/embeddings":
			writeJSON(w, 200, map[string]any{"data": []any{map[string]any{"embedding": make([]float64, campussearch.EmbeddingDimensions)}}})
		case "/v1/rerank":
			writeJSON(w, 200, map[string]any{"results": []any{map[string]any{"index": 0, "relevance_score": .9}, map[string]any{"index": 1, "relevance_score": .8}}})
		default:
			writeJSON(w, 200, map[string]any{"result": map[string]any{"points": []qdrantPoint{notice, document}}})
		}
	}))
	defer provider.Close()
	client := newCampusDocsHTTPClientForTest(t, Config{DeploymentEnvironment: "local", QdrantURL: provider.URL, QdrantReadOnlyAPIKey: "key"}, campusDocsRuntimeConfigResolverForTest(provider.URL+"/v1"))
	snapshot := &campussearch.Snapshot{Durations: map[string]int64{}}
	ctx := campussearch.WithSearchObserver(t.Context(), &campussearch.SearchObserver{Snapshot: snapshot, Phase: func(string) {}})
	results, err := client.Search(ctx, campussearch.Index{Collection: "campus_docs_" + strings.Repeat("a", 64)}, campussearch.SearchQuery{RetrievalQuery: "夜宵和学籍规定", RerankQuery: "夜宵和学籍规定"}, 5)
	if err != nil || len(results) != 2 {
		t.Fatalf("mixed retrieval failed: %+v %v", results, err)
	}
	if results[0].NoticeID != "900001" || results[1].SourceKind != "document" {
		t.Fatalf("unexpected evidence: %+v", results)
	}
	if snapshot.Retrieval.HTTPStatus == nil || *snapshot.Retrieval.HTTPStatus != 200 {
		t.Fatalf("Qdrant status missing: %+v", snapshot.Retrieval)
	}
	notice.Payload["schema_version"] = "campus_rag_point.v999"
	if _, err := client.Search(ctx, campussearch.Index{Collection: "campus_docs_" + strings.Repeat("a", 64)}, campussearch.SearchQuery{RetrievalQuery: "夜宵和学籍规定", RerankQuery: "夜宵和学籍规定"}, 5); err == nil || !strings.Contains(err.Error(), "campus_rag_point.v999") {
		t.Fatalf("missing concrete schema error: %v", err)
	}
	if snapshot.Retrieval.HTTPStatus == nil || *snapshot.Retrieval.HTTPStatus != 200 || snapshot.FailedStage != "retrieval" {
		t.Fatalf("parse failure lost upstream status: %+v", snapshot)
	}
}
