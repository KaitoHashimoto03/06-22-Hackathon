# Wellness Agent Desktop

Electron desktop app for a MacBook-camera wellness loop, plus a HydraDB workflow
demo page.

The current desktop app can:

- open the webcam in an Electron desktop app
- capture posture snapshots manually or every 3 seconds by default
- run MediaPipe Pose Landmarker when available, with face detection as fallback
- score the frame as 10 visible indicators worth 10 points each
- show the captured frame used for scoring with the pose skeleton, detection box, and center guide
- show score history in a canvas timeline
- generate a review from a local heuristic, or from an OpenAI-compatible chat endpoint when configured
- export history JSON into `outputs/`

This is a work posture helper, not a medical posture diagnosis.

## Run

```bash
cd /Users/keisuke.a.takiguchi/Workspace/Personal/hackason-dev
npm install
npm start
```

macOS will ask for camera permission when you press `Start camera`.

## Checks

```bash
npm run check
npm test
```

`npm test` does not require Electron or camera access.

## Posture Score

The score is always an integer from 0 to 100. It is the sum of 10 indicators,
each scored from 0 to 10:

- Face visible
- Shoulder line
- Horizontal center
- Head height
- Camera distance
- Head tilt
- Neck load
- Screen focus
- Movement
- Recent trend

The app assumes a built-in front camera where only the shoulders and head are
usually visible. MediaPipe Pose Landmarker provides nose, eyes, ears, and
shoulder landmarks when it can. If pose detection fails, the app falls back to
face detection or an approximate on-device image heuristic.

Straight-neck risk is an approximation, not a medical diagnosis. It is inferred
from signals that are visible from the built-in camera: the head being low,
too close to the camera, or forward relative to the shoulders when MediaPipe
world landmarks are available.

## LLM Review

By default the app uses a local review function and sends no image data outside
the machine.

To enable an OpenAI-compatible chat review, set all of these:

```bash
export OPENAI_BASE_URL="https://api.openai.com/v1"
export OPENAI_API_KEY="..."
export OPENAI_MODEL="your-chat-model"
npm start
```

You can also use app-specific names:

```bash
export POSTURE_REVIEW_API_URL="http://127.0.0.1:8080/v1/chat/completions"
export POSTURE_REVIEW_API_KEY="..."
export POSTURE_REVIEW_MODEL="..."
npm start
```

Only numeric score data and posture reasons are sent to the review API. Webcam
frames are not sent.

## HydraDB-grounded Wellness Loop

A second mode of this app frames the posture loop around an external
graph-memory layer (**HydraDB**). The desktop agent **listens before it
speaks**: it samples the camera + desktop signals once a minute, writes them
into HydraDB as a graph, and only surfaces a suggestion when HydraDB can
return an intervention that already worked for this user.

### Workflow — one loop per minute

Steps **3–5 run inside HydraDB**.

![Workflow](./workflow.svg)

| Step | Where | What |
| :--- | :---- | :--- |
| 01 Capture | local | camera frame + active app + focus signals |
| 02 Score risk | local | posture indicators → integer score |
| **03 Ingest** | **HydraDB** | append nodes for posture / app / focus to this session |
| **04 Retrieve** | **HydraDB** | pull similar past sessions + their interventions |
| **05 Graph path** | **HydraDB** | return one reasoning path the agent can cite |
| 06 Decide | LLM | stay silent, or pick the intervention from the path |
| 07 Surface | UI | grounded suggestion (or "you're in flow") |
| 08 Learn | HydraDB | feedback edge written back, ready for next loop |

### Posture scoring in action — what steps 01–02 look like

The clip below is the camera + pose-estimation step running on a MacBook.
The visible overlay (face / shoulder landmarks) is what the agent *sees*;
in the background each frame is silently turned into the **10 posture
indicators** described in the [Posture Score](#posture-score) section
above and reduced to one integer in `0–100`. That score, plus the active
app and focus signals, is what gets pushed into HydraDB at step **03
Ingest** every minute.

https://github.com/user-attachments/assets/c6168629-4de0-42fe-adff-1f9e8029a6da

Nothing in this clip is sent to a server: the score is computed on-device
and only the numeric score + reasons leave the machine (and only when an
LLM review endpoint is configured — see [LLM Review](#llm-review)).

### Where HydraDB is used — schema and memory flow

Memory is a **graph, not a log**. Sessions connect apps, postures, focus,
interventions and feedback, so the agent can recall *what worked last time*
instead of replaying *what happened*.

![HydraDB graph schema](./hydradb-graph.svg)

Inputs into HydraDB each minute:

- `posture frame` — score + neck/shoulder angles from the camera loop
- `active_app` — current foreground app and its category
- `focus signals` — focus trend, window-switch rate

Outputs HydraDB hands back to the agent:

- `similar past cases` — sessions with the same posture + app context
- `graph context` — connected session / app / intervention nodes
- `previous feedback` — what *this* user accepted before
- `reasoning path` — one explainable chain the LLM grounds its reply in

The reasoning path returned to the agent:

```text
PostureEvent → TRIGGERED → Intervention → RECEIVED → Feedback
```

### Detailed visual deck

[`hydradb-demo.html`](./hydradb-demo.html) is the full single-page deck
(hero, workflow strip, graph, behavior cards, and a 4-beat demo timeline).
Download and open it in a browser for the styled version — the diagrams
above are extracted from it.

## Notes

The MediaPipe pose model is stored at `assets/models/pose_landmarker_lite.task`
so demos do not need to download the model at runtime. Electron still uses
Chromium's `FaceDetector` when pose detection is unavailable. If neither pose
nor face detection is available, the app falls back to a rough on-device image
heuristic. That fallback is useful for demos, but the score is less reliable
than the pose model.
