import { useState, useEffect, useRef } from 'react'
import type { OfficeState } from '../office/engine/officeState.js'
import type { OfficeLayout, ToolActivity } from '../office/types.js'
import { extractToolName } from '../office/toolUtils.js'
import { createDefaultLayout, migrateLayoutColors } from '../office/layout/layoutSerializer.js'
import { setFloorSprites } from '../office/floorTiles.js'
import { setWallSprites } from '../office/wallTiles.js'
import { setCharacterTemplates } from '../office/sprites/spriteData.js'
import { applyFurnitureSpriteOverrides, loadDynamicFurnitureAssets } from '../office/layout/furnitureCatalog.js'
import { vscode } from '../vscodeApi.js'
import { playDoneSound, setSoundEnabled } from '../notificationSound.js'
import { isOfficeToWebviewMessage, type WebviewToExtensionMessage } from '../../../src/shared/officeProtocol.js'

export interface SubagentCharacter {
  id: number
  parentAgentId: number
  parentToolId: string
  label: string
}

export interface ExtensionMessageState {
  agents: number[]
  selectedAgent: number | null
  agentTools: Record<number, ToolActivity[]>
  agentStatuses: Record<number, string>
  subagentTools: Record<number, Record<string, ToolActivity[]>>
  subagentCharacters: SubagentCharacter[]
  layoutReady: boolean
}

function saveAgentSeats(os: OfficeState): void {
  const seats: Record<number, { palette: number; hueShift: number; seatId: string | null }> = {}
  for (const ch of os.characters.values()) {
    if (ch.isSubagent) continue
    seats[ch.id] = { palette: ch.palette, hueShift: ch.hueShift, seatId: ch.seatId }
  }
  const message: WebviewToExtensionMessage = { type: 'saveAgentSeats', seats }
  vscode.postMessage(message)
}

export function useExtensionMessages(
  getOfficeState: () => OfficeState,
  onLayoutLoaded?: (layout: OfficeLayout) => void,
  isEditDirty?: () => boolean,
): ExtensionMessageState {
  const [agents, setAgents] = useState<number[]>([])
  const [selectedAgent, setSelectedAgent] = useState<number | null>(null)
  const [agentTools, setAgentTools] = useState<Record<number, ToolActivity[]>>({})
  const [agentStatuses, setAgentStatuses] = useState<Record<number, string>>({})
  const [subagentTools, setSubagentTools] = useState<Record<number, Record<string, ToolActivity[]>>>({})
  const [subagentCharacters, setSubagentCharacters] = useState<SubagentCharacter[]>([])
  const [layoutReady, setLayoutReady] = useState(false)

  // Track whether initial layout has been loaded (ref to avoid re-render)
  const layoutReadyRef = useRef(false)
  // Authoritative list of main agent IDs currently displayed in the Office view.
  const visibleAgentIdsRef = useRef<Set<number>>(new Set())
  const hasSeenExistingAgentsRef = useRef(false)

  useEffect(() => {
    // Buffer agents from existingAgents until layout is loaded
    let pendingAgents: Array<{ id: number; palette?: number; hueShift?: number; seatId?: string }> = []

    const isVisibleAgent = (id: number): boolean => {
      const visible = visibleAgentIdsRef.current
      // If we haven't received an authoritative list yet, don't drop events.
      if (!hasSeenExistingAgentsRef.current) return true
      return visible.has(id)
    }

    const ensureSubagent = (os: OfficeState, parentAgentId: number, parentToolId: string, label?: string): number | null => {
      const parent = os.characters.get(parentAgentId)
      if (!parent || parent.isSubagent) return null

      const subId = os.addSubagent(parentAgentId, parentToolId)
      const safeLabel = (label || '').trim() || 'Subagent task'
      setSubagentCharacters((prev) => {
        const idx = prev.findIndex((s) => s.id === subId)
        if (idx === -1) {
          return [...prev, { id: subId, parentAgentId: parentAgentId, parentToolId, label: safeLabel }]
        }
        const existing = prev[idx]
        if (
          existing.parentAgentId === parentAgentId &&
          existing.parentToolId === parentToolId &&
          existing.label === safeLabel
        ) {
          return prev
        }
        const next = [...prev]
        next[idx] = { ...existing, parentAgentId: parentAgentId, parentToolId, label: safeLabel }
        return next
      })
      return subId
    }

    const handler = (e: MessageEvent) => {
      const raw = e.data
      if (!isOfficeToWebviewMessage(raw)) return
      const msg = raw
      const os = getOfficeState()

      if (msg.type === 'resetLayoutToDefault') {
        const layout = createDefaultLayout()
        os.rebuildFromLayout(layout)
        onLayoutLoaded?.(layout)
        // Layout rebuild may have reassigned seats; persist the new assignments.
        if (os.characters.size > 0) {
          saveAgentSeats(os)
        }
        return
      }

      if (msg.type === 'layoutLoaded') {
        // Skip external layout updates while editor has unsaved changes
        if (layoutReadyRef.current && isEditDirty?.()) {
          console.log('[Webview] Skipping external layout update — editor has unsaved changes')
          return
        }
        const rawLayout = msg.layout as OfficeLayout | null
        const layout = rawLayout && rawLayout.version === 1 ? migrateLayoutColors(rawLayout) : null
        if (layout) {
          os.rebuildFromLayout(layout)
          onLayoutLoaded?.(layout)
        } else {
          // Default layout — snapshot whatever OfficeState built
          onLayoutLoaded?.(os.getLayout())
        }
        // Add buffered agents now that layout (and seats) are correct
        for (const p of pendingAgents) {
          os.addAgent(p.id, p.palette, p.hueShift, p.seatId, true)
        }
        pendingAgents = []
        layoutReadyRef.current = true
        setLayoutReady(true)
        if (os.characters.size > 0) {
          saveAgentSeats(os)
        }
      } else if (msg.type === 'existingAgents') {
        const incomingRaw = msg.agents
        const incoming = [...new Set(incomingRaw)].sort((a, b) => a - b)
        const incomingSet = new Set(incoming)
        visibleAgentIdsRef.current = incomingSet
        hasSeenExistingAgentsRef.current = true
        const meta: Record<number, { palette?: number; hueShift?: number; seatId?: string | null }> = msg.agentMeta || {}
        if (layoutReadyRef.current) {
          // Layout is already loaded — reconcile to match the authoritative list.
          const existingMainAgents = [...os.characters.values()]
            .filter((ch) => !ch.isSubagent)
            .map((ch) => ch.id)
          const removed = existingMainAgents.filter((id) => !incomingSet.has(id))

          for (const id of removed) {
            os.removeAllSubagents(id)
            os.removeAgent(id)
          }

          if (removed.length > 0) {
            setAgentTools((prev) => {
              const next = { ...prev }
              for (const id of removed) delete next[id]
              return next
            })
            setAgentStatuses((prev) => {
              const next = { ...prev }
              for (const id of removed) delete next[id]
              return next
            })
            setSubagentTools((prev) => {
              const next = { ...prev }
              for (const id of removed) delete next[id]
              return next
            })
            setSubagentCharacters((prev) => prev.filter((s) => !removed.includes(s.parentAgentId)))
          }

          for (const id of incoming) {
            const m = meta[id]
            const seatId = typeof m?.seatId === 'string' ? m.seatId : undefined
            os.addAgent(id, m?.palette, m?.hueShift, seatId, true)
          }
          if (incoming.length > 0) {
            saveAgentSeats(os)
          }
        } else {
          // Buffer agents — they'll be added in layoutLoaded after seats are built.
          pendingAgents = []
          for (const id of incoming) {
            const m = meta[id]
            const seatId = typeof m?.seatId === 'string' ? m.seatId : undefined
            pendingAgents.push({ id, palette: m?.palette, hueShift: m?.hueShift, seatId })
          }
        }
        setAgents(incoming)
      } else if (msg.type === 'agentToolStart') {
        const id = msg.id as number
        if (!isVisibleAgent(id)) return
        const toolId = msg.toolId as string
        const status = msg.status as string
        setAgentTools((prev) => {
          const list = prev[id] || []
          if (list.some((t) => t.toolId === toolId)) return prev
          return { ...prev, [id]: [...list, { toolId, status, done: false }] }
        })
        const toolNameFromMsg = typeof msg.toolName === 'string' ? msg.toolName.trim() : ''
        const toolName = toolNameFromMsg || extractToolName(status)
        const workTypeFromMsg = typeof msg.workType === 'string' ? msg.workType.trim() : ''
        const seatChanged = os.setAgentTool(id, toolName, workTypeFromMsg || null)
        if (seatChanged) saveAgentSeats(os)
        os.setAgentActive(id, true)
        os.clearPermissionBubble(id)
        if (toolName && toolName.toLowerCase() === 'task') {
          const label = status.startsWith('Task:') ? status.slice('Task:'.length).trim() : ''
          const subId = ensureSubagent(os, id, toolId, label)
          if (subId !== null) {
            // Keep both the parent and the subagent "working at a computer" for Task work.
            os.setAgentTool(subId, toolName, workTypeFromMsg || null)
            os.setAgentActive(subId, true)
            os.clearPermissionBubble(subId)
          }
        }
      } else if (msg.type === 'agentToolDone') {
        const id = msg.id as number
        if (!isVisibleAgent(id)) return
        const toolId = msg.toolId as string
        setAgentTools((prev) => {
          const list = prev[id]
          if (!list) return prev
          return {
            ...prev,
            [id]: list.map((t) => (t.toolId === toolId ? { ...t, done: true } : t)),
          }
        })
        // If this tool was a Task/subagent parent, clean up any corresponding sub-agent state.
        setSubagentTools((prev) => {
          const agentSubs = prev[id]
          if (!agentSubs || !(toolId in agentSubs)) return prev
          const next = { ...agentSubs }
          delete next[toolId]
          if (Object.keys(next).length === 0) {
            const outer = { ...prev }
            delete outer[id]
            return outer
          }
          return { ...prev, [id]: next }
        })
        os.removeSubagent(id, toolId)
        setSubagentCharacters((prev) => prev.filter((s) => !(s.parentAgentId === id && s.parentToolId === toolId)))
      } else if (msg.type === 'agentToolsClear') {
        const id = msg.id as number
        if (!isVisibleAgent(id)) return
        setAgentTools((prev) => {
          if (!(id in prev)) return prev
          const next = { ...prev }
          delete next[id]
          return next
        })
        setSubagentTools((prev) => {
          if (!(id in prev)) return prev
          const next = { ...prev }
          delete next[id]
          return next
        })
        // Remove all sub-agent characters belonging to this agent
        os.removeAllSubagents(id)
        setSubagentCharacters((prev) => prev.filter((s) => s.parentAgentId !== id))
        os.setAgentTool(id, null)
        os.clearPermissionBubble(id)
      } else if (msg.type === 'agentSelected') {
        const id = msg.id as number
        if (!isVisibleAgent(id)) return
        setSelectedAgent(id)
      } else if (msg.type === 'agentStatus') {
        const id = msg.id as number
        if (!isVisibleAgent(id)) return
        const status = msg.status as string
        setAgentStatuses((prev) => {
          if (status === 'active') {
            if (!(id in prev)) return prev
            const next = { ...prev }
            delete next[id]
            return next
          }
          return { ...prev, [id]: status }
        })
        os.setAgentActive(id, status === 'active')
        if (status === 'waiting') {
          os.showWaitingBubble(id)
          playDoneSound()
        }
      } else if (msg.type === 'agentToolPermission') {
        const id = msg.id as number
        if (!isVisibleAgent(id)) return
        setAgentTools((prev) => {
          const list = prev[id]
          if (!list) return prev
          return {
            ...prev,
            [id]: list.map((t) => (t.done ? t : { ...t, permissionWait: true })),
          }
        })
        os.showPermissionBubble(id)
      } else if (msg.type === 'subagentToolPermission') {
        const id = msg.id as number
        if (!isVisibleAgent(id)) return
        const parentToolId = msg.parentToolId as string
        const subId = ensureSubagent(os, id, parentToolId)
        if (subId === null) return
        os.showPermissionBubble(subId)
      } else if (msg.type === 'agentToolPermissionClear') {
        const id = msg.id as number
        if (!isVisibleAgent(id)) return
        setAgentTools((prev) => {
          const list = prev[id]
          if (!list) return prev
          const hasPermission = list.some((t) => t.permissionWait)
          if (!hasPermission) return prev
          return {
            ...prev,
            [id]: list.map((t) => (t.permissionWait ? { ...t, permissionWait: false } : t)),
          }
        })
        os.clearPermissionBubble(id)
        // Also clear permission bubbles on all sub-agent characters of this parent
        for (const [subId, meta] of os.subagentMeta) {
          if (meta.parentAgentId === id) {
            os.clearPermissionBubble(subId)
          }
        }
      } else if (msg.type === 'subagentCreated') {
        const id = msg.id as number
        if (!isVisibleAgent(id)) return
        const parentToolId = msg.parentToolId as string
        const label = (msg.label as string) || 'Subagent task'
        ensureSubagent(os, id, parentToolId, label)
      } else if (msg.type === 'subagentToolStart') {
        const id = msg.id as number
        if (!isVisibleAgent(id)) return
        const parentToolId = msg.parentToolId as string
        const toolId = msg.toolId as string
        const status = msg.status as string
        setSubagentTools((prev) => {
          const agentSubs = prev[id] || {}
          const list = agentSubs[parentToolId] || []
          if (list.some((t) => t.toolId === toolId)) return prev
          return { ...prev, [id]: { ...agentSubs, [parentToolId]: [...list, { toolId, status, done: false }] } }
        })
        const subId = ensureSubagent(os, id, parentToolId)
        if (subId === null) return
        const subToolNameFromMsg = typeof msg.toolName === 'string' ? msg.toolName.trim() : ''
        const subToolName = subToolNameFromMsg || extractToolName(status)
        const workTypeFromMsg = typeof msg.workType === 'string' ? msg.workType.trim() : ''
        os.setAgentTool(subId, subToolName, workTypeFromMsg || null)
        os.setAgentActive(subId, true)
      } else if (msg.type === 'subagentToolDone') {
        const id = msg.id as number
        if (!isVisibleAgent(id)) return
        const parentToolId = msg.parentToolId as string
        const toolId = msg.toolId as string
        setSubagentTools((prev) => {
          const agentSubs = prev[id]
          if (!agentSubs) return prev
          const list = agentSubs[parentToolId]
          if (!list) return prev
          return {
            ...prev,
            [id]: { ...agentSubs, [parentToolId]: list.map((t) => (t.toolId === toolId ? { ...t, done: true } : t)) },
          }
        })
      } else if (msg.type === 'subagentClear') {
        const id = msg.id as number
        if (!isVisibleAgent(id)) return
        const parentToolId = msg.parentToolId as string
        setSubagentTools((prev) => {
          const agentSubs = prev[id]
          if (!agentSubs || !(parentToolId in agentSubs)) return prev
          const next = { ...agentSubs }
          delete next[parentToolId]
          if (Object.keys(next).length === 0) {
            const outer = { ...prev }
            delete outer[id]
            return outer
          }
          return { ...prev, [id]: next }
        })
        // Remove sub-agent character
        os.removeSubagent(id, parentToolId)
        setSubagentCharacters((prev) => prev.filter((s) => !(s.parentAgentId === id && s.parentToolId === parentToolId)))
      } else if (msg.type === 'characterSpritesLoaded') {
        const characters = msg.characters as Array<{ down: string[][][]; up: string[][][]; right: string[][][] }>
        console.log(`[Webview] Received ${characters.length} pre-colored character sprites`)
        setCharacterTemplates(characters)
      } else if (msg.type === 'floorTilesLoaded') {
        const sprites = msg.sprites as string[][][]
        console.log(`[Webview] Received ${sprites.length} floor tile patterns`)
        setFloorSprites(sprites)
      } else if (msg.type === 'wallTilesLoaded') {
        const sprites = msg.sprites as string[][][]
        console.log(`[Webview] Received ${sprites.length} wall tile sprites`)
        setWallSprites(sprites)
      } else if (msg.type === 'furnitureCatalogLoaded') {
        const catalog = msg.catalog as Array<{ type: string; label: string }>
        console.log(`[Webview] Received ${catalog.length} furniture assets from tileset`)
        loadDynamicFurnitureAssets(msg.catalog, {})
        os.refreshFurnitureSprites()
      } else if (msg.type === 'furnitureSpritesLoaded') {
        const sprites = msg.sprites as Record<string, string[][]>
        const types = Object.keys(sprites || {})
        console.log(`[Webview] Received ${types.length} furniture sprites`)
        applyFurnitureSpriteOverrides(sprites)
        os.refreshFurnitureSprites()
      } else if (msg.type === 'settingsLoaded') {
        const soundOn = msg.soundEnabled as boolean
        setSoundEnabled(soundOn)
      }
    }
    window.addEventListener('message', handler)
    const ready: WebviewToExtensionMessage = { type: 'webviewReady' }
    vscode.postMessage(ready)
    return () => window.removeEventListener('message', handler)
  }, [getOfficeState])

  return { agents, selectedAgent, agentTools, agentStatuses, subagentTools, subagentCharacters, layoutReady }
}
