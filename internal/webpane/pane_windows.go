//go:build windows

package webpane

import (
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"sync"
	"syscall"
	"time"
	"unsafe"

	"github.com/wailsapp/go-webview2/pkg/edge"
	"golang.org/x/sys/windows"
)

const (
	wmDestroy = 0x0002
	wmSize    = 0x0005
	wmTimer   = 0x0113
	wmApp     = 0x8000

	wsChild        = 0x40000000
	wsVisible      = 0x10000000
	wsClipChildren = 0x02000000

	swHide  = 0
	swShow  = 5
	gwOwner = 4

	timerID     = 1
	openTimeout = 15 * time.Second
)

var (
	user32                       = windows.NewLazySystemDLL("user32.dll")
	procRegisterClassExW         = user32.NewProc("RegisterClassExW")
	procCreateWindowExW          = user32.NewProc("CreateWindowExW")
	procDefWindowProcW           = user32.NewProc("DefWindowProcW")
	procDestroyWindow            = user32.NewProc("DestroyWindow")
	procGetMessageW              = user32.NewProc("GetMessageW")
	procTranslateMessage         = user32.NewProc("TranslateMessage")
	procDispatchMessageW         = user32.NewProc("DispatchMessageW")
	procPostMessageW             = user32.NewProc("PostMessageW")
	procPostQuitMessage          = user32.NewProc("PostQuitMessage")
	procMoveWindow               = user32.NewProc("MoveWindow")
	procSetWindowPos             = user32.NewProc("SetWindowPos")
	procShowWindow               = user32.NewProc("ShowWindow")
	procSetTimer                 = user32.NewProc("SetTimer")
	procKillTimer                = user32.NewProc("KillTimer")
	procEnumWindows              = user32.NewProc("EnumWindows")
	procGetWindowThreadProcessId = user32.NewProc("GetWindowThreadProcessId")
	procIsWindowVisible          = user32.NewProc("IsWindowVisible")
	procGetWindow                = user32.NewProc("GetWindow")
	procGetModuleHandleW         = windows.NewLazySystemDLL("kernel32.dll").NewProc("GetModuleHandleW")

	className   = windows.StringToUTF16Ptr("OrbitWebPane")
	classOnce   sync.Once
	classErr    error
	wndProcProc = syscall.NewCallback(wndProc)

	// Every pane window maps back to its Pane, because the window procedure is process-wide.
	panes sync.Map // hwnd uintptr -> *Pane

	findMu    sync.Mutex
	findPID   uint32
	findFound uintptr
	findCB    = syscall.NewCallback(findWindowProc)
)

// wndClassExW mirrors the Win32 WNDCLASSEXW structure.
type wndClassExW struct {
	Size       uint32
	Style      uint32
	WndProc    uintptr
	ClsExtra   int32
	WndExtra   int32
	Instance   uintptr
	Icon       uintptr
	Cursor     uintptr
	Background uintptr
	MenuName   *uint16
	ClassName  *uint16
	IconSm     uintptr
}

// Supported reports whether the native page view can run on this system.
func Supported() bool { return true }

// Pane is one WebView2 page view, owned by its own thread. Its methods are safe to call from any
// goroutine; they queue the work for that thread.
type Pane struct {
	onEvent func(Event)

	hwnd     uintptr
	chromium *edge.Chromium
	created  chan error
	failure  chan error
	ready    chan struct{}
	readyOne sync.Once

	mu    sync.Mutex
	queue []func()

	// Only touched on the pane thread.
	live    bool
	url     string
	title   string
	loading bool
}

// Open creates the page view as a child of the app window. It returns once WebView2 is ready to
// navigate, or with an error if the runtime is missing or too slow to start.
func Open(onEvent func(Event)) (*Pane, error) {
	parent, err := findAppWindow()
	if err != nil {
		return nil, err
	}
	p := &Pane{
		onEvent: onEvent,
		created: make(chan error, 1),
		failure: make(chan error, 1),
		ready:   make(chan struct{}),
	}
	go p.run(parent)
	if err := <-p.created; err != nil {
		return nil, err
	}
	select {
	case <-p.ready:
		return p, nil
	case err := <-p.failure:
		return nil, errors.New("the page view could not start: " + err.Error())
	case <-time.After(openTimeout):
		return nil, errors.New("the page view did not start in time; check that the WebView2 runtime is installed")
	}
}

// run owns the window and its message loop. Everything WebView2 does happens on this thread.
func (p *Pane) run(parent uintptr) {
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	_ = windows.CoInitializeEx(0, windows.COINIT_APARTMENTTHREADED)

	if err := registerClass(); err != nil {
		p.created <- err
		return
	}
	inst := moduleHandle()
	r, _, callErr := procCreateWindowExW.Call(
		0,
		uintptr(unsafe.Pointer(className)),
		uintptr(unsafe.Pointer(windows.StringToUTF16Ptr("Orbit page view"))),
		wsChild|wsVisible|wsClipChildren,
		0, 0, 1, 1,
		parent, 0, inst, 0,
	)
	if r == 0 {
		p.created <- errors.New("could not create the page view window: " + callErr.Error())
		return
	}
	p.hwnd = r
	panes.Store(p.hwnd, p)

	dataDir, err := userDataDir()
	if err != nil {
		p.created <- err
		return
	}
	c := edge.NewChromium()
	c.DataPath = dataDir
	c.NavigationCompletedCallback = p.navigationCompleted
	c.MessageCallback = p.message
	c.SetErrorCallback(p.fail)
	p.chromium = c
	if !c.Embed(p.hwnd) {
		p.created <- errors.New("WebView2 could not be embedded; check that the WebView2 runtime is installed")
		return
	}
	p.created <- nil

	procSetTimer.Call(p.hwnd, timerID, 30, 0)
	var m msg
	for {
		ret, _, _ := procGetMessageW.Call(uintptr(unsafe.Pointer(&m)), 0, 0, 0)
		if int32(ret) <= 0 {
			break
		}
		procTranslateMessage.Call(uintptr(unsafe.Pointer(&m)))
		procDispatchMessageW.Call(uintptr(unsafe.Pointer(&m)))
	}
	panes.Delete(p.hwnd)
}

// msg mirrors the Win32 MSG structure.
type msg struct {
	Hwnd    uintptr
	Message uint32
	WParam  uintptr
	LParam  uintptr
	Time    uint32
	Pt      struct{ X, Y int32 }
}

func registerClass() error {
	classOnce.Do(func() {
		inst := moduleHandle()
		wc := wndClassExW{
			Size:      uint32(unsafe.Sizeof(wndClassExW{})),
			WndProc:   wndProcProc,
			Instance:  inst,
			ClassName: className,
		}
		// An already-registered class is fine; CreateWindowEx reports any real problem.
		procRegisterClassExW.Call(uintptr(unsafe.Pointer(&wc)))
	})
	return classErr
}

// wndProc handles the pane window's messages. It runs on the pane thread.
func wndProc(hwnd, m, wp, lp uintptr) uintptr {
	v, ok := panes.Load(hwnd)
	if !ok {
		r, _, _ := procDefWindowProcW.Call(hwnd, m, wp, lp)
		return r
	}
	p := v.(*Pane)
	switch m {
	case wmApp, wmTimer:
		p.drain()
		return 0
	case wmSize:
		if p.live {
			p.chromium.Resize()
		}
		return 0
	case wmDestroy:
		procPostQuitMessage.Call(0)
		return 0
	}
	r, _, _ := procDefWindowProcW.Call(hwnd, m, wp, lp)
	return r
}

// drain runs queued commands once WebView2 has its controller. Before that, commands wait.
func (p *Pane) drain() {
	if !p.live {
		if p.chromium.GetController() == nil {
			return
		}
		p.live = true
		p.chromium.Init(initScript)
		p.chromium.Resize()
		procKillTimer.Call(p.hwnd, timerID)
		p.readyOne.Do(func() { close(p.ready) })
	}
	p.mu.Lock()
	q := p.queue
	p.queue = nil
	p.mu.Unlock()
	for _, f := range q {
		f()
	}
}

func (p *Pane) post(f func()) {
	p.mu.Lock()
	p.queue = append(p.queue, f)
	p.mu.Unlock()
	procPostMessageW.Call(p.hwnd, wmApp, 0, 0)
}

func (p *Pane) emit() {
	if p.onEvent != nil {
		p.onEvent(Event{URL: p.url, Title: p.title, Loading: p.loading})
	}
}

func (p *Pane) fail(err error) {
	select {
	case p.failure <- err:
	default:
	}
}

func (p *Pane) navigationCompleted(sender *edge.ICoreWebView2, _ *edge.ICoreWebView2NavigationCompletedEventArgs) {
	if src, err := sender.GetSource(); err == nil && src != "" {
		p.url = src
	}
	p.loading = false
	p.emit()
}

func (p *Pane) message(raw string, _ *edge.ICoreWebView2, _ *edge.ICoreWebView2WebMessageReceivedEventArgs) {
	m, ok := parseMessage(raw)
	if !ok {
		return
	}
	switch m.T {
	case "title":
		if m.URL != "" {
			p.url = m.URL
		}
		p.title = m.Title
	case "loading":
		p.loading = true
		if m.URL != "" {
			p.url = m.URL
		}
	}
	p.emit()
}

// Navigate loads an address. It must already be a full URL; the caller validates it.
func (p *Pane) Navigate(address string) {
	p.post(func() {
		p.url = address
		p.title = ""
		p.loading = true
		p.emit()
		p.chromium.Navigate(address)
	})
}

// Back goes to the previous page in the view's history.
func (p *Pane) Back() {
	p.post(func() { p.chromium.Eval("history.back()") })
}

// Forward goes to the next page in the view's history.
func (p *Pane) Forward() {
	p.post(func() { p.chromium.Eval("history.forward()") })
}

// Reload loads the current page again.
func (p *Pane) Reload() {
	p.post(func() {
		p.loading = true
		p.emit()
		p.chromium.Eval("location.reload()")
	})
}

// Stop cancels whatever the page is still loading.
func (p *Pane) Stop() {
	p.post(func() {
		p.chromium.Eval("window.stop()")
		p.loading = false
		p.emit()
	})
}

// SetBounds places the view in physical pixels, relative to the app window's client area.
func (p *Pane) SetBounds(x, y, w, h int) {
	p.post(func() {
		procMoveWindow.Call(p.hwnd, uintptr(int32(x)), uintptr(int32(y)), uintptr(int32(w)), uintptr(int32(h)), 1)
		if p.live {
			p.chromium.Resize()
		}
	})
}

// Show makes the view visible.
func (p *Pane) Show() {
	p.post(func() {
		// The application's WebView is another child of the same window. Make
		// the page pane the top sibling each time it is shown, including after
		// the dialog has been closed and reopened.
		const swpNoSize = 0x0001
		const swpNoMove = 0x0002
		const swpNoActivate = 0x0010
		procSetWindowPos.Call(p.hwnd, 0, 0, 0, 0, 0, swpNoSize|swpNoMove|swpNoActivate)
		procShowWindow.Call(p.hwnd, swShow)
	})
}

// Hide hides the view and keeps the page, so it can be shown again without reloading.
func (p *Pane) Hide() {
	p.post(func() { procShowWindow.Call(p.hwnd, swHide) })
}

// Close destroys the view and its WebView2 profile session.
func (p *Pane) Close() {
	p.post(func() {
		p.chromium.ShuttingDown()
		procDestroyWindow.Call(p.hwnd)
	})
}

// userDataDir is a profile of its own, separate from the app's own web view, so the two do not
// need matching WebView2 environment options.
func userDataDir() (string, error) {
	base, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	dir := filepath.Join(base, "Orbit", "page-view")
	return dir, os.MkdirAll(dir, 0o755)
}

// findAppWindow returns the app's visible top-level window, the parent for the page view.
func findAppWindow() (uintptr, error) {
	findMu.Lock()
	defer findMu.Unlock()
	findPID = windows.GetCurrentProcessId()
	findFound = 0
	procEnumWindows.Call(findCB, 0)
	if findFound == 0 {
		return 0, errors.New("the app window was not found")
	}
	return findFound, nil
}

func findWindowProc(hwnd, _ uintptr) uintptr {
	var pid uint32
	procGetWindowThreadProcessId.Call(hwnd, uintptr(unsafe.Pointer(&pid)))
	if pid != findPID {
		return 1
	}
	if visible, _, _ := procIsWindowVisible.Call(hwnd); visible == 0 {
		return 1
	}
	if owner, _, _ := procGetWindow.Call(hwnd, gwOwner); owner != 0 {
		return 1
	}
	findFound = hwnd
	return 0
}

// moduleHandle is the handle of the running executable, which the window class needs.
func moduleHandle() uintptr {
	h, _, _ := procGetModuleHandleW.Call(0)
	return h
}
