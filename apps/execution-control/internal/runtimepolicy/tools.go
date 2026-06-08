package runtimepolicy

import "sync"

var (
	defaultToolSpecRegistryOnce sync.Once
	defaultToolSpecRegistry     ToolSpecRegistry
	defaultToolSpecRegistryOK   bool
)

func AllowedToolsForTarget(target string) []string {
	registry, ok := DefaultToolSpecRegistry()
	if !ok {
		return nil
	}
	return registry.AllowedToolsForTarget(target)
}

func AllowedToolsForPayloadKind(target string, payloadKind string) []string {
	registry, ok := DefaultToolSpecRegistry()
	if !ok {
		return nil
	}
	return registry.AllowedToolsForPayloadKind(target, payloadKind)
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
