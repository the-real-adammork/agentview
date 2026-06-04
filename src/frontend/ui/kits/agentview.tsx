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
  UiKitComponents,
} from "../contracts";

const cx = (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(" ");

export function Button({ children, type = "button", ...props }: ButtonProps) {
  return (
    <button type={type} {...props}>
      {children}
    </button>
  );
}

export function Alert({ children, className, role = "alert", ...props }: AlertProps) {
  return (
    <div className={cx("inline-alert", className)} role={role} {...props}>
      {children}
    </div>
  );
}

export function Chip({ children, className, tone = "default", ...props }: ChipProps) {
  return (
    <span className={cx("chip", tone !== "default" && tone, className)} {...props}>
      {children}
    </span>
  );
}

export function Field({ children, className, ...props }: FieldProps) {
  return (
    <label className={cx("field", className)} {...props}>
      {children}
    </label>
  );
}

export function TextInput(props: TextInputProps) {
  return <input {...props} />;
}

export function Select(props: SelectProps) {
  return <select {...props} />;
}

export function Table({ children, ...props }: TableProps) {
  return <table {...props}>{children}</table>;
}

export function TableFrame({ children, className, ...props }: TableFrameProps) {
  return (
    <div className={cx("table-frame", className)} {...props}>
      {children}
    </div>
  );
}

export function PanelTitle({ children, className, meta, ...props }: PanelTitleProps) {
  return (
    <div className={cx("panel-tit", className)} {...props}>
      <span className="dot" />
      <span>{children}</span>
      {meta !== undefined ? (
        <>
          <span className="spacer" />
          <span className="meta">{meta}</span>
        </>
      ) : null}
    </div>
  );
}

export const agentViewKit: UiKitComponents = {
  Alert,
  Button,
  Chip,
  Field,
  PanelTitle,
  Select,
  Table,
  TableFrame,
  TextInput,
};
