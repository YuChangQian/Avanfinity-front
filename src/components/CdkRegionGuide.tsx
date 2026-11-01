import { Trans, useTranslation } from 'react-i18next';
import { useState } from 'react';
import { ChevronDown, Globe2 } from 'lucide-react';
import { ApiCodeBlock } from './ApiCodeBlock';
import './CdkRegionGuide.css';

export function CdkRegionGuide() {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  return <section className="developer-guide-card cdk-region-guide" data-testid="cdk-region-guide">
    <div className="developer-guide-heading"><Globe2 aria-hidden="true" /><div><h3>{t('cdkText.chooseARegionBeforeGeneratingCdks')}</h3><p>{t('cdkText.queryAvailableRegionsChooseACountry')}</p></div></div>
    <p><Trans i18nKey="cdkText.regionPermissions" components={{ code: <code /> }} /></p>
    <ol>
      <li><Trans i18nKey="cdkText.regionQuery" components={{ strong: <strong />, code: <code /> }} /></li>
      <li><Trans i18nKey="cdkText.regionGenerate" components={{ strong: <strong />, code: <code /> }} /></li>
      <li><Trans i18nKey="cdkText.regionVerify" components={{ strong: <strong />, code: <code /> }} /></li>
    </ol>
    <p><Trans i18nKey="cdkText.regionCredits" components={{ code: <code /> }} /></p>
    <p>{t('cdkText.regionSelectionAppliesOnlyToGpt')}</p>
    <p><a href="/api/v1/openapi.json" target="_blank" rel="noreferrer">{t('cdkText.unifiedApiOpenapi')}</a> · <a href="/docs/avanfinity-downstream-api.md" download>{t('cdkText.downloadCompleteIntegrationDocumentation')}</a></p>
    <div className="cdk-guide-example"><button type="button" className="cdk-guide-example-toggle" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{t('cdkText.viewFullTypescriptExample')}<ChevronDown aria-hidden="true" /></button><div hidden={!expanded}><ApiCodeBlock language="TypeScript" code={t('cdkText.regionExample')} /></div></div>
  </section>;
}
