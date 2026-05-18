package structuredquery

import "strings"

func contactDirectoryResultFromRecord(
	request contactDirectoryRequest,
	record contactDirectoryRecord,
	timeAnchor string,
) contactDirectoryResult {
	contactPoints := contactDirectoryContactPoints(record)
	contactPoints = filterContactPointsForQuery(request.QueryText, request.ContactFocus, contactPoints)
	locationRefs := contactDirectoryLocationRefs(record)
	officeHours := contactDirectoryOfficeHoursRows(record)
	filteredPoints, filteredLocations, filteredHours := contactDirectoryFocusFilteredData(
		request.ContactFocus,
		contactPoints,
		locationRefs,
		officeHours,
	)
	result := contactDirectoryResult{
		QueryText:    request.QueryText,
		ContactFocus: request.ContactFocus,
		Outcome:      "resolved_current",
		ResolvedContact: &contactDirectoryContactRef{
			ContactID:    strings.TrimSpace(record.ContactID),
			DisplayName:  strings.TrimSpace(record.DisplayName),
			Aliases:      append([]string(nil), record.Aliases...),
			EntityType:   defaultContactEntityType(record.EntityType),
			Department:   strings.TrimSpace(record.Department),
			ContactGroup: strings.TrimSpace(record.ContactGroup),
			CampusScope:  strings.TrimSpace(record.CampusScope),
			Audience:     append([]string(nil), record.Audience...),
		},
		ContactPoints:     filteredPoints,
		LocationRefs:      filteredLocations,
		OfficeHours:       filteredHours,
		QueriedTimeAnchor: timeAnchor,
		SourceRefs: uniqueContactDirectorySourceRefs(
			record.SourceRefs,
			filteredPoints,
			filteredLocations,
			filteredHours,
		),
		FieldStatus: normalizedFieldStatus(record.FieldStatus),
	}
	return result
}

func contactDirectoryFocusFilteredData(
	focus string,
	contactPoints []contactDirectoryContactPoint,
	locationRefs []contactDirectoryLocationRef,
	officeHours []contactDirectoryOfficeHours,
) ([]contactDirectoryContactPoint, []contactDirectoryLocationRef, []contactDirectoryOfficeHours) {
	switch focus {
	case "phone":
		return filterContactPointsByChannel(contactPoints, "phone"), nil, nil
	case "email":
		return filterContactPointsByChannel(contactPoints, "email"), nil, nil
	case "location":
		return nil, locationRefs, nil
	case "office_hours":
		return nil, nil, officeHours
	case "contact_person":
		return contactPoints, locationRefs, officeHours
	default:
		return contactPoints, locationRefs, officeHours
	}
}

func contactDirectoryFocusSatisfied(result contactDirectoryResult) bool {
	if len(result.ContactPoints) > 0 || len(result.LocationRefs) > 0 || len(result.OfficeHours) > 0 {
		return true
	}
	return false
}

func contactDirectoryFocusNotProvidedBySource(record contactDirectoryRecord, focus string) bool {
	for _, fieldName := range contactDirectoryFocusFieldNames(focus) {
		if strings.TrimSpace(record.FieldStatus[fieldName]) == "source_not_provided" {
			return true
		}
	}
	return false
}

func contactDirectoryFocusFieldNames(focus string) []string {
	switch focus {
	case "phone":
		return []string{"phone"}
	case "email":
		return []string{"email"}
	case "location":
		return []string{"location"}
	case "office_hours":
		return []string{"office_hours"}
	case "contact_person":
		return []string{"contact_person"}
	default:
		return nil
	}
}

func filterContactPointsByChannel(
	points []contactDirectoryContactPoint,
	channel string,
) []contactDirectoryContactPoint {
	filtered := []contactDirectoryContactPoint{}
	for _, point := range points {
		if strings.TrimSpace(point.ChannelType) != channel {
			continue
		}
		filtered = append(filtered, point)
	}
	return filtered
}

func filterContactPointsForQuery(
	query string,
	focus string,
	points []contactDirectoryContactPoint,
) []contactDirectoryContactPoint {
	if focus != "phone" && focus != "email" {
		return points
	}
	normalizedQuery := normalizeSearchText(query)
	if normalizedQuery == "" {
		return points
	}
	matched := []contactDirectoryContactPoint{}
	for _, point := range points {
		label := normalizeSearchText(point.Label)
		if label == "" {
			continue
		}
		if strings.Contains(normalizedQuery, label) || strings.Contains(label, normalizedQuery) {
			matched = append(matched, point)
		}
	}
	if len(matched) > 0 {
		return matched
	}
	return points
}

func contactDirectoryContactPoints(record contactDirectoryRecord) []contactDirectoryContactPoint {
	points := []contactDirectoryContactPoint{}
	for _, point := range record.ContactPoints {
		value := strings.TrimSpace(point.Value)
		if value == "" {
			continue
		}
		sourceRefs := normalizedStringSlice(point.SourceRefs)
		if len(sourceRefs) == 0 {
			continue
		}
		points = append(points, contactDirectoryContactPoint{
			ChannelType:       normalizeContactChannel(point.ChannelType, value),
			Label:             contactDefaultString(strings.TrimSpace(point.Label), strings.TrimSpace(record.DisplayName)),
			Value:             value,
			NormalizedValue:   contactDefaultString(strings.TrimSpace(point.NormalizedValue), normalizeContactValue(value)),
			ContactType:       strings.TrimSpace(point.ContactType),
			AreaServed:        strings.TrimSpace(point.AreaServed),
			AvailableLanguage: strings.TrimSpace(point.AvailableLanguage),
			HoursRef:          strings.TrimSpace(point.HoursRef),
			SourceRefs:        sourceRefs,
		})
	}
	for _, phone := range record.Phones {
		number := strings.TrimSpace(phone.Number)
		if number == "" {
			continue
		}
		sourceRefs := normalizedStringSlice(phone.SourceRefs)
		if len(sourceRefs) == 0 {
			continue
		}
		points = append(points, contactDirectoryContactPoint{
			ChannelType:     "phone",
			Label:           contactDefaultString(strings.TrimSpace(phone.Label), strings.TrimSpace(record.DisplayName)),
			Value:           number,
			NormalizedValue: normalizeContactValue(number),
			SourceRefs:      sourceRefs,
		})
	}
	for _, email := range record.Emails {
		address := strings.TrimSpace(email.Address)
		if address == "" {
			continue
		}
		sourceRefs := normalizedStringSlice(email.SourceRefs)
		if len(sourceRefs) == 0 {
			continue
		}
		points = append(points, contactDirectoryContactPoint{
			ChannelType:     "email",
			Label:           contactDefaultString(strings.TrimSpace(email.Label), strings.TrimSpace(record.DisplayName)),
			Value:           address,
			NormalizedValue: strings.ToLower(address),
			SourceRefs:      sourceRefs,
		})
	}
	return dedupeContactPoints(points)
}

func contactDirectoryLocationRefs(record contactDirectoryRecord) []contactDirectoryLocationRef {
	items := []contactDirectoryLocationRef{}
	for _, entry := range contactDirectoryLocationEntries(record) {
		label := contactDefaultString(strings.TrimSpace(entry.Label), strings.TrimSpace(entry.LocationRef))
		if label == "" {
			label = strings.TrimSpace(entry.AddressText)
		}
		if label == "" {
			continue
		}
		locationRef := contactDefaultString(strings.TrimSpace(entry.LocationRef), label)
		sourceRefs := normalizedStringSlice(entry.SourceRefs)
		if len(sourceRefs) == 0 {
			continue
		}
		items = append(items, contactDirectoryLocationRef{
			Label:       label,
			LocationRef: locationRef,
			AddressText: strings.TrimSpace(entry.AddressText),
			SourceRefs:  sourceRefs,
		})
	}
	return dedupeLocationRefs(items)
}

func contactDirectoryOfficeHoursRows(record contactDirectoryRecord) []contactDirectoryOfficeHours {
	items := []contactDirectoryOfficeHours{}
	for _, entry := range contactDirectoryOfficeHoursEntries(record) {
		label := contactDefaultString(strings.TrimSpace(entry.Label), strings.TrimSpace(record.DisplayName))
		if label == "" {
			continue
		}
		hoursID := contactDefaultString(strings.TrimSpace(entry.HoursID), label)
		sourceRefs := normalizedStringSlice(entry.SourceRefs)
		if len(sourceRefs) == 0 {
			continue
		}
		items = append(items, contactDirectoryOfficeHours{
			HoursID:       hoursID,
			Label:         label,
			DayPattern:    strings.TrimSpace(entry.DayPattern),
			TimeRange:     strings.TrimSpace(entry.TimeRange),
			EffectiveNote: strings.TrimSpace(entry.EffectiveNote),
			SourceRefs:    sourceRefs,
		})
	}
	return items
}

func contactDirectoryLocationEntries(record contactDirectoryRecord) []contactDirectoryLocationEntry {
	entries := []contactDirectoryLocationEntry{}
	for _, raw := range record.LocationRefs {
		switch item := raw.(type) {
		case string:
			text := strings.TrimSpace(item)
			if text == "" {
				continue
			}
			entries = append(entries, contactDirectoryLocationEntry{
				Label:       text,
				LocationRef: text,
				SourceRefs:  nil,
			})
		case map[string]any:
			entries = append(entries, contactDirectoryLocationEntry{
				Label:       anyStringValue(item["label"]),
				LocationRef: anyStringValue(item["location_ref"]),
				AddressText: anyStringValue(item["address_text"]),
				SourceRefs:  anyStringSliceValue(item["source_refs"]),
			})
		}
	}
	return entries
}

func contactDirectoryOfficeHoursEntries(record contactDirectoryRecord) []contactDirectoryOfficeHoursEntry {
	entries := []contactDirectoryOfficeHoursEntry{}
	for _, raw := range record.OfficeHours {
		item, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		entries = append(entries, contactDirectoryOfficeHoursEntry{
			HoursID:       anyStringValue(item["hours_id"]),
			Label:         anyStringValue(item["label"]),
			DayPattern:    anyStringValue(item["day_pattern"]),
			TimeRange:     anyStringValue(item["time_range"]),
			EffectiveNote: anyStringValue(item["effective_note"]),
			SourceRefs:    anyStringSliceValue(item["source_refs"]),
		})
	}
	return entries
}

func normalizeContactChannel(channel string, value string) string {
	normalized := strings.TrimSpace(channel)
	if normalized != "" {
		return normalized
	}
	if strings.Contains(value, "@") {
		return "email"
	}
	return "phone"
}

func normalizeContactValue(value string) string {
	value = strings.TrimSpace(value)
	replacer := strings.NewReplacer(" ", "", "-", "", "(", "", ")", "", "（", "", "）", "")
	return replacer.Replace(value)
}

func normalizedStringSlice(values []string) []string {
	seen := map[string]struct{}{}
	normalized := []string{}
	for _, value := range values {
		text := strings.TrimSpace(value)
		if text == "" {
			continue
		}
		if _, ok := seen[text]; ok {
			continue
		}
		seen[text] = struct{}{}
		normalized = append(normalized, text)
	}
	return normalized
}

func anyStringValue(value any) string {
	text, ok := value.(string)
	if !ok {
		return ""
	}
	return strings.TrimSpace(text)
}

func anyStringSliceValue(raw any) []string {
	items, ok := raw.([]any)
	if !ok {
		return nil
	}
	values := make([]string, 0, len(items))
	for _, item := range items {
		if text := anyStringValue(item); text != "" {
			values = append(values, text)
		}
	}
	return values
}

func contactDefaultString(value string, defaultValue string) string {
	if strings.TrimSpace(value) == "" {
		return defaultValue
	}
	return value
}

func dedupeContactPoints(points []contactDirectoryContactPoint) []contactDirectoryContactPoint {
	seen := map[string]struct{}{}
	deduped := []contactDirectoryContactPoint{}
	for _, point := range points {
		key := strings.Join([]string{
			point.ChannelType,
			point.Label,
			point.Value,
			point.NormalizedValue,
		}, "|")
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		deduped = append(deduped, point)
	}
	return deduped
}

func dedupeLocationRefs(items []contactDirectoryLocationRef) []contactDirectoryLocationRef {
	seen := map[string]struct{}{}
	deduped := []contactDirectoryLocationRef{}
	for _, item := range items {
		key := strings.Join([]string{
			item.Label,
			item.LocationRef,
			item.AddressText,
		}, "|")
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		deduped = append(deduped, item)
	}
	return deduped
}

func uniqueContactDirectorySourceRefs(
	recordSourceRefs []string,
	contactPoints []contactDirectoryContactPoint,
	locationRefs []contactDirectoryLocationRef,
	officeHours []contactDirectoryOfficeHours,
) []string {
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
	for _, ref := range recordSourceRefs {
		appendRef(ref)
	}
	for _, point := range contactPoints {
		for _, ref := range point.SourceRefs {
			appendRef(ref)
		}
	}
	for _, location := range locationRefs {
		for _, ref := range location.SourceRefs {
			appendRef(ref)
		}
	}
	for _, hours := range officeHours {
		for _, ref := range hours.SourceRefs {
			appendRef(ref)
		}
	}
	return refs
}

func failClosedContactDirectory(
	request contactDirectoryRequest,
	timeAnchor string,
	reason string,
) Response {
	body := contactDirectoryResult{
		QueryText:         request.QueryText,
		ContactFocus:      request.ContactFocus,
		Outcome:           "temporarily_unverifiable",
		QueriedTimeAnchor: timeAnchor,
		FailCloseReason:   reason,
	}
	return Response{StatusCode: 200, Outcome: body.Outcome, Body: body}
}

func failClosedContactDirectoryForRecord(
	request contactDirectoryRequest,
	record contactDirectoryRecord,
	timeAnchor string,
	reason string,
) Response {
	body := contactDirectoryResult{
		QueryText:         request.QueryText,
		ContactFocus:      request.ContactFocus,
		Outcome:           "temporarily_unverifiable",
		QueriedTimeAnchor: timeAnchor,
		FailCloseReason:   reason,
		FieldStatus:       normalizedFieldStatus(record.FieldStatus),
	}
	return Response{StatusCode: 200, Outcome: body.Outcome, Body: body}
}
