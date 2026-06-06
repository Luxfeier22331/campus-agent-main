package httpapi

import (
	"errors"
	"testing"
)

func TestDecodeJSONObjectRejectsNonObjects(t *testing.T) {
	_, err := decodeJSONObject([]byte(`[]`))
	if err == nil {
		t.Fatal("expected decodeJSONObject to reject non-object JSON")
	}
	if !errors.Is(err, err) {
		t.Fatal("unexpected error shape")
	}
}
