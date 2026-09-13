handoff.md
# HANDOFF — Agentic Engineering Model v0.1

## 1. Doel

Ontwerp een evidence-driven agentic software-engineeringproces
waarmee één ervaren software engineer softwarewijzigingen grotendeels
autonoom kan laten uitvoeren, ook in een technologiestack waarin de
operator geen expert is.

Doel is niet maximale autonomie, maar:
- betrouwbare autonomie;
- minimale noodzakelijke human intervention;
- evidence-based quality gates;
- risk-based escalation.

## 2. Centrale hypothese

Een ervaren software engineer kan betrouwbaar wijzigingen uitvoeren
in een onbekende technologiestack wanneer ontbrekende expertise wordt
gecompenseerd door:

- expliciete specifications;
- executable tests;
- compiler/static-analysis guarantees;
- repository conventions;
- onafhankelijke specialist/review agents;
- simplicity reviews;
- risk-based escalation.

## 3. Kernprincipe

Agents bepalen niet zelf of hun werk goed genoeg is.

Iedere overgang naar een volgende fase vereist onafhankelijk bewijs.

Approval-driven engineering wordt vervangen door
evidence-driven engineering.

## 4. Huidige workflow

Hypothesis / Intent
        ↓
Requirement + Specification
        ↓
Simplicity — REQUIREMENT
        ↓
Acceptance Critic
        ↓
Implementation Plan
        ↓
Simplicity — PLAN
        ↓
Impact Analysis
        ↓
Test Agent
        ↓
Test-quality validation
        ↓
RED
        ↓
LOCK ACCEPTANCE TESTS
        ↓
Coding Agent
        ↓
Repair loop
        ↓
GREEN
        ↓
Compiler / static analysis
        ↓
Unit / integration / E2E
        ↓
Language/Domain Specialist
        ↓
Simplicity — IMPLEMENTATION
        ↓
Independent adversarial review
        ↓
Build
        ↓
Release Candidate

## 5. Belangrijke ontwerpregels

### Separation of concerns

Requirement/Spec Agent:
- schrijft specification;
- schrijft geen productiecode.

Test Agent:
- schrijft tests;
- wijzigt geen productiecode.

Coding Agent:
- schrijft productiecode;
- mag locked acceptance tests niet wijzigen.

Reviewer:
- read-only;
- probeert fouten te vinden.

### Tests before implementation

Acceptance tests worden vóór productiecode geschreven.

Nieuwe tests moeten aantoonbaar RED zijn voordat de Coding Agent start.

### Simplicity

Tests bepalen de ondergrens:
"What must be built?"

Simplicity bepaalt de bovengrens:
"What does NOT need to be built?"

### Escalation

Een agent mag onzekerheid niet maskeren.

UNKNOWN, conflicting evidence of onvoldoende confidence moet leiden
tot investigation of escalation.

## 6. Cross-cutting mechanisms

Het systeem moet uiteindelijk ondersteunen:

### Traceability

Hypothesis
→ Requirement
→ Acceptance Criterion
→ Test
→ Plan
→ Code change
→ Verification
→ Release

### Risk

Classificeer wijzigingen o.a. op:
- code;
- configuration;
- infrastructure;
- database;
- external API;
- concurrency;
- security.

### Confidence

Beslissingen moeten evidence bevatten, niet alleen PASS/FAIL.

Voorbeeld:

Decision: PASS
Risk: MEDIUM
Confidence: 0.82

Evidence:
- compiler: strong
- tests: strong
- static analysis: strong
- repository precedent: medium

Unknowns:
- coroutine cancellation behaviour

### Capabilities

Agent permissions moeten technisch beperkt kunnen worden.

Prompt-instructies alleen zijn onvoldoende.

### Reversibility

Meer autonomie vereist meer reversibility.

Onderzoek:
deploy → observe → continue/rollback.

## 7. Onbekende technologiestack

Kotlin is gekozen als interessante testcase omdat de menselijke
operator ervaren software engineer is maar geen Kotlin-expert.

Ontbrekende menselijke expertise mag NIET worden vervangen door
vertrouwen in AI.

Compensatie moet komen uit:

repository conventions
+ Kotlin compiler
+ static analysis
+ tests
+ Kotlin specialist
+ independent review
+ risk/confidence
+ escalation.

## 8. Bestaand artifact

Er bestaat reeds een:

Simplicity Engineering SKILL.md

Deze beoordeelt:
- requirements;
- plans;
- implementations;

op essential versus accidental complexity.

Deze skill moet worden hergebruikt, niet opnieuw ontworpen zonder
aantoonbare reden.

## 9. Onderzoekshypotheses

H1:
Tests vóór Coding Agent verminderen incorrecte implementaties.

H2:
Gescheiden Test/Coding Agents verminderen confirmation bias.

H3:
Simplicity review vermindert AI-overengineering.

H4:
Language-specialist review compenseert gedeeltelijk ontbrekende
menselijke taalexpertise.

H5:
Repository-grounded context levert betere wijzigingen dan generieke
best-practice prompts.

H6:
Risk-based autonomy vermindert human approvals zonder
onacceptabel kwaliteitsverlies.

H7:
Onafhankelijke acceptance validation vermindert het risico dat
het systeem perfect de verkeerde requirement implementeert.

H8:
Automated quality gates kunnen het oordeel van een menselijke
language expert voldoende voorspellen.

Te onderzoeken H9:
Mutation testing kan de betrouwbaarheid van agent-generated tests
verhogen.

## 10. Nog NIET besloten

Niet voortijdig vastleggen:

- exacte agent tooling;
- orchestrator technology;
- aantal fysieke agents;
- model/provider;
- Kotlin framework;
- mutation-testing tooling;
- deployment platform;
- persistence/memory;
- exacte risk-score;
- exacte confidence-berekening.

Eerst concept valideren.

## 11. Simplicity constraint

Voorkom premature agent architecture.

Begin NIET automatisch met:

- message queues;
- vector databases;
- agent memory;
- distributed agents;
- complexe MCP-infrastructuur;
- grote orchestration frameworks.

Voorkeur:

1 orchestrator
+ meerdere rollen
+ repository artifacts
+ executable gates
+ Git audit trail.

## 12. Volgende opdracht

Werk Agentic Engineering Model v0.1 verder uit.

Werk in deze volgorde:

1. formaliseer principles;
2. definieer artifacts;
3. definieer rollen en verantwoordelijkheden;
4. definieer state machine;
5. definieer gates en exit criteria;
6. definieer agent permissions;
7. definieer risk model;
8. definieer confidence/evidence model;
9. definieer escalation rules;
10. definieer metrics;
11. ontwerp één Minimum Viable Experiment met een Kotlin repository.

Voeg geen nieuwe agents of infrastructuur toe tenzij een concrete
verantwoordelijkheid niet door het bestaande model kan worden
afgedekt.

Behandel iedere uitbreiding volgens het Simplicity-principe:

"What problem does this additional concept solve, and has that
complexity earned its place?"

## 13. Gewenst eindresultaat

Niet direct een productieplatform bouwen.

Eerste resultaat moet zijn:

Agentic Engineering Model v0.1
        ↓
Minimum Viable Experiment
        ↓
measured results
        ↓
evaluate hypotheses
        ↓
Model v0.2