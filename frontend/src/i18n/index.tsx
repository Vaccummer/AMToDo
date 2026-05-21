import { createContext, useContext, useMemo, type ReactNode } from "react";
import { zhCN } from "./zh-CN";
import { en } from "./en";

export type Locale = "zh-CN" | "en";

type Messages = Record<string, string>;
type Params = Record<string, string | number>;

const dictionaries: Record<Locale, Messages> = { "zh-CN": zhCN, en };

interface I18nContextValue {
  locale: Locale;
  t: (key: string, params?: Params) => string;
}

const I18nContext = createContext<I18nContextValue>({
  locale: "zh-CN",
  t: (key) => key,
});

export function I18nProvider({ locale, children }: { locale: string; children: ReactNode }) {
  const value = useMemo<I18nContextValue>(() => {
    const validLocale: Locale = locale === "en" ? "en" : "zh-CN";
    const dict = dictionaries[validLocale];
    const fallback = dictionaries["zh-CN"];
    const t = (key: string, params?: Params): string => {
      let msg = dict[key] ?? fallback[key] ?? key;
      if (params) {
        for (const [k, v] of Object.entries(params)) {
          msg = msg.replace(new RegExp(`\\{\\{${k}\\}\\}`, "g"), String(v));
        }
      }
      return msg;
    };
    return { locale: validLocale, t };
  }, [locale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  return useContext(I18nContext);
}

/** Create a standalone translator without React context (for non-component code). */
export function createTranslator(locale: string): (key: string, params?: Params) => string {
  const validLocale: Locale = locale === "en" ? "en" : "zh-CN";
  const dict = dictionaries[validLocale];
  const fallback = dictionaries["zh-CN"];
  return (key: string, params?: Params): string => {
    let msg = dict[key] ?? fallback[key] ?? key;
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        msg = msg.replace(new RegExp(`\\{\\{${k}\\}\\}`, "g"), String(v));
      }
    }
    return msg;
  };
}
