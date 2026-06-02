# Scenario: ai-merchant

> An AI nation with a strongly merchant doctrine starts with panama (adjacent to costa_rica). autoAcceptTreaties is true so human Costa Rica auto-accepts any incoming proposals. Expected: the merchant AI scores propose_trade highly (0.1 + 0.6×merchant), proposes a trade treaty with adjacent Costa Rica within a few ticks. With autoAcceptTreaties, the treaty is accepted automatically. Both nations then show trade flows in treaty-metrics.csv.

**Ticks run:** 15
**Nations:** 6
**Scripted actions:** 2

---

## Nation Summary — Final State

| Nation | Territories | Avg Unrest | Max Unrest | Revolts at Final |
|---|---|---|---|---|
| Merchant AI | panama | 1.6% | 1.6% | 0 |
| Costa Rica | costa_rica | 1.6% | 1.6% | 0 |
| Guatemala | guatemala | 1.6% | 1.6% | 0 |
| Honduras | honduras | 1.6% | 1.6% | 0 |
| Nicaragua | nicaragua | 1.6% | 1.6% | 0 |
| Expansionist AI | mexico_yucatan, belize | 11.7% | 19.7% | 0 |

---

## Unrest & Equilibrium — Key Territories

### belize

| Tick | Owner | Unrest | Eq. | Shock | Compat | Infra | Distance |
|------|-------|--------|-----|-------|--------|-------|----------|
| T0 | — | 0.0% | 0.0% | 0.000 | — | — | — |
| T1 | nation_ai_expansionist | 0.0% | 30.3% | 0.000 | 0.668 | 0.000 | 0.040 |
| T2 | nation_ai_expansionist | 3.0% | 29.7% | 0.000 | 0.670 | 0.000 | 0.040 |
| T5 | nation_ai_expansionist | 10.1% | 27.9% | 0.000 | 0.674 | 0.000 | 0.040 |
| T10 | nation_ai_expansionist | 16.9% | 25.0% | 0.000 | 0.682 | 0.000 | 0.040 |
| T15 | nation_ai_expansionist | 19.7% | 23.2% | 0.000 | 0.688 | 0.000 | 0.040 |

---

## Event Timeline

| Tick | Event |
|------|-------|
| T1 | [AI] Merchant AI proposed a trade treaty with nation_costa_rica. |
| T1 | [AI] Expansionist AI claimed belize. |
| T2 | [AI] Expansionist AI proposed non-aggression with nation_guatemala. |
| T11 | Treaty #1001 between Merchant AI and Costa Rica has completed its term. Both parties gain Trust. |
| T11 | [AI] Merchant AI proposed a trade treaty with nation_costa_rica. |
| T12 | Treaty #1003 between Expansionist AI and Guatemala has completed its term. Both parties gain Trust. |
| T12 | [AI] Expansionist AI proposed non-aggression with nation_guatemala. |

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
| T12 | 54.0 | 54.0 | 54.5 | 50.0 | 50.0 | 54.5 |
| T15 | 52.5 | 52.5 | 53.0 | 50.0 | 50.0 | 53.0 |

### Wealth Over Time (shows collateral + tribute effects)

| Tick | Merchant AI | Costa Rica | Guatemala | Honduras | Nicaragua | Expansionist AI |
|---|---|---|---|---|---|---|
| T0 | 30.0 | 20.0 | 0.0 | 0.0 | 0.0 | 0.0 |
| T1 | 37.0 | 24.5 | 2.5 | 0.5 | 0.5 | 4.5 |
| T2 | 41.0 | 32.0 | 5.0 | 1.0 | 1.0 | 13.0 |
| T3 | 45.0 | 39.5 | 7.5 | 1.5 | 1.5 | 21.5 |
| T4 | 49.0 | 47.0 | 10.0 | 2.0 | 2.0 | 30.0 |
| T5 | 53.0 | 54.5 | 12.5 | 2.5 | 2.5 | 38.5 |
| T6 | 57.0 | 62.0 | 15.0 | 3.0 | 3.0 | 47.0 |
| T8 | 65.0 | 77.0 | 20.0 | 4.0 | 4.0 | 64.0 |
| T10 | 73.0 | 92.0 | 25.0 | 5.0 | 5.0 | 81.0 |
| T12 | 81.0 | 107.0 | 30.0 | 6.0 | 6.0 | 98.0 |
| T15 | 93.0 | 129.5 | 37.5 | 7.5 | 7.5 | 123.5 |

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
