import type {
  AlertProps,
  ButtonProps,
  ChipProps,
  FieldProps,
  PanelTitleProps,
  SelectProps,
  TableFrameProps,
  TableProps,
  TextInputProps,
} from "./contracts";
import { useUiKitComponents } from "./UiKitProvider";

export type { UiKitId, UiTone } from "./contracts";
export { UiKitProvider, useUiKitComponents } from "./UiKitProvider";

export function Button(props: ButtonProps) {
  const kit = useUiKitComponents();
  return kit.Button(props);
}

export function Alert(props: AlertProps) {
  const kit = useUiKitComponents();
  return kit.Alert(props);
}

export function Chip(props: ChipProps) {
  const kit = useUiKitComponents();
  return kit.Chip(props);
}

export function Field(props: FieldProps) {
  const kit = useUiKitComponents();
  return kit.Field(props);
}

export function TextInput(props: TextInputProps) {
  const kit = useUiKitComponents();
  return kit.TextInput(props);
}

export function Select(props: SelectProps) {
  const kit = useUiKitComponents();
  return kit.Select(props);
}

export function Table(props: TableProps) {
  const kit = useUiKitComponents();
  return kit.Table(props);
}

export function TableFrame(props: TableFrameProps) {
  const kit = useUiKitComponents();
  return kit.TableFrame(props);
}

export function PanelTitle(props: PanelTitleProps) {
  const kit = useUiKitComponents();
  return kit.PanelTitle(props);
}
