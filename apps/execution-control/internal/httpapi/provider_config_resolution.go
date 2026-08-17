package httpapi

import (
	"context"
	"errors"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/providerconfig"
)

func (s *Server) resolveProviderConfig(
	ctx context.Context,
	kind providerconfig.Kind,
) (providerconfig.RuntimeSetting, error) {
	if s.providerConfigErr != nil &&
		!errors.Is(s.providerConfigErr, providerconfig.ErrResolverNotConfigured) {
		return providerconfig.RuntimeSetting{}, s.providerConfigErr
	}
	if s.providerConfigResolver == nil {
		return providerconfig.RuntimeSetting{}, providerconfig.ErrResolverNotConfigured
	}
	return s.providerConfigResolver.ResolveActiveProviderConfig(ctx, kind)
}
