package providerconfig

import (
	"errors"
	"net"
	"net/url"
	"strings"
)

var errInvalidProviderBaseURL = errors.New("provider base url is invalid")

// NormalizeBaseURL validates the URL again at the network-consumer boundary.
// Configuration validation is not sufficient because snapshots may come from
// storage or an injected resolver after the profile was admitted.
func NormalizeBaseURL(raw string) (string, error) {
	return normalizeProviderBaseURL(raw)
}

func normalizeProviderBaseURL(raw string) (string, error) {
	parsed, err := parseProviderBaseURL(raw)
	if err != nil {
		return "", err
	}
	return parsed.String(), nil
}

func parseProviderBaseURL(raw string) (*url.URL, error) {
	value := strings.TrimSpace(raw)
	parsed, err := url.Parse(value)
	if err != nil || value == "" || !parsed.IsAbs() || parsed.Opaque != "" {
		return nil, errInvalidProviderBaseURL
	}
	parsed.Scheme = strings.ToLower(parsed.Scheme)
	if parsed.Scheme != "https" && parsed.Scheme != "http" {
		return nil, errInvalidProviderBaseURL
	}
	if parsed.Host == "" || parsed.Hostname() == "" || parsed.User != nil {
		return nil, errInvalidProviderBaseURL
	}
	if parsed.RawQuery != "" || parsed.ForceQuery || parsed.Fragment != "" {
		return nil, errInvalidProviderBaseURL
	}
	if parsed.Scheme == "http" && !isLoopbackProviderHost(parsed.Hostname()) {
		return nil, errors.New("provider base url must use https outside loopback")
	}
	return parsed, nil
}

func isLoopbackProviderHost(hostname string) bool {
	if strings.EqualFold(hostname, "localhost") {
		return true
	}
	ip := net.ParseIP(hostname)
	return ip != nil && ip.IsLoopback()
}
