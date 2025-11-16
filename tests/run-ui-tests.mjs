import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const TEST_URLS = [
  "http://127.0.0.1:8090/tests/ui/worldPanel.test.html",
  "http://127.0.0.1:8090/tests/ui/paintPanel.test.html",
];

function launchChrome(url, port) {
  const args = [
    "--headless",
    "--no-sandbox",
    "--disable-gpu",
    `--remote-debugging-port=${port}`,
    url,
  ];
  const proc = spawn("chromium", args, { stdio: "ignore" });
  return proc;
}

async function fetchWsUrl(port, retries = 50) {
  const remoteUrl = `http://127.0.0.1:${port}/json/list`;
  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      const response = await fetch(remoteUrl);
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
  const timeoutMs = 90000;
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

async function runTest(url, port) {
  const chrome = launchChrome(url, port);
  const shutdown = () => {
    if (chrome.exitCode === null) {
      chrome.kill("SIGKILL");
    }
  };
  try {
    const wsUrl = await fetchWsUrl(port);
    const devtools = await DevToolsConnection.connect(wsUrl);
    await devtools.send("Runtime.enable");
    await devtools.send("Log.enable");
    await waitForDocumentReady(devtools);
    const result = await waitForTestResult(devtools);
    shutdown();
    return result;
  } catch (error) {
    console.error(error.message);
    shutdown();
    return 1;
  }
}

(async () => {
  let exitCode = 0;
  for (let i = 0; i < TEST_URLS.length; i += 1) {
    const port = 9222 + i;
    const result = await runTest(TEST_URLS[i], port);
    if (result !== 0) {
      exitCode = result;
      break;
    }
    await delay(500);
  }
  process.exit(exitCode);
})();
