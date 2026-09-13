---
name: simplicity-engineering
description: >
  Review requirements, implementation plans, architecture decisions and code
  changes for unnecessary complexity. Use before implementation, after planning,
  and during code review. Distinguishes essential from accidental complexity
  and proposes the smallest coherent solution that preserves correctness,
  security, accessibility, observability, maintainability and testability.
---

# Simplicity Engineering

## Goal

Find and remove **accidental complexity** without removing necessary quality.

Optimize for the smallest coherent solution that fully satisfies the required
behaviour and constraints.

Do not optimize for minimum lines of code.

Optimize for:
- fewer concepts
- fewer states
- fewer dependencies
- fewer unnecessary abstractions
- explicit behaviour
- predictable data flow
- low cognitive load
- testability
- maintainability

> Necessary complexity is acceptable. Accidental complexity is not.

## When to use this skill

Use this skill when reviewing:
- a user story or requirement before implementation
- an implementation plan
- an architecture proposal
- a code change or pull request
- a refactoring proposal
- a new dependency or abstraction
- state-management changes
- API or data-model design
- AI-generated code

Run it especially when a solution introduces additional layers, dependencies,
configuration, generic abstractions, factories, adapters, repositories,
wrappers, duplicated state, or new architectural patterns.

## Review modes

### REQUIREMENT
Ask: **Are we solving the right problem with the minimum necessary scope?**

Look for speculative requirements, unnecessary options, premature flexibility,
and unclear acceptance criteria.

### PLAN
Ask: **Is the proposed implementation introducing unnecessary concepts?**

Challenge planned layers, abstractions, dependencies, state, configuration,
and infrastructure. Prefer removing complexity before code exists.

### IMPLEMENTATION
Ask: **Did implementation complexity exceed problem complexity?**

Inspect actual code and configuration. Do not infer complexity that is not
present in the change.

## Review algorithm

### 1. Determine intent
Describe the problem being solved in one sentence.

If intent cannot be determined confidently, report `INTENT UNCLEAR`.
Do not invent requirements.

### 2. Establish constraints
Identify requirements that must not be simplified away, including required
behaviour, security, accessibility, regulatory requirements, performance,
compatibility, observability, reliability, and testability.

Treat these as constraints, not complexity defects.

### 3. Separate essential and accidental complexity

**Essential complexity** is inherent to the actual problem, such as
authentication, distributed communication, financial calculations, complex
domain validation, concurrency, or regulatory rules.

**Accidental complexity** is introduced by the chosen solution, such as
unnecessary abstractions, duplicated state, excessive configuration, wrapper
layers, unnecessary dependencies, speculative extensibility, or hidden side
effects.

Only recommend removing complexity when doing so preserves established constraints.

### 4. Apply REDUCE
Ask: **What can disappear?**

Inspect files, modules, classes, interfaces, functions, configuration,
dependencies, state, options, and abstractions.

Challenge anything justified primarily by:
- "we might need it later"
- "this is more flexible"
- "this is more enterprise"
- "this is the standard pattern"

Future flexibility alone is insufficient justification.

### 5. Apply ORGANIZE
Ask: **Is the structure obvious?**

Prefer direct data flow:

```text
input
  ↓
transformation
  ↓
output
```

Challenge flows such as:

```text
component
  ↓
composable
  ↓
service
  ↓
repository
  ↓
adapter
  ↓
client
  ↓
API
```

Each layer must have an independent responsibility. If a layer only forwards
calls or renames concepts, recommend removing it.

### 6. Apply LEARN
Ask: **Could another engineer understand this without reconstructing hidden context?**

Prefer explicit types, descriptive names, visible dependencies, small cohesive
functions, predictable conventions, and explicit state transitions.

### 7. Apply TRUST
Ask: **Is behaviour deterministic and explicit?**

Prefer pure functions where practical, explicit contracts, typed boundaries,
reproducible tests, and observable failures.

Challenge hidden global state, implicit mutation, timing-dependent behaviour,
silent fallbacks, uncontrolled retries, and implicit side effects.

### 8. Review state
Every independent mutable state has a complexity cost.

For each state value ask: **Is this authoritative state or can it be derived?**

Prefer derived state whenever practical. Prefer explicit state models over
combinations of mutually exclusive booleans.

### 9. Review abstractions
An abstraction should normally satisfy at least one:
1. meaningful duplication already exists;
2. multiple implementations exist;
3. it creates a real architectural boundary;
4. it materially improves testability;
5. it isolates unstable infrastructure from stable domain logic.

If none apply, flag possible premature abstraction.

### 10. Review dependencies
Treat every new dependency as part of the complexity budget.

Ask:
- What problem does it solve?
- Can the existing stack solve the problem adequately?
- How much API surface does it introduce?
- What maintenance obligation does it create?
- Does it affect runtime or bundle behaviour?
- Does it create security or supply-chain exposure?

Reject dependencies only when complexity cost is disproportionate to value.

### 11. Prefer a functional core
Where appropriate, keep transformation, calculation, validation, filtering,
and decision logic pure and deterministic. Keep network, filesystem, database,
browser APIs, logging, environment, and clock effects at identifiable boundaries.

Do not force functional patterns where they make the solution harder to understand.

## Agent-generated code checks

### Agent overproduction
Look for unnecessary helper files, utilities, comments, interfaces, wrappers,
factories, configuration, and duplicated types.

Ask: **Does this concept exist because the problem requires it or because the
agent knows the pattern?**

### Pattern hallucination
Flag patterns introduced without demonstrated need, such as a repository around
one trivial API, a factory around one implementation, a command bus for a few
direct operations, a global store for local state, or a generic framework for
one use case.

Patterns are tools, not goals.

### Abstraction explosion
Count conceptual layers. If multiple layers do little more than delegate,
recommend collapsing them.

Concept count matters more than line count.

## Complexity budget

For PLAN and IMPLEMENTATION reviews report:

```text
New modules:
New abstractions:
New dependencies:
New mutable state:
New configuration:
New architectural concepts:
```

These are prompts for justification, not absolute quality metrics.

## Scoring

Score each dimension from 1 to 5:
1. Necessity
2. Structure
3. Cognitive load
4. State
5. Abstractions
6. Dependencies
7. Predictability
8. Testability

Interpretation:
- 5 = exceptionally clear
- 4 = good
- 3 = acceptable
- 2 = unnecessarily complex
- 1 = severe accidental complexity

Maximum score: 40.

`Simplicity Score = total / 40 * 10`

Round to one decimal place. The score supports the review; it does not replace
engineering judgement.

## Decision

- 9.0–10.0: `APPROVE`
- 8.0–8.9: `APPROVE`
- 7.0–7.9: `APPROVE WITH RECOMMENDATIONS`
- 5.0–6.9: `REVISE`
- below 5.0: `REJECT`

A high score must not override a serious structural finding. An S4 finding
normally results in `REVISE` or `REJECT`.

## Finding severity

- **S1 — Cosmetic:** minor clarity improvement.
- **S2 — Local:** unnecessary complexity with limited impact.
- **S3 — Structural:** complexity affecting architecture or multiple modules.
- **S4 — Systemic:** complexity likely to propagate through the system.

## Required evidence

Never report complexity without evidence.

Every finding must contain:

```text
Finding:
Severity:
Evidence:
Complexity introduced:
Why it matters:
Simpler alternative:
Trade-off:
```

The simpler alternative must preserve established constraints.

## Mandatory challenge

Before approving, explicitly evaluate:
1. Can anything be deleted?
2. Can anything be derived instead of stored?
3. Can two concepts become one?
4. Is an abstraction premature?
5. Is a dependency unnecessary?
6. Is behaviour hidden behind indirection?
7. Are side effects identifiable?
8. Is failure behaviour explicit?
9. Is complexity solving today's problem?
10. Could another engineer understand the solution quickly?

Do not manufacture findings. `No issue found` is valid.

## Quality guardrail

Never recommend removing or bypassing necessary tests, type safety, security
controls, accessibility, validation, observability, reliability, or error
handling solely to improve simplicity.

Quality is not optional complexity.

Likewise, do not automatically demand additional architecture, abstractions,
or tests when existing controls already provide sufficient confidence.

## Anti-patterns

Actively detect:
- premature abstraction
- speculative flexibility
- pattern worship
- dependency inflation
- state duplication
- configuration explosion
- wrapper stacking
- boolean explosion
- hidden side effects
- unnecessary asynchronous behaviour
- clever code that reduces readability
- agent-generated scaffolding without demonstrated value

## Output contract

Return exactly this structure:

```markdown
# Simplicity Review

**Mode:** REQUIREMENT | PLAN | IMPLEMENTATION
**Score:** X.X / 10
**Decision:** APPROVE | APPROVE WITH RECOMMENDATIONS | REVISE | REJECT

## Intent
<one sentence>

## Essential complexity
<what legitimately needs to remain>

## Accidental complexity
<unnecessary complexity found, or "None identified">

## Complexity budget
- New modules:
- New abstractions:
- New dependencies:
- New mutable state:
- New configuration:
- New architectural concepts:

## Findings

### <finding>
- Severity:
- Evidence:
- Complexity introduced:
- Why it matters:
- Simpler alternative:
- Trade-off:

## Challenge results
1. Delete:
2. Derive:
3. Merge concepts:
4. Premature abstraction:
5. Dependency:
6. Indirection:
7. Side effects:
8. Failure:
9. Current vs future need:
10. Comprehensibility:

## Recommended simplification
<single highest-value simplification, or "None">

## Positive observations
<decisions that successfully keep the solution simple>
```

## Stop conditions

Stop and request clarification rather than guessing when:
- intended behaviour cannot be determined;
- required constraints are contradictory;
- simplification would require changing business requirements;
- critical context needed to judge the architecture is unavailable.

Otherwise complete the review autonomously.

## Final principle

When two solutions provide equivalent behaviour and quality:

> Prefer the solution with fewer concepts, fewer states, fewer dependencies,
> clearer boundaries and more explicit behaviour.

**Simplicity is not less engineering. Simplicity is the deliberate removal of
engineering that does not earn its complexity.**
