// Types for i18n.js, the English and French texts of the plugin.

export type Lang = 'en' | 'fr'
// What the person picked; 'auto' follows the system's language.
export type LangSetting = 'auto' | Lang

export declare function setLang(lang: Lang): void
export declare function getLang(): Lang
export declare function resolveLang(setting: LangSetting, navigatorLanguage: string): Lang
export declare function t(en: string, vars?: Record<string, string | number | null | undefined>, context?: string): string
export declare function plural(n: number, one: string, many: string, vars?: Record<string, string | number | null | undefined>): string
export declare const FR: Record<string, string>
