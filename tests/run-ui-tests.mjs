import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const TEST_URL = "http://127.0.0.1:8090/tests/ui/worldPanel.test.html";
const DEBUG_PORT = 9222;
const REMOTE_DEBUG_URL = `http://127.0.0.1:${DEBUG_PORT}/json/list`;

function launchChrome() {
  const args = [
    "--headless",
    "--no-sandbox",
    "--disable-gpu",
    `--remote-debugging-port=${DEBUG_PORT}`,
    TEST_URL,
  ];
  const proc = spawn("chromium", args, { stdio: "ignore" });
  return proc;
}

async function fetchWsUrl(retries = 50) {
  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      const response = await fetch(REMOTE_DEBUG_URL);
      if (response.ok) {
        const targets = await response.json();
        const page = targets.find((target) => target.type === "page");
        if (page && page.webSocketDebuggerUrl) {
          return page.webSocketDebuggerUrl;
        }
      }
    } catch (error) {
      // retry silently
    }
    await delay(100);
  }
  throw new Error("Konnte keine DevTools Verbindung herstellen");
}

class DevToolsConnection {
  constructor(ws) {
    this.ws = ws;
    this.cmdId = 0;
    this.pending = new Map();
  }

  static async connect(wsUrl) {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(wsUrl);
      const connection = new DevToolsConnection(socket);

      socket.onopen = () => resolve(connection);
      socket.onerror = (err) => reject(err);
      socket.onmessage = (event) => connection.handleMessage(event);
    });
  }

  handleMessage(event) {
    try {
      const data = JSON.parse(event.data);
      if (data.id && this.pending.has(data.id)) {
        const { resolve, reject } = this.pending.get(data.id);
        this.pending.delete(data.id);
        if (data.error) {
          reject(new Error(data.error.message));
        } else {
          resolve(data.result);
        }
        return;
      }
      if (data.method === "Runtime.consoleAPICalled") {
        const args = (data.params?.args || []).map((arg) => arg.value).join(" ");
        console.log(`[console] ${args}`);
      }
      if (data.method === "Runtime.exceptionThrown") {
        const details = data.params?.exceptionDetails;
        console.error(
          "[page error]",
          details?.text || "Unbekannter Fehler",
          details?.url || "",
          details?.lineNumber || "",
          details?.exception?.description || ""
        );
      }
    } catch (error) {
      // ignore malformed messages
    }
  }

  send(method, params = {}) {
    const id = ++this.cmdId;
    const payload = JSON.stringify({ id, method, params });
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(payload);
    });
  }
}

async function waitForDocumentReady(devtools) {
  const timeoutMs = 10000;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const result = await devtools.send("Runtime.evaluate", {
      expression: "document.readyState",
      returnByValue: true,
    });
    if (result.result && result.result.value === "complete") {
      return;
    }
    await delay(200);
  }
  throw new Error("Seite wurde nicht rechtzeitig geladen");
}

async function waitForTestResult(devtools) {
  const timeoutMs = 20000;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const evaluateResult = await devtools.send("Runtime.evaluate", {
      expression: "document.body.getAttribute('data-test-result')",
      returnByValue: true,
    });
    const value = evaluateResult.result ? evaluateResult.result.value : null;
    if (value !== null) {
      return parseInt(value, 10);
    }
    await delay(250);
  }
  throw new Error("Testergebnis nicht gefunden");
}

(async () => {
  const chrome = launchChrome();
  const shutdown = () => {
    if (chrome.exitCode === null) {
      chrome.kill("SIGKILL");
    }
  };
  process.on("exit", shutdown);
  process.on("SIGINT", () => {
    shutdown();
    process.exit(1);
  });

  try {
    const wsUrl = await fetchWsUrl();
    const devtools = await DevToolsConnection.connect(wsUrl);
    await devtools.send("Runtime.enable");
    await devtools.send("Log.enable");
    await waitForDocumentReady(devtools);
    const result = await waitForTestResult(devtools);
    shutdown();
    process.exit(result);
  } catch (error) {
    console.error(error.message);
    shutdown();
    process.exit(1);
  }
})();
