package provider

import "testing"

func TestCodexParserMapsItemsAndTurns(t *testing.T) {
	lines := []string{
		`{"type":"thread.started","thread_id":"th_9"}`,
		`{"type":"turn.started"}`,
		`{"type":"item.started","item":{"id":"c1","type":"command_execution","command":"npm test"}}`,
		`{"type":"item.completed","item":{"id":"c1","type":"command_execution","command":"npm test","aggregated_output":"fail","exit_code":1,"status":"completed"}}`,
		`{"type":"item.completed","item":{"id":"f1","type":"file_change","changes":[{"path":"src/App.tsx","kind":"update"}],"status":"completed"}}`,
		`{"type":"item.completed","item":{"id":"m1","type":"agent_message","text":"Done."}}`,
		`{"type":"turn.completed","usage":{"input_tokens":120,"cached_input_tokens":40,"output_tokens":8}}`,
	}
	p := &codexParser{}
	var all []Update
	for _, l := range lines {
		all = append(all, p.parse([]byte(l))...)
	}

	var session, toolFailed, fileEnd, message, usage, done bool
	for _, u := range all {
		switch {
		case u.Kind == UpdSession && u.ID == "th_9":
			session = true
		case u.Kind == UpdToolEnd && u.ToolID == "c1" && u.Failed:
			toolFailed = true
		case u.Kind == UpdFile && u.File.Path == "src/App.tsx" && u.File.Phase == "end":
			fileEnd = true
		case u.Kind == UpdMessage && u.Text == "Done.":
			message = true
		case u.Kind == UpdUsage && u.InTokens == 120 && u.OutTokens == 8:
			usage = true
		case u.Kind == UpdTurnDone && u.Success:
			done = true
		}
	}
	if !(session && toolFailed && fileEnd && message && usage && done) {
		t.Fatalf("missing expected updates: session=%v toolFailed=%v fileEnd=%v message=%v usage=%v done=%v",
			session, toolFailed, fileEnd, message, usage, done)
	}
}

func TestCodexTurnFailureIsReported(t *testing.T) {
	p := &codexParser{}
	got := p.parse([]byte(`{"type":"turn.failed","error":{"message":"quota exceeded"}}`))
	if len(got) != 2 || got[0].Level != "error" || got[1].Success {
		t.Fatalf("unexpected: %+v", got)
	}
}
