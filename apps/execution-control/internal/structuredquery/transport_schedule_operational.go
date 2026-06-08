package structuredquery

import (
	"strings"
	"time"
)

func matchingTransportOperationalNotices(
	records []transportOperationalNoticeRecord,
	route transportRouteRecord,
	serviceDate string,
) []transportOperationalNotice {
	if serviceDate == "" || route.RouteID == "" {
		return nil
	}
	serviceDay, err := time.ParseInLocation(transportLocalDateLayout, serviceDate, transportLocation)
	if err != nil {
		return nil
	}
	notices := []transportOperationalNotice{}
	for _, record := range records {
		if !stringSliceContains(record.RouteIDs, route.RouteID) {
			continue
		}
		if !transportOperationalNoticeEffectiveOn(record, serviceDay) {
			continue
		}
		notices = append(notices, transportOperationalNotice{
			NoticeID:           strings.TrimSpace(record.NoticeID),
			SourceRef:          strings.TrimSpace(record.SourceRef),
			NoticeKind:         strings.TrimSpace(record.NoticeKind),
			RouteIDs:           append([]string(nil), record.RouteIDs...),
			EffectiveFrom:      strings.TrimSpace(record.EffectiveFrom),
			EffectiveUntil:     strings.TrimSpace(record.EffectiveUntil),
			OperationalComment: strings.TrimSpace(record.OperationalComment),
		})
	}
	return notices
}

func transportOperationalNoticeEffectiveOn(
	record transportOperationalNoticeRecord,
	serviceDay time.Time,
) bool {
	if record.EffectiveFrom != "" {
		effectiveFrom, err := time.Parse(time.RFC3339, record.EffectiveFrom)
		if err != nil {
			return false
		}
		if serviceDay.AddDate(0, 0, 1).Before(effectiveFrom.In(transportLocation)) ||
			serviceDay.AddDate(0, 0, 1).Equal(effectiveFrom.In(transportLocation)) {
			return false
		}
	}
	if record.EffectiveUntil != "" {
		effectiveUntil, err := time.Parse(time.RFC3339, record.EffectiveUntil)
		if err != nil {
			return false
		}
		if !serviceDay.Before(effectiveUntil.In(transportLocation)) {
			return false
		}
	}
	return true
}

func transportOperationalNoticeRefs(notices []transportOperationalNotice) []string {
	refs := []string{}
	for _, notice := range notices {
		refs = appendUniqueTransportRefs(refs, []string{notice.SourceRef})
	}
	return refs
}

func appendUniqueTransportRefs(first []string, second []string) []string {
	seen := map[string]struct{}{}
	refs := []string{}
	appendRef := func(value string) {
		value = strings.TrimSpace(value)
		if value == "" {
			return
		}
		if _, ok := seen[value]; ok {
			return
		}
		seen[value] = struct{}{}
		refs = append(refs, value)
	}
	for _, ref := range first {
		appendRef(ref)
	}
	for _, ref := range second {
		appendRef(ref)
	}
	return refs
}
