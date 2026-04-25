package config

import "strings"

func (c Config) CapabilityOpen(capability string) bool {
	normalizedCapability := strings.TrimSpace(capability)
	if normalizedCapability == "" || normalizedCapability == "knowledge" || normalizedCapability == "place_lookup" {
		return true
	}
	for _, item := range c.OpenCapabilities {
		normalized := strings.TrimSpace(item)
		if normalized == "*" || normalized == "all" || normalized == normalizedCapability {
			return true
		}
	}
	return false
}
