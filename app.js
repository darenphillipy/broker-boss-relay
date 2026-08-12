/**
 * app.js
 * Broker Boss Online — browser prototype glue code.
 *
 * This file is plain browser JS (no bundling needed) — it just calls the
 * global `BrokerBossEngine` namespace exposed by engine.bundle.js. Every
 * state mutation here goes through executeUserAction, the same real
 * pipeline gameLoopController.test.js already proved: bridge validation
 * -> real engine dispatch -> bot/round-administration cascade -> full
 * view resync. This file only reads the returned view and draws it —
 * it never mutates game state directly.
 */

let HUMAN_PLAYER_ID = 'p1';

const BOT_ARCHETYPE_TITLES = {
  Aggressive: 'Aggressive / Shark',
  Engine: 'Efficiency / Operations',
  Growth: 'Recruiter / Headhunter',
  Cautious: 'Balanced / Defensive',
};
function botArchetypeTitle(archetype) {
  return BOT_ARCHETYPE_TITLES[archetype] || archetype;
}

/**
 * TECH_TRACK_ABILITY_CATALOG
 * Section 6 (Rulebook v5.0) — real ability names and descriptions,
 * transcribed directly from the uploaded PDF, not invented or
 * paraphrased into something shorter than what the card actually says.
 * Keyed by track -> branch -> level.
 */
const TECH_TRACK_ABILITY_CATALOG = {
  training: {
    A: {
      label: 'Aggressive Poaching',
      5: { name: 'The Aggressive Poacher', text: 'Passive. Once per round, reduce the recruitment requirements by −2 when recruiting or poaching an Agent from the Open Market or an opponent\'s brokerage.' },
      7: { name: 'The Headhunter', text: 'Instant. Immediately draw 2 Agent Cards from the facedown deck. Keep 1 card in your hand and discard the other.' },
      9: { name: 'The Poison Pill', text: 'Instant. Pay $4 Profit Tokens. Target 1 unprotected Agent in an opponent\'s brokerage and exhaust (rotate) it 90°. That Agent\'s passive abilities remain active and it can still be poached, but it generates only half Profit (rounded down) during final scoring.' },
    },
    B: {
      label: 'Labor & Contracts',
      5: { name: 'The Union Buster', text: 'Immediate & Passive. Immediate: Instantly move 1 Meeple from your "Staff in Training" pool to your "Available Staff" pool (usable this round). Passive: Your total Meeple Tax owed during the End of Round Phase is permanently reduced by −$2 Profit Tokens (minimum tax of $0).' },
      7: { name: 'Executive Headroom', text: 'Instant. Instantly unlock 2 Free Office Spaces on your personal player board.' },
      9: { name: 'The Ironclad Contract', text: 'Instant. Pay $4 Profit Tokens. Instantly claim 1 additional Loyalty Token from the bank and place it on any Agent in your brokerage, bypassing standard stat requirements to protect them permanently. (This token may exceed your standard 3-token limit, securing +4 VP at final scoring.)' },
    },
  },
  technology: {
    A: {
      label: 'Operational Overdrive',
      5: { name: 'Overtime Manager', text: 'Passive. Once per round, you may pay $2 Profit Tokens to place 1 of your Available Staff Meeples onto a Main Board Action Space fully occupied by an opponent. Immediately execute that space\'s standard action.' },
      7: { name: 'The Signal Jammer', text: 'Instant. Place a Lock Token on 1 Main Board Action Space. No opponent may place a Meeple there for the rest of the round.' },
      9: { name: 'The Silicon Valley Sweep', text: 'Instant. Pay $4 Profit Tokens. Immediately draw 4 Action Cards and review them: Play 1 Free (ignoring all costs and requirements), Keep 1 (add to hand), Discard 2.' },
    },
    B: {
      label: 'Data & Algorithms',
      5: { name: 'Proprietary Algorithm', text: 'Passive. Once per round, choose one: Trash 1 Action Card from hand to draw 2 replacement cards; OR Discard 1 Action Card from hand to gain $2 Profit Tokens from the bank.' },
      7: { name: 'Cloud Infrastructure', text: 'Instant. Draw 3 Action Cards and permanently increase your maximum hand size by +2.' },
      9: { name: 'The Master Algorithm', text: 'Instant. Pay $4 Profit Tokens. Permanently trash Action Cards directly from your hand to advance your marker on the Market Share Track: Trash 2 → Advance +1 Space, Trash 4 → Advance +2 Spaces, Trash 7 → Advance +3 Spaces.' },
    },
  },
  recognition: {
    A: {
      label: 'Liquidation & Cash Engine',
      5: { name: 'The Liquidation Engine', text: 'Passive (End of Round Phase). Before the board resets, select 1 Agent assigned to your brokerage. Force that Agent to activate a second time to immediately claim their printed Profit payout directly from the bank.' },
      7: { name: 'Venture Liquidation', text: 'Instant. Immediately move up to $2 Profit Tokens from your cash pool into your "Staff in Training" pool. Next Round Only: You may spend these tokens onto main board action spaces exactly like standard Staff Meeples to execute actions. Return used tokens directly to the bank.' },
      9: { name: 'The Golden Parachute', text: 'Endgame Scoring. Replace your standard cash-to-VP conversion rate with this premium rate: 3 Profit Tokens = +1 Victory Point (Maximum of +10 VP total from this ability).' },
    },
    B: {
      label: 'Influence & Acquisition',
      5: { name: 'Copycat Marketing', text: 'Immediate & Passive. Immediate: Claim the unique Orange Copycat Meeple. Passive (End of Round Phase): After all standard player turns are complete, place your Copycat Meeple onto any single action space occupied by an opponent this round. Immediately execute that action, bypassing occupancy limits.' },
      7: { name: 'The Hostile Buyout', text: 'Instant. You may pay $6 Profit Tokens to target any un-loyaled Agent in an opponent\'s brokerage. Immediately transfer that Agent card to your brokerage. (Forfeited if unpaid.)' },
      9: { name: 'The Market Hijack', text: 'Instant & Passive. Pay $4 Profit Tokens. Passive: Whenever you place your Copycat Meeple to copy an opponent\'s action space, you also immediately advance +1 space on the Market Share Track for free.' },
    },
  },
};

const MILESTONE_KEY_TO_ABILITY_NAME = {
  HEADHUNTER: TECH_TRACK_ABILITY_CATALOG.training.A[7].name,
  POISON_PILL: TECH_TRACK_ABILITY_CATALOG.training.A[9].name,
  EXECUTIVE_HEADROOM: TECH_TRACK_ABILITY_CATALOG.training.B[7].name,
  IRONCLAD_CONTRACT: TECH_TRACK_ABILITY_CATALOG.training.B[9].name,
  SIGNAL_JAMMER: TECH_TRACK_ABILITY_CATALOG.technology.A[7].name,
  SILICON_VALLEY_SWEEP: TECH_TRACK_ABILITY_CATALOG.technology.A[9].name,
  CLOUD_INFRASTRUCTURE: TECH_TRACK_ABILITY_CATALOG.technology.B[7].name,
  MASTER_ALGORITHM: TECH_TRACK_ABILITY_CATALOG.technology.B[9].name,
  VENTURE_LIQUIDATION: TECH_TRACK_ABILITY_CATALOG.recognition.A[7].name,
  GOLDEN_PARACHUTE: TECH_TRACK_ABILITY_CATALOG.recognition.A[9].name,
  HOSTILE_BUYOUT: TECH_TRACK_ABILITY_CATALOG.recognition.B[7].name,
  MARKET_HIJACK: TECH_TRACK_ABILITY_CATALOG.recognition.B[9].name,
};

// FIXED (this session): catalog.json now correctly includes the real
// S1-S7 starting cards (a loader bug — buildCatalogId was double-
// prefixing them as "START_S1" instead of the bare "S1" the rest of the
// engine has always expected — was fixed and the catalog regenerated).
// The old GRW_* substitute workaround below is no longer needed; these
// are the genuine, intended starting cards.
const REAL_STARTING_HAND = ['S1', 'S2', 'S3', 'S4', 'S5'];
const REAL_STARTING_DRAW_PILE = ['S6', 'S7'];
const RESERVED_STARTING_DECK_CATALOG_IDS = new Set([...REAL_STARTING_HAND, ...REAL_STARTING_DRAW_PILE]);

let state = null;
let pendingFreeAction = false;
// Epic 3: same toggle-mode pattern as pendingFreeAction — when active,
// the next space click sends a different action type instead of the
// normal PLACE_MEEPLE.
let pendingOvertimeManager = false;
let pendingLiquidityStaffPT = false;
// Epic 3: a client-driven modal for abilities that aren't triggered by
// a server-side pendingInterrupt at all (Liquidation Engine, Proprietary
// Algorithm are free-standing, player-initiated actions, not choices the
// engine is blocking on) — null when no such modal is open, otherwise
// {type: 'LIQUIDATION_ENGINE' | 'PROPRIETARY_ALGORITHM'}.
let clientModalState = null;
// Epic 4: two-stage state for SILICON_VALLEY_SWEEP's real play/keep/
// discard choice (see buildMilestoneChoiceBodyHtml) — null or
// {stage: 'play'} or {stage: 'keep', playCatalogId: string|null}.
// Reset whenever a fresh TRACK_MILESTONE_CHOICE interrupt begins.
let svsStage = null;
// Turn Order Bidding: module-level so a re-render triggered by any
// other player's action (a real, confirmed multiplayer bug) doesn't
// silently wipe the human player's in-progress bid back to 0 before
// they click Submit. Reset to 0 after a successful submit (see
// handleSubmitTurnOrderBid) so the next bidding phase starts clean.
let pendingBidPriority = 0;
let pendingBidCash = 0;
let catalog = null;
let previousShiftPosition = null;
// Turn notification: tracks whose turn it was on the last render so we
// can detect the exact moment control switches TO the human player
// (not every render — only a genuine transition), plus the title-flash
// interval and the page's real original title to restore once focused.
let previousActivePlayerId = null;
let titleFlashInterval = null;
const ORIGINAL_DOCUMENT_TITLE = document.title;
let previousBonusClaimState = {};
let previousBoardMeepleInstanceIds = new Set();
let previousOnBoardMeepleCountByPlayer = {};
let dismissedInterruptKey = null;
let endGameSurveyCompleted = false;

// ---------------------------------------------------------------------------
// Boot

/**
 * realShuffle(array)
 * Fisher-Yates. The identity function used throughout this project's own
 * test suites (`shuffle: (a) => a`) is deliberate there — deterministic
 * assertions need a known card order. It was never correct for the
 * actual live game: every real session was starting with every deck in
 * identical CSV row order, every time. This is the real shuffle used at
 * boot from here on.
 */
function realShuffle(array) {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

async function preloadCatalogData() {
  const res = await fetch('catalog.json');
  catalog = await res.json();

  const agentRes = await fetch('agentCatalog.json');
  const agentCatalog = await agentRes.json();
  catalog = { ...catalog, agentCards: agentCatalog };
}

/**
 * startGame(botConfigs)
 * botConfigs: array of { archetype } for each bot slot (2 to 5 entries —
 * player 1 is always the local human, fixed, matching HUMAN_PLAYER_ID
 * used everywhere else in this file). archetype is one of 'Aggressive',
 * 'Growth', 'Engine', 'Cautious', or 'Random' (resolved by the real
 * engine — gameSetupController.js's own Random-archetype resolution,
 * not re-implemented here).
 */
function startGame(botConfigs) {
  const BOT_COLORS = ['blue', 'green', 'gold', 'purple', 'grey'];
  // Named Bot Personalities — a pure display layer over the real,
  // already-working archetype behavior (player.archetype === "Aggressive"
  // etc. drives actual decision logic throughout engine.bundle.js;
  // renaming those underlying strings would mean hunting down and
  // verifying every branch that checks them, which is real risk this
  // change avoids entirely by only touching displayName). Mapped to the
  // closest existing archetype for each requested personality: Growth's
  // real behavior already prioritizes recruiting/roster expansion
  // (Recruiter/Headhunter); Engine's real behavior already prioritizes
  // operations-track efficiency (Efficiency/Operations); Cautious's real
  // behavior already adapts defensively (Balanced/Defensive).
  const BOT_PERSONALITY_REGISTRY = {
    Aggressive: { name: 'Vince "The Shark" Steel', title: 'Aggressive / Shark' },
    Engine: { name: 'Calculated Carl', title: 'Efficiency / Operations' },
    Growth: { name: 'Hunter Hayes', title: 'Recruiter / Headhunter' },
    Cautious: { name: 'Morgan Trust', title: 'Balanced / Defensive' },
  };
  const RANDOMIZABLE_ARCHETYPES = Object.keys(BOT_PERSONALITY_REGISTRY);
  const usedPersonaNames = {};

  function resolveBotPersonality(requestedArchetype) {
    // "Random" is resolved to a real archetype HERE, at game start —
    // exactly like the engine's own existing Random-resolution comment
    // ("archetype === 'Random'", confirmed real in engine.bundle.js) —
    // so the bot's actual behavior is genuinely one of the 4 real
    // archetypes, not a fake fifth behavior.
    const resolvedArchetype =
      requestedArchetype === 'Random'
        ? RANDOMIZABLE_ARCHETYPES[Math.floor(Math.random() * RANDOMIZABLE_ARCHETYPES.length)]
        : requestedArchetype;
    const persona = BOT_PERSONALITY_REGISTRY[resolvedArchetype] || { name: 'Bot', title: resolvedArchetype };
    usedPersonaNames[persona.name] = (usedPersonaNames[persona.name] || 0) + 1;
    const occurrence = usedPersonaNames[persona.name];
    const displayName = occurrence > 1 ? `${persona.name} ${['I', 'II', 'III', 'IV', 'V'][occurrence - 1] || occurrence}` : persona.name;
    return { archetype: resolvedArchetype, displayName, personaTitle: persona.title };
  }

  const players = [
    {
      playerId: 'p1',
      color: 'red',
      displayName: 'You',
      startingHandCatalogIds: [...REAL_STARTING_HAND],
      startingDrawPileCatalogIds: [...REAL_STARTING_DRAW_PILE],
    },
    ...botConfigs.map((botConfig, i) => {
      const resolved = resolveBotPersonality(botConfig.archetype);
      return {
        playerId: `p${i + 2}`,
        color: BOT_COLORS[i],
        displayName: resolved.displayName,
        isBot: true,
        archetype: resolved.archetype,
        personaTitle: resolved.personaTitle,
        startingHandCatalogIds: [...REAL_STARTING_HAND],
        startingDrawPileCatalogIds: [...REAL_STARTING_DRAW_PILE],
      };
    }),
  ];

  state = BrokerBossEngine.initializeGame(players, {
    specialistCatalogIds: Array.from({ length: 13 }, (_, i) => `SPEC_${i + 1}`),
    agentCatalog: catalog.agentCards,
    // BUGFIX: the Open Market pool previously included EVERY real
    // catalogId, including the ones reserved for REAL_STARTING_HAND /
    // REAL_STARTING_DRAW_PILE above — meaning e.g. GRW_001 ("Networking
    // Brunch") could sit in a player's fixed starting hand AND
    // simultaneously be sitting in the shared Open Market row. The
    // reserved starting-deck catalogIds are excluded here so the market
    // pool is drawn strictly from the remaining standard market cards.
    actionCardCatalogIds: Object.keys(catalog.actionCards).filter((id) => !RESERVED_STARTING_DECK_CATALOG_IDS.has(id)),
    shuffle: realShuffle,
    cardCatalog: catalog,
  });

  // FLAGGED STAND-IN (same as every test/simulation file in this project):
  // initializeGame() leaves phase.current at 'SETUP' — nothing in the
  // engine flips it to WORKER_PLACEMENT yet. Done once, here, exactly like
  // mainEngineSimulator.test.js / grandFinalEngineSweep.test.js already do.
  // FIX: shiftDeck was never populated here at all — a long-standing gap
  // that simply never surfaced before, because bots never recruited
  // (recruiting triggers a Market Report check, which can draw a real
  // Shift card). Real shift catalog ids, shuffled with the same
  // realShuffle used for every other deck.
  state = {
    ...state,
    shiftDeck: { drawPile: realShuffle(Object.keys(catalog.shiftCards).map((catalogId) => ({ catalogId }))), discardPile: [] },
  };

  state = { ...state, phase: { ...state.phase, current: 'WORKER_PLACEMENT' } };

  document.getElementById('lobby-screen').style.display = 'none';
  document.getElementById('app-shell').style.display = 'block';

  render();
}

// ---------------------------------------------------------------------------
// Action handlers — every one goes through executeUserAction

function handleSpaceClick(spaceId, preferredMeepleInstanceId = null) {
  if (pendingFreeAction) {
    dismissedInterruptKey = null;
    logLine('');
    showToast('');
    const result = BrokerBossEngine.executeUserAction(state, {
      type: 'EXECUTE_FREE_ACTION_SPACE',
      playerId: HUMAN_PLAYER_ID,
      spaceId,
    });
    if (result.error) {
      logLine(`Free Action rejected: ${result.error}`);
      showToast(`Could not perform that space for free: ${result.error}`);
    } else {
      showToast('Free Action performed — no Time Meeple spent.');
    }
    pendingFreeAction = false;
    state = result.state;
    render();
    return;
  }
  if (pendingOvertimeManager) {
    dismissedInterruptKey = null;
    logLine('');
    showToast('');
    const player = state.players[HUMAN_PLAYER_ID];
    const availableMeeples = player.timeMeeples.active.filter((m) => m.status === 'in_supply');
    pendingOvertimeManager = false;
    if (availableMeeples.length === 0) {
      showToast('No available Time Meeple to place with Overtime Manager.');
      render();
      return;
    }
    const result = BrokerBossEngine.executeUserAction(state, {
      type: 'PLACE_MEEPLE',
      playerId: HUMAN_PLAYER_ID,
      meepleInstanceId: availableMeeples[0].instanceId,
      spaceId,
      useOvertimeManager: true,
    });
    if (result.error) {
      logLine(`Overtime Manager placement rejected: ${result.error}`);
      showToast(`Could not place there with Overtime Manager: ${result.error}`);
    } else {
      showToast('Overtime Manager used — placed on an occupied space for $2 PT.');
    }
    state = result.state;
    render();
    return;
  }
  if (pendingLiquidityStaffPT) {
    dismissedInterruptKey = null;
    logLine('');
    showToast('');
    pendingLiquidityStaffPT = false;
    const result = BrokerBossEngine.executeUserAction(state, {
      type: 'USE_LIQUIDITY_STAFF_PT',
      playerId: HUMAN_PLAYER_ID,
      spaceId,
    });
    if (result.error) {
      logLine(`Venture Liquidation action rejected: ${result.error}`);
      showToast(`Could not use a Liquidity Staff token there: ${result.error}`);
    } else {
      showToast('Venture Liquidation: 1 Liquidity Staff token spent, action performed for free.');
    }
    state = result.state;
    render();
    return;
  }
  dismissedInterruptKey = null;
  logLine(''); // BUGFIX: clear any stale error banner from a previous action before this one runs
  showToast('');
  const vm = BrokerBossEngine.getUiViewModel(state);
  if (vm.meta.phase !== 'WORKER_PLACEMENT' || vm.meta.activePlayerId !== HUMAN_PLAYER_ID || vm.pendingInterrupt) {
    return; // wrong phase, not your turn, or a choice is pending — clicking a space does nothing
  }

  const player = state.players[HUMAN_PLAYER_ID];
  const space = vm.board.actionSpaces.find((s) => s.spaceId === spaceId);
  const meepleCost = (space && space.cost && space.cost.meepleCost) || 1;

  // Epic 3: the Copycat Meeple is a completely separate field
  // (timeMeeples.copycatMeeple), never part of timeMeeples.active — the
  // normal availableMeeples selection below would never find it even if
  // its instanceId were passed in, so it needs its own dedicated path,
  // checked before falling through to normal meeple selection.
  if (preferredMeepleInstanceId && player.timeMeeples.copycatMeeple && preferredMeepleInstanceId === player.timeMeeples.copycatMeeple.instanceId) {
    const result = BrokerBossEngine.executeUserAction(state, {
      type: 'PLACE_MEEPLE',
      playerId: HUMAN_PLAYER_ID,
      meepleInstanceId: preferredMeepleInstanceId,
      spaceId,
    });
    if (result.error) {
      logLine(`Copycat Meeple placement rejected: ${result.error}`);
      showToast(`Could not place the Copycat Meeple there: ${result.error}`);
    } else {
      showToast('Copycat Meeple placed.');
    }
    state = result.state;
    render();
    return;
  }

  let availableMeeples = player.timeMeeples.active.filter((m) => m.status === 'in_supply');
  if (availableMeeples.length < meepleCost) {
    logLine(`Not enough available meeples (need ${meepleCost}).`);
    return;
  }
  // Drag-and-drop: the specific meeple the player actually dragged
  // must be the one committed, not just whichever happens to be first
  // in the array — move it to the front, keeping the rest as fallback
  // fill for a multi-meeple-cost space.
  if (preferredMeepleInstanceId) {
    const preferred = availableMeeples.find((m) => m.instanceId === preferredMeepleInstanceId);
    if (preferred) {
      availableMeeples = [preferred, ...availableMeeples.filter((m) => m.instanceId !== preferredMeepleInstanceId)];
    }
  }

  const [primary, ...additional] = availableMeeples.slice(0, meepleCost);

  const result = BrokerBossEngine.executeUserAction(state, {
    type: 'PLACE_MEEPLE',
    playerId: HUMAN_PLAYER_ID,
    meepleInstanceId: primary.instanceId,
    spaceId,
    additionalMeepleInstanceIds: additional.map((m) => m.instanceId),
  });

  if (result.error) {
    logLine(`Action rejected: ${result.error}`);
    if (result.error === 'MEEPLE_NOT_IN_SUPPLY') {
      // FIX (Item 4): a stale meeple reference (e.g. from a drag that
      // started before a state change, or a frontend cache that
      // briefly lagged the real engine state) must never leave the UI
      // stuck showing a meeple as available when it genuinely isn't.
      // Explicitly clear every frontend-only interaction flag that
      // could otherwise persist across this rejection, on top of the
      // unconditional state/render refresh below.
      dismissedInterruptKey = null;
      cardZoomPinned = false;
      cardZoomOverlay.classList.remove('card-zoom-visible', 'card-zoom-pinned');
      draggedMeepleInstanceId = null;
      document.querySelectorAll('.space-drag-hover').forEach((el) => el.classList.remove('space-drag-hover'));
      document.querySelectorAll('.draggable-meeple-token-dragging').forEach((el) => el.classList.remove('draggable-meeple-token-dragging'));
      showToast('That meeple is no longer available — the board has been refreshed to your real current state.');
    }
  }
  state = result.state;
  render();
}

/**
 * translateCardPlayError(errorCode, detail)
 * Maps a real engine error code (+ its real detail payload) into a
 * friendly, human-readable message. Only translates codes whose detail
 * shape is actually known and guaranteed by the engine (INSUFFICIENT_FUNDS
 * -> { required, current }, from actionCardReducer.js's own contract) —
 * any other/unrecognized code falls back to the raw code rather than
 * fabricating friendly text for a detail shape we don't actually have.
 */
/**
 * isCardAffordable(card, profitTokens)
 * Real-data check: an unresolved/placeholder card has no known cost, so
 * it's never disabled on affordability grounds (its own resolved:false
 * styling already marks it distinctly). A resolved card is affordable iff
 * its real cost does not exceed the player's real current balance.
 */
function isCardAffordable(card, profitTokens) {
  if (card.isPlaceholder || card.cost === null) return true;
  return card.cost <= profitTokens;
}

/**
 * checkCardPrerequisite(card, playerDash)
 * The rulebook's "Hard Stop Rule": a card with a playRequirement can only
 * be played once the player's real, current track value meets or exceeds
 * it — no buy-ins, no exceptions. Mirrors actionCardReducer.js's own
 * verifyPlayRequirement contract shape exactly (real prerequisite data
 * from the bridge, not fabricated). Handles every real requirement type
 * seen in the actual catalog: track (training/technology/recognition),
 * marketShare, rosterSize.
 */
function checkCardPrerequisite(card, playerDash) {
  const req = card.playRequirement;
  if (!req) {
    return { met: true, tooltip: null };
  }

  if (req.type === 'track') {
    const trackMeter = playerDash.trackMeters.find((m) => m.key === req.track);
    const current = trackMeter ? trackMeter.value : 0;
    const label = trackMeter ? trackMeter.label : req.track;
    return {
      met: current >= req.level,
      tooltip: `Requires ${label} Level ${req.level} (you have ${current})`,
    };
  }

  if (req.type === 'marketShare') {
    const marketShareMeter = playerDash.trackMeters.find((m) => m.key === 'marketShare');
    const currentPosition = marketShareMeter ? marketShareMeter.value : 0;
    const current = BrokerBossEngine.MARKET_SHARE_TRACK_SPACES[currentPosition] || 0;
    return {
      met: current >= req.level,
      tooltip: `Requires Market Share ${req.level}+ (you have ${current})`,
    };
  }

  if (req.type === 'rosterSize') {
    const current = playerDash.roster.count;
    return {
      met: current >= req.count,
      tooltip: `Requires Roster Size ${req.count}+ (you have ${current})`,
    };
  }

  // An unrecognized requirement type this UI doesn't know how to check
  // yet — fail closed (treat as unmet) rather than silently allowing a
  // card whose real requirement we can't actually verify.
  return { met: false, tooltip: `Requires ${req.type} (unable to verify — treated as unmet)` };
}

/**
 * checkCardPlayability(card, playerDash)
 * Combines affordability + prerequisite into one gate + one tooltip
 * reason, so every place cards are rendered checks both the same way.
 */
/**
 * buildHandCardHtml(c, dash, canPlayFromHand)
 * The single, shared action-card template for the human player's own
 * hand — used by both the dashboard's compact display and the new
 * BGA-style hand drawer, so there's exactly one place this card's
 * markup is defined. Now includes real portrait art (matching
 * renderAgencyBoard's own pattern for Open Market cards), which also
 * means the hover/click-zoom overlay has real art to clone for hand
 * cards, not just name/cost text as before.
 */
function buildHandCardHtml(c, dash, canPlayFromHand) {
  const { playable: meetsRequirements, tooltip } = checkCardPlayability(c, dash);
  const playable = canPlayFromHand && meetsRequirements;
  const blocked = canPlayFromHand && !meetsRequirements;
  const hoverText = escapeAttr(buildCardHoverTooltip(c, dash));
  const catalogActionCards = (catalog && catalog.actionCards) || {};
  const cardImage = !c.isPlaceholder && catalogActionCards[c.catalogId] ? catalogActionCards[c.catalogId].cardImage : null;
  const family = !c.isPlaceholder && catalogActionCards[c.catalogId] ? catalogActionCards[c.catalogId].family : null;
  const cantAffordHtml = blocked ? `<div class="hand-card-cant-afford">${tooltip}</div>` : '';
  const fallbackInner = `<div class="market-card-family-header">${family || ''}</div>
    ${buildPortraitHtml(null, c.name, 'action-cards')}
    <div class="hand-card-name">${c.name}</div><div class="hand-card-cost">$${c.cost}</div>`;

  return `
        <div class="hand-card ${c.isPlaceholder ? 'hand-card-placeholder' : ''} ${playable ? 'hand-card-playable' : ''} ${
    blocked ? 'hand-card-unaffordable' : ''
  }" data-family="${family || ''}"
             data-instance-id="${c.instanceId}" data-tooltip="${hoverText}">
          ${
            c.isPlaceholder
              ? '<div class="hand-card-blank">?</div>'
              : `${buildFullCardImageHtml(cardImage, 'action-cards', fallbackInner)}${cantAffordHtml}`
          }
        </div>`;
}

function checkCardPlayability(card, playerDash) {
  if (card.isPlaceholder) {
    return { playable: false, tooltip: null };
  }
  const affordable = isCardAffordable(card, playerDash.wallet.profitTokens);
  const prereq = checkCardPrerequisite(card, playerDash);

  if (!prereq.met) {
    return { playable: false, tooltip: prereq.tooltip };
  }
  if (!affordable) {
    return { playable: false, tooltip: "Can't afford" };
  }
  return { playable: true, tooltip: null };
}

/**
 * buildCardHoverTooltip(card, playerDash)
 * The rich, multi-line hover tooltip this step asked for — used
 * consistently everywhere a card renders (dashboard hand, modal hand,
 * modal Acquire section, the persistent Open Market panel). Every line is
 * real data: catalog name/cost, the real playRequirement (met/unmet
 * status computed the same way checkCardPrerequisite already does, so the
 * tooltip and the disabled-state reasoning can never disagree), and the
 * exact CSV description text — never a re-derived or guessed summary.
 * @param playerDash - optional; when omitted (e.g. the read-only Open
 *   Market panel, which isn't tied to one specific player's tracks),
 *   prerequisite status is shown as unresolved rather than fabricated.
 */
function escapeAttr(text) {
  return String(text).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/**
 * buildPortraitHtml(imageFileName, fallbackLabel, folder)
 * Phase 3: real image filenames already exist in the catalog data
 * (agentCatalog's `image`, action cards' `cardImage`) but none of the
 * actual art files exist in this project yet. Rather than wait on art,
 * this renders a real <img> pointed at the expected path — the moment
 * real files land in web/assets/<folder>/, they display automatically,
 * no code change needed — and falls back to a styled initials/icon
 * placeholder via onerror so cards look complete today either way.
 */
function buildPortraitHtml(imageFileName, fallbackLabel, folder) {
  const safeLabel = escapeAttr(fallbackLabel || '?');
  if (!imageFileName) {
    return `<div class="card-portrait card-portrait-fallback"><span>${safeLabel}</span></div>`;
  }
  const src = escapeAttr(`assets/${folder}/${encodeURIComponent(imageFileName)}`);
  return `
    <div class="card-portrait">
      <img src="${src}" alt="${safeLabel}" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';" />
      <span class="card-portrait-fallback-text" style="display:none;">${safeLabel}</span>
    </div>`;
}

/**
 * buildFullCardImageHtml(imageFileName, folder, fallbackHtml)
 * Full physical card scans (Rulebook 5.1 asset upgrade): when a real
 * card image exists, render it full-bleed as the entire card — the
 * image already contains the title, stats, cost, and artwork printed
 * on the physical card, so no separate text is rendered alongside it
 * (that would double up with what's already in the image). If the
 * image is missing or fails to load, falls back to the full original
 * text-based template (fallbackHtml) so the card is never blank.
 */
function buildFullCardImageHtml(imageFileName, folder, fallbackHtml) {
  if (!imageFileName) {
    return `<div class="full-card-text-fallback">${fallbackHtml}</div>`;
  }
  const src = escapeAttr(`assets/${folder}/${encodeURIComponent(imageFileName)}`);
  return `
    <div class="full-card-image-wrap">
      <img class="full-card-image" src="${src}" alt="" onerror="this.style.display='none'; this.nextElementSibling.classList.add('full-card-text-fallback-visible');" />
      <div class="full-card-text-fallback">${fallbackHtml}</div>
    </div>`;
}

function buildCardHoverTooltip(card, playerDash) {
  if (card.isPlaceholder) {
    return 'Unresolved card (no catalog data)';
  }

  const lines = [`${card.name} — $${card.cost} PT`];

  if (card.playRequirement) {
    const prereq = playerDash ? checkCardPrerequisite(card, playerDash) : { met: null, tooltip: null };
    if (prereq.met === true) {
      lines.push(`✓ ${prereq.tooltip.replace('Requires', 'Meets')}`);
    } else if (prereq.met === false) {
      lines.push(`✗ ${prereq.tooltip}`);
    } else {
      lines.push(`Has a prerequisite: ${JSON.stringify(card.playRequirement)}`);
    }
  }

  if (card.description) {
    lines.push(card.description);
  }

  return lines.join('\n');
}

/**
 * countPlayerAgentMatches(agent, playerDash)
 * How many of the agent's 3 real values (training/technology/recognition)
 * the given player's real current tracks meet or exceed. Real data only —
 * mirrors agentRecruitmentReducer.js's own countMatchingValues logic
 * exactly, just read from the view model's already-resolved shape instead
 * of raw engine state.
 */
function countPlayerAgentMatches(agent, playerDash) {
  if (!playerDash) return null;
  const trackValue = (key) => {
    const meter = playerDash.trackMeters.find((m) => m.key === key);
    return meter ? meter.value : 0;
  };
  let matches = 0;
  if (trackValue('training') >= agent.training) matches += 1;
  if (trackValue('technology') >= agent.technology) matches += 1;
  if (trackValue('recognition') >= agent.recognition) matches += 1;
  return matches;
}

/**
 * buildAgentHoverTooltip(agent, playerDash, requiredMatches)
 * Rich tooltip: real stats, real network link, and real eligibility
 * against the given player's current tracks — never fabricated. Desk
 * cost is called out explicitly since Followers legitimately cost 0
 * desks while their Influencer is present, which is easy to miss
 * otherwise.
 */
function buildAgentHoverTooltip(agent, playerDash, requiredMatches) {
  const isResolved = agent.resolved === true || agent.isPlaceholder === false;
  if (!isResolved) {
    return 'Unresolved agent (no catalog data)';
  }

  const lines = [`${agent.title ? agent.title + ' — ' : ''}${agent.name}`];
  lines.push(`Training ${agent.training} · Technology ${agent.technology} · Recognition ${agent.recognition} · Culture ${agent.culture}`);
  lines.push(`Net Profit: $${agent.totalProfit} PT (one-time bonus on recruitment; also counted at Final Scoring)`);

  if (agent.network && agent.network.role !== 'independent') {
    if (agent.network.role === 'influencer') {
      lines.push(`Network: Influencer (${agent.network.color}) — pulls connected Followers for free`);
    } else {
      lines.push(`Network: Follower (${agent.network.color}) — 0 desk cost while their Influencer is on the same roster`);
    }
  }

  if (typeof requiredMatches === 'number' && playerDash) {
    const matches = countPlayerAgentMatches(agent, playerDash);
    lines.push(
      matches >= requiredMatches
        ? `✓ Eligible (${matches}/3 values met, ${requiredMatches} required)`
        : `✗ Not eligible (${matches}/3 values met, ${requiredMatches} required)`
    );

    // ITEM 1: per-dimension breakdown, not just the aggregate — e.g.
    // "✓ Training: meets requirement (2 ≥ 2)" / "✗ Technology: below
    // requirement (0 < 2)", one line per real value.
    const trackValue = (key) => {
      const meter = playerDash.trackMeters.find((m) => m.key === key);
      return meter ? meter.value : 0;
    };
    const DIMENSION_LABELS = { training: 'Training', technology: 'Technology', recognition: 'Recognition' };
    Object.keys(DIMENSION_LABELS).forEach((dim) => {
      const playerValue = trackValue(dim);
      const agentValue = agent[dim];
      const met = playerValue >= agentValue;
      lines.push(
        met
          ? `  ✓ ${DIMENSION_LABELS[dim]}: meets requirement (${playerValue} ≥ ${agentValue})`
          : `  ✗ ${DIMENSION_LABELS[dim]}: below requirement (${playerValue} < ${agentValue})`
      );
    });
  }

  if (agent.hasOnboardingToken) lines.push('🛡 Onboarding Token — immune to poaching this round');
  if (agent.hasLoyaltyToken) lines.push('❤ Loyalty Token — unrecruitable');

  return lines.join('\n');
}

/**
 * buildAgentCardHtml(agent, options)
 * Shared card markup for an Agent — used in the Open Market panel, roster
 * displays, and the Recruit/Poach/Loyalty modal candidate lists. Network
 * badge (Influencer/Follower) and token overlays (Onboarding/Loyalty) are
 * all real data from the view model, never fabricated.
 */
/**
 * NETWORK_COLOR_CLASS_MAP
 * ITEM 2: maps each of the 6 real network colors (confirmed against the
 * actual agent catalog — Red, Grey, Green, Blue, Purple, Yellow) to a CSS
 * class, so an Influencer and its Follower(s) — who always share the same
 * network color — render with matching, visually distinct badge accents,
 * rather than one fixed color for ALL influencers and a separate fixed
 * color for ALL followers regardless of which network they belong to.
 */
const NETWORK_COLOR_CLASS_MAP = {
  Red: 'network-color-red',
  Grey: 'network-color-grey',
  Green: 'network-color-green',
  Blue: 'network-color-blue',
  Purple: 'network-color-purple',
  Yellow: 'network-color-yellow',
};

function networkColorClass(color) {
  return NETWORK_COLOR_CLASS_MAP[color] || '';
}

function buildAgentCardHtml(agent, options = {}) {
  const { clickable = false, dataAttr = '', tooltip = '' } = options;
  // BUGFIX: two different shapes reach this function — the bridge's raw
  // resolved/unresolved convention (vm.board.openMarketAgents,
  // vm.players[x].roster) and playerDashboardRenderer.js's own reshaped
  // roster output, which uses the inverted isPlaceholder field instead of
  // resolved. Normalizing here so a real, resolved roster agent never
  // silently renders as a placeholder just because it came from the
  // dashboard's own reshape.
  const isResolved = agent.resolved === true || agent.isPlaceholder === false;

  if (!isResolved) {
    return `<div class="agent-card agent-card-placeholder" ${dataAttr}><div class="hand-card-blank">?</div></div>`;
  }

  const colorClass = agent.network ? networkColorClass(agent.network.color) : '';
  const networkBadgeHtml =
    agent.network && agent.network.role === 'influencer'
      ? `<span class="agent-badge agent-badge-influencer ${colorClass}" title="Influencer (${agent.network.color})">★ INF</span>`
      : agent.network && agent.network.role === 'follower'
        ? `<span class="agent-badge agent-badge-follower ${colorClass}" title="Follower (${agent.network.color})">◦ FOL</span>`
        : '';

  const tokenBadgesHtml = `
    ${agent.hasOnboardingToken ? '<span class="agent-token agent-token-onboarding" title="Onboarding — immune to poaching">🛡</span>' : ''}
    ${agent.hasLoyaltyToken ? '<span class="agent-token agent-token-loyalty" title="Loyalty — unrecruitable">❤</span>' : ''}
    ${agent.coachTokens > 0 ? `<span class="agent-token agent-token-coached" title="Coached — Profit permanently +${agent.coachTokens * 3}">🎓${agent.coachTokens > 1 ? ` x${agent.coachTokens}` : ''}</span>` : ''}
  `;

  const fallbackHtml = `
    <div class="agent-card-portrait-wrap">${buildPortraitHtml(null, agent.name, 'agents')}</div>
    <div class="agent-card-info">
      <div class="agent-card-name">${agent.name}</div>
      <div class="agent-card-stats">T${agent.training} · Te${agent.technology} · R${agent.recognition} · C${agent.culture}</div>
      <div class="agent-card-profit-row">
        <span class="agent-card-net-profit" title="Net Profit — one-time bonus on recruitment, also counted at Final Scoring">$${agent.totalProfit} Net Profit</span>
      </div>
    </div>`;

  return `
    <div class="agent-card agent-card-full-art ${clickable ? 'agent-card-clickable' : ''}" ${dataAttr} data-tooltip="${escapeAttr(tooltip)}">
      <div class="agent-card-token-stack">${networkBadgeHtml}${tokenBadgesHtml}</div>
      ${buildFullCardImageHtml(agent.image, 'agents', fallbackHtml)}
    </div>`;
}

function translateCardPlayError(errorCode, detail) {
  if (errorCode === 'INSUFFICIENT_FUNDS' && detail && typeof detail.required === 'number' && typeof detail.current === 'number') {
    return `Insufficient Profit Tokens to play this card ($${detail.required} required, you have $${detail.current}).`;
  }
  if (errorCode === 'REQUIREMENT_NOT_MET' && detail && detail.track) {
    return `Requires ${detail.track} Level ${detail.required} (you have ${detail.current}).`;
  }
  return `Card play rejected: ${errorCode}`;
}

function handleHandCardClick(cardInstanceId) {
  dismissedInterruptKey = null;
  logLine('');
  showToast('');
  const vm = BrokerBossEngine.getUiViewModel(state);
  const interrupt = vm.pendingInterrupt;
  const canPlayFromHand =
    interrupt &&
    interrupt.type === 'ACTION_SPACE_DEFERRED_CHOICE' &&
    interrupt.spaceType === 'acquire_or_play_action_card' &&
    interrupt.sourcePlayerId === HUMAN_PLAYER_ID;

  if (!canPlayFromHand) {
    logLine('Place a meeple on "Play a Card" first to unlock your hand.');
    return;
  }

  const playedCard = cardInstanceId ? vm.players[HUMAN_PLAYER_ID].hand.cards.find((c) => c.instanceId === cardInstanceId) : null;

  const result = BrokerBossEngine.executeUserAction(state, {
    type: 'PLAY_ACTION_CARD',
    playerId: HUMAN_PLAYER_ID,
    cardInstanceId,
  });

  if (result.error) {
    logLine(translateCardPlayError(result.error, result.detail));
  } else if (playedCard && playedCard.resolved) {
    // LOG VISIBILITY: the real toast this step asked for — the exact
    // catalog description, not a re-derived summary of state deltas.
    showToast(`Played ${playedCard.name} ($${playedCard.cost} PT): ${playedCard.description || 'no effect text on file'}`);
  }
  state = result.state;
  render();
}

function handleAcquireActionCard(marketCatalogId) {
  dismissedInterruptKey = null;
  logLine('');
  showToast('');
  const vm = BrokerBossEngine.getUiViewModel(state);
  const interrupt = vm.pendingInterrupt;
  const canAcquire =
    interrupt &&
    interrupt.type === 'ACTION_SPACE_DEFERRED_CHOICE' &&
    interrupt.spaceType === 'acquire_or_play_action_card' &&
    interrupt.sourcePlayerId === HUMAN_PLAYER_ID;

  if (!canAcquire) {
    logLine('Place a meeple on "Play a Card" first to unlock the Open Market.');
    return;
  }

  const openMarket = vm.board.openMarketActionCards || [];
  const acquiredCard = marketCatalogId
    ? openMarket.find((c) => c.catalogId === marketCatalogId)
    : openMarket[0];

  const result = BrokerBossEngine.executeUserAction(state, {
    type: 'ACQUIRE_ACTION_CARD',
    playerId: HUMAN_PLAYER_ID,
    marketCatalogId,
  });

  if (result.error) {
    logLine(`Acquire rejected: ${result.error}`);
  } else if (acquiredCard && acquiredCard.resolved) {
    showToast(`Acquired ${acquiredCard.name} ($${acquiredCard.cost} PT) from the Open Market.`);
  }
  state = result.state;
  render();
}

function canActOnAgentSpace(vm, expectedSpaceId) {
  const interrupt = vm.pendingInterrupt;
  return !!(
    interrupt &&
    interrupt.type === 'ACTION_SPACE_DEFERRED_CHOICE' &&
    interrupt.spaceType === 'draft_open_market_agent' &&
    interrupt.spaceId === expectedSpaceId &&
    interrupt.sourcePlayerId === HUMAN_PLAYER_ID
  );
}

function handleRecruitAgent(agentCatalogId) {
  dismissedInterruptKey = null;
  logLine('');
  showToast('');
  const vm = BrokerBossEngine.getUiViewModel(state);

  if (!canActOnAgentSpace(vm, 'GRW_RECRUIT_AGENT')) {
    logLine('Place a meeple on "Recruit Open Market Agent" first.');
    return;
  }

  const agent = (vm.board.openMarketAgents || []).find((a) => a.catalogId === agentCatalogId);

  const result = BrokerBossEngine.executeUserAction(state, {
    type: 'RECRUIT_AGENT',
    playerId: HUMAN_PLAYER_ID,
    agentCatalogId,
  });

  if (result.error) {
    logLine(`Recruit rejected: ${result.error}`);
  } else if (agent && agent.resolved) {
    showToast(`Recruited ${agent.name} (+$${agent.totalProfit} Net Profit).`);
  }
  state = result.state;
  render();
}

function handlePoachAgent(targetPlayerId, targetAgentInstanceId) {
  dismissedInterruptKey = null;
  logLine('');
  showToast('');
  const vm = BrokerBossEngine.getUiViewModel(state);

  if (!canActOnAgentSpace(vm, 'GRW_POACH_AGENT')) {
    logLine('Place a meeple on "Poach Competing Broker Agent" first.');
    return;
  }

  const targetDash = vm.players[targetPlayerId];
  const agent = targetDash ? targetDash.roster.find((r) => r.agentInstanceId === targetAgentInstanceId) : null;

  const result = BrokerBossEngine.executeUserAction(state, {
    type: 'POACH_AGENT',
    playerId: HUMAN_PLAYER_ID,
    targetPlayerId,
    targetAgentInstanceId,
  });

  if (result.error) {
    logLine(`Poach rejected: ${result.error}`);
  } else if (agent && agent.resolved) {
    showToast(`Poached ${agent.name} from ${targetDash.displayName} — no PT cost, no Market Report triggered.`);
  }
  state = result.state;
  render();
}

function handlePlaceLoyaltyToken(agentInstanceId, fromAgentInstanceId) {
  dismissedInterruptKey = null;
  logLine('');
  showToast('');
  const vm = BrokerBossEngine.getUiViewModel(state);

  if (!canActOnAgentSpace(vm, 'GRW_LOYALTY_TOKEN')) {
    logLine('Place a meeple on the Growth Hub Loyalty space first.');
    return;
  }

  const humanDash = vm.players[HUMAN_PLAYER_ID];
  const agent = humanDash ? humanDash.roster.find((r) => r.agentInstanceId === agentInstanceId) : null;

  const result = BrokerBossEngine.executeUserAction(state, {
    type: 'PLACE_LOYALTY_TOKEN',
    playerId: HUMAN_PLAYER_ID,
    agentInstanceId,
    fromAgentInstanceId,
  });

  if (result.error) {
    logLine(`Loyalty Token rejected: ${result.error}`);
  } else if (agent && agent.resolved) {
    showToast(`Loyalty Token placed on ${agent.name} — unrecruitable.`);
  }
  state = result.state;
  render();
}

function handleCrmUpdateChoice(chosenCatalogId) {
  dismissedInterruptKey = null;
  logLine('');
  showToast('');

  const vm = BrokerBossEngine.getUiViewModel(state);
  const agent = (vm.pendingInterrupt.agentCandidates || []).find((a) => a.catalogId === chosenCatalogId);

  const result = BrokerBossEngine.executeUserAction(state, {
    type: 'RESOLVE_CRM_UPDATE_CHOICE',
    playerId: HUMAN_PLAYER_ID,
    chosenCatalogId,
  });

  if (result.error) {
    logLine(`CRM Update choice rejected: ${result.error}`);
  } else if (agent && agent.resolved) {
    showToast(`CRM Update: recruited ${agent.name} — the other 2 Agents return to the top of the deck.`);
  }
  state = result.state;
  render();
}

function handleStartCardChoice(extra) {
  dismissedInterruptKey = null;
  logLine('');
  showToast('');

  const result = BrokerBossEngine.executeUserAction(state, {
    type: 'RESOLVE_ACTION_CARD_EFFECT_CHOICE',
    playerId: HUMAN_PLAYER_ID,
    extra,
  });

  if (result.error) {
    logLine(`Choice rejected: ${result.error}`);
  } else {
    showToast('Choice resolved.');
  }
  state = result.state;
  render();
}

function handleHireCoachChoice(targetAgentInstanceId) {
  dismissedInterruptKey = null;
  logLine('');
  showToast('');

  const result = BrokerBossEngine.executeUserAction(state, {
    type: 'RESOLVE_HIRE_COACH_CHOICE',
    playerId: HUMAN_PLAYER_ID,
    targetAgentInstanceId,
  });

  if (result.error) {
    logLine(`Coach assignment rejected: ${result.error}`);
  } else if (targetAgentInstanceId) {
    showToast('Coach Token assigned — Profit permanently +3.');
  } else {
    showToast('No eligible Agent — Coach Token not assigned.');
  }
  state = result.state;
  render();
}

function handleClearOpenMarketChoice(choice) {
  dismissedInterruptKey = null;
  logLine('');
  showToast('');

  const result = BrokerBossEngine.executeUserAction(state, {
    type: 'RESOLVE_CLEAR_OPEN_MARKET_CHOICE',
    playerId: HUMAN_PLAYER_ID,
    choice,
  });

  if (result.error) {
    logLine(`Clear Open Market rejected: ${result.error}`);
  } else if (choice === 'wipe_both') {
    showToast('Both Open Market rows cleared and refreshed.');
  } else if (choice === 'wipe_action_and_take_free') {
    showToast('Action Card row refreshed — choose your free card.');
  } else {
    showToast('Agent row refreshed — choose your free Action Card.');
  }
  state = result.state;
  render();
}

function handleClearOpenMarketFreeCardPick(pickedCatalogId) {
  dismissedInterruptKey = null;
  logLine('');
  showToast('');

  const result = BrokerBossEngine.executeUserAction(state, {
    type: 'RESOLVE_CLEAR_OPEN_MARKET_FREE_CARD_PICK',
    playerId: HUMAN_PLAYER_ID,
    pickedCatalogId,
  });

  if (result.error) {
    logLine(`Free card pick rejected: ${result.error}`);
  } else {
    showToast(`${pickedCatalogId} taken for free.`);
  }
  state = result.state;
  render();
}

function handleShellCompanySecondRecruit(stashInstanceId) {
  logLine('');
  showToast('');

  const result = BrokerBossEngine.executeUserAction(state, {
    type: 'RESOLVE_SHELL_COMPANY_SECOND_RECRUIT',
    playerId: HUMAN_PLAYER_ID,
    stashInstanceId,
  });

  if (result.error) {
    logLine(`Shell Company recruit rejected: ${result.error}`);
    showToast(`Cannot recruit: ${result.error}`);
  } else {
    showToast('Recruited from the Shell Company stash.');
  }
  state = result.state;
  render();
}

/**
 * renderShiftCardResolutionModal(overlayEl, vm, humanDash)
 * Full-screen, non-dismissable Shift Card resolution — Priority 1 of
 * the redesign. The consequences list is built entirely from the real
 * log entries applyShiftCardEffect actually generated (captured
 * engine-side as consequencesLogEntries), not fabricated per-card
 * summary text — each entry's own message field is used verbatim when
 * present, falling back to a plain, honest description of the log
 * type only when a specific entry has none.
 */
/**
 * renderSpecialistCardChoiceModal(overlayEl, vm, humanDash)
 * Priority 2: The Lobbyist (SPEC_3) now genuinely lets the player pick
 * which hub to block, matching the card's own "any Hub" text — the
 * engine previously auto-picked the hub with the most open spaces with
 * no way for the player to actually decide.
 */
function renderSpecialistCardChoiceModal(overlayEl, vm, humanDash) {
  overlayEl.style.display = 'flex';
  const interrupt = vm.pendingInterrupt;
  const isChoosingPlayer = HUMAN_PLAYER_ID === interrupt.sourcePlayerId;

  if (interrupt.choiceType !== 'SPEC3_HUB_TARGET') {
    overlayEl.innerHTML = `<div class="modal-box"><p class="empty-hand-message">Unrecognized specialist card choice.</p></div>`;
    return;
  }

  const HUB_LABELS = {
    GROWTH: 'Growth',
    LEADERSHIP: 'Leadership',
    OPERATIONS: 'Operations',
    EXECUTIVE_DECISIONS: 'Executive Decisions',
    EXECUTIVE_SEARCH: 'Executive Search',
  };

  overlayEl.innerHTML = `
    <div class="modal-box">
      <h3>🔒 The Lobbyist</h3>
      <p class="modal-acquire-label">${isChoosingPlayer ? 'Choose which Hub to block for the rest of this round.' : `Waiting for ${escapeAttr(interrupt.sourcePlayerDisplayName || interrupt.sourcePlayerId)} to choose a Hub to block…`}</p>
      ${
        isChoosingPlayer
          ? `<div class="track-boost-picker">${interrupt.availableHubs
              .map((hub) => `<button type="button" class="track-boost-btn spec3-hub-btn" data-hub="${escapeAttr(hub)}">${escapeAttr(HUB_LABELS[hub] || hub)}</button>`)
              .join('')}</div>`
          : ''
      }
    </div>
  `;

  overlayEl.querySelectorAll('.spec3-hub-btn').forEach((el) => {
    el.addEventListener('click', () => {
      const result = BrokerBossEngine.executeUserAction(state, {
        type: 'RESOLVE_SPECIALIST_CARD_EFFECT_CHOICE',
        playerId: HUMAN_PLAYER_ID,
        extra: { targetHub: el.dataset.hub },
      });
      if (result.error) {
        showToast(`Could not block that hub: ${result.error}`);
      } else {
        showToast(`${HUB_LABELS[el.dataset.hub] || el.dataset.hub} hub blocked for the rest of the round.`);
      }
      state = result.state;
      render();
    });
  });
}

function renderShiftCardResolutionModal(overlayEl, vm, humanDash) {
  overlayEl.style.display = 'flex';
  const interrupt = vm.pendingInterrupt;
  const catalogId = interrupt.drawnCardCatalogId;
  const cardEntry = catalogId ? catalog.shiftCards[catalogId] : null;
  const isAcknowledgingPlayer = HUMAN_PLAYER_ID === interrupt.sourcePlayerId;

  const consequenceLines = (interrupt.consequencesLogEntries || [])
    .map((entry) => {
      if (entry.message) return entry.message;
      if (entry.type === 'SHIFT_EFFECT_APPLIED') {
        const name = (vm.players[entry.playerId] && vm.players[entry.playerId].displayName) || entry.playerId;
        return `Applied to ${name}.`;
      }
      if (entry.type === 'SHIFT_EFFECT_BLOCKED_BY_IMMUNITY') {
        const name = (vm.players[entry.playerId] && vm.players[entry.playerId].displayName) || entry.playerId;
        return `${name} is immune this round — no effect.`;
      }
      return null;
    })
    .filter(Boolean);

  const cardArtHtml = cardEntry
    ? buildFullCardImageHtml(cardEntry.cardImage, 'shift-cards', `<div class="shift-reveal-fallback-name">${escapeAttr(cardEntry.name || catalogId)}</div>`)
    : '<p class="empty-hand-message">Card details unavailable.</p>';

  overlayEl.innerHTML = `
    <div class="modal-box shift-resolution-modal-box">
      <h3>⚡ Shift Card Revealed</h3>
      <div class="shift-resolution-card-art">${cardArtHtml}</div>
      ${cardEntry ? `<p class="shift-resolution-card-title">${escapeAttr(cardEntry.name)}</p><p class="shift-resolution-card-text">${escapeAttr(cardEntry.description || '')}</p>` : ''}
      <div class="shift-resolution-consequences">
        <div class="shift-resolution-consequences-title">Consequences & Impact</div>
        <ul class="shift-resolution-consequences-list">
          ${consequenceLines.length > 0 ? consequenceLines.map((line) => `<li>${escapeAttr(line)}</li>`).join('') : '<li>No further effect this time.</li>'}
        </ul>
      </div>
      ${
        isAcknowledgingPlayer
          ? `<div class="modal-actions"><button type="button" class="modal-skip-btn" id="shift-card-acknowledge-btn">Acknowledge &amp; Resume Game</button></div>`
          : `<p class="shift-resolution-waiting">Waiting for ${escapeAttr(interrupt.sourcePlayerDisplayName || interrupt.sourcePlayerId)} to acknowledge…</p>`
      }
    </div>
  `;

  const ackBtn = overlayEl.querySelector('#shift-card-acknowledge-btn');
  if (ackBtn) {
    ackBtn.addEventListener('click', () => {
      const result = BrokerBossEngine.executeUserAction(state, { type: 'ACKNOWLEDGE_SHIFT_CARD', playerId: HUMAN_PLAYER_ID });
      if (result.error) {
        showToast(`Could not acknowledge: ${result.error}`);
      }
      state = result.state;
      render();
    });
  }
}

function renderTurnOrderBiddingModal(overlayEl, humanDash) {
  overlayEl.style.display = 'flex';
  const wallet = humanDash.wallet;
  // FIX: clamp the persisted bid to whatever the player can currently
  // afford — if a re-render happens after some other effect changed
  // their wallet mid-bid, don't silently let a stale bid exceed it.
  pendingBidPriority = Math.max(0, Math.min(pendingBidPriority, wallet.priorityTokens));
  pendingBidCash = Math.max(0, Math.min(pendingBidCash, wallet.profitTokens));
  overlayEl.innerHTML = `
    <div class="modal-box">
      <h3>Turn Order Bidding</h3>
      <p>Every player secretly bids for next round's turn order. Any Priority Token bid beats any cash-only bid outright — spend one to guarantee going first over cash bidders. Ties are broken by cash, then by this round's order.</p>
      <div class="track-boost-picker">
        <div class="dual-track-stepper-row">
          <span class="dual-track-stepper-label">Priority Tokens (have ${wallet.priorityTokens})</span>
          <button type="button" class="dual-track-stepper-btn" id="bid-priority-minus">−</button>
          <span class="dual-track-stepper-count" id="bid-priority-count">${pendingBidPriority}</span>
          <button type="button" class="dual-track-stepper-btn" id="bid-priority-plus">+</button>
        </div>
        <div class="dual-track-stepper-row">
          <span class="dual-track-stepper-label">Profit Tokens (have ${wallet.profitTokens})</span>
          <button type="button" class="dual-track-stepper-btn" id="bid-cash-minus">−</button>
          <span class="dual-track-stepper-count" id="bid-cash-count">${pendingBidCash}</span>
          <button type="button" class="dual-track-stepper-btn" id="bid-cash-plus">+</button>
        </div>
      </div>
      <div class="modal-actions"><button type="button" class="modal-skip-btn" id="bid-submit-btn">Submit Bid</button></div>
    </div>
  `;

  const priorityCountEl = overlayEl.querySelector('#bid-priority-count');
  const cashCountEl = overlayEl.querySelector('#bid-cash-count');

  overlayEl.querySelector('#bid-priority-plus').addEventListener('click', () => {
    if (pendingBidPriority < wallet.priorityTokens) {
      pendingBidPriority += 1;
      priorityCountEl.textContent = pendingBidPriority;
    }
  });
  overlayEl.querySelector('#bid-priority-minus').addEventListener('click', () => {
    if (pendingBidPriority > 0) {
      pendingBidPriority -= 1;
      priorityCountEl.textContent = pendingBidPriority;
    }
  });
  overlayEl.querySelector('#bid-cash-plus').addEventListener('click', () => {
    if (pendingBidCash < wallet.profitTokens) {
      pendingBidCash += 1;
      cashCountEl.textContent = pendingBidCash;
    }
  });
  overlayEl.querySelector('#bid-cash-minus').addEventListener('click', () => {
    if (pendingBidCash > 0) {
      pendingBidCash -= 1;
      cashCountEl.textContent = pendingBidCash;
    }
  });
  overlayEl.querySelector('#bid-submit-btn').addEventListener('click', () => {
    handleSubmitTurnOrderBid(pendingBidPriority, pendingBidCash);
  });
}

function handleSubmitTurnOrderBid(priorityTokensBid, profitTokensBid) {
  logLine('');
  showToast('');

  const result = BrokerBossEngine.executeUserAction(state, {
    type: 'SUBMIT_TURN_ORDER_BID',
    playerId: HUMAN_PLAYER_ID,
    profitTokensBid,
    priorityTokensBid,
  });

  if (result.error) {
    logLine(`Bid rejected: ${result.error}`);
  } else {
    showToast(`Bid submitted — ${priorityTokensBid} Priority, ${profitTokensBid} PT.`);
    pendingBidPriority = 0;
    pendingBidCash = 0;
  }
  state = result.state;
  render();
}

function dispatchDeployBankedToken(tokenType, options) {
  const result = BrokerBossEngine.executeUserAction(state, {
    type: 'DEPLOY_BANKED_BONUS_TOKEN',
    playerId: HUMAN_PLAYER_ID,
    tokenType,
    options: options || {},
  });

  if (result.error) {
    logLine(`Bonus token activation rejected: ${result.error}`);
    showToast(`Could not activate token: ${result.error}`);
  } else {
    showToast(`${SPRINT_BONUS_TOKEN_LABELS[tokenType] || tokenType} activated!`);
  }
  state = result.state;
  render();
}

function handleBankedTokenClick(tokenType) {
  logLine('');
  showToast('');

  if (tokenType === 'FREE_ACTION') {
    pendingFreeAction = true;
    showToast('Free Action active — click any real board space to perform it for free. No Time Meeple required.');
    render();
    return;
  }

  if (SIMPLE_BANKED_TOKEN_TYPES.has(tokenType)) {
    dispatchDeployBankedToken(tokenType, {});
    return;
  }

  if (TARGETED_BANKED_TOKEN_TYPES.has(tokenType) || MARKET_BANKED_TOKEN_TYPES.has(tokenType)) {
    renderBankedTokenTargetModal(tokenType);
  }
}

function renderBankedTokenTargetModal(tokenType) {
  const overlayEl = document.getElementById('interrupt-overlay');
  const vm = BrokerBossEngine.getUiViewModel(state);
  const humanDash = BrokerBossEngine.buildFullViewSync(state).dashboards[HUMAN_PLAYER_ID];
  const label = SPRINT_BONUS_TOKEN_LABELS[tokenType] || tokenType;

  let bodyHtml = '';
  if (tokenType === 'FREE_COACH_TOKEN' || tokenType === 'FREE_LOYALTY_TOKEN') {
    const candidates = (humanDash.roster.agents || []).filter((a) => a.resolved === true || a.isPlaceholder === false);
    bodyHtml =
      candidates.length === 0
        ? '<p class="empty-hand-message">No eligible Agent on your roster yet.</p>'
        : `<div class="agent-candidate-grid">${candidates
            .map((a) => buildAgentCardHtml(a, { clickable: true, dataAttr: `data-target-agent-instance-id="${a.agentInstanceId}"`, tooltip: a.name }))
            .join('')}</div>`;
  } else if (tokenType === 'FREE_OPEN_MARKET_AGENT') {
    const candidates = (vm.board.openMarketAgents || []).filter((a) => a.resolved === true || a.isPlaceholder === false);
    bodyHtml =
      candidates.length === 0
        ? '<p class="empty-hand-message">No real Agents currently in the Open Market.</p>'
        : `<div class="agent-candidate-grid">${candidates
            .map((a) => buildAgentCardHtml(a, { clickable: true, dataAttr: `data-target-catalog-id="${a.catalogId}"`, tooltip: a.name }))
            .join('')}</div>`;
  } else if (tokenType === 'FREE_ACTION') {
    const marketCandidates = (vm.board.openMarketActionCards || []).filter((c) => c.resolved === true || c.isPlaceholder === false);
    const handCandidates = humanDash && humanDash.hand ? humanDash.hand.cards.filter((c) => c.resolved === true || c.isPlaceholder === false) : [];
    const marketSectionHtml =
      marketCandidates.length === 0
        ? '<p class="empty-hand-message">No real Action Cards currently in the Open Market.</p>'
        : `<div class="modal-hand-cards">${marketCandidates
            .map((c) => `<div class="hand-card hand-card-playable" data-target-catalog-id-action="${c.catalogId}" title="${escapeAttr(c.name)}"><div class="hand-card-name">${c.name}</div><div class="hand-card-cost">$0</div></div>`)
            .join('')}</div>`;
    const handSectionHtml =
      handCandidates.length === 0
        ? '<p class="empty-hand-message">No real cards in hand to play.</p>'
        : `<div class="modal-hand-cards">${handCandidates
            .map((c) => `<div class="hand-card hand-card-playable" data-play-from-hand-instance-id="${c.instanceId}" title="${escapeAttr(c.name)}"><div class="hand-card-name">${c.name}</div><div class="hand-card-cost">$${c.cost} (still owed)</div></div>`)
            .join('')}</div>`;
    // Real rulebook text (Position 17, Free Action Token): "immediately
    // acquire an Action Card from the deck or play an Action Card from
    // your hand... without spending a Time Meeple." Both are genuinely
    // offered here — this token only ever waives the meeple/space
    // requirement, not a card's own stated PT cost when playing it.
    bodyHtml = `
      <p class="modal-acquire-label">Acquire from the Open Market for free:</p>
      ${marketSectionHtml}
      <p class="modal-acquire-label" style="margin-top:10px;">— or — Play a card already in your hand (its own PT cost still applies):</p>
      ${handSectionHtml}
    `;
  }

  overlayEl.style.display = 'flex';
  overlayEl.innerHTML = `
    <div class="modal-box">
      <h3>Activate: ${label}</h3>
      <p>Select your target — this costs $0 PT.</p>
      ${bodyHtml}
      <div class="modal-actions"><button type="button" class="modal-cancel-btn" id="banked-token-cancel-btn">Cancel</button></div>
    </div>
  `;

  overlayEl.querySelectorAll('.agent-card-clickable[data-target-agent-instance-id]').forEach((el) => {
    el.addEventListener('click', () => {
      dispatchDeployBankedToken(tokenType, { targetAgentInstanceId: el.dataset.targetAgentInstanceId });
    });
  });
  overlayEl.querySelectorAll('.agent-card-clickable[data-target-catalog-id]').forEach((el) => {
    el.addEventListener('click', () => {
      dispatchDeployBankedToken(tokenType, { targetCatalogId: el.dataset.targetCatalogId });
    });
  });
  overlayEl.querySelectorAll('[data-target-catalog-id-action]').forEach((el) => {
    el.addEventListener('click', () => {
      dispatchDeployBankedToken(tokenType, { mode: 'acquire_from_open_market', targetCatalogId: el.dataset.targetCatalogIdAction });
    });
  });
  overlayEl.querySelectorAll('[data-play-from-hand-instance-id]').forEach((el) => {
    el.addEventListener('click', () => {
      dispatchDeployBankedToken(tokenType, { mode: 'play', cardInstanceId: el.dataset.playFromHandInstanceId });
    });
  });
  const cancelBtn = overlayEl.querySelector('#banked-token-cancel-btn');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => {
      overlayEl.style.display = 'none';
      overlayEl.innerHTML = '';
      render();
    });
  }
}

/**
 * buildStartCardChoiceBodyHtml(modal, playerDash)
 * Real, clickable UI for all 5 Start family (S1/S2/S3/S5/S6) choiceTypes
 * — the confirmed critical fix: these previously had zero UI handling
 * and fell through to the generic "pending choice" fallback with no way
 * to actually act.
 */
function buildStartCardChoiceBodyHtml(modal, playerDash, vm) {
  const TRACK_LABELS = { training: 'Training', technology: 'Technology', recognition: 'Recognition' };

  if (modal.choiceType === 'S2_TRIPLE_TRACK_BOOST' || modal.choiceType === 'S3_DOUBLE_TRACK_BOOST') {
    const required = modal.requiredCount || (modal.choiceType === 'S2_TRIPLE_TRACK_BOOST' ? 3 : 2);
    return `
      <p class="modal-acquire-label">Click a track below, one click per point (select ${required} total — repeats allowed).</p>
      <div class="track-boost-picker" id="track-boost-picker" data-required="${required}">
        ${Object.keys(TRACK_LABELS)
          .map((t) => `<button type="button" class="track-boost-btn" data-track="${t}">${TRACK_LABELS[t]} <span class="track-boost-count" data-track-count="${t}">0</span></button>`)
          .join('')}
      </div>
      <div class="modal-actions"><button type="button" class="modal-skip-btn" id="track-boost-confirm-btn" disabled>Confirm</button></div>
    `;
  }

  if (
    modal.choiceType === 'S5_HIRE_COACH_TARGET' ||
    modal.choiceType === 'GRW013_COACH_TARGET' ||
    modal.choiceType === 'GRW015_COACH_TARGET' ||
    modal.choiceType === 'GRW031_COACH_TARGET' ||
    modal.choiceType === 'GRW022_LOYALTY_TARGET' ||
    modal.choiceType === 'GRW041_COACH_TARGET' ||
    modal.choiceType === 'GRW044_LOYALTY_AND_COACH_TARGET' ||
    modal.choiceType === 'GRW048_LOYALTY_TARGET' ||
    modal.choiceType === 'GRW050_LOYALTY_TARGET' ||
    modal.choiceType === 'GRW054_LOYALTY_TARGET' ||
    modal.choiceType === 'GRW055_DOUBLE_COACH_TARGET' ||
    modal.choiceType === 'GRW057_COACH_TARGET' ||
    modal.choiceType === 'GRW061_COACH_TARGET' ||
    modal.choiceType === 'STR070_PROTECT_TARGET' ||
    modal.choiceType === 'STR072_PROTECT_TARGET' ||
    modal.choiceType === 'STR079_PROTECT_TARGET'
  ) {
    const candidates = (playerDash.roster && playerDash.roster.agents ? playerDash.roster.agents : []).filter((a) => a.resolved === true || a.isPlaceholder === false);
    if (candidates.length === 0) {
      return '<p class="empty-hand-message">No eligible Agent on your own roster — this effect will be skipped.</p><div class="modal-actions"><button type="button" class="modal-skip-btn" id="start-card-skip-btn">Skip</button></div>';
    }
    return `<div class="agent-candidate-grid">${candidates
      .map((a) => buildAgentCardHtml(a, { clickable: true, dataAttr: `data-target-agent-instance-id="${a.agentInstanceId}"`, tooltip: a.name }))
      .join('')}</div>`;
  }

  if (modal.choiceType === 'GRW037_SINGLE_TRACK_CHOICE' || modal.choiceType === 'STR078_SPACE_TRACK_CHOICE') {
    return `
      <p class="modal-acquire-label">${modal.choiceType === 'STR078_SPACE_TRACK_CHOICE' ? 'Click one Operations Hub space to block all placements on it this round.' : 'Click one track to raise it by 3.'}</p>
      <div class="track-boost-picker" id="grw037-track-picker">
        ${Object.keys(TRACK_LABELS)
          .map((t) => `<button type="button" class="track-boost-btn" data-single-track="${t}">${TRACK_LABELS[t]}</button>`)
          .join('')}
      </div>
    `;
  }

  if (modal.choiceType === 'GRW039_RECRUIT_OR_FIRE') {
    const candidates = modal.agentCandidateCatalogIds || [];
    if (candidates.length === 0) {
      return '<p class="empty-hand-message">The Agent deck was empty — this effect resolves with nothing recruited.</p>';
    }
    return `<div class="agent-candidate-grid">${candidates
      .map((a) => {
        const fullAgent = catalog.agentCards[a.catalogId];
        const enriched = fullAgent ? { ...fullAgent, agentInstanceId: a.catalogId, resolved: true } : { resolved: false };
        return buildAgentCardHtml(enriched, { clickable: true, dataAttr: `data-recruit-catalog-id="${a.catalogId}"`, tooltip: (fullAgent && fullAgent.name) || a.name || a.catalogId });
      })
      .join('')}</div>`;
  }

  if (
    modal.choiceType === 'GRW004_RECRUIT_TARGET' ||
    modal.choiceType === 'GRW010_RECRUIT_TARGET' ||
    modal.choiceType === 'GRW051_MARKET_TARGET' ||
    modal.choiceType === 'GRW056_RECRUIT_TARGET_1' ||
    modal.choiceType === 'GRW056_RECRUIT_TARGET_2' ||
    modal.choiceType === 'GRW059_RECRUIT_TARGET'
  ) {
    const allAgents = (vm && vm.board && vm.board.openMarketAgents ? vm.board.openMarketAgents : []).filter((a) => a.resolved === true || a.isPlaceholder === false);
    const candidates = modal.choiceType === 'GRW004_RECRUIT_TARGET' ? allAgents.filter((a) => typeof a.recognition === 'number' && a.recognition < 5) : allAgents;
    if (candidates.length === 0) {
      return '<p class="empty-hand-message">No eligible Agent currently in the Open Market — this effect will be skipped.</p><div class="modal-actions"><button type="button" class="modal-skip-btn" id="start-card-skip-btn">Skip</button></div>';
    }
    return `<div class="agent-candidate-grid">${candidates
      .map((a) => buildAgentCardHtml(a, { clickable: true, dataAttr: `data-target-catalog-id="${a.catalogId}"`, tooltip: a.name }))
      .join('')}</div>`;
  }

  if (modal.choiceType === 'STR074_RIVAL_TARGET' || modal.choiceType === 'STR080_RIVAL_TARGET') {
    const rivals = Object.keys(vm.players)
      .filter((pid) => pid !== modal.sourcePlayerId)
      .map((pid) => vm.players[pid]);
    if (rivals.length === 0) {
      return '<p class="empty-hand-message">No rival players found — this effect will be skipped.</p>';
    }
    return `<div class="agent-candidate-grid">${rivals
      .map((p) => `<div class="agent-card agent-card-clickable" data-rival-only-player-id="${p.playerId}" title="${escapeAttr(p.displayName)}"><div class="agent-card-name">${p.displayName}</div></div>`)
      .join('')}</div>`;
  }

  if (modal.choiceType === 'GRW051_RIVAL_TARGET' || modal.choiceType === 'GRW052_RIVAL_TARGET') {
    const rivalGroups = Object.keys(vm.players)
      .filter((pid) => pid !== modal.sourcePlayerId)
      .map((pid) => {
        const rivalRoster = (vm.players[pid].roster || []).filter(
          (a) =>
            (a.resolved === true || a.isPlaceholder === false) &&
            !a.isVoided &&
            !(a.onboardingToken && a.onboardingToken.active) &&
            !(a.loyaltyToken && a.loyaltyToken.active) &&
            (modal.choiceType !== 'GRW051_RIVAL_TARGET' || (typeof a.totalProfit === 'number' && a.totalProfit <= 5))
        );
        return { pid, displayName: vm.players[pid].displayName, agents: rivalRoster };
      })
      .filter((g) => g.agents.length > 0);

    if (rivalGroups.length === 0) {
      return '<p class="empty-hand-message">No eligible rival Agent found — this effect will be skipped.</p><div class="modal-actions"><button type="button" class="modal-skip-btn" id="start-card-skip-btn">Skip</button></div>';
    }
    return rivalGroups
      .map(
        (g) => `
        <p class="modal-acquire-label">${escapeAttr(g.displayName)}'s roster:</p>
        <div class="agent-candidate-grid">${g.agents
          .map((a) => buildAgentCardHtml(a, { clickable: true, dataAttr: `data-rival-player-id="${g.pid}" data-rival-agent-instance-id="${a.agentInstanceId}"`, tooltip: a.name }))
          .join('')}</div>`
      )
      .join('');
  }

  if (modal.choiceType === 'GRW053_KEEP_TWO_CHOICE') {
    const catalogActionCards2 = (catalog && catalog.actionCards) || {};
    const candidateCatalogIds = modal.candidateCatalogIds || [];
    return `
      <p class="modal-acquire-label">Select exactly 2 to keep.</p>
      <div class="modal-hand-cards">
        ${candidateCatalogIds
          .map((catalogId, i) => `<label class="master-algorithm-card-option"><input type="checkbox" class="grw053-keep-checkbox" value="${catalogId}" data-index="${i}" /> ${escapeAttr((catalogActionCards2[catalogId] && catalogActionCards2[catalogId].name) || catalogId)}</label>`)
          .join('')}
      </div>
      <div class="modal-actions"><button type="button" class="modal-skip-btn" id="grw053-confirm-btn" disabled>Confirm</button></div>
    `;
  }

  if (modal.choiceType === 'GRW007_PLAY_OR_FIRE') {
    const candidateCatalogIds = modal.candidateCatalogIds || [];
    if (candidateCatalogIds.length === 0) {
      return '<p class="empty-hand-message">The Open Market was empty — this effect resolves with nothing kept.</p>';
    }
    const catalogActionCards = (catalog && catalog.actionCards) || {};
    return `<div class="modal-hand-cards">${candidateCatalogIds
      .map((catalogId) => {
        const stats = catalogActionCards[catalogId];
        const name = stats ? stats.name : catalogId;
        return `<div class="hand-card hand-card-playable" data-grw007-catalog-id="${catalogId}" title="${escapeAttr(name)}"><div class="hand-card-name">${name}</div><div class="hand-card-cost">Free</div></div>`;
      })
      .join('')}</div>`;
  }

  if (modal.choiceType === 'S6_RECALL_MEEPLES') {
    const candidateIds = modal.candidateMeepleInstanceIds || [];
    if (candidateIds.length === 0) {
      return '<p class="empty-hand-message">No Meeples currently on the board to recall.</p>';
    }
    return `
      <div class="modal-hand-cards">
        ${candidateIds.map((id) => `<label class="master-algorithm-card-option"><input type="checkbox" class="s6-meeple-checkbox" value="${id}" /> Meeple ${escapeAttr(id)}</label>`).join('')}
      </div>
      <div class="modal-actions">
        <button type="button" class="modal-cancel-btn" id="s6-cancel-btn">Cancel — Recall None</button>
        <button type="button" class="modal-skip-btn" id="s6-confirm-btn">Recall Selected</button>
      </div>
    `;
  }

  if (modal.choiceType === 'S1_DISCARD_FOR_TRACKS') {
    const cards = playerDash.hand && playerDash.hand.cards ? playerDash.hand.cards.filter((c) => c.resolved === true || c.isPlaceholder === false) : [];
    if (cards.length === 0) {
      return '<p class="empty-hand-message">No cards in hand to discard — this effect resolves with no tracks raised.</p><div class="modal-actions"><button type="button" class="modal-skip-btn" id="start-card-skip-btn">Continue</button></div>';
    }
    return `
      <p class="modal-acquire-label">Select up to 2 cards to discard.</p>
      <div class="modal-hand-cards">
        ${cards.map((c) => `<label class="master-algorithm-card-option"><input type="checkbox" class="s1-discard-checkbox" value="${c.instanceId}" /> ${c.name}</label>`).join('')}
      </div>
      <p class="modal-acquire-label">For each card discarded, click a track once (in order).</p>
      <div class="track-boost-picker" id="s1-track-picker">
        ${Object.keys(TRACK_LABELS)
          .map((t) => `<button type="button" class="track-boost-btn" data-track="${t}">${TRACK_LABELS[t]} <span class="track-boost-count" data-track-count="${t}">0</span></button>`)
          .join('')}
      </div>
      <div class="modal-actions"><button type="button" class="modal-skip-btn" id="s1-confirm-btn">Confirm</button></div>
    `;
  }

  return '<p class="empty-hand-message">This effect will be skipped.</p>';
}

function wireStartCardChoiceHandlers(choiceType, requiredCount) {
  if (choiceType === 'S2_TRIPLE_TRACK_BOOST' || choiceType === 'S3_DOUBLE_TRACK_BOOST') {
    const required = requiredCount || (choiceType === 'S2_TRIPLE_TRACK_BOOST' ? 3 : 2);
    const picker = document.getElementById('track-boost-picker');
    const confirmBtn = document.getElementById('track-boost-confirm-btn');
    const counts = { training: 0, technology: 0, recognition: 0 };
    picker.querySelectorAll('.track-boost-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const total = Object.values(counts).reduce((a, b) => a + b, 0);
        if (total >= required) return;
        counts[btn.dataset.track] += 1;
        picker.querySelector(`[data-track-count="${btn.dataset.track}"]`).textContent = counts[btn.dataset.track];
        const newTotal = Object.values(counts).reduce((a, b) => a + b, 0);
        confirmBtn.disabled = newTotal < required;
      });
    });
    confirmBtn.addEventListener('click', () => {
      const trackChoices = [];
      Object.keys(counts).forEach((t) => {
        for (let i = 0; i < counts[t]; i += 1) trackChoices.push(t);
      });
      handleStartCardChoice({ trackChoices });
    });
  } else if (
    choiceType === 'S5_HIRE_COACH_TARGET' ||
    choiceType === 'GRW013_COACH_TARGET' ||
    choiceType === 'GRW015_COACH_TARGET' ||
    choiceType === 'GRW031_COACH_TARGET' ||
    choiceType === 'GRW022_LOYALTY_TARGET' ||
    choiceType === 'GRW041_COACH_TARGET' ||
    choiceType === 'GRW044_LOYALTY_AND_COACH_TARGET' ||
    choiceType === 'GRW048_LOYALTY_TARGET' ||
    choiceType === 'GRW050_LOYALTY_TARGET' ||
    choiceType === 'GRW054_LOYALTY_TARGET' ||
    choiceType === 'GRW055_DOUBLE_COACH_TARGET' ||
    choiceType === 'GRW057_COACH_TARGET' ||
    choiceType === 'GRW061_COACH_TARGET' ||
    choiceType === 'STR070_PROTECT_TARGET' ||
    choiceType === 'STR072_PROTECT_TARGET' ||
    choiceType === 'STR079_PROTECT_TARGET'
  ) {
    document.querySelectorAll('.agent-card-clickable[data-target-agent-instance-id]').forEach((el) => {
      el.addEventListener('click', () => handleStartCardChoice({ targetAgentInstanceId: el.dataset.targetAgentInstanceId }));
    });
    const skipBtn = document.getElementById('start-card-skip-btn');
    if (skipBtn) skipBtn.addEventListener('click', () => handleStartCardChoice({ targetAgentInstanceId: null }));
  } else if (choiceType === 'GRW037_SINGLE_TRACK_CHOICE' || choiceType === 'STR078_SPACE_TRACK_CHOICE') {
    document.querySelectorAll('.track-boost-btn[data-single-track]').forEach((el) => {
      el.addEventListener('click', () => handleStartCardChoice({ trackChoice: el.dataset.singleTrack }));
    });
  } else if (choiceType === 'STR074_RIVAL_TARGET' || choiceType === 'STR080_RIVAL_TARGET') {
    document.querySelectorAll('.agent-card-clickable[data-rival-only-player-id]').forEach((el) => {
      el.addEventListener('click', () => handleStartCardChoice({ targetPlayerId: el.dataset.rivalOnlyPlayerId }));
    });
  } else if (choiceType === 'GRW039_RECRUIT_OR_FIRE') {
    document.querySelectorAll('.agent-card-clickable[data-recruit-catalog-id]').forEach((el) => {
      el.addEventListener('click', () => handleStartCardChoice({ recruitedCatalogId: el.dataset.recruitCatalogId }));
    });
  } else if (
    choiceType === 'GRW004_RECRUIT_TARGET' ||
    choiceType === 'GRW010_RECRUIT_TARGET' ||
    choiceType === 'GRW051_MARKET_TARGET' ||
    choiceType === 'GRW056_RECRUIT_TARGET_1' ||
    choiceType === 'GRW056_RECRUIT_TARGET_2' ||
    choiceType === 'GRW059_RECRUIT_TARGET'
  ) {
    document.querySelectorAll('.agent-card-clickable[data-target-catalog-id]').forEach((el) => {
      el.addEventListener('click', () => {
        if (choiceType === 'GRW051_MARKET_TARGET') {
          handleStartCardChoice({ stage: 'market', targetCatalogId: el.dataset.targetCatalogId });
        } else if (choiceType === 'GRW056_RECRUIT_TARGET_1') {
          handleStartCardChoice({ stage: 'first', targetCatalogId: el.dataset.targetCatalogId });
        } else if (choiceType === 'GRW056_RECRUIT_TARGET_2') {
          handleStartCardChoice({ stage: 'second', targetCatalogId: el.dataset.targetCatalogId });
        } else {
          handleStartCardChoice({ targetCatalogId: el.dataset.targetCatalogId });
        }
      });
    });
    const skipBtn = document.getElementById('start-card-skip-btn');
    if (skipBtn) {
      skipBtn.addEventListener('click', () => {
        if (choiceType === 'GRW051_MARKET_TARGET') handleStartCardChoice({ stage: 'market', targetCatalogId: null });
        else if (choiceType === 'GRW056_RECRUIT_TARGET_1') handleStartCardChoice({ stage: 'first', targetCatalogId: null });
        else if (choiceType === 'GRW056_RECRUIT_TARGET_2') handleStartCardChoice({ stage: 'second', targetCatalogId: null });
        else handleStartCardChoice({ targetCatalogId: null });
      });
    }
  } else if (choiceType === 'GRW051_RIVAL_TARGET' || choiceType === 'GRW052_RIVAL_TARGET') {
    document.querySelectorAll('.agent-card-clickable[data-rival-agent-instance-id]').forEach((el) => {
      el.addEventListener('click', () => {
        handleStartCardChoice({ targetPlayerId: el.dataset.rivalPlayerId, targetAgentInstanceId: el.dataset.rivalAgentInstanceId });
      });
    });
    const skipBtn = document.getElementById('start-card-skip-btn');
    if (skipBtn) skipBtn.addEventListener('click', () => handleStartCardChoice({ targetPlayerId: null, targetAgentInstanceId: null }));
  } else if (choiceType === 'GRW053_KEEP_TWO_CHOICE') {
    const checkboxes = document.querySelectorAll('.grw053-keep-checkbox');
    const confirmBtn = document.getElementById('grw053-confirm-btn');
    const candidateCatalogIds = Array.from(checkboxes).map((el) => el.value);
    checkboxes.forEach((el) => {
      el.addEventListener('change', () => {
        const checkedCount = Array.from(checkboxes).filter((c) => c.checked).length;
        confirmBtn.disabled = checkedCount !== 2;
      });
    });
    confirmBtn.addEventListener('click', () => {
      const keptCatalogIds = Array.from(checkboxes)
        .filter((c) => c.checked)
        .map((c) => c.value);
      handleStartCardChoice({ keptCatalogIds, candidateCatalogIds });
    });
  } else if (choiceType === 'GRW007_PLAY_OR_FIRE') {
    const overlayEl = document.getElementById('interrupt-overlay');
    const candidateCatalogIds = Array.from(document.querySelectorAll('[data-grw007-catalog-id]')).map((el) => el.dataset.grw007CatalogId);
    document.querySelectorAll('[data-grw007-catalog-id]').forEach((el) => {
      el.addEventListener('click', () => {
        handleStartCardChoice({ keptCatalogId: el.dataset.grw007CatalogId, candidateCatalogIds });
      });
    });
  } else if (choiceType === 'S6_RECALL_MEEPLES') {
    const confirmBtn = document.getElementById('s6-confirm-btn');
    if (confirmBtn) {
      confirmBtn.addEventListener('click', () => {
        const meepleInstanceIds = Array.from(document.querySelectorAll('.s6-meeple-checkbox:checked')).map((el) => el.value);
        handleStartCardChoice({ meepleInstanceIds });
      });
    }
    const cancelBtn = document.getElementById('s6-cancel-btn');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => handleStartCardChoice({ meepleInstanceIds: [] }));
    }
  } else if (choiceType === 'S1_DISCARD_FOR_TRACKS') {
    const skipBtn = document.getElementById('start-card-skip-btn');
    if (skipBtn) {
      skipBtn.addEventListener('click', () => handleStartCardChoice({ discardInstanceIds: [], trackChoices: [] }));
      return;
    }
    const picker = document.getElementById('s1-track-picker');
    const counts = { training: 0, technology: 0, recognition: 0 };
    picker.querySelectorAll('.track-boost-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const total = Object.values(counts).reduce((a, b) => a + b, 0);
        if (total >= 2) return;
        counts[btn.dataset.track] += 1;
        picker.querySelector(`[data-track-count="${btn.dataset.track}"]`).textContent = counts[btn.dataset.track];
      });
    });
    document.getElementById('s1-confirm-btn').addEventListener('click', () => {
      const discardInstanceIds = Array.from(document.querySelectorAll('.s1-discard-checkbox:checked')).map((el) => el.value);
      const trackChoices = [];
      Object.keys(counts).forEach((t) => {
        for (let i = 0; i < counts[t]; i += 1) trackChoices.push(t);
      });
      handleStartCardChoice({ discardInstanceIds, trackChoices: trackChoices.slice(0, discardInstanceIds.length) });
    });
  }
}

function handleDualTrackChoice(trackA, trackB) {
  dismissedInterruptKey = null;
  logLine('');
  showToast('');

  const TRACK_LABELS = { training: 'Training', technology: 'Technology', recognition: 'Recognition' };

  const result = BrokerBossEngine.executeUserAction(state, {
    type: 'RESOLVE_DUAL_TRACK_CHOICE',
    playerId: HUMAN_PLAYER_ID,
    trackA,
    trackB,
  });

  if (result.error) {
    logLine(`2x Combo choice rejected: ${result.error}`);
  } else {
    showToast(
      trackA === trackB
        ? `2x Combo: ${TRACK_LABELS[trackA]} advanced by 2.`
        : `2x Combo: ${TRACK_LABELS[trackA]} and ${TRACK_LABELS[trackB]} each advanced by 1.`
    );
  }
  state = result.state;
  render();
}

function handleDeficitTrackChoice(chosenTrack) {
  dismissedInterruptKey = null;
  logLine('');
  showToast('');

  const TRACK_LABELS = { training: 'Training', technology: 'Technology', recognition: 'Recognition' };
  const result = BrokerBossEngine.executeUserAction(state, {
    type: 'RESOLVE_DEFICIT_TRACK_CHOICE',
    playerId: HUMAN_PLAYER_ID,
    chosenTrack,
  });

  if (result.error) {
    logLine(`Deficit choice rejected: ${result.error}`);
  } else {
    showToast(`Insolvency: ${TRACK_LABELS[chosenTrack]} drops by 1 space to cover the deficit.`);
  }
  state = result.state;
  render();
}

function handleTrackBranchChoice(trackName, chosenBranch) {
  dismissedInterruptKey = null;
  logLine('');
  showToast('');

  const abilityName = TECH_TRACK_ABILITY_CATALOG[trackName][chosenBranch][5].name;
  const result = BrokerBossEngine.executeUserAction(state, {
    type: 'RESOLVE_TRACK_BRANCH_CHOICE',
    playerId: HUMAN_PLAYER_ID,
    trackName,
    chosenBranch,
  });

  if (result.error) {
    logLine(`Branch choice rejected: ${result.error}`);
  } else {
    showToast(`${trackName[0].toUpperCase()}${trackName.slice(1)}: permanently committed to Path ${chosenBranch} (${abilityName}).`);
  }
  state = result.state;
  render();
}

function handleTrackMilestoneChoice(milestoneKey, options) {
  dismissedInterruptKey = null;
  logLine('');
  showToast('');

  const abilityName = MILESTONE_KEY_TO_ABILITY_NAME[milestoneKey] || milestoneKey;
  const result = BrokerBossEngine.executeUserAction(state, {
    type: 'RESOLVE_TRACK_MILESTONE_CHOICE',
    playerId: HUMAN_PLAYER_ID,
    options,
  });

  if (result.error) {
    logLine(`${abilityName} could not resolve: ${result.error}`);
    showToast(`${abilityName} forfeited — ${result.error}`);
  } else {
    showToast(`${abilityName} resolved.`);
  }
  svsStage = null;
  state = result.state;
  render();
}

function handleForfeitTrackMilestone(milestoneKey) {
  dismissedInterruptKey = null;
  logLine('');
  showToast('');

  const abilityName = MILESTONE_KEY_TO_ABILITY_NAME[milestoneKey] || milestoneKey;
  const result = BrokerBossEngine.executeUserAction(state, {
    type: 'FORFEIT_TRACK_MILESTONE',
    playerId: HUMAN_PLAYER_ID,
  });

  if (result.error) {
    logLine(`Forfeit rejected: ${result.error}`);
  } else {
    showToast(`${abilityName} forfeited.`);
  }
  state = result.state;
  render();
}

/**
 * buildMilestoneChoiceBodyHtml(milestoneKey, vm, playerDash)
 * Real, workable UI for all 7 targeted L7/9 milestones. Reuses already-
 * resolved roster/agent data from the view model rather than fabricating
 * anything — where the ability targets a specific opponent Agent, the
 * real roster list is shown; where it targets a board space, the real
 * occupied spaces are listed.
 */
function buildMilestoneChoiceBodyHtml(milestoneKey, vm, playerDash, dashboards) {
  if (milestoneKey === 'POISON_PILL' || milestoneKey === 'HOSTILE_BUYOUT') {
    const targets = [];
    Object.keys(dashboards).forEach((pid) => {
      if (pid === HUMAN_PLAYER_ID) return;
      dashboards[pid].roster.agents.forEach((agent) => {
        if (!(agent.resolved === true || agent.isPlaceholder === false)) return;
        const blocked = milestoneKey === 'POISON_PILL' ? agent.hasOnboardingToken || agent.hasLoyaltyToken : agent.hasLoyaltyToken;
        if (blocked) return;
        targets.push({ ...agent, ownerPlayerId: pid, ownerDisplayName: dashboards[pid].displayName });
      });
    });
    if (targets.length === 0) {
      return '<p class="empty-hand-message">No legal target exists — this milestone will be forfeited.</p>';
    }
    return `<div class="agent-candidate-grid">${targets
      .map(
        (a) =>
          `<div class="agent-candidate-with-owner" data-target-player-id="${a.ownerPlayerId}">
            ${buildAgentCardHtml(a, { clickable: true, dataAttr: `data-target-player-id="${a.ownerPlayerId}" data-target-agent-instance-id="${a.agentInstanceId}"`, tooltip: `${a.name} — ${a.ownerDisplayName}` })}
            <div class="agent-owner-label">${escapeAttr(a.ownerDisplayName)}</div>
          </div>`
      )
      .join('')}</div>`;
  }

  if (milestoneKey === 'IRONCLAD_CONTRACT') {
    const targets = (playerDash.roster.agents || []).filter((a) => (a.resolved === true || a.isPlaceholder === false) && !a.hasLoyaltyToken);
    if (targets.length === 0) {
      return '<p class="empty-hand-message">No eligible Agent on your own roster — this milestone will be forfeited.</p>';
    }
    return `<div class="agent-candidate-grid">${targets
      .map((a) => buildAgentCardHtml(a, { clickable: true, dataAttr: `data-target-agent-instance-id="${a.agentInstanceId}"`, tooltip: a.name }))
      .join('')}</div>`;
  }

  if (milestoneKey === 'SIGNAL_JAMMER') {
    const eligible = [];
    Object.values(vm.board.hubs || {}).forEach((spaces) => {
      spaces.forEach((s) => {
        if (s.status !== 'blocked') eligible.push(s);
      });
    });
    if (eligible.length === 0) {
      return '<p class="empty-hand-message">No real action space available to lock — this milestone will be forfeited.</p>';
    }
    return `<div class="milestone-target-list">${eligible
      .map((s) => `<button type="button" class="milestone-target-btn" data-target-space-id="${s.spaceId}">${s.spaceId.replace(/_/g, ' ')}${s.occupiedBy && s.occupiedBy.length > 0 ? ' (occupied)' : ''}</button>`)
      .join('')}</div>`;
  }

  if (milestoneKey === 'HEADHUNTER' || milestoneKey === 'SILICON_VALLEY_SWEEP') {
    // FIX: the engine's own handler already accepts playCatalogId/
    // keepCatalogId as real parameters — it only ever defaulted to
    // "keep the first card" because this UI never sent them. Since
    // personalDrawPile is a plain, deterministic array of catalogIds
    // already visible on the raw state, the client can safely preview
    // exactly what the engine will draw (nothing else can reorder it
    // between this preview and the real submit) and let the player
    // make a genuine, informed choice instead of an automatic default.
    const drawCount = milestoneKey === 'SILICON_VALLEY_SWEEP' ? 4 : 1;
    const rawPlayer = state.players[HUMAN_PLAYER_ID];
    const previewIds = (rawPlayer.hand.personalDrawPile || []).slice(0, drawCount);
    if (previewIds.length === 0) {
      return '<p class="empty-hand-message">Your personal draw pile is empty — this milestone will be forfeited.</p>';
    }
    const previewCards = previewIds.map((catalogId, i) => {
      const entry = catalog.actionCards[catalogId];
      return {
        instanceId: `svs-preview-${i}`,
        catalogId,
        name: entry ? entry.name : null,
        cost: entry ? entry.cost : null,
        cardImage: entry ? entry.cardImage : null,
        description: entry ? entry.description : null,
        playRequirement: entry ? entry.playRequirement : null,
        resolved: !!entry,
      };
    });

    if (milestoneKey === 'HEADHUNTER') {
      // Only 1 card is ever drawn for Headhunter — no play/keep staging
      // needed, just confirm or skip.
      return `<p class="modal-acquire-label">Headhunter draws this card from the top of your personal deck:</p>
        <div class="modal-hand-cards">${buildHandCardHtml(previewCards[0], playerDash, false)}</div>
        <div class="modal-actions"><button class="modal-skip-btn" id="milestone-auto-resolve-btn">Keep This Card</button></div>`;
    }

    // SILICON_VALLEY_SWEEP: two-stage — pick 1 to play free (or skip),
    // then pick 1 of the remaining 3 to keep. The 2 not chosen are
    // implicitly discarded, matching the engine's own real logic.
    if (!svsStage || svsStage.stage === 'play') {
      return `<p class="modal-acquire-label">Silicon Valley Sweep draws these 4 cards. Pick 1 to play for free (ignoring all costs/requirements), or skip straight to keeping one.</p>
        <div class="modal-hand-cards svs-card-grid">${previewCards
          .map((c) => `<div class="svs-card-option" data-catalog-id="${c.catalogId}">${buildHandCardHtml(c, playerDash, false)}<button type="button" class="svs-play-btn" data-catalog-id="${c.catalogId}">Play Free</button></div>`)
          .join('')}</div>
        <div class="modal-actions"><button class="modal-skip-btn" id="svs-skip-play-btn">Skip — don't play any</button></div>`;
    }

    const remainingAfterPlay = svsStage.playCatalogId
      ? (() => {
          const idx = previewCards.findIndex((c) => c.catalogId === svsStage.playCatalogId);
          const copy = [...previewCards];
          if (idx !== -1) copy.splice(idx, 1);
          return copy;
        })()
      : previewCards;
    return `<p class="modal-acquire-label">Pick 1 card to keep — the other ${remainingAfterPlay.length - 1} will be discarded.</p>
      <div class="modal-hand-cards svs-card-grid">${remainingAfterPlay
        .map((c) => `<div class="svs-card-option" data-catalog-id="${c.catalogId}">${buildHandCardHtml(c, playerDash, false)}<button type="button" class="svs-keep-btn" data-catalog-id="${c.catalogId}">Keep This</button></div>`)
        .join('')}</div>`;
  }

  if (milestoneKey === 'MASTER_ALGORITHM') {
    const cards = playerDash && playerDash.hand ? playerDash.hand.cards.filter((c) => c.resolved === true || c.isPlaceholder === false) : [];
    if (cards.length < 2) {
      return '<p class="empty-hand-message">Fewer than 2 real cards in hand — this milestone will be forfeited.</p>';
    }
    return `<p class="modal-acquire-label">Select at least 2 cards to trash (2 = +1 space, 4 = +2 spaces, 7 = +3 spaces).</p>
      <div class="modal-hand-cards master-algorithm-card-grid">${cards
        .map((c) => `<div class="master-algorithm-card-option" data-instance-id="${c.instanceId}">${buildHandCardHtml(c, playerDash, false)}<div class="master-algorithm-select-badge">✓</div></div>`)
        .join('')}</div>
      <div class="modal-actions"><button class="modal-skip-btn" id="master-algorithm-confirm-btn" disabled>Trash Selected</button></div>`;
  }

  return '<p class="empty-hand-message">This milestone will be forfeited.</p>';
}

function wireMilestoneChoiceHandlers(milestoneKey) {
  if (milestoneKey === 'POISON_PILL' || milestoneKey === 'HOSTILE_BUYOUT') {
    document.querySelectorAll('.agent-card-clickable[data-target-agent-instance-id]').forEach((el) => {
      el.addEventListener('click', () => {
        handleTrackMilestoneChoice(milestoneKey, {
          targetPlayerId: el.dataset.targetPlayerId,
          targetAgentInstanceId: el.dataset.targetAgentInstanceId,
        });
      });
    });
  } else if (milestoneKey === 'IRONCLAD_CONTRACT') {
    document.querySelectorAll('.agent-card-clickable[data-target-agent-instance-id]').forEach((el) => {
      el.addEventListener('click', () => {
        handleTrackMilestoneChoice(milestoneKey, { targetAgentInstanceId: el.dataset.targetAgentInstanceId });
      });
    });
  } else if (milestoneKey === 'SIGNAL_JAMMER') {
    document.querySelectorAll('.milestone-target-btn[data-target-space-id]').forEach((el) => {
      el.addEventListener('click', () => handleTrackMilestoneChoice(milestoneKey, { targetSpaceId: el.dataset.targetSpaceId }));
    });
  } else if (milestoneKey === 'HEADHUNTER' || milestoneKey === 'SILICON_VALLEY_SWEEP') {
    const btn = document.getElementById('milestone-auto-resolve-btn');
    if (btn) btn.addEventListener('click', () => handleTrackMilestoneChoice(milestoneKey, {}));
    document.querySelectorAll('.svs-play-btn[data-catalog-id]').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        svsStage = { stage: 'keep', playCatalogId: el.dataset.catalogId };
        render();
      });
    });
    const skipPlayBtn = document.getElementById('svs-skip-play-btn');
    if (skipPlayBtn) {
      skipPlayBtn.addEventListener('click', () => {
        svsStage = { stage: 'keep', playCatalogId: null };
        render();
      });
    }
    document.querySelectorAll('.svs-keep-btn[data-catalog-id]').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        handleTrackMilestoneChoice(milestoneKey, { playCatalogId: svsStage ? svsStage.playCatalogId : null, keepCatalogId: el.dataset.catalogId });
      });
    });
  } else if (milestoneKey === 'MASTER_ALGORITHM') {
    const options = document.querySelectorAll('.master-algorithm-card-option');
    const confirmBtn = document.getElementById('master-algorithm-confirm-btn');
    options.forEach((opt) => {
      opt.addEventListener('click', () => {
        opt.classList.toggle('master-algorithm-card-selected');
        const checkedCount = document.querySelectorAll('.master-algorithm-card-selected').length;
        confirmBtn.disabled = checkedCount < 2;
      });
    });
    if (confirmBtn) {
      confirmBtn.addEventListener('click', () => {
        const trashInstanceIds = Array.from(document.querySelectorAll('.master-algorithm-card-selected')).map((el) => el.dataset.instanceId);
        handleTrackMilestoneChoice(milestoneKey, { trashInstanceIds });
      });
    }
  }
}

function handleCancelDeferredAction() {
  dismissedInterruptKey = null;
  logLine('');
  showToast('');

  const result = BrokerBossEngine.executeUserAction(state, {
    type: 'CANCEL_DEFERRED_ACTION',
    playerId: HUMAN_PLAYER_ID,
  });

  if (result.error) {
    logLine(`Cancel failed: ${result.error}`);
  } else {
    showToast('Action cancelled — meeple and any cost returned.');
  }
  state = result.state;
  render();
}

function handleInterruptConfirm(selectedInstanceIds) {
  dismissedInterruptKey = null;
  logLine('');
  showToast('');
  const vm = BrokerBossEngine.getUiViewModel(state);
  const result = BrokerBossEngine.executeUserAction(state, {
    type: 'RESOLVE_INTERRUPT',
    interruptViewModel: vm.pendingInterrupt,
    selection: selectedInstanceIds,
  });

  if (result.error) {
    logLine(`Choice rejected: ${result.error}`);
  }
  state = result.state;
  render();
}

// ---------------------------------------------------------------------------
// Rendering — reads the view sync, draws the DOM. No game logic here.

function logLine(text) {
  const el = document.getElementById('status-line');
  el.textContent = text;
}

function showToast(text) {
  const el = document.getElementById('action-toast');
  if (!text) {
    el.style.display = 'none';
    el.textContent = '';
    return;
  }
  el.style.display = 'block';
  el.textContent = text;
}

function showNetworkMagnetBanner(text) {
  const el = document.getElementById('network-magnet-banner');
  if (!text) {
    el.style.display = 'none';
    el.textContent = '';
    return;
  }
  el.style.display = 'block';
  el.textContent = text;
}

// ITEM 5: Shift Track trigger banner. Same "only announce genuinely new
// log entries" pattern as the Network Magnet banner — surfaces a clear,
// explicit notification the moment the Shift Tracker reaches 4 and a
// real card resolves, so players see the shift happened before the
// tracker visually resets to 0.
let lastAnnouncedShiftLogLength = 0;
let lastAnnouncedRoundSummaryRound = null;

// Market Share sprint bonus claim banner — same "only announce genuinely
// new log entries" pattern as the shift trigger / network magnet
// banners. Uses showToast rather than a dedicated banner element since
// the request specifically asks for a toast/banner notification and the
// existing toast infrastructure already fits (display name + a real,
// exact token label).
let lastAnnouncedMarketShareBonusLogLength = 0;

function checkForMarketShareBonusClaimEvents(currentState) {
  const newEntries = currentState.log.slice(lastAnnouncedMarketShareBonusLogLength);
  lastAnnouncedMarketShareBonusLogLength = currentState.log.length;

  const claimEntries = newEntries.filter((e) => e.type === 'MARKET_SHARE_BONUS_CLAIMED');
  if (claimEntries.length === 0) return;

  const entry = claimEntries[claimEntries.length - 1];
  const tokenLabel = SPRINT_BONUS_TOKEN_LABELS[entry.tokenType] || entry.tokenType;
  // BUGFIX: state.players[playerId].displayName is never actually set —
  // only state.session.seats[X].displayName is (confirmed by tracing
  // initialGameState.js directly, a genuine pre-existing gap this
  // surfaced). Same lookup uiStateBridge.js's own getDisplayName uses.
  const seat = state.session && state.session.seats ? state.session.seats.find((s) => s.playerId === entry.playerId) : null;
  const displayName = (seat && seat.displayName) || entry.playerId;
  showToast(`${displayName} claimed Market Share Sprint Bonus: ${tokenLabel}!`);
}

/**
 * checkForTurnChangeNotification(vm)
 * Fires only on a genuine transition — the active player was someone
 * else last render, and is the human player now. Shows a visual
 * banner and flashes the tab title so a player who's looked away
 * (a common real scenario once other players/bots take their turns)
 * notices control has come back to them.
 */
function checkForTurnChangeNotification(vm) {
  const nowActive = vm.meta.activePlayerId;
  const wasActive = previousActivePlayerId;
  previousActivePlayerId = nowActive;

  if (wasActive === nowActive) return; // no transition at all
  if (nowActive !== HUMAN_PLAYER_ID) return; // turn changed, but not to the human player
  if (wasActive === null) return; // first render of a fresh game — not a real "it became your turn" moment
  if (vm.meta.phase !== 'WORKER_PLACEMENT') return; // only the actual turn-taking phase; other phases have their own real prompts

  const banner = document.getElementById('your-turn-banner');
  banner.style.display = 'flex';
  banner.classList.add('your-turn-banner-visible');
  clearTimeout(window.__yourTurnBannerTimer);
  window.__yourTurnBannerTimer = setTimeout(() => {
    banner.classList.remove('your-turn-banner-visible');
    setTimeout(() => { banner.style.display = 'none'; }, 400); // allow the fade-out transition to finish before hiding
  }, 3000);

  // Tab title flash — stops as soon as the player actually looks,
  // rather than flashing forever after they've already noticed.
  if (document.hidden || !document.hasFocus()) {
    let showingFlash = false;
    clearInterval(titleFlashInterval);
    titleFlashInterval = setInterval(() => {
      document.title = showingFlash ? ORIGINAL_DOCUMENT_TITLE : "🔔 YOUR TURN — Broker Boss";
      showingFlash = !showingFlash;
    }, 1000);
    const stopFlash = () => {
      clearInterval(titleFlashInterval);
      document.title = ORIGINAL_DOCUMENT_TITLE;
      window.removeEventListener('focus', stopFlash);
    };
    window.addEventListener('focus', stopFlash);
    // Safety cap: stop after 30s regardless, in case focus never fires
    // for some reason (closed tab, browser quirk) — don't flash forever.
    setTimeout(stopFlash, 30000);
  }
}

/**
 * checkForRoundSummaryEvent(currentState)
 * Fires only on a genuine round advance. Scans the log for the real
 * events the just-completed round's cleanup sweeps actually logged
 * (each stamped with the round it happened in) and builds the summary
 * entirely from that real data — nothing here is fabricated or
 * inferred beyond what the engine itself recorded.
 */
function checkForRoundSummaryEvent(currentState) {
  const currentRound = currentState.phase.round;
  if (lastAnnouncedRoundSummaryRound === null) {
    lastAnnouncedRoundSummaryRound = currentRound;
    return;
  }
  if (currentRound <= lastAnnouncedRoundSummaryRound) return;
  const justFinishedRound = currentRound - 1;
  lastAnnouncedRoundSummaryRound = currentRound;

  const roundEntries = currentState.log.filter((e) => e.round === justFinishedRound);
  const relevantTypes = new Set([
    'HAND_DISCARDED_END_OF_ROUND',
    'HAND_REDRAWN_END_OF_ROUND',
    'OPEN_MARKET_CHURNED',
    'BASE_ROUND_DIVIDEND_PAID',
    'MEEPLE_TAX_PAID',
    'MEEPLE_TAX_DEFAULTED',
  ]);
  const relevant = roundEntries.filter((e) => relevantTypes.has(e.type));
  if (relevant.length === 0) return; // nothing real to summarize (e.g. first round with no prior cleanup)

  renderRoundSummaryModal(justFinishedRound, relevant, currentState);
}

function renderRoundSummaryModal(roundNumber, entries, currentState) {
  const el = document.getElementById('round-summary-modal');
  if (!el) return;
  const displayName = (playerId) => (currentState.players[playerId] && currentState.players[playerId].displayName) || playerId;

  const discardEntries = entries.filter((e) => e.type === 'HAND_DISCARDED_END_OF_ROUND');
  const redrawEntries = entries.filter((e) => e.type === 'HAND_REDRAWN_END_OF_ROUND');
  const marketEntries = entries.filter((e) => e.type === 'OPEN_MARKET_CHURNED');
  const dividendEntry = entries.find((e) => e.type === 'BASE_ROUND_DIVIDEND_PAID');
  const taxPaidEntries = entries.filter((e) => e.type === 'MEEPLE_TAX_PAID');
  const taxDefaultedEntries = entries.filter((e) => e.type === 'MEEPLE_TAX_DEFAULTED');

  const steps = [];

  // Executive Search Hub — no dedicated log event exists for the clear
  // itself (it's a silent state cleanup, not a logged action), so this
  // is shown only as a standing factual note, not claimed as "this
  // round specifically re-opened it" without real evidence either way.
  steps.push({ label: '🔍 Executive Search Hub', detail: 'Clears at the start of every round — open for the first player to claim.' });

  if (discardEntries.length > 0 || redrawEntries.length > 0) {
    const lines = redrawEntries.map((e) => {
      const discard = discardEntries.find((d) => d.playerId === e.playerId);
      const discardedCount = discard ? discard.discardedInstanceIds.length : 0;
      return `${escapeAttr(displayName(e.playerId))}: discarded ${discardedCount}, drew ${e.drawnCount}${e.reshuffleOccurred ? ' (deck reshuffled)' : ''}`;
    });
    steps.push({ label: '🗂️ Hand Discard & Redraw', detail: lines.join('<br>') || 'No hand changes this round.' });
  }

  if (marketEntries.length > 0) {
    const lines = marketEntries.map((e) => `${e.market === 'actionCards' ? 'Action Card' : 'Agent'} Market: ${e.purgedCount} purged & replaced`);
    steps.push({ label: '🏪 Market Purge & Refill', detail: lines.join('<br>') });
  }

  if (dividendEntry) {
    steps.push({ label: '💰 Base Round Dividend', detail: `Every player received ${dividendEntry.amount} PT.` });
  }

  if (taxPaidEntries.length > 0 || taxDefaultedEntries.length > 0) {
    const lines = [
      ...taxPaidEntries.map((e) => `${escapeAttr(displayName(e.playerId))}: paid ${e.amount} PT Meeple Tax`),
      ...taxDefaultedEntries.map(
        (e) => `⚠️ ${escapeAttr(displayName(e.playerId))}: could only pay ${e.partialPaymentMade} PT — ${e.meeplesRepossessed.length} unpaid Meeple(s) repossessed`
      ),
    ];
    steps.push({ label: '👷 Meeple Tax (4 PT × Meeples over 3)', detail: lines.join('<br>') });
  } else {
    steps.push({ label: '👷 Meeple Tax', detail: 'No player owed any Meeple Tax this round.' });
  }

  el.innerHTML = `
    <div class="round-summary-box">
      <h3>Round ${roundNumber} Complete</h3>
      <div class="round-summary-steps">
        ${steps.map((s) => `<div class="round-summary-step"><div class="round-summary-step-label">${s.label}</div><div class="round-summary-step-detail">${s.detail}</div></div>`).join('')}
      </div>
      <div class="modal-actions"><button type="button" class="modal-skip-btn" id="round-summary-dismiss-btn">Continue to Round ${roundNumber + 1}</button></div>
    </div>
  `;
  el.style.display = 'flex';
  el.querySelector('#round-summary-dismiss-btn').addEventListener('click', () => {
    el.style.display = 'none';
  });
}

function checkForShiftTriggerEvents(currentState) {
  // SUPERSEDED: Shift Card resolution is now handled entirely by the
  // real, blocking SHIFT_CARD_RESOLUTION interrupt and its full-screen
  // modal (renderShiftCardResolutionModal) — the engine genuinely
  // pauses now, so this auto-dismissing banner would show duplicate,
  // redundant UI for the exact same event. Still advances the log
  // pointer so a later re-enable wouldn't replay a backlog of old
  // entries.
  lastAnnouncedShiftLogLength = currentState.log.length;
  return;
  // eslint-disable-next-line no-unreachable
  const newEntries = currentState.log.slice(lastAnnouncedShiftLogLength);
  lastAnnouncedShiftLogLength = currentState.log.length;

  // BUGFIX: many Shift Cards are still unimplemented and resolve via the
  // generic fallback handler, which logs CARD_EFFECT_NOT_IMPLEMENTED —
  // NOT SHIFT_EFFECT_APPLIED. Confirmed via a real trigger (SFT_020) that
  // this fallback path is common enough that checking only the
  // "implemented" log type silently missed the majority of real shift
  // triggers. Distinguishes a genuine Shift Card fallback from an
  // unrelated Action/Specialist Card fallback by checking whether the
  // catalogId actually exists in the real shift catalog.
  const relevantEntries = newEntries.filter(
    (e) =>
      e.type === 'SHIFT_EFFECT_APPLIED' ||
      e.type === 'SHIFT_EFFECT_BLOCKED_BY_IMMUNITY' ||
      (e.type === 'CARD_EFFECT_NOT_IMPLEMENTED' && catalog.shiftCards && catalog.shiftCards[e.catalogId])
  );
  if (relevantEntries.length === 0) {
    // FIX: this used to unconditionally call showShiftTriggerBanner(null,
    // ...), which force-hides the banner immediately — even when it was
    // showing a real, freshly-triggered card whose own 6-second
    // auto-dismiss timer hadn't expired yet. Since this function runs on
    // every single render() call (any state update, not just this
    // card's own), and the log entries that triggered it only exist
    // once (consumed via lastAnnouncedShiftLogLength above), the very
    // next unrelated render — a bot's turn, any other player's action —
    // was wiping the banner almost instantly. Now does nothing here,
    // letting an already-visible banner run its own lifecycle (timer or
    // the player's own Dismiss click) instead of being interrupted.
    return;
  }

  // All entries from the same trigger share the same catalogId — one
  // real card resolves per trigger, applied once per player.
  const catalogId = relevantEntries[0].catalogId;
  const cardStats = catalog.shiftCards ? catalog.shiftCards[catalogId] : null;
  const cardName = cardStats ? cardStats.name : catalogId;
  const cardDescription = cardStats ? cardStats.description : '';

  showShiftTriggerBanner(catalogId, cardName, cardDescription);
  setActiveShiftCard(catalogId, cardName, cardDescription, cardStats ? cardStats.cardImage : null);
}

/**
 * Active Shift slot — a PERSISTENT display, separate from the 6-second
 * popup above. The popup is a flash notification; this is a standing
 * reference the player can look back at all round. Deliberately not
 * classified per-card as "round-wide vs one-time" (that would mean
 * auditing all 52 Shift Cards' real effects individually) — instead
 * every triggered card is shown here until the round number changes,
 * which covers every actually-round-scoped effect and is a safe,
 * harmless no-op for one-time effects (they just sit there as a
 * reference of "this already happened this round," which the request's
 * own wording — "reference its ongoing actions/consequences" — supports
 * either way).
 */
let activeShiftCard = null;
let activeShiftCardRound = null;

function setActiveShiftCard(catalogId, cardName, cardDescription, cardImage) {
  activeShiftCard = { catalogId, cardName, cardDescription, cardImage };
  activeShiftCardRound = state ? state.phase.round : null;
}

function renderActiveShiftSlot(vm) {
  const boardHubsContainer = document.getElementById('board-hubs');
  if (!boardHubsContainer) return;
  // renderBoard() (which always runs before this in render()'s own call
  // order) does boardHubsContainer.innerHTML = '' — a static HTML element
  // here would be destroyed before this function ever ran. Same reason
  // renderShiftMarkerOverlay creates and appends its own element fresh
  // each render rather than relying on one already in the page.
  const existing = boardHubsContainer.querySelector('.active-shift-slot');
  if (existing) existing.remove();

  if (activeShiftCard && vm.meta.round !== activeShiftCardRound) {
    activeShiftCard = null;
    activeShiftCardRound = null;
  }
  if (!activeShiftCard) return;

  const el = document.createElement('div');
  el.className = 'active-shift-slot active-shift-slot-visible';
  el.innerHTML = `
    <div class="active-shift-label">⚡ Active Shift</div>
    <div class="active-shift-box" title="${escapeAttr(activeShiftCard.cardDescription)}">
      ${buildPortraitHtml(activeShiftCard.cardImage, activeShiftCard.cardName, 'shift-cards')}
      <div class="active-shift-name">${escapeAttr(activeShiftCard.cardName)}</div>
    </div>
  `;
  boardHubsContainer.appendChild(el);
}

function showShiftTriggerBanner(catalogId, cardName, cardDescription) {
  const el = document.getElementById('shift-reveal-modal');
  if (!el) return;
  if (!catalogId) {
    el.classList.remove('shift-reveal-visible');
    return;
  }
  const cardStats = catalog.shiftCards ? catalog.shiftCards[catalogId] : null;
  const cardImage = cardStats ? cardStats.cardImage : null;
  el.innerHTML = `
    <div class="shift-reveal-box">
      <div class="shift-reveal-header">⚡ Market Shift Triggered</div>
      ${buildFullCardImageHtml(
        cardImage,
        'shift-cards',
        `${buildPortraitHtml(null, cardName, 'shift-cards')}
         <div class="shift-reveal-name">${escapeAttr(cardName)}</div>
         <div class="shift-reveal-desc">${escapeAttr(cardDescription)}</div>`
      )}
      <button type="button" class="shift-reveal-dismiss-btn" id="shift-reveal-dismiss-btn">Dismiss</button>
    </div>
  `;
  el.classList.add('shift-reveal-visible');
  el.querySelector('#shift-reveal-dismiss-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    el.classList.remove('shift-reveal-visible');
  });
  // Item 4: clicking anywhere else on the reveal box pins it — cancels
  // the auto-dismiss so the player can read it for as long as they
  // want, same "click for inspection" intent as the card zoom system,
  // just applied to this element's own already-full-detail modal
  // rather than cloning it into a second overlay.
  el.querySelector('.shift-reveal-box').addEventListener('click', () => {
    clearTimeout(shiftRevealAutoDismissTimer);
  });
  clearTimeout(shiftRevealAutoDismissTimer);
  shiftRevealAutoDismissTimer = setTimeout(() => {
    el.classList.remove('shift-reveal-visible');
  }, 6000);
}
let shiftRevealAutoDismissTimer = null;

// ITEM 2: Follower Auto-Recruit Notification. Tracks how much of the log
// has already been announced, so each render only surfaces genuinely NEW
// network-magnet events (Market Pull, Gravitational Poach, refill-time
// auto-recruit, and Follower Flight on poaching) — never re-announcing
// the same event on a later, unrelated render.
let lastAnnouncedLogLength = 0;

const NETWORK_MAGNET_LOG_TYPES = new Set([
  'NETWORK_MARKET_PULL',
  'NETWORK_GRAVITATIONAL_POACH',
  'NETWORK_AUTO_RECRUIT_ON_REFILL',
  'FOLLOWER_FLIGHT',
]);

/**
 * checkForNetworkMagnetEvents(currentState)
 * Scans the real log for any NEW entry matching one of the 4 network-
 * magnet event types, filtered to the human player, and surfaces a clear
 * "why did this agent appear on my roster" banner — real catalog data
 * only (follower + influencer names looked up from the same catalog
 * already loaded at boot), never fabricated.
 */
function checkForNetworkMagnetEvents(currentState) {
  const newEntries = currentState.log.slice(lastAnnouncedLogLength);
  lastAnnouncedLogLength = currentState.log.length;

  const relevantEntries = newEntries.filter(
    (e) => NETWORK_MAGNET_LOG_TYPES.has(e.type) && e.playerId === HUMAN_PLAYER_ID
  );

  if (relevantEntries.length === 0) {
    showNetworkMagnetBanner(null);
    return;
  }

  const messages = relevantEntries.map((e) => {
    const followerStats = catalog.agentCards[e.followerCatalogId];
    const followerName = followerStats ? followerStats.name : e.followerCatalogId;
    const influencerCatalogId = followerStats && followerStats.network ? followerStats.network.influencerCatalogId : null;
    const influencerStats = influencerCatalogId ? catalog.agentCards[influencerCatalogId] : null;
    const influencerName = influencerStats ? influencerStats.name : 'their Influencer';
    return `⚡ Network Magnet: ${followerName} auto-joined your roster to follow ${influencerName}!`;
  });

  showNetworkMagnetBanner(messages.join(' '));
}

function colorSafe(color) {
  const SAFE = ['red', 'blue', 'green', 'gold', 'purple', 'orange'];
  return SAFE.includes(color) ? color : 'grey';
}

function render() {
  const { vm, board, dashboards, overlay } = BrokerBossEngine.buildFullViewSync(state);

  checkForNetworkMagnetEvents(state);
  checkForShiftTriggerEvents(state);
  checkForMarketShareBonusClaimEvents(state);
  checkForTurnChangeNotification(vm);
  checkForRoundSummaryEvent(state);
  renderHeader(vm);
  renderBoard(board, vm);
  renderGlobalMilestones(vm);
  renderAgencyBoard(vm, dashboards[HUMAN_PLAYER_ID]);
  renderActiveShiftSlot(vm);
  renderDashboards(dashboards, vm);
  renderHandDrawer(dashboards[HUMAN_PLAYER_ID], vm);
  renderTableauPanel(dashboards[HUMAN_PLAYER_ID], dashboards);
  renderHistory(overlay.historyTicker);
  if (vm.meta.phase !== 'FINAL_SCORING') {
    renderOverlay(overlay.modal, dashboards[HUMAN_PLAYER_ID], vm.board.openMarketActionCards, vm, dashboards);
    renderClientModal(dashboards[HUMAN_PLAYER_ID], vm);
  }
}

function buildClientModalOverlay() {
  const el = document.createElement('div');
  el.id = 'client-modal-overlay';
  el.className = 'interrupt-overlay';
  el.style.display = 'none';
  document.body.appendChild(el);
  return el;
}
const clientModalOverlay = buildClientModalOverlay();

/**
 * renderClientModal(dash, vm)
 * Epic 3: renders clientModalState-driven modals for abilities that
 * aren't server-side pendingInterrupts — Liquidation Engine and
 * Proprietary Algorithm are free-standing, player-initiated actions,
 * not choices the engine is blocking on. Deliberately on its own
 * dedicated element (not #interrupt-overlay) so it can never conflict
 * with a genuine server interrupt; if one appears while this is open,
 * this modal just closes itself rather than risk stacking or hiding it.
 */
function renderClientModal(dash, vm) {
  if (vm.pendingInterrupt && vm.pendingInterrupt.type !== 'NULL') {
    clientModalState = null;
  }
  if (!clientModalState || !dash) {
    clientModalOverlay.style.display = 'none';
    clientModalOverlay.innerHTML = '';
    return;
  }
  clientModalOverlay.style.display = 'flex';

  if (clientModalState.type === 'LIQUIDATION_ENGINE') {
    const realRoster = (dash.roster.agents || []).filter((a) => !a.isVoided && a.resolved !== false);
    clientModalOverlay.innerHTML = `
      <div class="modal-box">
        <h3>Liquidation Engine</h3>
        <p class="modal-acquire-label">Pick 1 Agent to activate a second time for its Profit payout.</p>
        <div class="agent-candidate-grid">${realRoster
          .map((a) => buildAgentCardHtml(a, { clickable: true, dataAttr: `data-target-agent-instance-id="${a.agentInstanceId}"`, tooltip: a.name }))
          .join('')}</div>
        <div class="modal-actions"><button class="modal-cancel-btn" id="client-modal-cancel-btn">Cancel</button></div>
      </div>
    `;
    clientModalOverlay.querySelectorAll('.agent-card-clickable[data-target-agent-instance-id]').forEach((el) => {
      el.addEventListener('click', () => {
        clientModalState = null;
        const result = BrokerBossEngine.executeUserAction(state, {
          type: 'USE_LIQUIDATION_ENGINE',
          playerId: HUMAN_PLAYER_ID,
          targetAgentInstanceId: el.dataset.targetAgentInstanceId,
        });
        if (result.error) {
          showToast(`Liquidation Engine failed: ${result.error}`);
        } else {
          showToast('Liquidation Engine used — Agent activated a second time.');
        }
        state = result.state;
        render();
      });
    });
  } else if (clientModalState.type === 'PROPRIETARY_ALGORITHM') {
    if (!clientModalState.mode) {
      clientModalOverlay.innerHTML = `
        <div class="modal-box">
          <h3>Proprietary Algorithm</h3>
          <p class="modal-acquire-label">Choose one:</p>
          <div class="modal-actions" style="justify-content: center; gap: 10px;">
            <button class="modal-skip-btn" id="pa-mode-trash">Trash 1 Card → Draw 2</button>
            <button class="modal-skip-btn" id="pa-mode-discard">Discard 1 Card → Gain $2 PT</button>
          </div>
          <div class="modal-actions"><button class="modal-cancel-btn" id="client-modal-cancel-btn">Cancel</button></div>
        </div>
      `;
      const trashBtn = clientModalOverlay.querySelector('#pa-mode-trash');
      if (trashBtn) trashBtn.addEventListener('click', () => { clientModalState = { type: 'PROPRIETARY_ALGORITHM', mode: 'trash_for_draw' }; render(); });
      const discardBtn = clientModalOverlay.querySelector('#pa-mode-discard');
      if (discardBtn) discardBtn.addEventListener('click', () => { clientModalState = { type: 'PROPRIETARY_ALGORITHM', mode: 'discard_for_pt' }; render(); });
    } else {
      const modeLabel = clientModalState.mode === 'trash_for_draw' ? 'trash' : 'discard';
      clientModalOverlay.innerHTML = `
        <div class="modal-box">
          <h3>Proprietary Algorithm</h3>
          <p class="modal-acquire-label">Pick 1 card to ${modeLabel}.</p>
          <div class="modal-hand-cards">${dash.hand.cards
            .map((c) => `<div class="master-algorithm-card-option" data-instance-id="${c.instanceId}">${buildHandCardHtml(c, dash, false)}</div>`)
            .join('')}</div>
          <div class="modal-actions"><button class="modal-cancel-btn" id="client-modal-cancel-btn">Cancel</button></div>
        </div>
      `;
      clientModalOverlay.querySelectorAll('.master-algorithm-card-option').forEach((el) => {
        el.addEventListener('click', () => {
          const mode = clientModalState.mode;
          clientModalState = null;
          const result = BrokerBossEngine.executeUserAction(state, {
            type: 'USE_PROPRIETARY_ALGORITHM',
            playerId: HUMAN_PLAYER_ID,
            mode,
            cardInstanceId: el.dataset.instanceId,
          });
          if (result.error) {
            showToast(`Proprietary Algorithm failed: ${result.error}`);
          } else {
            showToast(mode === 'trash_for_draw' ? 'Card trashed — 2 new cards drawn.' : 'Card discarded — gained $2 PT.');
          }
          state = result.state;
          render();
        });
      });
    }
  }

  const cancelBtn = clientModalOverlay.querySelector('#client-modal-cancel-btn');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => {
      clientModalState = null;
      render();
    });
  }
}

/**
 * renderHandDrawer(humanDash, vm)
 * Item 2: the BGA-style bottom-left hand drawer. Reuses the exact same
 * buildHandCardHtml used by the dashboard's own compact hand display
 * — one real card template, not a second copy that could drift out of
 * sync with what's actually playable/affordable.
 */
function renderHandDrawer(humanDash, vm) {
  const countEl = document.getElementById('hand-drawer-count');
  const drawerEl = document.getElementById('hand-drawer');
  if (!humanDash) return;

  countEl.textContent = humanDash.hand.summary.count;

  const canPlayFromHand =
    vm.pendingInterrupt &&
    vm.pendingInterrupt.type === 'ACTION_SPACE_DEFERRED_CHOICE' &&
    vm.pendingInterrupt.spaceType === 'acquire_or_play_action_card' &&
    vm.pendingInterrupt.sourcePlayerId === HUMAN_PLAYER_ID;

  const cardsHtml = humanDash.hand.cards.map((c) => buildHandCardHtml(c, humanDash, canPlayFromHand)).join('');

  drawerEl.innerHTML = `
    <div class="corner-drawer-header">
      <span>Your Hand — ${humanDash.hand.summary.count}/${humanDash.hand.summary.maxHandSize}</span>
      <button type="button" id="hand-drawer-close-btn" class="corner-drawer-close-btn">✕</button>
    </div>
    <div class="corner-drawer-cards">${cardsHtml || '<div class="corner-drawer-empty">No cards in hand.</div>'}</div>
  `;
  drawerEl.querySelector('#hand-drawer-close-btn').addEventListener('click', () => {
    drawerEl.classList.remove('corner-drawer-open');
  });
}

/**
 * renderTableauPanel(humanDash, dashboards)
 * Item 3: the BGA-style tableau toggle panel — the human player's own
 * recruited Agents, using the same buildAgentCardHtml template already
 * used everywhere else Agents render (Agency Board, dashboard roster).
 */
function renderTableauPanel(humanDash, dashboards) {
  const countEl = document.getElementById('tableau-count');
  const panelEl = document.getElementById('tableau-panel');
  if (!humanDash) return;

  countEl.textContent = humanDash.roster.count;

  const agentsHtml = humanDash.roster.agents
    .map((a) => buildAgentCardHtml(a, { tooltip: buildAgentHoverTooltip(a, dashboards[HUMAN_PLAYER_ID], 0) }))
    .join('');

  panelEl.innerHTML = `
    <div class="corner-drawer-header">
      <span>Your Tableau — ${humanDash.roster.count}/${humanDash.roster.capacity}</span>
      <button type="button" id="tableau-close-btn" class="corner-drawer-close-btn">✕</button>
    </div>
    <div class="corner-drawer-cards corner-drawer-cards-agents">${agentsHtml || '<div class="corner-drawer-empty">No Agents recruited yet.</div>'}</div>
  `;
  panelEl.querySelector('#tableau-close-btn').addEventListener('click', () => {
    panelEl.classList.remove('corner-drawer-open');
  });
}

function renderAgencyBoard(vm, humanDash) {
  const panel = document.getElementById('agency-board');
  const actionCards = vm.board.openMarketActionCards || [];
  const agents = vm.board.openMarketAgents || [];

  if (actionCards.length === 0 && agents.length === 0) {
    panel.innerHTML = '';
    return;
  }

  const catalogActionCards = (catalog && catalog.actionCards) || {};
  const actionCardsHtml = actionCards
    .map((c, i) => {
      const family = !c.isPlaceholder && catalogActionCards[c.catalogId] ? catalogActionCards[c.catalogId].family : null;
      const cardImage = !c.isPlaceholder && catalogActionCards[c.catalogId] ? catalogActionCards[c.catalogId].cardImage : null;
      return `
      <div class="agency-board-cards agency-slot-action agency-slot-action-${i}">
        <div class="hand-card hand-card-market ${c.isPlaceholder ? 'hand-card-placeholder' : ''}" data-family="${family || ''}" data-tooltip="${escapeAttr(buildCardHoverTooltip(c, humanDash))}">
          ${
            c.isPlaceholder
              ? '<div class="hand-card-blank">?</div>'
              : buildFullCardImageHtml(
                  cardImage,
                  'action-cards',
                  `<div class="market-card-family-header">${family || ''}</div>
                   ${buildPortraitHtml(null, c.name, 'action-cards')}
                   <div class="hand-card-name">${c.name}</div>
                   <div class="hand-card-cost">$${c.cost}</div>`
                )
          }
        </div>
      </div>`;
    })
    .join('');

  const agentsHtml = agents
    .map((a, i) => `<div class="agency-board-cards agency-slot-agent agency-slot-agent-${i}">${buildAgentCardHtml(a, { tooltip: buildAgentHoverTooltip(a, humanDash, 1) })}</div>`)
    .join('');

  panel.innerHTML = `${agentsHtml}${actionCardsHtml}`;
}

const SPRINT_BONUS_TOKEN_LABELS = {
  FREE_5PT: '+5 Profit',
  FREE_1PT: '+1 Profit',
  FREE_OPEN_MARKET_AGENT: 'Free Open Market Agent',
  FREE_COACH_TOKEN: 'Free Coach Token',
  FREE_ACTION: 'Free Action',
  FREE_LOYALTY_TOKEN: 'Free Loyalty Token',
};

// Real Specialist Card names/descriptions, transcribed from Rulebook v4.5's
// own "EXECUTIVE SEARCH HUB SPECIALISTS" numbered list (cards 1-13).
// Descriptions are condensed for board display; SPEC_1/2/5/6/8 have real
// engine handlers (handlers/specialistCards/specialistCards.js) — the rest
// currently fall through to the safe non-strict fallback until their own
// handlers are built, which this label makes visible rather than hiding.
const SPECIALIST_CARD_INFO = {
  SPEC_1: { name: 'The Snoop', description: 'Steal 1 Action Card from an opponent\'s hand (they backfill from their deck).', image: 'SPEC_1.png' },
  SPEC_2: { name: 'The Whistleblower', description: 'Force an opponent to return 1 Agent to the Open Market; they receive Profit Tokens equal to its Profit.', image: 'SPEC_2.png' },
  SPEC_3: { name: 'The Lobbyist', description: 'Freeze any 1 Hub for the rest of this round — no new Meeples may enter it.', image: 'SPEC_3.png' },
  SPEC_4: { name: 'The Inside Source', description: 'Draw 5 Agents privately; recruit up to 2 for free, ignoring all requirements.', image: 'SPEC_4.png' },
  SPEC_5: { name: 'The Ghost Broker', description: 'Permanent: +1 Office capacity and +2 Hand Limit for the rest of the game.', image: 'SPEC_5.png' },
  SPEC_6: { name: 'The Clean Slate', description: 'Trash up to 3 cards from hand/discard; draw 1 replacement per card trashed.', image: 'SPEC_6.png' },
  SPEC_7: { name: 'The Automation Engineer', description: 'Permanently lock in 1 Action Space — trigger it once per round for free, no Meeple needed.', image: 'SPEC_7.png' },
  SPEC_8: { name: 'The Venture Capitalist', description: 'Gain 3 PT whenever a track cube lands on space 5, 7, or 9.', image: 'SPEC_8.png' },
  SPEC_9: { name: 'The Executive Overdrive', description: 'Resolve 1 Action Space twice back-to-back; the 2nd resolution waives its cost.', image: 'SPEC_9.png' },
  SPEC_10: { name: 'The Corporate Merger', description: 'Bridge 2 tracks — advancing one grants a free +1 to the other, for the rest of the round.', image: 'SPEC_10.png' },
  SPEC_11: { name: 'The Ghost in the Machine', description: 'Copy an opponent\'s Level 5 Tech passive for the rest of the round.', image: 'SPEC_11.png' },
  SPEC_12: { name: 'The Shell Company', description: 'Draw 5 Agents privately; recruit 1 free now, and 1 more later this round at normal requirements.', image: 'SPEC_12.png' },
  SPEC_13: { name: 'The Hostile Takeover', description: 'Become 1st Player next round and take 2 actions before the 2nd player takes any.', image: 'SPEC_13.png' },
};

function buildSpecialistCardHtml(specialistHubPanel) {
  if (!specialistHubPanel || !specialistHubPanel.activeCard) {
    return '<div class="specialist-card-panel specialist-card-empty">No Specialist Card revealed</div>';
  }
  const { activeCard, cardsRemainingInDrawPile } = specialistHubPanel;
  const info = SPECIALIST_CARD_INFO[activeCard.catalogId] || { name: activeCard.catalogId, description: 'Details not yet available.', image: null };
  const spentTile = activeCard.claimedByPlayerId ? `<div class="spent-tile-overlay" title="Claimed">SPENT</div>` : '';
  const tooltip = `${info.name}: ${info.description} (${cardsRemainingInDrawPile} remaining in deck)`;
  return `
    <div class="specialist-card-panel${activeCard.claimedByPlayerId ? ' specialist-card-spent' : ''}" title="${escapeAttr(tooltip)}">
      ${buildFullCardImageHtml(
        info.image,
        'specialists',
        `${buildPortraitHtml(null, info.name, 'specialists')}
         <div class="specialist-card-name">${escapeAttr(info.name)}</div>`
      )}
      ${spentTile}
    </div>
  `;
}

const SIMPLE_BANKED_TOKEN_TYPES = new Set(['FREE_5PT', 'FREE_1PT']);
const TARGETED_BANKED_TOKEN_TYPES = new Set(['FREE_COACH_TOKEN', 'FREE_LOYALTY_TOKEN']);
const MARKET_BANKED_TOKEN_TYPES = new Set(['FREE_OPEN_MARKET_AGENT', 'FREE_ACTION']);

function buildBankedTokensInventoryHtml(dash, vm) {
  const tokens = dash.bankedBonusTokens || [];
  const isHumanActiveTurn = dash.playerId === HUMAN_PLAYER_ID && vm.meta.phase === 'WORKER_PLACEMENT' && vm.meta.activePlayerId === HUMAN_PLAYER_ID;

  const tokenChips = tokens
    .map((tokenType, index) => {
      const label = SPRINT_BONUS_TOKEN_LABELS[tokenType] || tokenType;
      const clickable = isHumanActiveTurn;
      return `<button type="button" class="banked-token-chip${clickable ? ' banked-token-chip-clickable' : ''}" data-token-type="${tokenType}" data-token-index="${index}" ${clickable ? '' : 'disabled'} title="${clickable ? 'Click to activate' : 'Activate this on your own active turn'}">${label}</button>`;
    })
    .join('');

  return `
    <div class="banked-tokens-inventory">
      <div class="banked-tokens-title">Banked Bonus Tokens</div>
      ${tokens.length === 0 ? '<div class="banked-tokens-empty">None yet</div>' : `<div class="banked-tokens-chips">${tokenChips}</div>`}
    </div>
  `;
}

function buildShellCompanyStashHtml(dash) {
  const stash = dash.shellCompanyStash || [];
  if (stash.length === 0) {
    return '';
  }
  const isHuman = dash.playerId === HUMAN_PLAYER_ID;
  const recruitsRemaining = 2 - (dash.shellCompanyRecruitsUsed || 0);
  const stashChips = stash
    .map((s) => {
      const clickable = isHuman && recruitsRemaining > 0;
      return `<button type="button" class="banked-token-chip${clickable ? ' banked-token-chip-clickable' : ''}" data-stash-instance-id="${s.stashInstanceId}" ${clickable ? '' : 'disabled'} title="${clickable ? 'Recruit at normal Broker Value requirements' : 'Not available'}">${s.catalogId}</button>`;
    })
    .join('');

  return `
    <div class="banked-tokens-inventory">
      <div class="banked-tokens-title">Shell Company Stash (${recruitsRemaining} recruit(s) remaining, normal requirements apply)</div>
      <div class="banked-tokens-chips">${stashChips}</div>
    </div>
  `;
}

/**
 * buildMilestoneAbilitiesHtml(dash, vm)
 * Epic 3: real, clickable UI for the once-per-round / toggle-mode
 * Track Milestone abilities that had zero client-side hooks before —
 * the engine already supported all four correctly (confirmed via
 * direct testing in the prior session), but a human player had no way
 * to actually trigger any of them. Only ever shown for the human
 * player's own panel, matching every other interactive control here.
 */
function buildMilestoneAbilitiesHtml(dash, vm) {
  if (dash.playerId !== HUMAN_PLAYER_ID) return '';
  const isHumanActiveTurn = vm.meta.phase === 'WORKER_PLACEMENT' && vm.meta.activePlayerId === HUMAN_PLAYER_ID;
  const usedThisRound = dash.oncePerRoundAbilitiesUsed || [];
  const tm = dash.trackMeters || [];
  const findBranchLevel = (key, branch) => {
    const meter = tm.find((m) => m.key === key);
    return meter && meter.branch === branch ? meter.value : -1;
  };

  const buttons = [];

  // Technology A5 — Overtime Manager: toggle mode, next space click pays
  // $2 PT to place on an occupied opponent space.
  if (findBranchLevel('technology', 'A') >= 5) {
    const already = usedThisRound.includes('OVERTIME_MANAGER');
    const disabled = already || !isHumanActiveTurn || pendingFreeAction || pendingLiquidityStaffPT || dash.wallet.profitTokens < 2;
    buttons.push(
      `<button type="button" class="milestone-ability-btn${pendingOvertimeManager ? ' milestone-ability-btn-active' : ''}" id="overtime-manager-btn" ${disabled ? 'disabled' : ''} title="${already ? 'Already used this round' : 'Pay $2 PT to place your next meeple on an opponent-occupied space'}">⏰ Overtime Manager${pendingOvertimeManager ? ' (click a space)' : ''}</button>`
    );
  }

  // Technology B5 — Proprietary Algorithm: once per round, opens a
  // choice modal (trash 1 to draw 2, OR discard 1 for $2 PT).
  if (findBranchLevel('technology', 'B') >= 5) {
    const already = usedThisRound.includes('PROPRIETARY_ALGORITHM');
    const disabled = already || dash.hand.summary.count === 0;
    buttons.push(
      `<button type="button" class="milestone-ability-btn" id="proprietary-algorithm-btn" ${disabled ? 'disabled' : ''} title="${already ? 'Already used this round' : 'Trash 1 to draw 2, or discard 1 for $2 PT'}">🧮 Proprietary Algorithm</button>`
    );
  }

  // Recognition A5 — Liquidation Engine: once per round, opens a
  // choice modal (pick 1 Agent to activate a second time for profit).
  if (findBranchLevel('recognition', 'A') >= 5) {
    const already = usedThisRound.includes('LIQUIDATION_ENGINE');
    const realRoster = (dash.roster.agents || []).filter((a) => !a.isVoided && a.resolved !== false);
    const disabled = already || realRoster.length === 0;
    buttons.push(
      `<button type="button" class="milestone-ability-btn" id="liquidation-engine-btn" ${disabled ? 'disabled' : ''} title="${already ? 'Already used this round' : 'Pick 1 Agent to activate a second time for its Profit payout'}">💧 Liquidation Engine</button>`
    );
  }

  // Recognition B7 — Venture Liquidation: toggle mode, only usable the
  // round after the tokens were granted (liquidityStaffPTUsableRound),
  // spending 1 token to perform a space's action for free.
  if (dash.liquidityStaffPT > 0) {
    const usableNow = dash.liquidityStaffPTUsableRound === vm.meta.round;
    const disabled = !isHumanActiveTurn || !usableNow || pendingFreeAction || pendingOvertimeManager;
    buttons.push(
      `<button type="button" class="milestone-ability-btn${pendingLiquidityStaffPT ? ' milestone-ability-btn-active' : ''}" id="liquidity-staff-pt-btn" ${disabled ? 'disabled' : ''} title="${usableNow ? `Spend 1 of your ${dash.liquidityStaffPT} Liquidity Staff tokens as a free action` : 'Usable starting next round'}">🏦 Spend Liquidity Staff (${dash.liquidityStaffPT})${pendingLiquidityStaffPT ? ' (click a space)' : ''}</button>`
    );
  }

  if (buttons.length === 0) return '';
  return `<div class="milestone-abilities-row">${buttons.join('')}</div>`;
}

function renderTurnOrderTrack(vm) {
  const container = document.createElement('div');
  container.id = 'turn-order-track';
  container.className = 'turn-order-track';

  const players = vm.meta.turnOrder.map((playerId) => vm.players[playerId]).filter(Boolean);
  const n = players.length;
  if (n === 0) {
    return container;
  }

  const size = 96;
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 3;
  const anglePer = 360 / n;

  function point(angleDeg) {
    const rad = ((angleDeg - 90) * Math.PI) / 180;
    return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
  }

  const wedges = players
    .map((player, index) => {
      const playerId = vm.meta.turnOrder[index];
      const isActive = playerId === vm.meta.activePlayerId;
      const isHuman = playerId === HUMAN_PLAYER_ID;
      const startAngle = index * anglePer;
      const endAngle = startAngle + anglePer;
      const [x1, y1] = point(startAngle);
      const [x2, y2] = point(endAngle);
      const largeArc = anglePer > 180 ? 1 : 0;
      const midAngle = startAngle + anglePer / 2;
      const labelRadius = r * 0.62;
      const labelRad = ((midAngle - 90) * Math.PI) / 180;
      const labelX = cx + labelRadius * Math.cos(labelRad);
      const labelY = cy + labelRadius * Math.sin(labelRad);

      return `
        <path
          d="M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z"
          fill="${colorSafe(player.color)}"
          stroke="${isActive ? 'var(--hub-decisions, #e8b64c)' : 'var(--bg-dark)'}"
          stroke-width="${isActive ? 3 : 1}"
          opacity="${isActive ? 1 : 0.7}"
        >
          <title>${escapeAttr(player.displayName)}${isHuman ? ' (You)' : ''} — turn ${index + 1} of ${n}</title>
        </path>
        <text x="${labelX}" y="${labelY}" text-anchor="middle" dominant-baseline="middle" class="turn-wheel-label">${index + 1}</text>
      `;
    })
    .join('');

  container.innerHTML = `
    <svg viewBox="0 0 ${size} ${size}" width="100%" height="100%" class="turn-wheel-svg">
      ${wedges}
      <circle cx="${cx}" cy="${cy}" r="4" fill="var(--bg-dark)" stroke="var(--hub-decisions, #e8b64c)" stroke-width="1.5" />
    </svg>
  `;
  return container;
}

function renderHeader(vm) {
  document.getElementById('round-info').textContent = `Round ${vm.meta.round} / ${vm.meta.maxRounds}`;
  document.getElementById('phase-info').textContent = vm.meta.phase;
  document.getElementById('active-player-info').textContent = vm.players[vm.meta.activePlayerId]
    ? vm.players[vm.meta.activePlayerId].displayName
    : '—';

  // Room Code in the nav bar: persists through actual gameplay (not
  // just the waiting room screen), so a disconnected or refreshed
  // player can always see it to rejoin — the whole point being it's
  // visible exactly when a player might need to reconnect, not only
  // before the game starts.
  const roomCodeEl = document.getElementById('nav-room-code');
  if (multiplayerClient.isOnline && multiplayerClient.roomCode) {
    roomCodeEl.textContent = `Room: ${multiplayerClient.roomCode}`;
    roomCodeEl.style.display = 'inline';
  } else {
    roomCodeEl.style.display = 'none';
  }

  if (vm.meta.phase === 'FINAL_SCORING' && vm.leaderboard) {
    const lines = vm.leaderboard.map((e) => `#${e.rank} ${vm.players[e.playerId].displayName} — ${e.finalScore} pts`);
    document.getElementById('leaderboard').textContent = lines.join('   |   ');
    document.getElementById('leaderboard').style.display = 'block';
    if (!endGameSurveyCompleted) {
      renderEndGameSurveyModal();
    } else {
      renderGameOverModal(vm);
    }
  } else {
    document.getElementById('leaderboard').style.display = 'none';
    document.getElementById('game-over-modal').style.display = 'none';
  }
}

/**
 * renderGameOverModal(vm)
 * ITEM 2: a real Game Over / Final Score modal, showing the full
 * per-category breakdown for every player — the existing #leaderboard
 * bar only ever showed a one-line total, never the actual category
 * breakdown scoringEngine.js already computes and the bridge already
 * exposes (state.finalLeaderboard[].breakdowns, confirmed real and
 * populated). Categories match the confirmed rulebook scoring list
 * exactly (§6): Net Profit, Culture Score (already ×2), Market Share,
 * Agent Count, Unrecruitable (Loyalty) Bonus, Profit Tokens, Milestones.
 */
const FEEDBACK_STORAGE_KEY = 'brokerBossOnline_playtestFeedback';

function loadStoredFeedback() {
  try {
    const raw = window.localStorage.getItem(FEEDBACK_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

function saveStoredFeedback(entries) {
  try {
    window.localStorage.setItem(FEEDBACK_STORAGE_KEY, JSON.stringify(entries));
  } catch (e) {
    // localStorage can legitimately fail (quota, private mode) — the
    // submission itself already succeeded in-memory for this session;
    // this only affects persistence across reloads.
  }
}

function downloadJson(filename, dataObject) {
  const blob = new Blob([JSON.stringify(dataObject, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * downloadCsv(filename, rows)
 * rows: array of plain objects, all sharing the same keys (the first
 * row's keys become the header). Minimal, correct CSV escaping —
 * quotes any field containing a comma, quote, or newline, doubling
 * internal quotes per the standard CSV convention.
 */
function csvEscape(value) {
  const str = value === null || value === undefined ? '' : String(value);
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function downloadCsv(filename, rows) {
  if (rows.length === 0) {
    logLine('No telemetry rows to export yet — play at least one round first.');
    return;
  }
  const headers = Object.keys(rows[0]);
  const lines = [headers.map(csvEscape).join(',')];
  rows.forEach((row) => {
    lines.push(headers.map((h) => csvEscape(row[h])).join(','));
  });
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * buildDecisionLogRows(currentState)
 * Real round-by-round telemetry — one row per real logged game event,
 * built directly from state.log (the engine's own authoritative
 * action record, already used for the history ticker). Flattens each
 * entry's own extra fields into a single "details" JSON column, since
 * different log entry types carry genuinely different extra data.
 */
function buildDecisionLogRows(currentState) {
  return currentState.log.map((entry) => {
    const { seq, timestamp, round, type, playerId, message, ...rest } = entry;
    return {
      seq,
      timestamp,
      round,
      type,
      playerId: playerId || '',
      message: message || '',
      details: Object.keys(rest).length > 0 ? JSON.stringify(rest) : '',
    };
  });
}

/**
 * buildRoundTimingRows(currentState)
 * Real round timing — derived from the actual timestamp on the first
 * and last log entry belonging to each round, not a separately-tracked
 * clock that could drift from what genuinely happened.
 */
function buildRoundTimingRows(currentState) {
  const roundGroups = {};
  currentState.log.forEach((entry) => {
    if (!roundGroups[entry.round]) roundGroups[entry.round] = [];
    roundGroups[entry.round].push(entry);
  });
  return Object.keys(roundGroups)
    .map(Number)
    .sort((a, b) => a - b)
    .map((round) => {
      const entries = roundGroups[round];
      const first = entries[0];
      const last = entries[entries.length - 1];
      const durationMs = new Date(last.timestamp).getTime() - new Date(first.timestamp).getTime();
      const placementEvents = entries.filter((e) => e.type === 'MEEPLE_PLACED');
      const uniqueSpacesUsed = new Set(placementEvents.map((e) => e.spaceId)).size;
      return {
        round,
        eventCount: entries.length,
        durationMs,
        startTimestamp: first.timestamp,
        endTimestamp: last.timestamp,
        placementsMade: placementEvents.length,
        uniqueSpacesUsed,
      };
    });
}

const SURVEY_STORAGE_KEY = 'brokerBossOnline_endGameSurveys';

function renderEndGameSurveyModal() {
  const overlayEl = document.getElementById('interrupt-overlay');
  let balanceRating = 0;
  let funRating = 0;

  function buildRatingButtons(name, current) {
    return Array.from({ length: 5 }, (_, i) => i + 1)
      .map((n) => `<button type="button" class="survey-rating-btn${n <= current ? ' survey-rating-btn-selected' : ''}" data-question="${name}" data-value="${n}">${n}</button>`)
      .join('');
  }

  function renderBody() {
    overlayEl.innerHTML = `
      <div class="modal-box">
        <h3>Quick Playtest Survey</h3>
        <p>3 quick questions before your final score — this helps balance the game.</p>
        <label class="feedback-field-label">Game Balance (1 = way off, 5 = feels great)</label>
        <div class="survey-rating-row" id="survey-balance-row">${buildRatingButtons('balance', balanceRating)}</div>
        <label class="feedback-field-label">Fun Rating (1 = not fun, 5 = a blast)</label>
        <div class="survey-rating-row" id="survey-fun-row">${buildRatingButtons('fun', funRating)}</div>
        <label class="feedback-field-label">Open Feedback (optional)
          <textarea id="survey-open-feedback" class="feedback-textarea" rows="3" placeholder="Anything else you'd like to share?"></textarea>
        </label>
        <div class="modal-actions">
          <button type="button" class="modal-cancel-btn" id="survey-skip-btn">Skip</button>
          <button type="button" class="modal-skip-btn" id="survey-submit-btn">Submit &amp; See Final Score</button>
        </div>
      </div>
    `;

    overlayEl.querySelectorAll('.survey-rating-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.dataset.question === 'balance') balanceRating = Number(btn.dataset.value);
        else funRating = Number(btn.dataset.value);
        renderBody();
      });
    });

    overlayEl.querySelector('#survey-skip-btn').addEventListener('click', () => {
      endGameSurveyCompleted = true;
      render();
    });

    overlayEl.querySelector('#survey-submit-btn').addEventListener('click', () => {
      const openFeedback = overlayEl.querySelector('#survey-open-feedback').value.trim();
      let entries = [];
      try {
        const raw = window.localStorage.getItem(SURVEY_STORAGE_KEY);
        entries = raw ? JSON.parse(raw) : [];
      } catch (e) {
        entries = [];
      }
      entries.push({
        submittedAt: new Date().toISOString(),
        balanceRating: balanceRating || null,
        funRating: funRating || null,
        openFeedback: openFeedback || null,
      });
      try {
        window.localStorage.setItem(SURVEY_STORAGE_KEY, JSON.stringify(entries));
      } catch (e) {
        // best-effort persistence, same reasoning as feedback storage
      }
      endGameSurveyCompleted = true;
      render();
    });
  }

  overlayEl.style.display = 'flex';
  renderBody();
}

function renderPlayerAidModal() {
  const overlayEl = document.getElementById('interrupt-overlay');
  overlayEl.style.display = 'flex';

  const trackLabels = { training: 'Training', technology: 'Technology', recognition: 'Recognition' };
  const sectionsHtml = Object.keys(TECH_TRACK_ABILITY_CATALOG)
    .map((trackKey) => {
      const track = TECH_TRACK_ABILITY_CATALOG[trackKey];
      const branchesHtml = ['A', 'B']
        .map((branchKey) => {
          const branch = track[branchKey];
          const levelsHtml = [5, 7, 9]
            .map((lvl) => {
              const ability = branch[lvl];
              return `
                <div class="player-aid-ability-row" title="${escapeAttr(`${ability.name}: ${ability.text}`)}">
                  <span class="player-aid-level-badge">Lv ${lvl}</span>
                  <div class="player-aid-ability-text">
                    <span class="player-aid-ability-name">${escapeAttr(ability.name)}</span>
                    <span class="player-aid-ability-desc">${escapeAttr(ability.text)}</span>
                  </div>
                </div>`;
            })
            .join('');
          return `
            <div class="player-aid-branch-column">
              <div class="player-aid-branch-label">Path ${branchKey}: ${escapeAttr(branch.label)}</div>
              ${levelsHtml}
            </div>`;
        })
        .join('');
      return `
        <div class="player-aid-track-section">
          <h4 class="player-aid-track-title">${trackLabels[trackKey]}</h4>
          <div class="player-aid-branch-row">${branchesHtml}</div>
        </div>`;
    })
    .join('');

  overlayEl.innerHTML = `
    <div class="modal-box player-aid-modal-box">
      <h3>📖 Player Aid — Tech Tree Reference</h3>
      <p class="player-aid-intro">Every Level 5, 7, and 9 milestone ability across all 3 tracks — the exact same text shown when you hover a real milestone node on your own player board.</p>
      <div class="player-aid-scroll-area">${sectionsHtml}</div>
      <div class="modal-actions">
        <button type="button" class="modal-cancel-btn" id="player-aid-close-btn">Close</button>
      </div>
    </div>
  `;

  overlayEl.querySelector('#player-aid-close-btn').addEventListener('click', () => {
    overlayEl.style.display = 'none';
    overlayEl.innerHTML = '';
    render();
  });
}


function renderFeedbackModal() {
  const overlayEl = document.getElementById('interrupt-overlay');
  const existing = loadStoredFeedback();

  overlayEl.style.display = 'flex';
  overlayEl.innerHTML = `
    <div class="modal-box">
      <h3>🐞 Report / Feedback</h3>
      <p>Help improve Broker Boss Online — this is saved locally on your device, not sent anywhere.</p>
      <label class="feedback-field-label">Target Card / Space Name (optional)
        <input type="text" id="feedback-target" class="feedback-text-input" placeholder="e.g. S6 The 25th Hour, LDR_HIRE_COACH" />
      </label>
      <label class="feedback-field-label">Issue Category
        <select id="feedback-category" class="feedback-select">
          <option value="Broken Logic">Broken Logic</option>
          <option value="Balance Suggestion">Balance Suggestion</option>
          <option value="Text/Rule Clarification">Text/Rule Clarification</option>
        </select>
      </label>
      <label class="feedback-field-label">Player Notes
        <textarea id="feedback-notes" class="feedback-textarea" rows="4" placeholder="What happened? What did you expect instead?"></textarea>
      </label>
      <div class="feedback-existing-count">${existing.length} submission${existing.length === 1 ? '' : 's'} saved so far this device.</div>
      <div class="modal-actions">
        <button type="button" class="modal-cancel-btn" id="feedback-cancel-btn">Cancel</button>
        <button type="button" class="modal-skip-btn" id="feedback-export-btn">Export Feedback JSON</button>
        <button type="button" class="modal-skip-btn" id="feedback-submit-btn">Submit</button>
      </div>
    </div>
  `;

  overlayEl.querySelector('#feedback-cancel-btn').addEventListener('click', () => {
    overlayEl.style.display = 'none';
    overlayEl.innerHTML = '';
    render();
  });

  overlayEl.querySelector('#feedback-export-btn').addEventListener('click', () => {
    downloadJson(`broker-boss-feedback-${new Date().toISOString().slice(0, 10)}.json`, loadStoredFeedback());
  });

  overlayEl.querySelector('#feedback-submit-btn').addEventListener('click', () => {
    const target = overlayEl.querySelector('#feedback-target').value.trim();
    const category = overlayEl.querySelector('#feedback-category').value;
    const notes = overlayEl.querySelector('#feedback-notes').value.trim();

    const entries = loadStoredFeedback();
    entries.push({
      submittedAt: new Date().toISOString(),
      target: target || null,
      category,
      notes: notes || null,
      round: state && state.phase ? state.phase.round : null,
      phase: state && state.phase ? state.phase.current : null,
    });
    saveStoredFeedback(entries);

    overlayEl.style.display = 'none';
    overlayEl.innerHTML = '';
    showToast('Feedback saved locally — thank you!');
    render();
  });
}

function renderGameOverModal(vm) {
  const modalEl = document.getElementById('game-over-modal');
  const CATEGORY_LABELS = {
    netProfit: 'Net Profit',
    cultureScoreDoubled: 'Culture Score (×2)',
    marketShareScore: 'Market Share',
    agentCountScore: 'Agent Count',
    loyaltyBonus: 'Unrecruitable Bonus',
    profitTokenScore: 'Profit Tokens',
    milestoneScore: 'Milestones',
  };
  const categoryKeys = Object.keys(CATEGORY_LABELS);

  const rows = vm.leaderboard
    .slice()
    .sort((a, b) => a.rank - b.rank)
    .map((entry) => {
      const player = vm.players[entry.playerId];
      const isWinner = entry.rank === 1;
      const categoryCells = categoryKeys.map((key) => `<td>${entry.breakdowns[key]}</td>`).join('');
      return `
        <tr class="${isWinner ? 'game-over-winner-row' : ''}">
          <td>${isWinner ? '🏆 ' : ''}#${entry.rank}</td>
          <td><span class="player-color-dot" style="background:${colorSafe(player.color)}"></span> ${player.displayName}${player.isBot ? ` (${botArchetypeTitle(player.archetype)})` : ''}</td>
          ${categoryCells}
          <td class="game-over-total-cell">${entry.finalScore}</td>
        </tr>`;
    })
    .join('');

  const headerCells = categoryKeys.map((key) => `<th>${CATEGORY_LABELS[key]}</th>`).join('');

  modalEl.innerHTML = `
    <div class="modal-box game-over-box">
      <h2>🏁 Game Over — Final Scoring</h2>
      <table class="game-over-table">
        <thead>
          <tr><th>Rank</th><th>Player</th>${headerCells}<th>Total</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="game-over-actions">
        <button type="button" id="game-over-play-again-btn" class="btn-primary game-over-play-again-btn">🔁 Play Again</button>
      </div>
    </div>
  `;
  modalEl.style.display = 'flex';

  document.getElementById('game-over-play-again-btn').addEventListener('click', () => {
    modalEl.style.display = 'none';
    modalEl.innerHTML = '';
    document.getElementById('leaderboard').style.display = 'none';
    endGameSurveyCompleted = false;
    selectedDashboardTab = HUMAN_PLAYER_ID;
    dismissedInterruptKey = null;
    state = null;
    if (multiplayerClient.ws) {
      multiplayerClient.ws.close();
      multiplayerClient.ws = null;
    }
    multiplayerClient.isOnline = false;
    multiplayerClient.roomCode = null;
    multiplayerClient.reconnectToken = null;
    clearSessionCredentials();
    document.getElementById('app-shell').style.display = 'none';
    document.getElementById('lobby-screen').style.display = '';
    renderLobby();
  });
}

function renderGlobalMilestones(vm) {
  const container = document.getElementById('global-milestones-panel');
  if (!container) return;

  const SHORT_LABELS = {
    OFFICE_MOGUL: 'Office Mogul',
    MARKET_LEADER: 'Market Leader',
    MAXED_OUT_VALUE: 'Maxed Value',
    THE_MENTOR: 'The Mentor',
    SUPERSTAR_RECRUITER: 'Recruiter',
  };

  container.innerHTML = vm.globalMilestones
    .map((m) => {
      const tooltip = `${m.name}\n${m.criteria}\nEnd Game Bonus: +${m.bonusPoints} Victory Points / Profit`;
      const claimed = m.ownerId !== null;
      return `
        <div class="milestone-slot${claimed ? ' claimed' : ''}" title="${escapeAttr(tooltip)}">
          <div class="milestone-slot-name">${SHORT_LABELS[m.key] || m.name}</div>
          ${
            claimed
              ? `<div class="milestone-owner-badge" style="background:${colorSafe(m.ownerColor)}">${m.ownerDisplayName}</div>`
              : `<div class="milestone-bonus-label">+${m.bonusPoints}</div>`
          }
        </div>`;
    })
    .join('');
}

/**
 * computeSpaceHitboxBounds(spaceId)
 * Physical-board Stage 1: a bounding box (board-relative %) that
 * covers every real printed circle for this space, padded just enough
 * to comfortably cover each circle's own edge without bleeding into
 * the next row — padding sized against the real measured circle
 * spacing from Sub-stage B (rows ~5-6% apart, circles ~3.3-4% apart,
 * circle radius ~1.2-1.5% of image width).
 */
/**
 * buildMeepleSvg(color)
 * Physical-board Stage 1: a stylized hourglass silhouette — this game's
 * actual Time Meeple component shape (confirmed against the project's
 * own placeholder components reference sheet), not a generic pawn.
 * White/black double-outline for contrast against any board color.
 */
/**
 * buildDraggableMeepleRowHtml(dash)
 * Phase 4, Task 1: real individual meeple tokens for the human player,
 * each carrying its own real instanceId — this is what dragstart reads
 * to know exactly which meeple is being placed, rather than the click
 * handler's own "grab the first available one" behavior. Staff In
 * Training meeples render dimmed and non-draggable (they're real but
 * not usable yet).
 */
function buildDraggableMeepleRowHtml(dash) {
  const realActiveMeeples = (state.players[dash.playerId] && state.players[dash.playerId].timeMeeples.active) || [];
  const onBoardCount = realActiveMeeples.filter((m) => m.status === 'on_board').length;
  const previousOnBoardCount = previousOnBoardMeepleCountByPlayer[dash.playerId];
  const justRecalled = previousOnBoardCount !== undefined && onBoardCount < previousOnBoardCount;
  previousOnBoardMeepleCountByPlayer[dash.playerId] = onBoardCount;

  const activeTokens = realActiveMeeples
    .map((m) => {
      if (m.status !== 'in_supply') return '';
      return `<span class="draggable-meeple-token" draggable="true" data-meeple-instance-id="${m.instanceId}" title="Drag onto a valid board space, or click a space directly">${buildMeepleSvg(colorSafe(dash.color))}</span>`;
    })
    .join('');
  // Epic 3: Copycat Meeple (Recognition Path B, "Copycat Marketing") —
  // a distinct, separately-tracked meeple, never part of
  // timeMeeples.active. Orange is reserved specifically for this token
  // (per the project's own established color convention — Orange is
  // not a selectable player color), so it's never confused with any
  // real player's own meeple color.
  const copycatMeeple = state.players[dash.playerId] && state.players[dash.playerId].timeMeeples.copycatMeeple;
  const copycatToken =
    copycatMeeple && copycatMeeple.status === 'in_supply'
      ? `<span class="draggable-meeple-token draggable-copycat-token" draggable="true" data-meeple-instance-id="${copycatMeeple.instanceId}" title="Copycat Meeple — drag onto ANY occupied opponent space to place there">${buildMeepleSvg('#e8842c')}</span>`
      : '';
  const trainingBadge =
    dash.timeMeeples.staffInTrainingCount > 0
      ? `<span class="staff-in-training-badge">+${dash.timeMeeples.staffInTrainingCount} in training</span>`
      : '';
  return `👷 <span class="draggable-meeple-row${justRecalled ? ' draggable-meeple-row-recalled' : ''}" title="${justRecalled ? 'Meeples recalled to supply' : ''}">${activeTokens}${copycatToken}</span> ${dash.timeMeeples.availableCount}/${dash.timeMeeples.activeTotal} Available ${trainingBadge}`;
}

function buildMeepleSvg(color) {
  const safeColor = escapeAttr(color);
  return `
    <svg viewBox="0 0 20 24" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M4 2 H16 L11 12 L16 22 H4 L9 12 Z"
        fill="${safeColor}"
        stroke="#000000"
        stroke-width="1.5"
        stroke-linejoin="round"
      />
      <path
        d="M4 2 H16 L11 12 L16 22 H4 L9 12 Z"
        fill="none"
        stroke="#ffffff"
        stroke-width="0.6"
        stroke-linejoin="round"
      />
    </svg>`;
}

function computeSpaceHitboxBounds(spaceId) {
  const coords = SPACE_CIRCLE_COORDS[spaceId];
  if (!coords || coords.length === 0) return null;
  const xs = coords.map((c) => c[0]);
  const ys = coords.map((c) => c[1]);
  const padX = 1.9;
  const padY = 2.1;
  const minX = Math.min(...xs) - padX;
  const maxX = Math.max(...xs) + padX;
  const minY = Math.min(...ys) - padY;
  const maxY = Math.max(...ys) + padY;
  return { left: minX, top: minY, width: maxX - minX, height: maxY - minY };
}

function renderBoard(board, vm) {
  const container = document.getElementById('board-hubs');
  container.innerHTML = '';

  const humanAvailableMeeples = state.players[HUMAN_PLAYER_ID].timeMeeples.active.filter((m) => m.status === 'in_supply').length;

  Object.entries(board.hubs).forEach(([hubName, spaces]) => {
    if (spaces.length === 0) return;

    const hubEl = document.createElement('div');
    hubEl.className = 'hub-panel';
    hubEl.dataset.hub = hubName;
    hubEl.setAttribute('aria-label', hubName.replace(/_/g, ' '));
    hubEl.innerHTML = `<h3 class="hub-title">${hubName.replace(/_/g, ' ')}</h3>`;

    spaces.forEach((space) => {
      const bounds = computeSpaceHitboxBounds(space.spaceId);
      const meepleCost = (space.cost && space.cost.meepleCost) || 1;
      const profitCost = (space.cost && space.cost.profitTokens) || 0;
      const priorityCost = (space.cost && space.cost.priorityTokens) || 0;
      const humanWallet = state.players[HUMAN_PLAYER_ID].wallet;
      const canAfford = humanWallet.profitTokens >= profitCost && humanWallet.priorityTokens >= priorityCost;
      // FIX: no real agents to coach meant the meeple/space cost was
      // still spent for a fallback (the Coach Token gets banked, not
      // lost) — but the player had no way to know that in advance.
      // Proactively block the space instead of letting them discover
      // it only after already committing a meeple. Folded into
      // isBlocked directly so it propagates through every clickability
      // branch below (special modes included) without duplicating the
      // condition four separate times.
      const isHireCoachWithNoAgents =
        space.spaceId === 'LDR_HIRE_COACH' &&
        !(state.players[HUMAN_PLAYER_ID].roster || []).some((a) => !a.isVoided);
      const isBlocked = space.status === 'blocked' || space.status === 'void' || isHireCoachWithNoAgents;
      const clickable =
        pendingFreeAction || pendingLiquidityStaffPT
          ? vm.meta.phase === 'WORKER_PLACEMENT' && vm.meta.activePlayerId === HUMAN_PLAYER_ID && !isBlocked
          : pendingOvertimeManager
            ? vm.meta.phase === 'WORKER_PLACEMENT' && vm.meta.activePlayerId === HUMAN_PLAYER_ID && !isBlocked && humanAvailableMeeples >= meepleCost
            : vm.meta.phase === 'WORKER_PLACEMENT' &&
              vm.meta.activePlayerId === HUMAN_PLAYER_ID &&
              !vm.pendingInterrupt &&
              !space.isFull &&
              !isBlocked &&
              humanAvailableMeeples >= meepleCost &&
              canAfford;

      const spaceEl = document.createElement('div');
      const isUnavailable =
        pendingFreeAction || pendingLiquidityStaffPT
          ? isBlocked
          : pendingOvertimeManager
            ? isBlocked || humanAvailableMeeples < meepleCost
            : space.isFull || !canAfford || humanAvailableMeeples < meepleCost || isBlocked;
      const specialModeActive = pendingFreeAction || pendingOvertimeManager || pendingLiquidityStaffPT;
      spaceEl.className = `board-space-hitbox ${space.isFull ? 'space-full' : ''} ${isUnavailable ? 'space-unavailable' : ''} ${isBlocked ? 'space-locked' : ''} ${clickable ? 'space-clickable' : ''} ${specialModeActive && clickable ? 'space-free-action-highlight' : ''}`;
      spaceEl.dataset.spaceId = space.spaceId;
      spaceEl.dataset.meepleCost = String(meepleCost);
      spaceEl.dataset.capacity = String(space.capacity);
      if (bounds) {
        spaceEl.style.left = `${bounds.left}%`;
        spaceEl.style.top = `${bounds.top}%`;
        spaceEl.style.width = `${bounds.width}%`;
        spaceEl.style.height = `${bounds.height}%`;
      }

      const isStaffInTrainingSpace = !!(space.reward && space.reward.type === 'meeple' && space.reward.destination === 'staff_in_training');
      const specialistCardHtml =
        space.spaceId === 'EXEC_SEARCH_SPECIALTY_AGENT_HUB' && board.specialistHubPanel
          ? buildSpecialistCardHtml(board.specialistHubPanel)
          : '';

      // Physical-board Stage 1: the board art already shows the space's
      // name and static cost/reward values printed on it — no digital
      // text duplicate needed. Only genuinely dynamic, not-printed-on-
      // the-board info still renders, as small anchored badges rather
      // than a full opaque card.
      spaceEl.innerHTML = `
        ${isBlocked ? `<div class="space-lock-tile" title="${escapeAttr(space.status === 'void' ? 'Voided this round' : 'Blocked — frozen by a Specialist Card effect')}">🔒</div>` : ''}
        ${isStaffInTrainingSpace ? '<div class="staff-in-training-space-badge" title="New hire enters \'Staff in Training\' — unavailable this round, becomes an active meeple starting next round.">⏳</div>' : ''}
        ${space.statusTokenSlot ? `<div class="status-token">${space.statusTokenSlot.type}</div>` : ''}
        ${specialistCardHtml}
      `;

      if (clickable) {
        spaceEl.addEventListener('click', () => handleSpaceClick(space.spaceId));
      }

      container.appendChild(spaceEl);
    });

    container.appendChild(hubEl);
  });

  renderMeepleOverlay(board, container);
  container.appendChild(renderTurnOrderTrack(vm));
  renderMarketShareOverlay(vm, container);
  renderMarketShareBonusTiles(vm, container);
  renderShiftMarkerOverlay(vm, container);
}

/**
 * MARKET_SHARE_NODE_COORDS — Phase 4 Sub-stage C: center coordinates for
 * each of the 11 real Market Share ladder steps, indexed by the
 * engine's own real position (0 = value 0 at the bottom, 10 = value 33
 * at the top — matching MARKET_SHARE_TRACK_SPACES' own index order
 * exactly). Measured by locating the ladder's real top/bottom boundary
 * (via Canny+Hough line detection on the printed frame) and dividing
 * evenly into 11 steps — the standard, well-justified approach for a
 * printed ladder track, since the boxes themselves are rectangular
 * (not circular, so Sub-stage B's per-circle Hough detection doesn't
 * apply the same way here).
 */
const MARKET_SHARE_NODE_COORDS = [
  [11.72, 72.5], [11.72, 65.86], [11.72, 59.22], [11.72, 52.57], [11.72, 45.93],
  [11.72, 39.29], [11.72, 32.64], [11.72, 26.0], [11.72, 19.36], [11.72, 12.71], [11.72, 6.07],
];

/**
 * renderMarketShareOverlay(vm, boardHubsContainer)
 * Draws one marker per player at their real current Market Share
 * position on the shared board ladder — distinct from the per-player
 * dashboard's own Market Share mini-track (which still shows the same
 * data in each player's own panel; this is the shared, board-level
 * view all players see at once).
 */
function renderMarketShareOverlay(vm, boardHubsContainer) {
  const existing = boardHubsContainer.querySelector('.market-share-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.className = 'market-share-overlay';

  Object.keys(vm.players).forEach((playerId, playerIndex) => {
    const player = vm.players[playerId];
    if (!player || !player.tracks || !player.tracks.marketShare) return;
    const position = player.tracks.marketShare.position;
    const coord = MARKET_SHARE_NODE_COORDS[position];
    if (!coord) return;

    // Multiple players can share a position — cluster markers in a
    // small 3-column grid CENTERED on the real node coordinate, rather
    // than drifting them rightward one at a time (which put later
    // players increasingly far from the actual track step, especially
    // with all 6 players starting at position 0 together).
    const CLUSTER_COLS = 3;
    const CLUSTER_COL_STEP = 1.6;
    const CLUSTER_ROW_STEP = 1.8;
    const col = playerIndex % CLUSTER_COLS;
    const row = Math.floor(playerIndex / CLUSTER_COLS);
    const clusterLeft = coord[0] + (col - (CLUSTER_COLS - 1) / 2) * CLUSTER_COL_STEP;
    const clusterTop = coord[1] + row * CLUSTER_ROW_STEP;

    const marker = document.createElement('span');
    marker.className = 'market-share-marker';
    marker.style.left = `${clusterLeft}%`;
    marker.style.top = `${clusterTop}%`;
    marker.style.background = colorSafe(player.color);
    marker.title = `${player.displayName} — Market Share position ${position}`;
    overlay.appendChild(marker);
  });

  boardHubsContainer.appendChild(overlay);
}

const SPRINT_BONUS_TOKEN_ICONS = {
  FREE_5PT: '💰',
  FREE_1PT: '💵',
  FREE_OPEN_MARKET_AGENT: '👤',
  FREE_COACH_TOKEN: '🎓',
  FREE_ACTION: '🃏',
  FREE_LOYALTY_TOKEN: '❤',
};

/**
 * renderMarketShareBonusTiles(vm, boardHubsContainer)
 * Item 2: real physical tile graphics for the Sprint Bonus stacks at
 * board positions 4, 10, and 17 — replacing the old plain-text popover
 * with actual tile elements positioned directly on the printed track,
 * matching MARKET_SHARE_TRACK_SPACES' own index (positions 3/5/7 =
 * values 4/10/17). A newly-claimed tile pulses once (same
 * track-previous-state-then-animate-on-change pattern as the Shift
 * Ladder marker — this element is fully recreated each render, so a
 * CSS transition alone would never fire).
 */
function renderMarketShareBonusTiles(vm, boardHubsContainer) {
  const existing = boardHubsContainer.querySelector('.market-share-tile-overlay');
  if (existing) existing.remove();
  if (!vm.marketShareTrack) return;

  const overlay = document.createElement('div');
  overlay.className = 'market-share-tile-overlay';

  const positionToIndex = { 4: 3, 10: 5, 17: 7 };
  const nextClaimState = {};

  Object.keys(vm.marketShareTrack.bonusStacks).forEach((positionKey) => {
    const nodeIndex = positionToIndex[Number(positionKey)];
    const coord = MARKET_SHARE_NODE_COORDS[nodeIndex];
    if (!coord) return;
    const stack = vm.marketShareTrack.bonusStacks[positionKey];

    ['top', 'bottom'].forEach((half, halfIndex) => {
      const tokenType = stack[half];
      const claimedBy = stack[`${half}ClaimedBy`];
      const claimStateKey = `${positionKey}-${half}`;
      nextClaimState[claimStateKey] = !!claimedBy;
      const justClaimed = !!claimedBy && !previousBonusClaimState[claimStateKey];

      const tile = document.createElement('div');
      tile.className = `market-share-bonus-tile${claimedBy ? ' market-share-bonus-tile-claimed' : ''}${justClaimed ? ' market-share-bonus-tile-banking' : ''}`;
      tile.style.left = `${coord[0]}%`;
      tile.style.top = `${coord[1] + (halfIndex === 0 ? -1.8 : 1.8)}%`;
      tile.textContent = SPRINT_BONUS_TOKEN_ICONS[tokenType] || '?';
      tile.title = claimedBy
        ? `${SPRINT_BONUS_TOKEN_LABELS[tokenType] || tokenType} — claimed by ${claimedBy}`
        : `${SPRINT_BONUS_TOKEN_LABELS[tokenType] || tokenType} — banks automatically when a cube passes this space`;
      overlay.appendChild(tile);
    });
  });

  boardHubsContainer.appendChild(overlay);
  previousBonusClaimState = nextClaimState;
}

/**
 * renderShiftMarkerOverlay(vm, boardHubsContainer)
 * A single shared marker on the real Shift Tracker ladder — this is
 * global game state (not per-player), unlike Market Share. Pulses when
 * the rung genuinely changed since the last render; a CSS transition
 * would not work here since this element is fully recreated each
 * render like every other overlay piece.
 */
function renderShiftMarkerOverlay(vm, boardHubsContainer) {
  const existing = boardHubsContainer.querySelector('.shift-ladder-overlay');
  if (existing) existing.remove();

  const position = vm.shiftTracker ? vm.shiftTracker.position : null;
  if (position === null) return;
  const coord = SHIFT_LADDER_COORDS[position];
  if (!coord) return;

  const overlay = document.createElement('div');
  overlay.className = 'shift-ladder-overlay';

  const justMoved = previousShiftPosition !== null && previousShiftPosition !== position;
  const marker = document.createElement('div');
  marker.className = `shift-ladder-marker${justMoved ? ' shift-ladder-marker-moved' : ''}`;
  marker.style.left = `${coord[0]}%`;
  marker.style.top = `${coord[1]}%`;
  marker.title = `Shift Tracker: ${position} / ${vm.shiftTracker.max}`;
  overlay.appendChild(marker);

  boardHubsContainer.appendChild(overlay);
  previousShiftPosition = position;
}

/**
 * SPACE_CIRCLE_COORDS — Phase 4 Sub-stage B: precise (left%, top%) center
 * coordinates for each real printed circle on the board artwork,
 * measured via OpenCV Hough circle detection scoped per-hub (cropped
 * using Sub-stage A's own verified hub boundaries), cross-checked for
 * spacing consistency (each row's circle-to-circle gap measured within
 * ~1-3px of every other gap in that row) before being trusted. Index 0
 * = the space's 1st real occupant (occupiedBy[0].order), matching
 * arrival order exactly. Spaces not listed here (none currently) would
 * fall back to no overlay dot rather than guessing a position.
 */
/**
 * PLAYER_BOARD_TRACK_COORDS — Phase 4 Stage 2: measured directly
 * against the real 1232x952 individual player board artwork
 * (3_0_Player_Broker_Board_6.png), using the same method as the
 * central board — OpenCV circle detection for the track steps
 * (spacing consistency verified: 65-83px across every row, tightest on
 * the 17-step Office Expansion track at 65-66px), and gold-border
 * contour + edge-ratio verification for the two staff reservoir boxes
 * (100% perimeter match on both, not eyeballed).
 */
/**
 * SHIFT_LADDER_COORDS — measured by evenly dividing Sub-stage A's own
 * verified SHIFT_TRACKER bounding box (x=929,y=62,w=112,h=253 in the
 * 1092x1092 source image, itself confirmed via gold-border edge-ratio
 * matching) into 5 equal rungs — the same well-justified method used
 * for Market Share's own rectangular boxes, since Hough circle
 * detection doesn't apply to rectangular number plates.
 */
const SHIFT_LADDER_COORDS = { 4: [90.2, 7.99], 3: [90.2, 12.63], 2: [90.2, 17.26], 1: [90.2, 21.9], 0: [90.2, 26.53] };

const PLAYER_BOARD_TRACK_COORDS = {
  training: {
    trunk: [[18.3, 27.84], [24.39, 27.84], [30.56, 27.84], [36.65, 27.84], [42.82, 27.84]],
    branchA: [[48.58, 22.01], [54.91, 22.01], [61.08, 22.01], [67.09, 22.01], [73.82, 22.01], [79.59, 22.01]],
    branchB: [[48.9, 33.09], [55.07, 33.09], [61.08, 33.09], [67.25, 33.09], [73.42, 33.09], [79.42, 33.09]],
  },
  technology: {
    trunk: [[18.38, 50.47], [24.39, 50.47], [30.56, 50.47], [36.49, 50.47], [42.9, 50.47]],
    branchA: [[48.9, 45.12], [54.99, 45.12], [61.16, 45.12], [67.25, 45.12], [73.34, 45.12], [79.5, 45.12]],
    branchB: [[48.66, 55.88], [54.99, 55.88], [61.32, 55.88], [67.25, 55.88], [73.34, 55.88], [79.42, 55.88]],
  },
  recognition: {
    trunk: [[18.3, 73.58], [24.39, 73.58], [30.56, 73.58], [36.65, 73.58], [42.82, 73.58]],
    branchA: [[48.9, 67.96], [54.99, 67.96], [61.16, 67.96], [67.25, 67.96], [73.34, 67.96], [79.5, 67.96]],
    branchB: [[48.9, 78.26], [55.07, 78.26], [61.0, 78.26], [67.25, 78.26], [73.58, 78.26], [79.5, 78.26]],
  },
  officeExpansion: [
    [7.18, 94.85], [12.46, 94.85], [17.82, 94.85], [23.17, 94.85], [28.53, 94.85], [33.89, 94.85], [39.25, 94.85], [44.6, 94.85],
    [49.96, 94.85], [55.32, 94.85], [60.59, 94.85], [65.95, 94.85], [71.31, 94.85], [76.66, 94.85], [82.02, 94.85], [87.38, 94.85], [92.65, 94.85],
  ],
  staffInTraining: { left: 2.68, top: 2.52, width: 24.35, height: 8.61 },
  availableStaff: { left: 39.61, top: 2.52, width: 34.09, height: 8.61 },
};

const SPACE_CIRCLE_COORDS = {
  GRW_RECRUIT_AGENT: [[34.89, 45.7], [38.64, 45.7], [42.35, 45.7], [46.11, 45.7], [49.91, 45.7]],
  GRW_POACH_AGENT: [[34.89, 51.01], [38.64, 51.01], [42.35, 51.01], [46.11, 51.01], [49.91, 51.01]],
  GRW_LOYALTY_TOKEN: [[34.89, 56.5], [38.64, 56.5], [42.35, 56.5], [46.11, 56.5], [49.91, 56.5]],
  OPS_TRAINING: [[72.66, 44.55], [76.24, 44.64], [79.99, 44.46], [83.84, 44.64], [87.5, 44.55], [91.44, 44.64]],
  OPS_TECHNOLOGY: [[72.66, 48.76], [76.24, 48.95], [80.08, 48.76], [83.75, 48.76], [87.59, 48.76], [91.25, 48.86]],
  OPS_RECOGNITION: [[72.66, 52.98], [76.42, 52.88], [80.08, 53.07], [83.84, 52.98], [87.59, 53.07], [91.35, 52.98]],
  OPS_2X_COMBO: [[67.9, 46.98]],
  LDR_HIRE_STAFF: [[34.75, 72.21], [38.42, 72.3], [42.17, 72.3], [45.92, 72.3], [49.68, 72.3]],
  LDR_OFFICE_EXPANSION: [[34.75, 84.94], [38.32, 85.12], [42.26, 84.84], [45.92, 85.03], [49.68, 85.03]],
  LDR_HIRE_COACH: [[42.17, 78.8]],
  EXEC_TAKE_PLAY_CARD: [[71.29, 72.21]],
  EXEC_ADDITIONAL_PROFIT: [[88.87, 72.48]],
  GRW_MARKET_SHARE_ADVANCE: [[71.29, 83.1]],
  EXEC_CLEAR_OPEN_MARKET: [[89.06, 83.01]],
  EXEC_SEARCH_SPECIALTY_AGENT_HUB: [[28.71, 3.43], [32.55, 3.43]],
};

/**
 * renderMeepleOverlay(board, boardHubsContainer)
 * Draws every real placed meeple as an absolutely-positioned chip over
 * its exact printed circle on the board art, indexed by real arrival
 * order (occupiedBy's own order, not just array position — the two
 * should already match, but order is read explicitly to stay correct
 * even if that ever changes). Spaces with more real occupants than
 * defined circle coordinates (capacity-null spaces past their listed
 * slots) fall back to stacking additional chips at a small offset from
 * the last defined circle, rather than being silently dropped.
 */
function renderMeepleOverlay(board, boardHubsContainer) {
  const existing = boardHubsContainer.querySelector('.meeple-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.className = 'meeple-overlay';

  // Overflow past the last real printed circle: a clean grid expanding
  // from that circle, rather than a diagonal drift or unbounded single
  // column — keeps queued meeples readable and CONTAINED (Item 2 fix:
  // widened from 2 to 4 columns so real accumulation on an unlimited
  // space grows compactly in both directions instead of almost
  // entirely downward, which was overflowing into adjacent hubs/lower
  // spaces below a certain count). Beyond MAX_VISIBLE_OVERFLOW real
  // individual dots, the remainder collapses into one "+N" compact
  // indicator rather than continuing to grow unbounded.
  const GRID_COLS = 4;
  const GRID_COL_STEP = 2.0;
  const GRID_ROW_STEP = 2.3;
  const MAX_VISIBLE_OVERFLOW = 8;

  const allSpaces = Object.values(board.hubs).flat();
  const nextBoardMeepleInstanceIds = new Set();
  allSpaces.forEach((space) => {
    const coords = SPACE_CIRCLE_COORDS[space.spaceId];
    if (!coords || space.meepleSlots.length === 0) return;

    const overflowCount = Math.max(0, space.meepleSlots.length - coords.length);
    const collapseOverflow = overflowCount > MAX_VISIBLE_OVERFLOW;

    space.meepleSlots.forEach((m) => {
      nextBoardMeepleInstanceIds.add(m.meepleInstanceId);
      const slotIndex = typeof m.order === 'number' ? m.order - 1 : 0;
      const overflowIndex = Math.max(0, slotIndex - (coords.length - 1));

      // Once genuinely over the cap, only the first MAX_VISIBLE_OVERFLOW
      // overflow dots render individually — the rest are represented
      // by a single "+N" chip appended once per space (below), not one
      // real dot per meeple, which is what let the grid grow unbounded.
      if (collapseOverflow && overflowIndex > MAX_VISIBLE_OVERFLOW) {
        return;
      }

      const coord = coords[slotIndex] || coords[coords.length - 1];
      const col = overflowIndex === 0 ? 0 : (overflowIndex - 1) % GRID_COLS;
      const row = overflowIndex === 0 ? 0 : Math.floor((overflowIndex - 1) / GRID_COLS) + 1;
      const left = overflowIndex === 0 ? coord[0] : coord[0] + (col - (GRID_COLS - 1) / 2) * GRID_COL_STEP;
      const top = overflowIndex === 0 ? coord[1] : coord[1] + row * GRID_ROW_STEP;
      const isNewPlacement = !previousBoardMeepleInstanceIds.has(m.meepleInstanceId);

      const dot = document.createElement('div');
      dot.className = `board-meeple-chip${isNewPlacement ? ' board-meeple-chip-placing' : ''}`;
      dot.style.left = `${left}%`;
      dot.style.top = `${top}%`;
      dot.title = m.displayName || m.playerId;
      dot.innerHTML = buildMeepleSvg(colorSafe(m.color));
      overlay.appendChild(dot);
    });

    if (collapseOverflow) {
      const coord = coords[coords.length - 1];
      const extraCount = overflowCount - MAX_VISIBLE_OVERFLOW;
      const row = Math.floor((MAX_VISIBLE_OVERFLOW - 1) / GRID_COLS) + 2;
      const chip = document.createElement('div');
      chip.className = 'board-meeple-overflow-chip';
      chip.style.left = `${coord[0]}%`;
      chip.style.top = `${coord[1] + row * GRID_ROW_STEP}%`;
      chip.title = `${extraCount} more meeple(s) on this space`;
      chip.textContent = `+${extraCount}`;
      overlay.appendChild(chip);
    }
  });

  boardHubsContainer.appendChild(overlay);
  previousBoardMeepleInstanceIds = nextBoardMeepleInstanceIds;
}

let selectedDashboardTab = HUMAN_PLAYER_ID;

/**
 * buildCondensedOpponentPanel(dash)
 * ITEM: Opponent Dashboard Tabs — a compact summary instead of the full
 * physical-board panel, per the request: active Agents in roster, track
 * progression, available Meeples, Wallet balance. Reuses
 * buildAgentCardHtml for roster entries (same component the full panel
 * already uses) rather than a second, divergent agent-card renderer.
 */
function buildCondensedOpponentPanel(dash, dashboards) {
  const panel = document.createElement('div');
  panel.className = 'player-panel opponent-condensed-panel';
  panel.style.borderColor = colorSafe(dash.color);
  panel.style.setProperty('--player-accent', colorSafe(dash.color));

  const trackRow = (key, label) => {
    const m = dash.trackMeters.find((t) => t.key === key);
    if (!m) return '';
    return `<div class="condensed-track-row"><span class="condensed-track-label">${label}</span><div class="condensed-track-bar"><div class="condensed-track-fill" style="width:${Math.min(100, (m.value / 10) * 100)}%"></div></div><span class="condensed-track-value">${m.value}${m.max !== null ? '/' + m.max : ''}</span></div>`;
  };
  const officeMeter = dash.trackMeters.find((m) => m.key === 'offices');

  panel.innerHTML = `
    <div class="player-header">
      <span class="player-name">${dash.displayName}${dash.isBot ? ` (${botArchetypeTitle(dash.archetype)})` : ""}</span>
    </div>
    <div class="wallet-row"><span class="resource-chip resource-chip-profit">💰 ${dash.wallet.profitTokens} PT</span> <span class="resource-chip resource-chip-priority">⭐ ${dash.wallet.priorityTokens} Priority</span></div>
    <div class="condensed-tracks">
      ${trackRow('training', 'Training')}
      ${trackRow('technology', 'Technology')}
      ${trackRow('recognition', 'Recognition')}
    </div>
    <div class="meeples-row">👷 Meeples: ${dash.timeMeeples.availableCount}/${dash.timeMeeples.activeTotal} Available${dash.timeMeeples.staffInTrainingCount > 0 ? ` <span class="staff-in-training-badge">+${dash.timeMeeples.staffInTrainingCount} in training</span>` : ''}</div>
    <div class="hand-summary"><span class="resource-chip mini-chip">Hand ${dash.hand.summary.count}/${dash.hand.summary.maxHandSize}</span></div>
    <div class="roster-summary">Roster: ${dash.roster.count}/${dash.roster.capacity}${officeMeter ? ` (Offices ${officeMeter.value}${officeMeter.max !== null ? '/' + officeMeter.max : ''})` : ''}</div>
    <div class="roster-cards">${dash.roster.agents.map((a) => buildAgentCardHtml(a, { tooltip: buildAgentHoverTooltip(a, dashboards[HUMAN_PLAYER_ID], 0) })).join('')}</div>
  `;
  return panel;
}

function renderDashboardTabs(dashboards, vm) {
  const tabsEl = document.getElementById('dashboard-tabs');
  const order = [HUMAN_PLAYER_ID, ...Object.keys(dashboards).filter((pid) => pid !== HUMAN_PLAYER_ID)];
  tabsEl.innerHTML = order
    .map((pid, i) => {
      const dash = dashboards[pid];
      if (!dash) return '';
      const label = pid === HUMAN_PLAYER_ID ? 'YOU' : dash.isBot ? dash.displayName.split(' ')[0] : `RIVAL ${i}`;
      const isActive = pid === vm.meta.activePlayerId;
      const isSelected = selectedDashboardTab === pid;
      return `<button type="button" class="dashboard-tab${isSelected ? ' dashboard-tab-selected' : ''}${isActive ? ' dashboard-tab-active-turn' : ''}" data-tab-player-id="${pid}" style="--tab-accent:${colorSafe(dash.color)}">${label}${isActive ? ' ▸' : ''}</button>`;
    })
    .join('');
  tabsEl.querySelectorAll('.dashboard-tab').forEach((el) => {
    el.addEventListener('click', () => {
      selectedDashboardTab = el.dataset.tabPlayerId;
      renderDashboards(lastDashboards, lastVm);
    });
  });
}

let lastDashboards = null;
let lastVm = null;

function renderDashboards(dashboards, vm) {
  lastDashboards = dashboards;
  lastVm = vm;
  if (!dashboards[selectedDashboardTab]) {
    selectedDashboardTab = HUMAN_PLAYER_ID;
  }
  renderDashboardTabs(dashboards, vm);

  const container = document.getElementById('player-dashboards');
  container.innerHTML = '';

  const dash = dashboards[selectedDashboardTab];
  if (!dash) return;

  if (dash.playerId !== HUMAN_PLAYER_ID) {
    container.appendChild(buildCondensedOpponentPanel(dash, dashboards));
    return;
  }

  const isActive = dash.playerId === vm.meta.activePlayerId;
  const panel = document.createElement('div');
  panel.className = `player-panel ${isActive ? 'player-panel-active' : ''}`;
  panel.style.borderColor = colorSafe(dash.color);
  panel.style.setProperty('--player-accent', colorSafe(dash.color));

    const LEVELED_TRACK_KEYS = new Set(['training', 'technology', 'recognition']);

    // DEVIATION (explicit user direction, 2026): must match the real
    // engine's VENTURE_CAPITALIST_BONUS_SPACES in cardEffectHelpers.js
    // exactly — Level 3 removed, see that file's own comment for the
    // full context on this being a flagged deviation from the
    // previously rulebook-verified rule.
    const VC_BONUS_LEVELS = new Set([5, 7, 9]);

    function buildSplitTrackHtml(m) {
      const abilities = TECH_TRACK_ABILITY_CATALOG[m.key];
      const coords = PLAYER_BOARD_TRACK_COORDS[m.key];

      const trunkSpaces = [0, 1, 2, 3, 4]
        .map((lvl, i) => {
          const [left, top] = coords.trunk[i];
          const cls = `player-board-step trunk-step${m.value >= lvl ? ' filled' : ''}${m.value === lvl ? ' current-position' : ''}${VC_BONUS_LEVELS.has(lvl) ? ' vc-bonus-space' : ''}`;
          const tooltip = `Level ${lvl}${VC_BONUS_LEVELS.has(lvl) ? ' — Venture Capitalist bonus space' : ''}`;
          return `<div class="${cls}" data-track="${m.key}" style="left:${left}%;top:${top}%" title="${escapeAttr(tooltip)}"></div>`;
        })
        .join('');

      function buildBranchLane(branchKey) {
        const isChosen = m.branch === branchKey;
        const laneCoords = coords[branchKey === 'A' ? 'branchA' : 'branchB'];
        return [5, 6, 7, 8, 9, 10]
          .map((lvl, i) => {
            const [left, top] = laneCoords[i];
            const filled = isChosen && m.value >= lvl;
            const isCurrentPosition = isChosen && m.value === lvl;
            // Executed Token: this level was claimed once, but the cube is
            // now below it (a deficit downgrade pushed it back) — the real
            // rulebook marker for "already claimed, will not re-award."
            const isExecutedToken = isChosen && m.claimedMilestones.includes(lvl) && m.value < lvl;
            const abilityAtLevel = [5, 7, 9].includes(lvl) ? abilities[branchKey][lvl] : null;
            const isVcBonus = VC_BONUS_LEVELS.has(lvl);
            const tooltip = `Path ${branchKey}: ${abilityAtLevel ? `Level ${lvl} — ${abilityAtLevel.name}: ${abilityAtLevel.text}${isExecutedToken ? ' (already claimed — Executed Token)' : ''}` : `Level ${lvl}`}${isVcBonus ? ' — Venture Capitalist bonus space' : ''}`;
            const cls = `player-board-step branch-step${filled ? ' filled' : ''}${isCurrentPosition ? ' current-position' : ''}${isExecutedToken ? ' executed-token' : ''}${isVcBonus ? ' vc-bonus-space' : ''}${isChosen ? ' chosen-branch-step' : ' unchosen-branch-step'}`;
            return `<div class="${cls}" data-track="${m.key}" style="left:${left}%;top:${top}%" title="${escapeAttr(tooltip)}"></div>`;
          })
          .join('');
      }

      return `
        <h4 class="player-board-track-label">${m.label}${m.branch ? ` — Path ${m.branch}` : ''}: ${m.value}${m.max !== null ? '/' + m.max : ''}</h4>
        ${trunkSpaces}
        ${buildBranchLane('A')}
        ${buildBranchLane('B')}`;
    }

    function buildOfficeExpansionHtml(m) {
      const coords = PLAYER_BOARD_TRACK_COORDS.officeExpansion;
      const steps = coords
        .map(([left, top], lvl) => {
          const cls = `player-board-step office-expansion-step${m.value >= lvl ? ' filled' : ''}${m.value === lvl ? ' current-position' : ''}`;
          return `<div class="${cls}" style="left:${left}%;top:${top}%" title="Office slot ${lvl}"></div>`;
        })
        .join('');
      return steps;
    }

    function buildStaffReservoirHtml(dash) {
      const staffInTrainingCount = dash.timeMeeples.staffInTrainingCount || 0;
      const availableCount = dash.timeMeeples.availableCount || 0;
      const b1 = PLAYER_BOARD_TRACK_COORDS.staffInTraining;
      const b2 = PLAYER_BOARD_TRACK_COORDS.availableStaff;
      return `
        <div class="player-board-reservoir-count" style="left:${b1.left + b1.width / 2}%;top:${b1.top + b1.height / 2}%" title="Staff in Training — unavailable this round">${staffInTrainingCount}</div>
        <div class="player-board-reservoir-count" style="left:${b2.left + b2.width / 2}%;top:${b2.top + b2.height / 2}%" title="Available Staff — ready to place">${availableCount}</div>
      `;
    }

    const physicalBoardStepsHtml = ['training', 'technology', 'recognition']
      .map((key) => buildSplitTrackHtml(dash.trackMeters.find((m) => m.key === key)))
      .join('');
    const officeMeter = dash.trackMeters.find((m) => m.key === 'offices');
    const officeExpansionHtml = officeMeter ? buildOfficeExpansionHtml(officeMeter) : '';
    const staffReservoirHtml = buildStaffReservoirHtml(dash);

    const canPlayFromHand =
      dash.playerId === HUMAN_PLAYER_ID &&
      vm.pendingInterrupt &&
      vm.pendingInterrupt.type === 'ACTION_SPACE_DEFERRED_CHOICE' &&
      vm.pendingInterrupt.spaceType === 'acquire_or_play_action_card' &&
      vm.pendingInterrupt.sourcePlayerId === HUMAN_PLAYER_ID;

    // FIX (Fog of War): opponent hands (bots and other human players)
    // must never reveal real card identities to the active human. Only
    // the human's own hand renders real card faces; every other
    // player's hand renders as face-down card backs with a count.
    const handCards =
      dash.playerId === HUMAN_PLAYER_ID
        ? dash.hand.cards.map((c) => buildHandCardHtml(c, dash, canPlayFromHand)).join('')
        : `<div class="hand-card-facedown-group" title="${dash.hand.cards.length} card${dash.hand.cards.length === 1 ? '' : 's'} in hand — hidden">${Array.from(
            { length: dash.hand.cards.length },
            () => '<div class="hand-card hand-card-facedown"></div>'
          ).join('')}</div>`;

    panel.innerHTML = `
      <div class="player-header">
        <span class="player-name">${dash.displayName}${dash.isBot ? ` (${botArchetypeTitle(dash.archetype)})` : ""}</span>
      </div>
      <div class="player-board-graphic">
        ${physicalBoardStepsHtml}
        ${officeExpansionHtml}
        ${staffReservoirHtml}
      </div>
      <div class="wallet-row"><span class="resource-chip resource-chip-profit">💰 ${dash.wallet.profitTokens} PT</span> <span class="resource-chip resource-chip-priority" title="Initiative score — determines player turn order sorting after the bidding phase.">⭐ ${dash.wallet.priorityTokens} Priority</span></div>
      <div class="meeples-row" title="${dash.timeMeeples.staffInTrainingCount > 0 ? `${dash.timeMeeples.staffInTrainingCount} Staff in Training — available next round` : ''}">
        ${
          dash.playerId === HUMAN_PLAYER_ID
            ? buildDraggableMeepleRowHtml(dash)
            : `👷 Meeples: ${dash.timeMeeples.availableCount}/${dash.timeMeeples.activeTotal} Available${
                dash.timeMeeples.staffInTrainingCount > 0 ? ` <span class="staff-in-training-badge">+${dash.timeMeeples.staffInTrainingCount} in training</span>` : ''
              }`
        }
      </div>
      <div class="hand-summary">
        <span class="resource-chip mini-chip">Hand ${dash.hand.summary.count}/${dash.hand.summary.maxHandSize}</span>
        <span class="resource-chip mini-chip" title="Personal draw pile">🂠 ${dash.hand.summary.drawPileCount}</span>
        <span class="resource-chip mini-chip" title="Personal discard pile">🗑 ${dash.hand.summary.discardPileCount}</span>
      </div>
      <div class="hand-cards">${handCards}</div>
      <div class="roster-summary">Roster: ${dash.roster.count}/${dash.roster.capacity}</div>
      <div class="roster-cards">${dash.roster.agents
        .map((a) => buildAgentCardHtml(a, { tooltip: buildAgentHoverTooltip(a, dashboards[HUMAN_PLAYER_ID], 0) }))
        .join('')}</div>
      ${buildBankedTokensInventoryHtml(dash, vm)}
      ${buildShellCompanyStashHtml(dash)}
      ${buildMilestoneAbilitiesHtml(dash, vm)}
    `;

    if (dash.playerId === HUMAN_PLAYER_ID) {
      panel.querySelectorAll('.hand-card-playable').forEach((el) => {
        el.addEventListener('click', () => handleHandCardClick(el.dataset.instanceId));
      });
      panel.querySelectorAll('.banked-token-chip-clickable[data-token-type]').forEach((el) => {
        el.addEventListener('click', () => handleBankedTokenClick(el.dataset.tokenType));
      });
      panel.querySelectorAll('.banked-token-chip-clickable[data-stash-instance-id]').forEach((el) => {
        el.addEventListener('click', () => handleShellCompanySecondRecruit(el.dataset.stashInstanceId));
      });
      const overtimeBtn = panel.querySelector('#overtime-manager-btn');
      if (overtimeBtn) {
        overtimeBtn.addEventListener('click', () => {
          pendingOvertimeManager = !pendingOvertimeManager;
          pendingLiquidityStaffPT = false;
          pendingFreeAction = false;
          render();
        });
      }
      const liquidityBtn = panel.querySelector('#liquidity-staff-pt-btn');
      if (liquidityBtn) {
        liquidityBtn.addEventListener('click', () => {
          pendingLiquidityStaffPT = !pendingLiquidityStaffPT;
          pendingOvertimeManager = false;
          pendingFreeAction = false;
          render();
        });
      }
      const proprietaryBtn = panel.querySelector('#proprietary-algorithm-btn');
      if (proprietaryBtn) {
        proprietaryBtn.addEventListener('click', () => {
          clientModalState = { type: 'PROPRIETARY_ALGORITHM' };
          render();
        });
      }
      const liquidationBtn = panel.querySelector('#liquidation-engine-btn');
      if (liquidationBtn) {
        liquidationBtn.addEventListener('click', () => {
          clientModalState = { type: 'LIQUIDATION_ENGINE' };
          render();
        });
      }
    }

  container.appendChild(panel);
}

function renderHistory(historyTicker) {
  const el = document.getElementById('history-ticker');
  // Log messages are generated deep inside individual card handlers using
  // raw playerId strings ("p3's Brokerage Expansion...") — fixing that at
  // the source would mean touching the entire 176-card handler registry,
  // real risk to already-tested logic for a display-only change. This
  // substitutes playerId -> real bot/human name at render time instead,
  // using the same dashboards reference the tab system already tracks.
  const nameById = {};
  if (lastDashboards) {
    Object.keys(lastDashboards).forEach((pid) => {
      nameById[pid] = lastDashboards[pid].displayName;
    });
  }
  function substituteNames(text) {
    if (!text || Object.keys(nameById).length === 0) return text;
    return text.replace(/\bp[1-6]\b/g, (match) => nameById[match] || match);
  }
  el.innerHTML = historyTicker
    .slice(-30)
    .reverse()
    .map((node) => `<div class="ticker-line"><span class="ticker-round">R${node.round}</span> ${substituteNames(node.displayText)}</div>`)
    .join('');
}

function interruptKey(modal) {
  if (!modal.active) return null;
  return `${modal.sourcePlayerId}:${modal.choiceType || modal.promptText}`;
}

function renderPendingBanner(modal) {
  const banner = document.getElementById('pending-choice-banner');
  const key = interruptKey(modal);
  const isHidden = modal.active && dismissedInterruptKey === key;

  if (!isHidden) {
    banner.style.display = 'none';
    banner.innerHTML = '';
    return;
  }

  banner.style.display = 'flex';
  banner.innerHTML = `<span>${modal.headerText}: ${modal.promptText}</span><button id="resume-choice-btn">Resume</button>`;
  document.getElementById('resume-choice-btn').addEventListener('click', () => {
    dismissedInterruptKey = null;
    render();
  });
}

function renderOverlay(modal, humanDash, openMarketActionCards, vm, dashboards) {
  const overlayEl = document.getElementById('interrupt-overlay');

  // Human Turn Order bidding — a distinct phase.current state, not a
  // pendingInterrupt, so it's checked first and independently of the
  // normal interrupt-key/dismissal machinery below. Confirmed real gap
  // fixed this session: the engine now genuinely pauses here for every
  // player's bid instead of silently resolving with empty values.
  const humanPlayerVm = vm.players[HUMAN_PLAYER_ID];
  if (vm.meta.phase === 'TURN_ORDER_BIDDING' && humanPlayerVm && !humanPlayerVm.turnOrderBid.submitted) {
    renderTurnOrderBiddingModal(overlayEl, humanDash);
    return;
  }

  // Shift Card resolution — a genuine, non-dismissable pause (no Hide
  // button, no auto-close): the engine now actually blocks all other
  // actions while this interrupt is pending (see PENDING_INTERRUPT_ACTIVE
  // in workerPlacementValidation.js), so every connected client sees the
  // exact same frozen state via the normal broadcast mechanism — no new
  // multiplayer sync needed beyond what state-sharing already does.
  if (vm.pendingInterrupt && vm.pendingInterrupt.type === 'SHIFT_CARD_RESOLUTION') {
    renderShiftCardResolutionModal(overlayEl, vm, humanDash);
    return;
  }

  // The Lobbyist (SPEC_3) — a real player choice of which hub to block,
  // replacing the old auto-pick-the-biggest-hub default. Same
  // special-case pattern as the Shift Card modal above, for the same
  // reason: no existing case in buildInterruptOverlayModal matches this
  // new choice type.
  if (vm.pendingInterrupt && vm.pendingInterrupt.type === 'ACTION_CARD_EFFECT_CHOICE' && vm.pendingInterrupt.isSpecialistCardChoice) {
    renderSpecialistCardChoiceModal(overlayEl, vm, humanDash);
    return;
  }

  const key = interruptKey(modal);

  renderPendingBanner(modal);

  if (!modal.active || dismissedInterruptKey === key) {
    overlayEl.style.display = 'none';
    overlayEl.innerHTML = '';
    return;
  }

  overlayEl.style.display = 'flex';

  const hideButtonHtml = `<div class="modal-actions"><button class="modal-hide-btn" id="interrupt-hide-btn">Hide (choice still pending)</button></div>`;
  const cancelButtonHtml = `<button class="modal-cancel-btn" id="interrupt-cancel-btn">Cancel Action (return meeple)</button>`;

  if (modal.mode === 'HAND_SELECTION_HINT') {
    // The actual fix for the soft-lock: render the human's playable hand
    // cards INSIDE the modal itself, so the backdrop never has anything
    // to block — the player can always act from right here, instead of
    // needing to click through to a dashboard panel behind the overlay.
    const isForHuman = modal.sourcePlayerId === HUMAN_PLAYER_ID && humanDash;
    const handIsEmpty = isForHuman && humanDash.hand.cards.length === 0;

    let cardsHtml;
    if (!isForHuman) {
      cardsHtml = '<p><em>Waiting on another player…</em></p>';
    } else if (handIsEmpty) {
      // MODAL RENDER SAFETY: an empty candidate list used to render a
      // silently blank modal with nothing to click — a real soft-lock.
      // Now shows an explicit, honest state and a real Skip action
      // (wired to actionCardReducer.js's new empty-hand resolution path,
      // not decorative) instead of zero selectable options.
      cardsHtml = '<p class="empty-hand-message">No cards in hand to play.</p>';
    } else {
      cardsHtml = humanDash.hand.cards.map((c) => buildHandCardHtml(c, humanDash, true)).join('');
    }

    const skipButtonHtml = handIsEmpty ? '<button id="interrupt-skip-btn" class="modal-skip-btn">No cards available — Skip</button>' : '';

    // ACQUIRE SECTION: the second half of this space's real dual choice
    // (rulebook: "Prompt choice: [Acquire an Action Card] or [Play an
    // Action Card]"). Pulls from the REAL shared Open Market row
    // (state.board.openMarketActionCards), not the player's own pile —
    // confirmed against the rulebook before building this. Each face-up
    // market card is its own clickable acquire option.
    const marketCards = openMarketActionCards || [];
    const acquireSectionHtml =
      isForHuman && marketCards.length > 0
        ? `
      <div class="modal-divider">— or —</div>
      <div class="modal-acquire-section">
        <p class="modal-acquire-label">Acquire an Action Card from the Open Market:</p>
        <div class="modal-hand-cards">
          ${marketCards
            .map((c) => {
              const catalogActionCards = (catalog && catalog.actionCards) || {};
              const cardImage = !c.isPlaceholder && catalogActionCards[c.catalogId] ? catalogActionCards[c.catalogId].cardImage : null;
              const family = !c.isPlaceholder && catalogActionCards[c.catalogId] ? catalogActionCards[c.catalogId].family : null;
              const fallbackInner = `<div class="market-card-family-header">${family || ''}</div>
                ${buildPortraitHtml(null, c.name, 'action-cards')}
                <div class="hand-card-name">${c.name}</div><div class="hand-card-cost">$${c.cost}</div>`;
              return `
            <div class="hand-card ${c.isPlaceholder ? 'hand-card-placeholder' : 'hand-card-acquirable'}" data-family="${family || ''}" data-market-catalog-id="${c.catalogId}" title="${escapeAttr(
                buildCardHoverTooltip(c, humanDash)
              )}">
              ${c.isPlaceholder ? '<div class="hand-card-blank">?</div>' : buildFullCardImageHtml(cardImage, 'action-cards', fallbackInner)}
            </div>`;
            })
            .join('')}
        </div>
      </div>`
        : '';

    overlayEl.innerHTML = `
      <div class="modal-box">
        <h3>${modal.headerText}</h3>
        <p>${modal.promptText}</p>
        <div class="modal-hand-cards">${cardsHtml}</div>
        <div class="modal-actions">${skipButtonHtml}${isForHuman ? cancelButtonHtml : ''}</div>
        ${acquireSectionHtml}
        ${hideButtonHtml}
      </div>
    `;

    if (isForHuman) {
      const cancelBtn = overlayEl.querySelector('#interrupt-cancel-btn');
      if (cancelBtn) {
        cancelBtn.addEventListener('click', () => handleCancelDeferredAction());
      }
    }

    if (handIsEmpty) {
      document.getElementById('interrupt-skip-btn').addEventListener('click', () => {
        dismissedInterruptKey = null;
        handleHandCardClick(null); // null = the real, engine-resolved "nothing to play" skip
      });
    }

    if (isForHuman) {
      overlayEl.querySelectorAll('.hand-card-playable').forEach((el) => {
        el.addEventListener('click', () => {
          dismissedInterruptKey = null;
          handleHandCardClick(el.dataset.instanceId);
        });
      });

      overlayEl.querySelectorAll('.hand-card-acquirable').forEach((el) => {
        el.addEventListener('click', () => {
          dismissedInterruptKey = null;
          handleAcquireActionCard(el.dataset.marketCatalogId);
        });
      });
    }
  } else if (modal.mode === 'AGENT_ACTION_HINT') {
    const isForHuman = modal.sourcePlayerId === HUMAN_PLAYER_ID && humanDash && vm;
    let bodyHtml = '<p><em>Waiting on another player…</em></p>';

    if (isForHuman && modal.spaceId === 'GRW_RECRUIT_AGENT') {
      const agents = vm.board.openMarketAgents || [];
      const deskFull = modal.deskStatus && modal.deskStatus.hasOpenDesk === false;
      const deskWarningHtml = deskFull
        ? `<p class="roster-full-warning">⚠️ Office Capacity Reached (${modal.deskStatus.deskUsed}/${modal.deskStatus.deskCapacity} Unlocked Desks Occupied — Expand Offices via Leadership to hire more)</p>`
        : '';
      bodyHtml =
        agents.length === 0
          ? '<p class="empty-hand-message">The Open Market is empty.</p>'
          : `${deskWarningHtml}<div class="agent-candidate-grid">${agents
              .map((a) =>
                buildAgentCardHtml(a, {
                  clickable: !deskFull,
                  dataAttr: `data-agent-catalog-id="${a.catalogId}"`,
                  tooltip: deskFull
                    ? `${buildAgentHoverTooltip(a, humanDash, 1)}\n✗ Roster full — no open desk`
                    : buildAgentHoverTooltip(a, humanDash, 1),
                })
              )
              .join('')}</div>`;
    } else if (isForHuman && modal.spaceId === 'GRW_POACH_AGENT') {
      const targets = [];
      Object.keys(dashboards).forEach((pid) => {
        if (pid === HUMAN_PLAYER_ID) return;
        const rivalDash = dashboards[pid];
        rivalDash.roster.agents
          .filter((r) => !r.isVoided)
          .forEach((r) => {
            targets.push({ agent: r, ownerId: pid, ownerName: rivalDash.displayName });
          });
      });
      bodyHtml =
        targets.length === 0
          ? '<p class="empty-hand-message">No rival Agents are currently poachable.</p>'
          : `<div class="agent-candidate-grid">${targets
              .map(({ agent, ownerId, ownerName }) => {
                const blocked = agent.hasOnboardingToken || agent.hasLoyaltyToken;
                return `<div class="agent-candidate-wrapper">
                  ${buildAgentCardHtml(agent, {
                    clickable: !blocked,
                    dataAttr: `data-target-player-id="${ownerId}" data-target-agent-instance-id="${agent.agentInstanceId}"`,
                    tooltip: buildAgentHoverTooltip(agent, humanDash, 2) + `\nOwner: ${ownerName}`,
                  })}
                  <div class="agent-owner-label">${ownerName}</div>
                </div>`;
              })
              .join('')}</div>`;
    } else if (isForHuman && modal.spaceId === 'GRW_LOYALTY_TOKEN') {
      const humanVmPlayer = vm.players[HUMAN_PLAYER_ID];
      const tokensMaxed = humanVmPlayer.loyaltyTokensUsed >= humanVmPlayer.loyaltyTokensMax;
      const eligible = humanVmPlayer.roster.filter((r) => !r.isVoided && !(r.loyaltyToken && r.loyaltyToken.active));
      const loyalAgents = humanVmPlayer.roster.filter((r) => !r.isVoided && r.loyaltyToken && r.loyaltyToken.active);

      if (!tokensMaxed) {
        bodyHtml =
          eligible.length === 0
            ? '<p class="empty-hand-message">No Agents on your roster yet.</p>'
            : `<p class="modal-acquire-label">Place (${humanVmPlayer.loyaltyTokensUsed}/${humanVmPlayer.loyaltyTokensMax} used):</p><div class="agent-candidate-grid">${eligible
                .map((a) => buildAgentCardHtml(a, { clickable: true, dataAttr: `data-agent-instance-id="${a.agentInstanceId}"`, tooltip: buildAgentHoverTooltip(a, humanDash, 3) }))
                .join('')}</div>`;
      } else {
        bodyHtml = `<p class="modal-acquire-label">All 3 Loyalty Tokens deployed — select which one to move, then the new target:</p>
          <p class="modal-acquire-label">Currently Loyal:</p>
          <div class="agent-candidate-grid">${loyalAgents
            .map((a) => buildAgentCardHtml(a, { clickable: true, dataAttr: `data-from-agent-instance-id="${a.agentInstanceId}"`, tooltip: buildAgentHoverTooltip(a, humanDash, 3) }))
            .join('')}</div>
          <p class="modal-acquire-label">New target:</p>
          <div class="agent-candidate-grid">${eligible
            .map((a) => buildAgentCardHtml(a, { clickable: true, dataAttr: `data-agent-instance-id="${a.agentInstanceId}"`, tooltip: buildAgentHoverTooltip(a, humanDash, 3) }))
            .join('')}</div>`;
      }
    }

    overlayEl.innerHTML = `
      <div class="modal-box">
        <h3>${modal.headerText}</h3>
        <p>${modal.promptText}</p>
        ${bodyHtml}
        <div class="modal-actions">${isForHuman ? cancelButtonHtml : ''}</div>
        ${hideButtonHtml}
      </div>
    `;

    if (isForHuman) {
      const cancelBtn = overlayEl.querySelector('#interrupt-cancel-btn');
      if (cancelBtn) {
        cancelBtn.addEventListener('click', () => handleCancelDeferredAction());
      }
    }

    if (isForHuman && modal.spaceId === 'GRW_RECRUIT_AGENT') {
      overlayEl.querySelectorAll('.agent-card-clickable').forEach((el) => {
        el.addEventListener('click', () => handleRecruitAgent(el.dataset.agentCatalogId));
      });
    } else if (isForHuman && modal.spaceId === 'GRW_POACH_AGENT') {
      overlayEl.querySelectorAll('.agent-card-clickable').forEach((el) => {
        el.addEventListener('click', () => handlePoachAgent(el.dataset.targetPlayerId, el.dataset.targetAgentInstanceId));
      });
    } else if (isForHuman && modal.spaceId === 'GRW_LOYALTY_TOKEN') {
      const humanVmPlayerForListeners = vm.players[HUMAN_PLAYER_ID];
      const tokensMaxed = humanVmPlayerForListeners.loyaltyTokensUsed >= humanVmPlayerForListeners.loyaltyTokensMax;
      if (!tokensMaxed) {
        overlayEl.querySelectorAll('.agent-card-clickable[data-agent-instance-id]').forEach((el) => {
          el.addEventListener('click', () => handlePlaceLoyaltyToken(el.dataset.agentInstanceId, null));
        });
      } else {
        // MOVE mode: two-step selection — pick the FROM agent, then the target.
        let selectedFrom = null;
        overlayEl.querySelectorAll('.agent-card-clickable[data-from-agent-instance-id]').forEach((el) => {
          el.addEventListener('click', () => {
            selectedFrom = el.dataset.fromAgentInstanceId;
            overlayEl.querySelectorAll('.agent-card-clickable[data-from-agent-instance-id]').forEach((e) => e.classList.remove('agent-card-selected'));
            el.classList.add('agent-card-selected');
          });
        });
        overlayEl.querySelectorAll('.agent-card-clickable[data-agent-instance-id]').forEach((el) => {
          el.addEventListener('click', () => {
            if (!selectedFrom) {
              logLine('Select which Agent to move the Loyalty Token FROM first.');
              return;
            }
            handlePlaceLoyaltyToken(el.dataset.agentInstanceId, selectedFrom);
          });
        });
      }
    }
  } else if (modal.mode === 'START_CARD_CHOICE_HINT') {
    const isForHuman = modal.sourcePlayerId === HUMAN_PLAYER_ID && humanDash;
    const bodyHtml = !isForHuman ? '<p><em>Waiting on another player…</em></p>' : buildStartCardChoiceBodyHtml(modal, humanDash, vm);

    overlayEl.innerHTML = `
      <div class="modal-box">
        <h3>${modal.headerText}</h3>
        <p>${modal.promptText}</p>
        ${bodyHtml}
      </div>
    `;

    if (isForHuman) {
      wireStartCardChoiceHandlers(modal.choiceType, modal.requiredCount);
    }
  } else if (modal.mode === 'CRM_UPDATE_HINT') {
    const isForHuman = modal.sourcePlayerId === HUMAN_PLAYER_ID && humanDash;
    const agentCandidates = modal.agentCandidates || [];
    const bodyHtml = !isForHuman
      ? '<p><em>Waiting on another player…</em></p>'
      : `<div class="agent-candidate-grid">${agentCandidates
          .map((a) =>
            buildAgentCardHtml(a, {
              clickable: true,
              dataAttr: `data-agent-catalog-id="${a.catalogId}"`,
              tooltip: buildAgentHoverTooltip(a, humanDash, 1),
            })
          )
          .join('')}</div>`;

    overlayEl.innerHTML = `
      <div class="modal-box">
        <h3>${modal.headerText}</h3>
        <p>${modal.promptText}</p>
        ${bodyHtml}
        ${hideButtonHtml}
      </div>
    `;

    if (isForHuman) {
      overlayEl.querySelectorAll('.agent-card-clickable').forEach((el) => {
        el.addEventListener('click', () => handleCrmUpdateChoice(el.dataset.agentCatalogId));
      });
    }
  } else if (modal.mode === 'TRACK_BRANCH_CHOICE_HINT') {
    const isForHuman = modal.sourcePlayerId === HUMAN_PLAYER_ID;
    const trackName = modal.trackName;
    const abilities = TECH_TRACK_ABILITY_CATALOG[trackName];

    function buildBranchPreviewHtml(branchKey) {
      const branch = abilities[branchKey];
      return `
        <div class="branch-choice-card" data-branch="${branchKey}">
          <div class="branch-choice-header">Path ${branchKey}: ${branch.label}</div>
          <div class="branch-choice-level"><span class="branch-level-badge">Lv 5</span> <strong>${branch[5].name}</strong><p>${branch[5].text}</p></div>
          <div class="branch-choice-level"><span class="branch-level-badge">Lv 7</span> <strong>${branch[7].name}</strong><p>${branch[7].text}</p></div>
          <div class="branch-choice-level"><span class="branch-level-badge">Lv 9</span> <strong>${branch[9].name}</strong><p>${branch[9].text}</p></div>
          <button type="button" class="branch-choice-select-btn" data-branch="${branchKey}">Choose Path ${branchKey}</button>
        </div>`;
    }

    const bodyHtml = !isForHuman
      ? '<p><em>Waiting on another player…</em></p>'
      : `<p class="branch-choice-permanent-warning">⚠️ This choice is permanent for the rest of the game.</p>
        <div class="branch-choice-grid">${buildBranchPreviewHtml('A')}${buildBranchPreviewHtml('B')}</div>`;

    overlayEl.innerHTML = `
      <div class="modal-box branch-choice-modal-box">
        <h3>${modal.headerText}</h3>
        <p>${modal.promptText}</p>
        ${bodyHtml}
      </div>
    `;

    if (isForHuman) {
      overlayEl.querySelectorAll('.branch-choice-select-btn').forEach((btn) => {
        btn.addEventListener('click', () => handleTrackBranchChoice(trackName, btn.dataset.branch));
      });
    }
  } else if (modal.mode === 'TRACK_MILESTONE_CHOICE_HINT') {
    const isForHuman = modal.sourcePlayerId === HUMAN_PLAYER_ID;
    const { milestoneKey, trackName, level } = modal;
    const abilityName = MILESTONE_KEY_TO_ABILITY_NAME[milestoneKey] || milestoneKey;

    const bodyHtml = !isForHuman
      ? '<p><em>Waiting on another player…</em></p>'
      : buildMilestoneChoiceBodyHtml(milestoneKey, vm, humanDash, dashboards);

    overlayEl.innerHTML = `
      <div class="modal-box">
        <h3>${modal.headerText} — ${abilityName}</h3>
        <p>${modal.promptText}</p>
        ${bodyHtml}
        ${isForHuman ? '<div class="modal-actions"><button class="modal-hide-btn" id="milestone-forfeit-btn">Forfeit (cannot resolve)</button></div>' : ''}
      </div>
    `;

    if (isForHuman) {
      wireMilestoneChoiceHandlers(milestoneKey);
      const forfeitBtn = overlayEl.querySelector('#milestone-forfeit-btn');
      if (forfeitBtn) {
        forfeitBtn.addEventListener('click', () => handleForfeitTrackMilestone(milestoneKey));
      }
    }
  } else if (modal.mode === 'DEFICIT_TRACK_CHOICE_HINT') {
    const isForHuman = modal.sourcePlayerId === HUMAN_PLAYER_ID;
    const TRACK_LABELS = { training: 'Training', technology: 'Technology', recognition: 'Recognition' };

    const bodyHtml = !isForHuman
      ? '<p><em>Waiting on another player…</em></p>'
      : `<div class="deficit-choice-list">${Object.keys(TRACK_LABELS)
          .map((trackKey) => {
            const currentValue = humanDash.trackMeters.find((m) => m.key === trackKey).value;
            const disabled = currentValue === 0;
            return `<button type="button" class="deficit-choice-track-option${disabled ? ' disabled' : ''}" data-track="${trackKey}" ${disabled ? 'disabled' : ''}>
              <span>${TRACK_LABELS[trackKey]}</span>
              <span>${currentValue} → ${disabled ? currentValue : currentValue - 1}</span>
            </button>`;
          })
          .join('')}</div>`;

    overlayEl.innerHTML = `
      <div class="modal-box">
        <h3>${modal.headerText}</h3>
        <p>${modal.promptText}</p>
        ${bodyHtml}
      </div>
    `;

    if (isForHuman) {
      overlayEl.querySelectorAll('.deficit-choice-track-option:not(.disabled)').forEach((btn) => {
        btn.addEventListener('click', () => handleDeficitTrackChoice(btn.dataset.track));
      });
    }
  } else if (modal.mode === 'DUAL_TRACK_CHOICE_HINT') {
    const isForHuman = modal.sourcePlayerId === HUMAN_PLAYER_ID;
    const TRACK_LABELS = { training: 'Training', technology: 'Technology', recognition: 'Recognition' };
    const bodyHtml = !isForHuman
      ? '<p><em>Waiting on another player…</em></p>'
      : `<p class="modal-acquire-label">Allocate 2 points however you like — both on one track, or split across two.</p>
        <div class="dual-track-stepper-grid">${Object.keys(TRACK_LABELS)
          .map(
            (trackKey) => `
          <div class="dual-track-stepper-row" data-track="${trackKey}">
            <span class="dual-track-stepper-label">${TRACK_LABELS[trackKey]}</span>
            <button type="button" class="dual-track-stepper-btn dual-track-stepper-minus" data-track="${trackKey}">−</button>
            <span class="dual-track-stepper-count" data-track="${trackKey}">0</span>
            <button type="button" class="dual-track-stepper-btn dual-track-stepper-plus" data-track="${trackKey}">+</button>
          </div>`
          )
          .join('')}</div>
        <div class="modal-actions"><button class="modal-skip-btn" id="dual-track-confirm-btn" disabled>Confirm</button></div>`;

    overlayEl.innerHTML = `
      <div class="modal-box">
        <h3>${modal.headerText}</h3>
        <p>${modal.promptText}</p>
        ${bodyHtml}
        ${hideButtonHtml}
      </div>
    `;

    if (isForHuman) {
      const counts = { training: 0, technology: 0, recognition: 0 };
      const confirmBtn = overlayEl.querySelector('#dual-track-confirm-btn');

      function refreshStepperUi() {
        const total = counts.training + counts.technology + counts.recognition;
        Object.keys(counts).forEach((trackKey) => {
          overlayEl.querySelector(`.dual-track-stepper-count[data-track="${trackKey}"]`).textContent = counts[trackKey];
          overlayEl.querySelector(`.dual-track-stepper-minus[data-track="${trackKey}"]`).disabled = counts[trackKey] <= 0;
          overlayEl.querySelector(`.dual-track-stepper-plus[data-track="${trackKey}"]`).disabled = total >= 2;
        });
        confirmBtn.disabled = total !== 2;
      }

      overlayEl.querySelectorAll('.dual-track-stepper-plus').forEach((btn) => {
        btn.addEventListener('click', () => {
          const trackKey = btn.dataset.track;
          const total = counts.training + counts.technology + counts.recognition;
          if (total < 2) {
            counts[trackKey] += 1;
            refreshStepperUi();
          }
        });
      });
      overlayEl.querySelectorAll('.dual-track-stepper-minus').forEach((btn) => {
        btn.addEventListener('click', () => {
          const trackKey = btn.dataset.track;
          if (counts[trackKey] > 0) {
            counts[trackKey] -= 1;
            refreshStepperUi();
          }
        });
      });

      confirmBtn.addEventListener('click', () => {
        const allocated = Object.keys(counts).filter((trackKey) => counts[trackKey] > 0);
        const [trackA, trackB] =
          allocated.length === 1 ? [allocated[0], allocated[0]] : [allocated[0], allocated[1]];
        if (trackA && trackB) {
          handleDualTrackChoice(trackA, trackB);
        }
      });
    }
  } else if (modal.mode === 'HIRE_COACH_HINT') {
    const isForHuman = modal.sourcePlayerId === HUMAN_PLAYER_ID && humanDash;
    const candidates = isForHuman && humanDash.roster && humanDash.roster.agents ? humanDash.roster.agents.filter((a) => a.resolved === true || a.isPlaceholder === false) : [];
    const bodyHtml = !isForHuman
      ? '<p><em>Waiting on another player…</em></p>'
      : candidates.length === 0
        ? '<p class="empty-hand-message">No Agents on your roster yet — the Coach Token is banked for later use.</p><div class="modal-actions"><button type="button" class="modal-skip-btn" id="hire-coach-skip-btn">Continue</button></div>'
        : `<div class="agent-candidate-grid">${candidates
            .map((a) => buildAgentCardHtml(a, { clickable: true, dataAttr: `data-target-agent-instance-id="${a.agentInstanceId}"`, tooltip: a.name }))
            .join('')}</div>`;

    overlayEl.innerHTML = `
      <div class="modal-box">
        <h3>${modal.headerText}</h3>
        <p>${modal.promptText}</p>
        ${bodyHtml}
      </div>
    `;

    if (isForHuman) {
      overlayEl.querySelectorAll('.agent-card-clickable[data-target-agent-instance-id]').forEach((el) => {
        el.addEventListener('click', () => handleHireCoachChoice(el.dataset.targetAgentInstanceId));
      });
      const skipBtn = overlayEl.querySelector('#hire-coach-skip-btn');
      if (skipBtn) skipBtn.addEventListener('click', () => handleHireCoachChoice(null));
    }
  } else if (modal.mode === 'CLEAR_OPEN_MARKET_HINT') {
    const isForHuman = modal.sourcePlayerId === HUMAN_PLAYER_ID;
    const bodyHtml = !isForHuman
      ? '<p><em>Waiting on another player…</em></p>'
      : `
        <div class="modal-actions" style="flex-direction: column; gap: 8px;">
          <button type="button" class="modal-skip-btn" id="clear-market-wipe-both-btn">Wipe ALL Agent and Action Cards</button>
          <button type="button" class="modal-skip-btn" id="clear-market-wipe-action-free-btn">Wipe Action Cards ONLY + Take 1 Free Action Card</button>
          <button type="button" class="modal-skip-btn" id="clear-market-wipe-agent-free-btn">Wipe Agent Cards ONLY + Take 1 Free Action Card</button>
        </div>
      `;

    overlayEl.innerHTML = `
      <div class="modal-box">
        <h3>${modal.headerText}</h3>
        <p>${modal.promptText}</p>
        ${bodyHtml}
      </div>
    `;

    if (isForHuman) {
      overlayEl.querySelector('#clear-market-wipe-both-btn').addEventListener('click', () => handleClearOpenMarketChoice('wipe_both'));
      overlayEl.querySelector('#clear-market-wipe-action-free-btn').addEventListener('click', () => handleClearOpenMarketChoice('wipe_action_and_take_free'));
      overlayEl.querySelector('#clear-market-wipe-agent-free-btn').addEventListener('click', () => handleClearOpenMarketChoice('wipe_agent_and_take_free_action'));
    }
  } else if (modal.mode === 'CLEAR_OPEN_MARKET_PICK_CARD_HINT') {
    const isForHuman = modal.sourcePlayerId === HUMAN_PLAYER_ID;
    const catalogActionCardsClear = (catalog && catalog.actionCards) || {};
    const row = modal.openMarketActionCardRow || [];
    const bodyHtml = !isForHuman
      ? '<p><em>Waiting on another player…</em></p>'
      : row.length === 0
        ? '<p class="empty-hand-message">The Open Market row is empty — nothing to take.</p>'
        : `<div class="modal-hand-cards">${row
            .map((c) => `<button type="button" class="modal-skip-btn" data-picked-catalog-id="${c.catalogId}">${escapeAttr((catalogActionCardsClear[c.catalogId] && catalogActionCardsClear[c.catalogId].name) || c.catalogId)}</button>`)
            .join('')}</div>`;

    overlayEl.innerHTML = `
      <div class="modal-box">
        <h3>${modal.headerText}</h3>
        <p>${modal.promptText}</p>
        ${bodyHtml}
      </div>
    `;

    if (isForHuman) {
      overlayEl.querySelectorAll('[data-picked-catalog-id]').forEach((el) => {
        el.addEventListener('click', () => handleClearOpenMarketFreeCardPick(el.dataset.pickedCatalogId));
      });
    }
  } else if (modal.mode !== 'CONFIRMABLE_SELECTION') {
    // UNKNOWN_HINT — an interrupt type this UI doesn't have a selection
    // screen for yet. Informational only, same reasoning as
    // HAND_SELECTION_HINT: nothing here for a Confirm button to submit.
    overlayEl.innerHTML = `
      <div class="modal-box">
        <h3>${modal.headerText}</h3>
        <p>${modal.promptText}</p>
        ${hideButtonHtml}
      </div>
    `;
  } else {
    const candidatesHtml = modal.candidates
      .map(
        (c) => `
        <label class="candidate-option">
          <input type="checkbox" value="${c.instanceId}" />
          ${c.isPlaceholder ? '<span class="hand-card-blank">?</span>' : `<span>${c.name} ($${c.cost})</span>`}
        </label>`
      )
      .join('');

    overlayEl.innerHTML = `
      <div class="modal-box">
        <h3>${modal.headerText}</h3>
        <p>${modal.promptText}</p>
        <div class="candidate-list">${candidatesHtml}</div>
        <div class="modal-actions">
          <button class="modal-hide-btn" id="interrupt-hide-btn">Hide (choice still pending)</button>
          <button id="interrupt-confirm-btn">Confirm</button>
        </div>
      </div>
    `;

    document.getElementById('interrupt-confirm-btn').addEventListener('click', () => {
      const checked = Array.from(overlayEl.querySelectorAll('input[type=checkbox]:checked')).map((i) => i.value);
      dismissedInterruptKey = null;
      handleInterruptConfirm(checked);
    });
  }

  const hideBtn = document.getElementById('interrupt-hide-btn');
  if (hideBtn) {
    hideBtn.addEventListener('click', () => {
      dismissedInterruptKey = key;
      render();
    });
  }
}

const ARCHETYPE_OPTIONS = ['Aggressive', 'Growth', 'Engine', 'Cautious', 'Random'];
const LOBBY_ARCHETYPE_LABELS = {
  Aggressive: 'Vince "The Shark" Steel — Aggressive / Shark',
  Growth: 'Hunter Hayes — Recruiter / Headhunter',
  Engine: 'Calculated Carl — Efficiency / Operations',
  Cautious: 'Morgan Trust — Balanced / Defensive',
  Random: '🎲 Random Bot',
};

/**
 * renderLobby()
 * The real entry point — offers Offline (existing local-bots flow,
 * completely unchanged below) or Online (new real-time multiplayer via
 * relay-server.js). Requirement #4 (offline play must keep working with
 * zero internet dependency) is satisfied structurally: choosing Offline
 * never touches the WebSocket client at all.
 */
function renderLobby() {
  const lobbyEl = document.getElementById('lobby-screen');
  lobbyEl.innerHTML = `
    <div class="lobby-box lobby-landing-box">
      <h1>BROKER BOSS <span class="header-subtitle">ONLINE</span></h1>
      <p class="lobby-subtitle">Play locally against Bots, or connect to a live multiplayer room.</p>
      <div class="lobby-landing-choices">
        <button type="button" id="lobby-choice-offline-btn" class="lobby-landing-btn">
          🖥️ Play Offline<br /><span class="lobby-landing-btn-sub">vs. Bots, no internet needed</span>
        </button>
        <button type="button" id="lobby-choice-online-btn" class="lobby-landing-btn">
          🌐 Play Online<br /><span class="lobby-landing-btn-sub">Real-time multiplayer room</span>
        </button>
      </div>
    </div>
  `;
  document.getElementById('lobby-choice-offline-btn').addEventListener('click', renderOfflineLobbySetup);
  document.getElementById('lobby-choice-online-btn').addEventListener('click', renderOnlineLandingScreen);
}

/**
 * renderOfflineLobbySetup()
 * Unchanged from the original renderLobby() — 2-6 total players (1 fixed
 * human + 1-5 configurable bot slots), each choosing its own archetype.
 * Renamed only; behavior is identical to before this multiplayer work.
 */
function renderOfflineLobbySetup() {
  const lobbyEl = document.getElementById('lobby-screen');
  let botCount = 2; // total players = 1 human + botCount, defaults to a 3-player game matching the old hardcoded setup

  function renderSlots() {
    const slotsHtml = Array.from({ length: botCount }, (_, i) => {
      const slotId = `bot-archetype-${i}`;
      return `
        <div class="lobby-slot">
          <span class="lobby-slot-label">Bot ${i + 1}</span>
          <select id="${slotId}" class="lobby-archetype-select">
            ${ARCHETYPE_OPTIONS.map((a) => `<option value="${a}">${LOBBY_ARCHETYPE_LABELS[a] || a}</option>`).join('')}
          </select>
        </div>`;
    }).join('');

    lobbyEl.innerHTML = `
      <div class="lobby-box">
        <button type="button" id="lobby-back-btn" class="lobby-back-btn">← Back</button>
        <h1>BROKER BOSS <span class="header-subtitle">ONLINE</span></h1>
        <p class="lobby-subtitle">Set up your game — you play as the human broker against 1-5 Bot opponents.</p>

        <div class="lobby-player-count-row">
          <label for="lobby-player-count">Total Players</label>
          <select id="lobby-player-count">
            ${[2, 3, 4, 5, 6].map((n) => `<option value="${n}" ${n === botCount + 1 ? 'selected' : ''}>${n} (You + ${n - 1} Bot${n - 1 > 1 ? 's' : ''})</option>`).join('')}
          </select>
        </div>

        <div class="lobby-slots">
          <div class="lobby-slot lobby-slot-human"><span class="lobby-slot-label">Player 1 (You)</span><span class="lobby-slot-fixed">Human</span></div>
          ${slotsHtml}
        </div>

        <button id="lobby-start-btn" class="lobby-start-btn">Start Game</button>
      </div>
    `;

    document.getElementById('lobby-back-btn').addEventListener('click', renderLobby);

    document.getElementById('lobby-player-count').addEventListener('change', (e) => {
      botCount = Number(e.target.value) - 1;
      renderSlots();
    });

    document.getElementById('lobby-start-btn').addEventListener('click', () => {
      const botConfigs = Array.from({ length: botCount }, (_, i) => ({
        archetype: document.getElementById(`bot-archetype-${i}`).value,
      }));
      startGame(botConfigs);
    });
  }

  renderSlots();
}

/**
 * ---------------------------------------------------------------------
 * Multiplayer client — connects to relay-server.js over WebSocket.
 *
 * Architecture: every existing in-game action handler in this file
 * already calls BrokerBossEngine.executeUserAction(state, payload) as
 * its one and only path into the engine (confirmed by inspection before
 * writing this, not assumed) — so rather than rewrite each of the ~20
 * call sites individually (real risk to a lot of already-working code),
 * this wraps that ONE function: in online mode, it sends the action to
 * the server and returns the state UNCHANGED (every call site's own
 * `state = result.state; render();` becomes a harmless no-op re-render);
 * the REAL result arrives moments later as a STATE_UPDATE broadcast,
 * handled below, which sets `state` and calls render() for real. Offline
 * mode never installs this wrapper at all, so local play is completely
 * unaffected — same underlying engine function runs exactly as before.
 * ---------------------------------------------------------------------
 */
const multiplayerClient = {
  ws: null,
  isOnline: false,
  displayName: '',
  roomCode: null,
  mySeatIndex: null,
  reconnectToken: null,
  isHost: false,
  lastRoom: null,
};

function getRelayServerUrl() {
  // Defaults to the same host this page was served from, port 8081 — the
  // relay server's own default port. Override by opening this page as
  // .../index.html?relay=ws://192.168.1.23:8081 for LAN play, or editing
  // this default directly for a hosted deployment.
  const params = new URLSearchParams(window.location.search);
  if (params.get('relay')) return params.get('relay');
  const host = window.location.hostname || 'localhost';
  return `ws://${host}:8081`;
}

let localExecuteUserAction = null;

function patchEngineForNetworkMode() {
  if (localExecuteUserAction) return; // already patched
  localExecuteUserAction = BrokerBossEngine.executeUserAction;
  BrokerBossEngine.executeUserAction = function networkAwareExecuteUserAction(currentState, payload) {
    if (multiplayerClient.isOnline && multiplayerClient.ws && multiplayerClient.ws.readyState === WebSocket.OPEN) {
      multiplayerClient.ws.send(JSON.stringify({ type: 'GAME_ACTION', action: payload }));
      return { state: currentState, error: null, detail: null };
    }
    return localExecuteUserAction(currentState, payload);
  };
}

function connectRelay(onOpen, isReconnectAttempt) {
  const url = getRelayServerUrl();
  const ws = new WebSocket(url);
  multiplayerClient.ws = ws;

  ws.addEventListener('open', () => {
    onOpen && onOpen();
  });

  ws.addEventListener('error', () => {
    if (isReconnectAttempt) {
      // FIX: this used to only call showLobbyError(), which writes to
      // #online-lobby-error — an element that doesn't exist yet this
      // early (attemptAutoReconnect runs before any lobby screen has
      // rendered). The error silently no-op'd and nothing ever fell
      // back to renderLobby(), so a stale/unreachable session left the
      // player staring at a blank screen with no way out except
      // manually clearing storage. Now it purges the stale credentials
      // and lands cleanly on the real landing screen instead.
      clearSessionCredentials();
      renderLobby();
      return;
    }
    showLobbyError('Could not reach the multiplayer server. Is relay-server.js running and reachable at ' + url + '?');
  });

  ws.addEventListener('close', () => {
    if (multiplayerClient.isOnline) {
      showToast('Connection to the multiplayer server was lost. Attempting to reconnect…');
      scheduleReconnectRetry();
    }
  });

  ws.addEventListener('message', (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch (err) {
      return;
    }
    handleRelayMessage(msg);
  });
}

function showLobbyError(text) {
  const el = document.getElementById('online-lobby-error');
  if (el) el.textContent = text;
}

function handleRelayMessage(msg) {
  switch (msg.type) {
    case 'ROOM_CREATED':
      multiplayerClient.roomCode = msg.roomCode;
      multiplayerClient.mySeatIndex = msg.seatIndex;
      multiplayerClient.reconnectToken = msg.reconnectToken;
      multiplayerClient.isHost = true;
      saveSessionCredentials();
      break;
    case 'ROOM_JOINED':
      multiplayerClient.roomCode = msg.roomCode;
      multiplayerClient.mySeatIndex = msg.seatIndex;
      multiplayerClient.reconnectToken = msg.reconnectToken;
      multiplayerClient.isHost = false;
      saveSessionCredentials();
      break;
    case 'JOIN_ERROR':
      showLobbyError(
        msg.reason === 'ROOM_NOT_FOUND'
          ? 'No room found with that code.'
          : msg.reason === 'ROOM_FULL'
            ? 'That room is full.'
            : msg.reason === 'GAME_ALREADY_STARTED'
              ? 'That game has already started.'
              : 'Could not join that room.'
      );
      break;
    case 'ROOM_STATE':
      multiplayerClient.lastRoom = msg.room;
      // Once the game is live, ROOM_STATE broadcasts (seat status
      // changes, e.g. someone else disconnecting) shouldn't yank the
      // player back to a waiting-room screen mid-game.
      if (!msg.room.gameStarted) renderWaitingRoomScreen(msg.room);
      break;
    case 'ROOM_CLOSED':
      // FIX: showLobbyError wrote to #online-lobby-error, which doesn't
      // exist while in the waiting room screen (a different DOM
      // structure entirely) — and even when it did exist, the very next
      // renderLobby() call below would immediately destroy it anyway.
      // The notification never actually reached the player. showToast
      // uses a persistent, global element that survives the screen
      // transition, so this is now genuinely visible.
      showToast(
        msg.reason === 'HOST_DISCONNECTED'
          ? 'Host disconnected from room — returning to the main menu.'
          : 'The host left before the game started — the room was closed.'
      );
      setTimeout(() => showToast(null), 6000);
      multiplayerClient.isOnline = false;
      clearSessionCredentials();
      renderLobby();
      break;
    case 'GAME_STARTED':
      HUMAN_PLAYER_ID = `p${multiplayerClient.mySeatIndex + 1}`;
      multiplayerClient.isOnline = true;
      patchEngineForNetworkMode();
      state = msg.state;
      document.getElementById('lobby-screen').style.display = 'none';
      document.getElementById('app-shell').style.display = 'block';
      render();
      break;
    case 'STATE_UPDATE':
      state = msg.state;
      render();
      break;
    case 'ACTION_ERROR':
      logLine(`Action rejected: ${msg.error}`);
      // FIX: an action can be rejected because the server's real state
      // moved on (e.g. a bot cascade completed) between this client's
      // last STATE_UPDATE and the moment it clicked — that leaves the
      // local `state` stale, which then looks like "meeple/space is
      // available" when the server disagrees. Rather than leave the
      // player staring at a stale view that will keep rejecting their
      // next click too, request the server's real current state right
      // away and re-render against it.
      if (multiplayerClient.ws && multiplayerClient.ws.readyState === WebSocket.OPEN) {
        multiplayerClient.ws.send(JSON.stringify({ type: 'REQUEST_STATE_SYNC' }));
      }
      break;
    case 'RECONNECTED':
      reconnectRetryCount = 0;
      multiplayerClient.roomCode = msg.roomCode;
      multiplayerClient.mySeatIndex = msg.seatIndex;
      multiplayerClient.reconnectToken = msg.reconnectToken;
      multiplayerClient.isOnline = msg.gameStarted;
      // FIX: previously hardcoded to false here, which permanently
      // stripped a host of their own host status (and all host
      // controls — Start Game, seat dropdowns) on any page refresh
      // mid-lobby. The server now tracks and reports the real,
      // authoritative value (see relay-server.js's handleReconnectPlayer,
      // which also correctly moves room.hostConnectionId to the new
      // connection so server-side host checks keep working too, not
      // just this UI flag).
      multiplayerClient.isHost = !!msg.isHost;
      saveSessionCredentials();
      if (msg.gameStarted) {
        HUMAN_PLAYER_ID = `p${msg.seatIndex + 1}`;
        patchEngineForNetworkMode();
        // FORCE_STATE_SYNC (sent right after this by the server) carries
        // the actual state and triggers the real render — this message
        // alone just confirms the handshake succeeded and flips the UI
        // over to the game shell so the sync has somewhere to land.
        document.getElementById('lobby-screen').style.display = 'none';
        document.getElementById('app-shell').style.display = 'block';
      }
      break;
    case 'RECONNECT_ERROR':
      // The stored credentials didn't work (room gone, token stale,
      // etc.) — nothing to restore, so just clear them and let the
      // player go through the normal landing screen instead of getting
      // stuck retrying forever.
      clearSessionCredentials();
      renderLobby();
      break;
    case 'FORCE_STATE_SYNC':
      state = msg.state;
      render();
      break;
    case 'SEAT_RECONNECT_WINDOW_EXPIRED':
      // The waiting-room dropdown reacts automatically to the fresh
      // reconnectWindowExpired field the server includes on every
      // ROOM_STATE broadcast — no client-side bookkeeping needed there.
      // This event's only remaining job is the mid-game convert banner,
      // which has no equivalent "just re-render and it appears" screen.
      if (multiplayerClient.isOnline) {
        renderReconnectBanner(msg.seatIndex);
      }
      break;
    default:
      break;
  }
}

/**
 * Session persistence — localStorage: survives closing the tab/browser
 * entirely, not just a same-tab refresh, so a dropped connection can be
 * recovered from later, not only immediately. This makes robust
 * server-side validation on every attempt more important, not less —
 * see attemptAutoReconnect and connectRelay's isReconnectAttempt path,
 * which purge a stale/invalid credential immediately rather than ever
 * trusting it blindly.
 */
const ONLINE_SESSION_KEY = 'brokerBossOnlineSession';

function saveSessionCredentials() {
  try {
    window.localStorage.setItem(
      ONLINE_SESSION_KEY,
      JSON.stringify({ roomCode: multiplayerClient.roomCode, seatIndex: multiplayerClient.mySeatIndex, reconnectToken: multiplayerClient.reconnectToken })
    );
  } catch (err) {
    // localStorage can throw in some privacy/incognito configurations —
    // reconnection just won't be available this session, not fatal.
  }
}

function loadSessionCredentials() {
  try {
    const raw = window.localStorage.getItem(ONLINE_SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    return null;
  }
}

function clearSessionCredentials() {
  try {
    window.localStorage.removeItem(ONLINE_SESSION_KEY);
  } catch (err) {
    // ignore
  }
}

/**
 * attemptAutoReconnect()
 * Called once at boot, before the normal lobby renders. If this browser
 * has real stored credentials from an earlier session, tries the
 * handshake silently against the real server — never assumes the room
 * is still valid just because a credential exists locally. Falls
 * through to the normal landing screen if there's nothing to restore,
 * the room no longer exists (RECONNECT_ERROR), or the server can't be
 * reached at all (connectRelay's isReconnectAttempt error path) —
 * every failure mode here ends on a clean, usable screen, never a
 * blank one.
 */
function attemptAutoReconnect() {
  const creds = loadSessionCredentials();
  if (!creds || !creds.roomCode || creds.seatIndex === undefined || !creds.reconnectToken) {
    return false;
  }
  multiplayerClient.roomCode = creds.roomCode;
  multiplayerClient.mySeatIndex = creds.seatIndex;
  multiplayerClient.reconnectToken = creds.reconnectToken;
  connectRelay(() => {
    multiplayerClient.ws.send(JSON.stringify({ type: 'RECONNECT_PLAYER', roomCode: creds.roomCode, seatIndex: creds.seatIndex, reconnectToken: creds.reconnectToken }));
  }, true);
  return true;
}

let reconnectRetryCount = 0;
const MAX_AUTO_RECONNECT_RETRIES = 5;

/**
 * Automatic retry after an unexpected drop mid-session (not a
 * deliberate "leave room" close) — network blip, laptop sleep, etc.
 * Backs off a little each attempt rather than hammering the server.
 */
function scheduleReconnectRetry() {
  if (!multiplayerClient.roomCode || !multiplayerClient.reconnectToken) return;
  if (reconnectRetryCount >= MAX_AUTO_RECONNECT_RETRIES) {
    showToast('Lost connection to the multiplayer server and could not reconnect.');
    clearSessionCredentials();
    renderLobby();
    return;
  }
  reconnectRetryCount += 1;
  const delayMs = Math.min(1000 * 2 ** reconnectRetryCount, 15000);
  setTimeout(() => {
    if (multiplayerClient.ws && multiplayerClient.ws.readyState === WebSocket.OPEN) return; // already reconnected some other way
    connectRelay(() => {
      multiplayerClient.ws.send(JSON.stringify({ type: 'RECONNECT_PLAYER', roomCode: multiplayerClient.roomCode, seatIndex: multiplayerClient.mySeatIndex, reconnectToken: multiplayerClient.reconnectToken }));
    }, true);
  }, delayMs);
}

function renderReconnectBanner(seatIndex) {
  const el = document.getElementById('reconnect-convert-banner');
  if (!multiplayerClient.isHost) {
    el.style.display = 'none';
    return;
  }
  const seat = multiplayerClient.lastRoom && multiplayerClient.lastRoom.seats.find((s) => s.seatIndex === seatIndex);
  const seatLabel = seat && seat.displayName ? seat.displayName : `Seat ${seatIndex + 1}`;
  el.innerHTML = `
    <span>⚠️ ${escapeAttr(seatLabel)}'s reconnect window has expired.</span>
    <button type="button" class="reconnect-convert-btn" data-convert-type="bot" data-seat-index="${seatIndex}">Convert to Bot</button>
    <button type="button" class="reconnect-convert-btn" data-convert-type="open" data-seat-index="${seatIndex}">Free the Seat</button>
    <button type="button" class="reconnect-convert-dismiss" id="reconnect-banner-dismiss">✕</button>
  `;
  el.style.display = 'flex';
  el.querySelectorAll('.reconnect-convert-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      multiplayerClient.ws.send(
        JSON.stringify({ type: 'CONVERT_DISCONNECTED_SEAT', seatIndex: Number(btn.dataset.seatIndex), newType: btn.dataset.convertType, archetype: 'Random' })
      );
      el.style.display = 'none';
    });
  });
  document.getElementById('reconnect-banner-dismiss').addEventListener('click', () => {
    el.style.display = 'none';
  });
}

function renderOnlineLandingScreen() {
  const lobbyEl = document.getElementById('lobby-screen');
  lobbyEl.innerHTML = `
    <div class="lobby-box">
      <button type="button" id="lobby-back-btn" class="lobby-back-btn">← Back</button>
      <h1>BROKER BOSS <span class="header-subtitle">ONLINE</span></h1>
      <p class="lobby-subtitle">Enter a display name, then create a new room or join one with a code.</p>
      <div id="online-lobby-error" class="online-lobby-error"></div>

      <label class="feedback-field-label">Display Name</label>
      <input type="text" id="online-display-name" class="lobby-text-input" placeholder="Your name" maxlength="20" />

      <div class="lobby-online-actions">
        <button type="button" id="online-create-room-btn" class="lobby-start-btn">Create New Game Room</button>
        <div class="lobby-online-join-row">
          <input type="text" id="online-room-code-input" class="lobby-text-input lobby-room-code-input" placeholder="ROOM CODE" maxlength="4" style="text-transform:uppercase" />
          <button type="button" id="online-join-room-btn" class="lobby-start-btn">Join Room</button>
        </div>
      </div>
    </div>
  `;

  document.getElementById('lobby-back-btn').addEventListener('click', () => {
    if (multiplayerClient.ws) {
      multiplayerClient.ws.close();
      multiplayerClient.ws = null;
    }
    renderLobby();
  });

  document.getElementById('online-create-room-btn').addEventListener('click', () => {
    const displayName = document.getElementById('online-display-name').value.trim() || 'Host';
    multiplayerClient.displayName = displayName;
    showLobbyError('Connecting…');
    connectRelay(() => {
      showLobbyError('');
      multiplayerClient.ws.send(JSON.stringify({ type: 'CREATE_ROOM', displayName }));
    });
  });

  document.getElementById('online-join-room-btn').addEventListener('click', () => {
    const displayName = document.getElementById('online-display-name').value.trim() || 'Player';
    const roomCode = document.getElementById('online-room-code-input').value.trim().toUpperCase();
    if (roomCode.length !== 4) {
      showLobbyError('Room codes are 4 characters.');
      return;
    }
    multiplayerClient.displayName = displayName;
    showLobbyError('Connecting…');
    connectRelay(() => {
      showLobbyError('');
      multiplayerClient.ws.send(JSON.stringify({ type: 'JOIN_ROOM', roomCode, displayName }));
    });
  });
}

const SEAT_TYPE_LABELS = { human: 'Human', bot: 'Bot', locked: 'Locked', open: 'Open' };

function renderWaitingRoomScreen(room) {
  const lobbyEl = document.getElementById('lobby-screen');
  const isHost = multiplayerClient.isHost;

  const seatsHtml = room.seats
    .map((seat, i) => {
      const isMe = i === multiplayerClient.mySeatIndex;
      const isOccupiedHuman = seat.type === 'human' && !seat.reconnectWindowExpired;
      let content;
      if (seat.type === 'human') {
        content = `<span class="waiting-seat-name">${seat.displayName || '…'}${isMe ? ' (You)' : ''}</span><span class="waiting-seat-type">${seat.connectionStatus === 'disconnected' ? '⚠️ Reconnecting…' : 'Human'}</span>`;
      } else if (seat.type === 'bot') {
        const label = LOBBY_ARCHETYPE_LABELS[seat.archetype] || seat.archetype || 'Random';
        content = `<span class="waiting-seat-name">🤖 ${label}</span>`;
      } else if (seat.type === 'locked') {
        content = `<span class="waiting-seat-name waiting-seat-empty">🔒 Locked</span>`;
      } else {
        content = `<span class="waiting-seat-name waiting-seat-empty">Open Seat — waiting for a player…</span>`;
      }

      // Fix 1: a seat genuinely occupied by a connected human gets NO
      // reassignment control at all — there's no "give this back to me"
      // option in the dropdown anyway, so showing it here only invites
      // the host to accidentally kick/overwrite a real connected player.
      // Only empty seats (open/locked/bot) are ever host-editable.
      const hostControls =
        isHost && i !== 0 && !isOccupiedHuman
          ? `
        <select class="waiting-seat-control" data-seat-index="${i}">
          <option value="open" ${seat.type === 'open' ? 'selected' : ''}>Open</option>
          <option value="locked" ${seat.type === 'locked' ? 'selected' : ''}>Closed</option>
          <option value="bot" ${seat.type === 'bot' && !seat.archetype ? 'selected' : ''}>AI Bot</option>
          ${seat.type === 'bot' ? ARCHETYPE_OPTIONS.map((a) => `<option value="bot:${a}" ${seat.archetype === a ? 'selected' : ''}>${LOBBY_ARCHETYPE_LABELS[a]}</option>`).join('') : ''}
        </select>`
          : '';

      return `<div class="waiting-seat waiting-seat-${seat.type}">
        <span class="waiting-seat-index">${i + 1}</span>
        ${content}
        ${hostControls}
      </div>`;
    })
    .join('');

  // Fix 2: Start Game requires every seat genuinely filled (a connected
  // human or an assigned bot) — "locked"/"open" seats are not fillable
  // and must be resolved (bot-assigned or a player must join) before
  // starting. Previously this only checked "at least one human," which
  // could enable Start Game with seats still sitting empty.
  const allSeatsFilled = room.seats.every((s) => s.type === 'bot' || (s.type === 'human' && s.connectionStatus === 'connected'));
  const humanCount = room.seats.filter((s) => s.type === 'human').length;
  const canStart = isHost && humanCount >= 1 && allSeatsFilled && !room.gameStarted;

  lobbyEl.innerHTML = `
    <div class="lobby-box waiting-room-box">
      <h1>BROKER BOSS <span class="header-subtitle">ONLINE</span></h1>
      <div class="waiting-room-code-banner">Room Code: <strong>${room.code}</strong> <span class="waiting-room-code-hint">— share this with other players</span></div>

      ${
        isHost
          ? `<div class="lobby-player-count-row">
              <label for="waiting-max-seats">Total Seats</label>
              <select id="waiting-max-seats">
                ${[2, 3, 4, 5, 6].map((n) => `<option value="${n}" ${n === room.maxSeats ? 'selected' : ''}>${n}</option>`).join('')}
              </select>
            </div>`
          : ''
      }

      <div class="waiting-room-seats">${seatsHtml}</div>

      ${isHost ? `<button type="button" id="waiting-start-btn" class="lobby-start-btn" ${canStart ? '' : 'disabled'}>Start Game${allSeatsFilled ? '' : ' (fill all seats first)'}</button>` : '<p class="lobby-subtitle">Waiting for the host to start the game…</p>'}
      <button type="button" id="waiting-leave-btn" class="lobby-back-btn waiting-leave-btn">← Leave Room</button>
    </div>
  `;

  if (isHost) {
    document.getElementById('waiting-max-seats').addEventListener('change', (e) => {
      multiplayerClient.ws.send(JSON.stringify({ type: 'UPDATE_SEATS', maxSeats: Number(e.target.value) }));
    });
    lobbyEl.querySelectorAll('.waiting-seat-control').forEach((select) => {
      select.addEventListener('change', (e) => {
        const seatIndex = Number(e.target.dataset.seatIndex);
        const value = e.target.value;
        const update = value.startsWith('bot:') ? { seatIndex, type: 'bot', archetype: value.slice(4) } : { seatIndex, type: value, archetype: value === 'bot' ? 'Random' : undefined };
        multiplayerClient.ws.send(JSON.stringify({ type: 'UPDATE_SEATS', seatUpdates: [update] }));
      });
    });
    const startBtn = document.getElementById('waiting-start-btn');
    if (startBtn) {
      startBtn.addEventListener('click', () => {
        multiplayerClient.ws.send(JSON.stringify({ type: 'START_GAME' }));
      });
    }
  }

  document.getElementById('waiting-leave-btn').addEventListener('click', leaveOnlineRoom);
}

/**
 * leaveOnlineRoom()
 * Shared by the Leave Room button on both the host and joined-player
 * waiting screens (and reusable from other lobby-stage screens). Tells
 * the server this is a deliberate exit (not a dropped connection),
 * clears anything that would otherwise trigger auto-reconnect on the
 * next page load, and returns cleanly to the landing screen.
 */
function leaveOnlineRoom() {
  if (multiplayerClient.ws && multiplayerClient.ws.readyState === WebSocket.OPEN) {
    multiplayerClient.ws.send(JSON.stringify({ type: 'LEAVE_ROOM' }));
  }
  if (multiplayerClient.ws) {
    multiplayerClient.ws.close();
    multiplayerClient.ws = null;
  }
  multiplayerClient.isOnline = false;
  multiplayerClient.roomCode = null;
  multiplayerClient.mySeatIndex = null;
  multiplayerClient.reconnectToken = null;
  multiplayerClient.isHost = false;
  multiplayerClient.lastRoom = null;
  clearSessionCredentials();
  renderLobby();
}

/**
 * Card hover zoom (Phase 3, Item 1). Clones the REAL hovered card's own
 * rendered content — not re-derived data — so the zoom can never show
 * different info than the small card ever did. Document-level
 * delegation because hand/agent cards get fully re-rendered on nearly
 * every state change; per-card listeners would need constant
 * re-attachment and risk silently going stale.
 */
const ZOOMABLE_CARD_SELECTOR = '.hand-card:not(.hand-card-placeholder):not(.hand-card-facedown), .agent-card:not(.agent-card-placeholder), .specialist-card-panel:not(.specialist-card-empty), .active-shift-box';

function buildCardZoomOverlay() {
  const el = document.createElement('div');
  el.id = 'card-zoom-overlay';
  el.className = 'card-zoom-overlay';
  document.body.appendChild(el);
  return el;
}

const cardZoomOverlay = buildCardZoomOverlay();
let cardZoomPinned = false;

document.addEventListener('click', (e) => {
  const card = e.target.closest(ZOOMABLE_CARD_SELECTOR);
  if (card) {
    // Clicking the SAME already-pinned card again dismisses it —
    // otherwise clicking any zoomable card (re-)pins it.
    if (cardZoomPinned && cardZoomOverlay.dataset.pinnedFor === (card.dataset.instanceId || card.title)) {
      cardZoomPinned = false;
      cardZoomOverlay.classList.remove('card-zoom-visible', 'card-zoom-pinned');
      return;
    }
    cardZoomPinned = true;
    cardZoomOverlay.dataset.pinnedFor = card.dataset.instanceId || card.title;
    showCardZoom(card);
    cardZoomOverlay.classList.add('card-zoom-pinned');
    return;
  }
  // Clicking anywhere else (not a zoomable card, not the overlay
  // itself) dismisses a pinned zoom.
  if (cardZoomPinned && !e.target.closest('.card-zoom-overlay')) {
    cardZoomPinned = false;
    cardZoomOverlay.classList.remove('card-zoom-visible', 'card-zoom-pinned');
  }
});

document.addEventListener('mouseover', (e) => {
  const card = e.target.closest(ZOOMABLE_CARD_SELECTOR);
  if (!card || cardZoomPinned) return; // a pinned (click-magnified) card takes priority over hover
  showCardZoom(card);
});

function showCardZoom(card) {
  cardZoomOverlay.innerHTML = card.innerHTML;
  cardZoomOverlay.className = 'card-zoom-overlay card-zoom-visible card-zoom-vertical';

  const rect = card.getBoundingClientRect();
  // Measure the overlay's REAL rendered size now that its real content
  // and variant class are set, rather than a hardcoded guess — the
  // guess previously used (260px buffer) didn't match either real CSS
  // variant's actual height (vertical: min-height 280px + padding =
  // 308px+), which could genuinely overflow the viewport bottom.
  const zoomRect = cardZoomOverlay.getBoundingClientRect();
  const zoomWidth = zoomRect.width;
  const zoomHeight = zoomRect.height;

  let left = rect.right + 12;
  if (left + zoomWidth > window.innerWidth) {
    left = rect.left - zoomWidth - 12;
  }
  left = Math.max(8, Math.min(left, window.innerWidth - zoomWidth - 8));

  let top = rect.top;
  top = Math.max(8, Math.min(top, window.innerHeight - zoomHeight - 8));

  cardZoomOverlay.style.left = `${left}px`;
  cardZoomOverlay.style.top = `${top}px`;
}

document.addEventListener('mouseout', (e) => {
  if (cardZoomPinned) return; // a click-pinned zoom is only dismissed by clicking, not by the mouse leaving
  const card = e.target.closest(ZOOMABLE_CARD_SELECTOR);
  if (!card) return;
  // Only actually hide when the mouse has genuinely left the card (not
  // just moved between two child elements inside it).
  if (card.contains(e.relatedTarget)) return;
  cardZoomOverlay.classList.remove('card-zoom-visible');
});

let draggedMeepleInstanceId = null;

document.addEventListener('dragstart', (e) => {
  const token = e.target.closest('.draggable-meeple-token');
  if (!token) return;
  draggedMeepleInstanceId = token.dataset.meepleInstanceId;
  e.dataTransfer.setData('text/plain', draggedMeepleInstanceId);
  e.dataTransfer.effectAllowed = 'move';
  token.classList.add('draggable-meeple-token-dragging');
});

document.addEventListener('dragend', (e) => {
  const token = e.target.closest('.draggable-meeple-token');
  if (token) token.classList.remove('draggable-meeple-token-dragging');
  draggedMeepleInstanceId = null;
  document.querySelectorAll('.space-drag-hover').forEach((el) => el.classList.remove('space-drag-hover'));
});

document.addEventListener('dragover', (e) => {
  const space = e.target.closest('.board-space-hitbox.space-clickable');
  if (!space) return;
  // Required by the HTML5 drag-and-drop spec — without calling
  // preventDefault() on dragover, the browser never fires a real drop
  // event on this element at all.
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  space.classList.add('space-drag-hover');
});

document.addEventListener('dragleave', (e) => {
  const space = e.target.closest('.board-space-hitbox');
  if (!space) return;
  if (space.contains(e.relatedTarget)) return;
  space.classList.remove('space-drag-hover');
});

document.addEventListener('drop', (e) => {
  const space = e.target.closest('.board-space-hitbox.space-clickable');
  if (!space) return;
  e.preventDefault();
  space.classList.remove('space-drag-hover');
  const meepleInstanceId = e.dataTransfer.getData('text/plain') || draggedMeepleInstanceId;
  if (!meepleInstanceId) return;
  handleSpaceClick(space.dataset.spaceId, meepleInstanceId);
});

document.getElementById('hand-drawer-toggle').addEventListener('click', () => {
  document.getElementById('hand-drawer').classList.toggle('corner-drawer-open');
});

document.getElementById('tableau-toggle').addEventListener('click', () => {
  document.getElementById('tableau-panel').classList.toggle('corner-drawer-open');
});

document.getElementById('log-drawer-toggle').addEventListener('click', () => {
  document.getElementById('log-drawer').classList.toggle('corner-drawer-open');
});

document.getElementById('log-drawer-close-btn').addEventListener('click', () => {
  document.getElementById('log-drawer').classList.remove('corner-drawer-open');
});

/**
 * Board zoom/pan — CSS transform on #board-column inside a fixed-size,
 * overflow:hidden #board-zoom-viewport. Deliberately excludes interactive
 * board elements (action spaces, draggable Meeple tokens, buttons) from
 * initiating a pan drag, so this doesn't interfere with the existing
 * click-to-place / drag-to-place Meeple interactions already wired
 * elsewhere in this file.
 */
(function setupBoardZoomPan() {
  const viewport = document.getElementById('board-zoom-viewport');
  const boardColumn = document.getElementById('board-column');
  if (!viewport || !boardColumn) return;

  const MIN_ZOOM = 0.4;
  const MAX_ZOOM = 2.5;
  const ZOOM_STEP = 0.15;
  let zoom = 1;
  let panX = 0;
  let panY = 0;

  function applyTransform() {
    boardColumn.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
  }

  function setZoom(nextZoom, anchorClientX, anchorClientY) {
    const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextZoom));
    if (clamped === zoom) return;
    // Zoom toward the cursor/anchor point rather than the top-left corner,
    // so zooming in on a specific action space keeps it under the cursor
    // instead of the view jumping.
    const rect = viewport.getBoundingClientRect();
    const anchorX = (anchorClientX ?? rect.left + rect.width / 2) - rect.left;
    const anchorY = (anchorClientY ?? rect.top + rect.height / 2) - rect.top;
    const scaleRatio = clamped / zoom;
    panX = anchorX - (anchorX - panX) * scaleRatio;
    panY = anchorY - (anchorY - panY) * scaleRatio;
    zoom = clamped;
    applyTransform();
  }

  document.getElementById('board-zoom-in-btn').addEventListener('click', () => setZoom(zoom + ZOOM_STEP));
  document.getElementById('board-zoom-out-btn').addEventListener('click', () => setZoom(zoom - ZOOM_STEP));
  document.getElementById('board-zoom-reset-btn').addEventListener('click', () => {
    zoom = 1;
    panX = 0;
    panY = 0;
    applyTransform();
  });

  viewport.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const direction = e.deltaY > 0 ? -1 : 1;
      setZoom(zoom + direction * ZOOM_STEP * 0.6, e.clientX, e.clientY);
    },
    { passive: false }
  );

  const NON_PANNABLE_SELECTOR =
    'button, [draggable="true"], .space-tile, [data-space-id], .agent-card-clickable, input, select, textarea, a, .agent-card, .hand-card, .specialist-card-panel, .active-shift-box';
  let isPanning = false;
  let panStartX = 0;
  let panStartY = 0;
  let panOriginX = 0;
  let panOriginY = 0;

  boardColumn.addEventListener('mousedown', (e) => {
    if (e.target.closest(NON_PANNABLE_SELECTOR)) return;
    isPanning = true;
    panStartX = e.clientX;
    panStartY = e.clientY;
    panOriginX = panX;
    panOriginY = panY;
    boardColumn.classList.add('board-panning');
  });

  window.addEventListener('mousemove', (e) => {
    if (!isPanning) return;
    panX = panOriginX + (e.clientX - panStartX);
    panY = panOriginY + (e.clientY - panStartY);
    applyTransform();
  });

  window.addEventListener('mouseup', () => {
    if (!isPanning) return;
    isPanning = false;
    boardColumn.classList.remove('board-panning');
  });

  // FIX: tablet/mobile "sticking" — this pan mechanism previously only
  // ever listened for mouse events. Touch devices don't reliably fire a
  // matching mouseup for every mousedown/synthesized-mousedown (a known
  // cross-browser inconsistency, worse when a finger lifts off the
  // element or a gesture gets interrupted), which could leave isPanning
  // stuck true forever — every subsequent tap anywhere then behaves as
  // if a pan is still active. Real touch handlers below, using the same
  // pan math as the mouse path (single-finger only; a second finger
  // touching down doesn't restart the pan, avoiding a jump).
  boardColumn.addEventListener(
    'touchstart',
    (e) => {
      if (e.target.closest(NON_PANNABLE_SELECTOR)) return;
      if (e.touches.length !== 1) return;
      // FIX: only engage touch-pan once the board is actually zoomed in
      // — at the default zoom (1) or zoomed out, there's nothing
      // meaningful to pan to, and intercepting every single-finger drag
      // here was the actual cause of "can't scroll to reach the lower
      // sections": it always won over the page's own native scroll,
      // on every touch drag anywhere on the board, regardless of zoom
      // level. Below/at default zoom, this now lets the touch fall
      // through to normal page scrolling instead.
      if (zoom <= 1) return;
      isPanning = true;
      panStartX = e.touches[0].clientX;
      panStartY = e.touches[0].clientY;
      panOriginX = panX;
      panOriginY = panY;
      boardColumn.classList.add('board-panning');
    },
    { passive: true }
  );

  viewport.addEventListener(
    'touchmove',
    (e) => {
      if (!isPanning || e.touches.length !== 1) return;
      e.preventDefault(); // only reached when isPanning is true (zoom > 1), so this never blocks normal page scroll at default zoom
      panX = panOriginX + (e.touches[0].clientX - panStartX);
      panY = panOriginY + (e.touches[0].clientY - panStartY);
      applyTransform();
    },
    { passive: false }
  );

  function endTouchPan() {
    if (!isPanning) return;
    isPanning = false;
    boardColumn.classList.remove('board-panning');
  }
  boardColumn.addEventListener('touchend', endTouchPan);
  boardColumn.addEventListener('touchcancel', endTouchPan); // the OS/browser can interrupt a touch (incoming call, notification, etc.) without ever firing touchend

  // Extra safety net, mouse or touch: if the window loses focus or the
  // tab is hidden mid-pan (alt-tab, app switch, notification pull-down),
  // neither a mouseup nor a touchend is guaranteed to fire at all — this
  // guarantees isPanning always gets cleared regardless.
  window.addEventListener('blur', () => {
    isPanning = false;
    boardColumn.classList.remove('board-panning');
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      isPanning = false;
      boardColumn.classList.remove('board-panning');
    }
  });
})();

document.getElementById('player-aid-btn').addEventListener('click', () => {
  renderPlayerAidModal();
});

document.getElementById('export-telemetry-btn').addEventListener('click', () => {
  const dateStamp = new Date().toISOString().slice(0, 10);
  const decisionRows = buildDecisionLogRows(state);
  const timingRows = buildRoundTimingRows(state);
  if (decisionRows.length === 0) {
    logLine('No telemetry to export yet — play at least one round first.');
    return;
  }
  downloadCsv(`broker-boss-decision-log-${dateStamp}.csv`, decisionRows);
  downloadCsv(`broker-boss-round-timing-${dateStamp}.csv`, timingRows);
  logLine(`Exported ${decisionRows.length} decision-log rows and ${timingRows.length} round-timing rows as CSV.`);
});

document.getElementById('your-turn-banner').addEventListener('click', () => {
  const banner = document.getElementById('your-turn-banner');
  clearTimeout(window.__yourTurnBannerTimer);
  banner.classList.remove('your-turn-banner-visible');
  setTimeout(() => { banner.style.display = 'none'; }, 400);
});

document.getElementById('report-feedback-btn').addEventListener('click', () => {
  renderFeedbackModal();
});

preloadCatalogData()
  .then(() => {
    if (!attemptAutoReconnect()) {
      renderLobby();
    }
  })
  .catch((err) => {
    document.body.innerHTML = `
      <div style="max-width: 600px; margin: 60px auto; padding: 24px; background: #2a1515; border: 2px solid #e05d44; border-radius: 10px; color: #f0d9d9; font-family: sans-serif;">
        <h2 style="color: #e05d44; margin-top: 0;">Failed to load game data</h2>
        <p>The game could not load <code>catalog.json</code> / <code>agentCatalog.json</code>. This usually means the page was opened directly as a file (e.g. double-clicking index.html) instead of being served over HTTP.</p>
        <p><strong>Fix:</strong> from a terminal in this folder, run:</p>
        <pre style="background: #1a0d0d; padding: 10px; border-radius: 6px;">python3 -m http.server 8080</pre>
        <p>then open <code>http://localhost:8080</code> in your browser.</p>
        <p style="opacity: 0.7; font-size: 0.85em;">Technical detail: ${escapeAttr(err.message || String(err))}</p>
      </div>
    `;
  });
