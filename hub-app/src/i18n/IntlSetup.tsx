import { type ReactNode, useState, useCallback } from "react";
import { IntlProvider } from "react-intl";
import enUS from "./messages/en-US.json";
import deDE from "./messages/de-DE.json";

type SupportedLocale = "en-US" | "de-DE";

const MESSAGES: Record<SupportedLocale, Record<string, string>> = {
  "en-US": enUS,
  "de-DE": deDE,
};

function detectLocale(): SupportedLocale {
  const stored = localStorage.getItem("hubport-locale");
  if (stored && stored in MESSAGES) return stored as SupportedLocale;

  const browserLang = navigator.language;
  if (browserLang.startsWith("de")) return "de-DE";
  return "en-US";
}

interface LocaleContextValue {
  locale: SupportedLocale;
  setLocale: (locale: SupportedLocale) => void;
  supportedLocales: SupportedLocale[];
}

export const LocaleContext = {
  locale: "en-US" as SupportedLocale,
  setLocale: (_locale: SupportedLocale) => {},
  supportedLocales: ["en-US", "de-DE"] as SupportedLocale[],
};

// We export a mutable ref so components can read/set locale without React context overhead
let localeRef = detectLocale();
let setLocaleRef: (l: SupportedLocale) => void = () => {};

export function getLocaleContext(): LocaleContextValue {
  return {
    locale: localeRef,
    setLocale: setLocaleRef,
    supportedLocales: ["en-US", "de-DE"],
  };
}

interface IntlSetupProps {
  children: ReactNode;
}

export function IntlSetup({ children }: IntlSetupProps) {
  const [locale, setLocaleState] = useState<SupportedLocale>(detectLocale);

  const setLocale = useCallback((newLocale: SupportedLocale) => {
    localStorage.setItem("hubport-locale", newLocale);
    localeRef = newLocale;
    setLocaleState(newLocale);
  }, []);

  localeRef = locale;
  setLocaleRef = setLocale;

  return (
    <IntlProvider
      locale={locale}
      messages={MESSAGES[locale]}
      defaultLocale="en-US"
    >
      {children}
    </IntlProvider>
  );
}
