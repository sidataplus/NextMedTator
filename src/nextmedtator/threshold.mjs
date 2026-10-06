// A per-analysis override never rewrites a frozen scope or a model manifest.
export function suggestionThreshold(override, scope, variant) {
    const source = override == null ? (scope?.threshold == null ? 'model' : 'scope') : 'user';
    const value = override ?? scope?.threshold ?? variant?.threshold ?? .5;
    const threshold = typeof value === 'string' && value.trim() ? Number(value) : value;
    if (typeof threshold !== 'number' || !Number.isFinite(threshold) || threshold < 0 || threshold > 1)
        throw new Error('Suggestion threshold must be a number between 0 and 1.');
    return {threshold, thresholdSource: source};
}

export function thresholdControl({override, scope, variant, disabled, id, onChange}) {
    const section = document.createElement('div');
    section.className = 'threshold';
    const heading = document.createElement('div');
    heading.className = 'threshold-title';
    const label = document.createElement('label');
    label.textContent = 'Suggestion threshold'; label.htmlFor = id;
    const input = document.createElement('input');
    input.id = id; input.type = 'range'; input.min = '0'; input.max = '1';
    // Preserve exact existing defaults; user movements select hundredths.
    input.step = 'any';
    input.dataset.testid = id; input.dataset.focusKey = id;
    input.disabled = disabled;
    input.value = override ?? suggestionThreshold(null, scope, variant).threshold;
    input.setAttribute('aria-describedby', id + '-help');
    const output = document.createElement('output');
    output.htmlFor = id; output.dataset.testid = id + '-value';
    output.value = input.value;
    input.setAttribute('aria-valuetext', input.value);
    input.addEventListener('input', () => {
        input.value = String(Math.round(Number(input.value) * 100) / 100);
        output.value = input.value;
        input.setAttribute('aria-valuetext', input.value);
        onChange(input.value, false);
    });
    heading.append(label, output);
    const reset = document.createElement('button');
    reset.type = 'button'; reset.textContent = 'Use default'; reset.disabled = disabled;
    reset.dataset.testid = id + '-reset';
    reset.addEventListener('click', () => onChange(null, true));
    const help = document.createElement('p');
    help.id = id + '-help'; help.className = 'muted';
    const baseline = suggestionThreshold(null, scope, variant);
    help.textContent = `0–1. Lower includes more spans; higher is stricter. Applies to the next analysis. ${baseline.thresholdSource === 'scope' ? 'Scope' : 'Model'} default: ${baseline.threshold}.`;
    section.append(heading, input, reset, help);
    return section;
}
