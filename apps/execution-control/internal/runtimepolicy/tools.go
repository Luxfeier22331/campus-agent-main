package runtimepolicy

import "sync"

var (
	defaultToolSpecRegistryOnce sync.Once
	defaultToolSpecRegistry     ToolSpecRegistry
	defaultToolSpecRegistryOK   bool
)

func AllowedToolsForCapability(capability string) []string {
	if !defaultCapabilityOpen(capability) {
		return nil
	}
	registry, ok := DefaultToolSpecRegistry()
	if !ok {
		return nil
	}
	return registry.AllowedToolsForCapability(capability)
}

func AllowedToolsForCapabilityPayloadKind(capability string, payloadKind string) []string {
	if !defaultCapabilityOpen(capability) {
		return nil
	}
	registry, ok := DefaultToolSpecRegistry()
	if !ok {
		return nil
	}
	return registry.AllowedToolsForCapabilityPayloadKind(capability, payloadKind)
}

func defaultCapabilityOpen(capability string) bool {
	registry, ok := DefaultCapabilitySpecRegistry()
	if !ok {
		return false
	}
	spec, ok := registry.CapabilityByID(capability)
	return ok && spec.Active && spec.OpeningGate == "open"
}

func DefaultToolSpecRegistry() (ToolSpecRegistry, bool) {
	defaultToolSpecRegistryOnce.Do(func() {
		registry, err := LoadToolSpecRegistry("")
		if err != nil {
			defaultToolSpecRegistryOK = false
			return
		}
		defaultToolSpecRegistry = registry
		defaultToolSpecRegistryOK = true
	})
	return defaultToolSpecRegistry, defaultToolSpecRegistryOK
}
