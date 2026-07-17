package providerconfig

import (
	"crypto/rand"
	"encoding/hex"
)

func newID(prefix string) string {
	raw := make([]byte, 12)
	_, _ = rand.Read(raw)
	return prefix + "_" + hex.EncodeToString(raw)
}
