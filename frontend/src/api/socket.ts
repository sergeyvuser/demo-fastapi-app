import type { components } from './generated/socket'

type Schemas = components['schemas']

export type ClientFrame = Schemas['ClientFrame']
export type ServerMessage = Schemas['ServerMessage']
