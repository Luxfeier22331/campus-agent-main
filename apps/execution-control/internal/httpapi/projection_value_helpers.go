package httpapi

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"strings"
)

func positiveIntValue(value any) (int, bool) {
	switch typed := value.(type) {
	case int:
		return typed, typed >= 1
	case int64:
		return int(typed), typed >= 1
	case float64:
		intValue := int(typed)
		return intValue, typed == float64(intValue) && intValue >= 1
	default:
		return 0, false
	}
}

func validSHA256Ref(value string) bool {
	hashValue := strings.TrimPrefix(strings.TrimSpace(value), "sha256:")
	if len(hashValue) != 64 {
		return false
	}
	for _, char := range hashValue {
		if (char < '0' || char > '9') && (char < 'a' || char > 'f') {
			return false
		}
	}
	return true
}

func sha256JSONRef(value any) string {
	raw, err := json.Marshal(value)
	if err != nil {
		raw = []byte("null")
	}
	sum := sha256.Sum256(raw)
	return "sha256:" + hex.EncodeToString(sum[:])
}

func sha256TextRef(value string) string {
	sum := sha256.Sum256([]byte(value))
	return "sha256:" + hex.EncodeToString(sum[:])
}
