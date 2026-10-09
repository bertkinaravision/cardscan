// Preloaded into `next start` (NODE_OPTIONS=--import) for the adversarial tests: replaces Google
// Sheets, Drive, OAuth and Gemini with the in-memory fake in ../fake-google.mjs, so nothing real is
// ever touched. A small control server on FAKE_CONTROL_PORT (default 3199) lets tests drive it:
//   POST /reset               empty spreadsheet, no faults
//   POST /set   {faults}      merge into the faults
//   POST /op    {name, args}  something a person does in the Sheet (see `ops`)
//   GET  /state               tabs, metadata, Drive files and request log
import http from "node:http";
import { fake, install, ops, reset } from "../fake-google.mjs";

const port = Number(process.env.FAKE_CONTROL_PORT || 3199);
// `next start` loads next.config.ts in a forked helper (it has an IPC channel); only fake in the server itself.
const isServer = typeof process.send !== "function";

if (isServer) {
  install();
  http
    .createServer(async (req, res) => {
      let body = "";
      for await (const c of req) body += c;
      const send = (v, status = 200) => {
        res.statusCode = status;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(v));
      };
      try {
        const v = JSON.parse(body || "{}");
        if (req.url === "/reset") {
          reset();
          return send({ ok: true });
        }
        if (req.url === "/set") {
          if (v.faults) Object.assign(fake.faults, v.faults);
          return send({ ok: true });
        }
        if (req.url === "/op") return send({ result: ops[v.name](...(v.args ?? [])) ?? null });
        if (req.url === "/state")
          return send({ tabs: fake.state.tabs, meta: fake.state.meta, files: [...fake.state.files.keys()], log: fake.log, faults: fake.faults });
        send({ error: "not found" }, 404);
      } catch (err) {
        send({ error: String(err) }, 500);
      }
    })
    .on("error", (e) => console.log(`[fake-google] control server not started in pid ${process.pid}: ${e.code}`))
    .listen(port, "127.0.0.1", () => console.log(`[fake-google] control server on ${port} (pid ${process.pid})`));
}
