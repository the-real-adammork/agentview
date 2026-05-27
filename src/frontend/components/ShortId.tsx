interface ShortIdProps {
  value: string;
}

export function ShortId({ value }: ShortIdProps) {
  return (
    <code className="short-id" title={value}>
      {value.slice(0, 8)}
    </code>
  );
}
