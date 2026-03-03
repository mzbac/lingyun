import { CharacterState } from '../types.js'
import type { Character, Seat } from '../types.js'

export function isCharacterSeated(ch: Character, seats: Map<string, Seat>): boolean {
  if (ch.state !== CharacterState.TYPE) return false
  if (!ch.seatId) return false
  const seat = seats.get(ch.seatId)
  if (!seat) return false
  return seat.seatCol === ch.tileCol && seat.seatRow === ch.tileRow
}

