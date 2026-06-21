(function attachPostureScoring(root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.PostureScoring = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function createPostureScoring() {
  const COMPONENTS = [
    {
      key: "detection",
      label: "Face visible",
      help: "顔が安定して検出できているか",
    },
    {
      key: "shoulderLevel",
      label: "Shoulder line",
      help: "肩ラインが水平に近いか",
    },
    {
      key: "horizontalCenter",
      label: "Horizontal center",
      help: "顔が左右中央に近いか",
    },
    {
      key: "verticalPosition",
      label: "Head height",
      help: "顔の高さが内側カメラ向けの自然な位置か",
    },
    {
      key: "cameraDistance",
      label: "Camera distance",
      help: "画面に近づきすぎたり離れすぎたりしていないか",
    },
    {
      key: "headTilt",
      label: "Head tilt",
      help: "頭が左右に傾いていないか",
    },
    {
      key: "neckLoad",
      label: "Neck load",
      help: "ストレートネック気味の近づき・落ち込みがないか",
    },
    {
      key: "focusDuration",
      label: "Screen focus",
      help: "画面を見続けている時間が長すぎないか",
    },
    {
      key: "movementVariety",
      label: "Movement",
      help: "同じ姿勢で固まりすぎていないか",
    },
    {
      key: "recentTrend",
      label: "Recent trend",
      help: "直近の姿勢スコアから悪化していないか",
    },
  ];

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const round = (value, digits = 3) => Number(value.toFixed(digits));
  const toPoints = (unit) => clamp(Math.round(clamp(unit, 0, 1) * 10), 0, 10);

  function scoreNear(value, ideal, tolerance, hardLimit) {
    const distance = Math.abs(value - ideal);
    if (distance <= tolerance) return 1;
    if (distance >= hardLimit) return 0;
    return 1 - (distance - tolerance) / (hardLimit - tolerance);
  }

  function ramp(value, start, end) {
    if (end === start) return value >= end ? 1 : 0;
    return clamp((value - start) / (end - start), 0, 1);
  }

  function gradeForScore(score) {
    if (score >= 85) return "great";
    if (score >= 70) return "steady";
    if (score >= 55) return "watch";
    return "reset";
  }

  function normalizeFace(face, frame) {
    if (!face || !frame?.width || !frame?.height) return null;
    const x = Number(face.x ?? face.left ?? 0);
    const y = Number(face.y ?? face.top ?? 0);
    const width = Number(face.width ?? face.w ?? 0);
    const height = Number(face.height ?? face.h ?? 0);
    if (!(width > 0 && height > 0)) return null;
    return {
      x,
      y,
      width,
      height,
      centerX: x + width / 2,
      centerY: y + height / 2,
      confidence: clamp(Number(face.confidence ?? face.score ?? 0.75), 0, 1),
      rollDeg: normalizeRollDeg(face.rollDeg),
      source: face.source || "unknown",
    };
  }

  function normalizeRollDeg(value) {
    if (!Number.isFinite(Number(value))) return null;
    return ((((Number(value) + 90) % 180) + 180) % 180) - 90;
  }

  function scorePosture(input) {
    const frame = {
      width: Number(input?.frame?.width || input?.frameWidth || 0),
      height: Number(input?.frame?.height || input?.frameHeight || 0),
    };
    const face = normalizeFace(input?.face, frame);
    const pose = input?.pose || null;
    const temporal = input?.temporal || {};

    if (!face) {
      return {
        score: 0,
        grade: "missing",
        reasons: ["No face was detected in the frame."],
        components: COMPONENTS.map((component) => ({ ...component, score: 0 })),
        metrics: emptyMetrics(temporal),
      };
    }

    const faceCenterXRatio = face.centerX / frame.width;
    const faceCenterYRatio = face.centerY / frame.height;
    const faceHeightRatio = face.height / frame.height;

    const coreComponentScores = [
      {
        key: "detection",
        score: detectionScore(face),
      },
      {
        key: "shoulderLevel",
        score: shoulderLevelScore(pose),
      },
      {
        key: "horizontalCenter",
        score: toPoints(scoreNear(faceCenterXRatio, 0.5, 0.05, 0.28)),
      },
      {
        key: "verticalPosition",
        score: toPoints(scoreNear(faceCenterYRatio, 0.36, 0.08, 0.28)),
      },
      {
        key: "cameraDistance",
        score: toPoints(scoreNear(faceHeightRatio, 0.26, 0.07, 0.24)),
      },
      {
        key: "headTilt",
        score: face.rollDeg == null ? 8 : toPoints(scoreNear(face.rollDeg, 0, 3, 18)),
      },
      {
        key: "neckLoad",
        score: neckLoadScore(faceCenterYRatio, faceHeightRatio, pose),
      },
      {
        key: "focusDuration",
        score: focusDurationScore(Number(temporal.focusDurationSec || 0)),
      },
      {
        key: "movementVariety",
        score: movementVarietyScore(Number(temporal.movementDelta), Number(temporal.focusDurationSec || 0)),
      },
    ];

    const scoreBeforeTrend = coreComponentScores.reduce((sum, component) => sum + component.score, 0);
    const trendComponent = {
      key: "recentTrend",
      score: recentTrendScore(scoreBeforeTrend + 8, temporal.previousScores),
    };
    const components = attachComponentMeta([...coreComponentScores, trendComponent]);
    const score = components.reduce((sum, component) => sum + component.score, 0);

    return {
      score,
      grade: gradeForScore(score),
      reasons: buildReasons({
        components,
        faceCenterXRatio,
        faceCenterYRatio,
        faceHeightRatio,
        rollDeg: face.rollDeg,
        focusDurationSec: Number(temporal.focusDurationSec || 0),
        movementDelta: Number(temporal.movementDelta),
      }),
      components,
      metrics: {
        faceVisible: round(face.confidence),
        shoulderLevel: componentUnit(components, "shoulderLevel"),
        centered: round(componentUnit(components, "horizontalCenter")),
        vertical: round(componentUnit(components, "verticalPosition")),
        distance: round(componentUnit(components, "cameraDistance")),
        headLevel: componentUnit(components, "headTilt"),
        neckLoad: componentUnit(components, "neckLoad"),
        focusDuration: componentUnit(components, "focusDuration"),
        movementVariety: componentUnit(components, "movementVariety"),
        recentTrend: componentUnit(components, "recentTrend"),
        focusDurationSec: Math.round(Number(temporal.focusDurationSec || 0)),
        movementDelta: Number.isFinite(Number(temporal.movementDelta)) ? round(Number(temporal.movementDelta), 4) : null,
        faceCenterXRatio: round(faceCenterXRatio),
        faceCenterYRatio: round(faceCenterYRatio),
        faceHeightRatio: round(faceHeightRatio),
        rollDeg: face.rollDeg == null ? null : round(face.rollDeg, 1),
        detectionSource: face.source,
      },
    };
  }

  function emptyMetrics(temporal) {
    return {
      faceVisible: 0,
      shoulderLevel: 0,
      centered: 0,
      vertical: 0,
      distance: 0,
      headLevel: 0,
      neckLoad: 0,
      focusDuration: 0,
      movementVariety: 0,
      recentTrend: 0,
      focusDurationSec: Math.round(Number(temporal.focusDurationSec || 0)),
      movementDelta: null,
      detectionSource: "none",
    };
  }

  function detectionScore(face) {
    if (face.source === "mediapipe-pose") return 10;
    if (face.source === "approximate") return 7;
    return clamp(Math.round(6 + face.confidence * 4), 0, 10);
  }

  function shoulderLevelScore(pose) {
    const left = pose?.leftShoulder;
    const right = pose?.rightShoulder;
    if (!isVisibleLandmark(left) || !isVisibleLandmark(right)) return 7;
    return toPoints(scoreNear(right.y - left.y, 0, 0.025, 0.14));
  }

  function neckLoadScore(faceCenterYRatio, faceHeightRatio, pose) {
    const tooClose = ramp(faceHeightRatio, 0.3, 0.48);
    const tooLow = ramp(faceCenterYRatio, 0.43, 0.62);
    const shoulderDropRisk = neckDropRiskFromPose(pose);
    const zRisk = neckForwardRiskFromWorldPose(pose);
    const combinedRisk = clamp(tooClose * 0.45 + tooLow * 0.25 + shoulderDropRisk * 0.45 + zRisk * 0.25, 0, 1);
    return toPoints(1 - combinedRisk);
  }

  function neckDropRiskFromPose(pose) {
    if (!isVisibleLandmark(pose?.nose) || !isVisibleLandmark(pose?.leftShoulder) || !isVisibleLandmark(pose?.rightShoulder)) return 0;
    const shoulderMidY = (pose.leftShoulder.y + pose.rightShoulder.y) / 2;
    const noseAboveShoulders = shoulderMidY - pose.nose.y;
    return 1 - scoreNear(noseAboveShoulders, 0.34, 0.08, 0.22);
  }

  function neckForwardRiskFromWorldPose(pose) {
    if (!pose?.worldNose || !pose?.worldLeftShoulder || !pose?.worldRightShoulder) return 0;
    const shoulderZ = (pose.worldLeftShoulder.z + pose.worldRightShoulder.z) / 2;
    const noseForward = shoulderZ - pose.worldNose.z;
    return ramp(noseForward, 0.08, 0.28);
  }

  function isVisibleLandmark(point) {
    return Boolean(point && Number.isFinite(point.x) && Number.isFinite(point.y) && (point.visibility == null || point.visibility >= 0.25));
  }

  function focusDurationScore(focusDurationSec) {
    if (focusDurationSec <= 15) return 10;
    if (focusDurationSec >= 180) return 0;
    if (focusDurationSec <= 60) return toPoints(1 - ((focusDurationSec - 15) / 45) * 0.45);
    return toPoints(0.55 - ((focusDurationSec - 60) / 120) * 0.55);
  }

  function movementVarietyScore(movementDelta, focusDurationSec) {
    if (!Number.isFinite(movementDelta)) return focusDurationSec > 60 ? 6 : 8;
    if (movementDelta < 0.012) {
      const stillPenalty = clamp((focusDurationSec - 15) / 105, 0, 1);
      return toPoints(0.85 - stillPenalty * 0.65);
    }
    if (movementDelta <= 0.09) return 10;
    if (movementDelta <= 0.18) return 8;
    return 5;
  }

  function recentTrendScore(currentScoreGuess, previousScores) {
    const scores = Array.isArray(previousScores) ? previousScores.filter(Number.isFinite).slice(-6) : [];
    if (scores.length < 2) return 8;
    const average = scores.reduce((sum, score) => sum + score, 0) / scores.length;
    const delta = currentScoreGuess - average;
    if (delta >= 4) return 10;
    if (delta >= -3) return 9;
    if (delta <= -30) return 0;
    return toPoints(1 - (Math.abs(delta) - 3) / 27);
  }

  function attachComponentMeta(scores) {
    return COMPONENTS.map((definition) => {
      const found = scores.find((component) => component.key === definition.key);
      return {
        ...definition,
        score: clamp(Number(found?.score ?? 0), 0, 10),
      };
    });
  }

  function componentUnit(components, key) {
    const found = components.find((component) => component.key === key);
    return found ? round(found.score / 10) : 0;
  }

  function buildReasons(values) {
    const weak = values.components
      .filter((component) => component.score <= 6)
      .sort((a, b) => a.score - b.score)
      .slice(0, 3);
    const reasons = weak.map((component) => reasonForComponent(component.key, values));
    if (reasons.length === 0) {
      reasons.push("Posture signals look stable in this capture.");
    }
    return reasons;
  }

  function reasonForComponent(key, values) {
    switch (key) {
      case "shoulderLevel":
        return "Your shoulder line appears tilted in the pose landmarks.";
      case "horizontalCenter":
        return values.faceCenterXRatio < 0.5 ? "Your head is drifting left of center." : "Your head is drifting right of center.";
      case "verticalPosition":
        return "Your head height in frame is outside the comfortable camera zone.";
      case "cameraDistance":
        return values.faceHeightRatio > 0.33 ? "You may be leaning too close to the screen." : "You may be leaning away from the screen.";
      case "headTilt":
        return "Your head appears tilted compared with the camera frame.";
      case "neckLoad":
        return "Your head looks low or close to the screen, which is the app's straight-neck risk signal.";
      case "focusDuration":
        return `You have been camera-facing for about ${Math.round(values.focusDurationSec)} seconds.`;
      case "movementVariety":
        return "Your head position has barely changed, so the app is treating it as posture fixation.";
      case "recentTrend":
        return "This capture is weaker than your recent posture trend.";
      case "detection":
      default:
        return "Face detection is unstable in this capture.";
    }
  }

  function aggregateTrend(history, sampleSize = 8) {
    const samples = Array.isArray(history) ? history.slice(-sampleSize).filter((entry) => Number.isFinite(entry.score)) : [];
    if (samples.length === 0) {
      return { count: 0, average: 0, delta: 0, direction: "flat" };
    }
    const average = samples.reduce((sum, entry) => sum + entry.score, 0) / samples.length;
    const delta = samples.length > 1 ? samples.at(-1).score - samples[0].score : 0;
    return {
      count: samples.length,
      average: Math.round(average),
      delta: Math.round(delta),
      direction: delta > 4 ? "up" : delta < -4 ? "down" : "flat",
    };
  }

  return {
    scorePosture,
    aggregateTrend,
    gradeForScore,
    COMPONENTS,
  };
});
