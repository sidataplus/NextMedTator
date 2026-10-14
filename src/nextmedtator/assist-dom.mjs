// Reuse the same local Font Awesome face as the original ribbon. Decorative
// glyphs stay out of accessible names; every action retains its text label.
export const ICONS = {
    assist: 'f0d0', practice: 'f15c', collections: 'f07c', options: 'f1de', recovery: 'f0c7', packages: 'f1b2',
    'device-details': 'f108', 'package-details': 'f05a', 'local-packages': 'f0a0', batch: 'f03a',
    download: 'f019', upload: 'f093', play: 'f04b', pause: 'f04c', save: 'f0c7', open: 'f07c', check: 'f00c',
    undo: 'f0e2', remove: 'f2ed', close: 'f00d', list: 'f03a', hide: 'f054', search: 'f002',
};
// The first matching caption prefix picks the icon shown before a button's text.
const ACTION_ICONS = [
    [/^Analyze|^Resume/, 'play'],
    [/^Pause/, 'pause'],
    [/^Download|^Re-download|^Repair|^Export/, 'download'],
    [/^Import|^Install/, 'upload'],
    [/^Save|^Enable Recovery/, 'save'],
    [/^Open|^Restore|^Use Installed|^Load Installed/, 'open'],
    [/^Reject|^Cancel|^Close|^Unload|^Disable/, 'close'],
    [/^Remove|^Delete/, 'remove'],
    [/^Undo|^Retry|^Reset/, 'undo'],
    [/^Check GPU|^Select|^Apply|^Accept|^Add Tag|^Use Recommended/, 'check'],
    [/^List/, 'list'],
    [/^Show approved/, 'search'],
    [/^Hide/, 'hide'],
    [/^Assistance$/, 'assist'],
    [/^P10|^BPSD/, 'practice'],
];
export function icon(name) {
    const glyph = String.fromCodePoint(parseInt(ICONS[name] ?? ICONS.assist, 16));
    return node('span', null, { class: 'icon', 'aria-hidden': 'true', 'data-glyph': glyph });
}
export function actionIcon(text) {
    for (const [pattern, name] of ACTION_ICONS)
        if (pattern.test(text))
            return name;
    return null;
}
export function node(tag, text, attrs = {}) {
    const n = document.createElement(tag);
    if (text != null)
        n.textContent = String(text);
    for (const [key, value] of Object.entries(attrs))
        if (value != null && value !== false)
            n.setAttribute(key, String(value));
    return n;
}
export function button(text, fn, { disabled = false, primary = false, id, title } = {}) {
    const n = node('button', text, { type: 'button', disabled, class: primary ? 'primary' : '', title, ...(id ? { 'data-testid': id } : {}) });
    const guide = actionIcon(text);
    if (guide)
        n.prepend(icon(guide));
    n.addEventListener('click', fn);
    return n;
}
// Short visible captions keep MedTator's style; the accessible name says which list moves.
export function labelButton(element, label) {
    element.setAttribute('aria-label', label);
    return element;
}
export function labeled(text, input) {
    // Checkboxes sit before their caption, as in MedTator's toggles and file list.
    const checkbox = input.type === 'checkbox';
    const label = node('label', null, checkbox ? { class: 'check' } : {});
    if (checkbox) label.append(input, node('span', text));
    else label.append(node('span', text), input);
    return label;
}
export function disclosure(assist, key, title, defaultOpen = false) {
    assist.sectionState ??= new Map();
    const details = node('details', null, { class: 'section', 'data-testid': `assist-${key}` });
    details.open = assist.sectionState.get(key) ?? defaultOpen;
    const summary = node('summary', title);
    if (ICONS[key])
        summary.prepend(icon(key));
    // The native toggle event is deferred. Preserve the user's intent before
    // another control rerenders this panel in the same event cycle.
    summary.addEventListener('click', () => assist.sectionState.set(key, !details.open));
    details.append(summary);
    details.addEventListener('toggle', () => {
        if (details.isConnected)
            assist.sectionState.set(key, details.open);
    });
    return details;
}
