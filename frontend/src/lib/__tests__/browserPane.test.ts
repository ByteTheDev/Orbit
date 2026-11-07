import { describe, expect, it } from 'vitest'
import { emptyHistory, visit, type BrowserHistory } from '../browserNav'
import { addressParts, landed, physicalBounds } from '../browserPane'

function history(...urls: string[]): BrowserHistory {
  return urls.reduce(visit, emptyHistory)
}

describe('physicalBounds', () => {
  it('scales CSS pixels by the device pixel ratio and rounds to whole pixels', () => {
    expect(physicalBounds({ left: 10, top: 20, width: 300, height: 150 }, 1.5)).toEqual({ x: 15, y: 30, w: 450, h: 225 })
  })

  it('keeps sizes at least one pixel, so a hidden viewport never sends a zero size', () => {
    expect(physicalBounds({ left: 0, top: 0, width: 0, height: -4 }, 1)).toEqual({ x: 0, y: 0, w: 1, h: 1 })
  })

  it('treats a missing or bogus pixel ratio as 1', () => {
    expect(physicalBounds({ left: 5, top: 5, width: 20, height: 20 }, 0)).toEqual({ x: 5, y: 5, w: 20, h: 20 })
  })
})

describe('addressParts', () => {
  it('splits an HTTPS address into scheme, host and path', () => {
    expect(addressParts('https://www.roblox.com/games?x=1')).toEqual({
      secure: true,
      scheme: 'https://',
      host: 'www.roblox.com',
      rest: '/games?x=1',
    })
  })

  it('marks plain HTTP as not secure', () => {
    expect(addressParts('http://example.com').secure).toBe(false)
  })

  it('shows the whole text as the host when there is no :// scheme, such as about:blank', () => {
    expect(addressParts('about:blank')).toEqual({ secure: false, scheme: '', host: 'about:blank', rest: '' })
  })
})

describe('landed', () => {
  it('settles the entry added by a typed address, so a redirect replaces it', () => {
    const h = history('https://a.example/')
    const next = landed(h, 'https://a.example/home', 'navigate')
    expect(next.entries).toEqual(['https://a.example/home'])
    expect(next.index).toBe(0)
  })

  it('walks back to the previous entry when the page landed from a back action', () => {
    const h = history('https://a.example/', 'https://a.example/two')
    const next = landed(h, 'https://a.example/', 'back')
    expect(next.index).toBe(0)
    expect(next.entries).toHaveLength(2)
  })

  it('walks forward when the page landed from a forward action', () => {
    const h = { entries: ['https://a.example/', 'https://a.example/two'], index: 0 }
    expect(landed(h, 'https://a.example/two', 'forward').index).toBe(1)
  })

  it('opens a new entry for a link clicked inside the page', () => {
    const h = history('https://a.example/')
    const next = landed(h, 'https://a.example/clicked', 'page')
    expect(next.entries).toEqual(['https://a.example/', 'https://a.example/clicked'])
    expect(next.index).toBe(1)
  })

  it('drops forward entries when a new page opens after going back', () => {
    const h = { entries: ['https://a.example/', 'https://a.example/two'], index: 0 }
    const next = landed(h, 'https://a.example/three', 'page')
    expect(next.entries).toEqual(['https://a.example/', 'https://a.example/three'])
  })

  it('does nothing when the landed page is already on screen', () => {
    const h = history('https://a.example/')
    expect(landed(h, 'https://a.example/', 'page')).toBe(h)
  })
})
