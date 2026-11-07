package main

import (
	"embed"
	"os"
	"slices"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/windows"

	"orbit/internal/browser"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	// Agents start this same executable with the browser flag to get the browser tool. That run
	// serves MCP on stdin and stdout and never opens the window.
	if slices.Contains(os.Args[1:], browser.MCPFlag) {
		if err := browser.ServeMCP(os.Stdin, os.Stdout); err != nil {
			os.Exit(1)
		}
		return
	}

	app := NewApp()

	err := wails.Run(&options.App{
		Title:            "Orbit",
		Width:            1440,
		Height:           920,
		MinWidth:         1080,
		MinHeight:        680,
		BackgroundColour: &options.RGBA{R: 11, G: 12, B: 16, A: 255},
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		OnStartup:  app.startup,
		OnShutdown: app.shutdown,
		Bind: []interface{}{
			app,
		},
		Windows: &windows.Options{
			Theme: windows.Dark,
		},
	})
	if err != nil {
		println("Error:", err.Error())
	}
}
