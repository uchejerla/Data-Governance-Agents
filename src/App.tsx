import { useEffect, useState } from 'react';
import { startDecisionSync } from './lib/decisions';
import { Shell, type View } from './components/Shell';
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

  useEffect(() => {
    startDecisionSync();
  }, []);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }, [view]);

  return (
    <Shell view={view} onNavigate={setView} domainId={domainId} onDomainChange={setDomainId}>
      {view === 'overview' ? <OverviewPage domainId={domainId} onNavigate={setView} /> : null}
      {view === 'history' ? <HistoryPage /> : null}
      {view === 'catalog' ? <CatalogCurationPage /> : null}
      {view === 'quality' ? <QualityTriagePage /> : null}
      {view === 'policy' ? <PolicyQaPage /> : null}
      {view === 'access' ? <AccessReviewPage /> : null}
      {view === 'planner' ? <PlannerPage domainId={domainId} onNavigate={setView} /> : null}
    </Shell>
  );
}
