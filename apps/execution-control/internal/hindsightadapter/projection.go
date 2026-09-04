package hindsightadapter

import (
	"sort"
	"strings"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/memoryruntime"
)

const maxHindsightCompactTextBytes = 1200

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

func hindsightContextItems(
	results []hindsightRecallResult,
	limit int,
) []string {
	items := make([]string, 0, len(results))
	for _, result := range results {
		if limit > 0 && len(items) >= limit {
			break
		}
		if strings.TrimSpace(result.Text) == "" {
			continue
		}
		items = append(items, truncateUTF8Bytes(strings.TrimSpace(result.Text), maxHindsightCompactTextBytes))
	}
	return items
}

func truncateUTF8Bytes(value string, limit int) string {
	if limit <= 0 || len([]byte(value)) <= limit {
		return value
	}
	bytes := []byte(value)
	end := limit
	for end > 0 && end < len(bytes) && (bytes[end]&0xc0) == 0x80 {
		end--
	}
	return string(bytes[:end])
}

func hindsightContextBlock(items []string, maxChars int) string {
	if len(items) == 0 || maxChars <= 0 {
		return ""
	}
	var builder strings.Builder
	header := "用户记忆:\n"
	builder.WriteString(header)
	usedChars := len([]rune(header))
	usedChars = writeHindsightContextLine(&builder, usedChars, maxChars, "相关事实:\n")
	for _, item := range items {
		usedChars = writeHindsightContextLine(&builder, usedChars, maxChars, "- "+strings.TrimSpace(item)+"\n")
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
