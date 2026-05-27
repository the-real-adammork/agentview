import type { ReactNode } from "react";

interface PanelProps {
  children: ReactNode;
  eyebrow?: string;
  title: string;
}

export function Panel({ children, eyebrow, title }: PanelProps) {
  return (
    <section className="panel" aria-labelledby={`${title.toLowerCase().replaceAll(" ", "-")}-title`}>
      <div className="panel__header">
        {eyebrow ? <p className="panel__eyebrow">{eyebrow}</p> : null}
        <h1 id={`${title.toLowerCase().replaceAll(" ", "-")}-title`}>{title}</h1>
      </div>
      <div className="panel__body">{children}</div>
    </section>
  );
}
