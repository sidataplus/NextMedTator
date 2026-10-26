// Assistance panel styles. Values follow the original MedTator annotation tab:
// inherited 12px system font, bevelled .btn buttons, whitesmoke header strips,
// #dadbdc ribbon lines, and the #1ba1e2 accent used for the selected file.
// Colors listed in theme-colors.mjs switch automatically in dark mode.
export const ASSIST_STYLES = `
:host{display:block;height:100%;color:#222;font-family:inherit;font-size:12px;line-height:1.45}
*{box-sizing:border-box}
button,input,select,textarea{font:inherit;color:inherit}
button{display:inline-flex;align-items:center;min-height:26px;max-width:100%;padding:3px 7px;border:1px solid;border-color:#eaeaea #aaaaaa #aaaaaa #eaeaea;border-radius:0;background:#fafafa;text-align:left;overflow-wrap:anywhere;cursor:pointer}
button:hover{background:#e5f3ff;border-color:#a4cef9}
button:disabled{opacity:.5;cursor:not-allowed}
button.primary{justify-content:center;background:#0078d7;color:#fff;border-color:#0078d7}
button.primary:hover{background:#005a9e;border-color:#005a9e}
select{max-width:100%;padding:3px 4px;border:1px solid #aaaaaa;border-radius:0;background:#fff;cursor:pointer}
input[type=text],textarea{max-width:100%;padding:3px 4px;border:1px solid #999999;border-radius:0;background:#fff}
input[type=checkbox],input[type=range],progress{accent-color:#0078d7}
input[type=file]{width:100%;max-width:100%;padding:2px 0;font-size:11px}
input::file-selector-button{font:inherit;margin-right:6px;padding:3px 7px;border:1px solid;border-color:#eaeaea #aaaaaa #aaaaaa #eaeaea;border-radius:0;background:#fafafa;cursor:pointer}
:focus-visible{outline:2px solid #1ba1e2;outline-offset:1px}
button:focus:not(:focus-visible){outline:none}
a{color:#0067b8}
label{display:flex;flex-direction:column;gap:3px;margin:6px 0;font-size:11px}
label>span{font-weight:600}
.check{flex-direction:row;align-items:center;gap:6px;margin:2px 0;font-weight:400}
.check>span{font-weight:400}
.row{display:flex;flex-wrap:wrap;align-items:center;gap:4px;margin:6px 0}
.grow{flex:1}
.muted{color:#595959;font-size:11px}
p{margin:5px 0}
.icon{font-family:"Font Awesome 5 Free";font-weight:900;font-style:normal;display:inline-block;width:1.15em;margin-right:6px;text-align:center;line-height:1;flex-shrink:0;speak:none}
.icon::before{content:attr(data-glyph)}
.dock{height:100%;display:flex;flex-direction:column;background:#fff}
.rail{width:100%;height:100%;padding:8px 0;justify-content:flex-start;border:0;background:whitesmoke;color:#333;writing-mode:vertical-rl;text-orientation:mixed;letter-spacing:.04em}
.rail .icon{margin:0 0 6px}
.head{flex-shrink:0;display:flex;flex-direction:column;gap:4px;padding:5px 8px;background:whitesmoke;border-bottom:1px solid #cccccc}
.head .row{margin:0}
.head strong{font-size:13px;font-weight:600}
.head .row>.icon{font-size:14px}
.head p{margin:0;overflow-wrap:anywhere}
.head>[data-testid=assist-pause]{align-self:flex-end}
.message{flex-shrink:0;max-height:25%;overflow:auto;margin:6px 8px 0;padding:5px 8px;border-left:3px solid #1ba1e2;background:#eff6fc;font-size:11px;overflow-wrap:anywhere}
.message.error{border-left-color:#ce352c;background:#fff0ec}
.dock .loading-progress{margin:6px 8px 0;padding:6px 8px;border:1px solid #dadbdc;border-radius:0;color:#222;font:inherit}
.dock .loading-progress progress{height:10px}
.body{flex:1;min-height:80px;overflow:auto;padding:8px;scrollbar-gutter:stable}
.section{margin:0 0 8px;padding:0 8px 6px;border:1px solid #dadbdc;background:#fff}
.section>h3{display:flex;align-items:center}
.section>h3,.section>summary{margin:0 -8px 6px;padding:5px 8px;background:whitesmoke;border-bottom:1px solid #dadbdc;font-size:12px;font-weight:600}
.section>summary{display:list-item;cursor:pointer;user-select:none;list-style-position:inside}
.section>summary::marker{color:#595959}
.section>summary:hover{background:#e5f3ff}
.section:not([open]){padding-bottom:0}
.section:not([open])>summary{margin-bottom:0;border-bottom:0}
.section .section{margin:8px 0 0}
.section .section>summary{background:#fafafa;font-size:11px}
.section>button{margin:3px 3px 3px 0}
.section>label+.mode-description{margin:-3px 0 6px}
.badge{padding:0 5px;border:1px solid #cccccc;background:whitesmoke;font-size:10px}
.badge.pending{background:#fff2db;color:#78571c}
.badge.ready{background:#e8f5ef;color:#176444}
.badge.completed{background:#e8f5ef;color:#176444}
.badge.failed{background:#fff0ec;color:#8a3b16}
.badge.cancelled{background:#fff2db;color:#78571c}
.badge.running{background:#e5f3ff}
.file-list{margin:6px 0}
.file-row{display:flex;align-items:center;gap:6px;min-height:28px;padding:1px 2px;border-bottom:1px dotted #cccccc}
.file-row.current{background:#fffee8}
.file-row .check{min-width:0;margin:0}
.file-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.file-row small{flex-shrink:0;font-size:10px;font-variant-numeric:tabular-nums}
.file-row .badge{flex-shrink:0;white-space:nowrap}
.file-row button{flex-shrink:0;min-height:22px;padding:2px 5px;font-size:11px}
.filters input[type=text]{flex:1;min-width:120px}
.drop-zone{margin:6px 0;padding:4px 8px;border:1px dashed #aaaaaa;background:#fafafa}
.drop-zone.active{border-color:#1ba1e2;background:#e5f3ff}
.drop-zone label{margin:4px 0}
.advice strong{display:block}
.confirm{flex-shrink:0;margin:6px 8px 0;padding:6px 8px;border:1px solid #1ba1e2;border-left-width:3px;background:#eff6fc;font-size:11px}
.confirm p{margin:0 0 4px;overflow-wrap:anywhere;font-weight:600}
.confirm .row{margin:0}
.min-score{display:flex;align-items:center;gap:6px;margin:6px 0}
.min-score input[type=range]{flex:1;min-width:80px}
.min-score output{min-width:2.5em;font-weight:600;font-variant-numeric:tabular-nums}
.advice .row{margin:4px 0 2px}
.setup-hint{margin:6px 0;padding:5px 8px;border-left:3px solid #1ba1e2;background:#eff6fc;font-size:11px}
.setup-hint p{margin:3px 0}
.setup-hint .section{border:0;padding-bottom:0}
.setup-hint .section>summary{background:transparent}
.action-bar{padding:6px 0 0}
.action-bar .row{display:grid;grid-template-columns:1fr;gap:4px;margin:0}
.action-bar button{min-height:30px}
.action-bar p{margin:6px 0 0;font-size:11px;color:#595959}
.section>.primary{width:100%;min-height:30px}
.card{margin:0 0 6px;padding:5px 8px;border:1px solid #dadbdc;background:#fff}
.card.focused{border-left:3px solid #1ba1e2;background:#fffee8}
.card p{margin:3px 0;overflow-wrap:anywhere}
.anchor{font-weight:600}
.tag{font-size:10px;letter-spacing:.04em;text-transform:uppercase}
.changed{background:#fff9e9}
.wrap{overflow-wrap:anywhere}
progress.full{width:100%}
.threshold{margin:0 0 6px}
.threshold-title{display:flex;align-items:center;justify-content:space-between;gap:8px}
.threshold output{font-weight:600;font-variant-numeric:tabular-nums}
.threshold input[type=range]{width:100%;margin:6px 0;padding:0;cursor:pointer}
.threshold p{margin:4px 0}
.threshold button{margin-top:4px}
.model-selection{min-width:0;max-width:100%;overflow-wrap:anywhere}
.model-selection label,.model-selection details{min-width:0;max-width:100%}
.model-selection input[type=text],.model-selection select{width:100%;min-width:0}
.model-selection select{text-overflow:ellipsis}
.model-selection pre{max-width:100%;overflow:auto;white-space:pre;font-size:10px}
.section .model-selection h3{margin:0 0 6px;font-size:12px;font-weight:600}
.section .model-selection [role=status]{color:#595959;font-size:11px}
.scope{margin:8px 0;padding:6px 8px;border:1px solid #dadbdc;background:#fff}
.scope label{margin:5px 0}
.scope textarea{width:100%;resize:vertical}
.scope fieldset{margin:8px 0;padding:6px;border:1px solid #dadbdc}
.scope h3{margin:10px 0 5px;font-size:12px}
.unmatched{color:#8a3b16}
.compact{width:100%;border-collapse:collapse;font-size:11px;table-layout:fixed}
.compact td{padding:3px 2px;border-bottom:1px dotted #cccccc;vertical-align:middle}
.compact td:last-child{width:110px;text-align:right}
.compact button{min-height:22px;margin-left:2px;padding:2px 4px;font-size:10px}
.compact strong,.compact small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.compact small{color:#595959;font-size:10px}
@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important}}
`;
