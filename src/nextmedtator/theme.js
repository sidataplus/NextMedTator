/* Runs before first paint; no application data or model requests. */
(() => {
    const key = 'nextmedtator-theme';
    const system = matchMedia('(prefers-color-scheme: dark)');
    const valid = value => ['system', 'light', 'dark'].includes(value) ? value : 'system';
    let preference = 'system';
    try { preference = valid(localStorage.getItem(key)); } catch { /* Storage can be disabled. */ }
    function apply() {
        document.documentElement.dataset.theme = preference === 'system' ? (system.matches ? 'dark' : 'light') : preference;
        document.documentElement.dataset.themePreference = preference;
        for (const control of document.querySelectorAll('[data-nmt-theme]')) control.value = preference;
    }
    apply();
    system.addEventListener('change', apply);
    addEventListener('storage', event => {
        if (event.key === key || event.key === null) { preference = valid(event.newValue); apply(); }
    });
    document.addEventListener('change', event => {
        if (!event.target.matches('[data-nmt-theme]')) return;
        preference = valid(event.target.value);
        try { localStorage.setItem(key, preference); } catch { /* Keep the session choice. */ }
        apply();
    });
    // Settings is rendered by Vue after startup, and may be recreated later.
    new MutationObserver(records => {
        if (records.some(record => [...record.addedNodes].some(node => node.nodeType === 1 &&
            (node.matches('[data-nmt-theme]') || node.querySelector('[data-nmt-theme]'))))) apply();
    }).observe(document.documentElement, {childList: true, subtree: true});
})();
