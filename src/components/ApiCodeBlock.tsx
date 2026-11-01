import { Notice } from "./ui/notice";
import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import './ApiCodeBlock.css';

const tokens = /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\/\/[^\n]*|#[^\n]*|\b(?:const|let|async|await|function|return|throw|new|if|else|export|true|false|null|undefined)\b|\b\d+(?:\.\d+)?\b)/g;

export function ApiCodeBlock({ code, language = 'JSON' }: { code: string; language?: string }) {
  const { t, i18n } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(false);
  const parts = code.split(tokens);
  return <div className="api-code-block" data-language={language}>
    <div className="api-code-toolbar"><span>{language === 'curl' ? 'Bash / curl' : language}</span><button type="button" aria-label={copied ? t('copied') : `${t('copy')} ${language} ${i18n.language.startsWith('zh') ? '代码' : 'code'}`} onClick={async () => {
      setCopied(false); setError(false);
      try { await navigator.clipboard.writeText(code); setCopied(true); setError(false); } catch { setError(true); }
    }}>{copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}{copied ? t('copied') : t('copy')}</button></div>
    {copied && <Notice tone="success">{t('copied')}</Notice>}
    {error && <Notice className="api-code-copy-error" role="status">{t('copyFailed')}</Notice>}
    <pre><code>{parts.map((part, index) => {
      const kind = /^(?:\/\/|#)/.test(part) ? 'comment' : /^["'`]/.test(part) ? (language === 'JSON' && /^\s*:/.test(parts[index + 1] ?? '') ? 'property' : 'string') : /^\d/.test(part) ? 'number' : /^(?:const|let|async|await|function|return|throw|new|if|else|export|true|false|null|undefined)$/.test(part) ? 'keyword' : '';
      return kind ? <span className={`api-token-${kind}`} key={index}>{part}</span> : part;
    })}</code></pre>
  </div>;
}
