import { useId, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from "react";
import styles from "./field.module.css";

interface FieldProps {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  children: (props: { id: string; "aria-describedby"?: string; "aria-invalid"?: boolean }) => ReactNode;
}

export function Field({ label, hint, error, children }: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className={styles.field}>
      <label htmlFor={id} className={styles.label}>
        {label}
      </label>
      {children({ id, "aria-describedby": describedBy, "aria-invalid": error ? true : undefined })}
      {error ? (
        <span id={errorId} className={styles.error}>
          {error}
        </span>
      ) : hint ? (
        <span id={hintId} className={styles.hint}>
          {hint}
        </span>
      ) : null}
    </div>
  );
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={[styles.input, props.className].filter(Boolean).join(" ")} />;
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={[styles.input, styles.textarea, props.className].filter(Boolean).join(" ")} />;
}

export function Chips<T extends string | number>({ options, value, onChange, label }: { options: { value: T; label: string }[]; value: T | null; onChange: (v: T) => void; label: string }) {
  return (
    <div className={styles.chips} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.value)} type="button" role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
