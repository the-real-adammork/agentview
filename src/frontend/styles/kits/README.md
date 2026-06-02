# UI Kit Styling

`agentview.css` is the current base kit. It intentionally preserves the existing
layout and visual treatment after the first split from `styles/app.css`.

Future kits should:

- keep shell and view layout classes stable
- use `[data-ui-kit="<kit-name>"]` selectors for overrides
- change tokens, control treatment, states, icons, and typography before changing
  component placement
- import after `agentview.css` from `styles/app.css`
