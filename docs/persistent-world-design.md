# Persistent World Strategy Game — Master Design Document

**Status:** Working draft. This document is the single source of truth for building the game. Sections marked **[OPEN]** are unresolved and must be decided before that system is built. Sections marked **[DECIDED]** are locked unless explicitly revisited.

**Design thesis:** *Create stories and diplomacy while preventing the map from becoming one giant blob.* Every mechanic should be testable against this sentence. If a mechanic doesn't serve it, cut the mechanic.

**Target context:** ~5 players, all in Costa Rica (single timezone — simplifies the day-cycle design considerably). May grow later. Design for 5, don't over-engineer for 50.

---

## 1. Core Concept

A persistent world strategy game on a real-world map. Players run nations that grow through diplomacy, infrastructure, trade, war, and cultural integration. The world runs continuously, including while players are offline. The objective is not world conquest — it is to build a nation that stays stable, legitimate, and influential over time. A well-run 10-territory nation should be able to threaten a poorly-run 50-territory empire.

---

## 2. Time Model [DECIDED — core, OPEN — numbers]

The game runs on **daily ticks**. Each real day is one game day, structured in two phases.

**Main Phase** — from tick start until **7:00 PM server time (Costa Rica, UTC-6)**.
The player performs their consequential actions: declaring war, signing/breaking treaties, building infrastructure, expanding, annexing rebels, etc. Actions are constrained by the **Mandate** budget (Section 3).

**Preparation Phase** — from 7:00 PM until **midnight**.
The player may take **at most one** low-impact action — currently only **troop movement**. This exists so a player can reposition for tomorrow without it counting as a "real" turn. No building, no diplomacy, no attacking in this phase.

**Tick resolution** happens at **midnight**. The world advances: production is added to stockpiles, upkeep is deducted, unrest accrues/decays, integration progresses, AI nations act, combat that was queued resolves.

**Undo:** within a phase, a player can freely undo and re-plan their queued actions before the phase deadline. Once the phase deadline passes, the queue is locked and submitted.

**Missed day (forgot, but not inactive):** the nation still produces into stockpiles, still pays upkeep, still accrues/decays unrest. Nothing moves, builds, or attacks from their side — but they **can still be attacked**. A single missed day carries **no special penalty** beyond the natural opportunity cost. Penalties only escalate through the inactivity tiers (Section 11).

**UI requirement:** every player sees a live countdown to the next phase deadline, displayed in their local time. The server timezone is fixed and stated in-app.

### [OPEN] Time-model numbers
- How long does a road / port / fortification level take to complete — one tick, or several? **[PLACEHOLDER — values exist in engine: road 1 tick, port 3 ticks, fort L1 3 ticks / L2 7 ticks / L3 14 ticks. Revisit after first full war playtest.]**
- How long does a war take to resolve end-to-end (see Section 9)?
- All durations, upkeep rates, integration rates, and unrest rates are denominated in **ticks**. No number in this document is final until it has a tick unit attached.

---

## 3. The Mandate System [DECIDED — concept, OPEN — numbers]

Players do not have an unlimited turn or a fixed action count. Each nation has a daily **Mandate** pool. Every Main-Phase action costs Mandate. When the pool is spent, the day is over for that nation.

This replaces "one action per day" (too slow, punishes large nations) and "act until 7 PM" (rewards whoever has the most free time). Mandate makes "what do I do today" a genuine decision.

**Mandate pool scales with territory development, not with stockpiles.** [DECIDED — placeholder values; structural fix from earlier accumulation bug]

Formula: **3 + 1 per developed territory + 1 per fully fortified territory**, where:
- *Developed* = road + port + fort L1+ (any fortification)
- *Fully fortified* = road + port + fort L3 (maximum fortification)

These bonuses are cumulative: a fully-fortified territory earns both the developed bonus and the fully-fortified bonus (+2 total). Inland territories cannot earn bonuses because they cannot build ports — intentional, ports represent economic integration and administrative reach.

Rationale for decoupling from stockpiles: the original resource-based formula let Mandate grow unboundedly as wealth accumulated with no sink, producing pools of 50+ at tick 55. The development-based formula creates a meaningful ceiling tied to player choices (what to build) rather than the passage of time.

**Trust modifies diplomacy costs.** High Trust makes diplomatic actions *cheaper* in Mandate; low Trust makes them *more expensive*. A distrusted nation finds every treaty and negotiation a heavier lift — psychologically and mechanically. (See Section 8.)

**Action cost tiers (illustrative, [OPEN] for exact values):**
- *Cheap:* build a road segment, minor development.
- *Moderate:* build a port/fortification, propose a standard treaty, initiate trade.
- *Expensive:* declare war, annex a rebel territory, break a treaty, large-scale mobilization.

### [OPEN] Mandate questions
- **Base value of 3 and linear +1/+1 scaling are placeholders.** Once the full action set exists (diplomacy, trade, military orders), the total Mandate demand will be clear enough to tune. Likely needs a sublinear curve or hard cap at large empire scale to prevent the action space from becoming overwhelming.
- Does unspent Mandate carry over to the next day, or is it use-it-or-lose-it? (Recommend: no carryover, or a small cap — carryover lets players bank for a megaturn, which can feel bad for the target.)
- Do diminishing returns apply at empire scale, so a nation that has developed 20 territories doesn't also dominate the action economy?

---

## 4. The World

### 4.1 Map [DECIDED]
Interactive world map. Territories are real-world administrative regions: US states, Canadian provinces, Chinese provinces, Russian federal subjects, large countries subdivided, small countries as a single territory. Target **200–500 territories** worldwide — enough for meaningful geography, few enough to stay manageable.

### 4.2 Game Start [DECIDED]
1. The entire world begins **unclaimed**.
2. **All human players join and lock in their starting territory first.** The world does not populate until every player has chosen. This removes the first-mover advantage — no one picks from a pre-shaped map.
3. After all players are locked in, **AI nations populate** the world. Roughly **20% of the map** receives AI nations at start, leaving room for expansion.
4. AI doctrine and culture are influenced by spawn region (Section 10).

### 4.3 Fog of War [DECIDED]
The map exists but information is partial. A player sees: their own territories, adjacent territories, allied territories, and major world events (via the Event Log, Section 12). Unknown areas stay vague. Preserves exploration and uncertainty.

---

## 5. Resources [DECIDED]

Exactly **three**. Do not add a fourth.

**Population** — produces manpower. Used for troops and growth.
**Industry** — produces infrastructure. Used for roads, ports, ships, fortifications.
**Wealth** — economic output. Used for army upkeep, trade, treaty collateral, development.

Mandate pool is no longer derived from these resources — see Section 3 for the current formula (territory development).

---

## 6. Territory Attributes [DECIDED — model, OPEN — tuning]

Every territory has:

- **Population** — workforce and recruitment pool.
- **Industry** — production capability.
- **Wealth** — economic productivity.
- **Geography** — coastal, inland, mountainous, desert, forest. Affects movement, defense, development.
- **Culture** — see Section 7.

---

## 7. Culture & Cultural Integration [DECIDED — model is a central pillar]

Culture is one of the most important systems in the game and must never feel arbitrary to players.

### 7.1 Cultural traits
Every territory has a **cultural family** (e.g. Latin, European, Arab, Slavic, East Asian, African) and a set of **value traits** along axes:
- Collectivist ↔ Individualist
- Traditional ↔ Progressive
- Militaristic ↔ Peaceful
- Expansionist ↔ Isolationist

### 7.2 Cultural Compatibility
Each territory computes a **Cultural Compatibility** score against its owning nation.
- High compatibility → stable, loyal.
- Low compatibility → unrest, rebellion risk.

**Legibility requirement (hard rule):** the player must always be able to see *why* a territory is unhappy and *what would help*. The territory/integration screen must show the causal chain in plain language ("unhappy because: distant from capital, cultural mismatch on Militaristic axis, no road connection — building a road would reduce unrest by ~X"). If players experience rebellions as opaque, the system has failed.

### 7.3 The nation's culture is emergent
A nation's overall culture is the **combination of all its territories' cultures**. It is not set by the player directly.

### 7.4 Integration is two-way [DECIDED]
Newly conquered territories integrate over time. Integration is **mutual**:
- The conquered territory drifts toward the empire's culture (the larger pull).
- The empire also drifts a **smaller** amount toward the conquered territory's culture.

Integration improves through roads, trade, investment, and stability — **not** through troop presence. Troops maintain *order*; they do not change *culture*.

### 7.5 Traits can change over time [DECIDED — design the data model for this now]
Value traits are not permanently fixed. They are *loosely derived* from the blended culture values of a nation's territories, **plus a probability tick**. Example: a Peaceful empire that conquers a Militaristic culture and successfully keeps its unrest low *while not at war* may, over many ticks, have a probability roll to flip that territory toward Peaceful — while the empire itself becomes slightly more Militaristic from absorbing the culture.

**Build implication:** even if traits are static at launch, the data model must store traits as mutable values with drift rules, not as constants. Retrofitting drift later is expensive.

### [OPEN] Culture questions
- Exact compatibility formula and weighting of each value axis.
- Drift rates and probability-tick frequency for trait changes.
- Contextual modifiers: should a Militaristic territory be *happier during war* and *restless during long peace*? (Strongly recommended — it keeps culture from becoming a solved lookup table after week two. Decide before launch whether v1 includes it.)

---

## 8. Diplomacy, Treaties & Trust

### 8.1 Alliances [DECIDED]
Defensive pacts, trade agreements, coalitions. Provide shared protection and shared prosperity.

### 8.2 Treaties [DECIDED]
Server-enforced — they cannot simply be ignored. Clause types available:
- Non-aggression
- Trade / resource sharing
- Military access
- Tribute
- Defense pact (mutual defense)

### 8.3 Treaty structure: multi-clause treaties [DECIDED]
A treaty is a **container of one or more clauses sharing a single time period**. A player can bundle (e.g.) trade + non-aggression into one 12-day treaty, or send several separate treaties with different terms and clause sets.

- **Mandate cost is per *treaty*, not per clause.** One bundled five-clause treaty costs the same Mandate as a one-clause treaty. Sending several separate treaties costs more total Mandate.
- This is a deliberate **efficiency-vs-flexibility tradeoff:** one big treaty is Mandate-cheap but rigid (all clauses share a term, rise and fall together); several small treaties cost more Mandate but each term is independently tunable.
- **Accepting** a treaty also costs Mandate — **less** than proposing one, but not free.
- **A treaty breaks as a single unit.** You cannot break individual clauses. If you want clauses you can drop independently, that is what separate treaties are for. This keeps the bundle-vs-separate decision meaningful.

### 8.4 Treaty Collateral [DECIDED]
Both sides deposit Wealth as collateral when signing.
- In a multi-clause treaty, **each clause has its own collateral value** (mutual defense is typically more expensive than resource sharing), and these **roll up into one pooled collateral total** for the treaty.
- **Voluntarily breaking** a treaty transfers the full pooled collateral to the wronged party and damages the breaker's Trust and reputation.

### 8.5 Treaties and inactive nations — "treaty degradation" [DECIDED]
When a nation becomes inactive, its treaties do **not** break — nobody *chose* to break anything. Each treaty **degrades to its weakest honest form**: the strongest version of itself the caretaker AI can actually honor. A **defense pact** downgrades to a **non-aggression pact** (the caretaker AI is non-aggressive and cannot march to an ally's aid, but will not betray them). **Non-aggression and trade/resource treaties** are honorable by the caretaker AI and continue unchanged. When the player returns, degraded treaties **auto-upgrade** to full form.

This closes the exploit where an aggressor waits for an ally to go inactive to get a "free" treaty break.

**Collateral handling during degradation [DECIDED]:**
- The **active partner's** collateral is **fully and quickly refunded** to them once the other party goes Dormant. They committed Wealth for protection that can no longer be delivered; leaving them out-of-pocket *and* exposed would be unfair. This is the server unwinding an unhonorable contract — it is not a penalty paid by anyone.
- The **inactive player's** collateral is held in **escrow**, not seized. On return, it is refunded and the treaty auto-upgrades.
- **No Trust hit for going inactive.** Trust measures whether a player keeps promises they *consciously chose* to make. Absence is not a broken promise. Treaty degradation is deliberately blameless — attaching Trust loss to it would collapse the distinction between *degrading* and *breaking*. Consequences for prolonged absence are delivered by the activity tiers (Section 11), not by the Trust system.
- **Escrow skim (the deterrent) [DECIDED]:** when the returning player reclaims their escrowed collateral, the server skims a **small percentage in Wealth**, scaled to how much was escrowed and how long it sat. This is a "cost of capital" fee — the absentee pays for the liquidity their partner had to do without. It is felt but not crippling, and it discourages the defense-pact-then-AFK pattern **without** corrupting the Trust signal other players steer by. Repeat offenders pay more.
- The **active player may formally break a degraded treaty** at any time (to free the slot / signal they no longer rely on the partner). This costs them **nothing** and costs **no Trust** — you cannot break a promise the other party already cannot keep. Breaking early **shortens the absentee's escrow duration**, and therefore *reduces* their eventual skim — a small mercy, not a punishment.

### 8.6 Trust [DECIDED]
Trust is a nation-wide reputation value — the diplomatic credit score. It measures one thing only: **does this player keep promises they consciously chose to make.**
- **Voluntarily breaking** agreements lowers Trust.
- **Closing out a treaty** at the end of its term *raises* Trust.
- **Peacetime passively rebuilds Trust** — not breaking anything over time pulls Trust back toward a baseline (≈50%). Prevents a death spiral where a burned player can never recover because no one will sign with them.
- High Trust: diplomacy is cheaper (Mandate) and treaty terms are better.
- Low Trust: diplomacy is more expensive and harder; other nations are more suspicious.
- **Below 50% Trust:** the nation pays ongoing **fines** on the treaties it still maintains.
- Going inactive does **not** affect Trust (see 8.5).

### 8.7 Exploit watch
- Voluntarily breaking a treaty must be genuinely painful for a *rational* player, not just flavor. If collateral loss + Trust loss is cheaper than the gain from breaking, the system is too weak — tune collateral and fines upward until breaking is a real sacrifice.

### [OPEN] Diplomacy questions
- Trust scale: 0–100? Starting value? Baseline it decays toward (≈50 assumed).
- Exact fine rates below 50% Trust.
- Passive peacetime Trust recovery rate (per tick).
- Escrow skim: exact percentage curve (by amount escrowed × time in escrow).
- Can collateral be partially lost on a *voluntary* break (proportional to how early), or always all-or-nothing?

---

## 9. War System [DECIDED — model, OPEN — numbers]

### 9.1 Declaring war [DECIDED]
- Declaring war is an **expensive Mandate action** (Section 3).
- A declaration is a major Event Log entry visible to the whole world.
- Before confirming, the player sees the **projected delta** (Section 15.5): Trust change, unrest impact on their territories, and potential Prestige outcomes.
- **[DECIDED]** Casus belli: **soft CB**. War without a justification is legal but costs additional Trust loss ([PLACEHOLDER] −10 extra) and spikes unrest in Peaceful and Isolationist territories ([PLACEHOLDER] +0.05 equilibrium for 5 ticks). With a justification, neither penalty applies. Justification types: broken treaty, unprovoked attack on an ally, territorial claim (player-stated, not engine-verified).

### 9.2 Combat resolution model [DECIDED]
- **Tick-resolved.** Combat actions are queued during the Main Phase and resolve at the midnight tick. No real-time combat — nobody loses a battle because they were asleep.
- Battle outcome is a function of: attacking force size, defending force size, **fortification level** (Section 13), **geography** of the contested territory (mountains/forest favor defenders), road/logistics connection, and a small **seeded** random factor (seeded so ticks are replayable — Section 17).
- **Per-territory granularity:** an attack targets one adjacent territory and resolves at the tick.

### 9.3 Sieges & fortifications [DECIDED]
- Taking a fortified territory takes **multiple ticks** — fortification level sets the minimum siege duration.
- A besieging army must maintain presence; if it leaves or is driven off, siege progress is lost or decays.
- **Siege relief is allowed:** an allied or reinforcing army arriving in time can break a siege. This is a deliberate story-generator — it makes army timing and logistics dramatic.

### 9.4 Amphibious invasion [DECIDED — model]
- Crossing oceans requires Transport Ships (Section 14).
- Amphibious invasions suffer **penalties**, heaviest against fortified coasts, ports, and established territories. **[OPEN]** exact penalty values.

### 9.5 Occupation vs. annexation [DECIDED]
- **Occupy during war, annex at peace.** Winning a battle for a territory **occupies** it — provisional control while the war continues. Territory only becomes permanently yours (**annexed**) when the war ends and a peace deal assigns it.
- **Occupied territory generates unrest** from being under siege/occupation — and culture multiplies this: a territory culturally disposed to resist (e.g. Militaristic, or a hostile cultural family) suffers more. But **integration unrest does not begin until annexation** — you are not yet trying to assimilate it, only holding it.
- This keeps the map from churning chaotically mid-war and makes the peace deal the actual climax of the war.

### 9.6 Ending a war — the peace negotiation [DECIDED]
- War ends through a **negotiation step**, then a **sign-off**. Before any peace is finalized, all belligerents enter a negotiation where they decide how the war ends — an empire can demand territories or resources be ceded as the price of peace.
- Possible outcomes: negotiated peace (cessions, tribute), white peace (status quo, both walk away), or de-facto surrender when one side is crushed.
- A finalized peace deal is itself a treaty (collateral, Event Log entry, Trust implications).

### 9.7 War unrest / war exhaustion [DECIDED — model]
War unrest is **not a flat timer.** It is driven by specific bad-state conditions, each of which the player chose or can fix. A competent empire fighting a genuinely hard war near home, paying its bills, and negotiating in good faith should generate **almost no** war unrest and may fight as long as it likes. Culture is the **multiplier** across all of the below — Peaceful/Isolationist territories take more, Militaristic territories take less (and may even be *calmed* by war).

- **Overextension** — unrest scales with how far occupied/besieged territory is from the capital and how culturally hostile it is. Punishes the *shape* of ambition, not the duration. A hard war on your own border barely registers.
- **Sloppy/over-fast expansion** — unrest from occupied territory you hold but cannot properly garrison or supply. Grabbed more than you can logistically support → it bites back.
- **Stalling / insolvency (the key one)** — tied to **upkeep, not the clock.** A war you can comfortably *afford* generates little exhaustion no matter how long it runs. The unrest ramp kicks in only once Wealth can no longer cover war upkeep — you are fighting on credit, and *that* spirals. Duration is fine; **insolvency** is the killer. Self-correcting: a war you can pay for is a war you are allowed to keep fighting.
- **Refusing reasonable terms** — when a peace sign-off fails, an exhaustion bump is applied to **whichever party walked away** from the standing offer. Stubbornness is named and costed, and it is targeted at the side that said no. **[OPEN]** how "reasonable" is defined — simplest version: any party rejecting a proposed deal takes the bump, symmetric, pressuring both sides toward *yes*.

The throughline: every war-unrest source is a **legible, fixable condition** — pull back to defensible borders, garrison what you hold, keep the war solvent, take the deal. This is the anti-blob thesis enforced as physics: an empire over-reaching into hostile land it cannot afford or supply, refusing every offer, collapses correctly. The unrest ramp must be tuned slow enough that *difficulty* alone never trips it — only *stubbornness and overreach*.

### 9.8 War and the Dominant nation [DECIDED]
See Section 15.4 — attacking the Dominant nation gives the attacker an unrest discount and outsized Prestige, so the leader cannot snowball unchecked.

### 9.9 Raiding wars [DECIDED — stubbed]
A war may be fought with **no intent to take land** — purely to extract Wealth/tribute via the peace deal. This gives weaker nations a way to be threatening without conquest. Raid wars are in the design and data model. A war may be declared with type `raid` — the peace deal can demand Wealth/tribute instead of territory. Engine stub in v1 War; full mechanics activate post-v1. Raid type stored on the War record.

### [OPEN] War — remaining numbers
- Amphibious penalty values. **[DEFERRED to Phase 7 — see tech-stack §10]**
- Battle formula exact weights (force / fort / geography / logistics / random spread).
- Siege duration per fortification level.
- War upkeep rates and the insolvency unrest ramp curve.
- Definition of "reasonable terms" for the rejection bump.
- Soft-CB Trust/unrest penalty magnitudes ([PLACEHOLDER] values in §9.1).

---

## 10. AI Nations [DECIDED — model, OPEN — tuning]

The world contains **active** AI nations, not placeholders. Their role: populate the world, create opportunities, generate stories — **not** dominate players.

### 10.1 Doctrine system
AI behavior is a blend of percentages, never a single personality. Example:
```
Expansionist: 40%
Merchant:     35%
Industrialist: 20%
Isolationist:  5%
```

### 10.2 Regional flavor
Doctrine and culture are influenced by spawn location — merchant-heavy coasts, industrial inland powers, expansionist frontier states. Names are region-appropriate, not random fantasy names.

### 10.3 AI behavior
AI may expand, fortify, trade, develop, and fight neighbors — but at **reduced efficiency** compared to humans.

### [OPEN] AI questions
- Exact efficiency penalty vs. human players.
- Can AI nations sign treaties with human players? (Recommended yes — feeds diplomacy.)
- Can AI nations gain/lose Trust and Prestige? (Recommended yes, for consistency.)

---

## 11. Activity & Player-Delegated AI

### 11.1 Player priorities [DECIDED]
A player configures a national priority list the caretaker AI follows while they are away, e.g.:
```
1. Defense
2. Roads
3. Industry
4. Expansion
```

### 11.2 Activity tiers [DECIDED — thresholds OPEN/tunable]
- **Active** — player logs in regularly. Full control.
- **Dormant** (≈3 days inactive) — caretaker AI maintains the nation. Treaty degradation begins (Section 8.5).
- **Autopilot** (≈7 days inactive) — caretaker AI follows the configured priority list.
- **Abandoned** (≈14 days inactive) — the nation declines: may fragment, rebel, or become an independent AI state. Ownership is **never** lost before this tier; the player can return any time before Abandoned with no penalty to ownership.

Thresholds (3/7/14 days) are a starting point for a 5-player friend group and should be tuned in playtesting.

### 11.3 Autopilot is defensive-only [DECIDED]
This is a deliberate balance decision. The caretaker AI on Autopilot will **hold borders and maintain infrastructure but will not expand or initiate war.** Reasons:
- If autopilot played a *full* game well, there'd be little reason to log in.
- If it played badly, absent players would get eaten and quit.
- Defensive-only keeps an absent player *alive and intact* without the AI winning the game on their behalf. The player returns to roughly the nation they left, plus accumulated stockpiles.

The caretaker AI is **non-aggressive** at all inactive tiers — this is what drives treaty degradation (a non-aggressive AI cannot honor a defense pact).

### [OPEN] Activity questions
- Final threshold tuning.
- At Abandoned, what exactly triggers fragmentation — a flat timer, or unrest-driven?
- Does a returning Abandoned player reclaim the *whole* nation, or only what hasn't fragmented away?

---

## 12. Unrest & Rebellions [DECIDED]

### 12.1 Unrest sources
Cultural mismatch, distance from capital, broken promises, overexpansion, neglected infrastructure, prolonged war (for Peaceful/Isolationist territories).

### 12.2 Unrest reduction
Roads, Wealth investment, cultural integration, stability, military presence. Unrest cannot realistically be driven to zero permanently — management, not elimination.

### 12.3 Rebellion types
- **Territory Rebellion** — a single territory attempts independence.
- **Cultural Rebellion** — multiple culturally-similar territories rebel together as a bloc (e.g. an "Eastern Coalition").
- **Foreign Alignment** — rebels request annexation by another nation; that nation may accept, potentially triggering war.

Rebellions are **never random** — they emerge legibly from accumulated unrest, and the player should always have seen it coming via the territory screens (Section 7.2).

---

## 13. Infrastructure [DECIDED]

- **Roads** — built with Industry. Faster movement, better logistics, better cultural integration, reduced unrest.
- **Ports** — built with Industry. Required for maritime logistics; improve trade and naval transport.
- **Fortifications** — levels 0–3. Increase defensive strength and siege duration; decrease ease of conquest.

### [OPEN]
- Build times per structure (in ticks).
- Do roads need to connect to form a network, or does each segment help locally?

---

## 14. Military & Naval [DECIDED]

- Troops require **Population** and **Wealth**, and have ongoing **upkeep**. Infinite armies are impossible.
- **Ships are transports, not combat fleets.** Example: a Transport Ship carries 100 troops. Crossing oceans requires ships. There is no naval *combat* layer — naval is purely logistics.

### [OPEN]
- Is there any way to contest enemy transports at sea, or are ocean crossings always safe once you have ships? (Leaving it safe keeps the game simpler and is consistent with "no naval combat" — recommended.)

---

## 14A. Trade [DECIDED — model, OPEN — numbers]

Trade is a **major pillar**, not wallpaper. It is the principal *non-military* lever for building a stable, influential nation — the peaceful counterweight to conquest. The middle-tier model below is deliberately designed so it can grow toward a full route/logistics model later (see 14A.6) without re-architecture.

### 14A.1 What a trade deal is
A trade deal is a **negotiated, bilateral, time-bound agreement** — the same shape as a peace deal or any treaty. The two parties negotiate three things: **what flows, how much, and for how long.**

The three resources (Population, Industry, Wealth) are tradeable **as goods**, not merely held as stockpiles. Trade exists *because* nations have different surpluses and shortages — e.g. a Population-rich nation trades manpower for a Wealth-rich nation's money. That asymmetry is the engine of the entire system. A deal looks like: "I send 100 Population/tick, you send 60 Wealth/tick, for 14 days."

### 14A.2 Routes have Capacity and Friction — NOT players [DECIDED — this is the throttling model]
The critical design decision: **geography does not rank nations from good-trader to bad-trader.** Throttling is a property of the **route between two specific nations**, computed **symmetrically from the pair**, never a flat tax on one nation's stat sheet. Each potential trade connection has:

- **Capacity** — volume that can flow per tick. Set by infrastructure on both ends and along the path: ports on both sides + a sea link = high capacity; a road connection across a shared land border = solid capacity; neither = a thin trickle. *This is where ports and roads earn their peacetime payoff.*
- **Friction** — value lost in transit (a cut off the top). Rises with distance and with crossing hostile/unintegrated territory; falls with roads, short borders, and intermediate allies granting passage.

**Why this solves the "Mongolia problem":** a landlocked nation has genuinely bad *sea* routes (low capacity, high friction) — but an excellent, fat, low-friction *overland* route with large neighbors once roads are built. It is not "bad at trade"; it is bad at one *kind* of route and excellent at another. The UK is the mirror: superb global sea trade, but no land neighbors at all, so it depends entirely on ports and shipping and can be blockaded in a way the landlocked nation cannot. **Every nation gets a distinct trade *shape* — a different map of natural partners — rather than a different trade *rank*.** No nation is ever left out of trade; it simply trades differently.

**Routes are improvable.** Friction is mitigated by roads and intermediate territory, so a player can *invest their way* into a better route. A "bad" route is never a permanent verdict — it is a target for Industry spending. This gives infrastructure a clear, ongoing trade payoff.

### 14A.3 Negotiation
Because Capacity and Friction are pair-specific, a trade deal is a genuine negotiation, not a passive trickle. A nation with a great route to you, or one you badly need a resource from, has leverage. This should feel like the peace-deal table. Prestige tilts the table — see 14A.5.

### 14A.4 Trade feeds the rest of the design
Trade is one of the few **non-military** levers that **reduces unrest** and **improves cultural integration** — a conquered territory with a live trade route running through it integrates faster. This is what makes trade a pillar: it is a peaceful path to a stable empire. A 10-territory trade hub can out-stabilize a 50-territory blob.

### 14A.5 Prestige and trade — the underdog bonus [DECIDED — corrects 15.3]
When two nations trade, the **lower-Prestige party receives a bonus scaled to the Prestige gap** — e.g. reduced unrest and/or a small Prestige gain of their own. A low-Prestige nation securing a deal with a high-Prestige one is a diplomatic coup and is *celebrated*.

The high-Prestige nation does **not** get a trade-negotiation bonus — it already enjoys its Prestige perks (reduced Trust penalties, the Dominant war advantage). No double-dipping. The effect of this: the Dominant nation becomes a *desirable, courted patron* whose partners are lifted — making the leader simultaneously a threat, a target, and a patron. Three relationships other nations can choose to have with the leader; none of them is "the leader auto-wins."

### 14A.6 Route interdiction [DEFERRED — but architect for it now]
Blockading or cutting an enemy's trade routes in wartime is a strong war-story generator ("the blockade of the overland route") and the bridge to a full tier-three logistics model. **Not built for v1.** But — same principle as mutable culture traits — **store every route as a real object with an explicit path through specific territories**, not as an abstract link between two nation IDs. If routes are abstract, interdiction can never be added without re-architecture.

### 14A.7 How many trades can a nation run?
**No hard cap.** Trade volume is naturally limited by (a) the Mandate cost of negotiating each deal and (b) per-route Capacity limits. *In addition*, **culture constrains it:**

- An **Isolationist** culture/territory generates unrest when the nation becomes *defined by* external entanglement — **too much trade combined with too little internal investment and too few wars**. This is a *portfolio balance*, not a raw count: three trade deals alongside heavy internal development reads as self-reliant and keeps Isolationist territories content; three trade deals with no internal investment reads as a nation that has "lost itself."
- A **Merchant / Individualist** culture is the opposite — it generates unrest from *too little* trade and wants the trade web.

This completes a deliberate pattern across the culture axes: **Militaristic** is restless in long peace and calmed by war; **Peaceful** suffers in prolonged war; **Isolationist** suffers from over-entanglement and under-investment; **Merchant** suffers from too little trade. Culture is not a stat that modifies outcomes — it is a **constraint on what kind of nation you can be without bleeding.** A culturally heterogeneous blob has some territory unhappy with *whatever* the nation does. (Anti-blob thesis, wearing a trade hat.)

### [OPEN] Trade questions
- Exact Capacity values by infrastructure config (port+port+sea / road border / none).
- Friction formula (distance, hostile-territory crossing, road mitigation).
- Size of the lower-Prestige underdog bonus.
- Isolationist trade-unrest balance formula (trade vs internal investment vs war).
- Merchant under-trade unrest formula.
- Can a trade deal include more than two parties, or strictly bilateral?

---

## 15. Prestige & the Win Condition [DECIDED — concept]

The game has **no hard win condition**. It is persistent. But it needs a contested, visible scoreboard so the group always has something to argue about — especially months in, after the first conquest phase settles.

### 15.1 Prestige
Every nation has a public **Prestige** score, recalculated **weekly**, visible to all players. It is derived only from things other players could plausibly observe anyway:
- Territory count
- Number of standing treaties
- War outcomes
- Age of the nation
- Cultural cohesion (low average unrest)
- Visible infrastructure

**Prestige is NOT derived from raw Wealth or Population** — those stay private (fog of war for the economy). Prestige is the *public face* of a nation's success.

### 15.2 Prestige is mostly social currency
Prestige's primary job is to be the thing the group fights over. To keep it rich, present it as a **leaderboard with history**, not just a current ranking: "longest time at #1," "biggest climb this month," "most treaties never broken," etc. One ranking becomes a dozen little contested narratives.

### 15.3 Prestige's mechanical effects [DECIDED]
Prestige has *some* mechanical weight, kept deliberately modest:
- **Reduced Trust penalties** — a high-Prestige nation suffers smaller Trust hits.
- **Underdog negotiation bonus** — when two nations make a deal (trade or treaty), the **lower-Prestige party** receives a bonus scaled to the Prestige gap (reduced unrest and/or a small Prestige gain). Dealing with a powerful nation is a coup and is rewarded. The high-Prestige party does **not** also get a bonus — no double-dipping; it already has the perks in this list. See 14A.5.
- **The "Dominant" trait** — the single top-Prestige nation gains the **Dominant** status (think: the US in the UN — it can act with relative impunity *unless* others organize against it).

### 15.4 The Dominant trait — snowball control [DECIDED]
The danger: Dominant → easier wars → more wins → more Prestige → more Dominant. With only ~5 players the intended brake ("needs a coalition to challenge them") may not naturally exist. So Dominant is designed to make the leader **both scary and the prize**:

- **Scary:** the Dominant nation has a war advantage / status-quo protection — challenging it head-on, alone, is a losing proposition.
- **Hunted:** attacking the Dominant nation gives the **attacker** an unrest *discount* (Militaristic territories love a giant-killing war) and a successful blow against them grants **outsized Prestige**. The Dominant nation is the most rewarding target on the map.

**Dominant is a qualification, not a placement [DECIDED].** Dominant is NOT simply "whoever is #1." It requires Prestige above an absolute **floor** *and* being within a **comparability band** of the top. Consequences:
- In a quiet/mediocre game, *no one* may be Dominant — you do not back into the title for lack of competition. You have to genuinely be a great power.
- **Multiple nations can be co-Dominant** if their stats are comparable (both above the floor and within the band). With 5 players, two co-Dominant giants create a bipolar standoff — more interesting than a single king, and the scary/prize/patron dynamic can play out *between* the giants.

The result is a real status quo: stable until someone decides the prize is worth it, at which point the incentives have already been seeded for a coalition to form. Dominant should never be a comfortable position — it should be a tense one.

**[OPEN]** The Prestige floor value and the comparability band width — both are simulation-tuning questions.

### 15.5 Projected-delta UI — Prestige legibility [DECIDED]
Prestige consequences must be **legible at the moment of decision** — the same hard rule as Cultural Compatibility (Section 7.2). Whenever a player queues an action that could affect Prestige (or Trust, or unrest), the confirm screen shows the **projected delta before they commit**: e.g. "This action: −Trust, +unrest in 3 Peaceful territories; if you win this war: +Prestige (est.), Dominant within reach." A player should never be surprised by a Prestige/Trust/unrest swing they could have seen coming. Rewards and punishments are front-and-center, not discovered after the fact.

### [OPEN] Prestige questions
- Exact Prestige formula and weighting.
- Size of the underdog negotiation bonus per point of Prestige gap.
- Exact Dominant war advantage and the size of the attacker's unrest discount / Prestige reward.
- The Dominant Prestige **floor** value and the **comparability band** width (simulation-tuning).
- **Starting-position balance:** because culture is emergent from the real-world map, some starting regions may hand an easier game than others. This is a *simulation* question, not a whiteboard one — the harness must test starting-position balance across regions. The fix, if needed, is likely *more ways to score Prestige* (so Peaceful/Isolationist endurance wins as validly as Militaristic conquest), NOT flattening traits into nerfs.

---

## 16. Event Log [DECIDED]

No global chat — the group's Discord/WhatsApp handles social chat. The in-game **Event Log** is the official historical record of the world. Sample entries:
```
The Banana Republic formed.
Texas captured Oklahoma.
Treaty of Heredia signed.
Eastern Coalition declared independence.
Potato Union accepted Japanese protection request.
Northern Trade Pact dissolved.
```
This is expected to be one of the most-read features in the game. Treat it as a first-class feature, not a debug log: every major action (declarations, treaties, conquests, rebellions, Prestige milestones, the rise/fall of a Dominant nation) should produce a well-written entry.

---

## 17. Engineering Notes [DECIDED — direction]

This is a server-state and concurrency project as much as a game. The hard parts are not the map or the UI.

- **Build the simulation as a headless, fast-forwardable engine first.** It must be possible to simulate 100+ game-days in seconds, with no UI, to tune unrest / integration / upkeep / Mandate numbers. Building UI-first means tuning blind.
- **The tick is the heartbeat.** Tick resolution must be deterministic and atomic: given a world state and the set of queued actions, it produces exactly one next world state. This makes the game testable and replayable.
- **Concurrency:** two players may queue actions affecting the same territory in the same Main Phase. Because actions are *queued and resolved at the tick* (not applied live), this is resolved cleanly at tick resolution rather than via live locking — design all consequential actions as queued intents, not immediate mutations.
- **Crash safety:** the world state must survive a process restart mid-day without corruption. Persist queued actions, not just resolved state.
- **Determinism + seed:** keep the random factor (combat rolls, trait drift) seeded so a tick can be replayed and debugged.

---

## 18. Master Open-Questions List

Consolidated for tracking. Resolve before building the relevant system.

**Time & Mandate**
- Build times for roads/ports/forts (ticks).
- War resolution duration (ticks).
- Mandate pool formula from the three resources.
- Mandate carryover: yes/no/capped.
- Diminishing returns on Mandate for large empires.

**Culture**
- Compatibility formula and axis weights.
- Trait drift rates and probability-tick frequency.
- Contextual happiness (Militaristic happier at war) — in v1 or later?

**Diplomacy**
- Trust scale, starting value, decay baseline.
- Fine rates below 50% Trust.
- Passive peacetime Trust recovery rate.
- Escrow skim percentage curve (amount × time).
- Partial vs all-or-nothing collateral loss on a voluntary break.

**War (model decided — numbers open)**
- ~~Casus belli~~ — **[DECIDED: soft CB, §9.1]**
- Amphibious penalty values — **[DEFERRED to Phase 7, tech-stack §10]**
- Battle formula weights (force / fort / geography / logistics / random spread).
- Siege duration per fortification level.
- War upkeep rates and the insolvency unrest ramp curve.
- Definition of "reasonable terms" for the peace-rejection bump.
- ~~Raid mechanics detail~~ — **[DECIDED: stubbed, §9.9]**

**AI**
- AI efficiency penalty vs humans.
- Can AI sign treaties / hold Trust & Prestige?

**Activity**
- Final inactivity thresholds.
- Abandoned fragmentation trigger.
- Returning-from-Abandoned reclamation rules.

**Prestige**
- Prestige formula and weights.
- Underdog negotiation bonus per Prestige-gap point.
- Dominant war advantage and attacker incentives.
- Dominant = strict #1 or top tier.

**Trade**
- Capacity values by infrastructure config.
- Friction formula (distance, hostile crossing, road mitigation).
- Isolationist trade-unrest balance formula.
- Merchant under-trade unrest formula.
- Bilateral only, or multi-party trade deals.

**Infrastructure / Naval**
- Road network vs local-segment.
- Can transports be contested at sea.

---

## 19. Change Log

- **v0.1** — Initial consolidation from design summary + discussion. Locked: time model (two-phase day), Mandate system concept, game-start lock-in, treaty degradation, two-way culture integration, mutable traits, defensive-only autopilot, Prestige + Dominant trait. Added first-draft War System (Section 9). Flagged all open numbers and the full set of war open-questions.
- **v0.2** — Locked: multi-clause treaties (per-clause collateral pooled to one total, Mandate per-treaty not per-clause, accepting costs Mandate, breaks as one unit); treaty-degradation collateral handling (active partner refunded fast, inactive player's collateral escrowed, **no Trust hit** for absence, escrow skim in Wealth as the deterrent, active player may break a degraded treaty for free); war model fully decided (tick-resolved, per-territory, siege relief allowed, occupy-during/annex-at-peace, peace negotiation step, war-unrest driven by overextension/sloppiness/insolvency/term-rejection with culture as multiplier, raiding wars in); Prestige projected-delta legibility rule (15.5). War section moved from [OPEN] to [DECIDED — model]. Remaining open items are numeric tuning + casus belli.
- **v0.3** — Added the Trade system (Section 14A) as a major pillar: bilateral time-bound deals over the three resources as tradeable goods; throttling solved via per-route Capacity + Friction computed symmetrically from the pair (geography gives each nation a distinct trade *shape*, not a trade *rank* — the "Mongolia problem" fix); routes are improvable via roads; trade reduces unrest and aids integration; no hard cap on deal count but culture constrains it (Isolationist unrest from over-entanglement, Merchant unrest from under-trade — completing the per-axis culture-constraint pattern). Corrected the Prestige negotiation bonus to the **underdog model**: the lower-Prestige party gets the bonus, no double-dip for the leader (15.3, 14A.5). Route interdiction deferred but architecture mandated (routes stored as real objects with explicit paths).
- **v0.4** — Dominant trait reworked: it is a **qualification, not a placement** — requires Prestige above an absolute floor AND within a comparability band of the top; no one may hold it in a mediocre game; multiple co-Dominants allowed if comparable. Logged **starting-position balance** as a simulation question (culture is emergent from the real-world map, so some regions may be easier — fix via more scoring paths, not trait nerfs). Casus belli confirmed deferred (start with none; war unrest + Trust self-police; revisit a soft layer post-simulation). Companion document `persistent-world-tech-stack.md` created (stack, map approach, engine architecture, 8-phase build order).
- **v0.5** — Phase 4 Infrastructure built. Roads, ports, and forts (L0–L3) implemented end-to-end: actions in engine, multi-tick construction state in DB, strict single construction slot per territory (all build types compete for one slot — sequential only), next-build pre-queue with mandate+industry pre-deducted and cancel-refund. `resolveTick` now returns explicit per-action `ActionResult` (applied/discarded + reason) so the server handles mandate refunds via result inspection rather than state diffing. All build times and costs tagged `[PLACEHOLDER]`.
- **v0.6** — Phase 4 Culture & Unrest built. Value axes on ±1 scale with named opposing poles. Cultural families + family-closeness table (family weight 60%, axis alignment 40%). Unrest equilibrium decomposes into fully named components: base floor, cultural clash, distance from capital, infrastructure investment (road/port/fort composite bonus), empire size, conquest shock, rapid expansion, military (stub). Conquest shock: initial value compat-scaled (0.20–0.70), decays only when infrastructure is present (hard gate — compat alone cannot heal a neglected territory). Rapid-expansion pressure uses 12-tick linear decay window (no hard cliff). Capital territory gets 2× weight in nation-culture computation. Mandate decoupled from stockpiles → territory-development formula (see Section 3). Admin panel at `/admin` (admin-key gated, full god's-eye view, all territory attributes editable). Simulation harness (`npm run scenario` / `npm run sweep`) with markdown reports, per-tick CSVs, and PNG charts; three seed scenarios as regression baseline. Action-causal recovery principle empirically validated in belize-neglect vs belize-integrate contrast.
- **v0.7** — Pre-Diplomacy structural refactors. Action-handler registry: `/api/action` decomposed into `server/src/actions/` (one file per action type — `buildRoad`, `buildPort`, `buildFort`, `cancelPendingConstruction`), each exporting a uniform `validate` / `queue` interface; registry replaces the monolithic type-switch. Immer adopted in `engine/src/tick.ts`: `produce()` replaces all manual spread cloning; direct draft mutations throughout. Both changes behavior-preserving — three harness scenarios produce byte-identical reports to the pre-refactor baseline.
- **v0.8** — Diplomacy / Treaties sub-phase. Treaty data model: `Proposal`, `Treaty`, `TreatyClause`, `TreatyParty` in DB (per-clause collateral pooled to treaty total; `parentProposalId` field for future counter-offer chains). Five clause types: `non_aggression` and `tribute` functional; `trade`, `military_access`, `defense_pact` machinery in place (light up when downstream systems ship). Proposal flow: `propose_treaty` → `accept_treaty` / `decline_treaty` / ignore (auto-expire); `propose_renewal` sugar for same-clause re-proposals. Trust system: 0–100 scale, start 50, baseline 50; voluntary break −20 Trust + collateral forfeiture; term completion → duration-scaled bonus `min(term×0.5, 15)`; passive recovery 0.5/tick toward 50 with 10-tick cooldown after break; below-50 fines 1 Wealth/tick per active treaty; min term 3 ticks. Treaty degradation: Dormant nations degrade defense\_pact → non\_aggression; active-partner collateral refunded over 3 ticks; inactive player's collateral escrowed; no Trust hit for absence; escrow skim 5% on return; active partner may break degraded treaty free. Cultural-clash unrest: new named `treatyCulturalClash` component on `UnrestCauses`; Militaristic+non\_aggression and Expansionist+long-term-non\_aggression produce pressure. UI: Diplomacy panel (toggle), incoming/outgoing proposals, active treaties, Trust scoreboard, propose-treaty form with multi-clause builder. Admin: treaty inspector, force-Trust, force-tier (triggers degradation/upgrade), force-break. Harness: byte-identical to pre-diplomacy baseline (no existing scenario behavior changed).
- **v0.9** — Trade sub-phase (Prompt 1). `instant_trade` action: immediate bilateral resource offer (1-tick expiry, resource pre-deducted from source territory local stockpile at queue time, refunded on non-accept/expire). `trade` clause activated: territory-pinned outbound flows per-tick from nation general stockpile, missed-payment breach threshold (2 consecutive), clause degradation on source territory loss. `TradeRoute` table with BFS pathfinding (land adjacency graph) + port-to-port sea route shortcut (zero-intermediate path); path stored as JSON array with staleness flag; `findTradePath` and `isPathStale` in `engine/src/trade.ts`. Per-territory local stockpiles (`localPopStock`, `localIndStock`, `localWltStock`) as trade draw sources; flush to nation general stockpile at end of tick. Migration: `20260529_trade_phase`.
- **v0.10** — Trade sub-phase (Prompt 2): Objective clauses. New `objective` clause type added to treaty system. Data model: `ObjectiveClause` table (one-to-one with `TreatyClause`); fields: `objectiveType`, `targetNationId`, `targetTerritoryId`, `deadlineTicks`, `status` (`pending`|`met`|`failed`|`waived`), `responsibleParty` (`partyA`|`partyB`|`both`). Engine (`engine/src/types.ts`): `ObjectiveClause`, `ObjectiveType`, `ObjectiveStatus`, `ResponsibleParty` types; `TreatyClause.objective` field. Engine (`engine/src/diplomacy.ts`): `objectiveMeetBonus`, `responsibleNationIds`, `hasRoadConnectionToTerritory` (BFS road-network check), `breachMaintainPeaceObjectives` (integration hook for War sub-phase). Engine (`engine/src/tick.ts`): per-tick objective evaluation loop inside `resolveTick`; functional types: `build_port` (check `hasPort` on targetTerritoryId), `build_road_connection` (BFS road-network reachability), `maintain_peace` (stays pending until treaty expiry; marked met at natural expiry); stub types: `joint_invasion`, `attack_player` (data present, inert — activate when War ships). Deadline failure: Trust −20 + collateral forfeiture to wronged party (same as voluntary break). Early auto-complete: all objectives met/waived → treaty completes immediately with full Trust bonuses. Server: `propose_treaty` validates objective payloads; `accept_treaty` creates `ObjectiveClause` rows; `saveWorldState` persists objective status; admin endpoints `POST /api/admin/objective/:id/force-meet` and `force-fail`; `/api/diplomacy` and `/api/admin/diplomacy` include `objectiveClause` data. UI: `DiplomacyPanel` shows objective clause countdown, current status (colour-coded), plain-language description; proposal confirm screen shows each objective with deadline and failure consequence; propose-treaty form has objective clause builder. Admin panel: objective sub-rows in treaties table with force-meet/fail buttons. Harness: `create_treaty` action creates `ObjectiveClause` objects from clause payload; `TreatySnapshot` includes `objectives` array; report includes objective status timeline per treaty. Two new scenarios: `objective-port-met` (port built before deadline → met, Trust bonus) and `objective-port-failed` (deadline passes → failed, Trust −20, collateral forfeited). All 8 harness scenarios pass. Migration: `20260601000000_objective_clause`.
- **v0.13** — War sub-phase (Prompt 2): Peace negotiation. `PeaceDeal` interface: `{proposingNationId, proposedAtTick, warType, territoryCessions, tributeWealth, tributeTicks}`. `War.exhaustionByNation` field: tracks exhaustion-end tick per nation after a declined proposal. Three new actions: `propose_peace` (costs 2 Mandate [PLACEHOLDER]; validates raid wars may not include territory cessions; mutates `War.status = peace_negotiation` and sets `pendingPeaceDeal` directly in DB at queue time so the loaded world already reflects the proposal state when the tick fires), `accept_peace` (free; only the non-proposing party may accept), `decline_peace` (free; only the non-proposing party may decline). Engine (`engine/src/tick.ts`): peace resolution block after battle resolution; collect `peaceAcceptors` and `peaceDeclinersByWar` from this tick's actions; for each `peace_negotiation` war: accept → `executePeaceDeal` (territory cessions with conquest shock, unceded occupied territories returned, `[TRIBUTE_TREATY]` event for tribute if `amount > 0`, both parties +5 Trust [PLACEHOLDER], `war.status = ended`); decline → exhaustion bump (PEACE_DECLINE_EXHAUSTION_BUMP = 0.04 for PEACE_DECLINE_EXHAUSTION_TICKS = 3 ticks [PLACEHOLDER]), clear deal, revert to `active`; lapse (no response within PEACE_PROPOSAL_LAPSE_TICKS = 3 ticks [PLACEHOLDER]) → silently revert to `active`, no penalty. Battle resolution continues during `peace_negotiation` (war loop now covers both `active` and `peace_negotiation` statuses). War-unrest block: `warExhaustionNations` set derived from active `exhaustionByNation` entries; PEACE_DECLINE_EXHAUSTION_BUMP added to `warEquilibriumAdj` for affected territories. Server (`server/src/world.ts`): tribute-treaty creation in `saveWorldState` parses `[TRIBUTE_TREATY]` event log entries and creates `Proposal` + `Treaty` + `TreatyClause` + `TreatyParty` rows (same machinery as voluntary tribute treaties); ended-war cleanup deletes pending `attack_territory` actions for both belligerents. Admin endpoint: `POST /api/admin/force-peace` (force-accept a peace deal with specified terms, creates tribute treaty if specified, applies Trust bonus). All [PLACEHOLDER] constants in `engine/src/war.ts`. All 12 harness scenarios byte-identical. Migration: `20260602010000_peace_phase`.
- **v0.12** — War sub-phase (Prompt 1): declaration, army actions, battle resolution. `War` data model: `id`, `attackerId`, `defenderId`, `type` (`conquest`|`raid` — raid behavior identical to conquest, stub), `hasCasusBelli`, `status` (`active`|`peace_negotiation`|`ended`), `startTick`/`declaredTick`/`endTick`, `occupiedTerritories` (JSON array of `{territoryId, occupyingNationId, siegeProgress, siegeStartTick}`), `pendingPeaceDeal` (Prompt 2). Engine (`engine/src/war.ts`): `computeBattleStrengths` (formula: `attackStrength = armySize × (1 + roadBonus) × rng`, `defendStrength = armySize × (1 + fortBonus + geoBonus)`), `siegeTicksRequired` (`fortLevel + 1`), `computeOverextensionPressure` (BFS distance-scaled per occupied territory), all constants tagged `[PLACEHOLDER]`. Engine (`engine/src/tick.ts`): `attack_territory` action collects attack intents → resolved post-action-loop; per-war: battle resolution with win/loss → siege progress increment → territory capture at `siegeProgress >= fortLevel + 1`; `retreat_army` clears siege entry; war-unrest pre-computation (overextension, insolvency, no-CB spike, militaristic happiness) applied as `warEquilibriumAdj` on top of base equilibrium; `militaryBonus` stub activated — `computeUnrestEquilibrium` now accepts 10th parameter. `culture.ts`: `computeUnrestEquilibrium` accepts optional `militaryBonus` parameter (default 0, backward-compatible). Three new action handlers: `declare_war` (validates non-aggression pairs, breaches `maintain_peace` objectives, creates `War` row, applies no-CB Trust penalty), `attack_territory` (land-adjacency check, active-war check, queues intent), `retreat_army` (free, clears siege entry in engine). Action costs: `declare_war` 3, `attack_territory` 2, `retreat_army` 0 ([PLACEHOLDER]). Admin endpoints: `POST /api/admin/declare-war`, `POST /api/admin/end-war`. War state persisted in `saveWorldState`. All 12 existing harness scenarios byte-identical. Migration: `20260602000000_war_phase`.
- **v0.11** — Trade sub-phase (Prompt 3): Harness trade + objective scenarios, new charts. Four new harness scenarios: `trade-flow` (10-tick treaty, 5 Wealth/tick flows confirmed each tick, Trust bonus at expiry), `trade-missed-payment` (flow exceeds production, consecutive misses → breach at T2, Trust −20, collateral transfer), `trade-source-lost` (source territory reassigned mid-treaty → clause degrades at T5, no Trust hit, flows stop), `objective-port` (Variant B: deadline passes without build → failure at T9, Trust −20, collateral forfeited; Variant A is `objective-port-met`). Harness infrastructure: `TreatySnapshot.tradeClauses` field (per-clause status + `missedPayments` + payload for each tick); `TradeClauseState` type. New CSVs: `trade-flows.csv` (per-tick per-clause flow status — `paid`/`missed`/`breached`/`degraded` inferred from consecutive `missedPayments` diffs), `objective-metrics.csv` (per-tick per-clause objective status). New charts: `trade-flow-over-time.png` (flow status bar chart + nation Wealth divergence); `treaty-status-over-time.png` gains a fourth objective-status panel when `objective-metrics.csv` exists. `harness.md` updated with all new scenarios and output-file documentation. Tuning notes added: missed-payment threshold and per-clause collateral proration are the first values to revisit once real play data exists. All 12 harness scenarios pass. Phase 4 Trade complete; tagged `phase-4-trade-complete`.
