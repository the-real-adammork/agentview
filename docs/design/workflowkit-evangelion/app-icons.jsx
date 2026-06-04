/* ============================================================
   WORKFLOWKIT // OBSERVATORY — macOS app-icon explorations
   SVG icon factory (viewBox 1024²) + design-canvas presentation
   ============================================================ */

const PR   = '#ff6b1a';   // primary orange
const PRB  = '#ff8a3d';   // primary bright
const BASE = '#050403';   // near-black
const INK  = '#ffd9ad';   // warm ink
const AMBER= '#ffb800';
const WARN = '#ff2d4d';
const CYAN = '#46d8ff';
const GOOD = '#6cf099';

let _uid = 0;

/* ---- shared SVG fragments -------------------------------------------- */

function bgDefs(u, glow = PR) {
  return `
    <radialGradient id="glow_${u}" cx="50%" cy="26%" r="82%">
      <stop offset="0%"  stop-color="${glow}" stop-opacity="0.26"/>
      <stop offset="42%" stop-color="${glow}" stop-opacity="0.06"/>
      <stop offset="100%" stop-color="${glow}" stop-opacity="0"/>
    </radialGradient>
    <pattern id="grid_${u}" width="64" height="64" patternUnits="userSpaceOnUse">
      <path d="M64 0H0V64" fill="none" stroke="${PR}" stroke-opacity="0.09" stroke-width="1.5"/>
    </pattern>
    <pattern id="scan_${u}" width="6" height="6" patternUnits="userSpaceOnUse">
      <rect width="6" height="3" y="3" fill="#000" fill-opacity="0.17"/>
    </pattern>
    <filter id="soft_${u}" x="-40%" y="-40%" width="180%" height="180%">
      <feGaussianBlur stdDeviation="16"/>
    </filter>`;
}

function darkPlate(u) {
  return `
    <rect width="1024" height="1024" fill="${BASE}"/>
    <rect width="1024" height="1024" fill="url(#grid_${u})"/>
    <rect width="1024" height="1024" fill="url(#glow_${u})"/>`;
}

const scan = (u) => `<rect width="1024" height="1024" fill="url(#scan_${u})"/>`;

function brackets(color, op, m = 78, len = 104, w = 9) {
  return `<g stroke="${color}" stroke-opacity="${op}" stroke-width="${w}" fill="none" stroke-linecap="square">
    <path d="M${m} ${m + len} V${m} H${m + len}"/>
    <path d="M${1024 - m - len} ${m} H${1024 - m} V${m + len}"/>
    <path d="M${1024 - m} ${1024 - m - len} V${1024 - m} H${1024 - m - len}"/>
    <path d="M${m + len} ${1024 - m} H${m} V${1024 - m - len}"/>
  </g>`;
}

// notched square (the WK mark silhouette): top-right corner cut, bottom-right chamfer
function notch(x, y, s, fill, extra = '') {
  const c = s * 0.30;
  const d = `M${x} ${y} H${x + s} V${y + s - c} L${x + s - c} ${y + s} H${x} Z`;
  return `<path d="${d}" fill="${fill}" ${extra}/>`;
}

function frame(inner, u) {
  return `<svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg"><defs>${bgDefs(u)}</defs>${inner}</svg>`;
}

/* ---- concepts -------------------------------------------------------- */

function icoMark(u) {                                   // A · WK monogram
  const s = 540, x = (1024 - s) / 2, y = (1024 - s) / 2;
  return frame(`
    ${darkPlate(u)}
    ${brackets(PR, 0.34)}
    <g filter="url(#soft_${u})" opacity="0.55">${notch(x, y, s, PR)}</g>
    <linearGradient id="mk_${u}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${PRB}"/><stop offset="1" stop-color="${PR}"/>
    </linearGradient>
    ${notch(x, y, s, `url(#mk_${u})`)}
    ${scan(u)}
  `, u);
}

function icoSolid(u) {                                  // B · solid field
  return frame(`
    <linearGradient id="fld_${u}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${PRB}"/><stop offset="1" stop-color="#f0590c"/>
    </linearGradient>
    <rect width="1024" height="1024" fill="url(#fld_${u})"/>
    <rect width="1024" height="1024" fill="url(#scan_${u})" opacity="1.4"/>
    <g transform="translate(0,838)">
      <rect x="0" y="0" width="1024" height="58" fill="${BASE}"/>
      <g fill="${PR}">
        ${Array.from({ length: 17 }, (_, i) => `<rect x="${i * 64 + 12}" y="14" width="30" height="30"/>`).join('')}
      </g>
    </g>
  `, u);
}

function icoReticle(u) {                                // C · observatory reticle
  return frame(`
    ${darkPlate(u)}
    ${brackets(PR, 0.3)}
    <g fill="none" stroke="${PR}" stroke-width="13">
      <circle cx="512" cy="512" r="372" stroke-dasharray="498 75" stroke-dashoffset="38"/>
    </g>
    <circle cx="512" cy="512" r="246" fill="none" stroke="${PRB}" stroke-width="8" stroke-opacity="0.9"/>
    <g stroke="${PR}" stroke-width="12" stroke-linecap="round">
      <line x1="512" y1="96"  x2="512" y2="246"/>
      <line x1="512" y1="778" x2="512" y2="928"/>
      <line x1="96"  y1="512" x2="246" y2="512"/>
      <line x1="778" y1="512" x2="928" y2="512"/>
      <line x1="512" y1="320" x2="512" y2="430"/>
      <line x1="512" y1="594" x2="512" y2="704"/>
      <line x1="320" y1="512" x2="430" y2="512"/>
      <line x1="594" y1="512" x2="704" y2="512"/>
    </g>
    <g fill="${WARN}"><circle cx="512" cy="512" r="34" filter="url(#soft_${u})" opacity="0.9"/></g>
    <circle cx="512" cy="512" r="26" fill="${PRB}"/>
    <circle cx="512" cy="512" r="11" fill="${BASE}"/>
    ${scan(u)}
  `, u);
}

function icoTerm(u) {                                   // D · terminal prompt
  return frame(`
    ${darkPlate(u)}
    ${brackets(PR, 0.28)}
    <g fill="none" stroke="${PR}" stroke-width="76" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="300,330 560,512 300,694"/>
    </g>
    <rect x="600" y="600" width="300" height="78" rx="6" fill="${PRB}"/>
    <rect x="600" y="600" width="300" height="78" rx="6" fill="${PRB}" filter="url(#soft_${u})" opacity="0.5"/>
    ${scan(u)}
  `, u);
}

function icoHazard(u) {                                 // E · hazard medallion
  return frame(`
    <pattern id="hz_${u}" width="120" height="120" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">
      <rect width="120" height="120" fill="${BASE}"/>
      <rect width="60" height="120" fill="${PR}"/>
    </pattern>
    <rect width="1024" height="1024" fill="url(#hz_${u})"/>
    <rect x="170" y="170" width="684" height="684" rx="54" fill="${BASE}"/>
    <rect x="170" y="170" width="684" height="684" rx="54" fill="none" stroke="${PR}" stroke-width="11"/>
    <rect x="170" y="170" width="684" height="684" rx="54" fill="url(#glow_${u})"/>
    ${scan(u)}
  `, u);
}

function icoGraph(u) {                                  // F · agent graph
  const node = (x, y, s, c, glow) =>
    `${glow ? `<g filter="url(#soft_${u})" opacity="0.7">${notch(x - s / 2, y - s / 2, s, c)}</g>` : ''}
     ${notch(x - s / 2, y - s / 2, s, c)}`;
  return frame(`
    ${darkPlate(u)}
    ${brackets(PR, 0.26)}
    <g fill="none" stroke="${AMBER}" stroke-width="11" stroke-opacity="0.85">
      <path d="M512 286 V412 H318 V498"/>
      <path d="M512 412 H706 V498"/>
      <path d="M706 600 V690 H706 V740"/>
    </g>
    ${node(512, 248, 120, PR, true)}
    ${node(318, 556, 104, AMBER, false)}
    ${node(706, 556, 104, AMBER, false)}
    ${node(706, 800, 104, CYAN, false)}
    <circle cx="754" cy="752" r="20" fill="${WARN}"/>
    <circle cx="754" cy="752" r="20" fill="${WARN}" filter="url(#soft_${u})" opacity="0.7"/>
    ${scan(u)}
  `, u);
}

const MAKERS = {
  mark: icoMark, solid: icoSolid, reticle: icoReticle,
  term: icoTerm, hazard: icoHazard, graph: icoGraph,
};

function makeIcon(concept, size) {
  const u = `${concept}_${size}_${_uid++}`;
  return MAKERS[concept](u);
}

/* ---- presentation ---------------------------------------------------- */

const CONCEPTS = [
  { key: 'mark',    no: '01', name: 'MONOGRAM',     tag: 'The notched WK mark, lit on the grid' },
  { key: 'solid',   no: '02', name: 'SOLID FIELD',  tag: 'Inverted — black WK on hot orange. Loudest in the dock' },
  { key: 'reticle', no: '03', name: 'RETICLE',      tag: 'Observatory scope — targeting ring + crosshair' },
  { key: 'term',    no: '04', name: 'PROMPT',       tag: 'Terminal chevron + block cursor. Reads tiny' },
  { key: 'hazard',  no: '05', name: 'HAZARD',       tag: 'Hazard tape framing a WK medallion' },
  { key: 'graph',   no: '06', name: 'AGENT GRAPH',  tag: 'The session thread tree as a mark' },
];

/* ---- text overlays (HTML, so the webfont always applies) ------------- */
// pos/size are fractions of the icon's pixel size, so they scale to any size.
const BS = "'Big Shoulders Display', sans-serif";
const JM = "'JetBrains Mono', monospace";
const SM = "'Shippori Mincho', serif";
const OVERLAYS = {
  mark: [
    { t: 'WK', top: 0.515, sz: 0.31, w: 800, f: BS, c: BASE, ls: -0.03 },
  ],
  solid: [
    { t: 'WK', top: 0.455, sz: 0.42, w: 800, f: BS, c: BASE, ls: -0.04 },
    { t: 'OBSERVATORY', top: 0.725, sz: 0.056, w: 700, f: JM, c: BASE, ls: 0.34, o: 0.9 },
  ],
  reticle: [],
  hazard: [
    { t: 'WK', top: 0.485, sz: 0.295, w: 800, f: BS, c: PR, ls: -0.03 },
    { t: '観測装置', top: 0.67, sz: 0.043, w: 700, f: SM, c: INK, ls: 0.12, o: 0.78 },
  ],
  term: [],
  graph: [],
};

function Ico({ concept, size }) {
  const ov = OVERLAYS[concept] || [];
  return (
    <div className="ico" style={{ width: size, height: size }}>
      <div className="ico-svg" dangerouslySetInnerHTML={{ __html: makeIcon(concept, size) }} />
      {ov.map((o, i) => (
        <span key={i} className="ico-tx" style={{
          top: `${o.top * 100}%`,
          fontFamily: o.f, fontWeight: o.w,
          fontSize: size * o.sz,
          letterSpacing: `${o.ls}em`,
          color: o.c, opacity: o.o == null ? 1 : o.o,
        }}>{o.t}</span>
      ))}
    </div>
  );
}

function ConceptCard({ c }) {
  return (
    <div className="ic-card">
      <div className="ic-head">
        <span className="ic-no">{c.no}</span>
        <span className="ic-name">{c.name}</span>
      </div>
      <div className="ic-tag">{c.tag}</div>
      <div className="ic-hero">
        <Ico concept={c.key} size={300} />
      </div>
      <div className="ic-cap">1024 × 1024 — master</div>
      <div className="ic-strip">
        {[128, 64, 32].map((s) => (
          <div className="ic-cell" key={s}>
            <Ico concept={c.key} size={s} />
            <span className="ic-px">{s}px</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function App() {
  return (
    <DesignCanvas>
      <DCSection id="icons" title="WORKFLOWKIT · OBSERVATORY — macOS app icon"
        subtitle="Six directions · 1024² masters with legibility tests at 128 / 64 / 32px">
        {CONCEPTS.map((c) => (
          <DCArtboard key={c.key} id={c.key} label={`${c.no} · ${c.name}`} width={430} height={560}>
            <ConceptCard c={c} />
          </DCArtboard>
        ))}
      </DCSection>
    </DesignCanvas>
  );
}

const _root = ReactDOM.createRoot(document.getElementById('root'));
// SVG <text> won't pick up a webfont that loads after paint, so wait until the
// Big Shoulders / JetBrains faces are ready before first render.
const _fonts = [
  '800 300px "Big Shoulders Display"',
  '700 60px "JetBrains Mono"',
  '700 44px "Shippori Mincho"',
];
Promise.all(_fonts.map((f) => (document.fonts ? document.fonts.load(f) : Promise.resolve())))
  .catch(() => {})
  .finally(() => {
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => _root.render(<App />));
    } else {
      _root.render(<App />);
    }
  });
