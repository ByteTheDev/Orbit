package main

import (
	"context"
	"embed"
	"os"
	"slices"

	"github.com/wailsapp/wails/v3/pkg/application"

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

	backend := NewApp()
	app := application.New(application.Options{
		Name:       "Orbit",
		Assets:     application.AssetOptions{Handler: application.AssetFileServerFS(assets)},
		Services:   []application.Service{application.NewService(backend)},
		OnShutdown: func() { backend.shutdown(context.Background()) },
	})
	backend.wails = app
	backend.startup(context.Background())
	app.Window.NewWithOptions(application.WebviewWindowOptions{
		Title: "Orbit", Width: 1440, Height: 920, MinWidth: 1080, MinHeight: 680,
		BackgroundColour: application.NewRGBA(11, 12, 16, 255),
		Windows:          application.WindowsWindow{Theme: application.Dark},
	})
	if err := app.Run(); err != nil {
		println("Error:", err.Error())
	}
}
