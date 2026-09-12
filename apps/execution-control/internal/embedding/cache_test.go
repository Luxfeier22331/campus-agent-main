package embedding

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"math"
	"runtime"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

type embedFunc func(context.Context, Request) ([]float64, error)

func (f embedFunc) Embed(ctx context.Context, request Request) ([]float64, error) {
	return f(ctx, request)
}

func testRequest() Request {
	return Request{Input: "Instruct: find passages\nQuery:图书馆", Provider: "test", BaseURL: "https://example.test/v1", Model: "embedding", Dimensions: 2, InstructionVersion: "v1"}
}

func TestCacheObservesEachCaller(t *testing.T) {
	cache := NewCache(2, time.Hour, time.Second, nil)
	release := make(chan struct{})
	provider := embedFunc(func(context.Context, Request) ([]float64, error) { <-release; return []float64{1, 2}, nil })
	observations := make(chan CacheObservation, 4)
	ctx := WithObservation(t.Context(), func(o CacheObservation) { observations <- o })
	done := make(chan error, 2)
	go func() { _, err := cache.Embed(ctx, testRequest(), provider); done <- err }()
	waitForCallers(t, cache, 1)
	go func() { _, err := cache.Embed(ctx, testRequest(), provider); done <- err }()
	waitForCallers(t, cache, 2)
	close(release)
	for range 2 {
		if err := <-done; err != nil {
			t.Fatal(err)
		}
	}
	if _, err := cache.Embed(ctx, testRequest(), provider); err != nil {
		t.Fatal(err)
	}
	var bypass *Cache
	if _, err := bypass.Embed(ctx, testRequest(), provider); err != nil {
		t.Fatal(err)
	}
	counts := map[string]int{}
	for range 4 {
		counts[(<-observations).Outcome]++
	}
	for _, outcome := range []string{"miss", "wait", "hit", "bypass"} {
		if counts[outcome] != 1 {
			t.Fatalf("observations = %v", counts)
		}
	}
}

func TestCacheExactIdentityAndCopies(t *testing.T) {
	cache := NewCache(DefaultCapacity, DefaultTTL, time.Second, nil)
	request := testRequest()
	calls := 0
	providerVector := []float64{1, 2}
	provider := embedFunc(func(context.Context, Request) ([]float64, error) { calls++; return providerVector, nil })
	first, err := cache.Embed(t.Context(), request, provider)
	if err != nil {
		t.Fatal(err)
	}
	first[0], providerVector[0] = 99, 99
	second, err := cache.Embed(t.Context(), request, provider)
	if err != nil || second[0] != 1 || calls != 1 {
		t.Fatalf("hit = %v, %v; calls = %d", second, err, calls)
	}
	second[0] = 100
	third, _ := cache.Embed(t.Context(), request, provider)
	if third[0] != 1 {
		t.Fatal("hit returned shared vector")
	}
	for name, change := range map[string]func(*Request){
		"input":       func(r *Request) { r.Input += " " },
		"provider":    func(r *Request) { r.Provider += "-other" },
		"base URL":    func(r *Request) { r.BaseURL += "/other" },
		"model":       func(r *Request) { r.Model += "-other" },
		"instruction": func(r *Request) { r.InstructionVersion = "v2" },
		"dimensions":  func(r *Request) { r.Dimensions = 3 },
	} {
		t.Run(name, func(t *testing.T) {
			changed := request
			change(&changed)
			before := calls
			provider := embedFunc(func(_ context.Context, r Request) ([]float64, error) {
				calls++
				return make([]float64, r.Dimensions), nil
			})
			if _, err := cache.Embed(t.Context(), changed, provider); err != nil {
				t.Fatal(err)
			}
			if calls != before+1 {
				t.Fatal("different vector space/input reused entry")
			}
		})
	}
}

func TestCacheTTLAndLRU(t *testing.T) {
	cache := NewCache(2, time.Hour, time.Second, nil)
	now := time.Now()
	cache.now = func() time.Time { return now }
	calls := 0
	provider := embedFunc(func(context.Context, Request) ([]float64, error) { calls++; return []float64{1, 2}, nil })
	embed := func(input string) {
		t.Helper()
		request := testRequest()
		request.Input = input
		if _, err := cache.Embed(t.Context(), request, provider); err != nil {
			t.Fatal(err)
		}
	}
	embed("a")
	embed("b")
	embed("a")
	embed("c")
	embed("a")
	if calls != 3 {
		t.Fatalf("calls = %d, want 3", calls)
	}
	embed("b")
	if calls != 4 || len(cache.entries) != 2 {
		t.Fatal("LRU did not evict least-recently used entry")
	}
	now = now.Add(time.Hour)
	embed("b")
	if calls != 5 {
		t.Fatal("expired entry reused")
	}
}

func TestCacheDoesNotStoreFailures(t *testing.T) {
	for name, provider := range map[string]embedFunc{
		"error":     func(context.Context, Request) ([]float64, error) { return nil, errors.New("unavailable") },
		"empty":     func(context.Context, Request) ([]float64, error) { return nil, nil },
		"dimension": func(context.Context, Request) ([]float64, error) { return []float64{1}, nil },
		"nan":       func(context.Context, Request) ([]float64, error) { return []float64{1, math.NaN()}, nil },
		"infinity":  func(context.Context, Request) ([]float64, error) { return []float64{1, math.Inf(1)}, nil },
	} {
		t.Run(name, func(t *testing.T) {
			cache := NewCache(2, time.Hour, time.Second, nil)
			if _, err := cache.Embed(t.Context(), testRequest(), provider); err == nil {
				t.Fatal("expected error")
			}
			good := embedFunc(func(context.Context, Request) ([]float64, error) { return []float64{1, 2}, nil })
			if _, err := cache.Embed(t.Context(), testRequest(), good); err != nil {
				t.Fatalf("failure cached: %v", err)
			}
		})
	}
}

func waitForCallers(t *testing.T, cache *Cache, count int) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		cache.mu.Lock()
		call := cache.pending[requestKey(testRequest())]
		ready := call != nil && call.waiters == count
		cache.mu.Unlock()
		if ready {
			return
		}
		runtime.Gosched()
	}
	t.Fatalf("did not see %d concurrent callers", count)
}

func TestCacheCoalescesAndWaitersCancelIndependently(t *testing.T) {
	cache := NewCache(2, time.Hour, time.Second, nil)
	release := make(chan struct{})
	calls := atomic.Int64{}
	provider := embedFunc(func(ctx context.Context, _ Request) ([]float64, error) {
		calls.Add(1)
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-release:
			return []float64{1, 2}, nil
		}
	})
	leaderCtx, cancelLeader := context.WithCancel(t.Context())
	defer cancelLeader()
	leaderResult := make(chan error, 1)
	go func() { _, err := cache.Embed(leaderCtx, testRequest(), provider); leaderResult <- err }()
	waitForCallers(t, cache, 1)
	waiterCtx, cancelWaiter := context.WithCancel(t.Context())
	defer cancelWaiter()
	waiterResult := make(chan error, 1)
	go func() { _, err := cache.Embed(waiterCtx, testRequest(), provider); waiterResult <- err }()
	const survivors = 8
	results := make(chan []float64, survivors)
	for range survivors {
		go func() { vector, _ := cache.Embed(t.Context(), testRequest(), provider); results <- vector }()
	}
	waitForCallers(t, cache, survivors+2)
	cancelLeader()
	cancelWaiter()
	if !errors.Is(<-leaderResult, context.Canceled) || !errors.Is(<-waiterResult, context.Canceled) {
		t.Fatal("cancellation did not return")
	}
	close(release)
	for range survivors {
		vector := <-results
		if len(vector) != 2 || vector[0] != 1 {
			t.Fatalf("shared call lost: %v", vector)
		}
		vector[0] = 99
	}
	if calls.Load() != 1 {
		t.Fatalf("provider calls = %d", calls.Load())
	}
}

func TestCacheCancelsAbandonedCallAndAllowsRetry(t *testing.T) {
	cache := NewCache(2, time.Hour, time.Second, nil)
	started, canceled := make(chan struct{}), make(chan struct{})
	provider := embedFunc(func(ctx context.Context, _ Request) ([]float64, error) {
		close(started)
		<-ctx.Done()
		close(canceled)
		return nil, ctx.Err()
	})
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	result := make(chan error, 1)
	go func() { _, err := cache.Embed(ctx, testRequest(), provider); result <- err }()
	<-started
	cancel()
	if !errors.Is(<-result, context.Canceled) {
		t.Fatal("cancellation lost")
	}
	select {
	case <-canceled:
	case <-time.After(time.Second):
		t.Fatal("provider not canceled")
	}
	good := embedFunc(func(context.Context, Request) ([]float64, error) { return []float64{1, 2}, nil })
	if _, err := cache.Embed(t.Context(), testRequest(), good); err != nil {
		t.Fatal(err)
	}
}

func TestCacheProviderTimeoutAndBypass(t *testing.T) {
	cache := NewCache(2, time.Hour, time.Millisecond, nil)
	provider := embedFunc(func(ctx context.Context, _ Request) ([]float64, error) { <-ctx.Done(); return nil, ctx.Err() })
	if _, err := cache.Embed(t.Context(), testRequest(), provider); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("timeout = %v", err)
	}
	for _, disabled := range []*Cache{nil, NewCache(0, time.Hour, time.Second, nil), NewCache(2, 0, time.Second, nil)} {
		calls := 0
		provider := embedFunc(func(context.Context, Request) ([]float64, error) { calls++; return []float64{1, 2}, nil })
		for range 2 {
			if _, err := disabled.Embed(t.Context(), testRequest(), provider); err != nil {
				t.Fatal(err)
			}
		}
		if calls != 2 {
			t.Fatal("disabled cache did not bypass")
		}
	}
}

func TestCacheLogsActivityWithoutInputOrVector(t *testing.T) {
	var output bytes.Buffer
	cache := NewCache(2, time.Hour, time.Second, slog.New(slog.NewJSONHandler(&output, nil)))
	provider := embedFunc(func(context.Context, Request) ([]float64, error) { return []float64{1, 2}, nil })
	request := testRequest()
	for range 2 {
		if _, err := cache.Embed(t.Context(), request, provider); err != nil {
			t.Fatal(err)
		}
	}
	decoder := json.NewDecoder(&output)
	for _, event := range []string{"miss", "hit"} {
		var record map[string]any
		if err := decoder.Decode(&record); err != nil {
			t.Fatal(err)
		}
		if record["event_type"] != "campus_docs.embedding.cache."+event || record["count"] != float64(1) {
			t.Fatalf("record = %#v", record)
		}
		if saved, ok := record["saved_ms"].(float64); !ok || saved < 0 {
			t.Fatalf("saved_ms = %v", record["saved_ms"])
		}
		for key := range record {
			if !strings.Contains("|time|level|msg|event_type|count|saved_ms|", "|"+key+"|") {
				t.Fatalf("unexpected diagnostic field %s", key)
			}
		}
	}
}
