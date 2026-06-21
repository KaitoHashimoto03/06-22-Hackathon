const assert = require("node:assert/strict");
const { buildLocalReview } = require("../src/localReview");

const review = buildLocalReview(
  {
    score: 62,
    reasons: ["Your head is drifting right of center."],
  },
  {
    count: 4,
    average: 68,
    direction: "down",
  },
);

assert.match(review, /怪しい|リセット|調整/);
assert.match(review, /Your head is drifting right of center/);

const empty = buildLocalReview(null, { count: 0, average: 0, direction: "flat" });
assert.match(empty, /まだ姿勢データがない/);

console.log("localReview tests passed");
