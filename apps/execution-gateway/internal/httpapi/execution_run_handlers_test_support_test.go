package httpapi

import "github.com/MUC-WIKI/campus-agent/apps/execution-gateway/internal/execution"

func durableRunCreateBodyForTest(runID string, conversationID string) string {
	return `{
		"run_id":"` + runID + `",
		"conversation_id":"` + conversationID + `",
		"turn_id":"turn-` + runID + `",
		"request_id":"req-` + runID + `",
		"trace_id":"trace-` + runID + `",
		"owner_user_id":"user-http-001",
		"surface":"public-chat-web",
		"lane":"rag",
		"metadata":{
			"execution_payload":{
				"user_goal":"hello",
				"request_id":"req-` + runID + `",
				"conversation_id":"` + conversationID + `",
				"trace":{"trace_id":"trace-` + runID + `"},
				"runtime_decisions":{"runtime_decision_summary":{}}
			},
			"handoff":{
				"target":"rag-tool",
				"payload_kind":"rag_request",
				"allowed_tools":["retrieval.query"],
				"payload":{"query_text":"hello"}
			}
		}
	}`
}

func attachDurableRuntimeStoreForHandlerTest(
	server *Server,
	store execution.DurableRuntimeStore,
) {
	server.durableRuntime = store
}
