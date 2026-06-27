package config

import "strings"

func (c Config) ToolOpen(toolName string) bool {
	normalizedTool := strings.TrimSpace(toolName)
	if normalizedTool == "" || normalizedTool == "knowledge_query" {
		return true
	}
	for _, item := range c.OpenTools {
		normalized := strings.TrimSpace(item)
		if normalized == normalizedTool {
			return true
		}
	}
	return false
}
