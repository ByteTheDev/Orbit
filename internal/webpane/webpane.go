// Package webpane shows real web pages (HTML, CSS and JavaScript) inside the app window.
//
// On Windows it hosts a WebView2 control, the same Chromium engine Edge uses, in a child window
// placed over the browser dialog's viewport. The React side keeps the toolbar and sends the
// viewport rectangle; this package owns the native window. Elsewhere Supported reports false
// and the dialog falls back to the text view in internal/browser.
package webpane

import (
	"encoding/json"
	"errors"
)

// ErrUnsupported is returned where the native page view is not available.
var ErrUnsupported = errors.New("the built-in page view needs Windows and the WebView2 runtime")

// Event describes the page now on screen. Every event carries the full state, so the UI can
// replace what it shows without merging.
type Event struct {
	URL     string `json:"url"`
	Title   string `json:"title"`
	Loading bool   `json:"loading"`
	Error   string `json:"error,omitempty"`
}

// initScript runs in every page before its scripts. It reports the title, and that a navigation
// is leaving, to the backend. Frames other than the top one stay silent.
const initScript = `(function () {
  if (window !== window.top) return;
  var post = function (o) {
    try { window.chrome.webview.postMessage(JSON.stringify(o)); } catch (e) {}
  };
  var lastTitle = null;
  var report = function () {
    var t = document.title || '';
    if (t !== lastTitle) { lastTitle = t; post({ t: 'title', title: t, url: location.href }); }
  };
  document.addEventListener('DOMContentLoaded', report);
  window.addEventListener('load', report);
  window.addEventListener('pageshow', report);
  window.addEventListener('beforeunload', function () { post({ t: 'loading', url: location.href }); });
  setInterval(report, 1000);
})();`

// messageFromPage is what initScript posts.
type messageFromPage struct {
	T     string `json:"t"`
	Title string `json:"title"`
	URL   string `json:"url"`
}

// parseMessage decodes a page message. Anything else is ignored.
func parseMessage(raw string) (messageFromPage, bool) {
	var m messageFromPage
	if err := json.Unmarshal([]byte(raw), &m); err != nil {
		return m, false
	}
	return m, m.T == "title" || m.T == "loading"
}
