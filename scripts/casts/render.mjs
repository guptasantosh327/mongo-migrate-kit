/**
 * Turns a recorded terminal session into an animated SVG (a "cast").
 *
 * Why SVG and not GIF: the text stays sharp at any zoom, a cast is a few KB instead of a few MB,
 * and it needs no extra tools. It loops like a GIF in the docs site and in the GitHub README.
 *
 * Input shape (produced by record.mjs):
 *   {
 *     title: '~/shop-api',
 *     rows: 18,                       // visible rows per pane; older lines scroll away
 *     cols: 100,                      // wrap output lines longer than this, like a terminal does
 *     layout: 'side' | 'stack',       // how several panes sit next to each other
 *     static: false,                  // true = no animation, every line shown
 *     panes: [{
 *       label?: 'Deploy A',
 *       entries: [{
 *         text: 'npx mmk up',         // what gets typed after the prompt
 *         comment?: true,             // typed in grey, has no output
 *         at?: 4200,                  // start no earlier than this many ms (to sync panes)
 *         output: [{ line: '\x1b[32m✔ Applied …\x1b[39m' } | { spinner: 'Connecting…', ms?: 900 }],
 *         hold?: 1800,                // pause after the output, in ms
 *       }],
 *     }],
 *   }
 */

const FONT = 14;
const LH = 17;
const CW = FONT * 0.6;
const PADX = 18;
const PADY = 14;
const BAR = 34;
const LABEL = 26;

const TYPE_MS = 42;
const BEFORE_TYPE = 550;
const AFTER_ENTER = 260;
const SPINNER_MS = 650;
const END_HOLD = 4200;

const COLORS = {
  bg: '#0f1417',
  bar: '#1a2024',
  border: '#2a3238',
  fg: '#d5dde3',
  title: '#8a969e',
  prompt: '#3ddc84',
  comment: '#7d8a92',
  cursor: '#d5dde3',
};

// SGR foreground codes → CSS class. Keeps the SVG small: one class per colour.
const FG = {
  30: 'k', 31: 'r', 32: 'g', 33: 'y', 34: 'b', 35: 'm', 36: 'c', 37: 'w',
  90: 'k', 91: 'r', 92: 'g', 93: 'y', 94: 'b', 95: 'm', 96: 'c', 97: 'w',
};

const STYLE = `
svg{font-family:ui-monospace,'SF Mono',SFMono-Regular,Menlo,Monaco,Consolas,'Liberation Mono','DejaVu Sans Mono',monospace;font-size:${FONT}px}
text{white-space:pre;fill:${COLORS.fg}}
.k{fill:#7f8b93}.r{fill:#ff7b72}.g{fill:#4fd27f}.y{fill:#e6b84f}.b{fill:#79b8ff}.m{fill:#d2a8ff}.c{fill:#5fd0dc}.w{fill:#f3f6f8}
.d{fill-opacity:.62}.o{font-weight:700}
.p{fill:${COLORS.prompt};font-weight:700}.cm{fill:${COLORS.comment}}
.t{fill:${COLORS.title};font-size:12.5px}.lb{fill:${COLORS.title};font-size:12px}
.cur{fill:${COLORS.cursor};animation:blink 1.05s step-end infinite}
@keyframes blink{0%{opacity:1}50%{opacity:0}}
.sp{opacity:0;animation:spin .8s step-end infinite}
@keyframes spin{0%{opacity:1}10%{opacity:0}100%{opacity:0}}
`;

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Split an ANSI-coloured line into [{ text, cls }] runs. */
export function parseAnsi(input) {
  const runs = [];
  let fg = null;
  let dim = false;
  let bold = false;
  const re = /\x1b\[([0-9;]*)m/g;
  let last = 0;
  let m = re.exec(input);
  const push = (text) => {
    if (!text) return;
    const cls = [fg, dim && 'd', bold && 'o'].filter(Boolean).join(' ');
    const prev = runs[runs.length - 1];
    if (prev && prev.cls === cls) prev.text += text;
    else runs.push({ text, cls });
  };
  while (m) {
    push(input.slice(last, m.index));
    const codes = m[1] === '' ? [0] : m[1].split(';').map(Number);
    for (let i = 0; i < codes.length; i++) {
      const c = codes[i];
      if (c === 0) {
        fg = null;
        dim = false;
        bold = false;
      } else if (c === 1) bold = true;
      else if (c === 2) dim = true;
      else if (c === 22) {
        dim = false;
        bold = false;
      } else if (c === 39) fg = null;
      else if (FG[c]) fg = FG[c];
      else if (c === 38) i += codes[i + 1] === 5 ? 2 : 4; // 256/true colour: skip, use default
    }
    last = re.lastIndex;
    m = re.exec(input);
  }
  push(input.slice(last));
  // Strip anything else that is not printable (cursor moves, etc.).
  for (const r of runs) r.text = r.text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
  return runs.filter((r) => r.text.length > 0);
}

/**
 * Break a long line into rows of at most `cols` characters. A terminal would cut mid-word; this
 * breaks at the last space instead and indents the rest, which is easier to read in a picture.
 * Table rows (box-drawing lines) are never wrapped.
 */
function wrapRuns(runs, cols) {
  const chars = runs.flatMap((r) => [...r.text].map((ch) => ({ ch, cls: r.cls })));
  if (!cols || chars.length <= cols || /^[┌│├└]/.test(chars[0]?.ch ?? '')) return [runs];
  const indent = (chars.findIndex((c) => c.ch !== ' ') + 2) | 0;
  const rows = [];
  let rest = chars;
  let first = true;
  while (rest.length > 0) {
    const room = first ? cols : cols - indent;
    if (rest.length <= room) {
      rows.push(rest);
      break;
    }
    let cut = room;
    while (cut > room / 2 && rest[cut].ch !== ' ') cut--;
    if (rest[cut].ch !== ' ') cut = room;
    rows.push(rest.slice(0, cut));
    rest = rest.slice(cut).slice(rest[cut]?.ch === ' ' ? 1 : 0);
    first = false;
  }
  return rows.map((row, i) => {
    const out = [];
    const cells = i === 0 ? row : [...Array.from({ length: indent }, () => ({ ch: ' ', cls: '' })), ...row];
    for (const { ch, cls } of cells) {
      const prev = out[out.length - 1];
      if (prev && prev.cls === cls) prev.text += ch;
      else out.push({ text: ch, cls });
    }
    return out;
  });
}

function visibleLength(line) {
  return parseAnsi(line).reduce((n, r) => n + [...r.text].length, 0);
}

/** Lay one pane's entries out on a timeline. Times are in ms from the start of the loop. */
function buildTimeline(pane, isStatic, cols) {
  const lines = []; // { row, runs, appear, disappear?, kind, typing? }
  let row = 0;
  let t = pane.startAt ?? 500;

  for (const entry of pane.entries) {
    if (entry.at != null) t = Math.max(t, entry.at);
    const chars = [...entry.text].length;
    const typeStart = t + BEFORE_TYPE;
    const typeEnd = typeStart + chars * TYPE_MS;
    const enter = typeEnd + AFTER_ENTER;
    lines.push({
      row: row++,
      kind: 'prompt',
      comment: Boolean(entry.comment),
      text: entry.text,
      appear: t,
      typing: { start: typeStart, end: typeEnd, chars, hideAt: enter },
    });
    t = enter;
    let shown = 0;
    for (const out of entry.output ?? []) {
      if (out.spinner != null) {
        if (isStatic) continue;
        const ms = out.ms ?? SPINNER_MS;
        lines.push({ row, kind: 'spinner', text: out.spinner, appear: t, disappear: t + ms });
        t += ms;
      } else {
        for (const runs of wrapRuns(parseAnsi(out.line), cols)) {
          lines.push({ row: row++, kind: 'out', runs, appear: t + shown * 12 });
          shown++;
        }
      }
    }
    t += shown * 12;
    const hold = entry.hold ?? (entry.comment ? 500 : Math.min(3600, 1300 + shown * 70));
    t += hold;
  }
  // The final, empty prompt with a blinking cursor.
  lines.push({ row: row++, kind: 'prompt', text: '', appear: t, final: true });
  return { lines, end: t, rows: row };
}

function pct(ms, total) {
  return `${Math.min(100, (ms / total) * 100).toFixed(3)}%`;
}

/** Render a cast object to an SVG string. */
export function renderCast(cast) {
  const isStatic = Boolean(cast.static);
  const timelines = cast.panes.map((p) => buildTimeline(p, isStatic, p.cols ?? cast.cols));
  const total = isStatic ? 1 : Math.max(...timelines.map((tl) => tl.end)) + END_HOLD;

  const paneCols = cast.panes.map((pane, i) => {
    const widest = Math.max(
      ...timelines[i].lines.map((l) =>
        l.kind === 'out' ? l.runs.reduce((n, r) => n + [...r.text].length, 0) : [...(l.text ?? '')].length + 2,
      ),
    );
    return Math.max(pane.minCols ?? cast.minCols ?? 64, widest + 1);
  });
  const hasLabels = cast.panes.some((p) => p.label);
  const stack = cast.layout === 'stack';
  const labelH = hasLabels ? LABEL : 0;
  const paneRows = timelines.map((tl, i) =>
    isStatic ? tl.rows : (cast.panes[i].rows ?? cast.rows ?? 18),
  );
  const bodyHeight = (r) => PADY * 2 + r * LH;
  // Every pane gets a rectangle: side by side by default, one above the other with layout 'stack'.
  const rects = [];
  if (stack) {
    const w = PADX * 2 + Math.max(...paneCols) * CW;
    let y = BAR;
    paneRows.forEach((r) => {
      rects.push({ x: 0, y, w, body: y + labelH, h: bodyHeight(r) });
      y += labelH + bodyHeight(r) + 1;
    });
  } else {
    const h = bodyHeight(Math.max(...paneRows));
    let x = 0;
    paneCols.forEach((c) => {
      const w = PADX * 2 + c * CW;
      rects.push({ x, y: BAR, w, body: BAR + labelH, h });
      x += w + 1;
    });
  }
  const last = rects[rects.length - 1];
  const width = Math.ceil(stack ? last.w : last.x + last.w);
  const height = Math.ceil(last.body + last.h);

  const css = [STYLE];
  const parts = [];
  let animId = 0;

  // Opacity show/hide keyframes, shared by lines that appear and disappear at the same times.
  const showCache = new Map();
  const showClass = (appear, disappear) => {
    if (isStatic) return '';
    const key = `${appear}|${disappear ?? ''}`;
    if (showCache.has(key)) return showCache.get(key);
    const name = `s${animId++}`;
    const frames = [`0%{opacity:0}`, `${pct(appear, total)}{opacity:1}`];
    if (disappear != null) frames.push(`${pct(disappear, total)}{opacity:0}`);
    frames.push(`100%{opacity:${disappear != null ? 0 : 1}}`);
    css.push(
      `.${name}{opacity:0;animation:${name} ${total}ms step-end infinite}@keyframes ${name}{${frames.join('')}}`,
    );
    showCache.set(key, name);
    return name;
  };

  // Window frame.
  parts.push(
    `<rect x=".5" y=".5" width="${width - 1}" height="${height - 1}" rx="10" fill="${COLORS.bg}" stroke="${COLORS.border}"/>`,
    `<path d="M10.5 .5h${width - 21}a10 10 0 0 1 10 10v${BAR - 10.5}h-${width - 1}v-${BAR - 10.5}a10 10 0 0 1 10-10z" fill="${COLORS.bar}"/>`,
    `<circle cx="20" cy="17" r="6" fill="#ff5f57"/><circle cx="40" cy="17" r="6" fill="#febc2e"/><circle cx="60" cy="17" r="6" fill="#28c840"/>`,
    `<text class="t" x="${width / 2}" y="21.5" text-anchor="middle">${esc(cast.title ?? '')}</text>`,
  );

  cast.panes.forEach((pane, pi) => {
    const tl = timelines[pi];
    const rows = paneRows[pi];
    const { x: x0, y: y0, w: pw, body: bodyTop, h: bodyH } = rects[pi];
    if (pi > 0) {
      parts.push(
        stack
          ? `<rect x=".5" y="${y0 - 1}" width="${width - 1}" height="1" fill="${COLORS.border}"/>`
          : `<rect x="${x0 - 1}" y="${BAR}" width="1" height="${height - BAR}" fill="${COLORS.border}"/>`,
      );
    }
    if (hasLabels) {
      parts.push(
        `<rect x="${x0 + 0.5}" y="${y0}" width="${pw - 1}" height="${LABEL}" fill="#151b1f"/>`,
        `<text class="lb" x="${x0 + PADX}" y="${y0 + 17}">${esc(pane.label ?? '')}</text>`,
      );
    }
    const clipId = `clip${pi}`;
    parts.push(
      `<clipPath id="${clipId}"><rect x="${x0}" y="${bodyTop}" width="${pw}" height="${bodyH - 3}"/></clipPath>`,
    );

    // Scrolling: when a new line lands below the last visible row, the whole pane jumps up a row.
    const scrollName = `sc${pi}`;
    const steps = [];
    let offset = 0;
    const events = [...tl.lines].sort((a, b) => a.appear - b.appear);
    for (const l of events) {
      const need = Math.max(0, l.row - rows + 1);
      if (need > offset) {
        offset = need;
        steps.push([l.appear, offset]);
      }
    }
    const finalOffset = isStatic ? 0 : offset;
    if (!isStatic && steps.length > 0) {
      const frames = ['0%{transform:translateY(0)}'];
      for (const [time, off] of steps) frames.push(`${pct(time, total)}{transform:translateY(-${off * LH}px)}`);
      frames.push(`100%{transform:translateY(-${finalOffset * LH}px)}`);
      css.push(`.${scrollName}{animation:${scrollName} ${total}ms step-end infinite}@keyframes ${scrollName}{${frames.join('')}}`);
    }
    css.push(`@media (prefers-reduced-motion:reduce){.${scrollName}{transform:translateY(-${finalOffset * LH}px)}}`);

    parts.push(`<g clip-path="url(#${clipId})"><g class="${scrollName}">`);
    const textX = x0 + PADX;
    const baseY = (r) => bodyTop + PADY + r * LH + 13;

    for (const l of tl.lines) {
      const y = baseY(l.row);
      const show = showClass(l.appear, l.disappear);
      const lineCls = ['l', show, l.kind === 'spinner' ? 'spl' : 'fin'].filter(Boolean).join(' ');
      if (l.kind === 'prompt') {
        const body = l.comment
          ? `<tspan class="cm">${esc(l.text)}</tspan>`
          : `<tspan>${esc(l.text)}</tspan>`;
        parts.push(
          `<g class="${lineCls}"><text x="${textX}" y="${y}"><tspan class="p">$</tspan><tspan x="${textX + 2 * CW}">${body}</tspan></text></g>`,
        );
        const cx = textX + 2 * CW;
        if (l.final) {
          if (!isStatic) {
            parts.push(
              `<g class="${show} cg"><rect class="cur" x="${cx}" y="${y - 12}" width="${CW}" height="16"/></g>`,
            );
          }
          continue;
        }
        if (isStatic) continue;
        // Typing: a background-coloured block slides right one character at a time, uncovering
        // the command, with the cursor riding on its left edge.
        const { start, end, chars, hideAt } = l.typing;
        const w = chars * CW;
        const name = `ty${animId++}`;
        css.push(
          `.${name}{opacity:0;animation:${name} ${total}ms step-end infinite}@keyframes ${name}{` +
            `0%{opacity:0;transform:translateX(0)}` +
            `${pct(l.appear, total)}{opacity:1;transform:translateX(0)}` +
            `${pct(start, total)}{opacity:1;transform:translateX(0);animation-timing-function:steps(${Math.max(1, chars)},end)}` +
            `${pct(end, total)}{opacity:1;transform:translateX(${w}px)}` +
            `${pct(hideAt, total)}{opacity:0;transform:translateX(${w}px)}` +
            `100%{opacity:0;transform:translateX(${w}px)}}`,
        );
        parts.push(
          `<g class="${name} cg"><rect x="${cx}" y="${y - 13}" width="${w + CW}" height="${LH}" fill="${COLORS.bg}"/>` +
            `<rect class="cur" x="${cx}" y="${y - 12}" width="${CW}" height="16"/></g>`,
        );
      } else if (l.kind === 'spinner') {
        const frames = SPINNER_FRAMES.map(
          (f, k) =>
            `<text class="sp c" x="${textX}" y="${y}" style="animation-delay:-${(0.8 - k * 0.08).toFixed(2)}s">${f}</text>`,
        ).join('');
        parts.push(`<g class="${lineCls}">${frames}<text x="${textX + 2 * CW}" y="${y}">${esc(l.text)}</text></g>`);
      } else {
        // Each run gets an explicit x so box-drawing tables stay aligned even if a glyph falls back
        // to another font.
        let col = 0;
        const spans = l.runs
          .map((r) => {
            const span = `<tspan x="${(textX + col * CW).toFixed(1)}"${r.cls ? ` class="${r.cls}"` : ''}>${esc(r.text)}</tspan>`;
            col += [...r.text].length;
            return span;
          })
          .join('');
        parts.push(`<g class="${lineCls}"><text y="${y}">${spans}</text></g>`);
      }
    }
    parts.push('</g></g>');
  });

  css.push(
    '@media (prefers-reduced-motion:reduce){.l,.cg,.sp{animation:none!important}.fin{opacity:1}.spl,.cg{opacity:0}}',
  );

  const label = esc(cast.alt ?? cast.title ?? 'terminal');
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" xml:space="preserve" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${label}">`,
    `<title>${label}</title>`,
    `<style>${css.join('\n')}</style>`,
    ...parts,
    '</svg>',
    '',
  ].join('\n');
}

export { visibleLength };
