package httpapi

import (
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/retrievalruntime"
)

func mustRetrievalRuntimeProfileForTest(
	t *testing.T,
	corpus string,
	collection string,
) retrievalruntime.RuntimeProfile {
	t.Helper()
	profile, err := retrievalRuntimeProfileForTest(corpus, collection)
	if err != nil {
		t.Fatalf("load runtime profile for test: %v", err)
	}
	return profile
}
