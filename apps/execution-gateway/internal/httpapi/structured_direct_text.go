package httpapi

import (
	"strconv"
	"strings"

	"github.com/MUC-WIKI/campus-agent/apps/execution-gateway/internal/structuredquery"
)

func structuredAnswerText(payloadKind string, result map[string]any, status string) string {
	if status == "completed" {
		switch payloadKind {
		case structuredquery.ToolServiceStatusLookup:
			subject := stringValue(result["resolved_subject"])
			statusValue := stringValue(result["observed_status"])
			if subject != "" && statusValue != "" {
				return subject + "当前状态：" + statusValue + "。"
			}
		case structuredquery.ToolServiceGuideLookup:
			service := stringValue(nestedMap(result, "resolved_service")["display_name"])
			guideText := serviceGuideAnswerContents(result)
			if service != "" && guideText != "" {
				return service + "：\n" + guideText
			}
			if guideText != "" {
				return guideText
			}
			if service != "" {
				return service
			}
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
		case structuredquery.ToolContactDirectoryLookup:
			contact := stringValue(nestedMap(result, "resolved_contact")["display_name"])
			contactText := contactDirectoryAnswerContents(result)
			if contact != "" && contactText != "" {
				return contact + "：\n" + contactText
			}
			if contactText != "" {
				return contactText
			}
			if contact != "" {
				return contact
			}
		case structuredquery.ToolAcademicCalendarLookup:
			if calendarText := academicCalendarAnswerText(result); calendarText != "" {
				return calendarText
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
	case structuredquery.ToolServiceStatusLookup:
		if stringValue(result["outcome"]) == "not_found" {
			return "当前没有找到对应的校园服务状态。"
		}
		return "当前还不能稳定确认这项校园服务的状态。"
	case structuredquery.ToolServiceGuideLookup:
		if stringValue(result["outcome"]) == "not_found" {
			return "当前没有找到对应的办理指南。"
		}
		if stringValue(result["outcome"]) == "clarification_required" {
			return "请明确你要查询的具体服务。"
		}
		return "当前还不能稳定确认这项办理指南。"
	case structuredquery.ToolTransportScheduleLookup:
		if stringValue(result["outcome"]) == "not_found" {
			return "当前没有找到对应的校车线路或班次。"
		}
		return "当前还不能稳定确认校车时刻。"
	case structuredquery.ToolContactDirectoryLookup:
		if stringValue(result["outcome"]) == "not_found" {
			return "当前没有找到对应的联系方式。"
		}
		if stringValue(result["outcome"]) == "clarification_required" {
			return "请明确你要查询的部门或联系对象。"
		}
		return "当前还不能稳定确认这项联系方式。"
	case structuredquery.ToolAcademicCalendarLookup:
		if stringValue(result["outcome"]) == "not_found" {
			return "当前没有找到对应的校历安排。"
		}
		if stringValue(result["outcome"]) == "clarification_required" {
			return "请明确你要查询的日期、假期名称或学年。"
		}
		return "当前还不能稳定确认这项校历安排。"
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

func serviceGuideSectionContents(raw any) string {
	items, ok := raw.([]any)
	if !ok {
		return ""
	}
	contents := make([]string, 0, len(items))
	for _, item := range items {
		section, ok := item.(map[string]any)
		if !ok {
			continue
		}
		content := stringValue(section["content"])
		if content != "" {
			contents = append(contents, content)
		}
	}
	return strings.Join(contents, "\n")
}

func serviceGuideAnswerContents(result map[string]any) string {
	switch stringValue(result["guide_focus"]) {
	case "procedure":
		return serviceGuideProcedureGroupContents(result["procedure_groups"])
	case "required_materials":
		return serviceGuideMaterialContents(result["required_materials"])
	case "entry":
		return serviceGuideEntryContents(result["entry_refs"])
	case "office_hours":
		return serviceGuideHoursContents(result["office_hours"])
	case "contact":
		return serviceGuideContactContents(result["contact_refs"])
	case "full_guide":
		return serviceGuideFullGuideContents(result)
	default:
		return ""
	}
}

func serviceGuideFullGuideContents(result map[string]any) string {
	parts := []string{}
	if procedures := serviceGuideProcedureGroupContents(result["procedure_groups"]); procedures != "" {
		parts = append(parts, procedures)
	}
	if materials := serviceGuideMaterialContents(result["required_materials"]); materials != "" {
		parts = append(parts, materials)
	}
	if entries := serviceGuideEntryContents(result["entry_refs"]); entries != "" {
		parts = append(parts, entries)
	}
	if hours := serviceGuideHoursContents(result["office_hours"]); hours != "" {
		parts = append(parts, hours)
	}
	if contacts := serviceGuideContactContents(result["contact_refs"]); contacts != "" {
		parts = append(parts, contacts)
	}
	if eligibility := strings.Join(stringSliceValue(result["eligibility_notes"]), "、"); eligibility != "" {
		parts = append(parts, eligibility)
	}
	return strings.Join(parts, "\n")
}

func serviceGuideProcedureGroupContents(raw any) string {
	items, ok := raw.([]any)
	if !ok {
		return ""
	}
	groups := make([]string, 0, len(items))
	for _, item := range items {
		group, ok := item.(map[string]any)
		if !ok {
			continue
		}
		stepsRaw, ok := group["steps"].([]any)
		if !ok {
			continue
		}
		steps := make([]string, 0, len(stepsRaw))
		for _, stepItem := range stepsRaw {
			step, ok := stepItem.(map[string]any)
			if !ok {
				continue
			}
			content := stringValue(step["content"])
			if content != "" {
				steps = append(steps, content)
			}
		}
		if len(steps) == 0 {
			continue
		}
		title := stringValue(group["title"])
		if title != "" {
			groups = append(groups, title+"：\n"+strings.Join(steps, "\n"))
			continue
		}
		groups = append(groups, strings.Join(steps, "\n"))
	}
	return strings.Join(groups, "\n")
}

func academicCalendarAnswerText(result map[string]any) string {
	parts := []string{}
	resolvedDate := stringValue(result["resolved_date"])
	academicYearLabel := stringValue(result["academic_year_label"])
	termLabel := stringValue(result["term_label"])
	holidayName := stringValue(result["holiday_name"])
	classDayPattern := stringValue(result["class_day_pattern"])
	dayKind := stringValue(result["day_kind"])
	weekIndex := intValue(result["week_index"])
	isMakeupClass, hasMakeupClass := boolValue(result["is_makeup_class"])

	if resolvedDate != "" && weekIndex > 0 {
		parts = append(parts, resolvedDate+"是第"+itoa(weekIndex)+"教学周")
	} else if weekIndex > 0 {
		parts = append(parts, "当前是第"+itoa(weekIndex)+"教学周")
	}
	if holidayName != "" {
		if resolvedDate != "" {
			parts = append(parts, resolvedDate+"属于"+holidayName)
		} else {
			parts = append(parts, "假期："+holidayName)
		}
	}
	if classDayPattern != "" {
		parts = append(parts, "执行课表："+classDayPattern)
	}
	if hasMakeupClass && isMakeupClass {
		parts = append(parts, "当天属于补课安排")
	}
	if dayKind != "" && dayKind != "teaching_day" {
		parts = append(parts, "日期类型："+dayKind)
	}
	if termLabel != "" {
		parts = append(parts, termLabel)
	}
	if academicYearLabel != "" {
		parts = append(parts, academicYearLabel)
	}
	return joinCalendarParts(parts)
}

func joinCalendarParts(parts []string) string {
	filtered := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part != "" {
			filtered = append(filtered, part)
		}
	}
	if len(filtered) == 0 {
		return ""
	}
	return strings.Join(filtered, "；") + "。"
}

func serviceGuideMaterialContents(raw any) string {
	items, ok := raw.([]any)
	if !ok {
		return ""
	}
	contents := make([]string, 0, len(items))
	for _, item := range items {
		material, ok := item.(map[string]any)
		if !ok {
			continue
		}
		name := stringValue(material["name"])
		if name != "" {
			contents = append(contents, name)
		}
	}
	return strings.Join(contents, "、")
}

func serviceGuideEntryContents(raw any) string {
	items, ok := raw.([]any)
	if !ok {
		return ""
	}
	contents := make([]string, 0, len(items))
	for _, item := range items {
		entry, ok := item.(map[string]any)
		if !ok {
			continue
		}
		label := stringValue(entry["label"])
		if label != "" {
			contents = append(contents, label)
		}
	}
	return strings.Join(contents, "、")
}

func serviceGuideHoursContents(raw any) string {
	items, ok := raw.([]any)
	if !ok {
		return ""
	}
	contents := make([]string, 0, len(items))
	for _, item := range items {
		hours, ok := item.(map[string]any)
		if !ok {
			continue
		}
		text := stringValue(hours["time_range"])
		if text == "" {
			text = stringValue(hours["effective_note"])
		}
		if text != "" {
			contents = append(contents, text)
		}
	}
	return strings.Join(contents, "、")
}

func serviceGuideContactContents(raw any) string {
	items, ok := raw.([]any)
	if !ok {
		return ""
	}
	contents := make([]string, 0, len(items))
	for _, item := range items {
		contact, ok := item.(map[string]any)
		if !ok {
			continue
		}
		if text := serviceGuideContactText(contact); text != "" {
			contents = append(contents, text)
		}
	}
	return strings.Join(contents, "、")
}

func serviceGuideContactText(contact map[string]any) string {
	parts := []string{}
	label := stringValue(contact["label"])
	department := stringValue(contact["department"])
	if label != "" {
		parts = append(parts, label)
	}
	if department != "" && department != label {
		parts = append(parts, department)
	}
	for _, key := range []string{"phone", "email"} {
		if value := stringValue(contact[key]); value != "" {
			parts = append(parts, value)
		}
	}
	return strings.Join(parts, " ")
}

func contactDirectoryAnswerContents(result map[string]any) string {
	if points := contactDirectoryPointContents(result["contact_points"]); points != "" {
		return points
	}
	if locations := contactDirectoryLocationContents(result["location_refs"]); locations != "" {
		return locations
	}
	if hours := contactDirectoryHoursContents(result["office_hours"]); hours != "" {
		return hours
	}
	return ""
}

func contactDirectoryPointContents(raw any) string {
	items, ok := raw.([]any)
	if !ok {
		return ""
	}
	contents := make([]string, 0, len(items))
	for _, item := range items {
		point, ok := item.(map[string]any)
		if !ok {
			continue
		}
		label := stringValue(point["label"])
		value := stringValue(point["value"])
		channel := stringValue(point["channel_type"])
		if value == "" {
			continue
		}
		text := value
		if label != "" {
			text = label + " " + value
		} else if channel != "" {
			text = channel + " " + value
		}
		contents = append(contents, strings.TrimSpace(text))
	}
	return strings.Join(contents, "、")
}

func contactDirectoryLocationContents(raw any) string {
	items, ok := raw.([]any)
	if !ok {
		return ""
	}
	contents := make([]string, 0, len(items))
	for _, item := range items {
		location, ok := item.(map[string]any)
		if !ok {
			continue
		}
		label := stringValue(location["label"])
		locationRef := stringValue(location["location_ref"])
		address := stringValue(location["address_text"])
		text := label
		if text == "" {
			text = locationRef
		}
		if address != "" {
			if text != "" {
				text = text + " " + address
			} else {
				text = address
			}
		}
		if strings.TrimSpace(text) != "" {
			contents = append(contents, strings.TrimSpace(text))
		}
	}
	return strings.Join(contents, "、")
}

func contactDirectoryHoursContents(raw any) string {
	items, ok := raw.([]any)
	if !ok {
		return ""
	}
	contents := make([]string, 0, len(items))
	for _, item := range items {
		hours, ok := item.(map[string]any)
		if !ok {
			continue
		}
		label := stringValue(hours["label"])
		timeRange := stringValue(hours["time_range"])
		note := stringValue(hours["effective_note"])
		text := timeRange
		if text == "" {
			text = note
		}
		if label != "" && text != "" {
			text = label + " " + text
		}
		if strings.TrimSpace(text) != "" {
			contents = append(contents, strings.TrimSpace(text))
		}
	}
	return strings.Join(contents, "、")
}

func stringSliceValue(raw any) []string {
	items, ok := raw.([]any)
	if !ok {
		return nil
	}
	values := make([]string, 0, len(items))
	for _, item := range items {
		value := stringValue(item)
		if value != "" {
			values = append(values, value)
		}
	}
	return values
}

func stringValue(value any) string {
	text, ok := value.(string)
	if !ok {
		return ""
	}
	return strings.TrimSpace(text)
}

func intValue(value any) int {
	switch typed := value.(type) {
	case int:
		return typed
	case int32:
		return int(typed)
	case int64:
		return int(typed)
	case float64:
		return int(typed)
	default:
		return 0
	}
}

func boolValue(value any) (bool, bool) {
	typed, ok := value.(bool)
	return typed, ok
}

func itoa(value int) string {
	return strconv.Itoa(value)
}
