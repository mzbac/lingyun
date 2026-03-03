/** Map status prefixes back to tool names for animation selection */
export const STATUS_TO_TOOL: Record<string, string> = {
  'Reading': 'Read',
  'Searching': 'Grep',
  'Globbing': 'Glob',
  'Fetching': 'WebFetch',
  'Searching web': 'WebSearch',
  'Searching the web': 'WebSearch',
  'Writing': 'Write',
  'Editing': 'Edit',
  'Running': 'Bash',
  'Task': 'Task',
}

const STATUS_PREFIXES = Object.entries(STATUS_TO_TOOL).sort((a, b) => b[0].length - a[0].length)

export function extractToolName(status: string): string | null {
  for (const [prefix, tool] of STATUS_PREFIXES) {
    if (status.startsWith(prefix)) return tool
  }
  const first = status.split(/[\s:]/)[0]
  return first || null
}

import { ZOOM_DEFAULT_DPR_FACTOR, ZOOM_MIN } from '../constants.js'

/** Compute a default integer zoom level (device pixels per sprite pixel) */
export function defaultZoom(): number {
  const dpr = window.devicePixelRatio || 1
  return Math.max(ZOOM_MIN, Math.round(ZOOM_DEFAULT_DPR_FACTOR * dpr))
}
