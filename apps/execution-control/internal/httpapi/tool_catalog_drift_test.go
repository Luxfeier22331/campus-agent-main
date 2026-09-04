package httpapi

import (
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/runtimepolicy"
)

func TestCheckedInExecutionControlToolsRetainCurrentExposure(t *testing.T) {
	toolRegistry, err := runtimepolicy.LoadToolSpecRegistry("")
	if err != nil {
		t.Fatalf("load Go tool registry: %v", err)
	}
	registeredEndpoints := executionControlToolEndpointsByPath()
	wantEndpoints := map[string]string{
		"campus_search":          "/internal/campus/search",
		"personal_memory_recall": "/internal/memory/personal/recall",
	}

	for _, tool := range toolRegistry.Tools {
		endpoint, ok := wantEndpoints[tool.Name]
		if !ok {
			t.Fatalf("unexpected registered tool %s", tool.Name)
		}
		wantExposure := "model_visible"
		if tool.Exposure != wantExposure || !tool.ReadOnly || tool.RequiresApproval {
			t.Fatalf("registered tool %s exposure/read policy drifted: %#v", tool.Name, tool)
		}
		if tool.Handler.Type != "execution_control_internal_query" || tool.Handler.Endpoint != endpoint {
			t.Fatalf("tool %s handler = %#v, want endpoint %q", tool.Name, tool.Handler, endpoint)
		}
		if registeredEndpoints[tool.Handler.Endpoint] != tool.Name {
			t.Fatalf(
				"tool %s endpoint %q not registered to matching execution-control handler; registered=%q",
				tool.Name,
				tool.Handler.Endpoint,
				registeredEndpoints[tool.Handler.Endpoint],
			)
		}
		delete(wantEndpoints, tool.Name)
	}
	if len(wantEndpoints) != 0 {
		t.Fatalf("registered tools are missing: %#v", wantEndpoints)
	}
}

func executionControlToolEndpointsByPath() map[string]string {
	return map[string]string{
		"/internal/campus/search":          campusSearchToolName,
		"/internal/memory/personal/recall": personalMemoryRecallToolName,
	}
}
