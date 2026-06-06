# Scenario: ai-merchant

> An AI nation with a strongly merchant doctrine starts with panama (adjacent to costa_rica). autoAcceptTreaties is true so human Costa Rica auto-accepts any incoming proposals. Expected: the merchant AI scores propose_trade highly (0.1 + 0.6×merchant), proposes a trade treaty with adjacent Costa Rica within a few ticks. With autoAcceptTreaties, the treaty is accepted automatically. Both nations then show trade flows in treaty-metrics.csv.

**Ticks run:** 15
**Nations:** 6
**Scripted actions:** 2

---

## Nation Summary — Final State

| Nation | Territories | Avg Unrest | Max Unrest | Revolts at Final |
|---|---|---|---|---|
| Merchant AI | panama | 2.1% | 2.1% | 0 |
| Costa Rica | costa_rica | 1.6% | 1.6% | 0 |
| Guatemala | guatemala | 4.3% | 4.3% | 0 |
| Honduras | honduras | 4.3% | 4.3% | 0 |
| Nicaragua | nicaragua | 3.1% | 3.1% | 0 |
| Expansionist AI | mexico_yucatan, belize | 13.2% | 21.3% | 0 |

---

## Unrest & Equilibrium — Key Territories

### belize

| Tick | Owner | Unrest | Eq. | Shock | Compat | Infra | Distance |
|------|-------|--------|-----|-------|--------|-------|----------|
| T0 | — | 0.0% | 0.0% | 0.000 | — | — | — |
| T1 | nation_ai_expansionist | 0.0% | 30.3% | 0.000 | 0.668 | 0.000 | 0.040 |
| T2 | nation_ai_expansionist | 3.2% | 29.7% | 0.000 | 0.670 | 0.000 | 0.040 |
| T5 | nation_ai_expansionist | 10.8% | 27.9% | 0.000 | 0.674 | 0.000 | 0.040 |
| T10 | nation_ai_expansionist | 18.1% | 25.0% | 0.000 | 0.682 | 0.000 | 0.040 |
| T15 | nation_ai_expansionist | 21.3% | 23.2% | 0.000 | 0.688 | 0.000 | 0.040 |

---

## Event Timeline

| Tick | Event |
|------|-------|
| T1 | Guatemala has become insolvent (wealth -1.1). |
| T1 | Honduras has become insolvent (wealth -2.0). |
| T1 | Nicaragua has become insolvent (wealth -2.1). |
| T1 | Expansionist AI has become insolvent (wealth -0.3). |
| T1 | [AI] Merchant AI proposed a trade treaty with nation_costa_rica. |
| T1 | [AI] Expansionist AI claimed belize. |
| T2 | [AI] Expansionist AI proposed non-aggression with nation_guatemala. |
| T10 | Trade clause missed_payment: treaty #1001 clause 1 — insufficient wealth (have 2.8, need 3). |
| T11 | Trade clause missed_payment: treaty #1001 clause 1 — insufficient wealth (have 2.4, need 3). |
| T11 | Trade clause breached: treaty #1001 clause 1 — 2 consecutive missed payments. Trust penalty applied. |
| T11 | Treaty #1001 between Merchant AI and Costa Rica has completed its term. Both parties gain Trust. |
| T11 | [AI] Merchant AI proposed a trade treaty with nation_costa_rica. |
| T12 | Trade clause missed_payment: treaty #1013 clause 1 — insufficient wealth (have 2.0, need 3). |
| T12 | Treaty #1003 between Expansionist AI and Guatemala has completed its term. Both parties gain Trust. |
| T12 | [AI] Expansionist AI proposed non-aggression with nation_guatemala. |
| T13 | Trade clause missed_payment: treaty #1013 clause 1 — insufficient wealth (have 0.7, need 3). |
| T13 | Trade clause breached: treaty #1013 clause 1 — 2 consecutive missed payments. Trust penalty applied. |
| T13 | Merchant AI has become insolvent (wealth -0.7). |

---

## Diplomacy Summary

### Trust Over Time

| Tick | Merchant AI | Costa Rica | Guatemala | Honduras | Nicaragua | Expansionist AI |
|---|---|---|---|---|---|---|
| T0 | 50.0 | 50.0 | 50.0 | 50.0 | 50.0 | 50.0 |
| T1 | 50.0 | 50.0 | 50.0 | 50.0 | 50.0 | 50.0 |
| T2 | 50.0 | 50.0 | 50.0 | 50.0 | 50.0 | 50.0 |
| T3 | 50.0 | 50.0 | 50.0 | 50.0 | 50.0 | 50.0 |
| T4 | 50.0 | 50.0 | 50.0 | 50.0 | 50.0 | 50.0 |
| T5 | 50.0 | 50.0 | 50.0 | 50.0 | 50.0 | 50.0 |
| T6 | 50.0 | 50.0 | 50.0 | 50.0 | 50.0 | 50.0 |
| T8 | 50.0 | 50.0 | 50.0 | 50.0 | 50.0 | 50.0 |
| T10 | 50.0 | 50.0 | 50.0 | 50.0 | 50.0 | 50.0 |
| T12 | 35.0 | 54.0 | 54.5 | 50.0 | 50.0 | 54.5 |
| T15 | 15.0 | 52.5 | 53.0 | 50.0 | 50.0 | 53.0 |

### Wealth Over Time (shows collateral + tribute effects)

| Tick | Merchant AI | Costa Rica | Guatemala | Honduras | Nicaragua | Expansionist AI |
|---|---|---|---|---|---|---|
| T0 | 30.0 | 20.0 | 0.0 | 0.0 | 0.0 | 0.0 |
| T1 | 29.6 | 18.2 | -1.1 | -2.0 | -2.1 | -0.3 |
| T2 | 26.3 | 19.4 | -2.2 | -3.9 | -4.3 | -0.4 |
| T3 | 22.9 | 20.6 | -3.3 | -5.9 | -6.4 | -0.4 |
| T4 | 19.6 | 21.8 | -4.4 | -7.8 | -8.6 | -0.5 |
| T5 | 16.2 | 23.0 | -5.5 | -9.8 | -10.7 | -0.5 |
| T6 | 12.8 | 24.2 | -6.6 | -11.8 | -12.8 | -0.6 |
| T8 | 6.1 | 26.6 | -8.8 | -15.7 | -17.1 | -0.7 |
| T10 | 2.4 | 26.0 | -11.0 | -19.6 | -21.4 | -0.8 |
| T12 | 0.7 | 22.4 | -13.2 | -23.5 | -25.7 | -1.0 |
| T15 | -3.4 | 17.0 | -16.5 | -29.4 | -32.1 | -1.1 |

### Treaty Status Timeline

**Treaty #1001** (non_aggression + trade, 10-tick term, collateral 0)

| Tick | Status | Escrow A | Escrow B | Refund A | Refund B |
|------|--------|----------|----------|----------|----------|
| T0 | — | — | — | — | — |
| T1 | — | — | — | — | — |
| T2 | active | 0.0 | 0.0 | 0.0 | 0.0 |
| T3 | active | 0.0 | 0.0 | 0.0 | 0.0 |
| T4 | active | 0.0 | 0.0 | 0.0 | 0.0 |
| T5 | active | 0.0 | 0.0 | 0.0 | 0.0 |
| T6 | active | 0.0 | 0.0 | 0.0 | 0.0 |
| T8 | active | 0.0 | 0.0 | 0.0 | 0.0 |
| T10 | active | 0.0 | 0.0 | 0.0 | 0.0 |
| T12 | expired | 0.0 | 0.0 | 0.0 | 0.0 |
| T15 | expired | 0.0 | 0.0 | 0.0 | 0.0 |

**Treaty #1003** (non_aggression, 10-tick term, collateral 0)

| Tick | Status | Escrow A | Escrow B | Refund A | Refund B |
|------|--------|----------|----------|----------|----------|
| T0 | — | — | — | — | — |
| T1 | — | — | — | — | — |
| T2 | — | — | — | — | — |
| T3 | active | 0.0 | 0.0 | 0.0 | 0.0 |
| T4 | active | 0.0 | 0.0 | 0.0 | 0.0 |
| T5 | active | 0.0 | 0.0 | 0.0 | 0.0 |
| T6 | active | 0.0 | 0.0 | 0.0 | 0.0 |
| T8 | active | 0.0 | 0.0 | 0.0 | 0.0 |
| T10 | active | 0.0 | 0.0 | 0.0 | 0.0 |
| T12 | expired | 0.0 | 0.0 | 0.0 | 0.0 |
| T15 | expired | 0.0 | 0.0 | 0.0 | 0.0 |

**Treaty #1013** (non_aggression + trade, 10-tick term, collateral 0)

| Tick | Status | Escrow A | Escrow B | Refund A | Refund B |
|------|--------|----------|----------|----------|----------|
| T0 | — | — | — | — | — |
| T1 | — | — | — | — | — |
| T2 | — | — | — | — | — |
| T3 | — | — | — | — | — |
| T4 | — | — | — | — | — |
| T5 | — | — | — | — | — |
| T6 | — | — | — | — | — |
| T8 | — | — | — | — | — |
| T10 | — | — | — | — | — |
| T12 | active | 0.0 | 0.0 | 0.0 | 0.0 |
| T15 | active | 0.0 | 0.0 | 0.0 | 0.0 |

**Treaty #1015** (non_aggression, 10-tick term, collateral 0)

| Tick | Status | Escrow A | Escrow B | Refund A | Refund B |
|------|--------|----------|----------|----------|----------|
| T0 | — | — | — | — | — |
| T1 | — | — | — | — | — |
| T2 | — | — | — | — | — |
| T3 | — | — | — | — | — |
| T4 | — | — | — | — | — |
| T5 | — | — | — | — | — |
| T6 | — | — | — | — | — |
| T8 | — | — | — | — | — |
| T10 | — | — | — | — | — |
| T12 | — | — | — | — | — |
| T15 | active | 0.0 | 0.0 | 0.0 | 0.0 |


---

## Charts

- `charts/unrest-over-time.png` — Unrest per territory over all ticks
- `charts/equilibrium-belize.png` — Equilibrium component breakdown for belize
- `charts/nation-culture-drift.png` — Nation culture axis drift over time
- `charts/treaty-status-over-time.png` — Treaty status transitions + Trust + Wealth
- `charts/trade-flow-over-time.png` — Per-tick trade flows (paid/missed/degraded) alongside nation Wealth stockpiles

*Generated by the WAR simulation harness.*
