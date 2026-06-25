package httpapi

import (
	"strings"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/structuredquery"
)

func structuredAnswerText(payloadKind string, result map[string]any, status string) string {
	if status == "completed" {
		switch payloadKind {
		case structuredquery.ToolTransportScheduleLookup:
			route := stringValue(nestedMap(result, "resolved_route")["display_name"])
			departure := stringValue(nestedMap(result, "selected_departure")["departure_at"])
			if route != "" && departure != "" {
				return route + "下一班发车时间：" + departure + "。"
			}
			snapshot := nestedMap(result, "schedule_snapshot")
			snapshotID := stringValue(snapshot["snapshot_id"])
			publishedAt := stringValue(snapshot["published_at"])
			if snapshotID != "" && publishedAt != "" {
				return "当前有效时刻表版本：" + snapshotID + "，发布时间：" + publishedAt + "。"
			}
		case structuredquery.ToolCampusNoticeDiscover:
			titles := noticeTitles(result["notice_cards"])
			if titles != "" {
				return "找到以下通知：" + titles + "。"
			}
		case structuredquery.ToolCampusNoticeGet:
			title := stringValue(result["title"])
			sourceURL := stringValue(result["source_url"])
			if title != "" && sourceURL != "" {
				return title + "\n\n官方原文：" + sourceURL
			}
			if title != "" {
				return title
			}
			if sourceURL != "" {
				return "官方原文：" + sourceURL
			}
		}
	}
	switch payloadKind {
	case structuredquery.ToolTransportScheduleLookup:
		if stringValue(result["outcome"]) == "not_found" {
			return "当前没有找到对应的校车线路或班次。"
		}
		return "当前还不能稳定确认校车时刻。"
	case structuredquery.ToolCampusNoticeDiscover:
		if stringValue(result["outcome"]) == "not_found" {
			return "当前没有找到对应通知。"
		}
		return "当前还不能稳定查询通知列表。"
	case structuredquery.ToolCampusNoticeGet:
		if stringValue(result["outcome"]) == "not_found" {
			return "当前没有找到这条通知。"
		}
		return "当前还不能稳定读取这条通知。"
	default:
		return "当前还不能稳定完成该结构化查询。"
	}
}

func nestedMap(parent map[string]any, key string) map[string]any {
	value, ok := parent[key].(map[string]any)
	if !ok {
		return map[string]any{}
	}
	return value
}

func noticeTitles(raw any) string {
	items, ok := raw.([]any)
	if !ok {
		return ""
	}
	titles := make([]string, 0, len(items))
	for _, item := range items {
		card, ok := item.(map[string]any)
		if !ok {
			continue
		}
		title := stringValue(card["title"])
		if title != "" {
			titles = append(titles, title)
		}
	}
	return strings.Join(titles, "、")
}

func stringValue(value any) string {
	text, ok := value.(string)
	if !ok {
		return ""
	}
	return strings.TrimSpace(text)
}
