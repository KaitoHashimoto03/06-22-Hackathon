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

## HydraDB Demo

`hydradb-demo.html` is a visual walkthrough of the intended graph-memory layer.
It shows how sessions, postures, focus states, interventions, and feedback can
be stored as connected nodes so a wellness agent can recall what worked in a
similar situation before surfacing a suggestion.

The conceptual workflow is:

```text
01 Capture -> 02 Score risk -> 03 HydraDB Ingest -> 04 HydraDB Retrieve
-> 05 HydraDB Graph path -> 06 Decide -> 07 Surface -> 08 Learn
```

The reasoning path returned to the agent looks like:

```text
PostureEvent -> TRIGGERED -> Intervention -> RECEIVED -> Feedback
```

Open [hydradb-demo.html](./hydradb-demo.html) in any modern browser to see the
schema, relations, and memory flow.

## Notes

The MediaPipe pose model is stored at `assets/models/pose_landmarker_lite.task`
so demos do not need to download the model at runtime. Electron still uses
Chromium's `FaceDetector` when pose detection is unavailable. If neither pose
nor face detection is available, the app falls back to a rough on-device image
heuristic. That fallback is useful for demos, but the score is less reliable
than the pose model.
