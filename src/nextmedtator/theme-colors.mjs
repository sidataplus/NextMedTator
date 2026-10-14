// Shared inherited tokens let shadow components follow the document theme.
// Light mode preserves their existing colors, including annotation semantics.
const groups = {
    paper: ['#fff', '#ffffff', 'white', '#fbfcfd'],
    surface: ['#fafafa', '#f5f5f5', '#f7f9fa', '#f7f9fb', '#f5f6f7', '#f2f5f7', 'whitesmoke', '#eeeeee', '#eee', '#eaeaea', '#efefef', '#e6e6e6', '#dedede', '#dfdfdf', '#dadada', '#d5d5d5'],
    ink: ['#222', '#333', '#444', '#333333', '#444444', '#1d1d1d', '#1a3041', '#173b49', 'black'],
    muted: ['#555', '#555555', '#777777', '#888888', '#595959', '#536976', '#535353', '#666', 'grey', 'gray'],
    line: ['#ccc', '#ddd', '#bdbdbd', '#d9d9d9', '#d7e1e7', '#d5e3da', '#c5d7dd', '#cccccc', '#dadbdc', '#e9e9e9', '#aaaaaa', '#999999'],
    hint: ['#eff6fc', '#edf4f6', '#eef5f7', '#eef5f0', '#e5f3ff', '#e6f2f3', '#f4f9fb', '#fffee8'],
    good: ['#e8f5ef'], goodInk: ['#176444'],
    warning: ['#fff2db', '#fff9e9', '#fff3a4'], warningInk: ['#78571c', '#8a3b16'],
    error: ['#fff0ec'], link: ['#0067b8'],
};
const tokens = new Map(Object.entries(groups).flatMap(([token, colors]) => colors.map(color => [color, token])));
export function themeColors(css) {
    return css.replace(/#[\da-f]{3,8}\b|\b(?:white|black|whitesmoke|grey|gray)\b(?!-)/gi, (value, offset) => {
        const token = tokens.get(value.toLowerCase());
        // White text on colored primary buttons must remain white.
        if (token === 'paper' && /(?:^|[;{])\s*color:\s*$/.test(css.slice(0, offset))) return value;
        return token ? `var(--nmt-${token},${value})` : value;
    });
}
