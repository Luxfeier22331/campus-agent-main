package httpapi

import (
	"errors"
	"strings"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/contracts"
)

var contextualFollowUpTerms = []string{
	"那", "那么", "它", "这个", "这项", "上述", "该规定", "其中", "前者", "后者",
	"第十条", "第十款", "第二学期", "现在的规定", "前面", "刚才",
}

func (s *Server) campusDocsQuerySHA256ForAdmission(
	wire contracts.ExecutionPayloadWire,
) (string, error) {
	current := strings.TrimSpace(wire.UserGoal)
	if current == "" {
		return "", errors.New("user goal is required for Campus docs retrieval admission")
	}
	query := campusDocsQueryForExecutionInput(
		wire,
		positiveOrDefault(s.config.AgentRuntimeInputCharLimit, defaultAgentCurrentInputChars),
	)
	return sha256TextRef(query), nil
}

func campusDocsQueryForExecutionInput(wire contracts.ExecutionPayloadWire, limit int) string {
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

func containsAnyText(value string, candidates []string) bool {
	for _, candidate := range candidates {
		if strings.Contains(value, strings.ToLower(strings.TrimSpace(candidate))) {
			return true
		}
	}
	return false
}
