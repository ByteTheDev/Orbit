// User actions. Each one calls the backend, reports failures as toasts, and keeps
// components free of error plumbing.
import type { BrowserPage, ImageUpload, LaunchRequest } from '../types'
import { api, errorText } from './bridge'
import type { PhysicalBounds } from './browserPane'
import { closeDialog, focusAgent, getState, selectAgent, setDetail, setDetailError, setState, toast } from './store'

/**
 * Loads the full history of an agent. Safe to call again: it skips agents already loaded,
 * and retries after a failure. A failure is kept in the store so the inspector can offer a retry.
 */
/**
 * Reads each provider's usage allowance into the store. The backend caches the reading for a few
 * minutes, so polling is cheap; force asks the CLIs again now. Failures leave the last reading in place.
 */
export async function refreshLimits(force = false): Promise<void> {
  try {
    setState({ limits: await api.getLimits(force) })
  } catch (err) {
    toast(errorText(err), 'error')
  }
}

export async function loadDetail(agentId: string): Promise<void> {
  if (getState().details[agentId]?.loaded) return
  try {
    const d = await api.getAgentDetail(agentId)
    setDetail(agentId, d)
  } catch (err) {
    const message = errorText(err)
    setDetailError(agentId, message)
    toast(`Could not load this agent’s history: ${message}`, 'error')
  }
}

/** Stages (stage = true) or unstages paths in a project's repository. */
export async function stagePaths(projectId: string, paths: string[], stage: boolean): Promise<boolean> {
  try {
    if (stage) await api.stageFiles(projectId, paths)
    else await api.unstageFiles(projectId, paths)
    return true
  } catch (err) {
    toast(errorText(err), 'error')
    return false
  }
}

/** Commits paths, or the whole index when paths is empty. Returns the short hash, or null on failure. */
export async function commitChanges(projectId: string, message: string, paths: string[]): Promise<string | null> {
  try {
    const hash = await api.commitChanges(projectId, message, paths)
    toast(`Committed ${hash}`, 'success')
    return hash
  } catch (err) {
    toast(errorText(err), 'error')
    return null
  }
}

export async function setAutoCommit(projectId: string, on: boolean): Promise<boolean> {
  try {
    await api.setProjectAutoCommit(projectId, on)
    return true
  } catch (err) {
    toast(errorText(err), 'error')
    return false
  }
}

export async function sendMessage(agentId: string, text: string, images: ImageUpload[] = []): Promise<boolean> {
  try {
    await api.sendMessage(agentId, text, images)
    return true
  } catch (err) {
    toast(errorText(err), 'error')
    return false
  }
}

/** Loads a chat image as a data URL. Returns null after a toast when it cannot be loaded. */
export async function attachmentImage(agentId: string, attachmentId: string): Promise<string | null> {
  try {
    return await api.attachmentImage(agentId, attachmentId)
  } catch (err) {
    toast(errorText(err), 'error')
    return null
  }
}

export async function resumeAgent(agentId: string): Promise<void> {
  try {
    await api.resumeAgent(agentId)
  } catch (err) {
    toast(errorText(err), 'error')
  }
}

export async function stopAgent(agentId: string): Promise<void> {
  try {
    await api.stopAgent(agentId)
    toast('Stopping the agent…')
  } catch (err) {
    toast(errorText(err), 'error')
  }
}

export async function removeAgent(agentId: string): Promise<void> {
  try {
    await api.removeAgent(agentId)
    closeDialog()
    toast('Agent removed')
  } catch (err) {
    toast(errorText(err), 'error')
  }
}

/** Renames an agent. Returns false (and shows the error) when the name is rejected. */
export async function renameAgent(agentId: string, name: string): Promise<boolean> {
  try {
    await api.renameAgent(agentId, name)
    return true
  } catch (err) {
    toast(errorText(err), 'error')
    return false
  }
}

export async function deleteProject(projectId: string): Promise<void> {
  try {
    await api.deleteProject(projectId)
    closeDialog()
    toast('Project removed')
  } catch (err) {
    toast(errorText(err), 'error')
  }
}

/** Sets a project's sun letter. An empty icon restores the default. Returns true on success. */
export async function setProjectIcon(projectId: string, icon: string): Promise<boolean> {
  try {
    await api.setProjectIcon(projectId, icon)
    closeDialog()
    toast(icon.trim() ? 'Project icon updated' : 'Project icon reset', 'success')
    return true
  } catch (err) {
    toast(errorText(err), 'error')
    return false
  }
}

const MAX_ICON_BYTES = 2 * 1024 * 1024
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/** Uploads a PNG as a project's sun icon. Checks type and size here; the backend checks again. */
export async function uploadProjectIcon(projectId: string, file: File): Promise<boolean> {
  if (file.size > MAX_ICON_BYTES) {
    toast('That image is larger than 2 MB', 'error')
    return false
  }
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (bytes.length < PNG_SIGNATURE.length || PNG_SIGNATURE.some((b, i) => bytes[i] !== b)) {
    toast('Choose a PNG image', 'error')
    return false
  }
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  try {
    await api.setProjectIconImage(projectId, btoa(binary))
    closeDialog()
    toast('Project icon updated', 'success')
    return true
  } catch (err) {
    toast(errorText(err), 'error')
    return false
  }
}

export async function launchAgent(req: LaunchRequest): Promise<boolean> {
  try {
    const agent = await api.launchAgent(req)
    closeDialog()
    selectAgent(agent.id, { openInspector: true })
    focusAgent(agent.id)
    toast(`${agent.name} is ready${req.task.trim() ? ' and started on the task' : ''}`, 'success')
    return true
  } catch (err) {
    toast(errorText(err), 'error')
    return false
  }
}

export async function createProject(name: string, repoPath: string): Promise<boolean> {
  try {
    await api.createProject(name, repoPath)
    closeDialog()
    toast('Project created', 'success')
    return true
  } catch (err) {
    toast(errorText(err), 'error')
    return false
  }
}

export async function moveAgent(agentId: string, x: number, y: number): Promise<void> {
  try {
    await api.setAgentPosition(agentId, x, y)
  } catch (err) {
    toast(errorText(err), 'error')
  }
}

/**
 * Loads a web page for the built-in browser. Returns null after a toast when it cannot be
 * loaded. A page that answers with an error status still loads; its status is on the page.
 */
export async function browsePage(address: string): Promise<BrowserPage | null> {
  try {
    return await api.browserFetch(address)
  } catch (err) {
    toast(errorText(err), 'error')
    return null
  }
}

/** Opens a web address in the system browser. */
export async function openInSystemBrowser(address: string): Promise<void> {
  try {
    await api.browserOpenExternal(address)
  } catch (err) {
    toast(errorText(err), 'error')
  }
}

// ---- native page view (the browser dialog) ------------------------------------------------
// Failures to open or navigate become toasts. Moving the view happens on every resize, so it stays quiet.

/** Whether this system can show real web pages. False means the dialog uses the text view. */
export async function pageViewSupported(): Promise<boolean> {
  try {
    return await api.browserPaneSupported()
  } catch {
    return false
  }
}

/** Shows the page view over a rectangle and loads the address, when one is given. */
export async function pageViewOpen(address: string, b: PhysicalBounds): Promise<boolean> {
  try {
    await api.browserPaneOpen(address, b.x, b.y, b.w, b.h)
    return true
  } catch (err) {
    toast(errorText(err), 'error')
    return false
  }
}

export async function pageViewNavigate(address: string): Promise<void> {
  try {
    await api.browserPaneNavigate(address)
  } catch (err) {
    toast(errorText(err), 'error')
  }
}

export function pageViewMove(b: PhysicalBounds): void {
  void api.browserPaneSetBounds(b.x, b.y, b.w, b.h).catch(() => {})
}

export async function pageViewCommand(command: 'back' | 'forward' | 'reload' | 'stop' | 'hide' | 'close'): Promise<void> {
  const run = {
    back: () => api.browserPaneBack(),
    forward: () => api.browserPaneForward(),
    reload: () => api.browserPaneReload(),
    stop: () => api.browserPaneStop(),
    hide: () => api.browserPaneHide(),
    close: () => api.browserPaneClose(),
  }[command]
  try {
    await run()
  } catch (err) {
    if (command !== 'hide' && command !== 'close') toast(errorText(err), 'error')
  }
}
