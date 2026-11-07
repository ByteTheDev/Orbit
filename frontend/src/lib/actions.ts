// User actions. Each one calls the backend, reports failures as toasts, and keeps
// components free of error plumbing.
import type { AgentSummary, Automation, BrowserPage, ImageUpload, LaunchRequest, ModelOption, ReleaseInfo } from '../types'
import { api, errorText } from './bridge'
import type { PhysicalBounds } from './browserPane'
import { carryOverSettings } from './modelSearch'
import { MAX_THEME_FILE_BYTES, parseThemeFile, type ThemeInfo } from './settings'
import { addCustomTheme, closeDialog, focusAgent, getState, selectAgent, setDetail, setDetailError, setOnOpenFinished, setState, toast } from './store'

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

/**
 * Reads a theme .json file and returns it for review. Nothing is saved here: the user approves or denies it.
 * Parsing and checks are in settings.ts; failures become toasts and return null.
 */
export async function readThemeFile(file: File): Promise<ThemeInfo | null> {
  if (file.size > MAX_THEME_FILE_BYTES) {
    toast('That theme file is larger than 64 KB', 'error')
    return null
  }
  const parsed = parseThemeFile(await file.text())
  if (!parsed.ok) {
    toast(parsed.error, 'error')
    return null
  }
  return parsed.theme
}

/** Saves an approved theme and switches to it. */
export function approveTheme(theme: ThemeInfo): void {
  addCustomTheme(theme)
  toast(`Theme “${theme.name}” added`, 'success')
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

/**
 * Launches a team: the first agent opens, the partners join, and all of them start on the shared task.
 * The first agent is selected so the talk shows in the inspector. Failures are toasted.
 */
export async function launchTeam(first: LaunchRequest, partners: LaunchRequest[], task: string, maxReplies = 8): Promise<boolean> {
  try {
    const talk = await api.launchTeam(first, partners, task.trim(), maxReplies)
    closeDialog()
    selectAgent(talk.agentAId, { openInspector: true })
    focusAgent(talk.agentAId)
    toast(`${talk.members.length} agents are working together on the task`, 'success')
    return true
  } catch (err) {
    toast(errorText(err), 'error')
    return false
  }
}

/** Brings another agent into an agent's work: the two talk about task until it is done or the reply limit is reached. */
export async function summonAgent(agentId: string, otherId: string, task: string, maxReplies = 8): Promise<boolean> {
  try {
    await api.startTalk(agentId, otherId, task.trim(), maxReplies)
    return true
  } catch (err) {
    toast(errorText(err), 'error')
    return false
  }
}

/** Ends a talk, and cancels the reply in progress. */
export async function stopTalk(talkId: string): Promise<boolean> {
  try {
    await api.stopTalk(talkId)
    return true
  } catch (err) {
    toast(errorText(err), 'error')
    return false
  }
}

/** Creates or updates an automation (the id decides which). The new list arrives as an event. */
export async function saveAutomation(auto: Automation): Promise<boolean> {
  try {
    await api.saveAutomation(auto)
    toast(auto.id ? 'Automation saved' : 'Automation created', 'success')
    return true
  } catch (err) {
    toast(errorText(err), 'error')
    return false
  }
}

export async function deleteAutomation(id: string): Promise<void> {
  try {
    await api.deleteAutomation(id)
    toast('Automation deleted')
  } catch (err) {
    toast(errorText(err), 'error')
  }
}

/** Starts the automation's agent now. The agent appears in the galaxy as usual. */
export async function runAutomation(id: string): Promise<void> {
  try {
    await api.runAutomation(id)
    toast('Started. The agent is in your galaxy.', 'success')
  } catch (err) {
    toast(errorText(err), 'error')
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

/**
 * Asks GitHub for the newest release. Returns the result, or null after a failure, which is
 * reported as a toast. A repository with no published release is not a failure: it returns null
 * as the release, so the dialog can say so.
 */
export async function checkForUpdates(): Promise<{ latest: ReleaseInfo | null } | null> {
  try {
    return { latest: await api.checkForUpdate() }
  } catch (err) {
    const text = errorText(err)
    if (text.includes('no published release yet')) return { latest: null }
    toast(`Could not check for updates: ${text}`, 'error')
    return null
  }
}

/**
 * Switches the model an agent uses from its next message. Thinking level and fast mode carry
 * over only where the new model offers them. Returns false after a failure, which is reported as a toast.
 */
export async function setAgentModel(agent: AgentSummary, modelId: string, models: ModelOption[]): Promise<boolean> {
  const kept = carryOverSettings(models.find((m) => m.id === modelId), agent.effort, agent.fastMode, agent.ultraFast)
  try {
    await api.setAgentModel(agent.id, modelId, kept.effort, kept.fast, kept.ultra)
    return true
  } catch (err) {
    toast(errorText(err), 'error')
    return false
  }
}

/** Moves an agent to another branch of its repository from its next message. It starts a fresh session there. Failures are toasted. */
export async function setAgentBranch(agent: AgentSummary, branch: string): Promise<boolean> {
  try {
    await api.setAgentBranch(agent.id, branch)
    return true
  } catch (err) {
    toast(errorText(err), 'error')
    return false
  }
}

/** Changes an agent's permission mode from its next message. Failures are toasted. */
export async function setAgentPermission(agent: AgentSummary, mode: string): Promise<boolean> {
  try {
    await api.setAgentPermission(agent.id, mode)
    return true
  } catch (err) {
    toast(errorText(err), 'error')
    return false
  }
}

/** Changes only the thinking level of an agent's model, from its next message. Failures are toasted. */
export async function setAgentEffort(agent: AgentSummary, effort: string): Promise<boolean> {
  try {
    await api.setAgentModel(agent.id, agent.model, effort, agent.fastMode, agent.ultraFast)
    return true
  } catch (err) {
    toast(errorText(err), 'error')
    return false
  }
}

/**
 * Sets an agent's speed for its model, from its next message: standard, fast or ultrafast. Ultrafast
 * also turns fast mode on. The backend refuses speeds the model or account does not offer. Failures are toasted.
 */
export async function setAgentSpeed(agent: AgentSummary, speed: 'standard' | 'fast' | 'ultrafast'): Promise<boolean> {
  try {
    await api.setAgentModel(agent.id, agent.model, agent.effort, speed !== 'standard', speed === 'ultrafast')
    return true
  } catch (err) {
    toast(errorText(err), 'error')
    return false
  }
}

/** Opens a release's page in the default browser. */
export async function openReleasePage(url: string): Promise<void> {
  try {
    await api.browserOpenExternal(url)
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

/**
 * Clears the completed mark on an agent the user has opened. Failures are reported as a toast; the
 * agent keeps its completed mark until a later attempt succeeds.
 */
export async function acknowledgeAgent(agentId: string): Promise<void> {
  try {
    await api.acknowledgeAgent(agentId)
  } catch (err) {
    toast(errorText(err), 'error')
  }
}

// Opening a finished agent (see selectAgent in store.ts) clears its completed mark.
setOnOpenFinished((id) => void acknowledgeAgent(id))

/** Copies text to the clipboard and confirms with a toast. `what` names the copied thing, such as "Path". */
export async function copyText(text: string, what: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
    toast(`${what} copied`, 'success')
  } catch {
    toast('Could not copy to the clipboard', 'error')
  }
}

/** Opens a file of the agent's project in the system's default application. */
export async function openProjectFile(agentId: string, path: string): Promise<void> {
  try {
    await api.openProjectFile(agentId, path)
  } catch (err) {
    toast(errorText(err), 'error')
  }
}
