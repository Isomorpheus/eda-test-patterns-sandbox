# GitHub Copilot instructions for this repository

## Default behavior
- Analyze first, propose changes second.
- Do not modify code unless explicitly asked.
- Do not generate patches or multi-file rewrites unless explicitly requested.
- Prefer explanation, review, and code understanding over code generation.

## Repository architecture
This repository uses a strict layered test automation architecture:

1. Test
2. Act & Assert
3. Logic
4. Core/API

## Layer rules
- Tests contain scenario intent only.
- Tests must not contain business logic, utility logic, payload construction, or direct API details.
- Act & Assert performs actions and assertions for a scenario.
- Logic orchestrates the flow and maps scenario input to technical payloads.
- Core/API contains reusable technical interaction code and should avoid scenario-specific domain logic.

## Dependency rules
- Do not introduce cross-layer calls.
- Tests must not call Core/API directly.
- Core/API must not contain domain assertions.
- Prefer one responsibility per layer.

## Reuse rules
- Reuse existing repository patterns before introducing new ones.
- Before proposing new code, first check whether a comparable building block already exists.
- Prefer one reusable building block per story over one-off scenario code.

## Reference tests
- Treat reference tests as executable documentation.
- Keep reference tests small, readable, and focused on correct usage.
- Do not treat reference tests as full coverage.

## Review guidance
When reviewing code, check:
- correct layer placement
- readability
- maintainability
- reuse potential
- layering violations
- business logic leaking into tests

## Communication style
- Be concise and structured.
- Explain what the code does, why it exists, and where it belongs.
- If uncertain, state what is clear and what still needs confirmation from the codebase.


## Commit message conventions

Use Conventional Commits format for all commit messages:

<type>(optional scope): <short description>

### Allowed types
- feat: new functionality
- fix: bug fix
- refactor: code change without behavior change
- test: adding or updating tests
- docs: documentation changes
- chore: maintenance tasks (e.g. config, dependencies)

### Rules
- Use lowercase for type and description
- Keep description short and clear (max ~72 characters)
- Do not include unnecessary details
- Focus on the intent of the change

### Examples
- feat(order): add create order building block
- fix(service): handle empty response correctly
- test(order): add reference test for create order
- refactor(invoker): simplify request mapping
- docs(readme): update usage example

### Test automation specific guidance
- Use `test:` for new or updated tests
- Use `feat:` when introducing a new reusable building block
- Use `refactor:` when restructuring layers without behavior change
- Prefer describing the building block or service affected

### Important
- Do not generate commit messages that include unrelated changes
- Do not group unrelated changes into a single commit
- Prefer small, focused commits