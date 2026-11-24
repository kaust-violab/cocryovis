// openSession from lib/session.mjs, ../ = up one folder, from jobs to gaussian-renderer
import { openSession } from "../lib/session.mjs";

// process.env = terminal variables, GV_HEADLESS=0 = visible window
process.env.GV_HEADLESS = "0";

// scene folder: GV_SCENES or, if not set, "scenes"
const SCENES = process.env.GV_SCENES ?? "scenes";

// openSession: starts the server, opens chromium, loads the test page, prints the adapter line
//   mounts: the server url /data/scenes serves the SCENES files
//   port 8766: regression uses 8765, so both can run at once
const s = await openSession({ mounts: { "/data/scenes": SCENES }, port: 8766 });

// "m" = message
s.page.on("console", (m) => { // every time the page writes to its console, run this function
  if (m.type() === "log" || m.type() === "info") console.log(`[viewer] ${m.text()}`); // session.mjs only forwards errors and warnings, here we also forward normal messages (log and info)
});

await s.page.goto("http://localhost:8766/viewer.html");
console.log("viewer open, ctrl+c to close");

let closing = false;

// orderly shutdown: browser and server first, then node exits
async function shutdown() {
  if (closing) return;
  closing = true;
  console.log("closing viewer…");
  await s.close().catch(() => {}); // closes chromium and the server
  process.exit(0);                 // ends node
}

// SIGINT = ctrl+c
process.on("SIGINT", shutdown);
// window closed by hand
s.page.on("close", shutdown);

// the open server keeps the process alive