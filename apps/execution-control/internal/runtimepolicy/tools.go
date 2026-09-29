package runtimepolicy

import "sync"

var (
	defaultToolSpecRegistryOnce sync.Once
	defaultToolSpecRegistry     ToolSpecRegistry
	defaultToolSpecRegistryOK   bool
)

func ModelVisibleFunctionToolNames() []string {
	registry, ok := DefaultToolSpecRegistry()
	if !ok {
		return nil
	}
	return registry.ModelVisibleFunctionToolNames()
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
