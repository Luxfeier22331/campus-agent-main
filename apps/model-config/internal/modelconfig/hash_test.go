package modelconfig

import "testing"

func TestTargetHashVectorAndCredentialIndependence(t *testing.T) {
	target := Target{
		Name:        ConfigPrimaryAgent,
		Provider:    "openai",
		APIProtocol: "openai.responses",
		BaseURL:     "https://api.openai.com/v1",
		Model:       "gpt-5-mini",
	}
	const expected = "017c55fcb32b8b6ff09747e0dea62475ed2c1a19359e69e74f9d15902dbdfe80"
	if got := TargetHash(target); got != expected {
		t.Fatalf("TargetHash() = %q, want %q", got, expected)
	}
	if _, err := NewCipher(make([]byte, 32)); err != nil {
		t.Fatal(err)
	}
	if _, err := NewCipher([]byte("01234567890123456789012345678901")); err != nil {
		t.Fatal(err)
	}
	if TargetHash(target) != expected {
		t.Fatal("credential rotation changed the model target hash")
	}
}
