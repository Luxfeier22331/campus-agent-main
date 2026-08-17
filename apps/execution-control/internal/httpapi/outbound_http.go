package httpapi

import "net/http"

func noRedirectHTTPClient(client *http.Client) *http.Client {
	if client == nil {
		return &http.Client{CheckRedirect: rejectHTTPRedirect}
	}
	clone := *client
	clone.CheckRedirect = rejectHTTPRedirect
	return &clone
}

func rejectHTTPRedirect(_ *http.Request, _ []*http.Request) error {
	return http.ErrUseLastResponse
}
