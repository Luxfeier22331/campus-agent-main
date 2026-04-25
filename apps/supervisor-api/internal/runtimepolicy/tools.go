package runtimepolicy

var allowedToolsByTarget = map[string][]string{
	"rag-agent":        {},
	"navigation-agent": {},
	"campus-services-agent": {
		"service_status_lookup",
		"transport_schedule_lookup",
	},
	"notice-agent": {
		"campus_notice_discover",
		"campus_notice_get",
	},
}

func AllowedToolsForTarget(target string) []string {
	allowedTools, ok := allowedToolsByTarget[target]
	if !ok {
		return nil
	}
	return append([]string(nil), allowedTools...)
}

func AllowedToolsForPayloadKind(target string, payloadKind string) []string {
	for _, tool := range allowedToolsByTarget[target] {
		if tool == payloadKind {
			return []string{payloadKind}
		}
	}
	return nil
}
