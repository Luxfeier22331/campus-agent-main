package campussearch

import "testing"

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
