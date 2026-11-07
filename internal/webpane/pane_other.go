//go:build !windows

package webpane

// Supported reports whether the native page view can run on this system. It cannot here.
func Supported() bool { return false }

// Pane is the native page view. Off Windows it is never created.
type Pane struct{}

// Open always fails off Windows; the dialog then uses the text view.
func Open(onEvent func(Event)) (*Pane, error) { return nil, ErrUnsupported }

func (p *Pane) Navigate(address string)           {}
func (p *Pane) Back()                             {}
func (p *Pane) Forward()                          {}
func (p *Pane) Reload()                           {}
func (p *Pane) Stop()                             {}
func (p *Pane) SetBounds(x, y, w, h int)          {}
func (p *Pane) Show()                             {}
func (p *Pane) Hide()                             {}
func (p *Pane) Close()                            {}
