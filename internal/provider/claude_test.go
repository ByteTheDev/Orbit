package provider

import "testing"

// Lines are shaped like real `claude -p --output-format stream-json --verbose --include-partial-messages` output.
var claudeFixture = []string{
	`{"type":"system","subtype":"init","session_id":"s1","model":"claude-haiku-5-5","tools":["Edit"]}`,
	`{"type":"stream_event","event":{"type":"content_block_start","index":1,"content_block":{"type":"text","text":""}},"api_message_id":"msg_1"}`,
	`{"type":"stream_event","event":{"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"OK"}},"api_message_id":"msg_1"}`,
	`{"type":"stream_event","event":{"type":"content_block_stop","index":1},"api_message_id":"msg_1"}`,
	`{"type":"assistant","message":{"id":"msg_1","role":"assistant","content":[{"type":"text","text":"OK"}]}}`,
	`{"type":"assistant","message":{"id":"msg_2","role":"assistant","content":[{"type":"tool_use","id":"tu_1","name":"Edit","input":{"file_path":"C:\\repo\\src\\App.tsx","old_string":"a","new_string":"b"}}]}}`,
	`{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"tu_1","content":"updated","is_error":false}]}}`,
	`{"type":"result","subtype":"success","is_error":false,"result":"OK","total_cost_usd":0.0042,"usage":{"input_tokens":3,"output_tokens":9,"cache_read_input_tokens":100}}`,
}

func TestClaudeParserStreamsAndMapsFileEdits(t *testing.T) {
	p := newClaudeParser()
	var all []Update
	for _, line := range claudeFixture {
		all = append(all, p.parse([]byte(line))...)
	}

	kinds := make([]UpdateKind, 0, len(all))
	for _, u := range all {
		kinds = append(kinds, u.Kind)
	}
	want := []UpdateKind{
		UpdSession, UpdActivity,
		UpdStatus, UpdMessageStart, UpdMessageDelta, UpdMessageEnd,
		// The assistant text block was already streamed, so it is not repeated.
		UpdStatus, UpdToolStart, UpdFile,
		UpdToolEnd, UpdFile,
		UpdUsage, UpdCost, UpdTurnDone,
	}
	if len(kinds) != len(want) {
		t.Fatalf("got %d updates %v, want %d", len(kinds), kinds, len(want))
	}
	for i := range want {
		if kinds[i] != want[i] {
			t.Fatalf("update %d: got kind %d want %d", i, kinds[i], want[i])
		}
	}

	var edit *FileTouch
	for _, u := range all {
		if u.Kind == UpdFile && u.File.Phase == "start" {
			edit = u.File
		}
	}
	if edit == nil || edit.Op != "write" || edit.Path != `C:\repo\src\App.tsx` || edit.Diff == "" {
		t.Fatalf("unexpected file touch: %+v", edit)
	}
	last := all[len(all)-1]
	if !last.Success || last.Kind != UpdTurnDone {
		t.Fatalf("turn should finish successfully: %+v", last)
	}
}

func TestClaudeParserIgnoresUnknownAndBrokenLines(t *testing.T) {
	p := newClaudeParser()
	for _, line := range []string{`not json`, `{"type":"system","subtype":"hook_started"}`, `{"type":"rate_limit_event"}`} {
		if got := p.parse([]byte(line)); len(got) != 0 {
			t.Fatalf("line %q produced updates: %+v", line, got)
		}
	}
}

func TestClaudeParserReportsDeniedPermission(t *testing.T) {
	p := newClaudeParser()
	got := p.parse([]byte(`{"type":"result","subtype":"success","is_error":false,"result":"","permission_denials":[{"tool_name":"Bash","tool_input":{"command":"npm test"}}]}`))
	var waiting, warned bool
	for _, u := range got {
		if u.Kind == UpdStatus && u.Status == "waiting" {
			waiting = true
		}
		if u.Kind == UpdIssue && u.Level == "warning" {
			warned = true
		}
	}
	if !waiting || !warned {
		t.Fatalf("denied permission should set waiting and warn: %+v", got)
	}
}
