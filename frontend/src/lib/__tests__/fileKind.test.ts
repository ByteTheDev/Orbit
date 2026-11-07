import { describe, expect, it } from 'vitest'
import { fileKindOf } from '../fileKind'

describe('fileKindOf', () => {
  it('labels the common languages', () => {
    const cases: [string, string, string][] = [
      ['src/App.tsx', 'react', 'Re'],
      ['src/index.ts', 'typescript', 'TS'],
      ['web/app.jsx', 'react', 'Re'],
      ['server.mjs', 'javascript', 'JS'],
      ['main.go', 'go', 'Go'],
      ['src/lib.rs', 'rust', 'Rs'],
      ['tool.py', 'python', 'Py'],
      ['Main.java', 'java', 'Jv'],
      ['app.kt', 'kotlin', 'Kt'],
      ['main.cpp', 'cpp', 'C++'],
      ['Program.cs', 'csharp', 'C#'],
      ['index.php', 'php', 'PHP'],
      ['run.sh', 'shell', 'Sh'],
      ['build.ps1', 'powershell', 'PS'],
      ['style.scss', 'sass', 'Sass'],
      ['data.json', 'json', '{}'],
      ['ci.yml', 'yaml', 'YML'],
      ['README.md', 'markdown', 'MD'],
      ['schema.sql', 'sql', 'SQL'],
    ]
    for (const [path, id, label] of cases) {
      const kind = fileKindOf(path)
      expect(kind.id, path).toBe(id)
      expect(kind.label, path).toBe(label)
    }
  })

  it('recognises special file names before their extensions', () => {
    expect(fileKindOf('Dockerfile').id).toBe('docker')
    expect(fileKindOf('services/api/Dockerfile.dev').id).toBe('docker')
    expect(fileKindOf('docker-compose.yml').id).toBe('docker')
    expect(fileKindOf('go.mod').id).toBe('go')
    expect(fileKindOf('go.sum').id).toBe('lock')
    expect(fileKindOf('Cargo.toml').id).toBe('rust')
    expect(fileKindOf('Cargo.lock').id).toBe('lock')
    expect(fileKindOf('pnpm-lock.yaml').id).toBe('lock')
    expect(fileKindOf('Makefile').id).toBe('make')
    expect(fileKindOf('.gitignore').id).toBe('git')
    expect(fileKindOf('.env').id).toBe('config')
    expect(fileKindOf('.env.local').id).toBe('config')
    expect(fileKindOf('tsconfig.app.json').id).toBe('typescript')
  })

  it('accepts Windows and POSIX separators and upper-case names', () => {
    expect(fileKindOf('C:\\Users\\me\\proj\\MAIN.GO').id).toBe('go')
    expect(fileKindOf('frontend/src/App.TSX').id).toBe('react')
  })

  it('attaches a real logo to every kind that has one, and none to the rest', () => {
    expect(fileKindOf('src/App.tsx').icon).toMatch(/react\.png/)
    expect(fileKindOf('src/index.ts').icon).toMatch(/typescript\.png/)
    expect(fileKindOf('main.go').icon).toMatch(/go\.png/)
    expect(fileKindOf('Dockerfile').icon).toMatch(/docker\.png/)
    // Formats with no brand logo keep the label badge.
    expect(fileKindOf('schema.sql').icon).toBeUndefined()
    expect(fileKindOf('photo.png').icon).toBeUndefined()
    expect(fileKindOf('notes.xyzzy').icon).toBeUndefined()
  })

  it('gives unknown files a neutral badge from their extension', () => {
    const k = fileKindOf('notes.xyzzy')
    expect(k.id).toBe('file')
    expect(k.label).toBe('XYZ')
    expect(fileKindOf('LICENSE').id).toBe('text')
    expect(fileKindOf('mystery').label).toBe('·')
    expect(fileKindOf('').label).toBe('·')
  })

  it('never treats object prototype keys as kinds', () => {
    for (const name of ['constructor', 'toString', 'x.constructor', 'x.hasOwnProperty']) {
      const k = fileKindOf(name)
      expect(typeof k.label, name).toBe('string')
      expect(typeof k.color, name).toBe('string')
    }
  })
})
