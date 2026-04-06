/**
 * BridgeService — WebSocket server that bridges MCP server ↔ Figma plugin.
 * The Figma plugin connects to this WebSocket to receive import commands.
 */

import { WebSocketServer, WebSocket } from 'ws';

const DEFAULT_PORT = 9274; // w2f on phone keypad :)

export class BridgeService {
  private wss: WebSocketServer | null = null;
  private figmaClient: WebSocket | null = null;
  private port: number = DEFAULT_PORT;
  private pendingRequests = new Map<string, {
    resolve: (value: any) => void;
    reject: (reason: any) => void;
    timeout: NodeJS.Timeout;
  }>();
  private requestCounter = 0;

  async start(port?: number): Promise<void> {
    this.port = port || DEFAULT_PORT;

    return new Promise((resolve) => {
      this.wss = new WebSocketServer({ port: this.port }, () => {
        console.error(`[Web2Fig Bridge] WebSocket server listening on port ${this.port}`);
        resolve();
      });

      this.wss.on('connection', (ws, req) => {
        console.error(`[Web2Fig Bridge] Client connected from ${req.socket.remoteAddress}`);
        this.figmaClient = ws;

        ws.on('message', (data) => {
          try {
            const message = JSON.parse(data.toString());
            this.handleMessage(message);
          } catch (err) {
            console.error('[Web2Fig Bridge] Invalid message:', err);
          }
        });

        ws.on('close', () => {
          console.error('[Web2Fig Bridge] Client disconnected');
          if (this.figmaClient === ws) {
            this.figmaClient = null;
          }
        });

        ws.on('error', (err) => {
          console.error('[Web2Fig Bridge] WebSocket error:', err);
        });
      });

      this.wss.on('error', (err: any) => {
        if (err.code === 'EADDRINUSE') {
          console.error(`[Web2Fig Bridge] Port ${this.port} in use, trying ${this.port + 1}`);
          this.port++;
          this.wss?.close();
          this.start(this.port).then(resolve);
        } else {
          console.error('[Web2Fig Bridge] Server error:', err);
        }
      });
    });
  }

  isConnected(): boolean {
    return this.figmaClient?.readyState === WebSocket.OPEN;
  }

  getPort(): number {
    return this.port;
  }

  async sendToFigma(message: any): Promise<any> {
    if (!this.isConnected()) {
      throw new Error(
        'Figma plugin is not connected. Please open Figma and run the Web2Fig plugin, ' +
        'then connect to the bridge WebSocket.'
      );
    }

    const requestId = `req_${++this.requestCounter}`;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error('Figma plugin did not respond within 30 seconds'));
      }, 30000);

      this.pendingRequests.set(requestId, { resolve, reject, timeout });

      this.figmaClient!.send(JSON.stringify({
        ...message,
        requestId,
      }));
    });
  }

  private handleMessage(message: any): void {
    if (message.requestId && this.pendingRequests.has(message.requestId)) {
      const { resolve, reject, timeout } = this.pendingRequests.get(message.requestId)!;
      clearTimeout(timeout);
      this.pendingRequests.delete(message.requestId);

      if (message.error) {
        reject(new Error(message.error));
      } else {
        resolve(message);
      }
    }
  }

  async stop(): Promise<void> {
    for (const [_, { reject, timeout }] of this.pendingRequests) {
      clearTimeout(timeout);
      reject(new Error('Bridge shutting down'));
    }
    this.pendingRequests.clear();

    return new Promise((resolve) => {
      if (this.wss) {
        this.wss.close(() => resolve());
      } else {
        resolve();
      }
    });
  }
}
