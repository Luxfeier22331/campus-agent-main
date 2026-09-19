// Package citationdiagnostic owns bounded failure facts shared with Runtime and Ops.
package citationdiagnostic

import (
	"bytes"
	"encoding/json"
	"math"
	"regexp"
)

var Reasons = map[string]string{
	"missing_field": "引用字段缺失", "invalid_type": "引用字段类型错误",
	"invalid_url": "来源 URL 无效", "invalid_offset": "引用偏移非法",
	"span_out_of_bounds": "引用区间超出正文", "span_text_mismatch": "引用片段与正文不匹配",
	"span_overlap": "引用区间重叠", "duplicate_evidence_id": "证据 ID 重复",
	"source_index_conflict": "同一来源对应多个编号", "duplicate_citation_index": "引用编号重复",
	"invalid_marker": "引用标记非法", "missing_evidence": "引用编号没有对应证据",
	"invalid_source_identity": "来源身份无效", "missing_source_reference": "来源引用缺失",
	"unsupported_source": "来源类型不支持引用", "web_search_without_citations": "已搜索但没有引用",
	"citations_without_web_search": "引用与搜索事实不一致",
}
var identifier = regexp.MustCompile(`^[a-z][a-z0-9_]{0,63}$`)
var fieldName = regexp.MustCompile(`^[a-z][a-z0-9_.]{0,127}$`)

func Reason(value string) string {
	if identifier.MatchString(value) {
		return value
	}
	return ""
}

// Normalize retains valid facts, and marks malformed optional diagnostics without
// preserving their arbitrary payload or replacing the original execution failure.
func Normalize(raw json.RawMessage) json.RawMessage {
	if len(raw) == 0 || bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
		return nil
	}
	if Valid(raw) {
		return raw
	}
	return json.RawMessage(`{"schema_version":0}`)
}
func Valid(raw json.RawMessage) bool {
	if len(raw) > 2048 {
		return false
	}
	var value map[string]any
	if json.Unmarshal(raw, &value) != nil || value["schema_version"] != float64(1) {
		return false
	}
	stage, ok := value["validation_stage"].(string)
	if !ok || (stage != "provider_annotation" && stage != "evidence_mapping" && stage != "finalization") {
		return false
	}
	for key, val := range value {
		switch key {
		case "schema_version", "validation_stage":
		case "field":
			text, ok := val.(string)
			if !ok || !fieldName.MatchString(text) {
				return false
			}
		case "item_index", "text_length":
			n, ok := val.(float64)
			if !ok || n < 0 || n > 9007199254740991 || math.Trunc(n) != n {
				return false
			}
		case "citation_index", "start", "end":
			n, ok := val.(float64)
			if !ok || math.Abs(n) > 9007199254740991 {
				return false
			}
		case "offset_unit":
			if val != "utf16_code_unit" && val != "unicode_code_point" && val != "utf8_byte" {
				return false
			}
		case "actual_type":
			switch val {
			case "missing", "null", "string", "number", "boolean", "array", "object":
			default:
				return false
			}
		default:
			return false
		}
	}
	return true
}

func Build(stage, field string, facts map[string]any) json.RawMessage {
	value := map[string]any{"schema_version": 1, "validation_stage": stage}
	if field != "" {
		value["field"] = field
	}
	for k, v := range facts {
		value[k] = v
	}
	raw, err := json.Marshal(value)
	if err != nil {
		return json.RawMessage(`{"schema_version":0}`)
	}
	return Normalize(raw)
}
