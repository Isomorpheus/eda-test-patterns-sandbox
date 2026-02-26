# EDA Test Patterns

Exploration of event-driven architecture testing patterns.

## Run demo (simple)

1. Install dependencies

```bash
npm install
```

2. Run the in-memory Service Bus demos

```bash
npm run demo-1
npm run demo-2
npm run demo-3
npm run demo
npm run demo-4
npm run demo-5
npm run demo-5 -- --crosstalk
npm run demo-6
npm run demo-6 -- --negative
npm run demo-6 -- --missing
```

3. Optional: compile TypeScript

```bash
npm run build
```

## Docs

- Demo walkthrough: [docs/demo.md](docs/demo.md)
- In-memory bus internals: [docs/inMemoryBus.md](docs/inMemoryBus.md)
Hier is een voorsteltekst die je zo in Refinement / Jira / DevOps ticket kunt zetten om het gesprek op gang te brengen. (Ik schrijf ‘m bewust als richtinggevend en met keuzes/acceptatiecriteria, zodat je niet meteen in scope verdwaalt.)

⸻

Voorstel: “Allure Delta” – minimal viable delta + viewer (Node + Vue)

Probleem

We hebben Allure reports per run, maar missen een snelle, eenduidige delta tussen een baseline run en een nieuwe run. Hierdoor kost het tijd om regressies te duiden (wat is nieuw stuk / wat is opgelost / wat is veranderd).

Doel (MVP)

Een herbruikbare delta building block die twee Allure runs vergelijkt en een compact “diff” oplevert, plus een eenvoudige viewer om dit leesbaar te maken voor team/PO.

Scope MVP (fase 1)

Input
	•	Run A: allure-results/ (baseline)
	•	Run B: allure-results/ (current)

Output
	•	delta.json (machine-readable)
	•	delta-summary.md (CI-friendly)

Delta categorieën (must-have)
	•	New failures (PASS/SKIP → FAIL)
	•	Resolved failures (FAIL → PASS)
	•	New tests (alleen in Run B)
	•	Removed tests (alleen in Run A)

Viewer (must-have)
	•	Vue/Nuxt webviewer die delta.json kan openen (file upload of URL) en toont:
	•	summary cards
	•	tabellen/lijsten voor “New failures” en “Resolved”
	•	detail pane (suite/testnaam/status/message)

Niet in MVP (expliciet out-of-scope)
	•	Flaky detectie / retries analyse
	•	Duration delta / performance regressies
	•	Trends over meerdere runs
	•	Auth/hosting/rollen
	•	Delta berekenen in de browser (alleen viewer; diff gebeurt in Node)

⸻

Technische aanpak (voorstel)

Node Delta Engine (CLI + library)
	•	Implementatie als Node/TypeScript package:
	•	Core: readAllureResults + makeDelta
	•	CLI: allure-delta --a <path> --b <path> --out <dir>
	•	Stabiele test key:
	•	Prefer historyId indien aanwezig
	•	Anders fullName + normalized(parameters)

Integratie in CI (optioneel in fase 1b)
	•	Pipeline stap:
	1.	run tests (genereert allure-results)
	2.	haal baseline artifact op
	3.	run delta CLI
	4.	publish delta/ als artifact + print summary

⸻

Acceptatiecriteria
	1.	CLI werkt lokaal
	•	Met twee lokale folders kan delta.json en delta-summary.md worden gegenereerd.
	2.	Delta is deterministisch
	•	Zelfde inputfolders → exact dezelfde output.
	3.	Viewer werkt
	•	Viewer kan delta.json openen en toont:
	•	counts + lijsten “New failures” en “Resolved failures”
	•	per item minimaal: suite/name/from→to/message (1e regel)
	4.	Referentietests
	•	Minimaal 2 tests die status changes en new/removed aantonen (executable documentation).
	5.	Korte README (max 1 pagina)
	•	Input/Output contract + key strategy + known limits.

⸻

Refinement vragen (om scope te prikken)
	1.	Wat is de baseline definitie?
	•	“laatste succesvolle main run” vs “laatste release run”?
	2.	Waar halen we Run A vandaan?
	•	CI artifact, storage, of handmatig lokaal?
	3.	Welke status mapping willen we in MVP?
	•	Alleen passed/failed/skipped of ook broken/unknown?
	4.	Moeten we suite naming standaardiseren (labels) of is “best effort” ok?
	5.	Waar moet dit zichtbaar zijn:
	•	alleen pipeline summary + artifact, of ook een gedeelde webpagina?

⸻

Deliverables (MVP)
	•	allure-delta Node CLI + core library
	•	delta.json schema + voorbeeldbestand
	•	Vue/Nuxt viewer (1 pagina)
	•	CI voorbeeldstap (optioneel)
	•	README + referentietests

⸻

Als je wilt, kan ik dit ook meteen omzetten naar:
	•	Jira Story + subtasks (Node core / CLI / viewer / CI / docs)
	•	of een refinement agenda met timeboxes en beslispunten (zodat je meeting strak blijft).