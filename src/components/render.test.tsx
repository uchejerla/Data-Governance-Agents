import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { OverviewPage } from './Overview';
import { CatalogCurationPage } from './assistants/CatalogCuration';
import { QualityTriagePage } from './assistants/QualityTriage';
import { PolicyQaPage } from './assistants/PolicyQa';
import { AccessReviewPage } from './assistants/AccessReview';
import { PlannerPage } from './assistants/Planner';

const noop = () => {};

describe('assistant screens render', () => {
  it('renders the overview with domain health', () => {
    const html = renderToStaticMarkup(<OverviewPage domainId="customer" onNavigate={noop} />);
    expect(html).toContain('Catalog health');
    expect(html).toContain('Your assistants');
    expect(html).toContain('Customer &amp; Growth');
  });

  it('renders catalog curation with gaps and a definition draft', () => {
    const html = renderToStaticMarkup(<CatalogCurationPage />);
    expect(html).toContain('Curation gaps');
    expect(html).toContain('Definition draft');
    expect(html).toContain('Glossary hygiene');
  });

  it('renders quality triage with a stakeholder update', () => {
    const html = renderToStaticMarkup(<QualityTriagePage />);
    expect(html).toContain('Stakeholder update');
    expect(html).toContain('Probable causes');
  });

  it('renders policy Q&amp;A with citations', () => {
    const html = renderToStaticMarkup(<PolicyQaPage />);
    expect(html).toContain('Citations');
    expect(html).toContain('Checks before you act');
  });

  it('renders access review with a reviewer note', () => {
    const html = renderToStaticMarkup(<AccessReviewPage />);
    expect(html).toContain('Reviewer note');
    expect(html).toContain('Why this decision');
  });

  it('renders the stewardship plan columns', () => {
    const html = renderToStaticMarkup(<PlannerPage domainId="customer" onNavigate={noop} />);
    expect(html).toContain('Plan as Markdown');
    expect(html).toContain('Committed');
  });
});
