package campusdocs

import (
	"encoding/json"
	"math"
	"reflect"
	"testing"
)

func TestBuildSparseVectorIsDeterministicAndSorted(t *testing.T) {
	first := BuildSparseVector("培养方案 课程 课程")
	second := BuildSparseVector("培养方案 课程 课程")
	if !reflect.DeepEqual(first, second) {
		t.Fatalf("sparse vector is not deterministic: %#v != %#v", first, second)
	}
	if len(first.Indices) != len(first.Values) || len(first.Indices) == 0 {
		t.Fatalf("sparse vector is malformed: %#v", first)
	}
	for index := 1; index < len(first.Indices); index++ {
		if first.Indices[index-1] >= first.Indices[index] {
			t.Fatalf("sparse indices are not strictly sorted: %#v", first.Indices)
		}
	}
}

func TestBuildSparseVectorMatchesPublisherFixture(t *testing.T) {
	got := BuildSparseVector("培养方案 Course_101 course_101 课程 课程 ÄÖ")
	wantIndices := []uint32{148423468, 272413536, 603158067, 919704991, 1116344764, 1145662860, 1154101346, 1767701743}
	wantValues := []float64{
		0.6931471805599453,
		0.6931471805599453,
		1.0986122886681096,
		0.6931471805599453,
		0.6931471805599453,
		0.6931471805599453,
		1.0986122886681096,
		1.0986122886681096,
	}
	if !reflect.DeepEqual(got.Indices, wantIndices) {
		t.Fatalf("sparse indices = %#v, want %#v", got.Indices, wantIndices)
	}
	if len(got.Values) != len(wantValues) {
		t.Fatalf("sparse values = %#v, want %#v", got.Values, wantValues)
	}
	for index := range wantValues {
		if math.Abs(got.Values[index]-wantValues[index]) > 1e-15 {
			t.Fatalf("sparse value %d = %.17g, want %.17g", index, got.Values[index], wantValues[index])
		}
	}
}

func TestBuildSparseVectorMatchesUnicodePublisherFixture(t *testing.T) {
	got := BuildSparseVector("İ İ ΣΟΣ ÄÖ ẞ Course_101 course_101 课程 课程")
	wantIndices := []uint32{603158067, 815662359, 919704991, 1129763277, 1154101346, 1272149201, 1767701743}
	wantValues := []float64{
		1.0986122886681096,
		0.6931471805599453,
		0.6931471805599453,
		1.0986122886681096,
		1.0986122886681096,
		0.6931471805599453,
		1.0986122886681096,
	}
	if !reflect.DeepEqual(got.Indices, wantIndices) {
		t.Fatalf("sparse indices = %#v, want %#v", got.Indices, wantIndices)
	}
	if len(got.Values) != len(wantValues) {
		t.Fatalf("sparse values = %#v, want %#v", got.Values, wantValues)
	}
	for index := range wantValues {
		if math.Abs(got.Values[index]-wantValues[index]) > 1e-15 {
			t.Fatalf("sparse value %d = %.17g, want %.17g", index, got.Values[index], wantValues[index])
		}
	}
}

func TestBuildHybridQueryBodyUsesExplicitDeterministicSparseVector(t *testing.T) {
	body, err := BuildHybridQueryBody(HybridQuery{
		DenseEmbedding:   []float64{0.1, 0.2},
		DenseVectorName:  "dense",
		QueryText:        "学生请假手续",
		SparseVectorName: "sparse",
		TopK:             8,
	})
	if err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	if string(encoded) == "" {
		t.Fatal("query body is empty")
	}
	prefetch, ok := body["prefetch"].([]map[string]any)
	if !ok || len(prefetch) != 2 {
		t.Fatalf("prefetch = %#v", body["prefetch"])
	}
	if _, ok := prefetch[1]["query"].(SparseVector); !ok {
		t.Fatalf("sparse query is not an explicit vector: %#v", prefetch[1]["query"])
	}
}

func TestBuildDenseQueryText(t *testing.T) {
	if got := BuildDenseQueryText("问题", "检索指令"); got != "Instruct: 检索指令\nQuery:问题" {
		t.Fatalf("dense query text = %q", got)
	}
}

func TestBuildHybridQueryBodyUsesDenseOnlyForEmptySparseVector(t *testing.T) {
	body, err := BuildHybridQueryBody(HybridQuery{
		DenseEmbedding:   []float64{0.1, 0.2},
		DenseVectorName:  "dense",
		QueryText:        "？🙂",
		SparseVectorName: "sparse",
		TopK:             8,
	})
	if err != nil {
		t.Fatal(err)
	}
	if body["using"] != "dense" || !reflect.DeepEqual(body["query"], []float64{0.1, 0.2}) {
		t.Fatalf("dense-only query = %#v", body)
	}
	if _, exists := body["prefetch"]; exists {
		t.Fatalf("dense-only query unexpectedly contains prefetch: %#v", body)
	}
}
