package modelconfig

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
)

func TargetHash(target Target) string {
	payload := struct {
		Name        ConfigName `json:"name"`
		Provider    string     `json:"provider"`
		APIProtocol string     `json:"api_protocol"`
		BaseURL     string     `json:"base_url"`
		Model       string     `json:"model"`
	}{target.Name, target.Provider, target.APIProtocol, target.BaseURL, target.Model}
	b, _ := json.Marshal(payload)
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}
