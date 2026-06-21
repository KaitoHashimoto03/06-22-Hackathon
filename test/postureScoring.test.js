const assert = require("node:assert/strict");
const { scorePosture, aggregateTrend, gradeForScore } = require("../src/postureScoring");

const frame = { width: 1280, height: 720 };

const centered = scorePosture({
  frame,
  face: { x: 520, y: 170, width: 240, height: 180, confidence: 0.95, rollDeg: 1, source: "face-detector" },
});
assert.equal(centered.grade, "great");
assert.ok(centered.score >= 85, `expected centered posture to score high, got ${centered.score}`);
assert.equal(centered.components.length, 10);
assert.equal(centered.score, centered.components.reduce((sum, component) => sum + component.score, 0));

const offCenter = scorePosture({
  frame,
  face: { x: 60, y: 170, width: 240, height: 180, confidence: 0.9, rollDeg: 1, source: "face-detector" },
});
assert.ok(offCenter.score < centered.score, "off-center posture should score below centered posture");
assert.match(offCenter.reasons.join(" "), /left|right/);

const reversedEyeOrderRoll = scorePosture({
  frame,
  face: { x: 520, y: 170, width: 240, height: 180, confidence: 0.95, rollDeg: 179, source: "mediapipe-pose" },
});
assert.equal(reversedEyeOrderRoll.components.find((component) => component.key === "headTilt").score, 10);

const tiltedPose = scorePosture({
  frame,
  face: { x: 520, y: 170, width: 240, height: 180, confidence: 0.95, rollDeg: 16, source: "mediapipe-pose" },
  pose: {
    nose: { x: 0.5, y: 0.3, visibility: 0.9 },
    leftShoulder: { x: 0.42, y: 0.62, visibility: 0.9 },
    rightShoulder: { x: 0.58, y: 0.76, visibility: 0.9 },
  },
});
assert.ok(tiltedPose.components.find((component) => component.key === "headTilt").score <= 2);
assert.ok(tiltedPose.components.find((component) => component.key === "shoulderLevel").score <= 2);

const focusedTooLong = scorePosture({
  frame,
  face: { x: 520, y: 170, width: 240, height: 180, confidence: 0.95, rollDeg: 1, source: "face-detector" },
  temporal: { focusDurationSec: 180, movementDelta: 0.001, previousScores: [92, 91, 90] },
});
assert.ok(focusedTooLong.score < centered.score, "long continuous focus should reduce the score");
assert.equal(focusedTooLong.components.find((component) => component.key === "focusDuration").score, 0);

const neckRisk = scorePosture({
  frame,
  face: { x: 470, y: 245, width: 340, height: 270, confidence: 0.95, rollDeg: 0, source: "mediapipe-pose" },
  pose: {
    nose: { x: 0.5, y: 0.47, visibility: 0.9 },
    leftShoulder: { x: 0.38, y: 0.64, visibility: 0.9 },
    rightShoulder: { x: 0.62, y: 0.64, visibility: 0.9 },
    worldNose: { z: -0.25 },
    worldLeftShoulder: { z: 0 },
    worldRightShoulder: { z: 0 },
  },
});
assert.ok(neckRisk.components.find((component) => component.key === "neckLoad").score <= 3);

const missing = scorePosture({ frame });
assert.equal(missing.score, 0);
assert.equal(missing.grade, "missing");

assert.equal(gradeForScore(90), "great");
assert.equal(gradeForScore(72), "steady");
assert.equal(gradeForScore(58), "watch");
assert.equal(gradeForScore(30), "reset");

const trend = aggregateTrend([{ score: 80 }, { score: 76 }, { score: 70 }]);
assert.equal(trend.direction, "down");
assert.equal(trend.average, 75);

console.log("postureScoring tests passed");
