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

- **v0.31** — Phase 7 map rendering + validation (Prompt 3 of 3). **GeoJSON output:** `scripts/generate-adjacency.mjs` now also writes `scripts/data/americas-map.geojson` — one Feature per territory with id, name, culturalFamily, geographyType as properties; 28 territories use NE-derived polygons, 8 hand-placed territories use hardcoded bounding-box polygons (`HAND_PLACED_BBOX` map). **Web map:** `web/public/territories.geojson` replaced with the 36-territory Americas GeoJSON. `GameMap.tsx` map center updated from `[-86, 14.5] z5.2` to `[-75, 10] z2.2` (full Americas view); 8 AI nation colors added to `NATION_COLORS`. **Fog of war verified:** Costa Rica player at tick 0 — `costa_rica` Clear (Rule 1: own territory), `panama`/`nicaragua` Clear (Rule 2: own army adjacent at capital), all 33 other territories TrueFog. Note: adjacency Rule 6 would give LightFog, but the stationed army elevates adjacent territories to Clear (Rule 2 takes precedence). **Trait overrides:** `usa_northeast` gets `traitOverrides: {individualist: 0.3, progressive: 0.3}` (european family baseline is collectivist; settler-colonial NE USA is historically individualist/progressive); `argentina_patagonia` gets `traitOverrides: {individualist: 0.25, expansionist: 0.35}` (frontier/ranching culture, land-expansion drives). Overrides documented in `tuning-notes.md`. **Derived traits inspection:** all 6 spot-checked territories (`usa_northeast`, `mexico_centro`, `brazil_nordeste`, `canada_northwest`, `argentina_patagonia`, `peru_selva`) directionally correct after overrides. `americas.json` re-generated to add overrides and remain live-hot via Docker volume mount. All 28 harness scenarios byte-identical. Tagged `phase-7-americas-complete`.
- **v0.30** — Phase 7 Americas territory set (Prompt 2 of 3). **Territory data file:** `engine/src/data/americas.json` — 36-territory full Americas dataset derived from `scripts/data/americas-territories.json` + `scripts/data/americas-adjacency.json`; fields: `id, name, culturalFamily, geography, isCoastal, adjacentIds, seaAdjacentIds, basePopulation/Industry/Wealth, valueTraits` (placeholder zeros — overwritten by pipeline at init), optional `traitOverrides`. Geography mapping: `plain→inland`, `island→coastal`. Cultural family mapping: `frontier→european`. `isCoastal` = geographyType island/coastal OR appears in any sea adjacency list. `TerritoryDef.seaAdjacentIds: string[]` added to engine types; `loadTerritoryDefs` backfills empty array for older data files and validates both adjacency lists. **World init migration:** `server/src/config.ts` DATA_FILE now points to `engine/src/data/americas.json`. `server/src/world.ts` `INITIAL_PLAYER_NATIONS` (5 unchanged Costa Rica–Panamá set) + `INITIAL_AI_NATIONS` (8 AI nations covering North America/Caribbean/South America: North Atlantic Republic/usa_northeast, Gran Norte/mexico_norte, The Dominion/canada_central, Antilles Confederation/caribbean_west, Nueva Granada/colombia_andes, República de los Llanos/venezuela, Sul Grande/brazil_sul, Río de la Plata/argentina_pampa_norte); each AI nation starts owning one territory + army 50. All 28 other territories start unclaimed. **Admin endpoint:** `GET /api/admin/world-map` returns all 36 territories with `id, name, culturalFamily, geography, isCoastal, adjacentIds, seaAdjacentIds, ownerId, derivedTraits, startingPopulation, productionModifiers, basePopulation/Industry/Wealth`; admin-key gated; used to verify initialization correctness. **Reset endpoint fix:** both `/admin/reset-world` and `/api/admin/reset-world` now delete all dependent tables in correct FK order (councilQueuedAction, warCouncil, queuedAction, eventLog, instantTrade, tradeRoute, objectiveClause, treatyClause, treatyParty, treatyHistory, treaty, proposalClause, proposal, war, embassy, army, territoryModifier, borderSkirmish, territoryClaim, federationMember, federation, prestigeHistory, territoryState, nation, worldMeta). **docker-compose.yml:** added `./engine/src:/app/engine/src:ro` live mount so data file changes take effect on restart without rebuilding the image. All 28 harness scenarios pass unmodified (harness uses `belize`, `guatemala`, etc. which are preserved exactly).
- **v0.29** — Phase 6.5 embassy system (systems-backlog §1.6). Embassy lifecycle: `EmbassyStatus` union (`proposed | under_construction | active | expelled | destroyed`); `Embassy` interface; `WorldState.embassies[]`. Engine: `build_embassy` action transitions `proposed → under_construction` (sets `constructionTicksLeft = EMBASSY_BUILD_TICKS [3]`); construction tick loop decrements each tick (under_construction → active when 0); `expel_embassy` action by host nation transitions `active → expelled` and applies `EMBASSY_EXPEL_TRUST_PENALTY [−10]` to host; destroyed automatically on host territory ownership change. Visibility Rule 4c: active embassy owned by observer in host territory → Clear (embassy grant in `computeVisibility`). `lastEquilibriumCauses?: UnrestCauses` stored on `TerritoryState` each tick (enables harness equilibrium-component assertions). Cession `|| true` stub removed: territory_cession now requires a live embassy in the host territory (or breaches after `CESSION_EMBASSY_GRACE_TICKS`). Server: `proposeEmbassy.ts`, `buildEmbassy.ts`, `expelEmbassy.ts` action handlers; Embassy DB model + migration `20260605020000_embassy`; embassy visibility wired in `/api/world`. Harness: `propose_embassy` (direct state injection), `build_embassy`/`expel_embassy` (engine pass-throughs), `set_trade_route` (inject TradeRoute for tradeStability tests), `assert_equilibrium_component` (post-tick assertion on named `UnrestCauses` component). Five new scenarios (28 total): `trade-integration` (tradeStability on receiver path), `cultural-constraints` (isolationistEntanglement + expansionistStagnation), `movement-travel` (TrueFog during transit, Clear on arrival), `embassy-lifecycle` (propose→build→active→expel, visibility before/after), `territory-cession` (cession with/without embassy — success vs breach). All 28 scenarios pass; all 23 pre-existing scenarios byte-identical. Tagged `phase-6-5-complete`.
- **v0.28** — Phase 6.5 movement model upgrade + diplomatic value engine (systems-backlog §1.3, §1.4, §1.8, §1.9). **§1.3 Multi-tick army transit:** `computeTerritoryTravelCost(geography, hasRoad, modifierMovementMultiplier)` and `computeArmyPath(origin, dest, territories, adjacency, modifiers)` pure functions in `engine/src/war.ts`; path via BFS (no terrain weighting in BFS, terrain applied to travel-ticks count); `GEOGRAPHY_MOVEMENT_MODIFIER` map (mountainous/forest=1.5, desert=1.33, plain/coastal/island/inland=1.0); `ROAD_MOVEMENT_MODIFIER=0.5` multiplier on each road-equipped territory; total ticks = sum of per-territory costs, clamped to integer; `Army` gains `transitPath: string[]` and `transitTicksRemaining: number`; tick resolution replaces instant move_army with transit initiation (≤1 tick = instant, >1 tick = `status='moving'`); transit advancement block steps the army one territory per tick. Server `moveArmy.ts` updated: now validates full multi-hop reachability via `computeArmyPath` (not just adjacency); military-access checked per foreign territory along path; in-transit guard (`transitTicksRemaining>0`). **§1.4 TerritoryModifier framework:** `TerritoryModifier` type (`source, movementMultiplier, productionMultiplier, unrestEquilibriumAdj, driftRateMultiplier, defenseBonus, startTick, durationTicks, expiresAtTick`); `WorldState` gains `territoryModifiers: TerritoryModifier[]`; modifiers applied in territory loop each tick (unrestEquilibriumAdj + driftRateMultiplier); expiry filter removes elapsed modifiers. **§1.4 Barricade action:** `build_barricade` action type; constants: `BARRICADE_DEFENSE_BONUS=0.15`, `BARRICADE_MOVEMENT_MULTIPLIER=1.5`, `BARRICADE_DURATION_TICKS=5` [all PLACEHOLDER]; tick handler creates a TerritoryModifier with those values; `buildBarricade.ts` handler + registry entry + `ACTION_COSTS['build_barricade']=1`. **§1.8 Diplomatic value engine:** `engine/src/diplomaticValue.ts` NEW — `computeClauseWealthValue(clause, world, viewingNationId)` per-clause Wealth reference value from both perspectives; `computeClauseDiplomaticWeight` strategic classification (low/medium/high/critical); `computeMinCollateral(clauses, world, proposerNationId, targetNationId)` → `{minTotal, proposerShare, targetShare}` based on net value differential × `COLLATERAL_FLOOR_RATE=0.20` [PLACEHOLDER]; `maintainPeaceTrustMultiplier` (1.0 full value, 0.25 low-value when both armies=0 + no prior skirmish). `GET /api/treaty/preview` NEW session-gated endpoint — POST body `{proposerId, targetId, termTicks, clauses[]}`; returns per-clause `{proposerPerspective, targetPerspective}` wealth values + diplomatic weights, plus `collateral` min-floor and optional `maintainPeaceTrustMultiplier`. **§1.9 Maintain_peace polish:** `TreatyHistory` DB table (nationAId, nationBId, clauseType, signedAtTick) written on `acceptTreaty` for each maintain_peace objective clause; `proposeTreaty.ts` enforces `MAINTAIN_PEACE_MAX_CONSECUTIVE=2` [PLACEHOLDER] consecutive treaties per `MAINTAIN_PEACE_CONSECUTIVE_WINDOW=20` [PLACEHOLDER] tick window via TreatyHistory count query. **§1.4 Border skirmish detection:** `BorderSkirmish` type + `WorldState.borderSkirmishes`; detect in tick when two opposing armies pass through the same territory in opposite directions (army A was at terr B last tick, army B was at terr A last tick, both moving); `SKIRMISH_FULL_CB_WINDOW=10` [PLACEHOLDER] ticks grants full `hasCasusBelli=true`; `SKIRMISH_CB_DECLARATION_WINDOW=5` [PLACEHOLDER] extends further; `SKIRMISH_HOSTILITY_COMPAT_THRESHOLD=0.3` [PLACEHOLDER] compat gate. DB migration `20260605010000_movement_model` (Army transit fields, TerritoryModifier table, BorderSkirmish table, TreatyHistory table). All 23 harness scenarios byte-identical.
- **v0.27** — Phase 6.5 treaty system expansion (systems-backlog §1.1, §1.2, §1.5, §1.10, §1.11). **§1.10 Auto-assign resource sourcing:** tribute and trade clause flows now distribute proportionally across sender's owned non-revolting territories, weighted by the relevant base production rate (`baseWealth` for tribute/wealth, `baseIndustry` for industry, `basePopulation` for population); overflow to general stockpile; `sourceTerritoryId = null` enables auto-assign mode on trade clauses (non-null = manual pin, unchanged behavior). **§1.5 Territory cession clause:** new `territory_cession` clause type; fields: `territoryId, fromNationId, toNationId, transferAtTick`; fires when `tick >= transferAtTick` and embassy present (stubbed `|| true` until Phase 8 embassy construction ships); grace period `CESSION_EMBASSY_GRACE_TICKS` [3] before breach; Trust/collateral penalty on receiver if embassy missing past grace. Validated at proposal: `transferAtTick >= currentTick + CESSION_MIN_FUTURE_TICKS` [3]. **§1.1 Army lending clause:** new `army_lending` clause type; fields: `armySize, lendingNationId, receivingNationId, deliveryTerritoryId, returnTerritoryId, loanDurationTicks, deliveredAtTick, returnDueAtTick, sold`; return penalty formula: `collateral × (missingUnits/originalUnits)²`; immediate revoke on war between parties (teleport, `[TODO: travel time]`). **§1.2 Population transfer clause:** new `population_transfer` clause type; fields: `amount, fromNationId, toNationId, transferAtTick`; one-time transfer; `populationTransferShock` named unrest component fires `POPULATION_TRANSFER_UNREST_SCALE` [0.15] × compat for `POPULATION_TRANSFER_SHOCK_DURATION` [5] ticks; drift acceleration toward transferred family `POPULATION_TRANSFER_DRIFT_DURATION` [8] ticks deferred. **§1.11 Outpost/sentry clause:** new `outpost` clause type; fields: `targetTerritoryId, type (sentry|outpost), grantedToNationId`; `computeVisibility` extended: `VisTreatyInput.outpostGrants` carries per-territory grants; Rule 4b: outpost→Clear, sentry→LightFog on `targetTerritoryId` for `grantedToNationId`; degrades on territory ownership change. Engine: `TerritoryState` gains `hasEmbassy: boolean` [default false stub] and `populationTransferShockTicksLeft: number`; `UnrestCauses` gains `populationTransferShock`; new constants `POPULATION_TRANSFER_UNREST_SCALE`, `POPULATION_TRANSFER_SHOCK_DURATION`, `POPULATION_TRANSFER_DRIFT_DURATION`, `CESSION_EMBASSY_GRACE_TICKS`, `CESSION_MIN_FUTURE_TICKS`. `proposeTreaty.ts`: all 4 new clause types validated. DB migration `20260605000000_treaty_expansion`. All 23 harness scenarios byte-identical.
- **v0.26** — Phase 6.5 initialization pipeline (systems-backlog §3). Engine (`engine/src/initialization.ts`): NEW — `deriveTerritoryTraits(culturalFamily, geography, rngSeed)` pure function; returns `{ traits, startingPopulation, productionModifiers }`; implements §3.1 FAMILY_TRAIT_OFFSETS table, §3.2 GEOGRAPHY_TRAIT_MODIFIERS table, §3.3 GEOGRAPHY_BASE_POPULATION × FAMILY_POPULATION_MULTIPLIER, §3.4 FAMILY_PRODUCTION_MODIFIERS; seeded LCG RNG (`lcgRng`) produces ±TRAIT_RNG_VARIANCE [0.15] per axis; `deterministicSeed(territoryId)` djb2-style hash for stable per-territory seeds; all table values [PLACEHOLDER]; exported from `engine/src/index.ts`. Engine (`engine/src/types.ts`): `TerritoryDef` gains optional `traitOverrides?: Partial<ValueTraits>` — when present, overrides derived traits for that territory without changing the pipeline. Server (`server/src/world.ts`): `ensureWorldInitialized` calls `deriveTerritoryTraits` + `deterministicSeed` per territory at world init; applies `traitOverrides` from def; writes derived traits to `TerritoryState` DB rows. Server (`server/src/index.ts`): `GET /api/admin/territory/:id/derived-traits` endpoint — returns `{ territoryId, culturalFamily, geography, geographyOverridden, traitOverridesInDef, derived: {traits, startingPopulation, productionModifiers}, finalTraits, seed }`; accepts optional `?geography=` query param for inspection without editing the data file; admin-key gated. `docs/dev-commands.md` §17 documents the endpoint. `docs/tuning-notes.md`: §3.1–3.4 table values and known gaps documented. Harness: byte-identical — pipeline runs at server init only, not in `buildWorldState` or tick resolution. All 23 harness scenarios byte-identical.
- **v0.25** — Phase 6.5 systems integration (Prompt 1 of N): close open integration loops between existing systems. No new features — wiring only. **2.1 Trade → unrest reduction and drift acceleration:** `trade_stability` named unrest equilibrium component (−TRADE_STABILITY_BONUS [0.02] per active trade clause flowing through a territory's computedPath on the receiving nation's side); `TRADE_DRIFT_MULTIPLIER` [1.3] applied to `applyDrift` for territories on active route paths. **2.2 Eight cultural constraint axes — six new named components:** `isolationist_entanglement` (expansionist < −0.3 + treaty count > ISOLATIONIST_TREATY_THRESHOLD [3], pressure = (count − threshold) × ISOLATIONIST_ENTANGLEMENT_WEIGHT [0.015]); `expansionist_stagnation` (expansionist > 0.3 + no territory acquired in last EXPANSIONIST_GROWTH_WINDOW [10] ticks, EXPANSIONIST_STAGNATION_WEIGHT [0.02] flat); `collectivist_isolation` (individualist < −0.3 + no tribute receiver obligations, COLLECTIVIST_ISOLATION_WEIGHT [0.015]); `individualist_obligation` (individualist > 0.3 + tribute payer obligations, tributeCount × INDIVIDUALIST_OBLIGATION_WEIGHT [0.02]); `traditional_erosion` (progressive < −0.3 + drift rate > TRADITIONAL_EROSION_THRESHOLD [0.05], TRADITIONAL_EROSION_WEIGHT [0.025]); `progressive_stagnation` (progressive > 0.3 + drift rate < PROGRESSIVE_STAGNATION_THRESHOLD [0.01], PROGRESSIVE_STAGNATION_WEIGHT [0.015]). Two existing components (militaristic restlessness, peaceful war-weariness) unchanged. All six visible in territory unrest breakdown. **2.3 Geography → trade capacity and friction:** `computeTradeCapacity` and `computeTradeFriction` in `engine/src/trade.ts`; capacity computed at treaty signing and stored on TradeRoute row (sea port+port: ×SEA_CAPACITY_MULTIPLIER [2.0], land with roads: ×LAND_ROAD_CAPACITY_MULTIPLIER [1.5], no infra: ×NO_INFRA_CAPACITY_MULTIPLIER [0.7] applied to CAPACITY_BASE [10]); friction summed per-territory on path (FRICTION_BASE [0.05] + mountainous [+0.08] + desert [+0.06] + hostile crossing [+0.10] − road reduction [−0.03]); server `acceptTreaty.ts` now populates capacity+friction at signing. Friction application to actual flow amounts deferred. **2.4 Roads → cultural drift rate:** `ROAD_DRIFT_MULTIPLIER` [1.25] applied to both unrest drift rate and culture drift rate in `resolveTick` territory loop for territories with `hasRoad = true`. Also applied to the drift magnitude used for traditional_erosion / progressive_stagnation thresholds. **2.5 Geography → conquest shock magnitude:** `GEOGRAPHY_SHOCK_MULTIPLIER` map in `engine/src/war.ts` (mountainous [1.3], forest [1.15], desert [1.2], island [1.25], coastal [0.9], plain [1.0]); applied at all three conquest shock callsites in `tick.ts` (battle capture, siege-by-presence, peace deal cession); base shock × geography multiplier, clamped to 1.0. **2.6 Population → production scaling:** `POPULATION_PRODUCTION_BASE = 50` in `tick.ts`; production loop multiplies each territory's base rates by `(basePopulation / POPULATION_PRODUCTION_BASE)`; gross wealth computation for debt recovery also uses scaled value. `computeUnrestEquilibrium` signature extended with 7 new optional named-component parameters (all backward-compatible, default 0). `applyDrift` gains optional `driftMultiplier` parameter (default 1.0). All 23 harness scenarios pass.
- **v0.24** — Phase 6 hardening + fog-of-war harness scenario. **Insolvency debt recovery fix:** `DEBT_RECOVERY_SKIM_RATE` raised 0.20→0.30; skim now applied against **gross production** (territory `baseWealth` output, before upkeep and tribute) rather than net incoming wealth, so tribute obligations cannot stall recovery. `grossWealthByNation` map computed from non-revolting owned territory `baseWealth` sums; used in place of `incomingWealthByNation` in the recovery skim block. **Fog-of-war harness scenario:** `fog-of-war.json` — three nations, 5 ticks; CR owns `costa_rica` (army size 0 so army-adjacency rule doesn't override), Nicaragua owns `nicaragua` (adjacent to CR + non_aggression treaty with CR), Honduras owns `honduras` (no relationship); asserts `costa_rica=Clear`, `nicaragua=LightFog`, `honduras=TrueFog` at T1 and T5. **`assert_visibility` harness action:** new type in `harness/src/types.ts` + handler in `harness/src/runner.ts`; post-tick pass calls `computeVisibility` with full world state, checks expected tier; failures reported in `report.md` with `⚠ ASSERTION FAILURES` section and cause non-zero `process.exit(1)` in `cli.ts`. Army seeding filter updated: `armySize: 0` in scenario nation definition = no army seeded (was previously seeding size-0 army that still granted adjacency visibility). `harness/src/types.ts`: `AssertionError` interface; `RunResult.assertionErrors`. **Stale comment report (for review — not yet removed):** `engine/src/types.ts:211-212` — `[STUB]` on `joint_invasion` and `attack_player` objective types says "activate when War sub-phase ships" but both were activated in v0.14; comment is stale. `server/src/actions/attackTerritory.ts:67` — `[DEFERRED: full movement model Phase 5]` phase label is stale (now Phase 6+); feature still deferred. All other `[DEFERRED SECURITY]`, `[STUB]` for raid type, and `[DEFERRED]` for underdog unrest buff remain accurate. **All 23 harness scenarios pass.** Tagged `phase-6-complete`.
- **v0.23** — War council + coordination panel. Data model: `WarCouncil` table (`id`, `warId`, `side` attacker|defender, `memberNationIds` JSON array); `CouncilQueuedAction` table (`id`, `councilId`, `nationId`, `actionType`, `targetTerritoryId`, `tick`) — read-only mirror, cleared after each tick. DB migration: `20260603020000_war_council`. Councils created automatically: one per side when a war starts (`declareWar` handler calls `createWarCouncils`); defense pact allies added to defender council via `addNationToDefenderCouncil` in `tick.ts`; separate councils also created for auto-war rows. Military action mirroring: `attackTerritory`, `moveArmy`, and `retreatArmy` handlers call `mirrorMilitaryAction` inside their queue transactions. Mirror rows cleared after tick (`councilQueuedAction.deleteMany()`); councils for ended wars deleted. API: `GET /api/war/:warId/council` — side-restricted (requesting nation's council only, never enemy side); returns members + their queued military actions, contested territory status with per-member army presence, `joint_invasion` objective checklists (who has queued attack on target this tick). `GET /api/world` now includes `myActiveWarIds: number[]` (active war IDs involving this nation). UI: `WarCouncilPanel` component — fixed bottom bar, only visible when `myActiveWarIds` is non-empty; three-column layout: members + this-tick's moves (✓ queued / waiting), contested territories with siege progress and army markers, joint invasion objectives with per-ally checklist; read-only. `dev-commands.md` not updated — no new curl endpoints (council data is player-accessible only). All 22 harness scenarios byte-identical.
- **v0.22** — Prestige: full formula + Dominant qualification. Engine (`engine/src/prestige.ts`): NEW — `computePrestige(input)` formula: `territoryCount×PRESTIGE_PER_TERRITORY + standingTreatyCount×PRESTIGE_PER_TREATY + completedTreatiesKept×PRESTIGE_PER_KEPT_TREATY + warsWon×PRESTIGE_PER_WAR_WIN + (avgUnrest<PRESTIGE_STABILITY_THRESHOLD?PRESTIGE_STABILITY_BONUS:0) + nationAgeTicks×PRESTIGE_PER_TICK_AGE + infrastructureScore×PRESTIGE_PER_INFRA_POINT + trust×PRESTIGE_TRUST_SCALE`; `computeDominantNations(prestigeByNation)` — qualifies nations above DOMINANT_PRESTIGE_FLOOR (150) AND within DOMINANT_COMPARABILITY_BAND (0.85) of top score; multiple co-Dominant allowed; empty set if nobody crosses floor. All weights [PLACEHOLDER]. Engine (`engine/src/types.ts`): `Nation` gains `completedTreatiesKept`, `warsWon`, `foundedAtTick`, `isDominant`. Engine (`engine/src/tick.ts`): `completedTreatiesKept += 1` on treaty natural expiry and early-complete paths; `warsWon += 1` on peace deal for nation that received territory cessions or extracted tribute; `DOMINANT_WAR_ATTACKER_BONUS (1.15)` applied to raw attack strength when non-Dominant attacks Dominant; `DOMINANT_WAR_MILITARISTIC_BONUS (−0.03)` equilibrium reduction for Militaristic territories of the attacker in same scenario. Server (`server/src/actions/breakTreaty.ts`): Dominant nations take `TRUST_BREAK_PENALTY × DOMINANT_TRUST_PENALTY_REDUCTION (0.75)` instead of full penalty. Server (`server/src/actions/acceptTreaty.ts`): underdog bonus fires when non-Dominant accepts Dominant proposer — `+UNDERDOG_PRESTIGE_BONUS (5)` prestige to acceptor; Event Log entry; `underdogBuffExpiresAt` column added to Nation (schema + migration) for future unrest-reduction wiring [DEFERRED]. Server (`server/src/world.ts`): stub Prestige computation replaced with `computePrestige` + `computeDominantNations`; writes `PrestigeHistory` row per nation per tick; saves `isDominant` on Nation; `ensureWorldInitialized` sets `foundedAtTick=0`; `caretaker.ts` sets `foundedAtTick=currentTick` for fragmentation-spawned AI nations. DB migration: `20260603010000_prestige_full` (Nation columns + PrestigeHistory table). API: `/api/world` fetches last 20 ticks of `PrestigeHistory`; nations response gains `prestigeDelta`, `isDominant`, `prestigeHistory`, `completedTreatiesKept`, `warsWon`. UI (`PrestigeLeaderboard.tsx`): full rebuild — Dominant badge (★, gold), prestige delta (▲/▼ color-coded), SVG sparkline (last 20 ticks, green/red slope), hover expand with secondary stats (treaties kept, wars won, ticks at #1, 7-tick climb). All 22 harness scenarios byte-identical.
- **v0.21** — Fog of war: three-tier visibility system. `VisibilityTier` enum: `TrueFog` (0, geography only — no political info), `LightFog` (1, owner identity only), `Clear` (2, full state + armies). `computeVisibility(input): Map<territoryId, VisibilityTier>` pure function in `engine/src/visibility.ts`: rules evaluated in priority order — own territory → Clear; own army present or adjacent → Clear; active `military_access` clause with owner → Clear [PLACEHOLDER — may be too strong, see tuning-notes]; federation membership with owner → Clear; any active treaty with owner → LightFog; adjacent to any owned territory → LightFog; default → TrueFog. Federation scaffolding: `Federation` table (`id`, `name`, `foundedAtTick`, `status`) and `FederationMember` table (`federationId`, `nationId`, `joinedAtTick`, `role`) added to schema; no federation player actions yet. API: `/api/world` calls `computeVisibility` server-side and filters each territory's fields by tier — TrueFog returns `{id, visibilityTier, geography, name}`; LightFog adds `{ownerId, ownerName, isCoastal}`; Clear returns full state plus `armies: [{id, nationId, size, status}]` for units present. `/api/admin/world-full` continues to return full unfiltered data. `POST /api/admin/create-federation {name, memberNationIds}` — testing endpoint; curl example in dev-commands.md §16. Map rendering: TrueFog → muted grey (#2a2a35), dim border; LightFog → desaturated owner color (65% desaturation); Clear → full owner color; fill opacity encoded per-feature in GeoJSON properties. InfoPanel: TrueFog click shows geography + "outside observation range" message; LightFog shows owner name + "limited intelligence" message; Clear shows full existing panel. `visibilityTier` field added to all `TerritoryView` objects in frontend response. DB migration: `20260603000000_federation_fog`. All 22 harness scenarios byte-identical — `computeVisibility` not called from `resolveTick`.
- **v0.20** — Army positioning (Phase 7 foundational data model). `Army` table replaces flat `Nation.armySize`: each army has `nationId`, `territoryId`, `size`, `status` (`stationed`|`moving`|`besieging`|`occupying`), `destinationTerritoryId`, `movedThisTick`. `TerritoryClaim` table: nations claim unclaimed territories; `pacificationProgress` accumulates each tick an army is present; at `PACIFICATION_THRESHOLD` (100) ownership transfers and the claim row is deleted. `Nation.armySize` deprecated (all live callsites tagged `// migrated from armySize`; `totalArmySize(armies, nationId)` helper replaces reads). `move_army` action: costs 1 Mandate [PLACEHOLDER]; validates adjacency and movedThisTick guard; moving into enemy territory during war sets status `besieging`; moving through a third-party territory requires an active `military_access` clause (stub comment removed). `claim_territory` action: costs 1 Mandate [PLACEHOLDER]; validates unclaimed + adjacency + no duplicate claim; creates `TerritoryClaim` row; emits Event Log entry. Siege by army presence: besieging armies auto-advance siege each tick without re-queuing `attack_territory`; army stays until `retreat_army` is queued or siege resolves; siege relief by an allied army moving into besieged territory and winning the resulting battle. Pacification formula: `nativeDifficulty = TERRAIN_DIFFICULTY[geography] + population × POP_DIFFICULTY_SCALE`; `pacificationProgress += army.size / nativeDifficulty` each tick army is present; progress decays `PACIFICATION_DECAY_PER_TICK` (10) per tick when army is absent; competing claims both advance simultaneously, first to threshold wins [all constants PLACEHOLDER]. Battle resolution uses positioned army at the specific territory (not nation totals); if defender has no army stationed there, defending army size = 0 (fort + geography only); army reduced to 0 is destroyed (row deleted, Event Log entry). Caretaker defense: move largest available army one territory toward besieged territory via BFS (no teleporting). AI expand_claim: two-step — `claim_territory` first tick, then queue `move_army` toward claimed territory each subsequent tick. Stubs: `split_army` and `merge_army` data model supports multiple armies per nation; no action handlers yet [see tuning-notes]. DB migration: `20260602040000_army_positions` (creates Army + TerritoryClaim tables; seeds one Army per existing nation at capital, size=50). Admin: army positions visible per nation in admin panel (territory, size, status); `POST /api/admin/nation/:nationId/set-army` curl example in dev-commands.md §15. Harness: `set_army_size` and `move_army` action types; armies seeded per nation at scenario start. All 22 existing harness scenarios pass byte-identical.
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
- **v0.19** — Phase 5 harness scenarios (Prompt 3 of 3). Five new harness scenarios: `caretaker-roads` (Autopilot nation gets road built by caretaker at T1, tagged [Caretaker]), `abandonment-fragmentation` (two-territory abandoned nation fragments at T11/T13, both independent AI nations spawn), `fragment-becomes-ai` (single-territory abandoned nation fragments, spawned AI acts immediately), `ai-expansionist` (claims belize T1, non-aggression proposals follow), `ai-merchant` (trade treaty proposed T1, auto-accepted T2 via `autoAcceptTreaties`, trade flows T2–T11). Harness infrastructure: `applyHarnessCaretaker` (road build + expansion for Dormant/Autopilot), `applyHarnessFragmentation` (tick-based fragmentation risk, threshold 0.6 at scale 10 ticks — harness-only constants, server unchanged), `harnessFragmentationRisk` exported; `set_nation_tier` now also sets `activityTier`; `abandonedAtTickByNation` side map for tick-accurate fragmentation. Snapshot: `activityTier` in `NationDiplomacySnapshot`; `fragmentationData: TerritoryFragmentationSnapshot[]` on `TickSnapshot`. CSVs: `fragmentation-risk.csv`; `nation-diplomacy.csv` gains `activity_tier` column. Charts: `activity-tier-over-time.png` (step chart of tier transitions), `fragmentation-risk-over-time.png` (risk lines + threshold). Tuning note added: Phase 5/6 constants are first-pass placeholders; harness results are directional only. All 17 existing scenarios pass; `nation-diplomacy.csv` has new `activity_tier` column (structural only, all values `active`). Tagged `phase-5-complete`.
- **v0.18** — AI nation behavior + doctrine system (Phase 6 Prompt 2). New `Nation.doctrineBlend` field (JSON, null for human/caretaker nations; `{ expansionist, merchant, industrialist, militarist, isolationist }` summing to 1; fixed at AI creation). Engine (`engine/src/doctrine.ts`): `deriveDoctrineBlend(traits)` — additive weight model from cultural trait signals, normalized; `scoreAction(candidate, doctrine)` — scores 6 action types (build_road/port/fort, expand_claim, propose_treaty, propose_trade); `AI_EFFICIENCY_PENALTY = 0.7` [PLACEHOLDER]; offensive war scoring stubbed + fully gated (`OFFENSIVE_WAR_GATE = false`). Server (`server/src/ai.ts`): `runAiNations(tx, tick, defs)` — for each `isAI=true` non-dissolved nation, scores candidates, selects highest-scoring within mandate budget; supports expand_claim (direct territory assignment), build_road/port/fort (queued actions), propose_treaty / propose_trade (Proposal rows). Server (`server/src/tick.ts`): calls `runAiNations` after `runCaretaker`. Server (`server/src/caretaker.ts`): fragmentation-spawned AI nations derive doctrine from territory traits via `deriveDoctrineBlend`. Harness (`harness/src/types.ts`): `set_ai_doctrine` action type; `ScenarioNation.isAI`; `ScenarioWorld.autoAcceptTreaties`. Harness (`harness/src/runner.ts`): handles `set_ai_doctrine` action (assigns doctrineBlend + isAI=true); `autoAcceptTreaties` loop (converts pending proposals to active treaties before each tick); `applyHarnessAiActions` pure-engine AI pass (expand_claim + propose_treaty/trade for AI nations). Two new harness scenarios: `ai-expansionist` (expansionist AI claims belize at T1), `ai-merchant` (merchant AI proposes trade treaty with Costa Rica at T1, auto-accepted at T2). All 17 existing scenarios byte-identical. DB migration: `doctrine_blend.sql` in `20260602030000_activity_tiers`.
- **v0.17** — Activity tiers + caretaker AI (Phase 6 Prompt 1). New `Nation` fields: `lastActiveAt` (DateTime, stamped on login + any queued action), `activityTier` ('active'|'dormant'|'autopilot'|'abandoned'|'dissolved'), `abandonedAt` (DateTime, null until Abandoned), `caretakerPriorities` (JSON array, default ["defense","roads","industry","expansion"]). Tier transitions fire at tick resolution via `server/src/caretaker.ts::runCaretaker` — called after `saveWorldState` each tick. Thresholds: active→dormant 3 days, dormant→autopilot 7 days, autopilot→abandoned 14 days [all PLACEHOLDER]. Dormant transition calls treaty degradation (existing path). Caretaker queuing (Dormant + Autopilot): evaluates priorities in order — defense (counter-siege attack), roads (highest-unrest unroaded territory, 1 Mandate), industry (Autopilot only, fort upgrade when wealth ≥ 20), expansion (Autopilot only, claim adjacent unclaimed territory when avgUnrest < 0.4). Harness guard: `lastActiveAt = null` → skip caretaker (all 17 harness scenarios unaffected). Abandoned fragmentation: each tick, `fragmentationRisk = unrest × 0.6 + (daysSinceAbandoned/30) × 0.4`; risk ≥ 0.8 → territory set unclaimed, independent AI nation spawned, event log entry emitted; when all territories lost → nation dissolves. Admin: `POST /api/admin/nation/:id/set-tier` (force tier for testing), `POST /api/admin/nation/:id/convert-to-ai` (Abandoned → full AI, permanent). Admin panel: tier dropdown in nations table (already existed, now points to real endpoint), fragmentation risk column in territories table, "→ AI" button for Abandoned nations. DB migration: `20260602030000_activity_tiers`. All 17 harness scenarios byte-identical.
- **v0.16** — Insolvency fix: genuine negative wealth + debt recovery. Removed all `Math.max(0, ...)` floors on wealth deduction paths in `resolveTick` (army upkeep, tribute payments, low-Trust fines — all now deduct unconditionally; wealth may go negative). Added `debtBalance` field to `Nation` (engine type + Prisma schema + DB migration). Insolvency state machine: **entry** (wealthStock < 0, debtBalance was 0 → set debtBalance = |wealth|, emit "has become insolvent" event); **accumulation** (wealthStock < 0, debtBalance > 0 → debtBalance grows each tick); **recovery** (wealthStock ≥ 0, debtBalance > 0 → skim `floor(incomingWealth × DEBT_RECOVERY_SKIM_RATE)` off incoming production each tick until debtBalance = 0, emit "cleared its debt" event). Insolvent defined as `wealthStock < 0 || debtBalance > 0`. New unrest pressures: `INSOLVENCY_GENERAL_UNREST_PER_TICK = 0.02` applies to all territories while wealthStock < 0 (visible as `insolvencyPressure` named component in `UnrestCauses`); `WAR_INSOLVENCY_UNREST_PER_TICK = 0.03` adds on top for at-war nations (unchanged constant, now fires correctly). Mandate surcharge: +1 Mandate on actions costing ≥2 while insolvent [PLACEHOLDER]. UI: wealth display goes red when negative; INSOLVENT badge on stockpile panel; "Debt: X Wealth remaining" line during recovery; `insolvencyPressure` in unrest breakdown. `war-exhaustion` harness scenario updated — insolvency ramp now fires correctly; `nation-diplomacy.csv` gains `debt_balance` column. All 17 harness scenarios pass; 16 non-exhaustion scenarios byte-identical. Migration: `20260602020000_insolvency`.
- **v0.15** — War sub-phase (Prompt 4): Harness war scenarios. Five new harness scenarios: `war-conquest` (CB war, L0 fort, siege completes in ≤2 ticks, peace deal at T8 with territory cession), `war-fortified` (L2 fort, 3-tick siege required, army losses accumulate), `war-no-cb` (Trust −10 at declaration, Peaceful/Isolationist territories show elevated equilibrium for 5 ticks), `war-exhaustion` (financial stress under war + tribute drain — documents the war-insolvency ramp's structural unreachability when wealth is clamped at 0; known gap recorded in tuning-notes), `war-defense-pact` (defense pact treaty survives alongside war; engine-side war state + event log verified; auto-defense is server-side and not observable in pure-engine harness). Harness infrastructure additions: new action types `declare_war` (injects War into world state + no-CB Trust penalty), `propose_peace` (mutates war to peace_negotiation + sets pendingPeaceDeal), `attack_territory` and `accept_peace` (engine pass-throughs with explicit nationId), `set_fort_level` (directly sets fortificationLevel); `WarSnapshot` type + `wars` field on `TickSnapshot`; `armySize` on `NationSnapshot`; `war-state.csv` and `army-sizes.csv` outputs; `war-state-over-time.png` chart (3 panels: army sizes, occupied count, avg unrest per belligerent). All 12 existing scenarios byte-identical after harness changes. Tagged `phase-4-war-complete`.
- **v0.14** — War sub-phase (Prompt 3): Activate war stubs + Prestige stub. **militaryBonus**: confirmed wired in Prompt 1 (reads from `nationAtWar` set in tick.ts; no change). **breachMaintainPeaceObjectives**: moved from queue-time (`declareWarHandler.queue`) to tick resolution (engine `declare_war` case in `resolveTick`) so it runs with full world state and is persisted via the normal `saveWorldState` clause loop. **joint_invasion objective**: evaluates each tick — both responsible parties must have queued `attack_territory` against `targetTerritoryId` in the same tick; if both did: `status = met`, Trust bonus fires; if deadline passes without simultaneous attack: `status = failed`, Trust penalty + collateral forfeiture. **attack_player objective**: evaluates each tick — responsible party must be the `attackerId` in any `active`/`peace_negotiation` war against `targetNationId` started on or before current tick; if found: `status = met`; deadline failure: same penalty as other objective types. **defense_pact auto-defense**: fires in server `runTick` after `resolveTick` returns, within the same DB transaction; for each applied `declare_war` action, queries defender's treaties for active `defense_pact` clauses; if found and third-party not already at war with attacker: creates `War` row, queues `declare_war` action for third party with `casusBelli: true`, emits Event Log entry; degraded pacts (→ `non_aggression`) do not trigger auto-defense (Dormant path unchanged). **military_access enforcement**: `attackTerritoryHandler.validate()` now checks reachability when target not directly adjacent — if the attacker has an active `military_access` clause with a nation that owns a territory adjacent to the target, the attack is allowed; otherwise rejected with `"no military access"` reason; intermediate-nation pathfinding tagged `// [DEFERRED: full movement model Phase 5]`. **Prestige stub**: computed in `saveWorldState` from fresh DB state: `prestige = territoryCount×10 + standingTreatyCount×5 + (avgUnrest<0.3?20:0) + warsWon×15`; all weights `[PLACEHOLDER]`; stored in `Nation.prestige` (column already existed); exposed in `/api/world` for all nations (public leaderboard); `PrestigeLeaderboard` component added to `App.tsx` (fixed top-right overlay, ranked by prestige desc, own nation highlighted). All 12 harness scenarios byte-identical.
- **v0.13** — War sub-phase (Prompt 2): Peace negotiation. `PeaceDeal` interface: `{proposingNationId, proposedAtTick, warType, territoryCessions, tributeWealth, tributeTicks}`. `War.exhaustionByNation` field: tracks exhaustion-end tick per nation after a declined proposal. Three new actions: `propose_peace` (costs 2 Mandate [PLACEHOLDER]; validates raid wars may not include territory cessions; mutates `War.status = peace_negotiation` and sets `pendingPeaceDeal` directly in DB at queue time so the loaded world already reflects the proposal state when the tick fires), `accept_peace` (free; only the non-proposing party may accept), `decline_peace` (free; only the non-proposing party may decline). Engine (`engine/src/tick.ts`): peace resolution block after battle resolution; collect `peaceAcceptors` and `peaceDeclinersByWar` from this tick's actions; for each `peace_negotiation` war: accept → `executePeaceDeal` (territory cessions with conquest shock, unceded occupied territories returned, `[TRIBUTE_TREATY]` event for tribute if `amount > 0`, both parties +5 Trust [PLACEHOLDER], `war.status = ended`); decline → exhaustion bump (PEACE_DECLINE_EXHAUSTION_BUMP = 0.04 for PEACE_DECLINE_EXHAUSTION_TICKS = 3 ticks [PLACEHOLDER]), clear deal, revert to `active`; lapse (no response within PEACE_PROPOSAL_LAPSE_TICKS = 3 ticks [PLACEHOLDER]) → silently revert to `active`, no penalty. Battle resolution continues during `peace_negotiation` (war loop now covers both `active` and `peace_negotiation` statuses). War-unrest block: `warExhaustionNations` set derived from active `exhaustionByNation` entries; PEACE_DECLINE_EXHAUSTION_BUMP added to `warEquilibriumAdj` for affected territories. Server (`server/src/world.ts`): tribute-treaty creation in `saveWorldState` parses `[TRIBUTE_TREATY]` event log entries and creates `Proposal` + `Treaty` + `TreatyClause` + `TreatyParty` rows (same machinery as voluntary tribute treaties); ended-war cleanup deletes pending `attack_territory` actions for both belligerents. Admin endpoint: `POST /api/admin/force-peace` (force-accept a peace deal with specified terms, creates tribute treaty if specified, applies Trust bonus). All [PLACEHOLDER] constants in `engine/src/war.ts`. All 12 harness scenarios byte-identical. Migration: `20260602010000_peace_phase`.
- **v0.12** — War sub-phase (Prompt 1): declaration, army actions, battle resolution. `War` data model: `id`, `attackerId`, `defenderId`, `type` (`conquest`|`raid` — raid behavior identical to conquest, stub), `hasCasusBelli`, `status` (`active`|`peace_negotiation`|`ended`), `startTick`/`declaredTick`/`endTick`, `occupiedTerritories` (JSON array of `{territoryId, occupyingNationId, siegeProgress, siegeStartTick}`), `pendingPeaceDeal` (Prompt 2). Engine (`engine/src/war.ts`): `computeBattleStrengths` (formula: `attackStrength = armySize × (1 + roadBonus) × rng`, `defendStrength = armySize × (1 + fortBonus + geoBonus)`), `siegeTicksRequired` (`fortLevel + 1`), `computeOverextensionPressure` (BFS distance-scaled per occupied territory), all constants tagged `[PLACEHOLDER]`. Engine (`engine/src/tick.ts`): `attack_territory` action collects attack intents → resolved post-action-loop; per-war: battle resolution with win/loss → siege progress increment → territory capture at `siegeProgress >= fortLevel + 1`; `retreat_army` clears siege entry; war-unrest pre-computation (overextension, insolvency, no-CB spike, militaristic happiness) applied as `warEquilibriumAdj` on top of base equilibrium; `militaryBonus` stub activated — `computeUnrestEquilibrium` now accepts 10th parameter. `culture.ts`: `computeUnrestEquilibrium` accepts optional `militaryBonus` parameter (default 0, backward-compatible). Three new action handlers: `declare_war` (validates non-aggression pairs, breaches `maintain_peace` objectives, creates `War` row, applies no-CB Trust penalty), `attack_territory` (land-adjacency check, active-war check, queues intent), `retreat_army` (free, clears siege entry in engine). Action costs: `declare_war` 3, `attack_territory` 2, `retreat_army` 0 ([PLACEHOLDER]). Admin endpoints: `POST /api/admin/declare-war`, `POST /api/admin/end-war`. War state persisted in `saveWorldState`. All 12 existing harness scenarios byte-identical. Migration: `20260602000000_war_phase`.
- **v0.11** — Trade sub-phase (Prompt 3): Harness trade + objective scenarios, new charts. Four new harness scenarios: `trade-flow` (10-tick treaty, 5 Wealth/tick flows confirmed each tick, Trust bonus at expiry), `trade-missed-payment` (flow exceeds production, consecutive misses → breach at T2, Trust −20, collateral transfer), `trade-source-lost` (source territory reassigned mid-treaty → clause degrades at T5, no Trust hit, flows stop), `objective-port` (Variant B: deadline passes without build → failure at T9, Trust −20, collateral forfeited; Variant A is `objective-port-met`). Harness infrastructure: `TreatySnapshot.tradeClauses` field (per-clause status + `missedPayments` + payload for each tick); `TradeClauseState` type. New CSVs: `trade-flows.csv` (per-tick per-clause flow status — `paid`/`missed`/`breached`/`degraded` inferred from consecutive `missedPayments` diffs), `objective-metrics.csv` (per-tick per-clause objective status). New charts: `trade-flow-over-time.png` (flow status bar chart + nation Wealth divergence); `treaty-status-over-time.png` gains a fourth objective-status panel when `objective-metrics.csv` exists. `harness.md` updated with all new scenarios and output-file documentation. Tuning notes added: missed-payment threshold and per-clause collateral proration are the first values to revisit once real play data exists. All 12 harness scenarios pass. Phase 4 Trade complete; tagged `phase-4-trade-complete`.
