const elements = {
  video: document.querySelector("#camera"),
  overlay: document.querySelector("#overlay"),
  timeline: document.querySelector("#timeline"),
  emptyState: document.querySelector("#emptyState"),
  cameraStatus: document.querySelector("#cameraStatus"),
  startCamera: document.querySelector("#startCamera"),
  captureNow: document.querySelector("#captureNow"),
  toggleAuto: document.querySelector("#toggleAuto"),
  intervalSeconds: document.querySelector("#intervalSeconds"),
  scoreValue: document.querySelector("#scoreValue"),
  scoreGrade: document.querySelector("#scoreGrade"),
  scoreReason: document.querySelector("#scoreReason"),
  metricFace: document.querySelector("#metricFace"),
  metricCenter: document.querySelector("#metricCenter"),
  metricDistance: document.querySelector("#metricDistance"),
  metricTilt: document.querySelector("#metricTilt"),
  scoreBreakdown: document.querySelector("#scoreBreakdown"),
  capturePreview: document.querySelector("#capturePreview"),
  captureTimestamp: document.querySelector("#captureTimestamp"),
  reviewNow: document.querySelector("#reviewNow"),
  reviewText: document.querySelector("#reviewText"),
  exportHistory: document.querySelector("#exportHistory"),
  clearHistory: document.querySelector("#clearHistory"),
};

const HISTORY_KEY = "posture-review-history:v2";
const MAX_HISTORY = 240;
const overlayContext = elements.overlay.getContext("2d");
const timelineContext = elements.timeline.getContext("2d");
const capturePreviewContext = elements.capturePreview.getContext("2d");
const fallbackDetectorCanvas = document.createElement("canvas");
const fallbackDetectorContext = fallbackDetectorCanvas.getContext("2d", { willReadFrequently: true });

let mediaStream = null;
let detector = null;
let poseLandmarker = null;
let poseStatus = "idle";
let latestFace = null;
let latestPose = null;
let latestEntry = null;
let captureTimer = null;
let autoRunning = false;
let focusRunStartedAt = null;
let history = loadHistory();

function loadHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveHistory() {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(-MAX_HISTORY)));
}

function setStatus(text) {
  elements.cameraStatus.textContent = text;
}

async function startCamera() {
  setStatus("Requesting camera");
  if (window.postureDesktop?.requestCameraAccess) {
    const allowed = await window.postureDesktop.requestCameraAccess();
    if (!allowed) throw new Error("Camera permission was not granted.");
  }
  mediaStream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: "user",
      width: { ideal: 1280 },
      height: { ideal: 720 },
    },
    audio: false,
  });
  elements.video.srcObject = mediaStream;
  await elements.video.play();
  elements.emptyState.hidden = true;
  elements.captureNow.disabled = false;
  elements.toggleAuto.disabled = false;
  setStatus("Camera active");

  if ("FaceDetector" in window) {
    detector = new FaceDetector({ fastMode: true, maxDetectedFaces: 1 });
  } else {
    detector = null;
    setStatus("Camera active, approximate detector");
  }

  initPoseLandmarker();
  resizeCanvases();
  requestAnimationFrame(drawOverlayLoop);
}

async function initPoseLandmarker() {
  if (poseLandmarker || poseStatus === "loading") return;
  poseStatus = "loading";
  setStatus("Loading pose model");
  try {
    const { FilesetResolver, PoseLandmarker } = await import("../node_modules/@mediapipe/tasks-vision/vision_bundle.mjs");
    const wasmRoot = new URL("../node_modules/@mediapipe/tasks-vision/wasm", window.location.href).href;
    const modelAssetPath = new URL("../assets/models/pose_landmarker_lite.task", window.location.href).href;
    const vision = await FilesetResolver.forVisionTasks(wasmRoot);
    poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath,
        delegate: "GPU",
      },
      runningMode: "VIDEO",
      numPoses: 1,
      minPoseDetectionConfidence: 0.35,
      minPosePresenceConfidence: 0.35,
      minTrackingConfidence: 0.35,
    });
    poseStatus = "ready";
    setStatus("Camera active, pose ready");
  } catch (error) {
    console.warn(error);
    poseStatus = "fallback";
    setStatus("Camera active, face fallback");
  }
}

function resizeCanvases() {
  const videoRect = elements.video.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  for (const canvas of [elements.overlay, elements.timeline]) {
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(rect.width * ratio));
    canvas.height = Math.max(1, Math.round(rect.height * ratio));
  }
  overlayContext.setTransform(ratio, 0, 0, ratio, 0, 0);
  timelineContext.setTransform(ratio, 0, 0, ratio, 0, 0);
  if (videoRect.width > 0) drawTimeline();
}

function normalizedVideoBox(face) {
  if (!face?.boundingBox) return null;
  const box = face.boundingBox;
  return {
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    confidence: 0.82,
    rollDeg: rollFromLandmarks(face.landmarks),
    source: "face-detector",
  };
}

function rollFromLandmarks(landmarks) {
  if (!Array.isArray(landmarks)) return null;
  const eyeCandidates = landmarks.filter((landmark) => String(landmark.type || "").includes("eye"));
  if (eyeCandidates.length < 2) return null;
  const [a, b] = eyeCandidates;
  const pa = Array.isArray(a.locations) ? a.locations[0] : a;
  const pb = Array.isArray(b.locations) ? b.locations[0] : b;
  if (!pa || !pb) return null;
  return horizontalTiltDeg(pa, pb);
}

function horizontalTiltDeg(a, b) {
  if (!a || !b) return null;
  return normalizeRollDeg(Math.atan2(b.y - a.y, b.x - a.x) * (180 / Math.PI));
}

function normalizeRollDeg(value) {
  if (!Number.isFinite(Number(value))) return null;
  return ((((Number(value) + 90) % 180) + 180) % 180) - 90;
}

async function detectFace() {
  if (elements.video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return null;
  if (!detector) return detectFaceFallback();
  try {
    const faces = await detector.detect(elements.video);
    return faces.length > 0 ? normalizedVideoBox(faces[0]) : detectFaceFallback();
  } catch (error) {
    console.warn(error);
    detector = null;
    setStatus("Approximate detector");
    return detectFaceFallback();
  }
}

function detectFaceFallback() {
  const videoWidth = elements.video.videoWidth;
  const videoHeight = elements.video.videoHeight;
  if (!videoWidth || !videoHeight) return null;

  const sampleWidth = 160;
  const sampleHeight = Math.round((videoHeight / videoWidth) * sampleWidth);
  fallbackDetectorCanvas.width = sampleWidth;
  fallbackDetectorCanvas.height = sampleHeight;
  fallbackDetectorContext.drawImage(elements.video, 0, 0, sampleWidth, sampleHeight);
  const data = fallbackDetectorContext.getImageData(0, 0, sampleWidth, sampleHeight).data;

  let minX = sampleWidth;
  let minY = sampleHeight;
  let maxX = 0;
  let maxY = 0;
  let count = 0;
  const yLimit = Math.round(sampleHeight * 0.72);

  for (let y = 0; y < yLimit; y += 1) {
    for (let x = 0; x < sampleWidth; x += 1) {
      const index = (y * sampleWidth + x) * 4;
      if (!isSkinLike(data[index], data[index + 1], data[index + 2])) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      count += 1;
    }
  }

  if (count < 45 || minX >= maxX || minY >= maxY) return null;
  const boxWidth = maxX - minX + 1;
  const boxHeight = maxY - minY + 1;
  const density = count / Math.max(1, boxWidth * boxHeight);
  if (density < 0.08) return null;

  const expandX = boxWidth * 0.18;
  const expandTop = boxHeight * 0.1;
  const expandBottom = boxHeight * 0.32;
  const scaleX = videoWidth / sampleWidth;
  const scaleY = videoHeight / sampleHeight;

  return {
    x: Math.max(0, (minX - expandX) * scaleX),
    y: Math.max(0, (minY - expandTop) * scaleY),
    width: Math.min(videoWidth, (boxWidth + expandX * 2) * scaleX),
    height: Math.min(videoHeight, (boxHeight + expandTop + expandBottom) * scaleY),
    confidence: Math.min(0.68, Math.max(0.38, density)),
    rollDeg: null,
    source: "approximate",
  };
}

function isSkinLike(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max < 45 || max - min < 12) return false;

  const y = 0.299 * r + 0.587 * g + 0.114 * b;
  const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
  const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
  return y > 45 && cb >= 70 && cb <= 138 && cr >= 125 && cr <= 182 && r > b * 0.86;
}

function detectPose() {
  if (!poseLandmarker || elements.video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return null;
  try {
    const result = poseLandmarker.detectForVideo(elements.video, performance.now());
    const landmarks = result?.landmarks?.[0] || null;
    const worldLandmarks = result?.worldLandmarks?.[0] || null;
    return landmarks ? normalizePose(landmarks, worldLandmarks) : null;
  } catch (error) {
    console.warn(error);
    poseStatus = "fallback";
    return null;
  }
}

function normalizePose(landmarks, worldLandmarks) {
  const get = (index) => landmarks[index] || null;
  const getWorld = (index) => worldLandmarks?.[index] || null;
  return {
    source: "mediapipe-pose",
    landmarks,
    worldLandmarks,
    nose: get(0),
    leftEye: get(2),
    rightEye: get(5),
    leftEar: get(7),
    rightEar: get(8),
    leftShoulder: get(11),
    rightShoulder: get(12),
    worldNose: getWorld(0),
    worldLeftShoulder: getWorld(11),
    worldRightShoulder: getWorld(12),
  };
}

async function capturePosture({ withReview = true } = {}) {
  const frame = {
    width: elements.video.videoWidth || 1280,
    height: elements.video.videoHeight || 720,
  };
  const pose = detectPose();
  const face = pose ? faceFromPose(pose, frame) : await detectFace();
  latestFace = face;
  latestPose = pose;
  const temporal = buildTemporalContext({ face, pose, frame });
  const result = PostureScoring.scorePosture({ frame, face, pose, temporal });
  latestEntry = {
    capturedAt: new Date().toISOString(),
    poseSignal: signalFromPose(face, pose, frame),
    ...result,
  };
  history.push(latestEntry);
  history = history.slice(-MAX_HISTORY);
  saveHistory();
  renderLatest(latestEntry);
  drawCapturePreview(face, frame, latestEntry);
  drawTimeline();
  updateHistoryButtons();
  if (withReview) await updateReview();
  return latestEntry;
}

function faceFromPose(pose, frame) {
  const points = [pose.nose, pose.leftEye, pose.rightEye, pose.leftEar, pose.rightEar].filter(isVisibleLandmark);
  if (points.length < 3) return null;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const width = Math.max(0.12, (maxX - minX) * 1.85);
  const height = Math.max(0.16, (maxY - minY) * 2.35);
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  return {
    x: (centerX - width / 2) * frame.width,
    y: (centerY - height / 2) * frame.height,
    width: width * frame.width,
    height: height * frame.height,
    confidence: averageVisibility(points),
    rollDeg: rollFromPose(pose),
    source: "mediapipe-pose",
  };
}

function rollFromPose(pose) {
  const left = isVisibleLandmark(pose.leftEye) ? pose.leftEye : pose.leftEar;
  const right = isVisibleLandmark(pose.rightEye) ? pose.rightEye : pose.rightEar;
  if (!isVisibleLandmark(left) || !isVisibleLandmark(right)) return null;
  return horizontalTiltDeg(left, right);
}

function isVisibleLandmark(point) {
  return Boolean(point && Number.isFinite(point.x) && Number.isFinite(point.y) && (point.visibility == null || point.visibility >= 0.25));
}

function averageVisibility(points) {
  const visible = points.map((point) => point.visibility).filter(Number.isFinite);
  if (visible.length === 0) return 0.85;
  return visible.reduce((sum, value) => sum + value, 0) / visible.length;
}

function buildTemporalContext({ face, pose, frame }) {
  const nowMs = Date.now();
  const looking = isCameraFacing({ face, pose, frame });
  if (looking) {
    if (!focusRunStartedAt) focusRunStartedAt = nowMs;
  } else {
    focusRunStartedAt = null;
  }
  return {
    focusDurationSec: focusRunStartedAt ? (nowMs - focusRunStartedAt) / 1000 : 0,
    movementDelta: movementDeltaFromHistory(face, pose, frame),
    previousScores: history.map((entry) => entry.score).filter(Number.isFinite).slice(-8),
  };
}

function isCameraFacing({ face, pose, frame }) {
  if (!face || !frame.width || !frame.height) return false;
  const centerX = (face.x + face.width / 2) / frame.width;
  const centerY = (face.y + face.height / 2) / frame.height;
  const centered = centerX >= 0.34 && centerX <= 0.66 && centerY >= 0.16 && centerY <= 0.66;
  if (!pose) return centered;
  return centered && isVisibleLandmark(pose.nose);
}

function movementDeltaFromHistory(face, pose, frame) {
  const current = signalFromPose(face, pose, frame);
  const recent = history.slice(-5).map((entry) => entry.poseSignal).filter(Boolean);
  if (!current || recent.length === 0) return null;
  const average = recent.reduce(
    (sum, signal) => ({
      x: sum.x + signal.x,
      y: sum.y + signal.y,
      h: sum.h + signal.h,
      shoulder: sum.shoulder + (signal.shoulder ?? current.shoulder ?? 0),
    }),
    { x: 0, y: 0, h: 0, shoulder: 0 },
  );
  average.x /= recent.length;
  average.y /= recent.length;
  average.h /= recent.length;
  average.shoulder /= recent.length;
  return Math.hypot(
    (current.x - average.x) * 1.7,
    (current.y - average.y) * 1.4,
    (current.h - average.h) * 1.8,
    ((current.shoulder ?? 0) - average.shoulder) * 1.2,
  );
}

function signalFromPose(face, pose, frame) {
  if (!face || !frame.width || !frame.height) return null;
  return {
    x: (face.x + face.width / 2) / frame.width,
    y: (face.y + face.height / 2) / frame.height,
    h: face.height / frame.height,
    shoulder: poseShoulderSlope(pose),
  };
}

function poseShoulderSlope(pose) {
  if (!pose || !isVisibleLandmark(pose.leftShoulder) || !isVisibleLandmark(pose.rightShoulder)) return null;
  return pose.rightShoulder.y - pose.leftShoulder.y;
}

function renderLatest(entry) {
  elements.scoreValue.textContent = String(entry.score);
  elements.scoreGrade.textContent = entry.grade;
  elements.scoreReason.textContent = entry.reasons[0] || "No reason available.";
  elements.metricFace.textContent = entry.metrics.detectionSource === "mediapipe-pose" ? "Pose" : "Face";
  elements.metricCenter.textContent = percent(entry.metrics.centered);
  elements.metricDistance.textContent = percent(entry.metrics.distance);
  elements.metricTilt.textContent = entry.metrics.headLevel == null ? "n/a" : percent(entry.metrics.headLevel);
  renderBreakdown(entry.components || []);
  elements.reviewNow.disabled = false;
}

function renderBreakdown(components) {
  elements.scoreBreakdown.innerHTML = "";
  for (const component of components) {
    const row = document.createElement("div");
    row.className = "breakdown-row";
    row.dataset.scoreLow = component.score <= 4 ? "true" : "false";
    row.dataset.scoreMid = component.score > 4 && component.score <= 7 ? "true" : "false";
    row.title = component.help || "";

    const label = document.createElement("span");
    label.textContent = component.label;
    const track = document.createElement("span");
    track.className = "breakdown-track";
    const fill = document.createElement("span");
    fill.className = "breakdown-fill";
    fill.style.width = `${component.score * 10}%`;
    track.append(fill);
    const score = document.createElement("strong");
    score.textContent = `${component.score}/10`;

    row.append(label, track, score);
    elements.scoreBreakdown.append(row);
  }
}

function drawCapturePreview(face, frame, entry) {
  const canvas = elements.capturePreview;
  const ctx = capturePreviewContext;
  const targetWidth = 640;
  const targetHeight = Math.max(240, Math.round(targetWidth * (frame.height / frame.width || 9 / 16)));
  canvas.width = targetWidth;
  canvas.height = targetHeight;

  ctx.save();
  ctx.translate(targetWidth, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(elements.video, 0, 0, targetWidth, targetHeight);
  ctx.restore();

  ctx.strokeStyle = "rgba(255,255,255,0.45)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(targetWidth / 2, 0);
  ctx.lineTo(targetWidth / 2, targetHeight);
  ctx.stroke();

  if (face) {
    const scaleX = targetWidth / frame.width;
    const scaleY = targetHeight / frame.height;
    const mirroredX = targetWidth - (face.x + face.width) * scaleX;
    const y = face.y * scaleY;
    const width = face.width * scaleX;
    const height = face.height * scaleY;
    const centerX = mirroredX + width / 2;
    const centerY = y + height / 2;

    ctx.strokeStyle = entry.score >= 70 ? "#66c18c" : entry.score >= 55 ? "#f0b05b" : "#e36b61";
    ctx.lineWidth = 4;
    ctx.strokeRect(mirroredX, y, width, height);

    ctx.fillStyle = ctx.strokeStyle;
    ctx.beginPath();
    ctx.arc(centerX, centerY, 6, 0, Math.PI * 2);
    ctx.fill();
  }
  if (latestPose) drawPoseSkeleton(ctx, latestPose, targetWidth, targetHeight);

  ctx.fillStyle = "rgba(21,27,28,0.78)";
  ctx.fillRect(12, 12, 178, 54);
  ctx.fillStyle = "#ffffff";
  ctx.font = "700 24px system-ui";
  ctx.fillText(`Score ${entry.score}`, 24, 45);
  ctx.font = "12px system-ui";
  ctx.fillText(latestPose ? "Pose frame used for scoring" : face ? "Face frame used for scoring" : "No face detected", 24, 61);

  elements.captureTimestamp.textContent = new Date(entry.capturedAt).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function drawPoseSkeleton(ctx, pose, width, height) {
  const pairs = [
    ["leftEar", "leftShoulder"],
    ["rightEar", "rightShoulder"],
    ["leftShoulder", "rightShoulder"],
    ["nose", "leftEye"],
    ["nose", "rightEye"],
    ["leftEye", "leftEar"],
    ["rightEye", "rightEar"],
  ];
  ctx.save();
  ctx.strokeStyle = "#4fc3a1";
  ctx.fillStyle = "#4fc3a1";
  ctx.lineWidth = 3;
  for (const [from, to] of pairs) {
    const a = pose[from];
    const b = pose[to];
    if (!isVisibleLandmark(a) || !isVisibleLandmark(b)) continue;
    ctx.beginPath();
    ctx.moveTo(width - a.x * width, a.y * height);
    ctx.lineTo(width - b.x * width, b.y * height);
    ctx.stroke();
  }
  for (const point of [pose.nose, pose.leftEye, pose.rightEye, pose.leftEar, pose.rightEar, pose.leftShoulder, pose.rightShoulder]) {
    if (!isVisibleLandmark(point)) continue;
    ctx.beginPath();
    ctx.arc(width - point.x * width, point.y * height, 5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function clearCapturePreview() {
  const canvas = elements.capturePreview;
  const ctx = capturePreviewContext;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#151b1c";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "rgba(255,255,255,0.72)";
  ctx.font = "16px system-ui";
  ctx.fillText("No captured frame yet.", 24, 42);
  elements.captureTimestamp.textContent = "waiting";
}

function percent(value) {
  if (value == null || !Number.isFinite(value)) return "--";
  return `${Math.round(value * 100)}%`;
}

async function updateReview() {
  const trend = PostureScoring.aggregateTrend(history);
  const localText = LocalReview.buildLocalReview(latestEntry, trend);
  elements.reviewText.textContent = localText;

  if (!window.postureDesktop?.requestReview) return;
  const response = await window.postureDesktop.requestReview({
    latest: latestEntry,
    recent: history.slice(-8),
  });
  if (response?.text) {
    elements.reviewText.textContent = response.text;
  } else if (response?.error) {
    elements.reviewText.textContent = `${localText}\n\nLLM review skipped: ${response.error}`;
  }
}

function toggleAutoLoop() {
  if (autoRunning) {
    stopAutoLoop();
    return;
  }
  autoRunning = true;
  elements.toggleAuto.textContent = "Stop auto loop";
  scheduleNextCapture(0);
}

function stopAutoLoop() {
  autoRunning = false;
  elements.toggleAuto.textContent = "Start auto loop";
  if (captureTimer) clearTimeout(captureTimer);
  captureTimer = null;
}

function scheduleNextCapture(delayMs = intervalMs()) {
  if (!autoRunning) return;
  if (captureTimer) clearTimeout(captureTimer);
  captureTimer = setTimeout(async () => {
    await capturePosture({ withReview: true });
    scheduleNextCapture();
  }, delayMs);
}

function intervalMs() {
  const seconds = Number(elements.intervalSeconds.value || 3);
  return Math.max(1, seconds) * 1000;
}

function drawOverlayLoop() {
  drawOverlay();
  requestAnimationFrame(drawOverlayLoop);
}

function drawOverlay() {
  const rect = elements.overlay.getBoundingClientRect();
  overlayContext.clearRect(0, 0, rect.width, rect.height);
  if (!latestFace || !elements.video.videoWidth || !elements.video.videoHeight) return;

  const scaleX = rect.width / elements.video.videoWidth;
  const scaleY = rect.height / elements.video.videoHeight;
  const mirroredX = rect.width - (latestFace.x + latestFace.width) * scaleX;
  const y = latestFace.y * scaleY;
  const width = latestFace.width * scaleX;
  const height = latestFace.height * scaleY;

  overlayContext.strokeStyle = latestEntry?.score >= 70 ? "#66c18c" : latestEntry?.score >= 55 ? "#f0b05b" : "#e36b61";
  overlayContext.lineWidth = 3;
  overlayContext.strokeRect(mirroredX, y, width, height);
  if (latestPose) drawPoseSkeleton(overlayContext, latestPose, rect.width, rect.height);

  overlayContext.beginPath();
  overlayContext.moveTo(rect.width / 2, 0);
  overlayContext.lineTo(rect.width / 2, rect.height);
  overlayContext.strokeStyle = "rgba(255,255,255,0.28)";
  overlayContext.lineWidth = 1;
  overlayContext.stroke();
}

function drawTimeline() {
  const canvas = elements.timeline;
  const rect = canvas.getBoundingClientRect();
  timelineContext.clearRect(0, 0, rect.width, rect.height);
  timelineContext.fillStyle = "#fbfaf5";
  timelineContext.fillRect(0, 0, rect.width, rect.height);

  const padding = { top: 18, right: 18, bottom: 26, left: 34 };
  const width = rect.width - padding.left - padding.right;
  const height = rect.height - padding.top - padding.bottom;

  timelineContext.strokeStyle = "#d9d2c3";
  timelineContext.lineWidth = 1;
  for (const score of [0, 25, 50, 75, 100]) {
    const y = padding.top + height - (score / 100) * height;
    timelineContext.beginPath();
    timelineContext.moveTo(padding.left, y);
    timelineContext.lineTo(padding.left + width, y);
    timelineContext.stroke();
    timelineContext.fillStyle = "#66706c";
    timelineContext.font = "12px system-ui";
    timelineContext.fillText(String(score), 8, y + 4);
  }

  const samples = history.slice(-48);
  if (samples.length === 0) {
    timelineContext.fillStyle = "#66706c";
    timelineContext.font = "14px system-ui";
    timelineContext.fillText("No posture captures yet.", padding.left, padding.top + 34);
    return;
  }

  const xFor = (index) => padding.left + (samples.length === 1 ? width : (index / (samples.length - 1)) * width);
  const yFor = (score) => padding.top + height - (score / 100) * height;

  timelineContext.beginPath();
  samples.forEach((entry, index) => {
    const x = xFor(index);
    const y = yFor(entry.score);
    if (index === 0) timelineContext.moveTo(x, y);
    else timelineContext.lineTo(x, y);
  });
  timelineContext.strokeStyle = "#345d9d";
  timelineContext.lineWidth = 3;
  timelineContext.stroke();

  for (const [index, entry] of samples.entries()) {
    const x = xFor(index);
    const y = yFor(entry.score);
    timelineContext.beginPath();
    timelineContext.arc(x, y, 4, 0, Math.PI * 2);
    timelineContext.fillStyle = entry.score >= 70 ? "#2f7d5a" : entry.score >= 55 ? "#b86421" : "#ad3d35";
    timelineContext.fill();
  }
}

function updateHistoryButtons() {
  const hasHistory = history.length > 0;
  elements.exportHistory.disabled = !hasHistory;
  elements.clearHistory.disabled = !hasHistory;
}

async function exportHistory() {
  if (!window.postureDesktop?.exportHistory) return;
  const result = await window.postureDesktop.exportHistory(history);
  if (result?.filePath) {
    setStatus("History exported");
    await window.postureDesktop.openPath(result.filePath);
  }
}

function clearHistory() {
  history = [];
  latestEntry = null;
  latestFace = null;
  latestPose = null;
  focusRunStartedAt = null;
  saveHistory();
  elements.scoreValue.textContent = "--";
  elements.scoreGrade.textContent = "waiting";
  elements.scoreReason.textContent = "No capture yet.";
  elements.metricFace.textContent = "--";
  elements.metricCenter.textContent = "--";
  elements.metricDistance.textContent = "--";
  elements.metricTilt.textContent = "--";
  elements.scoreBreakdown.innerHTML = "";
  clearCapturePreview();
  elements.reviewText.textContent = "Capture posture data and I will review the trend.";
  elements.reviewNow.disabled = true;
  updateHistoryButtons();
  drawTimeline();
}

elements.startCamera.addEventListener("click", () => {
  startCamera().catch((error) => {
    console.error(error);
    setStatus("Camera failed");
    elements.emptyState.querySelector("span").textContent = error.message;
  });
});
elements.captureNow.addEventListener("click", () => capturePosture({ withReview: true }));
elements.toggleAuto.addEventListener("click", toggleAutoLoop);
elements.reviewNow.addEventListener("click", updateReview);
elements.exportHistory.addEventListener("click", exportHistory);
elements.clearHistory.addEventListener("click", clearHistory);
window.addEventListener("resize", resizeCanvases);

if (history.length > 0) {
  latestEntry = history.at(-1);
  renderLatest(latestEntry);
}
updateHistoryButtons();
resizeCanvases();
clearCapturePreview();
