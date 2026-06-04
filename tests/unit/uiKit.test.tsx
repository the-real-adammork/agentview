import "@testing-library/jest-dom/vitest";

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Alert, Button, Chip, Field, PanelTitle, Select, Table, TableFrame, TextInput, UiKitProvider } from "../../src/frontend/ui";

describe("frontend UI kit primitives", () => {
  it("renders AgentView primitives with the stable layout classes", () => {
    const onClick = vi.fn();

    render(
      <UiKitProvider kit="agentview">
        <PanelTitle meta="3 rows">Inspector</PanelTitle>
        <Alert>Problem loading data</Alert>
        <Chip tone="warn">warning</Chip>
        <Field>
          <span>Query</span>
          <TextInput aria-label="Query" defaultValue="agent" />
        </Field>
        <Select aria-label="Mode" defaultValue="all">
          <option value="all">All</option>
        </Select>
        <TableFrame>
          <Table aria-label="Rows">
            <tbody>
              <tr>
                <td>row</td>
              </tr>
            </tbody>
          </Table>
        </TableFrame>
        <Button onClick={onClick}>Run</Button>
      </UiKitProvider>,
    );

    expect(screen.getByText("Inspector").closest(".panel-tit")).toBeVisible();
    expect(screen.getByRole("alert")).toHaveClass("inline-alert");
    expect(screen.getByText("warning")).toHaveClass("chip", "warn");
    expect(screen.getByLabelText("Query")).toHaveValue("agent");
    expect(screen.getByLabelText("Mode")).toHaveValue("all");
    expect(screen.getByRole("table", { name: "Rows" }).parentElement).toHaveClass("table-frame");

    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
