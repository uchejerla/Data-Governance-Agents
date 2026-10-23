import type { GovernanceSnapshot, PolicyClause } from '../types';
import { clamp, plural, tokenize, unique } from './util';

export interface PolicyMatch {
  clause: PolicyClause;
  score: number;
  matchedTerms: string[];
}

export type Coverage = 'Answered' | 'Partial' | 'Not covered';

export interface PolicyAnswer {
  question: string;
  coverage: Coverage;
  confidence: number;
  shortAnswer: string;
  matches: PolicyMatch[];
  related: PolicyMatch[];
  checks: string[];
  escalateTo?: string;
  followUps: string[];
  composed: string;
}

const DOC_INTENTS: { docCode: string; keywords: string[]; label: string }[] = [
  {
    docCode: 'POL-TPR-06',
    keywords: ['vendor', 'third party', 'supplier', 'partner', 'sharing', 'share', 'outsource', 'agency'],
    label: 'third-party sharing',
  },
  {
    docCode: 'POL-RET-03',
    keywords: ['retain', 'retention', 'keep', 'delete', 'deletion', 'purge', 'how long', 'archive'],
    label: 'retention',
  },
  {
    docCode: 'POL-ACC-05',
    keywords: ['access', 'approve', 'approval', 'permission', 'grant', 'contractor', 'export', 'least privilege'],
    label: 'access',
  },
  {
    docCode: 'POL-CLS-01',
    keywords: ['classif', 'confidential', 'restricted', 'internal', 'label', 'mask', 'masking', 'unclassified'],
    label: 'classification',
  },
  {
    docCode: 'POL-PRIV-02',
    keywords: ['consent', 'marketing', 'gdpr', 'privacy', 'personal data', 'dsar', 'erasure', 'purpose', 'transfer'],
    label: 'privacy',
  },
  {
    docCode: 'POL-AI-07',
    keywords: ['model', 'ai', 'algorithm', 'automated decision', 'feature', 'fairness', 'drift', 'llm', 'genai'],
    label: 'AI and models',
  },
  {
    docCode: 'POL-QUAL-04',
    keywords: ['quality', 'incident', 'sla', 'severity', 'remediation', 'rule', 'certification'],
    label: 'data quality',
  },
  {
    docCode: 'POL-CLM-02',
    keywords: ['claim', 'health', 'diagnosis', 'fraud', 'investigation'],
    label: 'claims confidentiality',
  },
];

export function answerPolicyQuestion(question: string, snapshot: GovernanceSnapshot): PolicyAnswer {
  const queryTokens = tokenize(question);
  const intentBoosts = new Set(
    DOC_INTENTS.filter((intent) =>
      intent.keywords.some((keyword) => question.toLowerCase().includes(keyword)),
    ).map((intent) => intent.docCode),
  );

  const scored: PolicyMatch[] = snapshot.policies.map((clause) => {
    const topicTokens = new Set(clause.topics.flatMap(tokenize));
    const textTokens = new Set(tokenize(`${clause.heading} ${clause.text} ${clause.shortAnswer}`));

    const topicHits = queryTokens.filter((t) => topicTokens.has(t));
    const textHits = queryTokens.filter((t) => textTokens.has(t));
    const matchedTerms = unique([...topicHits, ...textHits]);

    let score = topicHits.length * 3 + textHits.length;
    if (intentBoosts.has(clause.docCode)) score += 2.5;
    // Reward coverage of the question, not just overlap with a long clause.
    const coverage = queryTokens.length > 0 ? matchedTerms.length / queryTokens.length : 0;
    score += coverage * 3;

    return { clause, score: Math.round(score * 10) / 10, matchedTerms };
  });

  const ranked = scored.filter((m) => m.score > 0).sort((a, b) => b.score - a.score);
  const matches = ranked.filter((m) => m.score >= 3).slice(0, 3);
  const related = ranked.filter((m) => m.score < 3).slice(0, 2);
  const top = matches[0];
  const second = matches[1];
  const margin = top ? top.score - (second?.score ?? 0) : 0;

  let coverage: Coverage = 'Not covered';
  if (top && top.score >= 6 && margin >= 1.5) coverage = 'Answered';
  else if (top && top.score >= 4) coverage = 'Partial';

  const confidence = top
    ? clamp(Math.round(((top.score / 14) * 0.7 + Math.min(margin, 5) * 0.06) * 100) / 100, 0.2, 0.95)
    : 0;

  const checks = unique(
    matches.flatMap((m) => [
      m.clause.control,
      ...(m.clause.escalateTo ? [`Escalation route: ${m.clause.escalateTo}.`] : []),
    ]),
  ).slice(0, 5);

  const escalateTo =
    top?.clause.escalateTo ??
    (intentBoosts.has('POL-PRIV-02') || intentBoosts.has('POL-TPR-06')
      ? 'Data Protection Officer'
      : 'Head of Data Governance');

  const followUps: string[] = [];
  if (queryTokens.length < 4) {
    followUps.push('Add the data type, audience and purpose — policy answers differ sharply by context.');
  }
  if (!intentBoosts.has('POL-CLS-01') && !question.toLowerCase().includes('classif')) {
    followUps.push('Confirm how the data is classified, since handling obligations follow the classification.');
  }
  if (/vendor|third party|share/i.test(question)) {
    followUps.push('Does the recipient process the data outside the approved region, or onward to a sub-processor?');
  }
  if (/retain|retention|keep|delete/i.test(question)) {
    followUps.push('Is a legal hold or open complaint in force? A hold suspends deletion.');
  }
  if (/model|ai|score/i.test(question)) {
    followUps.push('Is the model making or informing a decision that materially affects a customer?');
  }
  if (followUps.length === 0) {
    followUps.push('Ask the Privacy Office to confirm the answer before relying on it for an external commitment.');
  }

  const shortAnswer = top
    ? coverage === 'Not covered'
      ? 'No clause in the current policy set answers this directly. Treat the nearest clauses below as context only and escalate before acting.'
      : top.clause.shortAnswer
    : 'No clause in the current policy set answers this directly. Escalate before acting.';

  const composedLines: string[] = [
    `Question: ${question.trim()}`,
    '',
    `Answer (${coverage.toLowerCase()}, confidence ${Math.round(confidence * 100)}%):`,
    shortAnswer,
    '',
  ];

  if (matches.length > 0) {
    composedLines.push('Basis:');
    for (const match of matches) {
      composedLines.push(
        `• ${match.clause.docTitle} v${match.clause.version}, §${match.clause.section} — ${match.clause.heading} (${match.clause.id})`,
      );
      composedLines.push(`  "${match.clause.text}"`);
    }
    composedLines.push('');
  }

  if (checks.length > 0) {
    composedLines.push('Checks before you act:');
    checks.forEach((check) => composedLines.push(`• ${check}`));
    composedLines.push('');
  }

  if (coverage !== 'Answered') {
    composedLines.push(
      `Not conclusive — escalate to ${escalateTo} with the data asset, purpose, audience and any contractual context.`,
    );
  } else {
    composedLines.push(`Route questions or exceptions to ${escalateTo}.`);
  }

  return {
    question,
    coverage,
    confidence,
    shortAnswer,
    matches,
    related,
    checks,
    escalateTo,
    followUps,
    composed: composedLines.join('\n'),
  };
}

export function policyIntentLabel(question: string): string {
  const intents = DOC_INTENTS.filter((intent) =>
    intent.keywords.some((keyword) => question.toLowerCase().includes(keyword)),
  ).map((i) => i.label);
  return intents.length > 0 ? plural(intents.length, 'policy area') + `: ${intents.join(', ')}` : 'No policy area detected yet';
}
