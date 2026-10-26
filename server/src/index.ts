import "dotenv/config";

import express from "express";
import path from "path";
import fileSystem from "fs";
import session, { type SessionOptions } from "express-session";
import { projectsApi } from "./routes/api/projects";
import bodyParser from "body-parser";
import cors from "cors";
import fileUpload from "express-fileupload";
import Database from "better-sqlite3";
import sqlite3SessionStore from "better-sqlite3-session-store";
import helmet from "helmet";
import appConfig from "./tools/config";
import { logErrors, clientErrorHandler } from "./tools/error-handler";
import WebSocketManager from "./tools/websocket-manager";
import http, { type RequestListener, type Server as HTTPServer } from "http";
import https, { type Server as HTTPSServer } from "https";
import TaskHistory from "./models/task-history";
import { responseSanitizer } from "./middleware/sanitizer";
import { checkCookieAge } from "./middleware/restrict";
import { type OptionValues, program } from "commander";
import swaggerUi, { type JsonObject } from "swagger-ui-express";
import YAML from "yaml";
import { writeOpenApi } from "./tools/open-api-generator";
import { delay } from "./middleware/delay";

interface Args extends OptionValues {
  host?: string;
  https?: boolean;
  port?: number;
  demoProject?: number;
}

const SqliteStore = sqlite3SessionStore(session);

const startServer = async () => {
  program
    .option("--port <number>", "port number")
    .option("--host <string>", "host name")
    .option("--https", "use HTTPS")
    .option("--demoProject <number>", "demo project index");

  program.parse(process.argv);

  const options = program.opts<Args>();

  const host = options.host ?? process.env.HOST ?? "localhost";
  const useHttps = options.https ?? process.env.HTTPS === "true";

  const port =
    options.port || Number(process.env.PORT) || (useHttps ? 443 : 8080);

  const demoProjectIndex = options.demoProject ?? appConfig.demoProjectIndex;

  appConfig.demoProjectIndex = demoProjectIndex;

  const seassionsPath = process.env.SESSIONS_PATH || "./database/sessions.db";

  const app = express();

  const isProduction = app.get("env") === "production";

  const allowedOrigins = ["https://files.cryoetdataportal.cziscience.com"];

  const corsOptions = {
    origin: allowedOrigins,
    credentials: true,
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "Content-Disposition",
      "Origin",
      "X-Requested-With",
    ],
    exposedHeaders: ["Content-Disposition"],
    methods: ["GET", "POST", "PUT", "DELETE"],
  };

  app.use(cors(corsOptions));

  console.log("Running environment: ", app.get("env"));

  // middleware
  if (!isProduction && process.env.DELAY !== undefined) {
    app.use(delay(Number(process.env.DELAY)));
  }
  app.use(express.urlencoded({ extended: true }));
  app.use(bodyParser.urlencoded({ extended: true }));
  app.use(bodyParser.json());
  app.use(
    fileUpload({
      createParentPath: true,
      useTempFiles: true,
      tempFileDir: path.join(appConfig.tempPath, "upload"),
    })
  );

  const sessionsDir = path.dirname(seassionsPath);
  if (!fileSystem.existsSync(sessionsDir)) {
    fileSystem.mkdirSync(sessionsDir, { recursive: true, mode: 0o775 });
  }

  const sessionsDB = new Database(seassionsPath);
  sessionsDB.pragma("journal_mode = WAL");

  const allowInsecureCookies = process.env.ALLOW_INSECURE_COOKIES === "true";

  const sess: SessionOptions = {
    name: appConfig.cookieName,
    store: new SqliteStore({
      client: sessionsDB,
      expired: {
        clear: true,
        intervalMs: 10 * 60 * 1000, // 10 minutes
      },
    }),
    resave: false,
    saveUninitialized: false,
    secret: process.env.SESSION_SECRET,
    rolling: true,
    cookie: {
      httpOnly: true,
      secure: isProduction && !allowInsecureCookies,
      maxAge: appConfig.idleSessionExpirationMin * 60 * 1000,
      sameSite: "lax",
    },
  };

  if (isProduction && allowInsecureCookies) {
    console.warn(
      "WARNING: Insecure cookies are allowed in production! This is not recommended for production environments."
    );
  }

  const sessionParser = session(sess);

  if (isProduction) {
    app.set("trust proxy", true);
    app.use(
      helmet({
        contentSecurityPolicy: {
          directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-eval'"],
            connectSrc: [
              "'self'",
              "https://files.cryoetdataportal.cziscience.com",
              "wss:",
              "ws:",
            ],
          },
        },
        originAgentCluster: false,
        crossOriginOpenerPolicy: false,
      })
    );
  }
  console.log("Writing OpenAPI");
  writeOpenApi();
  const file = fileSystem.readFileSync("./openapi.yaml", "utf8");
  const swaggerDocument = YAML.parse(file, {
    maxAliasCount: -1,
  }) as JsonObject;
  app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerDocument));

  app.use(sessionParser);

  app.use(responseSanitizer);

  app.use(checkCookieAge);

  // API
  app.use("/api", projectsApi);

  const clientPath = path.join("../", "client", "build");
  console.log("Client path: ", clientPath);

  if (fileSystem.existsSync(clientPath)) {
    app.use("/", express.static(clientPath));
    app.use("/demo/", express.static(clientPath));
    app.use("/project/:id", express.static(clientPath));
  } else {
    console.warn("No client build found, serving api only!");
  }

  app.use("/logs", express.static("logs", { index: false }));

  let server: HTTPServer | HTTPSServer | undefined;

  if (useHttps) {
    console.log("Initializing https server");

    let keyContent: string | null = null;
    if (process.env.SSL_KEY_CONTENT) {
      keyContent = Buffer.from(process.env.SSL_KEY_CONTENT, "base64").toString(
        "utf8"
      );
    } else if (process.env.SSL_KEY_PATH) {
      keyContent = fileSystem
        .readFileSync(process.env.SSL_KEY_PATH)
        .toString("utf-8");
    }

    let certContent: string | null = null;
    if (process.env.SSL_CRT_CONTENT) {
      certContent = Buffer.from(process.env.SSL_CRT_CONTENT, "base64").toString(
        "utf8"
      );
    } else if (process.env.SSL_CRT_PATH) {
      certContent = fileSystem
        .readFileSync(process.env.SSL_CRT_PATH)
        .toString("utf-8");
    }

    if (!keyContent || !certContent) {
      console.error("No SSL key or certificate provided, exiting with error!");
      process.exit(1);
    }

    server = https.createServer(
      {
        key: keyContent,
        cert: certContent,
      },
      app as RequestListener
    );
  } else {
    console.log("Initializing http server");
    server = http.createServer(app as RequestListener);
  }
  // Websockets
  WebSocketManager.initializeWebSocketInstance(server, sessionParser);

  // 404 Error
  app.use(function (_req, res) {
    res.status(404).json({
      name: "Bad Url",
      message: "Sorry, this page does not exist.",
    });
  });

  app.use(logErrors);
  app.use(clientErrorHandler);

  await TaskHistory.clearOngoing();
  if (appConfig.cleanTempOnStartup) {
    await fileSystem.promises.rm(appConfig.tempPath, {
      recursive: true,
      force: true,
    });
  }

  server.listen(port, host, () => {
    console.log(`listening on ${host}:${port.toString()}`);
  });
};

startServer().catch((error: unknown) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
