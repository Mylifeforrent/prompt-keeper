# Prompt Keeper Documentation

This directory holds the product, design, architecture, and contract documents for Prompt Keeper. Every document is written in English.

## Authority order

When documents disagree, the higher item wins:

1. [`AGENTS.md`](../AGENTS.md) — repository rules for contributors and agents.
2. [`interaction-design.md`](./interaction-design.md) — UX and domain behavior source of truth.
3. [`api-contract.md`](./api-contract.md) — binding renderer-main boundary.
4. [`prd.md`](./prd.md), [`architecture.md`](./architecture.md), [`backend-design.md`](./backend-design.md), [`frontend-design.md`](./frontend-design.md), [`tech-stack.md`](./tech-stack.md) — product and engineering design.
5. [`implementation-status.md`](./implementation-status.md) — what the current code implements, simplifies, or defers.
6. [`business-model.md`](./business-model.md) — business draft; assumptions stay annotated as assumptions.

The frozen visual prototype lives in [`design/prototype/`](../design/prototype/README.md). It is a reference artifact, not shipped code.

## Reading paths

- New contributor: `README.md` → `prd.md` → `interaction-design.md` → `architecture.md` → `frontend-design.md` / `backend-design.md`.
- Renderer work: `frontend-design.md` → `api-contract.md` → `implementation-status.md`.
- Main-process work: `backend-design.md` → `architecture.md` → `api-contract.md` → `implementation-status.md`.
- Release or security review: `api-contract.md` → `architecture.md` → `backend-design.md` → `implementation-status.md`.
- Business review: `business-model.md` → `prd.md`.

## Document map

| Document | Owns |
| --- | --- |
| [`prd.md`](./prd.md) | Product scope, priorities, and release criteria |
| [`interaction-design.md`](./interaction-design.md) | UX flows and domain behavior |
| [`architecture.md`](./architecture.md) | Electron process model, module layout, storage, and security |
| [`frontend-design.md`](./frontend-design.md) | Renderer architecture, folder structure, query keys, and feature behavior |
| [`backend-design.md`](./backend-design.md) | Main-process services, schema, Git engine, and projection algorithms |
| [`api-contract.md`](./api-contract.md) | IPC channels, DTOs, errors, events, and concurrency rules |
| [`tech-stack.md`](./tech-stack.md) | Technology choices and rejected alternatives |
| [`implementation-status.md`](./implementation-status.md) | Implemented, simplified, and deferred behavior |
| [`business-model.md`](./business-model.md) | Business model draft and commercial hypotheses |
