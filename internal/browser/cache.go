package browser

import (
	"context"
	"sync"
	"time"
)

// An agent that pages through a long page calls the tool many times. The cache keeps recent
// fetches so each call does not download the page again. It is small and short-lived on purpose:
// a stale page is worse than a slow one.
const (
	cacheTTL     = 5 * time.Minute
	cacheMaxSize = 16
)

type cacheEntry struct {
	doc  Document
	when time.Time
}

var (
	cacheMu sync.Mutex
	cache   = map[string]cacheEntry{}
)

// cachedDocument returns a fresh cached copy of the page when there is one, and otherwise fetches it.
// Failures are never cached, so a retry goes to the network.
func cachedDocument(ctx context.Context, address string) (Document, error) {
	u, err := ParseURL(address)
	if err != nil {
		return Document{}, err
	}
	key := u.String()

	cacheMu.Lock()
	if e, ok := cache[key]; ok && time.Since(e.when) < cacheTTL {
		cacheMu.Unlock()
		return e.doc, nil
	}
	cacheMu.Unlock()

	doc, err := FetchDocument(ctx, key)
	if err != nil {
		return Document{}, err
	}

	cacheMu.Lock()
	defer cacheMu.Unlock()
	if len(cache) >= cacheMaxSize {
		evictOldest()
	}
	cache[key] = cacheEntry{doc: doc, when: time.Now()}
	return doc, nil
}

// evictOldest drops expired entries first, then the oldest one if the cache is still full.
// The caller must hold cacheMu.
func evictOldest() {
	var oldest string
	var oldestWhen time.Time
	for k, e := range cache {
		if time.Since(e.when) >= cacheTTL {
			delete(cache, k)
			continue
		}
		if oldest == "" || e.when.Before(oldestWhen) {
			oldest, oldestWhen = k, e.when
		}
	}
	if len(cache) >= cacheMaxSize && oldest != "" {
		delete(cache, oldest)
	}
}
