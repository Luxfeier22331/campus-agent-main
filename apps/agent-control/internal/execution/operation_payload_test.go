package execution

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestOperationPayloadBudgetUsesCompleteUTF8JSON(t *testing.T) {
	for _, delta := range []int{-1, 0, 1} {
		value := map[string]string{"answer": strings.Repeat("x", MaxAgentOperationPayloadBytes-len(`{"answer":""}`)+delta)}
		encoded, err := json.Marshal(value)
		if err != nil {
			t.Fatal(err)
		}
		if len(encoded) != MaxAgentOperationPayloadBytes+delta {
			t.Fatal(len(encoded))
		}
		if err := ValidateOperationPayload(value); (err != nil) != (delta > 0) {
			t.Fatalf("delta %d: %v", delta, err)
		}
	}
	for _, text := range []string{strings.Repeat("😀", MaxAgentOperationPayloadBytes/4), strings.Repeat("<", MaxAgentOperationPayloadBytes/6)} {
		if err := ValidateOperationPayload(map[string]string{"answer": text}); err == nil {
			t.Fatal("UTF8/escaped JSON overflow accepted")
		}
	}
}
