/** Auto Apply density check: flag runs whose many machine tags may be spurious.
 * Advice only. It never changes a run, a threshold or the native annotation.
 */
export const DENSE_RUN = Object.freeze({ minTags: 25, perThousand: 25, nearMargin: .1, nearShare: .5, keepShare: .7 });

/** `chars` is the note length; `threshold` the run's recorded threshold. */
export function autoApplyAdvice(records, { chars, threshold, fixedThreshold = false } = {}) {
    const count = records?.length ?? 0;
    if (count < DENSE_RUN.minTags || !(chars > 0))
        return null;
    const perThousand = count / Math.max(1, chars / 1000);
    const scores = records.map(record => Number(record.score)).filter(Number.isFinite);
    const limit = Number(threshold);
    const scored = Number.isFinite(limit) && scores.length > 0;
    const nearShare = scored ? scores.filter(score => score < limit + DENSE_RUN.nearMargin).length / scores.length : null;
    if (perThousand < DENSE_RUN.perThousand && !(nearShare >= DENSE_RUN.nearShare))
        return null;
    return { count, perThousand, nearShare, threshold: scored ? limit : null, suggestion: fixedThreshold || !scored ? null : raisedThreshold(scores, limit) };
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
    const near = advice.nearShare == null ? '' : ` · ${Math.round(advice.nearShare * 100)}% scored within ${DENSE_RUN.nearMargin} of the ${advice.threshold} threshold`;
    return density + near;
}
