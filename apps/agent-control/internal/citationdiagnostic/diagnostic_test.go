package citationdiagnostic

import (
	"encoding/json"
	"os"
	"reflect"
	"sort"
	"testing"
)

func TestSharedContract(t *testing.T) {
	raw, err := os.ReadFile("../../../../packages/contracts/fixtures/citation-diagnostic.v1.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixtures struct {
		Reasons []string `json:"reasons"`
		Cases   []struct {
			Name     string          `json:"name"`
			Valid    bool            `json:"valid"`
			Citation json.RawMessage `json:"citation"`
		} `json:"cases"`
	}
	if err := json.Unmarshal(raw, &fixtures); err != nil {
		t.Fatal(err)
	}
	keys := []string{}
	for key := range Reasons {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	sort.Strings(fixtures.Reasons)
	if !reflect.DeepEqual(keys, fixtures.Reasons) {
		t.Fatalf("reason catalog differs: %v", keys)
	}
	for _, tc := range fixtures.Cases {
		t.Run(tc.Name, func(t *testing.T) {
			if Valid(tc.Citation) != tc.Valid {
				t.Fatalf("validation mismatch: %s", tc.Citation)
			}
			if !tc.Valid && string(Normalize(tc.Citation)) != `{"schema_version":0}` {
				t.Fatal("invalid diagnostic must not be retained")
			}
		})
	}
}
