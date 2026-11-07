# README

## About

This is the official Wails React-TS template.

You can configure the project by editing `wails.json`. More information about the project settings can be found
here: https://wails.io/docs/reference/project-config

## Live Development

To run in live development mode, run `wails dev` in the project directory. This will run a Vite development
server that will provide very fast hot reload of your frontend changes. If you want to develop in a browser
and have access to your Go methods, there is also a dev server that runs on http://localhost:34115. Connect
to this in your browser, and you can call your Go code from devtools.

## Building

To build a redistributable, production mode package, use `wails build`.

## macOS and Linux

Build on the target OS with Go, Node.js, npm, Git, and the Wails v2 CLI installed.
Follow the [Wails platform prerequisites](https://wails.io/docs/gettingstarted/installation/),
including Xcode command line tools on macOS or the GTK and WebKit development
packages on Linux. Run `wails dev` for development or `wails build` for a
production build. Install and sign in to the agent CLIs separately, and make
sure they are on the PATH available to Orbit when launched.

The terminal uses `$SHELL`, falling back to `/bin/sh`. The embedded native
browser view currently requires Windows; macOS and Linux use the browser's
text view. macOS and Linux desktop builds and runtime behavior still need
verification on those platforms.
