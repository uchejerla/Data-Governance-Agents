import { useEffect, useState } from 'react';
import { startDecisionSync } from './lib/decisions';
import { startLicenceSync, useLicence } from './lib/licence';
import { Shell, isViewLicensed, type View } from './components/Shell';
import { OverviewPage } from './components/Overview';
import { HistoryPage } from './components/History';
import { CatalogCurationPage } from './components/assistants/CatalogCuration';
import { QualityTriagePage } from './components/assistants/QualityTriage';
import { PolicyQaPage } from './components/assistants/PolicyQa';
import { AccessReviewPage } from './components/assistants/AccessReview';
import { PlannerPage } from './components/assistants/Planner';
import type { DomainId } from './types';

export default function App() {
  const [view, setView] = useState<View>('overview');
  const [domainId, setDomainId] = useState<DomainId>('customer');
  const { licence } = useLicence();
  // A screen the licence does not include falls back rather than rendering a
  // module the API would refuse to serve.
  const activeView = isViewLicensed(view, licence) ? view : 'overview';

  useEffect(() => {
    startDecisionSync();
    startLicenceSync();
  }, []);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }, [activeView]);

  return (
    <Shell view={activeView} onNavigate={setView} domainId={domainId} onDomainChange={setDomainId}>
      {activeView === 'overview' ? <OverviewPage domainId={domainId} onNavigate={setView} /> : null}
      {activeView === 'history' ? <HistoryPage /> : null}
      {activeView === 'catalog' ? <CatalogCurationPage /> : null}
      {activeView === 'quality' ? <QualityTriagePage /> : null}
      {activeView === 'policy' ? <PolicyQaPage /> : null}
      {activeView === 'access' ? <AccessReviewPage /> : null}
      {activeView === 'planner' ? <PlannerPage domainId={domainId} onNavigate={setView} /> : null}
    </Shell>
  );
}
