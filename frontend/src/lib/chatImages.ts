// Image attachments for the chat composer. Pure checks plus file reading; no React.
import type { ImageUpload } from '../types'

/** Image types the chat accepts. Must match the backend (internal/agent/attachments.go). */
export const IMAGE_TYPES: readonly string[] = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']

export const MAX_IMAGES = 4

/** 3.5 MB per image, so the base64 form stays under the Claude API's 5 MB per-image limit. */
export const MAX_IMAGE_BYTES = 3750 * 1024

/** An image picked in the composer. preview is a data URL used for the thumbnail. */
export interface PendingImage extends ImageUpload {
  id: string
  preview: string
}

/** Why a file cannot be attached, or null when it can. count is how many are already attached. */
export function imageProblem(file: { name: string; type: string; size: number }, count: number): string | null {
  if (!IMAGE_TYPES.includes(file.type)) return `${file.name} is not a PNG, JPEG, GIF or WebP image`
  if (file.size === 0) return `${file.name} is empty`
  if (file.size > MAX_IMAGE_BYTES) return `${file.name} is larger than 3.5 MB`
  if (count >= MAX_IMAGES) return `Attach at most ${MAX_IMAGES} images to a message`
  return null
}

/**
 * Checks each file in turn and reads the ones that pass. The count limit includes images already
 * attached, so a paste of six files adds only the room that is left.
 */
export async function addImages(
  files: File[],
  attached: number,
): Promise<{ added: PendingImage[]; problems: string[] }> {
  const added: PendingImage[] = []
  const problems: string[] = []
  for (const file of files) {
    const problem = imageProblem(file, attached + added.length)
    if (problem) {
      problems.push(problem)
      continue
    }
    try {
      added.push(await readImage(file))
    } catch {
      problems.push(`Could not read ${file.name}`)
    }
  }
  return { added, problems }
}

/** Strips the preview-only fields. The backend takes name, mediaType and base64 data. */
export function toUploads(images: PendingImage[]): ImageUpload[] {
  return images.map(({ name, mediaType, data }) => ({ name, mediaType, data }))
}

function readImage(file: File): Promise<PendingImage> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error('read failed'))
    reader.onload = () => {
      const url = String(reader.result)
      resolve({
        id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        name: file.name,
        mediaType: file.type,
        data: url.slice(url.indexOf(',') + 1),
        preview: url,
      })
    }
    reader.readAsDataURL(file)
  })
}
