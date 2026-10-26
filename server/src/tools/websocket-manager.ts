import type { IncomingMessage, Server } from "http";
import type { Duplex } from "stream";
import type { Request, RequestHandler, Response } from "express";
import type WebSocket from "ws";
import { WebSocketServer } from "ws";
import { sanitize } from "../middleware/sanitizer";
import {
  getSessionUser,
  isActiveSession,
  sessionExpired,
} from "../middleware/restrict";

type WebSocketMessage = Parameters<WebSocket["send"]>[0];

/**
 * Enum websocket broadcast actions.
 * @readonly
 * @enum {string}
 */
export const ActionTypes = Object.freeze({
  InsertPseudoVolumes: "InsertPseudoVolumes",
  InsertResult: "InsertResult",
  InsertCheckpoint: "InsertCheckpoint",
  AddRawData: "AddRawData",
  InsertTaskHistory: "InsertTaskHistory",

  CPUQueueUpdated: "CPUQueueUpdated",
  GPUQueueUpdated: "GPUQueueUpdated",
});

// TODO: this sort of behaves like a singleton which is not ideal, should be rewritten.
export default class WebSocketManager {
  static #webSocketInstance: WebSocketInstance | null = null;

  static initializeWebSocketInstance(
    expressServer: Server,
    sessionParser: RequestHandler
  ) {
    WebSocketManager.#webSocketInstance?.closeServer();

    WebSocketManager.#webSocketInstance = new WebSocketInstance(
      expressServer,
      sessionParser
    );
    return WebSocketManager.#webSocketInstance;
  }

  static get webSocketInstance() {
    return WebSocketManager.#webSocketInstance;
  }

  static broadcastMessage(
    userIds: number[],
    ignoreSessionIds: string[],
    message: WebSocketMessage
  ) {
    WebSocketManager.#webSocketInstance?.broadcastMessage(
      userIds,
      ignoreSessionIds,
      message
    );
  }

  static broadcastAction(
    userIds: number[],
    ignoreSessionIds: string[],
    actionType: string,
    actionContent: object
  ) {
    WebSocketManager.#webSocketInstance?.broadcastMessage(
      userIds,
      ignoreSessionIds,
      JSON.stringify(
        sanitize({
          actionType: actionType,
          actionContent: actionContent,
        })
      )
    );
  }
}

export class WebSocketInstance {
  // TODO: Use some sort of database.
  #connections = new Map<number, Map<string, WebSocket>>();
  #websocketToUserSession = new Map<
    WebSocket,
    { userId: number; sessionId: string }
  >();

  declare websocketServer: WebSocketServer;
  declare sessionParser: RequestHandler;

  constructor(expressServer: Server, sessionParser: RequestHandler) {
    this.websocketServer = new WebSocketServer({
      noServer: true,
      path: "/ws",
    });
    this.sessionParser = sessionParser;

    expressServer.on(
      "upgrade",
      this.#onUpgrade.bind(this) as (
        req: IncomingMessage,
        socket: Duplex,
        head: Buffer
      ) => void
    );

    this.websocketServer.on(
      "connection",
      this.#onConnection.bind(this) as (
        ws: WebSocket,
        req: IncomingMessage
      ) => void
    );
  }

  #onSocketError(err: unknown) {
    console.error(err);
  }

  #onUpgrade(req: Request, socket: Duplex, head: Buffer) {
    socket.on("error", this.#onSocketError);

    void this.sessionParser(req, {} as Response, () => {
      if (!isActiveSession(req) || sessionExpired(req)) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }

      socket.removeListener("error", this.#onSocketError);

      this.websocketServer.handleUpgrade(
        req,
        socket,
        head,

        (ws) => {
          this.websocketServer.emit("connection", ws, req);
        }
      );
    });
  }

  #onConnection(ws: WebSocket, req: Request) {
    if (!isActiveSession(req)) {
      ws.close();
      return;
    }

    console.log(
      "WebSocket connection established for user:",
      getSessionUser(req).username
    );

    this.#registerUser(getSessionUser(req).id, req.sessionID, ws);

    ws.on("message", (message) => {
      try {
        if (!isActiveSession(req) || sessionExpired(req)) {
          ws.close();
          req.session.destroy(() => {
            // Nothing to do once the session is gone.
          });
          return;
        }
        const data = JSON.parse((message as Buffer).toString()) as {
          type?: unknown;
        };
        if (data.type === "heartbeat") {
          req.session.touch();
        }
      } catch (err) {
        console.error("Invalid message received:", err);
      }
    });

    ws.on("close", () => {
      this.#onConnectionClosed(ws);
    });
  }

  #onConnectionClosed(ws: WebSocket) {
    this.#unregisterUser(ws);
  }

  closeServer() {
    this.websocketServer.close();
  }

  broadcastMessage(
    userIds: number[],
    ignoreSessionIds: string[],
    message: WebSocketMessage
  ) {
    try {
      for (const [userId, userEntry] of this.#connections) {
        if (userIds.length > 0 && !userIds.includes(userId)) {
          continue;
        }
        for (const [sessionId, websocket] of userEntry) {
          if (ignoreSessionIds.includes(sessionId)) {
            continue;
          }
          websocket.send(message);
        }
      }
    } catch (error) {
      console.error("Broadcast error: ", error);
    }
  }

  #registerUser(userId: number, sessionId: string, websocket: WebSocket) {
    try {
      this.#websocketToUserSession.set(websocket, {
        userId: userId,
        sessionId: sessionId,
      });
      let userEntry = this.#connections.get(userId);
      if (!userEntry) {
        userEntry = new Map<string, WebSocket>();
        this.#connections.set(userId, userEntry);
      }
      userEntry.set(sessionId, websocket);
    } catch (error) {
      console.error("Failed to register websocket: ", error);
    }
  }

  #unregisterUser(ws: WebSocket) {
    try {
      const userSession = this.#websocketToUserSession.get(ws);
      if (!userSession) {
        return;
      }
      this.#websocketToUserSession.delete(ws);
      const userEntry = this.#connections.get(userSession.userId);
      userEntry?.delete(userSession.sessionId);
      if (userEntry?.size === 0) {
        this.#connections.delete(userSession.userId);
      }
    } catch (error) {
      console.error("Failed to unregister websocket: ", error);
    }
  }
}
