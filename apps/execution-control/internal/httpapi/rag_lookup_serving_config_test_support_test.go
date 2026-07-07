package httpapi

import (
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/retrievalruntime"
)

func mustRetrievalServingConfigForTest(
	t *testing.T,
	corpus string,
	collection string,
) retrievalruntime.ServingConfig {
	t.Helper()
	profile, err := retrievalServingConfigForTest(corpus, collection)
	if err != nil {
		t.Fatalf("load serving config for test: %v", err)
	}
	return profile
}
