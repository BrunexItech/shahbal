import { forwardRef, useId } from "react";

import { cn } from "@/lib/cn";

const control =
  "w-full rounded-xl border border-line bg-white px-3.5 text-base text-ink placeholder:text-slate-400 transition " +
  "focus:border-ocean focus:outline-none focus:ring-4 focus:ring-ocean/10 disabled:bg-slate-50 disabled:text-slate-400 " +
  "aria-[invalid=true]:border-kenya-red aria-[invalid=true]:ring-red-500/10";

type Wrap = { label?: React.ReactNode; hint?: React.ReactNode; error?: string; required?: boolean; className?: string };

function FieldWrap({ id, label, hint, error, required, className, children }: Wrap & { id: string; children: React.ReactNode }) {
  return (
    <div className={cn("space-y-1.5", className)}>
      {label && (
        <label htmlFor={id} className="block text-sm font-semibold text-navy-900">
          {label} {required && <span className="text-kenya-red">*</span>}
        </label>
      )}
      {children}
      {error ? <p className="text-xs font-medium text-kenya-red">{error}</p> : hint ? <p className="text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement> & Wrap & { leading?: React.ReactNode }>(
  function Input({ label, hint, error, required, className, leading, ...rest }, ref) {
    const id = useId();
    return (
      <FieldWrap id={id} {...{ label, hint, error, required, className }}>
        <div className="relative">
          {leading && <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-slate-400">{leading}</span>}
          <input ref={ref} id={id} aria-invalid={!!error} required={required} className={cn(control, "h-11", leading && "pl-10")} {...rest} />
        </div>
      </FieldWrap>
    );
  },
);

export const Select = forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement> & Wrap & { placeholder?: string }>(
  function Select({ label, hint, error, required, className, placeholder, children, ...rest }, ref) {
    const id = useId();
    return (
      <FieldWrap id={id} {...{ label, hint, error, required, className }}>
        <select
          ref={ref}
          id={id}
          aria-invalid={!!error}
          required={required}
          className={cn(control, "h-11 appearance-none bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 20 20%22 fill=%22%2364748b%22><path d=%22M5.3 7.3a1 1 0 0 1 1.4 0L10 10.6l3.3-3.3a1 1 0 1 1 1.4 1.4l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 0 1 0-1.4Z%22/></svg>')] bg-[length:18px] bg-[right_.75rem_center] bg-no-repeat pr-10")}
          {...rest}
        >
          {placeholder !== undefined && <option value="">{placeholder}</option>}
          {children}
        </select>
      </FieldWrap>
    );
  },
);

export const Textarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement> & Wrap>(
  function Textarea({ label, hint, error, required, className, ...rest }, ref) {
    const id = useId();
    return (
      <FieldWrap id={id} {...{ label, hint, error, required, className }}>
        <textarea ref={ref} id={id} aria-invalid={!!error} className={cn(control, "min-h-24 py-2.5")} {...rest} />
      </FieldWrap>
    );
  },
);

export function Segmented<T extends string>({ value, onChange, options, label }: { value: T | ""; onChange: (v: T) => void; options: { value: T; label: string }[]; label?: string }) {
  return (
    <div className="space-y-1.5">
      {label && <p className="text-sm font-semibold text-navy-900">{label}</p>}
      <div className="flex gap-1 rounded-xl bg-slate-100 p-1">
        {options.map((o) => (
          <button
            type="button"
            key={o.value}
            onClick={() => onChange(o.value)}
            className={cn(
              "h-9 flex-1 rounded-lg text-sm font-semibold transition",
              value === o.value ? "bg-white text-navy-900 shadow-sm ring-1 ring-line" : "text-muted hover:text-navy-900",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
