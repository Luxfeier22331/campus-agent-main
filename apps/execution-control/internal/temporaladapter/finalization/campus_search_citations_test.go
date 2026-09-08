package finalization

import (
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
	"testing"
)

func TestCampusSearchCitedRefsExcludeUnusedAndWebEvidence(t *testing.T) {
	refs := campusSearchCitedRefs(temporalruntime.WorkflowOperationActivityOutput{
		FinalOutput: "答案 [2] [3]",
		Evidence: []temporalruntime.WorkflowEvidence{
			{ID: "unused", ResultRef: "result://unused", Source: temporalruntime.WorkflowSourceCampusSearch, CitationIndex: 1},
			{ID: "cited", ResultRef: "result://cited", Source: temporalruntime.WorkflowSourceCampusSearch, CitationIndex: 2},
			{ID: "web", Source: temporalruntime.WorkflowSourceWebSearch, CitationIndex: 3},
		},
	})
	if len(refs) != 1 || refs[0] != "result://cited" {
		t.Fatalf("refs = %v", refs)
	}
}
