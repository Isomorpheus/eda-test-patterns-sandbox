Use the **Evidence-Driven Quality Engineering** project handoff above as the authoritative starting context.

I want to develop this project in a new private GitHub repository:

`Isomorpheus/evidence-driven-qe`

Start with **Milestone 0 — Foundation**, then incrementally develop the first vertical slice using Excel definitions and traceable test scenarios.

Follow our ISTQB Test Automation Policy, the Laws of Simplicity, and evolutionary software architecture principles.

First establish:

- A clean Vue 3 + Fastify + TypeScript application.
- A concise `AGENTS.md` defining engineering constraints.
- Project documentation, including the vision and architectural decisions.
- Vitest, Playwright, linting, type checking, and build verification.
- A minimal working UI and backend.

Do not introduce LangGraph, autonomous agents, PostgreSQL, or Azure DevOps write operations at this stage.

Implement changes as small, reusable, independently testable building blocks. Run and report the actual verification results.

Where architectural decisions are required, present the trade-offs and preserve human authority over those decisions.

**The objective is not merely to build an AI-powered testing application. It is to establish a measurable, evidence-driven quality engineering approach that connects requirements, business rules, risk analysis, test design, and automated verification.**

Begin implementing Milestone 0.