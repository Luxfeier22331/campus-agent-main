package httpapi

import (
	"context"
	"errors"
	"fmt"
	"math"
	"net/url"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/campusdocs"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

const (
	campusDocsCandidateLimit     = 24
	campusDocsEvidenceLimit      = 8
	campusDocsEvidenceCharBudget = 4000
)

type campusDocsRetriever interface {
	Retrieve(
		context.Context,
		string,
		temporalruntime.CampusDocsRetrievalAdmission,
	) (campusDocsRetrievalDiagnostics, error)
}

type campusDocsRetrievalDiagnostics struct {
	CandidateCount int
	Evidence       []temporalruntime.CampusDocsEvidence
	StageTiming    campusDocsStageTiming
}

type campusDocsStageTiming struct {
	EmbedQuery     time.Duration
	QueryIndex     time.Duration
	SelectEvidence time.Duration
}

func (timing campusDocsStageTiming) projection() map[string]any {
	projection := map[string]any{}
	addStageTimingDuration(projection, "campus_docs.embed_query_ms", timing.EmbedQuery)
	addStageTimingDuration(projection, "campus_docs.query_index_ms", timing.QueryIndex)
	addStageTimingDuration(projection, "campus_docs.select_evidence_ms", timing.SelectEvidence)
	return projection
}

type qdrantCampusDocsRetriever struct {
	qdrant campusDocsQdrantClient
}

func newQdrantCampusDocsRetriever(qdrant campusDocsQdrantClient) campusDocsRetriever {
	return qdrantCampusDocsRetriever{qdrant: qdrant}
}

type campusDocsCandidate struct {
	temporalruntime.CampusDocsEvidence
	collection string
	dedupKey   string
	score      float64
}

func (e qdrantCampusDocsRetriever) Retrieve(
	ctx context.Context,
	query string,
	admission temporalruntime.CampusDocsRetrievalAdmission,
) (campusDocsRetrievalDiagnostics, error) {
	timing := campusDocsStageTiming{}
	query = strings.TrimSpace(query)
	if query == "" {
		return campusDocsRetrievalDiagnostics{}, errors.New("Campus docs query is required")
	}
	if err := validateCampusDocsRetrievalAdmission(admission); err != nil {
		return campusDocsRetrievalDiagnostics{}, err
	}
	target := &admission.Index
	embeddingStartedAt := time.Now()
	embeddingConfig, err := e.qdrant.resolveEmbeddingProviderConfig(
		ctx,
		providerConfigAdmissionPin{ConfigSHA256: admission.EmbeddingProviderConfigSHA256},
	)
	if err != nil {
		return campusDocsRetrievalDiagnostics{}, err
	}
	embedding, err := e.qdrant.embedQueryWithProviderConfig(
		ctx,
		embeddingConfig,
		campusdocs.BuildDenseQueryText(query, target.EmbeddingQueryInstruction),
	)
	if err != nil {
		return campusDocsRetrievalDiagnostics{}, err
	}
	timing.EmbedQuery = time.Since(embeddingStartedAt)
	queryStartedAt := time.Now()
	points, err := e.qdrant.queryCampusDocsPoints(ctx, query, embedding, embeddingConfig, target)
	if err != nil {
		return campusDocsRetrievalDiagnostics{}, err
	}
	timing.QueryIndex = time.Since(queryStartedAt)
	candidates := make([]campusDocsCandidate, 0, len(points))
	seen := map[string]struct{}{}
	for _, point := range points {
		candidate, err := campusDocsCandidateFromQdrantPoint(target, point)
		if err != nil {
			return campusDocsRetrievalDiagnostics{}, err
		}
		if _, exists := seen[candidate.dedupKey]; exists {
			continue
		}
		seen[candidate.dedupKey] = struct{}{}
		candidates = append(candidates, candidate)
	}
	sort.SliceStable(candidates, func(left, right int) bool {
		if candidates[left].score == candidates[right].score {
			return candidates[left].dedupKey < candidates[right].dedupKey
		}
		return candidates[left].score > candidates[right].score
	})
	selectionStartedAt := time.Now()
	evidence := selectCampusDocsEvidence(candidates, target, 0)
	timing.SelectEvidence = time.Since(selectionStartedAt)
	return campusDocsRetrievalDiagnostics{
		CandidateCount: len(candidates),
		Evidence:       evidence,
		StageTiming:    timing,
	}, nil
}

func campusDocsCandidateFromQdrantPoint(
	target *temporalruntime.CampusDocsIndexSnapshot,
	point qdrantPoint,
) (campusDocsCandidate, error) {
	if err := validateCampusDocsIndexAdmission(target); err != nil {
		return campusDocsCandidate{}, err
	}
	payload := point.Payload
	required := map[string]string{
		"schema_version":        firstNonEmptyText(payload["schema_version"]),
		"chunk_id":              firstNonEmptyText(payload["chunk_id"]),
		"section_ref":           firstNonEmptyText(payload["section_ref"]),
		"document_id":           firstNonEmptyText(payload["document_id"]),
		"document_title":        firstNonEmptyText(payload["document_title"]),
		"section_title":         firstNonEmptyText(payload["section_title"]),
		"text":                  firstNonEmptyText(payload["text"]),
		"text_sha256":           firstNonEmptyText(payload["text_sha256"]),
		"retrieval_text_sha256": firstNonEmptyText(payload["retrieval_text_sha256"]),
		"version_id":            firstNonEmptyText(payload["version_id"]),
		"version_label":         firstNonEmptyText(payload["version_label"]),
		"version_slug":          firstNonEmptyText(payload["version_slug"]),
	}
	for field, value := range required {
		if strings.TrimSpace(value) == "" {
			return campusDocsCandidate{}, fmt.Errorf("Campus docs Qdrant payload %s is required", field)
		}
	}
	if required["schema_version"] != "campus_docs_point.v3" {
		return campusDocsCandidate{}, errors.New("Campus docs Qdrant payload does not match admitted index")
	}
	if !campusDocsVersionedSectionRef(required["section_ref"], required["version_slug"]) {
		return campusDocsCandidate{}, errors.New("Campus docs Qdrant payload document URL is invalid")
	}
	if !validSHA256Ref(required["text_sha256"]) || sha256TextRef(required["text"]) != required["text_sha256"] {
		return campusDocsCandidate{}, errors.New("Campus docs Qdrant payload text hash is invalid")
	}
	if !validSHA256Ref(required["retrieval_text_sha256"]) {
		return campusDocsCandidate{}, errors.New("Campus docs Qdrant payload retrieval text hash is invalid")
	}
	if math.IsNaN(point.Score) || math.IsInf(point.Score, 0) {
		return campusDocsCandidate{}, errors.New("Campus docs Qdrant score is invalid")
	}
	rootUnitIDs, ok := campusDocsRootUnitIDs(payload["root_unit_ids"])
	if !ok {
		return campusDocsCandidate{}, errors.New("Campus docs Qdrant payload root_unit_ids is invalid")
	}
	if textChars := utf8.RuneCountInString(required["text"]); textChars < 1 || textChars > campusDocsEvidenceCharBudget {
		return campusDocsCandidate{}, errors.New("Campus docs Qdrant payload text length is invalid")
	}
	dedupKey := strings.Join([]string{target.Collection, required["chunk_id"], required["text_sha256"]}, "\x00")
	return campusDocsCandidate{
		CampusDocsEvidence: temporalruntime.CampusDocsEvidence{
			DocumentID:    required["document_id"],
			DocumentTitle: required["document_title"],
			RootUnitIDs:   rootUnitIDs,
			SectionRef:    required["section_ref"],
			SectionTitle:  required["section_title"],
			Text:          required["text"],
			VersionID:     required["version_id"],
			VersionLabel:  required["version_label"],
			VersionSlug:   required["version_slug"],
		},
		collection: target.Collection,
		dedupKey:   dedupKey,
		score:      point.Score,
	}, nil
}

func selectCampusDocsEvidence(
	ranked []campusDocsCandidate,
	target *temporalruntime.CampusDocsIndexSnapshot,
	minScore float64,
) []temporalruntime.CampusDocsEvidence {
	if err := validateCampusDocsIndexAdmission(target); err != nil {
		return []temporalruntime.CampusDocsEvidence{}
	}
	limit := campusDocsEvidenceLimit
	evidence := make([]temporalruntime.CampusDocsEvidence, 0, limit)
	selectedChunks := map[string]struct{}{}
	characterCount := 0
	for _, candidate := range ranked {
		if len(evidence) >= limit {
			break
		}
		candidateChars := utf8.RuneCountInString(candidate.Text)
		if candidate.score < minScore || candidate.collection != target.Collection ||
			characterCount+candidateChars > campusDocsEvidenceCharBudget {
			continue
		}
		if _, exists := selectedChunks[candidate.dedupKey]; exists {
			continue
		}
		candidate.EvidenceRef = "evidence://" + strings.TrimPrefix(sha256TextRef(candidate.dedupKey), "sha256:")
		evidence = append(evidence, candidate.CampusDocsEvidence)
		characterCount += candidateChars
		selectedChunks[candidate.dedupKey] = struct{}{}
	}
	return evidence
}

func validateCampusDocsRetrievalAdmission(value temporalruntime.CampusDocsRetrievalAdmission) error {
	if !validSHA256Ref(value.QuerySHA256) ||
		!validProviderConfigHash(value.EmbeddingProviderConfigSHA256) {
		return errors.New("Campus docs retrieval admission is invalid")
	}
	return validateCampusDocsIndexAdmission(&value.Index)
}

func validateCampusDocsRetrievalResult(value temporalruntime.CampusDocsRetrievalResult) error {
	if len(value.Evidence) > campusDocsEvidenceLimit {
		return errors.New("Campus docs retrieval result is invalid")
	}
	characterCount := 0
	seen := map[string]struct{}{}
	for _, evidence := range value.Evidence {
		evidenceDigest := strings.TrimPrefix(evidence.EvidenceRef, "evidence://")
		if evidenceDigest == evidence.EvidenceRef || !lowercaseSHA256Pattern.MatchString(evidenceDigest) ||
			strings.TrimSpace(evidence.SectionRef) == "" || strings.TrimSpace(evidence.DocumentID) == "" ||
			!validCampusDocsRootUnitIDs(evidence.RootUnitIDs) ||
			strings.TrimSpace(evidence.DocumentTitle) == "" || strings.TrimSpace(evidence.SectionTitle) == "" ||
			strings.TrimSpace(evidence.VersionID) == "" || strings.TrimSpace(evidence.VersionLabel) == "" ||
			strings.TrimSpace(evidence.VersionSlug) == "" ||
			!campusDocsVersionedSectionRef(evidence.SectionRef, evidence.VersionSlug) ||
			strings.TrimSpace(evidence.Text) == "" {
			return errors.New("Campus docs evidence is invalid")
		}
		if _, exists := seen[evidence.EvidenceRef]; exists {
			return errors.New("Campus docs evidence_ref is duplicated")
		}
		seen[evidence.EvidenceRef] = struct{}{}
		characterCount += utf8.RuneCountInString(evidence.Text)
	}
	if characterCount > campusDocsEvidenceCharBudget {
		return errors.New("Campus docs evidence exceeds the character budget")
	}
	return nil
}

func publicCampusDocsSectionRef(value string) bool {
	base, anchor, found := strings.Cut(strings.TrimSpace(value), "#")
	return (!found || (anchor != "" && !strings.Contains(anchor, "#"))) &&
		strings.HasPrefix(base, "/docs/") && !strings.Contains(base, "..") &&
		!strings.Contains(base, "?") && !strings.HasPrefix(base, "//")
}

func campusDocsVersionedSectionRef(value string, versionSlug string) bool {
	if !publicCampusDocsSectionRef(value) || strings.TrimSpace(versionSlug) == "" {
		return false
	}
	base, _, _ := strings.Cut(strings.TrimSpace(value), "#")
	segments := strings.Split(strings.Trim(base, "/"), "/")
	if len(segments) != 6 || segments[0] != "docs" || segments[4] != "v" {
		return false
	}
	decoded, err := url.PathUnescape(segments[5])
	return err == nil && decoded == versionSlug
}

func campusDocsRootUnitIDs(value any) ([]string, bool) {
	var values []any
	switch typed := value.(type) {
	case []any:
		values = typed
	case []string:
		values = make([]any, len(typed))
		for index, item := range typed {
			values[index] = item
		}
	default:
		return nil, false
	}
	result := make([]string, 0, len(values))
	seen := map[string]struct{}{}
	for _, value := range values {
		text, ok := value.(string)
		text = strings.TrimSpace(text)
		if !ok || text == "" {
			return nil, false
		}
		if _, exists := seen[text]; exists {
			return nil, false
		}
		seen[text] = struct{}{}
		result = append(result, text)
	}
	return result, len(result) > 0
}

func validCampusDocsRootUnitIDs(values []string) bool {
	_, ok := campusDocsRootUnitIDs(values)
	return ok
}
