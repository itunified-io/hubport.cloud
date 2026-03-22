/**
 * CodeValidation — OTP-style 6-digit code entry.
 * 6 individual inputs, paste support, auto-advance, backspace navigation.
 */
import { useRef, useState, type ClipboardEvent, type KeyboardEvent, type ReactNode } from "react";
import { useIntl, FormattedMessage } from "react-intl";

interface Props {
  onSubmit: (code: string) => void;
  loading: boolean;
  error: string | null;
}

export function CodeValidation({ onSubmit, loading, error }: Props): ReactNode {
  const intl = useIntl();
  const [digits, setDigits] = useState<string[]>(["", "", "", "", "", ""]);
  const inputs = useRef<(HTMLInputElement | null)[]>([]);

  const getValue = (d: string[]) => d.join("");

  const handleChange = (index: number, value: string) => {
    const char = value.replace(/[^A-Za-z0-9]/g, "").slice(-1).toUpperCase();
    const next = [...digits];
    next[index] = char;
    setDigits(next);
    if (char && index < 5) {
      inputs.current[index + 1]?.focus();
    }
    if (char && index === 5) {
      const code = getValue(next);
      if (code.length === 6) onSubmit(code);
    }
  };

  const handleKeyDown = (index: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace") {
      if (digits[index]) {
        const next = [...digits];
        next[index] = "";
        setDigits(next);
      } else if (index > 0) {
        inputs.current[index - 1]?.focus();
      }
    } else if (e.key === "ArrowLeft" && index > 0) {
      inputs.current[index - 1]?.focus();
    } else if (e.key === "ArrowRight" && index < 5) {
      inputs.current[index + 1]?.focus();
    } else if (e.key === "Enter") {
      const code = getValue(digits);
      if (code.length === 6) onSubmit(code);
    }
  };

  const handlePaste = (e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const text = e.clipboardData.getData("text").replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 6);
    if (!text) return;
    const next = ["", "", "", "", "", ""];
    for (let i = 0; i < text.length; i++) next[i] = text[i] ?? "";
    setDigits(next);
    const focusIdx = Math.min(text.length, 5);
    inputs.current[focusIdx]?.focus();
    if (text.length === 6) onSubmit(text);
  };

  const handleSubmit = () => {
    const code = getValue(digits);
    if (code.length === 6) onSubmit(code);
  };

  return (
    <div className="w-full max-w-md">
      <h2 className="text-xl font-bold text-[var(--text)] text-center mb-2">
        <FormattedMessage id="invite.code.title" />
      </h2>
      <p className="text-[var(--text-muted)] text-center text-sm mb-6">
        <FormattedMessage id="invite.code.subtitle" />
      </p>

      {error && (
        <div className="mb-4 p-3 bg-[var(--red)]/10 border border-[var(--red)]/30 rounded-[var(--radius)] text-[var(--red)] text-sm text-center">
          {error}
        </div>
      )}

      <div className="flex gap-3 justify-center mb-6">
        {digits.map((digit, i) => (
          <input
            key={i}
            ref={(el) => { inputs.current[i] = el; }}
            type="text"
            inputMode="text"
            maxLength={1}
            value={digit}
            onChange={(e) => handleChange(i, e.target.value)}
            onKeyDown={(e) => handleKeyDown(i, e)}
            onPaste={handlePaste}
            disabled={loading}
            className="w-12 h-14 text-center text-xl font-bold bg-[var(--input,var(--bg-2))] border border-[var(--border)] rounded-[var(--radius)] text-[var(--text)] focus:outline-none focus:border-[var(--amber)] transition-colors disabled:opacity-50"
            aria-label={intl.formatMessage({ id: "invite.code.placeholder" }) + ` ${i + 1}`}
          />
        ))}
      </div>

      <button
        onClick={handleSubmit}
        disabled={getValue(digits).length !== 6 || loading}
        className="w-full py-2 bg-[var(--amber)] hover:bg-[var(--amber-light)] disabled:bg-[var(--border)] disabled:text-[var(--text-muted)] text-black font-semibold rounded-[var(--radius)] transition-colors cursor-pointer disabled:cursor-not-allowed"
      >
        {loading ? "..." : intl.formatMessage({ id: "invite.code.submit" })}
      </button>
    </div>
  );
}
