import { useState } from "react";

interface ToolOutputPreviewProps {
  preview?: string;
  outputBytes?: number;
  collapsed?: boolean;
}

export function ToolOutputPreview({ preview, outputBytes = 0, collapsed = false }: ToolOutputPreviewProps) {
  const [expanded, setExpanded] = useState(!collapsed);

  if (!preview) {
    return null;
  }

  const visibleText = expanded ? preview : `${preview.slice(0, 360)}${preview.length > 360 ? "..." : ""}`;

  return (
    <div className="tool-output">
      <pre>{visibleText}</pre>
      {collapsed ? (
        <button className="tool-output__toggle" type="button" onClick={() => setExpanded((current) => !current)}>
          {expanded ? "Collapse output" : `Expand ${Math.round(outputBytes / 1024)}KB output`}
        </button>
      ) : null}
    </div>
  );
}
