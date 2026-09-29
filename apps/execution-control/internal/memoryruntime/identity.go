package memoryruntime

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"strings"
)

func OwnerScopeHash(ownerSalt string, tenantID string, userID string) string {
	mac := hmac.New(sha256.New, []byte(strings.TrimSpace(ownerSalt)))
	_, _ = mac.Write([]byte(strings.TrimSpace(tenantID) + "\x00" + strings.TrimSpace(userID)))
	return hex.EncodeToString(mac.Sum(nil))
}
