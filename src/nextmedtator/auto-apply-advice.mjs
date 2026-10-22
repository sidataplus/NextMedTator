/** Auto Apply check: flag runs whose machine tags are likely to include many false positives.
 * Advice only. It never changes a run, a threshold or the native annotation.
 *
 * Calibrated on the 27 reference-annotated synthetic notes with the P10 package
 * (docs/nextmedtator/qualification/auto-apply-advice-calibration.json). Exact-span
 * precision was 17-34% for scores below 0.6 and 83% at 0.9 or more. The share of
 * tags below 0.6 tracked per-note precision (r = -0.59); density alone did not,
 * because reference annotation itself reached 27 tags per 1,000 characters.
 */
export const DENSE_RUN = Object.freeze({ minTags: 15, lowScore: .6, lowShare: .35, perThousand: 40, keepShare: .7 });

/** `chars` is the note length; `threshold` the lowest score the run kept. A
 * suggested minimum score filters stored predictions; the model is not rerun. */
export function autoApplyAdvice(records, { chars, threshold } = {}) {
    const count = records?.length ?? 0;
    if (count < DENSE_RUN.minTags || !(chars > 0))
        return null;
    const perThousand = count / Math.max(1, chars / 1000);
    const scores = records.map(record => Number(record.score)).filter(Number.isFinite);
    const limit = Number.isFinite(Number(threshold)) ? Number(threshold) : 0;
    const scored = scores.length > 0 && limit < DENSE_RUN.lowScore;
    const lowShare = scored ? scores.filter(score => score < DENSE_RUN.lowScore).length / scores.length : null;
    if (perThousand < DENSE_RUN.perThousand && !(lowShare >= DENSE_RUN.lowShare))
        return null;
    return { count, perThousand, lowShare, lowScore: DENSE_RUN.lowScore, suggestion: scores.length ? suggestedMinimum(scores, limit) : null };
}

/** Drop the low-confidence band when the run kept it; otherwise the smallest 0.05 step that drops 30%. */
export function suggestedMinimum(scores, threshold) {
    if (threshold < DENSE_RUN.lowScore) {
        const kept = scores.filter(score => score >= DENSE_RUN.lowScore).length;
        if (kept > 0 && kept < scores.length)
            return { threshold: DENSE_RUN.lowScore, kept, total: scores.length };
    }
    return raisedThreshold(scores, threshold);
}

/** Smallest 0.05 step above the current threshold that drops at least 30% of scored tags. */
export function raisedThreshold(scores, threshold) {
    for (let step = Math.floor(threshold * 20 + 1e-9) + 1; step <= 19; step++) {
        const value = Math.round(step * 5) / 100;
        const kept = scores.filter(score => score >= value).length;
        if (kept === 0)
            return null;
        if (kept <= scores.length * DENSE_RUN.keepShare)
            return { threshold: value, kept, total: scores.length };
    }
    return null;
}

export function adviceSummary(advice) {
    const density = `${advice.count} tags · ${advice.perThousand.toFixed(advice.perThousand < 10 ? 1 : 0)} per 1,000 characters`;
    const low = advice.lowShare == null ? '' : ` · ${Math.round(advice.lowShare * 100)}% scored below ${advice.lowScore}`;
    return density + low;
}
