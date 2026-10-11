package outboundadapter

import "net/http"

func NoRedirectHTTPClient(client *http.Client) *http.Client {
	if client == nil {
		return &http.Client{CheckRedirect: rejectRedirect}
	}
	clone := *client
	clone.CheckRedirect = rejectRedirect
	return &clone
}

func rejectRedirect(_ *http.Request, _ []*http.Request) error {
	return http.ErrUseLastResponse
}
