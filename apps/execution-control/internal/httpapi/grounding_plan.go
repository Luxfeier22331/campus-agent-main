package httpapi

import (
	"errors"
	"strings"
	"unicode"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/contracts"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/runtimepolicy"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

const groundingPlanSchemaVersion = "grounding_plan.v1"

var institutionalGroundingTerms = []string{
	"校级", "规定", "办法", "制度", "申请", "资格", "条件", "材料", "办理",
	"毕业", "奖惩", "申诉", "培养方案",
}

var contextualFollowUpTerms = []string{
	"那", "那么", "它", "这个", "这项", "上述", "该规定", "其中", "前者", "后者",
	"第十条", "第十款", "第二学期", "现在的规定", "前面", "刚才",
}

func (s *Server) buildGroundingPlan(
	wire contracts.ExecutionPayloadWire,
) (temporalruntime.GroundingPlanSnapshot, error) {
	current := strings.TrimSpace(wire.UserGoal)
	if current == "" {
		return temporalruntime.GroundingPlanSnapshot{}, errors.New("grounding plan user goal is required")
	}
	query := groundingQueryForExecutionInput(
		wire,
		positiveOrDefault(s.config.AgentRuntimeInputCharLimit, defaultAgentCurrentInputChars),
	)
	plan := temporalruntime.GroundingPlanSnapshot{
		Mode:           "none",
		QuerySHA256:    sha256TextRef(query),
		SchemaVersion:  groundingPlanSchemaVersion,
		SelectedScopes: []string{},
	}
	if allowsUngroundedAnswer(current) {
		return plan, nil
	}
	policies, err := runtimepolicy.QueryServingScopes(strings.TrimSpace(s.config.QueryServingTargetsPath))
	if err != nil {
		return temporalruntime.GroundingPlanSnapshot{}, err
	}
	normalizedQuery := strings.ToLower(query)
	for _, policy := range policies {
		if containsAnyText(normalizedQuery, policy.RoutingTerms) {
			plan.SelectedScopes = append(plan.SelectedScopes, policy.Scope)
		}
	}
	if len(plan.SelectedScopes) == 0 && containsAnyText(normalizedQuery, institutionalGroundingTerms) {
		for _, policy := range policies {
			plan.SelectedScopes = append(plan.SelectedScopes, policy.Scope)
		}
	}
	switch len(plan.SelectedScopes) {
	case 0:
		plan.Mode = "none"
	case 1:
		plan.Mode = "single_scope"
	default:
		plan.Mode = "multi_scope"
	}
	return plan, nil
}

func groundingQueryForExecutionInput(wire contracts.ExecutionPayloadWire, limit int) string {
	current := strings.TrimSpace(wire.UserGoal)
	if !contextualFollowUpQuestion(current) {
		return current
	}
	previous := latestPreviousUserTurn(wire.Context, current)
	if previous == "" {
		return current
	}
	currentRunes := []rune(current)
	previousRunes := []rune(previous)
	remaining := limit - len(currentRunes) - 1
	if remaining <= 0 {
		return current
	}
	if len(previousRunes) > remaining {
		previousRunes = previousRunes[:remaining]
	}
	return strings.TrimSpace(string(previousRunes)) + "\n" + current
}

func latestPreviousUserTurn(context map[string]any, current string) string {
	conversation := cloneAnyMapFromMetadata(context["conversation"])
	turns := anyListFromAny(conversation["recent_turns"])
	for index := len(turns) - 1; index >= 0; index-- {
		turn := cloneAnyMapFromMetadata(turns[index])
		if firstNonEmptyText(turn["role"]) != "user" {
			continue
		}
		content := firstNonEmptyText(turn["content"])
		if content != "" && content != current {
			return content
		}
	}
	return ""
}

func contextualFollowUpQuestion(value string) bool {
	normalized := strings.ToLower(strings.TrimSpace(value))
	if containsAnyText(normalized, contextualFollowUpTerms) {
		return true
	}
	return strings.HasSuffix(normalized, "呢？") || strings.HasSuffix(normalized, "呢?") ||
		strings.HasSuffix(normalized, "呢")
}

func allowsUngroundedAnswer(value string) bool {
	normalized := strings.ToLower(strings.TrimSpace(value))
	trimmed := strings.TrimFunc(normalized, func(r rune) bool {
		return unicode.IsPunct(r) || unicode.IsSpace(r)
	})
	for _, direct := range []string{
		"你好", "您好", "嗨", "hi", "hello", "谢谢", "多谢", "好的", "好", "明白了",
		"你能做什么", "你是谁", "介绍一下你自己", "hi 你是谁",
	} {
		if trimmed == direct {
			return true
		}
	}
	if !containsAnyText(normalized, []string{"改写", "润色", "翻译", "改得更", "改成"}) {
		return false
	}
	if _, supplied, found := strings.Cut(normalized, ":"); found {
		return strings.TrimSpace(supplied) != ""
	}
	if _, supplied, found := strings.Cut(normalized, "："); found {
		return strings.TrimSpace(supplied) != ""
	}
	return false
}

func containsAnyText(value string, candidates []string) bool {
	for _, candidate := range candidates {
		if strings.Contains(value, strings.ToLower(strings.TrimSpace(candidate))) {
			return true
		}
	}
	return false
}
