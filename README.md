# Wellness Agent × HydraDB

An Electron-based wellness agent that **listens before it speaks** — grounded by HydraDB.

## Concept

A camera-based wellness agent runs quietly on your desktop. Once per minute it samples your posture from the webcam and combines that with desktop signals (active app, focus state, app-switch frequency). Instead of nagging on every signal, the agent stays silent by default and only surfaces a suggestion when it has a *grounded reason* to do so.

The grounding comes from **HydraDB**, a graph memory layer. Sessions, postures, focus states, interventions, and feedback are stored as connected nodes — so when the agent decides whether to speak, it can recall **what worked last time** in a similar situation, not just what happened. A reasoning path returned from the graph is passed to a Nebius LLM, which makes the final call: stay quiet, or suggest the intervention the user has previously found helpful.

## Workflow

One loop per minute:

```
01 Capture → 02 Score risk → 03 HydraDB Ingest → 04 HydraDB Retrieve
→ 05 HydraDB Graph path → 06 Decide → 07 Surface → 08 Learn
```

Steps 3–5 run inside HydraDB. The reasoning path returned to the agent looks like:

```
PostureEvent → TRIGGERED → Intervention → RECEIVED → Feedback
```

## Demo

A visual walkthrough of the HydraDB schema, the per-minute workflow, and how the graph grounds the agent's decisions is provided as a single-page demo:

[**hydradb-demo.html**](./hydradb-demo.html)

Open it in any modern browser to see the node types, relations, and how memory flows from the camera into HydraDB and back out as a reasoning path.
