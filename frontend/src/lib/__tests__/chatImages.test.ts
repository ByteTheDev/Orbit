import { describe, expect, it } from 'vitest'
import { MAX_IMAGE_BYTES, imageProblem, toUploads } from '../chatImages'

describe('imageProblem', () => {
  it('accepts a PNG under the size limit', () => {
    expect(imageProblem({ name: 'a.png', type: 'image/png', size: 1000 }, 0)).toBeNull()
  })

  it('rejects types the backend does not take', () => {
    expect(imageProblem({ name: 'a.svg', type: 'image/svg+xml', size: 10 }, 0)).toMatch(/not a PNG, JPEG, GIF or WebP/)
  })

  it('rejects empty files', () => {
    expect(imageProblem({ name: 'empty.png', type: 'image/png', size: 0 }, 0)).toMatch(/is empty/)
  })

  it('accepts a file exactly at the size limit and rejects one byte more', () => {
    expect(imageProblem({ name: 'edge.png', type: 'image/png', size: MAX_IMAGE_BYTES }, 0)).toBeNull()
    expect(imageProblem({ name: 'big.png', type: 'image/png', size: MAX_IMAGE_BYTES + 1 }, 0)).toMatch(/larger than 3.5 MB/)
  })

  it('stops at the per-message image limit', () => {
    expect(imageProblem({ name: 'a.webp', type: 'image/webp', size: 10 }, 3)).toBeNull()
    expect(imageProblem({ name: 'a.webp', type: 'image/webp', size: 10 }, 4)).toMatch(/at most 4 images/)
  })
})

describe('toUploads', () => {
  it('sends only the fields the backend reads', () => {
    const uploads = toUploads([{ id: '1', name: 'a.png', mediaType: 'image/png', data: 'AAAA', preview: 'data:image/png;base64,AAAA' }])
    expect(uploads).toEqual([{ name: 'a.png', mediaType: 'image/png', data: 'AAAA' }])
  })
})
