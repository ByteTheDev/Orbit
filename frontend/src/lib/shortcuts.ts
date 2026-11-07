// The keyboard map. Shown in Settings > Keyboard and implemented in App.tsx.
export const SHORTCUTS: { keys: string; action: string }[] = [
  { keys: 'N', action: 'Launch a new agent' },
  { keys: 'P', action: 'Create a project' },
  { keys: '[', action: 'Show or hide the projects panel' },
  { keys: 'D', action: 'Open or close the dashboard of all agents' },
  { keys: 'B', action: 'Open the browser to read a web page' },
  { keys: ']', action: 'Show or hide the inspector' },
  { keys: 'Alt + ↑ / ↓', action: 'Select the previous or next agent' },
  { keys: 'F', action: 'Focus the selected agent, or fit everything' },
  { keys: '0', action: 'Fit all projects in view' },
  { keys: '+ / −', action: 'Zoom in and out' },
  { keys: '← ↑ → ↓', action: 'Pan the universe' },
  { keys: '1 – 6', action: 'Switch inspector tabs' },
  { keys: 'Enter / Shift + Enter', action: 'Send a message / new line in chat' },
  { keys: 'Right-click a planet', action: 'Open the agent menu' },
  { keys: 'Drag a planet', action: 'Reposition it within its system' },
  { keys: 'Esc', action: 'Close a dialog, menu or the inspector' },
  { keys: '?', action: 'Open settings at the keyboard shortcuts' },
  { keys: ',', action: 'Open settings' },
]

/** Tabs in the order of the number keys 1 to 6. */
export const TAB_KEYS = ['overview', 'chat', 'files', 'changes'] as const
