import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  InputHTMLAttributes,
  LabelHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TableHTMLAttributes,
} from "react";

export type UiKitId = "agentview";

export type UiTone = "default" | "dim" | "warn" | "amber" | "good" | "cyan";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement>;

export interface AlertProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export interface ChipProps extends HTMLAttributes<HTMLSpanElement> {
  children: ReactNode;
  tone?: UiTone;
}

export interface FieldProps extends LabelHTMLAttributes<HTMLLabelElement> {
  children: ReactNode;
}

export type TextInputProps = InputHTMLAttributes<HTMLInputElement>;

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement>;

export type TableProps = TableHTMLAttributes<HTMLTableElement>;

export interface TableFrameProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export interface PanelTitleProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  meta?: ReactNode;
}

export interface UiKitComponents {
  Alert: (props: AlertProps) => ReactNode;
  Button: (props: ButtonProps) => ReactNode;
  Chip: (props: ChipProps) => ReactNode;
  Field: (props: FieldProps) => ReactNode;
  PanelTitle: (props: PanelTitleProps) => ReactNode;
  Select: (props: SelectProps) => ReactNode;
  Table: (props: TableProps) => ReactNode;
  TableFrame: (props: TableFrameProps) => ReactNode;
  TextInput: (props: TextInputProps) => ReactNode;
}
