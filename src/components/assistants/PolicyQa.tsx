import { useState } from 'react';
import { snapshot } from '../../data/seed';
import { answerPolicyQuestion, type PolicyAnswer } from '../../lib/policy';
import { PageHead } from '../Shell';
import {
  Badge,
  Callout,
  Card,
  CardHead,
  ClauseChip,
  CopyButton,
  Empty,
  Field,
  Icon,
  Meter,
} from '../ui';

const DEFAULT_QUESTION =
  'Can we share customer email addresses with our analytics vendor for campaign analysis?';

const EXAMPLES = [
  'How long can we keep marketing consent evidence after someone opts out?',
  'Can a contractor get access to the customer profile table for three months?',
  'Can we use claims health data to target a marketing campaign?',
  'What SLA applies to a critical quality incident on a Tier 1 asset?',
  'Can we put Restricted data into an external generative AI tool?',
  'Can we send customer data to a team based outside the approved region?',
];

export function PolicyQaPage() {
  const [question, setQuestion] = useState(DEFAULT_QUESTION);
  const [answer, setAnswer] = useState<PolicyAnswer>(() =>
    answerPolicyQuestion(DEFAULT_QUESTION, snapshot),
  );

  function run(next = question) {
    setQuestion(next);
    setAnswer(answerPolicyQuestion(next, snapshot));
  }

  const coverageTone =
    answer.coverage === 'Answered' ? 'low' : answer.coverage === 'Partial' ? 'medium' : 'critical';
  const bannerClass =
    answer.coverage === 'Answered' ? 'approve' : answer.coverage === 'Partial' ? 'conditions' : 'deny';

  return (
    <>
      <PageHead
        eyebrow="Agent assistant · Policy & control"
        title="Policy & Control Q&A"
        lede="Ask the kind of question that lands in a steward's inbox. Every answer is retrieved from the policy library and cited clause by clause, with an explicit escalation path when the library does not settle it."
        actions={<Badge tone="neutral">{snapshot.policies.length} clauses indexed</Badge>}
      />

      <Card>
        <CardHead
          title="Ask a question"
          sub="The agent matches question terms against clause topics and text, then states only what the policy supports."
        />
        <div className="card-body stack">
          <Field label="Your question" htmlFor="policy-question">
            <textarea
              id="policy-question"
              className="textarea"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) run();
              }}
              placeholder="What do you need to know?"
            />
          </Field>
          <div className="row">
            <button type="button" className="btn btn-primary" onClick={() => run()} disabled={question.trim().length < 3}>
              <Icon name="spark" size={14} />
              Answer from policy
            </button>
            <span className="hint">Every claim is tied to a clause ID below.</span>
          </div>
          <div className="chip-row">
            {EXAMPLES.map((example) => (
              <button
                key={example}
                type="button"
                className="example-chip"
                onClick={() => run(example)}
              >
                {example}
              </button>
            ))}
          </div>
        </div>
      </Card>

      <div className="section stack fade-in">
        <div className={`result-banner banner-${bannerClass}`}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="row" style={{ marginBottom: 5 }}>
              <Badge tone={coverageTone}>{answer.coverage}</Badge>
              <Badge tone="neutral">
                {answer.matches.length} clause{answer.matches.length === 1 ? '' : 's'} cited
              </Badge>
              {answer.matches[0] ? (
                <span className="mono muted">
                  lead: {answer.matches[0].clause.docCode} §{answer.matches[0].clause.section}
                </span>
              ) : null}
            </div>
            <div className="result-headline" style={{ maxWidth: '58ch' }}>
              {answer.shortAnswer}
            </div>
          </div>
          <div style={{ width: 150 }}>
            <div className="spread">
              <span className="label" style={{ marginBottom: 0 }}>
                Confidence
              </span>
              <span className="mono">{Math.round(answer.confidence * 100)}%</span>
            </div>
            <Meter value={answer.confidence * 100} tone={coverageTone} />
            <div className="tiny muted" style={{ marginTop: 5 }}>
              Based on clause match strength and separation.
            </div>
          </div>
        </div>

        {answer.coverage !== 'Answered' ? (
          <Callout
            tone={answer.coverage === 'Partial' ? 'warn' : 'danger'}
            title={answer.coverage === 'Partial' ? 'Related policy exists, but it does not settle the question' : 'Not covered by the current policy set'}
          >
            Escalate to <strong>{answer.escalateTo}</strong> with the data asset, the purpose, the
            audience and any contractual context. Do not treat this answer as approval.
          </Callout>
        ) : null}

        <div className="split">
          <div className="stack">
            <Card>
              <CardHead
                title="Citations"
                sub="Quoted from the current policy versions. Read the clause before relying on the answer."
                aside={<Badge tone="info">{answer.matches.length}</Badge>}
              />
              {answer.matches.length === 0 ? (
                <div className="card-body">
                  <Empty title="No clause matched strongly enough">
                    Rephrase with the data type and purpose, or escalate to {answer.escalateTo}.
                  </Empty>
                </div>
              ) : (
                <div className="list">
                  {answer.matches.map((match) => (
                    <div className="list-item" key={match.clause.id}>
                      <div className="list-title">
                        <ClauseChip id={match.clause.id} />
                        {match.clause.docTitle}
                        <Badge tone="neutral">v{match.clause.version}</Badge>
                      </div>
                      <div className="small muted">
                        §{match.clause.section} {match.clause.heading} · owner {match.clause.policyOwner}
                      </div>
                      <blockquote className="quote">"{match.clause.text}"</blockquote>
                      <div className="chip-row">
                        {match.matchedTerms.slice(0, 6).map((term) => (
                          <span className="chip" key={term}>
                            {term}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {answer.related.length > 0 ? (
                <div className="card-foot">
                  Also nearby, but not relied on:{' '}
                  {answer.related.map((r) => `${r.clause.id} (${r.clause.heading})`).join('; ')}.
                </div>
              ) : null}
            </Card>

            <Card>
              <CardHead title="Drafted answer" sub="Paste into the request, ticket or email thread." aside={<CopyButton text={answer.composed} label="Copy answer" />} />
              <div className="card-body">
                <pre className="pre">{answer.composed}</pre>
              </div>
            </Card>
          </div>

          <div className="stack">
            <Card>
              <CardHead title="Checks before you act" sub="Controls the policies require, plus where to route exceptions." />
              <div className="card-body stack" style={{ gap: 9 }}>
                {answer.checks.length === 0 ? (
                  <p className="small muted">No explicit control identified.</p>
                ) : (
                  answer.checks.map((check) => (
                    <div className="row" key={check} style={{ gap: 8, alignItems: 'flex-start', flexWrap: 'nowrap' }}>
                      <Icon name="check" size={14} />
                      <span className="small">{check}</span>
                    </div>
                  ))
                )}
                <div className="divider" />
                <div className="spread small">
                  <span className="muted">Escalation route</span>
                  <strong>{answer.escalateTo}</strong>
                </div>
              </div>
            </Card>

            <Card>
              <CardHead title="Ask next" sub="Gaps in the question that would change the answer." />
              <div className="card-body stack" style={{ gap: 8 }}>
                {answer.followUps.map((followUp) => (
                  <div className="list-detail" key={followUp}>
                    · {followUp}
                  </div>
                ))}
              </div>
            </Card>

            <Card>
              <CardHead title="How to read this" />
              <div className="card-body small muted stack" style={{ gap: 8 }}>
                <p>
                  <strong style={{ color: 'var(--ink-2)' }}>Answered</strong> means at least one clause
                  addresses the question directly and clearly outranks the alternatives.
                </p>
                <p>
                  <strong style={{ color: 'var(--ink-2)' }}>Partial</strong> means related policy applies
                  but a condition, approval or fact is missing — read the cited clauses yourself.
                </p>
                <p>
                  <strong style={{ color: 'var(--ink-2)' }}>Not covered</strong> means the library is
                  silent. Escalate; do not infer a rule from silence.
                </p>
              </div>
            </Card>
          </div>
        </div>
      </div>
    </>
  );
}
