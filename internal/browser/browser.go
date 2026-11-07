// Package browser fetches web pages for Orbit's built-in browser and for the agents that use it.
// It does not render pages or run scripts: it downloads a page, reads its text and links, and
// returns them. Pages that need JavaScript show only what the server sends.
package browser

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/url"
	"strings"
	"time"
	"unicode/utf8"

	"golang.org/x/net/html"
	"golang.org/x/net/html/charset"
)

const (
	// DefaultTimeout bounds one whole fetch, redirects included.
	DefaultTimeout = 20 * time.Second
	// maxBodyBytes is how much of a response is read. Anything after it is cut off.
	maxBodyBytes = 2 << 20
	// maxTextRunes caps the readable text returned for one page.
	maxTextRunes = 60000
	// maxLinks caps the links returned for one page.
	maxLinks  = 150
	maxRedirs = 10
	userAgent = "Mozilla/5.0 (compatible; Orbit/1.0; +https://github.com/orbit)"
)

// Link is one anchor on a page, with its address resolved against the page URL.
type Link struct {
	Text string `json:"text"`
	URL  string `json:"url"`
}

// Page is what a fetch returns. Text and Links are cut to fixed sizes; Truncated says so.
type Page struct {
	URL         string `json:"url"`         // final address after redirects
	Status      int    `json:"status"`      // HTTP status code
	ContentType string `json:"contentType"` // media type, without parameters
	Title       string `json:"title"`
	Text        string `json:"text"`
	Links       []Link `json:"links"` // never nil: [] when the page has none
	Truncated   bool   `json:"truncated"`
}

var client = &http.Client{
	Timeout: DefaultTimeout,
	CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if len(via) >= maxRedirs {
			return errors.New("too many redirects")
		}
		_, err := checkScheme(req.URL)
		return err
	},
}

// ParseURL turns what the user typed into an http or https URL. A bare host such as
// "example.com" gets https:// in front of it.
func ParseURL(raw string) (*url.URL, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, errors.New("enter a web address")
	}
	if !strings.Contains(raw, "://") {
		raw = "https://" + raw
	}
	u, err := url.Parse(raw)
	if err != nil {
		return nil, fmt.Errorf("that is not a valid address: %v", err)
	}
	return checkScheme(u)
}

func checkScheme(u *url.URL) (*url.URL, error) {
	if u.Scheme != "http" && u.Scheme != "https" {
		return nil, fmt.Errorf("only web addresses (http or https) can be opened, not %q", u.Scheme)
	}
	if u.Host == "" {
		return nil, errors.New("that web address has no host name")
	}
	return u, nil
}

// Fetch downloads a page and reads it. A non-success HTTP status is not an error: the page is
// returned with its status so the caller can show it. Binary content returns an error.
func Fetch(ctx context.Context, address string) (Page, error) {
	u, err := ParseURL(address)
	if err != nil {
		return Page{}, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return Page{}, err
	}
	req.Header.Set("User-Agent", userAgent)
	req.Header.Set("Accept", "text/html,application/xhtml+xml,text/plain,application/json;q=0.9,*/*;q=0.5")
	resp, err := client.Do(req)
	if err != nil {
		return Page{}, fmt.Errorf("could not load %s: %v", u.Host, err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, maxBodyBytes+1))
	if err != nil {
		return Page{}, fmt.Errorf("the page stopped loading: %v", err)
	}
	truncated := len(body) > maxBodyBytes
	if truncated {
		body = body[:maxBodyBytes]
	}

	mt := mediaType(resp.Header.Get("Content-Type"), body)
	page := Page{URL: resp.Request.URL.String(), Status: resp.StatusCode, ContentType: mt, Links: []Link{}, Truncated: truncated}
	raw := resp.Header.Get("Content-Type")

	switch {
	case mt == "text/html" || mt == "application/xhtml+xml":
		r, err := charset.NewReader(bytes.NewReader(body), raw)
		if err != nil {
			r = bytes.NewReader(body)
		}
		doc, err := html.Parse(r)
		if err != nil {
			return Page{}, fmt.Errorf("could not read the page: %v", err)
		}
		extract(doc, resp.Request.URL, &page)
	case strings.HasPrefix(mt, "text/") || mt == "application/json":
		page.Text = strings.ToValidUTF8(string(body), "�")
	default:
		return Page{}, fmt.Errorf("this address is %s, which the browser cannot show as text", mt)
	}

	if page.Text, truncated = cutRunes(page.Text, maxTextRunes); truncated {
		page.Truncated = true
	}
	return page, nil
}

// mediaType returns the lower-case media type from the header, or sniffs the body when the
// header is missing or unusable.
func mediaType(header string, body []byte) string {
	if header != "" {
		if mt, _, err := mime.ParseMediaType(header); err == nil {
			return strings.ToLower(mt)
		}
	}
	return strings.ToLower(strings.Split(http.DetectContentType(body), ";")[0])
}

// skipped elements contribute no readable text.
var skipped = map[string]bool{
	"script": true, "style": true, "noscript": true, "template": true,
	"svg": true, "iframe": true, "object": true, "canvas": true,
}

// blocks start a new line in the readable text.
var blocks = map[string]bool{
	"p": true, "div": true, "br": true, "li": true, "ul": true, "ol": true, "tr": true,
	"h1": true, "h2": true, "h3": true, "h4": true, "h5": true, "h6": true,
	"section": true, "article": true, "header": true, "footer": true, "nav": true, "main": true,
	"blockquote": true, "pre": true, "table": true, "dt": true, "dd": true, "hr": true, "form": true,
}

// extract fills Title, Text and Links from a parsed HTML document.
func extract(doc *html.Node, base *url.URL, page *Page) {
	var text textBuilder
	seen := map[string]bool{}

	var walk func(n *html.Node)
	walk = func(n *html.Node) {
		if n.Type == html.ElementNode {
			name := strings.ToLower(n.Data)
			switch {
			case name == "title":
				if page.Title == "" {
					page.Title = collapse(textOf(n))
				}
				return
			case skipped[name]:
				return
			case name == "a":
				addLink(n, base, page, seen)
			}
			if blocks[name] {
				text.newline()
			}
			for c := n.FirstChild; c != nil; c = c.NextSibling {
				walk(c)
			}
			if blocks[name] {
				text.newline()
			}
			return
		}
		if n.Type == html.TextNode {
			text.words(n.Data)
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			walk(c)
		}
	}
	walk(doc)
	page.Text = text.String()
}

func addLink(n *html.Node, base *url.URL, page *Page, seen map[string]bool) {
	if len(page.Links) >= maxLinks {
		return
	}
	href := strings.TrimSpace(attr(n, "href"))
	if href == "" || strings.HasPrefix(href, "#") {
		return
	}
	ref, err := url.Parse(href)
	if err != nil {
		return
	}
	abs := base.ResolveReference(ref)
	if abs.Scheme != "http" && abs.Scheme != "https" {
		return
	}
	s := abs.String()
	if seen[s] {
		return
	}
	seen[s] = true
	label := collapse(textOf(n))
	if label == "" {
		label = s
	}
	page.Links = append(page.Links, Link{Text: label, URL: s})
}

func attr(n *html.Node, key string) string {
	for _, a := range n.Attr {
		if strings.EqualFold(a.Key, key) {
			return a.Val
		}
	}
	return ""
}

// textOf returns the text inside a node, skipping script and style.
func textOf(n *html.Node) string {
	var b strings.Builder
	var walk func(*html.Node)
	walk = func(c *html.Node) {
		if c.Type == html.ElementNode && skipped[strings.ToLower(c.Data)] {
			return
		}
		if c.Type == html.TextNode {
			b.WriteString(c.Data)
			b.WriteByte(' ')
		}
		for k := c.FirstChild; k != nil; k = k.NextSibling {
			walk(k)
		}
	}
	walk(n)
	return b.String()
}

func collapse(s string) string {
	return strings.Join(strings.Fields(s), " ")
}

// textBuilder joins words with single spaces and breaks lines where the markup asks.
type textBuilder struct {
	b    strings.Builder
	last byte // last byte written, so a line break is not doubled
}

func (t *textBuilder) words(s string) {
	for _, w := range strings.Fields(s) {
		if t.last != 0 && t.last != '\n' {
			t.write(" ")
		}
		t.write(w)
	}
}

func (t *textBuilder) newline() {
	if t.last != 0 && t.last != '\n' {
		t.write("\n")
	}
}

func (t *textBuilder) write(s string) {
	t.b.WriteString(s)
	t.last = s[len(s)-1]
}

// String returns the text with trailing spaces removed from each line and runs of blank lines
// reduced to one.
func (t *textBuilder) String() string {
	lines := strings.Split(t.b.String(), "\n")
	out := make([]string, 0, len(lines))
	blank := false
	for _, l := range lines {
		l = strings.TrimSpace(l)
		if l == "" {
			if blank || len(out) == 0 {
				continue
			}
			blank = true
		} else {
			blank = false
		}
		out = append(out, l)
	}
	return strings.TrimSpace(strings.Join(out, "\n"))
}

// cutRunes shortens s to at most max runes. It reports whether anything was cut.
func cutRunes(s string, max int) (string, bool) {
	if utf8.RuneCountInString(s) <= max {
		return s, false
	}
	i := 0
	for n := 0; n < max; n++ {
		_, size := utf8.DecodeRuneInString(s[i:])
		i += size
	}
	return s[:i], true
}
