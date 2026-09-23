import { Check } from "lucide-react";

export function SuccessPanel({ title, children, actions }: { title: string; children?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="flex animate-fade-up flex-col items-center px-6 py-10 text-center">
      <div className="relative grid size-20 place-items-center">
        <span className="absolute inset-0 animate-pulse-ring rounded-full bg-kenya-green/25" />
        <span className="relative grid size-20 place-items-center rounded-full bg-kenya-green text-white shadow-xl shadow-kenya-green/30">
          <Check className="size-10" strokeWidth={3} />
        </span>
      </div>
      <h2 className="mt-6 text-2xl font-bold text-navy-900">{title}</h2>
      <div className="mt-3 w-full max-w-sm text-sm text-muted">{children}</div>
      {actions && <div className="mt-8 flex w-full max-w-sm flex-col gap-2">{actions}</div>}
    </div>
  );
}
