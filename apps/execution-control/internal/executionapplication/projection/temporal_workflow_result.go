package projection

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
)

func Sha256AnyValue(value any) string {
	encoded, err := json.Marshal(value)
	if err != nil {
		return ""
	}
	digest := sha256.Sum256(encoded)
	return hex.EncodeToString(digest[:])
}
