/* shared chrome components */

const Bracket = ({ children, className = "", style }) => (
  <div className={`bracket ${className}`} style={style}>
    {children}
    <span className="br-tr"></span>
    <span className="br-br"></span>
  </div>
);

const Panel = ({ title, meta, right, children, className = "", style }) => (
  <div className={`panel ${className}`} style={style}>
    {title && (
      <div className="panel-tit">
        <span className="dot"></span>
        <span>{title}</span>
        {meta && <span className="meta">{meta}</span>}
        <span className="spacer"></span>
        {right}
      </div>
    )}
    {children}
  </div>
);

const SegBar = ({ count = 16, value = 0, hi = false }) => {
  const cells = [];
  for (let i = 0; i < count; i++) {
    const on = i < Math.round((value / 100) * count);
    cells.push(<i key={i} className={on ? (hi ? "hi" : "on") : ""}></i>);
  }
  return <div className="segbar">{cells}</div>;
};

// Sparkline-style ASCII vertical bars
const VBars = ({ data, color = "var(--primary)", h = 36 }) => {
  const max = Math.max(...data, 1);
  return (
    <div className="spark" style={{ height: h }}>
      {data.map((v, i) => (
        <i key={i} style={{ height: `${(v / max) * 100}%`, background: color, opacity: 0.4 + 0.6 * (v / max) }}></i>
      ))}
    </div>
  );
};

// Reticle target
const Reticle = ({ size = 14 }) => <span className="reticle" style={{ width: size, height: size }}></span>;

// timecode HH:MM:SS:FF style
const TC = ({ d }) => {
  const { pad } = window.WK_DATA.helpers;
  const f = Math.round(d.getMilliseconds() / 33);
  return (
    <span className="num">
      {pad(d.getHours())}:{pad(d.getMinutes())}:{pad(d.getSeconds())}:{pad(f)}
    </span>
  );
};

// short id with ellipsis middle
const ShortId = ({ id }) => (
  <span className="id-badge" title={id}>
    {id.slice(0, 8)}…{id.slice(-4)}
  </span>
);

// Hazard strip
const Hazard = ({ kind = "primary", style }) => (
  <div className={kind === "warn" ? "hazard-warn" : "hazard"} style={style}></div>
);

// Number with kicker label
const Stat = ({ label, value, sub, tone }) => (
  <div className="cell">
    <div className="l">{label}</div>
    <div className="v" style={tone ? { color: `var(--${tone})` } : null}>{value}</div>
    {sub && <div className="s">{sub}</div>}
  </div>
);

// Big readout bracketed block
const Readout = ({ label, value, sub, tone = "ink-strong" }) => (
  <Bracket className="panel" style={{ padding: "12px 14px" }}>
    <div className="kicker mb-1">{label}</div>
    <div className="display" style={{ fontSize: 32, color: `var(--${tone})` }}>{value}</div>
    {sub && <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>{sub}</div>}
  </Bracket>
);

// Hazard label like "EVA-01 / WARN"
const HazardTag = ({ children, tone = "warn", style }) => (
  <div style={{ display: "inline-flex", alignItems: "stretch", border: `1px solid var(--${tone})`, ...style }}>
    <div className={tone === "warn" ? "hazard-warn" : "hazard"} style={{ width: 14 }}></div>
    <div style={{
      padding: "2px 8px",
      fontFamily: "var(--display)",
      fontWeight: 700,
      letterSpacing: "0.18em",
      fontSize: 11,
      color: `var(--${tone})`,
      textTransform: "uppercase",
    }}>{children}</div>
  </div>
);

Object.assign(window, { Bracket, Panel, SegBar, VBars, Reticle, TC, ShortId, Hazard, Stat, Readout, HazardTag });
