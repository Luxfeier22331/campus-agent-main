package httpapi

import (
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
)

func TestStaticEmbeddingBaseURLDoesNotUseRetiredPromptRuntimeBaseURL(t *testing.T) {
	cfg := config.Config{}

	if got := staticEmbeddingBaseURL(cfg); got != "" {
		t.Fatalf("staticEmbeddingBaseURL = %q, want empty without explicit embedding base URL", got)
	}
}
