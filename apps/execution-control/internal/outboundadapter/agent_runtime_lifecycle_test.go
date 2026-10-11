package outboundadapter

import (
	"context"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionapplication"
)

type runtimeRoundTripFunc func(*http.Request) (*http.Response, error)

func (f runtimeRoundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

type observedRuntimeBody struct {
	io.Reader
	closed bool
}

func (b *observedRuntimeBody) Close() error { b.closed = true; return nil }

func TestRuntimeClientClosesStreamWhenConsumerFails(t *testing.T) {
	body := &observedRuntimeBody{Reader: strings.NewReader("event: answer_delta\ndata: {\"schema_version\":\"workflow_runtime_answer_delta.v1\",\"delta\":\"a\"}\n\nevent: answer_delta\ndata: {\"schema_version\":\"workflow_runtime_answer_delta.v1\",\"delta\":\"b\"}\n\n")}
	client := &agentRuntimeHTTPClient{baseURL: "http://runtime", sharedSecret: "secret", httpClient: &http.Client{Transport: runtimeRoundTripFunc(func(*http.Request) (*http.Response, error) { return &http.Response{StatusCode: 200, Body: body}, nil })}}
	rejected := errors.New("projection failed")
	events := 0
	_, err := client.Execute(t.Context(), executionapplication.AgentRuntimeRequest{RequestID: "run", Stream: true}, func(event executionapplication.AgentRuntimeEvent) error {
		events++
		if event.Delta.Delta != "a" {
			t.Fatalf("unexpected event: %+v", event)
		}
		return rejected
	})
	if !errors.Is(err, rejected) || events != 1 || !body.closed {
		t.Fatalf("error=%v events=%d closed=%v", err, events, body.closed)
	}
}
func TestRuntimeClientClosesJSONResponseOnDecodeFailure(t *testing.T) {
	body := &observedRuntimeBody{Reader: strings.NewReader(`{"request_id":`)}
	client := &agentRuntimeHTTPClient{baseURL: "http://runtime", sharedSecret: "secret", httpClient: &http.Client{Transport: runtimeRoundTripFunc(func(*http.Request) (*http.Response, error) { return &http.Response{StatusCode: 200, Body: body}, nil })}}
	_, err := client.Execute(t.Context(), executionapplication.AgentRuntimeRequest{}, nil)
	if err == nil || !body.closed {
		t.Fatalf("error=%v closed=%v", err, body.closed)
	}
}
func TestRuntimeClientPropagatesCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	client := &agentRuntimeHTTPClient{baseURL: "http://runtime", sharedSecret: "secret", httpClient: &http.Client{Transport: runtimeRoundTripFunc(func(r *http.Request) (*http.Response, error) { return nil, r.Context().Err() })}}
	_, err := client.Execute(ctx, executionapplication.AgentRuntimeRequest{}, nil)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("cancellation lost: %v", err)
	}
}
