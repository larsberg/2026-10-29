import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { defaultMeshSetup as defaultSetup, validateMeshSetup as validateSetup } from "../src/mesh-settings.js";

export function createSetupHandler(file, { defaults = defaultSetup, validate = validateSetup } = {}) {
  return async function handleSetup(req, res, next) {
    const route = req.url?.split("?")[0];
    if (route !== "/api/setup" && !(route === "/setup.json" && req.method === "GET")) return next();
    const send = (status, value) => {
      res.statusCode = status;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.end(JSON.stringify(value));
    };
    if (req.method === "GET") {
      try {
        send(200, validate(JSON.parse(await readFile(file, "utf8"))));
      } catch (error) {
        if (error.code === "ENOENT") send(200, defaults());
        else send(500, { error: "Could not read the saved setup. Check public/setup.json." });
      }
      return;
    }
    if (req.method !== "PUT") {
      res.setHeader("Allow", "GET, PUT");
      send(405, { error: "Use GET to load or PUT to save a setup." });
      return;
    }
    if (!req.headers["content-type"]?.toLowerCase().startsWith("application/json")) {
      send(415, { error: "Send the setup as application/json." });
      return;
    }
    // This local endpoint accepts writes only from its own browser origin.
    if (req.headers.origin) {
      let sameHost = false;
      try { sameHost = new URL(req.headers.origin).host === req.headers.host; } catch {}
      if (!sameHost) {
        send(403, { error: "Save settings from the sketch's own origin." });
        return;
      }
    }
    let setup;
    try {
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += Buffer.byteLength(chunk);
        if (size > 65_536) {
          send(413, { error: "Setup JSON is too large." });
          return;
        }
        chunks.push(Buffer.from(chunk));
      }
      setup = validate(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    } catch (error) {
      send(400, { error: error instanceof SyntaxError ? "Invalid JSON." : error.message });
      return;
    }
    const temporary = join(dirname(file), `.setup-${randomUUID()}.tmp`);
    try {
      await mkdir(dirname(file), { recursive: true });
      await writeFile(temporary, `${JSON.stringify(setup, null, 2)}\n`, "utf8");
      await rename(temporary, file);
      send(200, setup);
    } catch {
      await unlink(temporary).catch(() => {});
      send(500, { error: "Could not save the setup. Your current settings are unchanged." });
    }
  };
}

// Copy an existing composition once, without replacing any newer public save.
export async function ensurePublishedSetup(file, legacyFile, { defaults = defaultSetup, validate = validateSetup } = {}) {
  try { validate(JSON.parse(await readFile(file, "utf8"))); return; }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  let setup = defaults();
  if (legacyFile) {
    try { setup = validate(JSON.parse(await readFile(legacyFile, "utf8"))); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(setup, null, 2)}\n`, { flag: "wx" }).catch(error => {
    if (error.code !== "EEXIST") throw error;
  });
}

export function setupApiPlugin(file, legacyFile, schema) {
  const install = (server) => {
    server.middlewares.use(createSetupHandler(file, schema));
  };
  return { name: "mesh-sketch-setup-api", config: () => ensurePublishedSetup(file, legacyFile, schema), configureServer: install, configurePreviewServer: install };
}
