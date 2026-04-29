package execution

import (
	"crypto/rand"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
)

func parseObject(raw json.RawMessage, fieldName string) (map[string]json.RawMessage, error) {
	if len(raw) == 0 {
		return nil, fmt.Errorf("%s must be an object", fieldName)
	}
	var payload map[string]json.RawMessage
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil, fmt.Errorf("%s must be an object", fieldName)
	}
	return payload, nil
}

func parseArray(raw json.RawMessage, fieldName string) ([]json.RawMessage, error) {
	var payload []json.RawMessage
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil, fmt.Errorf("%s must be an array", fieldName)
	}
	return payload, nil
}

func parseOptionalString(raw json.RawMessage) (string, error) {
	if len(raw) == 0 {
		return "", nil
	}
	if string(raw) == "null" {
		return "", nil
	}
	var value string
	if err := json.Unmarshal(raw, &value); err != nil {
		return "", err
	}
	return strings.TrimSpace(value), nil
}

func requireString(raw json.RawMessage, fieldName string) (string, error) {
	value, err := parseOptionalString(raw)
	if err != nil || value == "" {
		return "", fmt.Errorf("%s must be a non-empty string", fieldName)
	}
	return value, nil
}

func parseStringArray(raw json.RawMessage, fieldName string) ([]string, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return nil, nil
	}
	var values []string
	if err := json.Unmarshal(raw, &values); err != nil {
		return nil, fmt.Errorf("%s must only contain strings", fieldName)
	}
	normalized := make([]string, 0, len(values))
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed != "" {
			normalized = append(normalized, trimmed)
		}
	}
	return normalized, nil
}

func parseOptionalBool(raw json.RawMessage, fallback bool) (bool, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return fallback, nil
	}
	var value bool
	if err := json.Unmarshal(raw, &value); err != nil {
		return false, err
	}
	return value, nil
}

func parseOptionalInt(raw json.RawMessage, fallback int) (int, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return fallback, nil
	}
	var value int
	if err := json.Unmarshal(raw, &value); err != nil {
		return 0, err
	}
	return value, nil
}

func assertSupportedFields(
	payload map[string]json.RawMessage,
	allowed []string,
	fieldPrefix string,
	messageFormat string,
) error {
	allowedSet := make(map[string]struct{}, len(allowed))
	for _, field := range allowed {
		allowedSet[field] = struct{}{}
	}

	unsupported := make([]string, 0)
	for field := range payload {
		if _, ok := allowedSet[field]; !ok {
			unsupported = append(unsupported, fieldPrefix+"."+field)
		}
	}
	if len(unsupported) == 0 {
		return nil
	}
	sort.Strings(unsupported)
	return fmt.Errorf(messageFormat, strings.Join(unsupported, ", "))
}

func invalidRequest(message string) *HTTPError {
	return &HTTPError{
		Status:  400,
		Code:    "invalid_request",
		Message: message,
	}
}

func extractBearerToken(headerValue string) string {
	scheme, token, found := strings.Cut(strings.TrimSpace(headerValue), " ")
	if !found || !strings.EqualFold(scheme, "bearer") {
		return ""
	}
	return strings.TrimSpace(token)
}

func newDefaultContextProjection(actor actorContext) contextProjection {
	return contextProjection{
		Actor:         actor,
		Authorization: newDefaultAuthorizationProjection(actor),
	}
}

func newDefaultAuthorizationProjection(actor actorContext) authorizationProjection {
	principalID := strings.TrimSpace(actor.PrincipalID)
	if principalID == "" {
		principalID = strings.TrimSpace(actor.UserID)
	}
	return authorizationProjection{
		PrincipalID: principalID,
		RetrievalFilter: authorizedRetrievalFilter{
			VisibilityLevel:       "public",
			PolicyProjectionValue: defaultPolicyProjectionVersion,
		},
	}
}

func isLowerHex64(value string) bool {
	if len(value) != 64 {
		return false
	}
	for _, runeValue := range value {
		if (runeValue < '0' || runeValue > '9') && (runeValue < 'a' || runeValue > 'f') {
			return false
		}
	}
	return true
}

func newTraceID() string {
	buffer := make([]byte, 16)
	_, _ = rand.Read(buffer)
	buffer[6] = (buffer[6] & 0x0f) | 0x40
	buffer[8] = (buffer[8] & 0x3f) | 0x80
	return fmt.Sprintf(
		"%02x%02x%02x%02x-%02x%02x-%02x%02x-%02x%02x-%02x%02x%02x%02x%02x%02x",
		buffer[0],
		buffer[1],
		buffer[2],
		buffer[3],
		buffer[4],
		buffer[5],
		buffer[6],
		buffer[7],
		buffer[8],
		buffer[9],
		buffer[10],
		buffer[11],
		buffer[12],
		buffer[13],
		buffer[14],
		buffer[15],
	)
}
