(function attachLocalReview(root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.LocalReview = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function createLocalReview() {
  function buildLocalReview(latest, trend) {
    if (!latest) {
      return "まだ姿勢データがないよ。まず一回キャプチャして、そこから見てあげる。";
    }

    const lead =
      latest.score >= 85
        ? "かなり安定してる。今の距離と画面位置はキープでいい。"
        : latest.score >= 70
          ? "悪くないけど、少し崩れ始めてる。大きく直すより微調整で戻せる。"
          : latest.score >= 55
            ? "ちょっと怪しい。首か上体がカメラ中心から外れてきてる。"
            : "今はリセット推奨。深呼吸して、椅子に座り直した方が早い。";

    const trendText = trend.direction === "down"
      ? `直近${trend.count}件の平均は${trend.average}点で下がり気味。休憩か画面位置の調整を入れて。`
      : trend.direction === "up"
        ? `直近${trend.count}件の平均は${trend.average}点で上向き。さっきの調整が効いてる。`
        : `直近${trend.count}件の平均は${trend.average}点で横ばい。今の作業環境を維持して。`;

    const weakComponents = Array.isArray(latest.components)
      ? latest.components
          .filter((component) => component.score <= 6)
          .sort((a, b) => a.score - b.score)
          .slice(0, 2)
          .map((component) => `${component.label} ${component.score}/10`)
      : [];
    const reason = Array.isArray(latest.reasons) && latest.reasons.length > 0 ? latest.reasons[0] : "姿勢シグナルは安定。";
    const weakText = weakComponents.length > 0 ? `弱い指標: ${weakComponents.join(", ")}` : "弱い指標: 目立つ崩れなし";
    return `${lead}\n${trendText}\n${weakText}\n見るべきポイント: ${reason}`;
  }

  return { buildLocalReview };
});
