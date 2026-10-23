## What changed

<!-- The user-visible effect first, in a sentence or two. -->

## Why

<!-- The problem this solves. Link the issue if there is one. -->

## How it was verified

```bash
npm run check   # typecheck, tests and the constraint floor
```

Manual steps, including the signed-out path:

<!-- e.g. "Signed out: controls show the sign-in prompt, API returns 401. Signed in: accepted an
item, reloaded, plan and history still show it." -->

## Screenshots

<!-- For UI changes, before and after. Remove this section if not applicable. -->

## Checklist

- [ ] Tests cover the behaviour change (engine branch, API contract, or interaction)
- [ ] Recommendation keys are unchanged, or the change explains how stored decisions survive
- [ ] No secrets, tokens or customer data in the diff
- [ ] README, `agents/` spec or route table updated if behaviour changed
- [ ] Worker changes were exercised locally (`npm run dev:worker`), not only through the Vite proxy
