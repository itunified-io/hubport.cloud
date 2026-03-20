import { type ReactNode, useState, useCallback, createContext, useContext } from "react";
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

const LocaleCtx = createContext<LocaleContextValue>({
  locale: "en-US",
  setLocale: () => {},
  supportedLocales: ["en-US", "de-DE"],
});

export function useLocale(): LocaleContextValue {
  return useContext(LocaleCtx);
}

// Legacy compat — deprecated, use useLocale() hook instead
export function getLocaleContext(): LocaleContextValue {
  return {
    locale: localeRef,
    setLocale: setLocaleRef,
    supportedLocales: ["en-US", "de-DE"],
  };
}

let localeRef: SupportedLocale = detectLocale();
let setLocaleRef: (l: SupportedLocale) => void = () => {};

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
    <LocaleCtx.Provider value={{ locale, setLocale, supportedLocales: ["en-US", "de-DE"] }}>
      <IntlProvider
        locale={locale}
        messages={MESSAGES[locale]}
        defaultLocale="en-US"
      >
        {children}
      </IntlProvider>
    </LocaleCtx.Provider>
  );
}
