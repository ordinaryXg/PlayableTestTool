/** Internal language ids used by creatives (`window.curLanguage`). */
export const PREVIEW_LANGUAGES = [
  { id: 'en', labelZh: '英文', locale: 'en-US' },
  { id: 'ja', labelZh: '日文', locale: 'ja-JP' },
  { id: 'ko', labelZh: '韩文', locale: 'ko-KR' },
  { id: 'twn', labelZh: '繁体中文', locale: 'zh-TW' },
  { id: 'cn', labelZh: '简体中文', locale: 'zh-CN' },
  { id: 'vi', labelZh: '越南文', locale: 'vi-VN' },
  { id: 'fr', labelZh: '法文', locale: 'fr-FR' },
  { id: 'ru', labelZh: '俄文', locale: 'ru-RU' },
  { id: 'de', labelZh: '德文', locale: 'de-DE' },
  { id: 'ar', labelZh: '阿拉伯文', locale: 'ar-SA' },
  { id: 'id', labelZh: '印尼文', locale: 'id-ID' },
  { id: 'tr', labelZh: '土耳其文', locale: 'tr-TR' },
] as const;

export type PreviewLanguageId = (typeof PREVIEW_LANGUAGES)[number]['id'];

export const DEFAULT_PREVIEW_LANGUAGE: PreviewLanguageId = 'en';

export function isPreviewLanguageId(value: string): value is PreviewLanguageId {
  return PREVIEW_LANGUAGES.some((l) => l.id === value);
}

/** BCP-47 tag for `navigator.language` (matches creative `initLanguageType` checks). */
export function previewLanguageToLocale(id: string): string {
  const hit = PREVIEW_LANGUAGES.find((l) => l.id === id);
  return hit?.locale ?? 'en-US';
}
