package campusdocs

import "testing"

func TestEncodeAndDecodeNoticeSearchResult(t *testing.T) {
	input := []SearchResultItem{{
		CitationHref:  "/notices/12345",
		CitationIndex: 2,
		NoticeID:      "12345",
		ResultRef:     "result://" + repeated("a", 64),
		SectionTitle:  "报名要求",
		SourceKind:    "notice",
		Text:          "请在规定时间内完成报名。",
		Title:         "关于报名的通知",
	}}
	encoded := EncodeSearchResult(input, 2)
	_, decoded, err := DecodeSearchResult(encoded)
	if err != nil {
		t.Fatalf("decode notice result: %v", err)
	}
	if len(decoded) != 1 || decoded[0].NoticeID != input[0].NoticeID ||
		decoded[0].CitationHref != input[0].CitationHref || decoded[0].SourceKind != "notice" {
		t.Fatalf("decoded notice result = %#v", decoded)
	}
}

func TestDecodeNoticeSearchResultRejectsDocumentFields(t *testing.T) {
	result := map[string]any{
		"outcome": "matched",
		"results": []map[string]any{{
			"citation_href":  "/notices/12345",
			"citation_index": 1,
			"document_id":    "should-not-be-here",
			"notice_id":      "12345",
			"result_ref":     "result://" + repeated("b", 64),
			"section_title":  "正文",
			"source_kind":    "notice",
			"text":           "正文",
			"title":          "通知",
		}},
	}
	if _, _, err := DecodeSearchResult(result); err == nil {
		t.Fatal("accepted notice result with document fields")
	}
}

func TestDecodeNoticeSearchResultRejectsMismatchedCitationHref(t *testing.T) {
	result := map[string]any{
		"outcome": "matched",
		"results": []map[string]any{{
			"citation_href":  "/notices/54321",
			"citation_index": 1,
			"notice_id":      "12345",
			"result_ref":     "result://" + repeated("c", 64),
			"section_title":  "正文",
			"source_kind":    "notice",
			"text":           "正文",
			"title":          "通知",
		}},
	}
	if _, _, err := DecodeSearchResult(result); err == nil {
		t.Fatal("accepted notice result whose citation href identifies another notice")
	}
}

func repeated(value string, count int) string {
	result := ""
	for index := 0; index < count; index++ {
		result += value
	}
	return result
}
