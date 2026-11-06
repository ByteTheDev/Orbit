package provider

import "orbit/internal/model"

// The model lists below were read from the CLIs' own catalogs on 2026-11-06:
//   - Claude Code: ~/.claude/cache/model-catalog (the "cc" surface). Models in the
//     "overflow" section are listed under "Older".
//   - Codex: ~/.codex/models_cache.json. Entries with visibility "hide" are left out.
// Both CLIs change their catalogs over time. Update these lists when they do.

var claudeModels = []model.ModelOption{
	{ID: "claude-opus-5-5", Label: "Opus 5.5", Group: "Current", Description: "For complex work and everyday tasks"},
	{ID: "claude-sonnet-5-5", Label: "Sonnet 5.5", Group: "Current", Description: "Most efficient for simpler tasks"},
	{ID: "claude-fable-5-1", Label: "Fable 5.1", Group: "Current", Description: "For your toughest challenges. Uses usage credits"},
	{ID: "claude-haiku-5-5", Label: "Haiku 5.5", Group: "Current", Description: "Fastest for quick answers"},
	{ID: "claude-sonnet-5", Label: "Sonnet 5", Group: "Older", Description: "Previous Sonnet"},
	{ID: "claude-opus-5", Label: "Opus 5", Group: "Older", Description: "Previous Opus"},
	{ID: "claude-fable-5", Label: "Fable 5", Group: "Older", Description: "Previous Fable. Uses usage credits"},
	{ID: "claude-opus-4-8", Label: "Opus 4.8", Group: "Older", Description: "Opus 4.8"},
	{ID: "claude-opus-4-7", Label: "Opus 4.7", Group: "Older", Description: "Opus 4.7"},
	{ID: "claude-opus-4-6", Label: "Opus 4.6", Group: "Older", Description: "Opus 4.6"},
	{ID: "claude-sonnet-4-6", Label: "Sonnet 4.6", Group: "Older", Description: "Sonnet 4.6"},
	{ID: "claude-haiku-4-5-20251001", Label: "Haiku 4.5", Group: "Older", Description: "Haiku 4.5"},
}

var codexModels = []model.ModelOption{
	{ID: "gpt-6.1-sol", Label: "GPT-6.1-Sol", Group: "Current", Description: "Latest workhorse model for coding and everyday work"},
	{ID: "gpt-6-astra", Label: "GPT-6-Astra", Group: "Current", Description: "Frontier intelligence for the most demanding work"},
	{ID: "gpt-6.1-terra", Label: "GPT-6.1 Terra", Group: "Current", Description: "GPT-6.1 Terra Codex model"},
	{ID: "gpt-6-sol", Label: "GPT-6-Sol", Group: "Current", Description: "Previous generation workhorse model"},
	{ID: "gpt-6-luna", Label: "GPT-6-Luna", Group: "Current", Description: "Fast and affordable model for easier tasks"},
	{ID: "gpt-5.6-sol", Label: "GPT-5.6-Sol", Group: "Older", Description: "Older generation workhorse model"},
	{ID: "gpt-5.6-terra", Label: "GPT-5.6-Terra", Group: "Older", Description: "Older balanced model for straightforward work"},
	{ID: "gpt-5.6-luna", Label: "GPT-5.6-Luna", Group: "Older", Description: "Older fast and efficient model"},
}
