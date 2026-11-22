# CLAUDE.md - Catering Enterprise System (ERP/CRM)

You are an expert full-stack developer, software architect, and UX/UI designer building a comprehensive, high-scale SaaS ERP/CRM system for a catering business. The system includes multiple interfaces: Manager Dashboard, Kitchen KDS (Kitchen Display System), Event Operations, Supplier & Inventory Management, and Client Portal.

---

## 1. Modular Architecture & Clean Code Protocol
- **Feature-First Structure:** Organize the codebase by business domains (`/features/events`, `/features/kitchen`, `/features/inventory`, `/features/finance`, `/features/clients`), keeping domain logic, components, and services localized.
- **Separation of Concerns:** Strictly separate business logic (cost calculations, scaling algorithms) from UI components. No monolithic files. Keep components modular and reusable.
- **Clean Code:** Write self-documenting code with clear naming conventions, strict typing, and defensive programming against null/undefined states.

---

## 2. Real-Time State & Data Integrity Protocol
- **Sync & Conflict Resolution:** Implement robust state management (e.g., using Firebase Firestore listeners or efficient caching) to handle concurrent updates.
- **Real-Time Operations:** Kitchen KDS and Event Dashboards must reflect updates instantly (e.g., changing guest count or menu items) without full page reloads.
- **Optimistic UI:** Implement optimistic updates for swift user feedback, paired with automatic rollback mechanisms if a network error or database rejection occurs.

---

## 3. Role-Based Access Control (RBAC) Security
- **Multi-Tier Permissions:** Enforce strict access control across all frontend routes and backend rules for:
  - `Admin` (Full system access)
  - `Event Manager` (Operations, menu changes, schedule)
  - `Kitchen / Chef` (Inventory, purchase orders, prep lists)
  - `Staff / Waiters` (Read-only / limited task views)
  - `Accountant` (Financial reports and invoices)
- **Data Protection:** Never expose sensitive client data or internal financial margins in client-facing views. Validate all inputs both client-side and server-side.

---

## 4. Financial & Unit Calculation Guard (Precision Logic)
- **No Floating-Point Errors:** Always handle currency and financial figures using integers representing the smallest currency unit (e.g., Agorot/Cents) or dedicated precise math libraries. Never use standard float arithmetic for money.
- **Per-Capita Scaling:** Ensure recipes, ingredient quantities, and cost-per-dish scale dynamically and accurately based on guest count variations, minimizing food waste and budget discrepancies.

---

## 5. API, Webhook & Integration Contract
- **Standardized Payloads:** All external integrations (Make.com, WhatsApp notifications, payment gateways, accounting software) must use strict schema validation.
- **Resilient Error Handling:** Wrap all external API calls and Webhook listeners in try-catch blocks with structured logging, retry logic, and fallback states to prevent cascading failures.

---

## 6. UX/UI & Mobile-First Operational Design System
- **Context-Aware Design:** 
  - **Kitchen KDS & Mobile Views:** Must feature large touch targets, high-contrast dark/light modes for fast-paced, high-stress, low-lighting event environments, and zero lag.
  - **Manager / Desktop Dashboards:** Dense, data-rich layouts with clean tables, fast filtering, and clear visual hierarchies (using Tailwind CSS).
- **Frictionless Workflows:** Minimize clicks for critical actions (e.g., updating order status, confirming a supplier delivery, or checking off a prep item). Provide instant visual feedback for every user interaction.
- **Accessibility & Polish:** Maintain consistent spacing, intuitive iconography, responsive design across tablets and mobile phones, and accessible form states.
---

## 7. Project specifics (מטבחון)

- **Stack:** Node ≥22.18 running TypeScript directly (type stripping — no enums/parameter properties), Hono, SQLite via `node:sqlite`, React 19 + React Query + Tailwind v4, Vitest. See README.md for the full map.
- **Business rules live in `shared/`** and are imported by both server and web. Never duplicate a rule in a component.
- **Imports use explicit `.ts`/`.tsx` extensions**; web imports shared code via `@shared/…`.
- **Money:** integer agorot everywhere (`shared/money.ts`). Quantities (kg, units) are floats rounded with `q()`.
- **Permissions (venue isolation):** there is no check without a scope. Use `eventFor(user, id, module, level)` for anything of an event; `requireAt(c, module, level, venue)` for a record of one venue (venue `null` = central kitchen → all-venue grant only); `requireGlobal` for business-wide data (suppliers, catalog, settings, vehicles); `requireAny` only for lists, and then filter the query with `venueFilter` / `clientScope` / `warehouseScope` (`server/core/scope.ts`). `tests/scope.test.ts` scans every screen for other venues' names — add new endpoints to it. New modules go in `MATRIX` (`shared/permissions.ts`).
- **Edits:** PATCH endpoints take `{ changes, base }` and use `patchRow` (field-level conflict → 409). Forms use `useEditForm` + `ConflictPanel` + `UnsavedGuard`.
- **Tasks:** add a type to `shared/tasks.ts`, a trigger in `reconcileEvent` with a dedupe key, and an auto-completion check in `CHECKS`.
- **Every mutation:** `audit(...)`, `reconcileEvent(...)` when it touches an event, and `publish(...)` for live updates.
- **UI text is Hebrew, RTL**; use logical properties (`ms-`/`me-`/`start`/`end`), semantic color tokens from `styles.css`, and show status in words, not color only.
- **Integrations (Ubeya, accounting) are out of scope by business decision** — record references manually.
- Run `npm run typecheck && npm test` before finishing any change.
