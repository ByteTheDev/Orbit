package provider

import (
	"encoding/json"
	"strings"
	"time"
	"unicode"

	"orbit/internal/model"
)

// Request ids used when asking each CLI for its limits. Replies are matched on these,
// so unrelated output on the same stream is ignored.
const (
	claudeUsageRequestID = "orbit-usage"
	codexLimitsRequestID = 2
)

// claudeUsageRequests are the stream-json control requests sent to Claude Code. Initialize
// must come first. get_usage is an experimental control request in the CLI.
var claudeUsageRequests = []string{
	`{"type":"control_request","request_id":"orbit-init","request":{"subtype":"initialize"}}`,
	`{"type":"control_request","request_id":"` + claudeUsageRequestID + `","request":{"subtype":"get_usage"}}`,
}

// codexLimitsRequests are the app-server JSON-RPC messages that read Codex's rate limits.
var codexLimitsRequests = []string{
	`{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"clientInfo":{"name":"orbit","version":"1"}}}`,
	`{"jsonrpc":"2.0","method":"initialized"}`,
	`{"jsonrpc":"2.0","id":2,"method":"account/rateLimits/read"}`,
}

type claudeUsageReply struct {
	Type     string `json:"type"`
	Response struct {
		RequestID string `json:"request_id"`
		Subtype   string `json:"subtype"`
		Error     string `json:"error"`
		Response  struct {
			SubscriptionType string `json:"subscription_type"`
			RateLimits       *struct {
				FiveHour *claudeWindow `json:"five_hour"`
				SevenDay *claudeWindow `json:"seven_day"`
			} `json:"rate_limits"`
		} `json:"response"`
	} `json:"response"`
}

type claudeWindow struct {
	Utilization float64 `json:"utilization"`
	ResetsAt    string  `json:"resets_at"`
}

// ParseClaudeUsage reads one stream-json line. done is true when it is the reply to the usage request.
func ParseClaudeUsage(line []byte) (lim model.ProviderLimits, done bool) {
	var r claudeUsageReply
	if err := json.Unmarshal(line, &r); err != nil || r.Type != "control_response" || r.Response.RequestID != claudeUsageRequestID {
		return model.ProviderLimits{}, false
	}
	lim = model.ProviderLimits{Provider: "claude", Windows: []model.LimitWindow{}}
	if r.Response.Subtype != "success" {
		lim.Error = nonEmpty(r.Response.Error, "Claude Code did not report its limits.")
		return lim, true
	}
	reply := r.Response.Response
	lim.Plan = titleCase(reply.SubscriptionType)
	if reply.RateLimits == nil {
		lim.Error = "Claude Code did not report limits for this account."
		return lim, true
	}
	if w := reply.RateLimits.FiveHour; w != nil {
		lim.Windows = append(lim.Windows, model.LimitWindow{Label: "5-hour", UsedPercent: w.Utilization, ResetsAt: parseISOMillis(w.ResetsAt)})
	}
	if w := reply.RateLimits.SevenDay; w != nil {
		lim.Windows = append(lim.Windows, model.LimitWindow{Label: "Weekly", UsedPercent: w.Utilization, ResetsAt: parseISOMillis(w.ResetsAt)})
	}
	return lim, true
}

type codexLimitsReply struct {
	ID     *int `json:"id"`
	Result *struct {
		RateLimits *codexSnapshot `json:"rateLimits"`
	} `json:"result"`
	Error *struct {
		Message string `json:"message"`
	} `json:"error"`
}

type codexSnapshot struct {
	Primary   *codexWindow `json:"primary"`
	Secondary *codexWindow `json:"secondary"`
	PlanType  string       `json:"planType"`
}

type codexWindow struct {
	UsedPercent        float64 `json:"usedPercent"`
	WindowDurationMins int     `json:"windowDurationMins"`
	ResetsAt           int64   `json:"resetsAt"` // unix seconds
}

// ParseCodexLimits reads one app-server line. done is true when it is the reply to the limits request.
func ParseCodexLimits(line []byte) (lim model.ProviderLimits, done bool) {
	var r codexLimitsReply
	if err := json.Unmarshal(line, &r); err != nil || r.ID == nil || *r.ID != codexLimitsRequestID {
		return model.ProviderLimits{}, false
	}
	lim = model.ProviderLimits{Provider: "codex", Windows: []model.LimitWindow{}}
	if r.Error != nil {
		lim.Error = nonEmpty(r.Error.Message, "Codex did not report its limits.")
		return lim, true
	}
	if r.Result == nil || r.Result.RateLimits == nil {
		lim.Error = "Codex did not report limits for this account."
		return lim, true
	}
	snap := r.Result.RateLimits
	lim.Plan = titleCase(snap.PlanType)
	for _, w := range []*codexWindow{snap.Primary, snap.Secondary} {
		if w == nil {
			continue
		}
		lim.Windows = append(lim.Windows, model.LimitWindow{Label: codexWindowLabel(w.WindowDurationMins), UsedPercent: w.UsedPercent, ResetsAt: w.ResetsAt * 1000})
	}
	return lim, true
}

// codexWindowLabel names a window by its length: up to a day reads as the 5-hour
// session window, longer as weekly.
func codexWindowLabel(mins int) string {
	switch {
	case mins <= 0:
		return "Limit"
	case mins <= 24*60:
		return "5-hour"
	default:
		return "Weekly"
	}
}

func parseISOMillis(s string) int64 {
	t, err := time.Parse(time.RFC3339Nano, s)
	if err != nil {
		return 0
	}
	return t.UnixMilli()
}

func nonEmpty(s, fallback string) string {
	if strings.TrimSpace(s) == "" {
		return fallback
	}
	return s
}

// titleCase turns "pro" into "Pro" for display. Empty stays empty.
func titleCase(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return ""
	}
	runes := []rune(s)
	return string(append([]rune{unicode.ToUpper(runes[0])}, runes[1:]...))
}
