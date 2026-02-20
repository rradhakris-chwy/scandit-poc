/** Socket event names used by backend and clients */
export const SOCKET_EVENTS = {
  JOIN_ROOM: 'join-room',
  SEND_SCAN: 'send-scan',
  BROADCAST_TO_DASHBOARD: 'broadcast-to-dashboard',
} as const;

export type SocketEventName = (typeof SOCKET_EVENTS)[keyof typeof SOCKET_EVENTS];
