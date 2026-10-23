package embedding

import (
	"container/list"
	"context"
	"crypto/sha256"
	"encoding/json"
	"log/slog"
	"slices"
	"sync"
	"time"
)

const (
	DefaultCapacity = 512
	DefaultTTL      = 24 * time.Hour
	cacheVersion    = "embedding.v1"
)

type cacheEntry struct {
	key       [sha256.Size]byte
	vector    []float64
	expiresAt time.Time
	latency   time.Duration
}

type pendingEmbedding struct {
	done    chan struct{}
	cancel  context.CancelFunc
	waiters int
	vector  []float64
	err     error
}

// Cache is shared by a retrieval adapter, not by individual searches. Provider
// credentials stay with the per-call Embedder and are never stored in entries.
type Cache struct {
	mu       sync.Mutex
	entries  map[[sha256.Size]byte]*list.Element
	lru      *list.List
	pending  map[[sha256.Size]byte]*pendingEmbedding
	capacity int
	ttl      time.Duration
	timeout  time.Duration
	now      func() time.Time
	logger   *slog.Logger
}

func NewCache(capacity int, ttl, timeout time.Duration, logger *slog.Logger) *Cache {
	return &Cache{
		entries: make(map[[sha256.Size]byte]*list.Element), lru: list.New(),
		pending:  make(map[[sha256.Size]byte]*pendingEmbedding),
		capacity: capacity, ttl: ttl, timeout: timeout, now: time.Now,
		logger: logger,
	}
}

func requestKey(request Request) [sha256.Size]byte {
	// JSON frames fields unambiguously, including arbitrary newlines in the input.
	encoded, _ := json.Marshal(struct {
		Version string
		Request
	}{cacheVersion, request})
	return sha256.Sum256(encoded)
}

// Embed coalesces identical requests. Every caller can cancel independently; the
// shared provider call ends when all callers leave or its provider timeout expires.
// A nil/disabled cache directly invokes the provider without changing its result.
func (cache *Cache) Embed(ctx context.Context, request Request, provider Embedder) ([]float64, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if cache == nil || cache.capacity <= 0 || cache.ttl <= 0 {
		observeCache(ctx, CacheObservation{Outcome: "bypass"})
		return load(ctx, request, provider)
	}
	key := requestKey(request)
	cache.mu.Lock()
	if element := cache.entries[key]; element != nil {
		entry := element.Value.(cacheEntry)
		if cache.now().Before(entry.expiresAt) {
			cache.lru.MoveToFront(element)
			vector := slices.Clone(entry.vector)
			cache.mu.Unlock()
			cache.record(ctx, "hit", entry.latency)
			observeCache(ctx, CacheObservation{Outcome: "hit", EstimatedSavedMs: entry.latency.Milliseconds()})
			return vector, nil
		}
		cache.remove(element)
	}
	call := cache.pending[key]
	outcome := "wait"
	if call == nil {
		providerCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), cache.timeout)
		call = &pendingEmbedding{done: make(chan struct{}), cancel: cancel}
		cache.pending[key] = call
		outcome = "miss"
		go cache.fill(providerCtx, key, request, provider, call)
	}
	call.waiters++
	cache.mu.Unlock()
	cache.record(ctx, outcome, 0)
	waitStarted := time.Now()
	defer func() {
		observation := CacheObservation{Outcome: outcome}
		if outcome == "wait" {
			observation.WaitMs = time.Since(waitStarted).Milliseconds()
		}
		observeCache(ctx, observation)
	}()

	select {
	case <-ctx.Done():
		cache.mu.Lock()
		call.waiters--
		if call.waiters == 0 && cache.pending[key] == call {
			delete(cache.pending, key)
			call.cancel()
		}
		cache.mu.Unlock()
		return nil, ctx.Err()
	case <-call.done:
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		return slices.Clone(call.vector), call.err
	}
}

func load(ctx context.Context, request Request, provider Embedder) ([]float64, error) {
	vector, err := provider.Embed(ctx, request)
	if err != nil {
		return nil, err
	}
	if err := validate(vector, request.Dimensions); err != nil {
		return nil, err
	}
	return slices.Clone(vector), nil
}

func (cache *Cache) fill(ctx context.Context, key [sha256.Size]byte, request Request, provider Embedder, call *pendingEmbedding) {
	defer call.cancel()
	started := cache.now()
	vector, err := load(ctx, request, provider)
	cache.mu.Lock()
	evicted := false
	call.vector, call.err = vector, err
	if cache.pending[key] == call {
		delete(cache.pending, key)
		if err == nil && ctx.Err() == nil {
			cache.entries[key] = cache.lru.PushFront(cacheEntry{
				key: key, vector: vector, expiresAt: cache.now().Add(cache.ttl), latency: cache.now().Sub(started),
			})
			if cache.lru.Len() > cache.capacity {
				cache.remove(cache.lru.Back())
				evicted = true
			}
		}
	}
	close(call.done)
	cache.mu.Unlock()
	if evicted {
		cache.record(ctx, "eviction", 0)
	}
}

// Use the process's existing structured-log sink. Counting event_type and summing
// saved_ms gives cache activity without introducing a separate metrics pipeline.
// saved_ms estimates avoided latency using the cached request's load time.
func (cache *Cache) record(ctx context.Context, outcome string, saved time.Duration) {
	if cache.logger != nil {
		event := "campus_docs.embedding.cache." + outcome
		cache.logger.InfoContext(ctx, event, "event_type", event, "count", 1, "saved_ms", float64(saved)/float64(time.Millisecond))
	}
}

func (cache *Cache) remove(element *list.Element) {
	delete(cache.entries, element.Value.(cacheEntry).key)
	cache.lru.Remove(element)
}
