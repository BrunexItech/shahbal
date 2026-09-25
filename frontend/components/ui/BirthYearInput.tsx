"use client";

import { Check, TriangleAlert } from "lucide-react";

import { Input } from "@/components/ui";

export const ADULT_AGE = 18;
const thisYear = () => new Date().getFullYear();

/** The age a 4-digit year gives this year, or a reason it can't be used. */
export function ageFrom(year: string): { age: number } | { error: "incomplete" | "invalid" | "minor"; age?: number } {
  if (!/^\d{4}$/.test(year)) return { error: "incomplete" };
  const y = +year;
  const age = thisYear() - y;
  if (y < 1900 || y > thisYear()) return { error: "invalid" };
  if (age < ADULT_AGE) return { error: "minor", age };
  return { age };
}

/** Validation message for a required year of birth (null = fine). */
export function birthYearError(year: string, lang: "en" | "sw" = "en"): string | null {
  const r = ageFrom(year);
  if (!("error" in r)) return null;
  if (r.error === "minor") return lang === "sw" ? `Lazima uwe na miaka ${ADULT_AGE} au zaidi` : `Must be ${ADULT_AGE} or older to register`;
  if (r.error === "invalid") return lang === "sw" ? "Andika mwaka sahihi" : "Enter a real year of birth";
  return lang === "sw" ? "Andika mwaka wako wa kuzaliwa (tarakimu 4)" : "Enter the year of birth (4 digits)";
}

/**
 * Required year of birth that shows the age as soon as four digits are typed:
 * green for adults, red for under-18s (who can't register).
 */
export function BirthYearInput({ value, onChange, error, label, lang = "en" }: {
  value: string; onChange: (v: string) => void; error?: string; label?: string; lang?: "en" | "sw";
}) {
  const r = ageFrom(value);
  const hint = "error" in r
    ? r.error === "minor" ? { ok: false, text: lang === "sw" ? `Miaka ${r.age}: lazima uwe na miaka ${ADULT_AGE} au zaidi` : `Age ${r.age}: must be ${ADULT_AGE} or older to register` }
      : r.error === "invalid" ? { ok: false, text: lang === "sw" ? "Mwaka huu si sahihi" : "That year doesn't look right" } : null
    : { ok: true, text: lang === "sw" ? `Umri: miaka ${r.age}` : `Age ${r.age}` };
  return (
    <div>
      <Input label={label ?? (lang === "sw" ? "Mwaka wa kuzaliwa" : "Year of birth")} required inputMode="numeric" maxLength={4}
        value={value} error={hint && !hint.ok ? undefined : error} placeholder="1994"
        onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 4))} aria-describedby="birth-year-age" />
      {hint && (
        <p id="birth-year-age" role="status" className={`mt-1.5 inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-semibold ${hint.ok ? "bg-kenya-green-50 text-kenya-green" : "bg-red-50 text-kenya-red"}`}>
          {hint.ok ? <Check className="size-3.5" /> : <TriangleAlert className="size-3.5" />}{hint.text}
        </p>
      )}
    </div>
  );
}
