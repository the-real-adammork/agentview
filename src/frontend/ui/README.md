# Frontend UI Kit

`src/frontend/ui` is the runtime-swappable component boundary for generic UI.

Views should import generic controls from this folder instead of rendering raw
controls directly:

- `Button`
- `Alert`
- `Chip`
- `Field`
- `TextInput`
- `Select`
- `Table`
- `TableFrame`
- `PanelTitle`

The current kit is `agentview`, which preserves the existing class names and
DOM structure so shell and view layout CSS remain stable. Future kits should
implement the same contracts in `ui/kits/` and scope visual overrides through
`data-ui-kit`.
