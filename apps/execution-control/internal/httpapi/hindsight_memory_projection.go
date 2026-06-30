package httpapi

import (
	"encoding/json"
	"fmt"
	"net/url"
	"sort"
	"strings"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/memoryruntime"
)

func hindsightRecallQuery(request memoryruntime.RecallRequest) string {
	query := strings.TrimSpace(request.UserGoal)
	if len(request.SessionSlots) == 0 {
		return query
	}
	keys := make([]string, 0, len(request.SessionSlots))
	for key, value := range request.SessionSlots {
		if strings.TrimSpace(key) != "" && strings.TrimSpace(value) != "" {
			keys = append(keys, key)
		}
	}
	sort.Strings(keys)
	if len(keys) == 0 {
		return query
	}
	var builder strings.Builder
	builder.WriteString(query)
	builder.WriteString("\n\n已确认上下文:")
	for _, key := range keys {
		builder.WriteString("\n- ")
		builder.WriteString(strings.TrimSpace(key))
		builder.WriteString(": ")
		builder.WriteString(strings.TrimSpace(request.SessionSlots[key]))
	}
	return builder.String()
}

func hindsightReflectQuery(request memoryruntime.ReflectRequest) string {
	query := strings.TrimSpace(request.Query)
	if len(request.SessionSlots) == 0 {
		return query
	}
	keys := make([]string, 0, len(request.SessionSlots))
	for key, value := range request.SessionSlots {
		if strings.TrimSpace(key) != "" && strings.TrimSpace(value) != "" {
			keys = append(keys, key)
		}
	}
	sort.Strings(keys)
	if len(keys) == 0 {
		return query
	}
	var builder strings.Builder
	builder.WriteString(query)
	builder.WriteString("\n\n已确认上下文:")
	for _, key := range keys {
		builder.WriteString("\n- ")
		builder.WriteString(strings.TrimSpace(key))
		builder.WriteString(": ")
		builder.WriteString(strings.TrimSpace(request.SessionSlots[key]))
	}
	return builder.String()
}

func encodeHindsightConversationTurn(request memoryruntime.AppendConversationTurnRequest) (string, error) {
	turns := []hindsightConversationTurn{
		{Content: strings.TrimSpace(request.UserMessage), Role: "user"},
	}
	if !request.IgnoreAssistantForGraph {
		turns = append(turns, hindsightConversationTurn{
			Content: strings.TrimSpace(request.AssistantMessage),
			Role:    "assistant",
		})
	}
	encoded, err := json.Marshal(turns)
	if err != nil {
		return "", err
	}
	return string(encoded), nil
}

func appendedHindsightConversationTurnCount(request memoryruntime.AppendConversationTurnRequest) int {
	if request.IgnoreAssistantForGraph {
		return 1
	}
	return 2
}

func hindsightContextItems(
	results []hindsightRecallResult,
	tool string,
	limit int,
) []memoryruntime.ContextItem {
	items := make([]memoryruntime.ContextItem, 0, len(results))
	for _, result := range results {
		if limit > 0 && len(items) >= limit {
			break
		}
		if strings.TrimSpace(result.ID) == "" || strings.TrimSpace(result.Text) == "" {
			continue
		}
		updatedAt := firstNonEmpty(result.OccurredEnd, result.OccurredStart, result.MentionedAt)
		memoryType := defaultString(strings.TrimSpace(result.Type), "experience")
		items = append(items, memoryruntime.ContextItem{
			Tool:        tool,
			CompactText: strings.TrimSpace(result.Text),
			MemoryID:    strings.TrimSpace(result.ID),
			MemoryType:  memoryType,
			UpdatedAt:   updatedAt,
		})
	}
	return items
}

func hindsightReflectContextItems(results []hindsightReflectFact) []memoryruntime.ContextItem {
	items := make([]memoryruntime.ContextItem, 0, len(results))
	for _, result := range results {
		if strings.TrimSpace(result.ID) == "" || strings.TrimSpace(result.Text) == "" {
			continue
		}
		updatedAt := firstNonEmpty(result.OccurredEnd, result.OccurredStart)
		items = append(items, memoryruntime.ContextItem{
			Tool:        "memory_reflect",
			CompactText: strings.TrimSpace(result.Text),
			MemoryID:    strings.TrimSpace(result.ID),
			MemoryType:  defaultString(strings.TrimSpace(result.Type), "experience"),
			UpdatedAt:   updatedAt,
		})
	}
	return items
}

func hindsightContextBlock(items []memoryruntime.ContextItem, maxChars int) string {
	if len(items) == 0 || maxChars <= 0 {
		return ""
	}
	var builder strings.Builder
	header := "用户记忆:\n"
	builder.WriteString(header)
	usedChars := len([]rune(header))
	usedChars = writeHindsightContextLine(&builder, usedChars, maxChars, "相关事实:\n")
	for _, item := range items {
		usedChars = writeHindsightContextLine(&builder, usedChars, maxChars, "- "+strings.TrimSpace(item.CompactText)+"\n")
	}
	return strings.TrimSpace(builder.String())
}

func writeHindsightContextLine(builder *strings.Builder, usedChars int, maxChars int, line string) int {
	lineChars := len([]rune(line))
	if usedChars+lineChars > maxChars {
		return usedChars
	}
	builder.WriteString(line)
	return usedChars + lineChars
}

func hindsightDocumentTags(tenantID string, bankID string, documentID string, itemType string) []string {
	return []string{
		"scope:private",
		"type:" + strings.TrimSpace(itemType),
		"tenant:" + strings.TrimSpace(tenantID),
		"user:" + strings.TrimSpace(bankID),
		"session:" + strings.TrimSpace(documentID),
	}
}

func hindsightProfileTags(tenantID string, bankID string) []string {
	return []string{
		"scope:private",
		"type:profile",
		"tenant:" + strings.TrimSpace(tenantID),
		"user:" + strings.TrimSpace(bankID),
	}
}

func hindsightProfileDocumentID(memoryID string) string {
	return "profile:" + strings.TrimSpace(memoryID)
}

func memoryOperationProjectionRef(runID string, operationID string) string {
	return temporalProjectionRef(runID, "memory/operations/"+strings.TrimSpace(operationID))
}

func memoryDocumentProjectionRef(runID string, documentID string) string {
	escaped := strings.ReplaceAll(url.QueryEscape(strings.TrimSpace(documentID)), "+", "%20")
	return temporalProjectionRef(runID, "memory/documents/"+escaped)
}

func boolPointer(value bool) *bool {
	return &value
}

func copyStringMap(input map[string]string) map[string]string {
	if len(input) == 0 {
		return nil
	}
	output := make(map[string]string, len(input))
	for key, value := range input {
		output[key] = value
	}
	return output
}

func copyAnyMap(input map[string]any) map[string]any {
	if len(input) == 0 {
		return nil
	}
	output := make(map[string]any, len(input))
	for key, value := range input {
		output[key] = value
	}
	return output
}

func resultMetadataShape(input map[string]any) map[string]any {
	if len(input) == 0 {
		return nil
	}
	output := make(map[string]any, len(input))
	for key, value := range input {
		output[key] = fmt.Sprintf("%T", value)
	}
	return output
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}
