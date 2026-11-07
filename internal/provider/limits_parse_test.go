package provider

import "testing"

// Replies below were captured from the installed CLIs (claude 2.1.319, codex 0.167.0).
const claudeUsageLine = `{"type":"control_response","response":{"subtype":"success","request_id":"orbit-usage","response":{"subscription_type":"pro","rate_limits_available":true,"rate_limits":{"five_hour":{"utilization":51,"resets_at":"2026-11-07T01:09:59.912903+00:00"},"seven_day":{"utilization":25,"resets_at":"2026-11-11T00:59:59.912927+00:00"}}}}}`

const codexLimitsLine = `{"id":2,"result":{"ordinaryUsageAllowed":true,"rateLimits":{"limitId":"codex","primary":{"usedPercent":3,"windowDurationMins":300,"resetsAt":1794021122},"secondary":{"usedPercent":27,"windowDurationMins":10080,"resetsAt":1794411874},"planType":"plus"}}}`

func TestParseClaudeUsageReadsBothWindows(t *testing.T) {
	lim, done := ParseClaudeUsage([]byte(claudeUsageLine))
	if !done {
		t.Fatal("the usage reply should be recognised")
	}
	if lim.Plan != "Pro" || lim.Error != "" {
		t.Fatalf("plan/error = %q/%q", lim.Plan, lim.Error)
	}
	if len(lim.Windows) != 2 {
		t.Fatalf("want 2 windows, got %+v", lim.Windows)
	}
	if w := lim.Windows[0]; w.Label != "5-hour" || w.UsedPercent != 51 || w.ResetsAt != 1794013799912 {
		t.Errorf("5-hour window = %+v", w)
	}
	if w := lim.Windows[1]; w.Label != "Weekly" || w.UsedPercent != 25 {
		t.Errorf("weekly window = %+v", w)
	}
}

func TestParseClaudeUsageIgnoresOtherLines(t *testing.T) {
	for _, line := range []string{
		`{"type":"system","subtype":"init"}`,
		`{"type":"control_response","response":{"subtype":"success","request_id":"orbit-init","response":{}}}`,
		`not json`,
	} {
		if _, done := ParseClaudeUsage([]byte(line)); done {
			t.Errorf("should ignore %s", line)
		}
	}
}

func TestParseClaudeUsageReportsAnErrorReply(t *testing.T) {
	lim, done := ParseClaudeUsage([]byte(`{"type":"control_response","response":{"subtype":"error","request_id":"orbit-usage","error":"not signed in"}}`))
	if !done || lim.Error != "not signed in" || len(lim.Windows) != 0 || lim.Windows == nil {
		t.Fatalf("got %+v done=%v", lim, done)
	}
}

func TestParseCodexLimitsNamesWindowsByLength(t *testing.T) {
	lim, done := ParseCodexLimits([]byte(codexLimitsLine))
	if !done {
		t.Fatal("the limits reply should be recognised")
	}
	if lim.Plan != "Plus" || len(lim.Windows) != 2 {
		t.Fatalf("got %+v", lim)
	}
	if w := lim.Windows[0]; w.Label != "5-hour" || w.UsedPercent != 3 || w.ResetsAt != 1794021122000 {
		t.Errorf("primary = %+v", w)
	}
	if w := lim.Windows[1]; w.Label != "Weekly" || w.UsedPercent != 27 {
		t.Errorf("secondary = %+v", w)
	}
}

func TestParseCodexLimitsIgnoresTheInitializeReply(t *testing.T) {
	if _, done := ParseCodexLimits([]byte(`{"id":1,"result":{"codexHome":"x"}}`)); done {
		t.Fatal("the initialize reply is not the limits reply")
	}
	if _, done := ParseCodexLimits([]byte(`{"method":"account/updated","params":{}}`)); done {
		t.Fatal("notifications are not replies")
	}
}

func TestParseCodexLimitsReportsAnError(t *testing.T) {
	lim, done := ParseCodexLimits([]byte(`{"id":2,"error":{"code":-32000,"message":"sign in first"}}`))
	if !done || lim.Error != "sign in first" || lim.Windows == nil {
		t.Fatalf("got %+v done=%v", lim, done)
	}
}
