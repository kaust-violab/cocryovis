// @ts-check

import WebSocket, { WebSocketServer } from "ws";
import { sanitize } from "../middleware/sanitizer";
import { isActiveSession, sessionExpired } from "../middleware/restrict";

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
  /** @type {WebSocketInstance?} */
  static #webSocketInstance = null;

  /**
   * @param {import("http").Server} expressServer
   * @param {import("express").RequestHandler} sessionParser
   */
  static initializeWebSocketInstance(expressServer, sessionParser) {
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

  /**
   * @param {number[]} userIds
   * @param {string[]} ignoreSessionIds
   * @param {string | number | readonly any[] | ArrayBuffer | SharedArrayBuffer | Uint8Array | Buffer<ArrayBufferLike> | DataView | ArrayBufferView | readonly number[] | { valueOf(): ArrayBuffer; } | { valueOf(): SharedArrayBuffer; } | { valueOf(): Uint8Array; } | { valueOf(): readonly number[]; } | { valueOf(): string; } | { [Symbol.toPrimitive](hint: string): string; }} message
   */
  static broadcastMessage(userIds, ignoreSessionIds, message) {
    WebSocketManager.#webSocketInstance?.broadcastMessage(
      userIds,
      ignoreSessionIds,
      message
    );
  }

  /**
   * @param {number[]} userIds
   * @param {string[]} ignoreSessionIds
   * @param {string} actionType
   * @param {object} actionContent
   */
  static broadcastAction(userIds, ignoreSessionIds, actionType, actionContent) {
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
  /** @type {Map<number, Map<string, WebSocket>>}} */
  #connections = new Map();
  /** @type {Map<WebSocket, {userId: number, sessionId: string}>} */
  #websocketToUserSession = new Map();

  /**
   * @param {import("http").Server} expressServer
   * @param {import("express").RequestHandler} sessionParser
   */
  constructor(expressServer, sessionParser) {
    /** @type {WebSocketServer} */
    this.websocketServer = new WebSocketServer({
      noServer: true,
      path: "/ws",
    });
    this.sessionParser = sessionParser;

    expressServer.on("upgrade", this.#onUpgrade.bind(this));

    this.websocketServer.on("connection", this.#onConnection.bind(this));
  }

  /**
   * @param {any} err
   */
  #onSocketError(err) {
    console.error(err);
  }

  /**
   * @param {import("express").Request} req
   * @param {import("stream").Duplex} socket
   * @param {Buffer} head
   */
  #onUpgrade(req, socket, head) {
    socket.on("error", this.#onSocketError);

    // @ts-ignore
    this.sessionParser(req, {}, () => {
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

        (/** @type {WebSocket} */ ws) => {
          this.websocketServer.emit("connection", ws, req);
        }
      );
    });
  }

  /**
   * @param {WebSocket} ws
   * @param {import("express").Request} req
   */
  #onConnection(ws, req) {
    if (!isActiveSession(req)) {
      ws.close();
      return;
    }

    console.log(
      "WebSocket connection established for user:",
      req.session.user.username
    );

    this.#registerUser(req.session.user.id, req.sessionID, ws);

    ws.on("message", (message) => {
      try {
        if (!isActiveSession(req) || sessionExpired(req)) {
          ws.close();
          req.session.destroy(() => {});
          return;
        }
        const data = JSON.parse(message.toString());
        if (data.type === "heartbeat") {
          req.session.touch();
        }
      } catch (err) {
        console.error("Invalid message received:", err);
      }
    });

    ws.on("close", () => this.#onConnectionClosed(ws));
  }

  /**
   * @param {WebSocket} ws
   */
  #onConnectionClosed(ws) {
    this.#unregisterUser(ws);
  }

  closeServer() {
    this.websocketServer.close();
  }

  /**
   * @param {number[]} userIds
   * @param {string[]} ignoreSessionIds
   * @param {string | number | readonly any[] | ArrayBuffer | SharedArrayBuffer | Uint8Array | Buffer<ArrayBufferLike> | DataView | ArrayBufferView | readonly number[] | { valueOf(): ArrayBuffer; } | { valueOf(): SharedArrayBuffer; } | { valueOf(): Uint8Array; } | { valueOf(): readonly number[]; } | { valueOf(): string; } | { [Symbol.toPrimitive](hint: string): string; }} message
   */
  broadcastMessage(userIds, ignoreSessionIds, message) {
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

  /**
   * @param {number} userId
   * @param {string} sessionId
   * @param {WebSocket} websocket
   */
  #registerUser(userId, sessionId, websocket) {
    try {
      this.#websocketToUserSession.set(websocket, {
        userId: userId,
        sessionId: sessionId,
      });
      let userEntry = this.#connections.get(userId);
      if (!userEntry) {
        userEntry = new Map();
        this.#connections.set(userId, userEntry);
      }
      userEntry.set(sessionId, websocket);
    } catch (error) {
      console.error("Failed to register websocket: ", error);
    }
  }

  /**
   * @param {WebSocket} ws
   */
  #unregisterUser(ws) {
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
