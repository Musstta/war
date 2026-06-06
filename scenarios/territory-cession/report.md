# Scenario: territory-cession

> Tests territory cession clause with and without embassy. Case A: Costa Rica signs a cession treaty to receive panama at T3 (transferAtTick=3). CR proposes and builds an embassy in panama at T1 (active by T4 — EMBASSY_BUILD_TICKS=3). Since the embassy is active before the grace period expires (CESSION_EMBASSY_GRACE_TICKS=3), the transfer executes. Case B: Guatemala signs a cession treaty to receive honduras at T3 with no embassy — grace period expires after 3 delay ticks and the clause is breached. Two separate treaties run in parallel.

**Ticks run:** 12
**Nations:** 5
**Scripted actions:** 4

---

## Nation Summary — Final State

| Nation | Territories | Avg Unrest | Max Unrest | Revolts at Final |
|---|---|---|---|---|
| Costa Rica | costa_rica, panama | 18.9% | 33.7% | 0 |
| Panamá | — | 0.0% | 0.0% | 0 |
| Guatemala | guatemala | 2.5% | 2.5% | 0 |
| Honduras | honduras | 2.5% | 2.5% | 0 |
| Nicaragua | nicaragua | 2.8% | 2.8% | 0 |

---

## Unrest & Equilibrium — Key Territories

### panama

| Tick | Owner | Unrest | Eq. | Shock | Compat | Infra | Distance |
|------|-------|--------|-----|-------|--------|-------|----------|
| T0 | nation_panama | 0.0% | 2.0% | 0.000 | 1.000 | 0.000 | 0.000 |
| T1 | nation_panama | 0.2% | 2.0% | 0.000 | 1.000 | 0.000 | 0.000 |
| T2 | nation_panama | 0.4% | 2.0% | 0.000 | 1.000 | 0.000 | 0.000 |
| T5 | nation_costa_rica | 11.2% | 57.5% | 0.450 | 0.972 | 0.000 | 0.040 |
| T10 | nation_costa_rica | 29.1% | 54.9% | 0.450 | 0.975 | 0.000 | 0.040 |

---

## Event Timeline

| Tick | Event |
|------|-------|
| T1 | Nicaragua has become insolvent (wealth -2.1). |
| T2 | Costa Rica began embassy construction in Panama. [3 ticks] |
| T3 | Territory cession for Panama delayed — no embassy present (grace tick 0/3). [PLACEHOLDER: CESSION_EMBASSY_GRACE_TICKS] |
| T3 | Territory cession for Honduras delayed — no embassy present (grace tick 0/3). [PLACEHOLDER: CESSION_EMBASSY_GRACE_TICKS] |
| T4 | Embassy of Costa Rica in Panama is now active. Visibility and compatibility effects begin. |
| T4 | Territory cession executed: Panama transferred from Panamá to Costa Rica. |
| T4 | Territory cession for Honduras delayed — no embassy present (grace tick 1/3). [PLACEHOLDER: CESSION_EMBASSY_GRACE_TICKS] |
| T5 | Territory cession for Honduras delayed — no embassy present (grace tick 2/3). [PLACEHOLDER: CESSION_EMBASSY_GRACE_TICKS] |
| T6 | Territory cession breached: Guatemala failed to establish embassy in Honduras within 3 ticks. [PLACEHOLDER: CESSION_EMBASSY_GRACE_TICKS] |

---

## Diplomacy Summary

### Trust Over Time

| Tick | Costa Rica | Panamá | Guatemala | Honduras | Nicaragua |
|---|---|---|---|---|---|
| T0 | 50.0 | 50.0 | 50.0 | 50.0 | 50.0 |
| T1 | 50.0 | 50.0 | 50.0 | 50.0 | 50.0 |
| T2 | 50.0 | 50.0 | 50.0 | 50.0 | 50.0 |
| T3 | 50.0 | 50.0 | 50.0 | 50.0 | 50.0 |
| T4 | 50.0 | 50.0 | 50.0 | 50.0 | 50.0 |
| T5 | 50.0 | 50.0 | 50.0 | 50.0 | 50.0 |
| T6 | 50.0 | 50.0 | 30.0 | 50.0 | 50.0 |
| T8 | 50.0 | 50.0 | 30.0 | 50.0 | 50.0 |
| T10 | 50.0 | 50.0 | 30.0 | 50.0 | 50.0 |
| T12 | 50.0 | 50.0 | 30.0 | 50.0 | 50.0 |

### Wealth Over Time (shows collateral + tribute effects)

| Tick | Costa Rica | Panamá | Guatemala | Honduras | Nicaragua |
|---|---|---|---|---|---|
| T0 | 30.0 | 20.0 | 30.0 | 20.0 | 0.0 |
| T1 | 28.2 | 19.6 | 23.9 | 19.5 | -2.1 |
| T2 | 26.4 | 19.3 | 22.8 | 19.1 | -4.3 |
| T3 | 24.6 | 18.9 | 21.7 | 18.6 | -6.4 |
| T4 | 23.4 | 17.9 | 20.6 | 18.2 | -8.6 |
| T5 | 22.3 | 16.9 | 19.5 | 17.7 | -10.7 |
| T6 | 21.1 | 15.9 | 17.4 | 22.2 | -12.8 |
| T8 | 18.8 | 13.9 | 13.2 | 21.3 | -17.1 |
| T10 | 16.5 | 11.9 | 9.0 | 20.4 | -21.4 |
| T12 | 14.2 | 9.9 | 4.8 | 19.5 | -25.7 |

### Treaty Status Timeline

**Treaty #1** (territory_cession, 20-tick term, collateral 0)

| Tick | Status | Escrow A | Escrow B | Refund A | Refund B |
|------|--------|----------|----------|----------|----------|
| T0 | — | — | — | — | — |
| T1 | active | 0.0 | 0.0 | 0.0 | 0.0 |
| T2 | active | 0.0 | 0.0 | 0.0 | 0.0 |
| T3 | active | 0.0 | 0.0 | 0.0 | 0.0 |
| T4 | active | 0.0 | 0.0 | 0.0 | 0.0 |
| T5 | active | 0.0 | 0.0 | 0.0 | 0.0 |
| T6 | active | 0.0 | 0.0 | 0.0 | 0.0 |
| T8 | active | 0.0 | 0.0 | 0.0 | 0.0 |
| T10 | active | 0.0 | 0.0 | 0.0 | 0.0 |
| T12 | active | 0.0 | 0.0 | 0.0 | 0.0 |

**Treaty #2** (territory_cession, 20-tick term, collateral 5)

| Tick | Status | Escrow A | Escrow B | Refund A | Refund B |
|------|--------|----------|----------|----------|----------|
| T0 | — | — | — | — | — |
| T1 | active | 0.0 | 0.0 | 0.0 | 0.0 |
| T2 | active | 0.0 | 0.0 | 0.0 | 0.0 |
| T3 | active | 0.0 | 0.0 | 0.0 | 0.0 |
| T4 | active | 0.0 | 0.0 | 0.0 | 0.0 |
| T5 | active | 0.0 | 0.0 | 0.0 | 0.0 |
| T6 | active | 0.0 | 0.0 | 0.0 | 0.0 |
| T8 | active | 0.0 | 0.0 | 0.0 | 0.0 |
| T10 | active | 0.0 | 0.0 | 0.0 | 0.0 |
| T12 | active | 0.0 | 0.0 | 0.0 | 0.0 |


---

## Charts

- `charts/unrest-over-time.png` — Unrest per territory over all ticks
- `charts/equilibrium-panama.png` — Equilibrium component breakdown for panama
- `charts/nation-culture-drift.png` — Nation culture axis drift over time
- `charts/treaty-status-over-time.png` — Treaty status transitions + Trust + Wealth

*Generated by the WAR simulation harness.*
