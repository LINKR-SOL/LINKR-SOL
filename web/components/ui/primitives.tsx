"use client";

import Link from "next/link";
import { ArrowRight, CaretDown } from "@/components/ui/icons";
import type { Route } from "next";
import {
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
};

export function Button({ variant = "primary", size = "md", loading, className, children, disabled, ...rest }: ButtonProps) {
  const base = "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-[transform,background-color,border-color,color] duration-150 ease-[var(--ease-out)] active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100";
  const sizes = { sm: "h-8 px-3 text-xs", md: "h-10 px-4 text-sm", lg: "h-12 px-5 text-base" }[size];
  const variants = {
    primary: "btn-primary",   // styled in cinematic.css — see "Primary button"
    secondary: "bg-surface-2 border border-border hover:border-border-strong text-text",
    ghost: "text-muted hover:text-text hover:bg-surface-2",
    danger: "bg-danger-soft text-danger border border-danger/30 hover:bg-danger/20",
  }[variant];
  return (
    <button className={cx(base, sizes, variants, className)} disabled={disabled || loading} {...rest}>
      {loading && <Spinner />}
      {children}
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cx("animate-spin [animation-duration:0.6s] h-4 w-4", className)} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
      <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8v3a5 5 0 00-5 5H4z" />
    </svg>
  );
}

export function Card({ children, className, title, action }: { children: ReactNode; className?: string; title?: ReactNode; action?: ReactNode }) {
  return (
    <section className={cx("rounded-[var(--radius-card)] border border-border bg-surface", className)}>
      {(title || action) && (
        <header className="flex items-center justify-between px-5 pt-4 pb-2">
          <h3 className="text-sm font-semibold text-text">{title}</h3>
          {action}
        </header>
      )}
      <div className="px-5 pb-5 pt-2">{children}</div>
    </section>
  );
}

export function Badge({ children, tone = "neutral", title }: { children: ReactNode; tone?: "neutral" | "accent" | "warn" | "danger" | "success"; title?: string }) {
  const tones = {
    neutral: "bg-surface-2 text-muted border-border",
    accent: "bg-accent-soft text-accent border-accent/30",
    warn: "bg-warn-soft text-warn border-warn/30",
    danger: "bg-danger-soft text-danger border-danger/30",
    success: "bg-success-soft text-success border-success/30",
  }[tone];
  return (
    <span title={title} className={cx("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium leading-4", tones)}>
      {children}
    </span>
  );
}

export function Stat({ label, value, sub, info, className }: { label: string; value: ReactNode; sub?: ReactNode; info?: ReactNode; className?: string }) {
  return (
    <div className={cx("rounded-lg border border-border bg-surface-2/60 px-4 py-3", className)}>
      <div className="flex items-center gap-1 text-[11px] uppercase tracking-wider text-faint">
        {label}
        {info}
      </div>
      <div className="num text-lg font-semibold mt-0.5">{value}</div>
      {sub && <div className="text-xs text-muted mt-0.5">{sub}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("skeleton rounded-md", className)} />;
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cx(
        "w-full h-10 rounded-lg border border-border bg-surface-2 px-3 text-sm text-text placeholder:text-faint outline-none focus:border-accent/60 focus:ring-2 focus:ring-accent/20",
        className,
      )}
      {...rest}
    />
  );
}

/**
 * One labelled form control.
 *
 * Placeholder-only forms lose their labels the moment you type, which leaves a column of identical
 * pills and nothing telling a screen reader what any of them are. The label is real and bound to the
 * control; the hint carries the constraint so it does not have to live in the label.
 */
export function Field({
  label,
  htmlFor,
  hint,
  required,
  error,
  children,
}: {
  label: ReactNode;
  htmlFor?: string;
  hint?: ReactNode;
  required?: boolean;
  error?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-3 mb-1.5">
        <label htmlFor={htmlFor} className="text-xs font-medium text-text">
          {label}
          {required && <span className="text-accent ml-0.5" aria-hidden>*</span>}
        </label>
        {hint && <span className="text-[11px] text-faint shrink-0">{hint}</span>}
      </div>
      {children}
      {error && <p className="text-[11px] text-danger mt-1.5">{error}</p>}
    </div>
  );
}

const CONTROL =
  "w-full rounded-lg border border-border bg-surface-2 text-sm text-text placeholder:text-faint outline-none transition-[border-color,box-shadow] duration-150 focus:border-accent/60 focus:ring-2 focus:ring-accent/20";

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cx(CONTROL, "px-3 py-2.5 leading-relaxed resize-y min-h-[76px]", className)} {...rest} />;
}

/** Native select, styled to match Input; the arrow is ours so it looks the same across platforms. */
export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative">
      <select className={cx(CONTROL, "h-10 pl-3 pr-9 appearance-none cursor-pointer truncate", className)} {...rest}>
        {children}
      </select>
      <CaretDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-faint" />
    </div>
  );
}

/** A row that reads as a sentence and toggles as a whole, rather than a bare checkbox and a paragraph. */
export function CheckboxRow({
  checked,
  onChange,
  title,
  body,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  title: ReactNode;
  body?: ReactNode;
}) {
  return (
    <label
      className={cx(
        "flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-[border-color,background-color] duration-150",
        checked ? "border-accent/40 bg-accent-soft" : "border-border bg-surface-2 hover:border-border-strong",
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--accent)] cursor-pointer"
      />
      <span className="min-w-0">
        <span className={cx("block text-sm", checked ? "text-accent" : "text-text")}>{title}</span>
        {body && <span className="block text-xs text-muted mt-0.5 leading-relaxed">{body}</span>}
      </span>
    </label>
  );
}

/** Large numeric field used by swap / liquidity forms. */
export function AmountInput({
  value,
  onChange,
  placeholder = "0.0",
  disabled,
  right,
  below,
  invalid,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
  right?: ReactNode;
  below?: ReactNode;
  invalid?: boolean;
}) {
  return (
    <div className={cx("rounded-xl border bg-surface-2 px-4 py-3", invalid ? "border-danger/50" : "border-border focus-within:border-accent/50")}>
      <div className="flex items-center gap-3">
        <input
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          className="num flex-1 min-w-0 bg-transparent text-2xl outline-none placeholder:text-faint disabled:text-muted"
          placeholder={placeholder}
          value={value}
          disabled={disabled}
          onChange={(e) => {
            const v = e.target.value.replace(/,/g, "");
            if (v === "" || /^\d*\.?\d*$/.test(v)) onChange(v);
          }}
        />
        {right}
      </div>
      {below && <div className="mt-2 flex items-center justify-between text-xs text-muted">{below}</div>}
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <div className="inline-flex rounded-lg border border-border bg-surface-2 p-0.5 text-sm">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={cx("px-3 py-1.5 rounded-md transition-colors", value === o.value ? "bg-surface-3 text-text" : "text-muted hover:text-text")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: { href: Route; label: string } }) {
  return (
    <div className="text-center py-14 border border-dashed border-border rounded-[var(--radius-card)]">
      <div className="font-medium">{title}</div>
      {body && <div className="text-sm text-muted mt-1 max-w-md mx-auto">{body}</div>}
      {action && (
        <Link href={action.href} className="inline-flex items-center gap-1.5 mt-4 text-sm text-accent hover:underline">
          {action.label}
          <ArrowRight size={15} aria-hidden="true" />
        </Link>
      )}
    </div>
  );
}

export function Callout({ tone = "warn", children }: { tone?: "warn" | "danger" | "info" | "success"; children: ReactNode }) {
  const tones = {
    warn: "border-warn/30 bg-warn-soft text-warn",
    danger: "border-danger/30 bg-danger-soft text-danger",
    info: "border-accent/30 bg-accent-soft text-accent",
    // For "this worked, nothing to do": the accent reads as an alert, which is the wrong nudge here.
    success: "border-success/30 bg-success-soft text-success",
  }[tone];
  return <div className={cx("rounded-lg border px-3 py-2 text-xs leading-relaxed", tones)}>{children}</div>;
}
