// User actions. Each one calls the backend, reports failures as toasts, and keeps
// components free of error plumbing.
import type { LaunchRequest } from '../types'
import { api, errorText } from './bridge'
import { closeDialog, focusAgent, getState, selectAgent, setDetail, setDetailError, toast } from './store'

/**
 * Loads the full history of an agent. Safe to call again: it skips agents already loaded,
 * and retries after a failure. A failure is kept in the store so the inspector can offer a retry.
 */
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

export async function sendMessage(agentId: string, text: string): Promise<boolean> {
  try {
    await api.sendMessage(agentId, text)
    return true
  } catch (err) {
    toast(errorText(err), 'error')
    return false
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
