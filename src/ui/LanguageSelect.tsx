import {
  DEFAULT_PREVIEW_LANGUAGE,
  PREVIEW_LANGUAGES,
  type PreviewLanguageId,
} from '../preview/languages';

interface Props {
  value: PreviewLanguageId;
  onChange: (id: PreviewLanguageId) => void;
}

export function LanguageSelect({ value, onChange }: Props) {
  return (
    <label className="market-select language-select">
      <span>预览语言</span>
      <select
        value={value}
        onChange={(e) => onChange((e.target.value as PreviewLanguageId) || DEFAULT_PREVIEW_LANGUAGE)}
        aria-label="预览语言 window.curLanguage"
      >
        {PREVIEW_LANGUAGES.map((l) => (
          <option key={l.id} value={l.id}>
            {l.labelZh} · {l.locale}
          </option>
        ))}
      </select>
    </label>
  );
}
