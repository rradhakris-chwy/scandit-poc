import { io, type Socket } from 'socket.io-client';
import { SOCKET_EVENTS } from './constants.js';

export type ScanPayload = {
  type: 'barcode' | 'ocr';
  value: string;
  raw?: string;
  timestamp?: number;
};

/** Default Socket.io server URL (packages/socket-server, port 4001) */
const defaultWsUrl =
  typeof window !== 'undefined'
    ? `${window.location.protocol}//${window.location.hostname}:4001`
    : 'http://localhost:4001';

/**
 * Create a Socket.io client connected to the socket server (packages/socket-server).
 * @param baseUrl - Socket server URL (default http://localhost:4001)
 */
export function createSocketClient(baseUrl: string = defaultWsUrl): Socket {
  return io(baseUrl, {
    autoConnect: true,
    transports: ['websocket', 'polling'],
  });
}

/**
 * Join a room by session id (used by mobile scanner).
 */
export function joinRoom(socket: Socket, sid: string): void {
  socket.emit(SOCKET_EVENTS.JOIN_ROOM, { sid });
}

/**
 * Emit a scan result to the server (mobile scanner → server).
 */
export function sendScan(socket: Socket, sid: string, payload: ScanPayload): void {
  socket.emit(SOCKET_EVENTS.SEND_SCAN, { sid, ...payload });
}

/**
 * Subscribe to scan events broadcast to the dashboard.
 */
export function onBroadcastToDashboard(
  socket: Socket,
  handler: (payload: ScanPayload & { sid?: string }) => void
): () => void {
  socket.on(SOCKET_EVENTS.BROADCAST_TO_DASHBOARD, handler);
  return () => socket.off(SOCKET_EVENTS.BROADCAST_TO_DASHBOARD);
}

export { SOCKET_EVENTS };
