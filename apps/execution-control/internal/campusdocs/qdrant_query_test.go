package campusdocs

import "testing"

func TestBuildSparseVectorUsesPublisherUnicodeLowercase(t *testing.T) {
	vector := BuildSparseVector("İ")
	want := sparseTokenIndex("i\u0307")
	if len(vector.Indices) != 1 || vector.Indices[0] != want {
		t.Fatalf("sparse indices = %#v, want [%d]", vector.Indices, want)
	}
}
