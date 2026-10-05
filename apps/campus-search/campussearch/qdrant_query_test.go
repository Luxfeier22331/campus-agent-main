package campussearch

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"testing"
)

func TestBuildSparseVectorUsesPublisherUnicodeLowercase(t *testing.T) {
	vector := BuildSparseVector("İ")
	want := sparseTokenIndex("i\u0307")
	if len(vector.Indices) != 1 || vector.Indices[0] != want {
		t.Fatalf("sparse indices = %#v, want [%d]", vector.Indices, want)
	}
}

func TestBuildRetrievalFilterDefaultsToCurrentDocumentsAndNotices(t *testing.T) {
	filter := BuildRetrievalFilter(RetrievalScope{Mode: "current"})
	should, ok := filter["should"].([]any)
	if !ok || len(should) != 2 {
		t.Fatalf("filter should = %#v", filter)
	}
	document := should[1].(map[string]any)["must"].([]any)
	if len(document) != 2 {
		t.Fatalf("document conditions = %#v", document)
	}
	if document[1].(map[string]any)["key"] != "is_current" {
		t.Fatalf("current condition = %#v", document[1])
	}
}

func TestBuildRetrievalFilterRoutesCurriculumAdmissionYear(t *testing.T) {
	year := 2022
	filter := BuildRetrievalFilter(RetrievalScope{Mode: "curriculum_cohort", AdmissionYear: &year})
	document := filter["should"].([]any)[1].(map[string]any)["must"].([]any)
	if document[1].(map[string]any)["key"] != "corpus" || document[2].(map[string]any)["key"] != "applicable_from_admission_year" || document[3].(map[string]any)["key"] != "applicable_to_admission_year" {
		t.Fatalf("curriculum conditions = %#v", document)
	}
}

func TestResolveRetrievalScopeRecognizesExplicitVersionAndCohort(t *testing.T) {
	cohort := ResolveRetrievalScope("2022级培养方案", "")
	if cohort.Mode != "curriculum_cohort" || cohort.AdmissionYear == nil || *cohort.AdmissionYear != 2022 {
		t.Fatalf("cohort scope = %#v", cohort)
	}
	version := ResolveRetrievalScope("2018年版学生手册", "")
	if version.Mode != "explicit_version" || version.VersionSlug != "2018" {
		t.Fatalf("version scope = %#v", version)
	}
}

func TestRetrievalFilterUsesOnlySharedPayloadIndexes(t *testing.T) {
	_, filename, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("resolve qdrant query test path")
	}
	contractPath := filepath.Join(filepath.Dir(filename), "../../../packages/contracts/fixtures/campus_rag/payload-indexes.v3.json")
	bytes, err := os.ReadFile(contractPath)
	if err != nil {
		t.Fatalf("read payload index contract: %v", err)
	}
	var contract struct {
		SchemaVersion  string `json:"schemaVersion"`
		PayloadIndexes []struct {
			Field string `json:"field"`
			Type  string `json:"type"`
		} `json:"payloadIndexes"`
	}
	if err := json.Unmarshal(bytes, &contract); err != nil {
		t.Fatalf("decode payload index contract: %v", err)
	}
	if contract.SchemaVersion != "campus_rag_point.v3" {
		t.Fatalf("schema version = %q", contract.SchemaVersion)
	}
	indexed := make(map[string]struct{}, len(contract.PayloadIndexes))
	for _, index := range contract.PayloadIndexes {
		indexed[index.Field] = struct{}{}
	}
	if _, ok := indexed["document_id"]; ok {
		t.Fatal("document_id must not be a payload index without a retrieval filter")
	}
	for _, scope := range []RetrievalScope{
		{Mode: "current"},
		{Mode: "historical"},
		{Mode: "explicit_version", VersionSlug: "2018"},
		{Mode: "curriculum_cohort", AdmissionYear: func() *int { year := 2022; return &year }()},
	} {
		keys := filterKeys(BuildRetrievalFilter(scope))
		for key := range keys {
			if _, ok := indexed[key]; !ok {
				t.Fatalf("scope %q uses unindexed field %q", scope.Mode, key)
			}
		}
	}
	if !reflect.DeepEqual(
		[]string{"source_kind", "version_slug", "is_current", "corpus", "applicable_from_admission_year", "applicable_to_admission_year"},
		orderedContractFields(contract.PayloadIndexes),
	) {
		t.Fatalf("payload index contract fields changed unexpectedly: %#v", contract.PayloadIndexes)
	}
}

func filterKeys(value any) map[string]struct{} {
	keys := map[string]struct{}{}
	switch typed := value.(type) {
	case map[string]any:
		for key, child := range typed {
			if key == "key" {
				if field, ok := child.(string); ok {
					keys[field] = struct{}{}
				}
			}
			for nested := range filterKeys(child) {
				keys[nested] = struct{}{}
			}
		}
	case []any:
		for _, child := range typed {
			for nested := range filterKeys(child) {
				keys[nested] = struct{}{}
			}
		}
	}
	return keys
}

func orderedContractFields(indexes []struct {
	Field string `json:"field"`
	Type  string `json:"type"`
}) []string {
	fields := make([]string, len(indexes))
	for index, item := range indexes {
		fields[index] = item.Field
	}
	return fields
}
