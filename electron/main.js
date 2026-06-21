const { app, BrowserWindow, dialog, ipcMain, shell, systemPreferences } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const OUTPUT_DIR = path.join(ROOT, "outputs");
const REVIEW_API_URL = process.env.POSTURE_REVIEW_API_URL || buildOpenAiChatCompletionsUrl();
const REVIEW_MODEL = process.env.POSTURE_REVIEW_MODEL || process.env.OPENAI_MODEL || "";
const REVIEW_API_KEY = process.env.POSTURE_REVIEW_API_KEY || process.env.OPENAI_API_KEY || "";

let mainWindow = null;

app.commandLine.appendSwitch("enable-features", "FaceDetection");

function buildOpenAiChatCompletionsUrl() {
  const baseUrl = (process.env.OPENAI_BASE_URL || "").replace(/\/+$/, "");
  if (!baseUrl) return "";
  if (baseUrl.endsWith("/v1")) return `${baseUrl}/chat/completions`;
  return `${baseUrl}/v1/chat/completions`;
}

async function requestCameraAccess() {
  if (process.platform !== "darwin") return true;
  try {
    return await systemPreferences.askForMediaAccess("camera");
  } catch (error) {
    console.warn(`[camera] permission check failed: ${error.message}`);
    return false;
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 1060,
    minHeight: 720,
    title: "Posture Review",
    backgroundColor: "#f6f2e8",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  mainWindow.loadFile(path.join(ROOT, "src", "index.html"));
}

function summarizeReviewInput(payload) {
  const recent = Array.isArray(payload.recent) ? payload.recent.slice(-8) : [];
  const latest = payload.latest || recent.at(-1) || null;
  return {
    latest,
    recent: recent.map((entry) => ({
      capturedAt: entry.capturedAt,
      score: entry.score,
      grade: entry.grade,
      reasons: entry.reasons,
      metrics: entry.metrics,
    })),
  };
}

async function requestCloudReview(payload) {
  if (!REVIEW_API_URL || !REVIEW_MODEL || !REVIEW_API_KEY) {
    return null;
  }

  const safePayload = summarizeReviewInput(payload);
  const response = await fetch(REVIEW_API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${REVIEW_API_KEY}`,
    },
    body: JSON.stringify({
      model: REVIEW_MODEL,
      messages: [
        {
          role: "system",
          content:
            "You are a concise desk posture coach. Use only the numeric posture score history. Do not diagnose medical conditions. Return practical, non-alarmist advice in Japanese.",
        },
        {
          role: "user",
          content: JSON.stringify(safePayload),
        },
      ],
      temperature: 0.4,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`review API failed: ${response.status} ${body.slice(0, 300)}`);
  }

  const data = await response.json();
  const text = data?.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("review API returned an empty message");
  return {
    source: "llm",
    text,
  };
}

async function exportHistory(_event, history) {
  if (!Array.isArray(history)) {
    throw new Error("history must be an array");
  }
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  const filePath = path.join(OUTPUT_DIR, `posture-history-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  await fs.writeFile(filePath, `${JSON.stringify(history, null, 2)}\n`, "utf8");
  return { filePath };
}

app.whenReady().then(async () => {
  app.on("web-contents-created", (_event, contents) => {
    contents.session.setPermissionRequestHandler((_webContents, permission, callback) => {
      callback(permission === "media");
    });
  });

  ipcMain.handle("posture:request-camera-access", requestCameraAccess);

  ipcMain.handle("posture:review", async (_event, payload) => {
    try {
      return await requestCloudReview(payload);
    } catch (error) {
      console.warn(`[review] cloud review failed: ${error.message}`);
      return {
        source: "local-after-llm-error",
        text: "",
        error: error.message,
      };
    }
  });

  ipcMain.handle("posture:export-history", exportHistory);

  ipcMain.handle("posture:open-path", async (_event, filePath) => {
    if (!filePath || typeof filePath !== "string") return false;
    await shell.showItemInFolder(filePath);
    return true;
  });

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

process.on("uncaughtException", (error) => {
  console.error(error);
  dialog.showErrorBox("Posture Review crashed", error.stack || error.message);
});
