package executionfailure

import (
	"strings"
)

const DefaultExecutionFailureMessage = "Execution failed before completion."

type Summary struct {
	Kind    string
	Message string
}

func Summarize(kind string) Summary {
	kind = BoundedKind(kind)
	return Summary{
		Kind:    kind,
		Message: PublicMessage(kind),
	}
}

func BoundedKind(kind string) string {
	kind = strings.TrimSpace(kind)
	if kind == "" || len(kind) > 64 {
		return "execution_failed"
	}
	for _, char := range kind {
		if (char >= 'a' && char <= 'z') || (char >= '0' && char <= '9') || char == '_' || char == '-' {
			continue
		}
		return "execution_failed"
	}
	return kind
}

func PublicMessage(kind string) string {
	switch BoundedKind(kind) {
	case "answer_synthesis_failed":
		return "已找到部分资料，但生成最终回答失败，请稍后重试。"
	case "materials_insufficient":
		return "暂未找到足够的校内资料来回答这个问题。"
	case "personal_memory_not_configured":
		return "Personal memory could not be loaded for this request."
	case "agent_runtime_timeout", "agent_deadline_exceeded":
		return "The agent runtime did not complete before its deadline."
	case "provider_rate_limited", "provider_http_failed", "provider_connection_failed",
		"provider_timeout", "provider_unavailable":
		return "The answer provider is temporarily unavailable."
	case "citation_validation_failed":
		return "The answer citations could not be verified."
	case "tool_execution_failed":
		return "A runtime tool could not complete."
	default:
		return DefaultExecutionFailureMessage
	}
}

type Error struct {
	Message   string
	Code      string
	Permanent bool
	Details   map[string]string
}

func (e *Error) Error() string      { return e.Message + " (type: " + e.Code + ")" }
func (e *Error) Type() string       { return e.Code }
func (e *Error) NonRetryable() bool { return e.Permanent }
func PermanentError(message, code string, cause error) error {
	return &Error{Message: message, Code: code, Permanent: true}
}
func FromSummary(s Summary, permanent bool) error {
	return &Error{Message: s.Message, Code: s.Kind, Permanent: permanent}
}
func SanitizedError(kind string, cause error, permanent bool) error {
	return FromSummary(Summarize(kind), permanent)
}
func ErrorWithDetails(kind string, details map[string]string, permanent bool) error {
	s := Summarize(kind)
	return &Error{Message: s.Message, Code: s.Kind, Permanent: permanent, Details: details}
}

func (e *Error) HasDetails() bool { return e.Details != nil }
