var BrokerBossEngine = (() => {
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __commonJS = (cb, mod) => function __require() {
    try {
      return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
    } catch (e) {
      throw mod = 0, e;
    }
  };

  // initialGameState.js
  var require_initialGameState = __commonJS({
    "initialGameState.js"(exports, module) {
      var STARTING_VALUES = Object.freeze({
        MAX_ROUNDS: 7,
        STARTING_PROFIT_TOKENS: 3,
        STARTING_PRIORITY_TOKENS: 0,
        STARTING_LOYALTY_TOKENS: 3,
        STARTING_OFFICES: 2,
        MAX_OFFICES: 6,
        STARTING_TIME_MEEPLES: 3,
        MAX_TIME_MEEPLES: 6,
        MAX_HAND_SIZE: 5,
        TRACK_MAX: 10,
        MARKET_SHARE_START_POSITION: 0,
        // CONFIRMED official starting bank totals (design ruling — supersedes the
        // MASTER_GAME_STATE_SCHEMA.md §4 example values, which were mid-game
        // placeholders, not setup totals).
        BANK_PROFIT_TOKENS: 9999,
        // effectively unlimited
        BANK_PRIORITY_TOKENS: 50,
        BANK_LOYALTY_TOKENS: 30,
        BANK_COACH_TOKENS: 30,
        // FLAGGED SHAPE NOTE: schema §4 originally modeled bank time-meeple supply
        // as a per-player map (bank.timeMeeplesAvailable = { p1: 3, p2: 3, ... }),
        // reflecting the rulebook's per-color component pools (36 meeples / 6
        // colors = 6 each: 3 starting + 3 hireable). The confirmed "timeMeeples: 24"
        // ruling is a single flat bank total instead, so it's modeled below as
        // bank.timeMeeples rather than a per-player breakdown. Flagging once here
        // in case a future reducer (e.g. Hire Staff) assumes the old per-player shape.
        BANK_TIME_MEEPLES: 24,
        SHIFT_TRACKER_MIN: 0,
        SHIFT_TRACKER_MAX: 4,
        // Rulebook: 5 starting cards (S1-S5) go to hand, S6/S7 form the personal draw pile.
        STARTING_ACTION_CARD_HAND_IDS: ["S1", "S2", "S3", "S4", "S5"],
        STARTING_ACTION_CARD_DRAW_IDS: ["S6", "S7"]
      });
      var _meepleCounter = 0;
      function generateMeepleInstanceId(playerId) {
        _meepleCounter += 1;
        return `m-${playerId}-${_meepleCounter}`;
      }
      var _actionCardInstanceCounter = 0;
      function generateActionCardInstanceId(playerId) {
        _actionCardInstanceCounter += 1;
        return `ac-${playerId}-${_actionCardInstanceCounter}`;
      }
      function generateGameId() {
        if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
          return crypto.randomUUID();
        }
        return `game-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      }
      function createEmptyPlayerState(playerConfig) {
        const {
          playerId,
          color,
          isBot = false,
          archetype = null,
          startingHandCatalogIds,
          startingDrawPileCatalogIds
        } = playerConfig;
        const handCatalogIds = startingHandCatalogIds || STARTING_VALUES.STARTING_ACTION_CARD_HAND_IDS;
        const drawPileCatalogIds = startingDrawPileCatalogIds || [...STARTING_VALUES.STARTING_ACTION_CARD_DRAW_IDS];
        return {
          playerId,
          color,
          isBot,
          // archetype is null for humans; one of Aggressive|Balanced|Cautious for bots (schema §6.1)
          archetype: isBot ? archetype || "Balanced" : null,
          shiftImmunity: {
            active: false,
            sourceCardInstanceId: null,
            grantedRound: null,
            expiresEndOfRound: true
          },
          wallet: {
            profitTokens: STARTING_VALUES.STARTING_PROFIT_TOKENS,
            priorityTokens: STARTING_VALUES.STARTING_PRIORITY_TOKENS
          },
          tracks: {
            // BATCH 7 (Rulebook v5.0, Section 6): branch is null until a player
            // advances onto/past Level 5, at which point they must choose 'A' or
            // 'B' — permanent for the rest of the game. claimedMilestones records
            // which of [5, 7, 9] have ALREADY triggered their one-time reward —
            // never cleared, even on backward movement, so a later re-advance
            // past an already-claimed level correctly does NOT re-award it
            // (the real "Executed Token" rule). This is the single source of
            // truth the UI derives the Executed Token marker from.
            training: { value: 0, max: STARTING_VALUES.TRACK_MAX, branch: null, claimedMilestones: [] },
            technology: { value: 0, max: STARTING_VALUES.TRACK_MAX, branch: null, claimedMilestones: [] },
            recognition: { value: 0, max: STARTING_VALUES.TRACK_MAX, branch: null, claimedMilestones: [] },
            offices: { unlocked: STARTING_VALUES.STARTING_OFFICES, max: STARTING_VALUES.MAX_OFFICES },
            marketShare: { position: STARTING_VALUES.MARKET_SHARE_START_POSITION }
          },
          timeMeeples: {
            active: Array.from({ length: STARTING_VALUES.STARTING_TIME_MEEPLES }, () => ({
              instanceId: generateMeepleInstanceId(playerId),
              status: "in_supply",
              locationSpaceId: null
            })),
            staffInTraining: [],
            maxAllowed: STARTING_VALUES.MAX_TIME_MEEPLES,
            // Item 2 (Copycat Marketing, Recognition-B Level 5): a genuinely
            // separate slot for the 1 extra Orange Time Meeple — null until
            // the player actually claims Level 5 on the Recognition-B branch
            // (techTrackReducer.js sets this to a real instance at that
            // point, alongside the existing hasCopycatMeeple flag). Kept
            // out of `active` deliberately: it bypasses capacity
            // unconditionally, which active[]'s standard meeples never do,
            // and mixing it in risks silently distorting any future
            // active.length-based logic (hand limits, meeple counts, etc.).
            copycatMeeple: null
          },
          hand: {
            actionCards: handCatalogIds.map((catalogId) => ({
              instanceId: generateActionCardInstanceId(playerId),
              catalogId
            })),
            personalDrawPile: drawPileCatalogIds,
            personalDiscardPile: [],
            maxHandSize: STARTING_VALUES.MAX_HAND_SIZE,
            overHandSizeLimit: false,
            pendingDiscardCount: 0
          },
          roster: [],
          bankedBonusTokens: [],
          // GRW_043 "Market Dominance": for 2 rounds, rivals pay the card
          // player 2 PT whenever THEY (a rival) take the main Growth Hub
          // Recruit action. Tracked per-target (this array lives on the
          // player being taxed, listing who taxes them and until when) so
          // multiple overlapping Market Dominance effects from different
          // players can coexist without collision.
          marketDominanceEffectsAgainstMe: [],
          // SPEC_12 "The Shell Company": 5 Agents drawn privately on claim,
          // face-down next to this player's own board. Up to 2 total may be
          // recruited from this stash (1 free immediately, 1 more later this
          // round at normal requirements) — capped and tracked via
          // shellCompanyRecruitsUsed. Any remaining cards are permanently
          // discarded at End of Round (rulebook: "permanently discarded out of
          // the game during the board cleanup phase").
          shellCompanyStash: [],
          shellCompanyRecruitsUsed: 0,
          // SPEC_8 "The Venture Capitalist": once claimed, this stays true for
          // the rest of the game — every real track-cube move (via
          // cardEffectHelpers.js's adjustTrack, the single shared primitive
          // every track-moving card/space in this project already goes
          // through) that lands the cube on a bonus space (5/7/9 — DEVIATION,
          // explicit user direction 2026: Level 3 no longer counts, see
          // cardEffectHelpers.js's own comment) grants +3 PT, continuously,
          // not just a one-time claim-time snapshot.
          ventureCapitalistActive: false,
          // SPEC_11 "The Ghost in the Machine": copies an opponent's Level 5
          // Technology branch passive (Overtime Manager / Proprietary
          // Algorithm) for the rest of the round the card was claimed — 'A',
          // 'B', or null. Checked as an alternative to the player's own real
          // tech.branch/value gate in workerPlacementValidation.js and
          // techTrackReducer.js; cleared by the end-of-round sweep.
          ghostInTheMachineBorrowedBranch: null,
          // SPEC_9 "The Executive Overdrive": once claimed, this stays true
          // for the rest of the round — the player may then choose 1 Action
          // Space to resolve twice back-to-back (2nd resolution waives its
          // cost). A standalone, player-initiated action (like
          // useProprietaryAlgorithm), not tied to claim time, since the
          // rulebook's own text is "place the Specialty Meeple... [later]".
          // Scoped to spaces resolved via resolveImmediateSpace only — see
          // workerPlacementReducer.js's useExecutiveOverdrive for why deferred
          // spaces are out of scope for this specific mechanic.
          executiveOverdriveAvailable: false,
          // BATCH 9 (Section 6 passive hooks): tracks which once-per-round
          // branch abilities (AGGRESSIVE_POACHER, OVERTIME_MANAGER,
          // PROPRIETARY_ALGORITHM) have already fired this round — cleared by
          // the end-of-round sweep. Liquidation Engine is its own End of Round
          // Phase trigger, not "once per round" in this same sense, so it
          // doesn't use this array.
          oncePerRoundAbilitiesUsed: [],
          loyaltyTokensUsed: 0,
          loyaltyTokensMax: STARTING_VALUES.STARTING_LOYALTY_TOKENS,
          milestonesClaimed: [],
          turnOrderBid: {
            status: "hidden",
            profitTokensBid: 0,
            priorityTokensBid: 0
          },
          score: {
            finalized: false,
            netProfit: null,
            cultureScoreDoubled: null,
            marketShareScore: null,
            agentCountScore: null,
            loyaltyBonus: null,
            profitTokenScore: null,
            milestoneScore: null,
            total: null
          },
          postGameSurvey: {
            submitted: false,
            responses: {}
          }
        };
      }
      function createInitialState(playerConfigs) {
        _meepleCounter = 0;
        _actionCardInstanceCounter = 0;
        if (!Array.isArray(playerConfigs) || playerConfigs.length < 1 || playerConfigs.length > 6) {
          throw new Error(
            `createInitialState: expected an array of 1-6 playerConfigs, got ${Array.isArray(playerConfigs) ? playerConfigs.length : typeof playerConfigs}`
          );
        }
        const now = (/* @__PURE__ */ new Date()).toISOString();
        const players = {};
        const seats = [];
        playerConfigs.forEach((cfg, index) => {
          const playerId = cfg.playerId || `p${index + 1}`;
          players[playerId] = createEmptyPlayerState({ ...cfg, playerId });
          seats.push({
            seatIndex: index,
            playerId,
            userId: cfg.userId || null,
            displayName: cfg.displayName || cfg.name || playerId,
            avatarUrl: cfg.avatarUrl || null,
            isBot: !!cfg.isBot,
            connectionStatus: cfg.isBot ? "connected" : "disconnected",
            isHost: index === 0
          });
        });
        const playerIds = Object.keys(players);
        return {
          gameId: generateGameId(),
          createdAt: now,
          updatedAt: now,
          schemaVersion: "1.2.0",
          settings: {
            playerCount: playerIds.length,
            botCount: playerConfigs.filter((c) => c.isBot).length,
            botDifficulty: ["easy", "standard", "aggressive"],
            houseRules: {}
          },
          session: {
            status: "lobby",
            seats
          },
          phase: {
            round: 1,
            maxRounds: STARTING_VALUES.MAX_ROUNDS,
            current: "SETUP",
            activePlayerId: playerIds[0],
            turnOrder: [...playerIds],
            playersWithMeeplesRemaining: [...playerIds],
            pendingInterrupt: {
              type: "NULL",
              sourcePlayerId: null,
              data: {}
            }
          },
          shiftTracker: {
            position: 0,
            min: STARTING_VALUES.SHIFT_TRACKER_MIN,
            max: STARTING_VALUES.SHIFT_TRACKER_MAX,
            note: "CONFIRMED (design ruling): 'Shift Tracker' and 'Market Report Track' are the same tracker under two version-history names; current canonical name is Shift Tracker."
          },
          board: {
            // Full hub layout is board-config data (schema §3), loaded/merged by the
            // setup controller from a dedicated boardLayout config — not generated here.
            actionSpaces: [],
            // Requires the shuffled agent/action-card catalog; populated by dealSetup.
            openMarketAgents: [],
            openMarketActionCards: [],
            decks: {
              agentDrawPile: [],
              agentDiscardPile: [],
              actionCardDrawPile: [],
              actionCardDiscardPile: [],
              shiftDrawPile: [],
              shiftDiscardPile: []
            },
            statusTokens: []
          },
          bank: {
            profitTokens: STARTING_VALUES.BANK_PROFIT_TOKENS,
            priorityTokens: STARTING_VALUES.BANK_PRIORITY_TOKENS,
            loyaltyTokens: STARTING_VALUES.BANK_LOYALTY_TOKENS,
            coachTokens: STARTING_VALUES.BANK_COACH_TOKENS,
            onboardingTokens: "unlimited",
            timeMeeples: STARTING_VALUES.BANK_TIME_MEEPLES
          },
          players,
          log: []
        };
      }
      module.exports = { createInitialState, STARTING_VALUES };
    }
  });

  // boardConfigLoader.js
  var require_boardConfigLoader = __commonJS({
    "boardConfigLoader.js"(exports, module) {
      var HUBS = Object.freeze({
        GROWTH: "GROWTH",
        LEADERSHIP: "LEADERSHIP",
        OPERATIONS: "OPERATIONS",
        EXECUTIVE_DECISIONS: "EXECUTIVE_DECISIONS",
        EXECUTIVE_SEARCH: "EXECUTIVE_SEARCH"
      });
      var SPACE_TYPES = Object.freeze({
        SINGLE_VALUE_BOOST: "single_value_boost",
        DUAL_VALUE_BOOST: "dual_value_boost",
        FLAT_RESOURCE_GRANT: "flat_resource_grant",
        ACQUIRE_OR_PLAY_ACTION_CARD: "acquire_or_play_action_card",
        DRAFT_OPEN_MARKET_AGENT: "draft_open_market_agent",
        EXECUTIVE_DECISION_CHOICE: "executive_decision_choice",
        // --- not yet in workerPlacementReducer's IMMEDIATE/DEFERRED lists ---
        HIRE_STAFF: "hire_staff",
        OFFICE_EXPANSION: "office_expansion",
        HIRE_COACH: "hire_coach",
        MARKET_SHARE_ADVANCE: "market_share_advance",
        SPECIALIST_ACTION: "specialist_action"
      });
      var ACTION_SPACE_CATALOG = Object.freeze([
        // --- GROWTH HUB --------------------------------------------------------
        Object.freeze({
          spaceId: "GRW_RECRUIT_AGENT",
          hub: HUBS.GROWTH,
          type: SPACE_TYPES.DRAFT_OPEN_MARKET_AGENT,
          capacity: 5,
          // matches the 5-slot Open Market row itself — up to 5 recruits could theoretically be resolved in a single round if enough meeples/desks/matching values exist. FIXED (item 4): was capacity:1 (an unverified assumption on my part, not backed by explicit rulebook text), which incorrectly disabled the space after a single placement even when the market and desks had room.
          cost: { profitTokens: 0 },
          // Brokerage Deficit Tax confirmed REMOVED (legacy rule) — recruiting is always $0 PT, gated only by matching-value count.
          reward: null,
          notes: "Requires an open Office Desk + >=1 matching Brokerage Value. Resolved via agentRecruitmentReducer.js's recruitOpenMarketAgent (built)."
        }),
        Object.freeze({
          spaceId: "GRW_POACH_AGENT",
          hub: HUBS.GROWTH,
          type: SPACE_TYPES.DRAFT_OPEN_MARKET_AGENT,
          // same deferred-choice shape as Recruit (choose a target post-placement)
          capacity: 1,
          cost: { profitTokens: 0 },
          // Poaching is confirmed $0 PT in the rulebook — no PT payment involved at all.
          reward: null,
          notes: "FLAGGED_GAP: no explicit physical position/cost for a dedicated Poach space was found in the retrievable rulebook text \u2014 this entry is a best-effort placement (Growth Hub, $0 PT, 1 meeple, matching Recruit's own cost shape) pending confirmation against the physical board. Requires an open Office Desk + >=2 matching Brokerage Values, target must carry no Onboarding/Loyalty token. Resolved via agentRecruitmentReducer.js's poachCompetingBrokerAgent (built)."
        }),
        Object.freeze({
          spaceId: "GRW_LOYALTY_TOKEN",
          hub: HUBS.GROWTH,
          type: SPACE_TYPES.DRAFT_OPEN_MARKET_AGENT,
          // same deferred-choice shape (choose which own agent post-placement)
          capacity: 1,
          cost: { profitTokens: 0 },
          reward: null,
          notes: `This is the real "Growth Hub 'L' space" the rulebook names directly (confirmed via the Free Loyalty Token bonus-stack entry: "...bypasses the need to spend a worker action on the Growth Hub 'L' space"). FLAGGED_GAP: its own exact cost was not found in the retrievable text \u2014 $0 PT / 1 meeple used as a best-effort placement, matching this hub's other agent-actions. Requires ALL 3 matching values on the target agent. Resolved via agentRecruitmentReducer.js's placeLoyaltyToken / moveLoyaltyToken (built) \u2014 moveLoyaltyToken only once all 3 tokens are already deployed, placeLoyaltyToken otherwise.`
        }),
        Object.freeze({
          spaceId: "GRW_MARKET_SHARE_ADVANCE",
          hub: HUBS.EXECUTIVE_DECISIONS,
          type: SPACE_TYPES.MARKET_SHARE_ADVANCE,
          capacity: null,
          // confirmed via the official board image: Market Share shows an ∞ symbol — unlimited placements, never blocks
          cost: null,
          reward: { type: "marketShareTrack", amount: 1 },
          notes: "RESOLVED: previously flagged as an inferred/unconfirmed hub assignment (Growth Hub, guessed from surrounding rulebook text with no explicit header). Confirmed via direct board alignment \u2014 this space genuinely belongs in the Executive Decisions hub, not Growth. spaceId left unchanged (GRW_MARKET_SHARE_ADVANCE) since it is referenced by catalogId elsewhere in the codebase (bot fallback tiers, UI sprint-bonus rendering) \u2014 only its hub placement moved."
        }),
        // --- LEADERSHIP HUB ------------------------------------------------------
        Object.freeze({
          spaceId: "LDR_HIRE_STAFF",
          hub: HUBS.LEADERSHIP,
          type: SPACE_TYPES.HIRE_STAFF,
          capacity: 1,
          // fallback for a 2-player game (2-1=1) — real capacity is dynamic, see capacityScalesWithPlayerCount
          capacityScalesWithPlayerCount: true,
          // official v2.0 18x18 board: numbered circles (2,3,4,5,6) mark this space's real capacity as (player count - 1)
          cost: { profitTokens: 4 },
          reward: { type: "meeple", destination: "staff_in_training" },
          notes: 'FLAGGED_GAP: new meeple enters "Staff in Training", not the active supply (available next round only) \u2014 existing awardMeeple() helper always creates meeples as in_supply/active, so this needs either a new helper or an awardMeeple param. Not resolved here.'
        }),
        Object.freeze({
          spaceId: "LDR_OFFICE_EXPANSION",
          hub: HUBS.LEADERSHIP,
          type: SPACE_TYPES.OFFICE_EXPANSION,
          capacity: 1,
          // fallback for a 2-player game (2-1=1) — real capacity is dynamic, see capacityScalesWithPlayerCount
          capacityScalesWithPlayerCount: true,
          // official v2.0 18x18 board: numbered circles (2,3,4,5,6) mark this space's real capacity as (player count - 1)
          cost: { profitTokens: 4 },
          reward: { type: "office", amount: 1 },
          notes: "Fixed (item 4): office_expansion is now in IMMEDIATE_SPACE_TYPES and applyRewardConfig's 'office' case correctly calls adjustOfficeSlots. Previously silently no-opped \u2014 the player paid the cost and received nothing."
        }),
        Object.freeze({
          spaceId: "LDR_HIRE_COACH",
          hub: HUBS.LEADERSHIP,
          type: SPACE_TYPES.HIRE_COACH,
          capacity: null,
          cost: { profitTokens: 3 },
          reward: { type: "coachToken", amount: 1 },
          notes: "FLAGGED_GAP: coach token must then be assigned to a specific roster agent (player choice) \u2014 this space grants the token; assignment is a separate deferred choice, same pattern as executive_decision_choice. FIX: capacity corrected from a hardcoded 1 to null (unlimited/\u221E), matching the established convention for every other unlimited space in this file \u2014 was silently blocking placement after the first meeple."
        }),
        // --- OPERATIONS HUB ------------------------------------------------------
        //
        // FLAGGED_GAP (all three value spaces below): rulebook §5 Operations Hub
        // says "the first Time Meeple placed in each of the value spaces increases
        // that value by 2 instead of 1" — implying more than one meeple CAN occupy
        // a value space in a round. MASTER_GAME_STATE_SCHEMA_1.md §3's own example
        // shows spaceId "OPS_TRAINING" with capacity: 1 and a single occupant.
        // These two sources disagree. Modeled here per the rulebook (unlimited
        // capacity + rewardByArrivalOrder), since rules text is more authoritative
        // than an illustrative schema snippet — but this should be confirmed
        // before Phase 3 locks, since it contradicts a "locked" schema example.
        Object.freeze({
          spaceId: "OPS_TRAINING",
          hub: HUBS.OPERATIONS,
          type: SPACE_TYPES.SINGLE_VALUE_BOOST,
          capacity: null,
          cost: null,
          rewardByArrivalOrder: [2, 1, 1, 1, 1, 1],
          trackName: "training",
          notes: "See Operations Hub capacity discrepancy note above."
        }),
        Object.freeze({
          spaceId: "OPS_TECHNOLOGY",
          hub: HUBS.OPERATIONS,
          type: SPACE_TYPES.SINGLE_VALUE_BOOST,
          capacity: null,
          cost: null,
          rewardByArrivalOrder: [2, 1, 1, 1, 1, 1],
          trackName: "technology",
          notes: "See Operations Hub capacity discrepancy note above."
        }),
        Object.freeze({
          spaceId: "OPS_RECOGNITION",
          hub: HUBS.OPERATIONS,
          type: SPACE_TYPES.SINGLE_VALUE_BOOST,
          capacity: null,
          cost: null,
          rewardByArrivalOrder: [2, 1, 1, 1, 1, 1],
          trackName: "recognition",
          notes: "See Operations Hub capacity discrepancy note above."
        }),
        Object.freeze({
          spaceId: "OPS_2X_COMBO",
          hub: HUBS.OPERATIONS,
          type: SPACE_TYPES.DUAL_VALUE_BOOST,
          // Rulebook is explicit: "Bonus 2x only has 1 space available to place a
          // time meeple in a round" — capacity 1 is confirmed, not inferred.
          capacity: 1,
          cost: null,
          reward: { type: "dualTrackChoice", amount: 1 },
          notes: "Player chooses any 2 of training/technology/recognition, +1 each. REVERTED: a prior session moved this to the Growth Hub; explicit direction restored it to Operations, where it now stays."
        }),
        // --- EXECUTIVE DECISIONS HUB ---------------------------------------------
        Object.freeze({
          spaceId: "EXEC_ADDITIONAL_PROFIT",
          hub: HUBS.EXECUTIVE_DECISIONS,
          type: SPACE_TYPES.FLAT_RESOURCE_GRANT,
          // Rulebook: "this action space is unlimited."
          capacity: null,
          cost: null,
          // 1st=5, 2nd=4, 3rd+=3 (rulebook explicit). Padded to 6 for max players.
          rewardByArrivalOrder: [5, 4, 3, 3, 3, 3],
          notes: "profitTokens grant, amount keyed by arrival order."
        }),
        Object.freeze({
          spaceId: "EXEC_TAKE_PLAY_CARD",
          hub: HUBS.EXECUTIVE_DECISIONS,
          type: SPACE_TYPES.ACQUIRE_OR_PLAY_ACTION_CARD,
          capacity: null,
          cost: { profitTokens: 0 },
          // rulebook: "Zero cost... other than a time meeple"
          // Reused verbatim from MASTER_GAME_STATE_SCHEMA_1.md §3's own example
          // for this exact spaceId.
          rewardByArrivalOrder: [0, 0, 3],
          notes: "Deferred \u2014 resolved via actionCardReducer.js / a future openMarketReducer.js."
        }),
        Object.freeze({
          spaceId: "EXEC_CLEAR_OPEN_MARKET",
          hub: HUBS.EXECUTIVE_DECISIONS,
          type: SPACE_TYPES.EXECUTIVE_DECISION_CHOICE,
          capacity: 1,
          // "limited to 1 worker meeple per round across all players"
          cost: null,
          reward: null,
          notes: `NEW space: "Clear Open Market Cards." Reuses the EXECUTIVE_DECISION_CHOICE space type, which was already defined in the SPACE_TYPES enum but had no space using it yet. Choice: clear the Action row, the Agent row, or both, fully replenishing from the respective deck(s); then the player receives 1 free Action Card acquired directly from the newly-revealed Open Market Action row. Resolved via workerPlacementReducer.js's resolveClearOpenMarketChoice.`
        }),
        // --- EXECUTIVE SEARCH HUB -------------------------------------------------
        Object.freeze({
          spaceId: "EXEC_SEARCH_SPECIALTY_AGENT_HUB",
          hub: HUBS.EXECUTIVE_SEARCH,
          type: SPACE_TYPES.SPECIALIST_ACTION,
          capacity: 1,
          // FLAGGED_GAP: cost has a dimension (2 committed meeples) that
          // space.cost's documented shape ({ profitTokens?, priorityTokens? } per
          // WORKER_PLACEMENT_SPEC.md's file-header note) doesn't cover.
          cost: { profitTokens: 2, meepleCost: 2 },
          reward: null,
          // resolves the current round's revealed Specialist card text
          notes: 'FLAGGED_GAP: meepleCost is not part of any cost shape read elsewhere in the codebase yet. Also "1x per round" (Spent-token lockout) is a status-token concern (schema \xA73 statusTokens[]), not a capacity concern \u2014 capacity:1 here just reflects "one player can occupy/trigger it."'
        })
      ]);
      var MARKET_SHARE_TRACK_SPACES = Object.freeze([0, 1, 2, 4, 7, 10, 14, 17, 22, 27, 33]);
      var MARKET_SHARE_BONUS_STACK_TEMPLATE = Object.freeze({
        4: Object.freeze({ top: "FREE_5PT", bottom: "FREE_1PT" }),
        10: Object.freeze({ top: "FREE_OPEN_MARKET_AGENT", bottom: "FREE_COACH_TOKEN" }),
        17: Object.freeze({ top: "FREE_ACTION", bottom: "FREE_LOYALTY_TOKEN" })
      });
      function buildMarketShareTrack() {
        const bonusStacks = {};
        Object.keys(MARKET_SHARE_BONUS_STACK_TEMPLATE).forEach((position) => {
          const stack = MARKET_SHARE_BONUS_STACK_TEMPLATE[position];
          bonusStacks[position] = { top: stack.top, bottom: stack.bottom, claimedBy: [] };
        });
        return {
          spaces: [...MARKET_SHARE_TRACK_SPACES],
          bonusStacks
        };
      }
      var SPECIALIST_DECK_SIZE = 13;
      var SPECIALIST_ROUNDS = 7;
      function defaultShuffle(array, rng = Math.random) {
        const copy = [...array];
        for (let i = copy.length - 1; i > 0; i -= 1) {
          const j = Math.floor(rng() * (i + 1));
          [copy[i], copy[j]] = [copy[j], copy[i]];
        }
        return copy;
      }
      function buildSpecialistDeck(specialistCatalogIds, options = {}) {
        if (!Array.isArray(specialistCatalogIds) || specialistCatalogIds.length !== SPECIALIST_DECK_SIZE) {
          throw new Error(
            `buildSpecialistDeck: expected exactly ${SPECIALIST_DECK_SIZE} specialistCatalogIds, got ${Array.isArray(specialistCatalogIds) ? specialistCatalogIds.length : typeof specialistCatalogIds}`
          );
        }
        const shuffle = options.shuffle || defaultShuffle;
        const shuffled = shuffle([...specialistCatalogIds]);
        const gameClockPile = shuffled.slice(0, SPECIALIST_ROUNDS);
        const [firstReveal, ...remainingDrawPile] = gameClockPile;
        return {
          drawPile: remainingDrawPile,
          discardPile: [],
          activeCard: {
            catalogId: firstReveal,
            revealedRound: 1,
            claimedByPlayerId: null,
            cubeState: "unused",
            cubeLocation: null
          }
        };
      }
      var MIN_PLAYERS = 1;
      var MAX_PLAYERS = 6;
      var ACTION_CARD_OPEN_MARKET_SIZE = 5;
      function buildActionCardOpenMarket(actionCardCatalogIds, options = {}) {
        if (!Array.isArray(actionCardCatalogIds) || actionCardCatalogIds.length < ACTION_CARD_OPEN_MARKET_SIZE) {
          throw new Error(
            `buildActionCardOpenMarket: expected at least ${ACTION_CARD_OPEN_MARKET_SIZE} actionCardCatalogIds, got ${Array.isArray(actionCardCatalogIds) ? actionCardCatalogIds.length : typeof actionCardCatalogIds}`
          );
        }
        const shuffle = options.shuffle || defaultShuffle;
        const shuffled = shuffle([...actionCardCatalogIds]);
        const openMarketActionCards = shuffled.slice(0, ACTION_CARD_OPEN_MARKET_SIZE).map((catalogId) => ({ catalogId }));
        const actionCardDrawPile = shuffled.slice(ACTION_CARD_OPEN_MARKET_SIZE);
        return { openMarketActionCards, actionCardDrawPile };
      }
      function buildAgentOpenMarket(agentCatalog, options = {}) {
        const shuffle = options.shuffle || defaultShuffle;
        const starterCatalogIds = Object.values(agentCatalog).filter((a) => a.isStarter).map((a) => a.catalogId);
        const nonStarterCatalogIds = Object.values(agentCatalog).filter((a) => !a.isStarter).map((a) => a.catalogId);
        if (starterCatalogIds.length === 0) {
          throw new Error("buildAgentOpenMarket: agentCatalog has no Starter Card entries \u2014 cannot initialize the Open Market.");
        }
        const openMarketAgents = starterCatalogIds.map((catalogId) => ({ catalogId }));
        const agentDrawPile = shuffle([...nonStarterCatalogIds]);
        return { openMarketAgents, agentDrawPile };
      }
      function loadBoardConfig(playerCount, options = {}) {
        if (!Number.isInteger(playerCount) || playerCount < MIN_PLAYERS || playerCount > MAX_PLAYERS) {
          throw new Error(
            `loadBoardConfig: expected an integer playerCount between ${MIN_PLAYERS}-${MAX_PLAYERS}, got ${playerCount}`
          );
        }
        const actionSpaces = ACTION_SPACE_CATALOG.map((template) => ({
          spaceId: template.spaceId,
          hub: template.hub,
          type: template.type,
          capacity: template.capacity,
          ...template.capacityScalesWithPlayerCount ? { capacityScalesWithPlayerCount: true } : {},
          cost: template.cost ? { ...template.cost } : null,
          ...template.reward !== void 0 ? { reward: template.reward ? { ...template.reward } : null } : {},
          ...template.rewardByArrivalOrder ? { rewardByArrivalOrder: [...template.rewardByArrivalOrder] } : {},
          ...template.trackName ? { trackName: template.trackName } : {},
          occupiedBy: [],
          status: "open",
          statusToken: null
        }));
        const marketShareTrack = buildMarketShareTrack();
        const specialistDeck = options.specialistCatalogIds ? buildSpecialistDeck(options.specialistCatalogIds, { shuffle: options.shuffle }) : null;
        const actionCardOpenMarket = options.actionCardCatalogIds ? buildActionCardOpenMarket(options.actionCardCatalogIds, { shuffle: options.shuffle }) : null;
        const agentOpenMarket = options.agentCatalog ? buildAgentOpenMarket(options.agentCatalog, { shuffle: options.shuffle }) : null;
        return { actionSpaces, marketShareTrack, specialistDeck, actionCardOpenMarket, agentOpenMarket };
      }
      module.exports = {
        HUBS,
        SPACE_TYPES,
        ACTION_SPACE_CATALOG,
        MARKET_SHARE_TRACK_SPACES,
        MARKET_SHARE_BONUS_STACK_TEMPLATE,
        ACTION_CARD_OPEN_MARKET_SIZE,
        buildActionCardOpenMarket,
        buildAgentOpenMarket,
        SPECIALIST_DECK_SIZE,
        SPECIALIST_ROUNDS,
        buildMarketShareTrack,
        buildSpecialistDeck,
        loadBoardConfig
      };
    }
  });

  // techTrackReducer.js
  var require_techTrackReducer = __commonJS({
    "techTrackReducer.js"(exports, module) {
      var { adjustWallet, adjustTrack, adjustOfficeSlots, awardMeeple, adjustMarketShare } = require_cardEffectHelpers();
      var { MARKET_SHARE_TRACK_SPACES } = require_boardConfigLoader();
      function getAgentStats(state, catalogId) {
        return (state.cardCatalog && state.cardCatalog.agentCards || {})[catalogId] || null;
      }
      function appendLog(state, entry) {
        return {
          ...state,
          log: [...state.log, { seq: state.log.length + 1, timestamp: (/* @__PURE__ */ new Date()).toISOString(), round: state.phase.round, ...entry }]
        };
      }
      var VALID_TRACKS = /* @__PURE__ */ new Set(["training", "technology", "recognition"]);
      var VALID_BRANCHES = /* @__PURE__ */ new Set(["A", "B"]);
      function resolveTrackBranchChoice(state, playerId, trackName, chosenBranch) {
        const interrupt = state.phase.pendingInterrupt;
        if (!interrupt || interrupt.type !== "TRACK_BRANCH_CHOICE" || interrupt.sourcePlayerId !== playerId || !interrupt.data || interrupt.data.trackName !== trackName) {
          return { state, error: "NO_PENDING_BRANCH_CHOICE", detail: { playerId, trackName, pendingInterrupt: interrupt || null } };
        }
        if (!VALID_BRANCHES.has(chosenBranch)) {
          return { state, error: "INVALID_BRANCH", detail: { chosenBranch } };
        }
        let nextState = {
          ...state,
          players: {
            ...state.players,
            [playerId]: {
              ...state.players[playerId],
              tracks: {
                ...state.players[playerId].tracks,
                [trackName]: { ...state.players[playerId].tracks[trackName], branch: chosenBranch }
              }
            }
          },
          phase: { ...state.phase, pendingInterrupt: { type: "NULL", sourcePlayerId: null, data: {} } }
        };
        nextState = appendLog(nextState, {
          type: "TRACK_BRANCH_CHOSEN",
          playerId,
          trackName,
          chosenBranch,
          message: `${playerId} permanently commits to Branch ${chosenBranch} on ${trackName}.`
        });
        nextState = applyLevel5ImmediateEffect(nextState, playerId, trackName, chosenBranch);
        return { state: nextState, error: null, detail: null };
      }
      function applyLevel5ImmediateEffect(state, playerId, trackName, branch) {
        const reAddToPlayersWithMeeplesRemaining = (s) => s.phase.current === "WORKER_PLACEMENT" && !s.phase.playersWithMeeplesRemaining.includes(playerId) ? { ...s, phase: { ...s.phase, playersWithMeeplesRemaining: [...s.phase.playersWithMeeplesRemaining, playerId] } } : s;
        if (trackName === "training" && branch === "B") {
          const player = state.players[playerId];
          if (player.timeMeeples.staffInTraining.length === 0) {
            return appendLog(state, {
              type: "UNION_BUSTER_IMMEDIATE_SKIPPED",
              playerId,
              reason: "NO_STAFF_IN_TRAINING"
            });
          }
          const [promoted, ...remaining] = player.timeMeeples.staffInTraining;
          let nextState = {
            ...state,
            players: {
              ...state.players,
              [playerId]: {
                ...player,
                timeMeeples: {
                  ...player.timeMeeples,
                  active: [...player.timeMeeples.active, { ...promoted, status: "in_supply", locationSpaceId: null }],
                  staffInTraining: remaining
                }
              }
            }
          };
          nextState = reAddToPlayersWithMeeplesRemaining(nextState);
          return appendLog(nextState, {
            type: "UNION_BUSTER_IMMEDIATE_APPLIED",
            playerId,
            message: `${playerId}'s Union Buster instantly promotes 1 Staff-in-Training meeple to available this round.`
          });
        }
        if (trackName === "recognition" && branch === "B") {
          const player = state.players[playerId];
          let nextState = {
            ...state,
            players: {
              ...state.players,
              [playerId]: {
                ...player,
                hasCopycatMeeple: true,
                timeMeeples: {
                  ...player.timeMeeples,
                  copycatMeeple: { instanceId: `copycat-${playerId}`, status: "in_supply", locationSpaceId: null }
                }
              }
            }
          };
          nextState = reAddToPlayersWithMeeplesRemaining(nextState);
          return appendLog(nextState, {
            type: "COPYCAT_MARKETING_IMMEDIATE_APPLIED",
            playerId,
            message: `${playerId} claims the Orange Copycat Meeple.`
          });
        }
        return state;
      }
      function checkLevel10Milestone(state, playerId, trackName, beforeValue, afterValue) {
        if (!(beforeValue < 10 && afterValue >= 10)) {
          return state;
        }
        const alreadyClaimedByAnyone = Object.values(state.players).some((p) => p.milestonesClaimed.includes("MAXED_OUT_VALUE"));
        if (alreadyClaimedByAnyone) {
          return state;
        }
        const nextState = {
          ...state,
          players: {
            ...state.players,
            [playerId]: {
              ...state.players[playerId],
              milestonesClaimed: [...state.players[playerId].milestonesClaimed, "MAXED_OUT_VALUE"]
            }
          }
        };
        return appendLog(nextState, {
          type: "MILESTONE_CLAIMED",
          playerId,
          milestoneKey: "MAXED_OUT_VALUE",
          trackName,
          message: `${playerId} is the first to reach Level 10 on ${trackName} \u2014 claims the Maxed-Out Stat Milestone Token.`
        });
      }
      function checkTrackMilestonesIfEligible(state, playerId, trackName, beforeValue) {
        if (!VALID_TRACKS.has(trackName)) {
          return state;
        }
        const player = state.players[playerId];
        const afterValue = player.tracks[trackName].value;
        if (afterValue <= beforeValue) {
          return state;
        }
        const track = player.tracks[trackName];
        if (beforeValue < 5 && afterValue >= 5 && track.branch === null) {
          return {
            ...state,
            phase: {
              ...state.phase,
              pendingInterrupt: {
                type: "TRACK_BRANCH_CHOICE",
                sourcePlayerId: playerId,
                data: { trackName }
              }
            }
          };
        }
        let nextState = state;
        if (track.branch !== null) {
          nextState = checkLevel7And9Milestones(nextState, playerId, trackName, beforeValue, afterValue);
        }
        nextState = checkLevel10Milestone(nextState, playerId, trackName, beforeValue, afterValue);
        return nextState;
      }
      var MILESTONE_KEY_BY_TRACK_BRANCH_LEVEL = {
        "training-A-7": "HEADHUNTER",
        "training-A-9": "POISON_PILL",
        "training-B-7": "EXECUTIVE_HEADROOM",
        "training-B-9": "IRONCLAD_CONTRACT",
        "technology-A-7": "SIGNAL_JAMMER",
        "technology-A-9": "SILICON_VALLEY_SWEEP",
        "technology-B-7": "CLOUD_INFRASTRUCTURE",
        "technology-B-9": "MASTER_ALGORITHM",
        "recognition-A-7": "VENTURE_LIQUIDATION",
        "recognition-A-9": "GOLDEN_PARACHUTE",
        "recognition-B-7": "HOSTILE_BUYOUT",
        "recognition-B-9": "MARKET_HIJACK"
      };
      var TARGETED_MILESTONE_KEYS = /* @__PURE__ */ new Set([
        "HEADHUNTER",
        "POISON_PILL",
        "IRONCLAD_CONTRACT",
        "SIGNAL_JAMMER",
        "SILICON_VALLEY_SWEEP",
        "MASTER_ALGORITHM",
        "HOSTILE_BUYOUT"
      ]);
      function markMilestoneClaimed(state, playerId, trackName, level) {
        return {
          ...state,
          players: {
            ...state.players,
            [playerId]: {
              ...state.players[playerId],
              tracks: {
                ...state.players[playerId].tracks,
                [trackName]: {
                  ...state.players[playerId].tracks[trackName],
                  claimedMilestones: [...state.players[playerId].tracks[trackName].claimedMilestones, level]
                }
              }
            }
          }
        };
      }
      function checkLevel7And9Milestones(state, playerId, trackName, beforeValue, afterValue) {
        let nextState = state;
        const branch = nextState.players[playerId].tracks[trackName].branch;
        [7, 9].forEach((level) => {
          const track = nextState.players[playerId].tracks[trackName];
          if (!(beforeValue < level && afterValue >= level) || track.claimedMilestones.includes(level)) {
            return;
          }
          const milestoneKey = MILESTONE_KEY_BY_TRACK_BRANCH_LEVEL[`${trackName}-${branch}-${level}`];
          if (!milestoneKey) return;
          nextState = markMilestoneClaimed(nextState, playerId, trackName, level);
          if (TARGETED_MILESTONE_KEYS.has(milestoneKey)) {
            nextState = {
              ...nextState,
              phase: {
                ...nextState.phase,
                pendingInterrupt: {
                  type: "TRACK_MILESTONE_CHOICE",
                  sourcePlayerId: playerId,
                  data: { trackName, level, milestoneKey }
                }
              }
            };
            nextState = appendLog(nextState, {
              type: "TRACK_MILESTONE_AWAITING_CHOICE",
              playerId,
              trackName,
              level,
              milestoneKey
            });
            return;
          }
          nextState = applyInstantMilestone(nextState, playerId, trackName, level, milestoneKey);
        });
        return nextState;
      }
      function applyInstantMilestone(state, playerId, trackName, level, milestoneKey) {
        const player = state.players[playerId];
        if (milestoneKey === "EXECUTIVE_HEADROOM") {
          let nextState = adjustOfficeSlots(state, playerId, 2);
          nextState = checkGlobalFirstToMilestones(nextState, playerId);
          return appendLog(nextState, { type: "MILESTONE_APPLIED", playerId, milestoneKey, message: `${playerId}'s Executive Headroom unlocks 2 free offices.` });
        }
        if (milestoneKey === "CLOUD_INFRASTRUCTURE") {
          const drawPile = player.hand.personalDrawPile;
          const drawCount = Math.min(3, drawPile.length);
          const drawnCatalogIds = drawPile.slice(0, drawCount);
          const remainingDrawPile = drawPile.slice(drawCount);
          const newCards = drawnCatalogIds.map((catalogId, i) => ({
            instanceId: `ac-${playerId}-cloudinfra-${i}`,
            catalogId
          }));
          const nextState = {
            ...state,
            players: {
              ...state.players,
              [playerId]: {
                ...player,
                hand: {
                  ...player.hand,
                  actionCards: [...player.hand.actionCards, ...newCards],
                  personalDrawPile: remainingDrawPile,
                  maxHandSize: player.hand.maxHandSize + 2
                }
              }
            }
          };
          return appendLog(nextState, {
            type: "MILESTONE_APPLIED",
            playerId,
            milestoneKey,
            drawnCount: drawCount,
            message: `${playerId}'s Cloud Infrastructure draws ${drawCount} cards and permanently raises hand size by 2.`
          });
        }
        if (milestoneKey === "VENTURE_LIQUIDATION") {
          const moveAmount = Math.min(2, player.wallet.profitTokens);
          let nextState = adjustWallet(state, playerId, -moveAmount, 0);
          nextState = {
            ...nextState,
            players: {
              ...nextState.players,
              [playerId]: {
                ...nextState.players[playerId],
                liquidityStaffPT: (nextState.players[playerId].liquidityStaffPT || 0) + moveAmount,
                // FIX: card text is explicit ("Next Round Only") — without
                // tracking which round these are valid for, there was no
                // way to enforce that, nor any way to actually spend them
                // at all (see the new USE_LIQUIDITY_STAFF_PT dispatcher
                // case below, which checks this field).
                liquidityStaffPTUsableRound: nextState.phase.round + 1
              }
            }
          };
          return appendLog(nextState, {
            type: "MILESTONE_APPLIED",
            playerId,
            milestoneKey,
            movedAmount: moveAmount,
            message: `${playerId}'s Venture Liquidation moves ${moveAmount} PT into Staff-in-Training, usable as labor next round only.`
          });
        }
        if (milestoneKey === "GOLDEN_PARACHUTE") {
          const nextState = {
            ...state,
            players: {
              ...state.players,
              [playerId]: { ...player, hasGoldenParachute: true }
            }
          };
          return appendLog(nextState, {
            type: "MILESTONE_APPLIED",
            playerId,
            milestoneKey,
            message: `${playerId} unlocks the Golden Parachute \u2014 3 PT = 1 VP at final scoring (max +10 VP).`
          });
        }
        if (milestoneKey === "MARKET_HIJACK") {
          let nextState = adjustWallet(state, playerId, -4, 0);
          nextState = {
            ...nextState,
            players: {
              ...nextState.players,
              [playerId]: { ...nextState.players[playerId], hasMarketHijack: true }
            }
          };
          return appendLog(nextState, {
            type: "MILESTONE_APPLIED",
            playerId,
            milestoneKey,
            message: `${playerId} pays $4 PT to unlock Market Hijack \u2014 placing the Copycat Meeple now also advances the Market Share Track for free.`
          });
        }
        return state;
      }
      function resolveTargetedMilestone(state, playerId, options = {}) {
        const interrupt = state.phase.pendingInterrupt;
        if (!interrupt || interrupt.type !== "TRACK_MILESTONE_CHOICE" || interrupt.sourcePlayerId !== playerId || !interrupt.data) {
          return { state, error: "NO_PENDING_MILESTONE_CHOICE", detail: { playerId, pendingInterrupt: interrupt || null } };
        }
        const { milestoneKey } = interrupt.data;
        const player = state.players[playerId];
        const clearInterrupt = (s) => ({ ...s, phase: { ...s.phase, pendingInterrupt: { type: "NULL", sourcePlayerId: null, data: {} } } });
        if (milestoneKey === "HEADHUNTER") {
          const drawPile = state.board.decks.agentDrawPile || [];
          if (drawPile.length === 0) {
            return { state: clearInterrupt(state), error: null, detail: { skipped: true, reason: "AGENT_DECK_EMPTY" } };
          }
          const drawCount = Math.min(2, drawPile.length);
          const drawn = drawPile.slice(0, drawCount);
          const remaining = drawPile.slice(drawCount);
          const keepCatalogId = options.keepCatalogId && drawn.includes(options.keepCatalogId) ? options.keepCatalogId : drawn[0];
          const discarded = drawn.filter((id) => id !== keepCatalogId);
          let nextState = {
            ...state,
            board: {
              ...state.board,
              decks: { ...state.board.decks, agentDrawPile: [keepCatalogId, ...discarded, ...remaining] }
            }
          };
          nextState = clearInterrupt(nextState);
          nextState = appendLog(nextState, {
            type: "MILESTONE_APPLIED",
            playerId,
            milestoneKey,
            keptCatalogId: keepCatalogId,
            message: `${playerId}'s Headhunter draws 2 Agents, keeps ${keepCatalogId} atop the deck for a future recruit.`
          });
          return { state: nextState, error: null, detail: null };
        }
        if (milestoneKey === "POISON_PILL") {
          const { targetPlayerId, targetAgentInstanceId } = options;
          if (player.wallet.profitTokens < 4) {
            return { state, error: "INSUFFICIENT_PT", detail: { required: 4 } };
          }
          const targetRoster = state.players[targetPlayerId] ? state.players[targetPlayerId].roster : [];
          const targetEntry = targetRoster.find((r) => r.agentInstanceId === targetAgentInstanceId && !r.isVoided);
          if (!targetEntry) {
            return { state, error: "TARGET_AGENT_NOT_FOUND", detail: { targetPlayerId, targetAgentInstanceId } };
          }
          if (targetEntry.onboardingToken.active || targetEntry.loyaltyToken.active) {
            return { state, error: "TARGET_AGENT_PROTECTED", detail: null };
          }
          let nextState = adjustWallet(state, playerId, -4, 0);
          nextState = {
            ...nextState,
            players: {
              ...nextState.players,
              [targetPlayerId]: {
                ...nextState.players[targetPlayerId],
                roster: nextState.players[targetPlayerId].roster.map(
                  (r) => r.agentInstanceId === targetAgentInstanceId ? { ...r, exhausted: true } : r
                )
              }
            }
          };
          nextState = clearInterrupt(nextState);
          nextState = appendLog(nextState, {
            type: "MILESTONE_APPLIED",
            playerId,
            milestoneKey,
            targetPlayerId,
            targetAgentInstanceId,
            message: `${playerId}'s Poison Pill exhausts ${targetEntry.catalogId} in ${targetPlayerId}'s brokerage \u2014 half Profit at final scoring.`
          });
          return { state: nextState, error: null, detail: null };
        }
        if (milestoneKey === "IRONCLAD_CONTRACT") {
          const { targetAgentInstanceId } = options;
          if (player.wallet.profitTokens < 4) {
            return { state, error: "INSUFFICIENT_PT", detail: { required: 4 } };
          }
          const targetEntry = player.roster.find((r) => r.agentInstanceId === targetAgentInstanceId && !r.isVoided);
          if (!targetEntry) {
            return { state, error: "TARGET_AGENT_NOT_FOUND", detail: { targetAgentInstanceId } };
          }
          let nextState = adjustWallet(state, playerId, -4, 0);
          nextState = {
            ...nextState,
            players: {
              ...nextState.players,
              [playerId]: {
                ...nextState.players[playerId],
                loyaltyTokensMax: nextState.players[playerId].loyaltyTokensMax + 1,
                loyaltyTokensUsed: nextState.players[playerId].loyaltyTokensUsed + 1,
                roster: nextState.players[playerId].roster.map(
                  (r) => r.agentInstanceId === targetAgentInstanceId ? { ...r, loyaltyToken: { active: true } } : r
                )
              }
            }
          };
          nextState = clearInterrupt(nextState);
          nextState = appendLog(nextState, {
            type: "MILESTONE_APPLIED",
            playerId,
            milestoneKey,
            targetAgentInstanceId,
            message: `${playerId}'s Ironclad Contract permanently locks down ${targetEntry.catalogId}, exceeding the standard Loyalty Token limit.`
          });
          return { state: nextState, error: null, detail: null };
        }
        if (milestoneKey === "SIGNAL_JAMMER") {
          const { targetSpaceId } = options;
          const space = state.board.actionSpaces.find((s) => s.spaceId === targetSpaceId);
          if (!space) {
            return { state, error: "SPACE_NOT_FOUND", detail: { targetSpaceId } };
          }
          let nextState = {
            ...state,
            board: {
              ...state.board,
              actionSpaces: state.board.actionSpaces.map((s) => s.spaceId === targetSpaceId ? { ...s, status: "blocked" } : s)
            }
          };
          nextState = clearInterrupt(nextState);
          nextState = appendLog(nextState, {
            type: "MILESTONE_APPLIED",
            playerId,
            milestoneKey,
            targetSpaceId,
            message: `${playerId}'s Signal Jammer locks ${targetSpaceId} for the rest of the round.`
          });
          return { state: nextState, error: null, detail: null };
        }
        if (milestoneKey === "SILICON_VALLEY_SWEEP") {
          if (player.wallet.profitTokens < 4) {
            return { state, error: "INSUFFICIENT_PT", detail: { required: 4 } };
          }
          const drawPile = player.hand.personalDrawPile;
          const drawCount = Math.min(4, drawPile.length);
          const drawn = drawPile.slice(0, drawCount);
          const remainingDrawPile = drawPile.slice(drawCount);
          let nextState = adjustWallet(state, playerId, -4, 0);
          nextState = {
            ...nextState,
            players: {
              ...nextState.players,
              [playerId]: { ...nextState.players[playerId], hand: { ...nextState.players[playerId].hand, personalDrawPile: remainingDrawPile } }
            }
          };
          const playCatalogId = options.playCatalogId && drawn.includes(options.playCatalogId) ? options.playCatalogId : null;
          const remainingAfterPlay = drawn.filter((id) => id !== playCatalogId);
          const keepCatalogId = options.keepCatalogId && remainingAfterPlay.includes(options.keepCatalogId) ? options.keepCatalogId : remainingAfterPlay[0] || null;
          if (keepCatalogId) {
            nextState = {
              ...nextState,
              players: {
                ...nextState.players,
                [playerId]: {
                  ...nextState.players[playerId],
                  hand: {
                    ...nextState.players[playerId].hand,
                    actionCards: [
                      ...nextState.players[playerId].hand.actionCards,
                      { instanceId: `ac-${playerId}-svs`, catalogId: keepCatalogId }
                    ]
                  }
                }
              }
            };
          }
          if (playCatalogId) {
            nextState = appendLog(nextState, {
              type: "MILESTONE_SILICON_VALLEY_SWEEP_FREE_PLAY_NOT_IMPLEMENTED",
              playerId,
              catalogId: playCatalogId,
              reason: "Free-play (bypassing cost/requirements) is not yet wired to a real effect-execution path \u2014 flagged, not silently dropped."
            });
          }
          nextState = clearInterrupt(nextState);
          nextState = appendLog(nextState, {
            type: "MILESTONE_APPLIED",
            playerId,
            milestoneKey,
            keptCatalogId: keepCatalogId,
            playCatalogId,
            message: `${playerId}'s Silicon Valley Sweep draws 4, keeps ${keepCatalogId || "none"}.`
          });
          return { state: nextState, error: null, detail: null };
        }
        if (milestoneKey === "MASTER_ALGORITHM") {
          if (player.wallet.profitTokens < 4) {
            return { state, error: "INSUFFICIENT_PT", detail: { required: 4 } };
          }
          const trashInstanceIds = options.trashInstanceIds || [];
          const realTrashIds = trashInstanceIds.filter((id) => player.hand.actionCards.some((c) => c.instanceId === id));
          let spaces = 0;
          if (realTrashIds.length >= 7) spaces = 3;
          else if (realTrashIds.length >= 4) spaces = 2;
          else if (realTrashIds.length >= 2) spaces = 1;
          if (spaces === 0) {
            return { state, error: "INSUFFICIENT_CARDS_TO_TRASH", detail: { provided: realTrashIds.length, minimumRequired: 2 } };
          }
          let nextState = adjustWallet(state, playerId, -4, 0);
          nextState = {
            ...nextState,
            players: {
              ...nextState.players,
              [playerId]: {
                ...nextState.players[playerId],
                hand: {
                  ...nextState.players[playerId].hand,
                  actionCards: nextState.players[playerId].hand.actionCards.filter((c) => !realTrashIds.includes(c.instanceId))
                }
              }
            }
          };
          nextState = adjustMarketShare(nextState, playerId, spaces);
          nextState = checkGlobalFirstToMilestones(nextState, playerId);
          nextState = clearInterrupt(nextState);
          nextState = appendLog(nextState, {
            type: "MILESTONE_APPLIED",
            playerId,
            milestoneKey,
            trashedCount: realTrashIds.length,
            spacesAdvanced: spaces,
            message: `${playerId}'s Master Algorithm trashes ${realTrashIds.length} cards to advance ${spaces} Market Share space(s).`
          });
          return { state: nextState, error: null, detail: null };
        }
        if (milestoneKey === "HOSTILE_BUYOUT") {
          const { targetPlayerId, targetAgentInstanceId } = options;
          if (player.wallet.profitTokens < 6) {
            return { state, error: "INSUFFICIENT_PT", detail: { required: 6 } };
          }
          const targetEntry = (state.players[targetPlayerId] ? state.players[targetPlayerId].roster : []).find(
            (r) => r.agentInstanceId === targetAgentInstanceId && !r.isVoided
          );
          if (!targetEntry) {
            return { state, error: "TARGET_AGENT_NOT_FOUND", detail: { targetPlayerId, targetAgentInstanceId } };
          }
          if (targetEntry.loyaltyToken.active) {
            return { state, error: "TARGET_AGENT_LOYALED", detail: null };
          }
          let nextState = adjustWallet(state, playerId, -6, 0);
          nextState = {
            ...nextState,
            players: {
              ...nextState.players,
              [targetPlayerId]: { ...nextState.players[targetPlayerId], roster: nextState.players[targetPlayerId].roster.filter((r) => r.agentInstanceId !== targetAgentInstanceId) },
              [playerId]: { ...nextState.players[playerId], roster: [...nextState.players[playerId].roster, targetEntry] }
            }
          };
          nextState = clearInterrupt(nextState);
          nextState = appendLog(nextState, {
            type: "MILESTONE_APPLIED",
            playerId,
            milestoneKey,
            targetPlayerId,
            targetAgentInstanceId,
            message: `${playerId}'s Hostile Buyout transfers ${targetEntry.catalogId} from ${targetPlayerId}'s brokerage.`
          });
          return { state: nextState, error: null, detail: null };
        }
        return { state, error: "UNKNOWN_MILESTONE_KEY", detail: { milestoneKey } };
      }
      function useProprietaryAlgorithm(state, playerId, mode, cardInstanceId) {
        const player = state.players[playerId];
        if (!player) {
          return { state, error: "PLAYER_NOT_FOUND", detail: { playerId } };
        }
        const tech = player.tracks.technology;
        const hasAbility = tech.branch === "B" && tech.value >= 5 || player.ghostInTheMachineBorrowedBranch === "B";
        if (!hasAbility) {
          return { state, error: "ABILITY_NOT_UNLOCKED", detail: null };
        }
        if (player.oncePerRoundAbilitiesUsed.includes("PROPRIETARY_ALGORITHM")) {
          return { state, error: "ALREADY_USED_THIS_ROUND", detail: null };
        }
        const cardEntry = player.hand.actionCards.find((c) => c.instanceId === cardInstanceId);
        if (!cardEntry) {
          return { state, error: "CARD_NOT_IN_HAND", detail: { cardInstanceId } };
        }
        const handWithoutCard = player.hand.actionCards.filter((c) => c.instanceId !== cardInstanceId);
        if (mode === "trash_for_cards") {
          const drawPile = player.hand.personalDrawPile;
          const drawCount = Math.min(2, drawPile.length);
          const drawnCatalogIds = drawPile.slice(0, drawCount);
          const remainingDrawPile = drawPile.slice(drawCount);
          const newCards = drawnCatalogIds.map((catalogId, i) => ({ instanceId: `ac-${playerId}-propalg-r${state.phase.round}-${i}`, catalogId }));
          let nextState = {
            ...state,
            players: {
              ...state.players,
              [playerId]: {
                ...player,
                hand: { ...player.hand, actionCards: [...handWithoutCard, ...newCards], personalDrawPile: remainingDrawPile },
                oncePerRoundAbilitiesUsed: [...player.oncePerRoundAbilitiesUsed, "PROPRIETARY_ALGORITHM"]
              }
            }
          };
          nextState = appendLog(nextState, {
            type: "MILESTONE_APPLIED",
            playerId,
            milestoneKey: "PROPRIETARY_ALGORITHM",
            mode,
            drawnCount: drawCount,
            message: `${playerId}'s Proprietary Algorithm trashes ${cardEntry.catalogId} and draws ${drawCount} replacement cards.`
          });
          return { state: nextState, error: null, detail: null };
        }
        if (mode === "discard_for_pt") {
          let nextState = {
            ...state,
            players: {
              ...state.players,
              [playerId]: {
                ...player,
                hand: { ...player.hand, actionCards: handWithoutCard, personalDiscardPile: [...player.hand.personalDiscardPile, cardEntry] },
                oncePerRoundAbilitiesUsed: [...player.oncePerRoundAbilitiesUsed, "PROPRIETARY_ALGORITHM"]
              }
            }
          };
          nextState = adjustWallet(nextState, playerId, 2, 0);
          nextState = appendLog(nextState, {
            type: "MILESTONE_APPLIED",
            playerId,
            milestoneKey: "PROPRIETARY_ALGORITHM",
            mode,
            message: `${playerId}'s Proprietary Algorithm discards ${cardEntry.catalogId} for +2 PT.`
          });
          return { state: nextState, error: null, detail: null };
        }
        return { state, error: "INVALID_MODE", detail: { mode } };
      }
      function useLiquidationEngine(state, playerId, targetAgentInstanceId) {
        const player = state.players[playerId];
        if (!player) {
          return { state, error: "PLAYER_NOT_FOUND", detail: { playerId } };
        }
        const recognition = player.tracks.recognition;
        const hasAbility = recognition.branch === "A" && recognition.value >= 5;
        if (!hasAbility) {
          return { state, error: "ABILITY_NOT_UNLOCKED", detail: null };
        }
        if (player.oncePerRoundAbilitiesUsed.includes("LIQUIDATION_ENGINE")) {
          return { state, error: "ALREADY_USED_THIS_ROUND", detail: null };
        }
        const targetEntry = player.roster.find((r) => r.agentInstanceId === targetAgentInstanceId && !r.isVoided);
        if (!targetEntry) {
          return { state, error: "TARGET_AGENT_NOT_FOUND", detail: { targetAgentInstanceId } };
        }
        const agentStats = getAgentStats(state, targetEntry.catalogId);
        if (!agentStats) {
          return { state, error: "AGENT_CATALOG_ENTRY_NOT_FOUND", detail: { catalogId: targetEntry.catalogId } };
        }
        let nextState = adjustWallet(state, playerId, agentStats.totalProfit, 0);
        nextState = {
          ...nextState,
          players: {
            ...nextState.players,
            [playerId]: {
              ...nextState.players[playerId],
              oncePerRoundAbilitiesUsed: [...nextState.players[playerId].oncePerRoundAbilitiesUsed, "LIQUIDATION_ENGINE"]
            }
          }
        };
        nextState = appendLog(nextState, {
          type: "MILESTONE_APPLIED",
          playerId,
          milestoneKey: "LIQUIDATION_ENGINE",
          targetAgentInstanceId,
          netProfit: agentStats.totalProfit,
          message: `${playerId}'s Liquidation Engine forces ${agentStats.name} to activate a second time for +${agentStats.totalProfit} PT.`
        });
        return { state: nextState, error: null, detail: null };
      }
      var GLOBAL_MILESTONE_CHECKS = [
        { key: "OFFICE_MOGUL", check: (player) => player.tracks.offices.unlocked >= 6 },
        { key: "MARKET_LEADER", check: (player) => MARKET_SHARE_TRACK_SPACES[player.tracks.marketShare.position] >= 17 },
        { key: "THE_MENTOR", check: (player) => player.roster.reduce((sum, r) => sum + (r.isVoided ? 0 : r.coachTokens), 0) >= 4 },
        { key: "SUPERSTAR_RECRUITER", check: (player) => player.roster.filter((r) => !r.isVoided).length >= 8 }
      ];
      function checkGlobalFirstToMilestones(state, playerId) {
        let nextState = state;
        const player = nextState.players[playerId];
        if (!player) return nextState;
        GLOBAL_MILESTONE_CHECKS.forEach(({ key, check }) => {
          if (player.milestonesClaimed.includes(key)) return;
          const alreadyClaimedByAnyone = Object.values(nextState.players).some((p) => p.milestonesClaimed.includes(key));
          if (alreadyClaimedByAnyone) return;
          if (!check(nextState.players[playerId])) return;
          nextState = {
            ...nextState,
            players: {
              ...nextState.players,
              [playerId]: {
                ...nextState.players[playerId],
                milestonesClaimed: [...nextState.players[playerId].milestonesClaimed, key]
              }
            }
          };
          nextState = appendLog(nextState, {
            type: "MILESTONE_CLAIMED",
            playerId,
            milestoneKey: key,
            message: `${playerId} is the first to achieve ${key} and claims the Broker Icon Milestone Token.`
          });
        });
        return nextState;
      }
      function forfeitTargetedMilestone(state, playerId) {
        const interrupt = state.phase.pendingInterrupt;
        if (!interrupt || interrupt.type !== "TRACK_MILESTONE_CHOICE" || interrupt.sourcePlayerId !== playerId) {
          return { state, error: "NO_PENDING_MILESTONE_CHOICE", detail: { playerId, pendingInterrupt: interrupt || null } };
        }
        const { milestoneKey } = interrupt.data;
        const nextState = {
          ...state,
          phase: { ...state.phase, pendingInterrupt: { type: "NULL", sourcePlayerId: null, data: {} } }
        };
        return {
          state: appendLog(nextState, {
            type: "TRACK_MILESTONE_FORFEITED",
            playerId,
            milestoneKey,
            reason: "PLAYER_CHOSE_TO_FORFEIT"
          }),
          error: null,
          detail: { milestoneKey }
        };
      }
      module.exports = {
        checkTrackMilestonesIfEligible,
        resolveTrackBranchChoice,
        resolveTargetedMilestone,
        forfeitTargetedMilestone,
        applyLevel5ImmediateEffect,
        applyInstantMilestone,
        checkLevel10Milestone,
        checkLevel7And9Milestones,
        checkGlobalFirstToMilestones,
        useProprietaryAlgorithm,
        useLiquidationEngine,
        appendLog,
        VALID_TRACKS,
        VALID_BRANCHES
      };
    }
  });

  // cardEffectHelpers.js
  var require_cardEffectHelpers = __commonJS({
    "cardEffectHelpers.js"(exports, module) {
      var { MARKET_SHARE_TRACK_SPACES } = require_boardConfigLoader();
      function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
      }
      var _sharedRng = Math.random;
      function setSharedRng(rngFn) {
        _sharedRng = typeof rngFn === "function" ? rngFn : Math.random;
      }
      function getSharedRng() {
        return _sharedRng;
      }
      var _meepleCounter = 0;
      function resetMeepleCounter() {
        _meepleCounter = 0;
      }
      function generateMeepleInstanceId(playerId) {
        _meepleCounter += 1;
        return `m-${playerId}-${_meepleCounter}`;
      }
      function getPlayerOrThrow(state, playerId, helperName) {
        const player = state.players[playerId];
        if (!player) {
          throw new Error(`${helperName}: unknown playerId "${playerId}"`);
        }
        return player;
      }
      function adjustWallet(state, playerId, profitTokenDelta = 0, priorityTokenDelta = 0) {
        const player = getPlayerOrThrow(state, playerId, "adjustWallet");
        const newWallet = {
          profitTokens: Math.max(0, player.wallet.profitTokens + profitTokenDelta),
          priorityTokens: Math.max(0, player.wallet.priorityTokens + priorityTokenDelta)
        };
        return {
          ...state,
          players: {
            ...state.players,
            [playerId]: {
              ...player,
              wallet: newWallet
            }
          }
        };
      }
      var LEVELED_TRACKS = /* @__PURE__ */ new Set(["training", "technology", "recognition"]);
      function appendLog(state, entry) {
        const logEntry = {
          seq: state.log.length + 1,
          timestamp: (/* @__PURE__ */ new Date()).toISOString(),
          round: state.phase.round,
          ...entry
        };
        return { ...state, log: [...state.log, logEntry] };
      }
      var VENTURE_CAPITALIST_BONUS_SPACES = /* @__PURE__ */ new Set([5, 7, 9]);
      function adjustTrack(state, playerId, trackName, delta) {
        const player = getPlayerOrThrow(state, playerId, "adjustTrack");
        if (!LEVELED_TRACKS.has(trackName)) {
          throw new Error(
            `adjustTrack: "${trackName}" is not a leveled track \u2014 expected one of training | technology | recognition`
          );
        }
        const track = player.tracks[trackName];
        const newTrack = {
          ...track,
          value: clamp(track.value + delta, 0, track.max)
        };
        let nextState = {
          ...state,
          players: {
            ...state.players,
            [playerId]: {
              ...player,
              tracks: {
                ...player.tracks,
                [trackName]: newTrack
              }
            }
          }
        };
        if (delta > 0 && player.ventureCapitalistActive && newTrack.value !== track.value && VENTURE_CAPITALIST_BONUS_SPACES.has(newTrack.value)) {
          nextState = adjustWallet(nextState, playerId, 3, 0);
          nextState = appendLog(nextState, {
            type: "SPECIALIST_EFFECT_VENTURE_CAPITALIST_TRIGGERED",
            playerId,
            trackName,
            landedValue: newTrack.value,
            message: `${playerId}'s ${trackName} track lands on odd space ${newTrack.value} \u2014 The Venture Capitalist grants +3 PT.`
          });
        }
        const bridgeActive = player.bridgedTracks && player.bridgedTracksUntilRound === state.phase.round && player.bridgedTracks.includes(trackName) && newTrack.value !== track.value;
        if (bridgeActive) {
          const linkedTrackName = player.bridgedTracks.find((t) => t !== trackName);
          const linkedTrack = player.tracks[linkedTrackName];
          const newLinkedTrack = { ...linkedTrack, value: clamp(linkedTrack.value + delta, 0, linkedTrack.max) };
          nextState = {
            ...nextState,
            players: {
              ...nextState.players,
              [playerId]: {
                ...nextState.players[playerId],
                tracks: { ...nextState.players[playerId].tracks, [linkedTrackName]: newLinkedTrack }
              }
            }
          };
          if (newLinkedTrack.value !== linkedTrack.value) {
            const { checkLevel10Milestone } = require_techTrackReducer();
            nextState = checkLevel10Milestone(nextState, playerId, linkedTrackName, linkedTrack.value, newLinkedTrack.value);
          }
          nextState = appendLog(nextState, {
            type: "SPECIALIST_EFFECT_CORPORATE_MERGER_TRIGGERED",
            playerId,
            primaryTrack: trackName,
            linkedTrack: linkedTrackName,
            delta,
            message: `${playerId}'s Corporate Merger auto-advances ${linkedTrackName} by ${delta} to match ${trackName}.`
          });
        }
        if (newTrack.value !== track.value) {
          const { checkLevel10Milestone } = require_techTrackReducer();
          nextState = checkLevel10Milestone(nextState, playerId, trackName, track.value, newTrack.value);
        }
        return nextState;
      }
      function drawFromOpenMarketActionCards(state, playerId, count) {
        const player = state.players[playerId];
        const openMarket = state.board && state.board.openMarketActionCards || [];
        const drawCount = Math.min(count, openMarket.length);
        const acquiredCatalogIds = openMarket.slice(0, drawCount).map((c) => c.catalogId);
        const remainingMarket = openMarket.slice(drawCount);
        let drawPile = state.board && state.board.decks && state.board.decks.actionCardDrawPile || [];
        let discardPile = state.board && state.board.decks && state.board.decks.actionCardDiscardPile || [];
        let stateForLog = state;
        const refillCatalogIds = [];
        while (refillCatalogIds.length < drawCount) {
          if (drawPile.length === 0) {
            if (discardPile.length === 0) {
              if (!stateForLog.board.isDeckExhausted) {
                stateForLog = appendLog(stateForLog, {
                  type: "ACTION_CARD_DECK_DEPLETED",
                  message: "Action Deck Depleted \u2014 the Action Card draw pile and discard pile are both empty."
                });
                stateForLog = { ...stateForLog, board: { ...stateForLog.board, isDeckExhausted: true } };
              }
              break;
            }
            drawPile = [...discardPile];
            for (let i = drawPile.length - 1; i > 0; i -= 1) {
              const j = Math.floor(Math.random() * (i + 1));
              [drawPile[i], drawPile[j]] = [drawPile[j], drawPile[i]];
            }
            discardPile = [];
            stateForLog = appendLog(stateForLog, {
              type: "ACTION_CARD_DECK_RESHUFFLED",
              cardCount: drawPile.length,
              message: `The Action Card deck ran out \u2014 reshuffling ${drawPile.length} card(s) from the discard pile into a new deck.`
            });
            if (stateForLog.board.isDeckExhausted) {
              stateForLog = { ...stateForLog, board: { ...stateForLog.board, isDeckExhausted: false } };
            }
          }
          refillCatalogIds.push(drawPile[0]);
          drawPile = drawPile.slice(1);
        }
        const newOpenMarket = [...refillCatalogIds.map((catalogId) => ({ catalogId })), ...remainingMarket];
        const bothPersonalPilesEmpty = player.hand.personalDrawPile.length === 0 && player.hand.personalDiscardPile.length === 0;
        let handCards = [...player.hand.actionCards];
        let personalDiscardPile = [...player.hand.personalDiscardPile];
        acquiredCatalogIds.forEach((catalogId, i) => {
          const entry = { instanceId: `ac-${playerId}-marketdraw-r${state.phase.round}-${player.hand.actionCards.length}-${i}`, catalogId };
          const goesToHand = handCards.length < player.hand.maxHandSize || bothPersonalPilesEmpty;
          if (goesToHand) {
            handCards = [...handCards, entry];
          } else {
            personalDiscardPile = [...personalDiscardPile, entry];
          }
        });
        return {
          ...stateForLog,
          board: {
            ...stateForLog.board,
            openMarketActionCards: newOpenMarket,
            decks: { ...stateForLog.board.decks, actionCardDrawPile: drawPile, actionCardDiscardPile: discardPile }
          },
          players: {
            ...stateForLog.players,
            [playerId]: {
              ...player,
              hand: { ...player.hand, actionCards: handCards, personalDiscardPile }
            }
          },
          drawnCatalogIds: acquiredCatalogIds
        };
      }
      function drawFromSharedActionCardDeckBlind(state, playerId, count) {
        const player = state.players[playerId];
        let drawPile = state.board && state.board.decks && state.board.decks.actionCardDrawPile || [];
        let discardPile = state.board && state.board.decks && state.board.decks.actionCardDiscardPile || [];
        let stateForLog = state;
        const drawnCatalogIds = [];
        while (drawnCatalogIds.length < count) {
          if (drawPile.length === 0) {
            if (discardPile.length === 0) {
              if (!stateForLog.board.isDeckExhausted) {
                stateForLog = appendLog(stateForLog, {
                  type: "ACTION_CARD_DECK_DEPLETED",
                  message: "Action Deck Depleted \u2014 the Action Card draw pile and discard pile are both empty."
                });
                stateForLog = { ...stateForLog, board: { ...stateForLog.board, isDeckExhausted: true } };
              }
              break;
            }
            drawPile = [...discardPile];
            for (let i = drawPile.length - 1; i > 0; i -= 1) {
              const j = Math.floor(Math.random() * (i + 1));
              [drawPile[i], drawPile[j]] = [drawPile[j], drawPile[i]];
            }
            discardPile = [];
            stateForLog = appendLog(stateForLog, {
              type: "ACTION_CARD_DECK_RESHUFFLED",
              cardCount: drawPile.length,
              message: `The Action Card deck ran out \u2014 reshuffling ${drawPile.length} card(s) from the discard pile into a new deck.`
            });
            if (stateForLog.board.isDeckExhausted) {
              stateForLog = { ...stateForLog, board: { ...stateForLog.board, isDeckExhausted: false } };
            }
          }
          drawnCatalogIds.push(drawPile[0]);
          drawPile = drawPile.slice(1);
        }
        const remainingDrawPile = drawPile;
        const newCards = drawnCatalogIds.map((catalogId, i) => ({ instanceId: `ac-${playerId}-blinddraw-r${state.phase.round}-${player.hand.actionCards.length}-${i}`, catalogId }));
        const bothPersonalPilesEmpty = player.hand.personalDrawPile.length === 0 && player.hand.personalDiscardPile.length === 0;
        let handCards = [...player.hand.actionCards];
        let personalDiscardPile = [...player.hand.personalDiscardPile];
        newCards.forEach((entry) => {
          if (handCards.length < player.hand.maxHandSize || bothPersonalPilesEmpty) {
            handCards = [...handCards, entry];
          } else {
            personalDiscardPile = [...personalDiscardPile, entry];
          }
        });
        return {
          ...stateForLog,
          board: { ...stateForLog.board, decks: { ...stateForLog.board.decks, actionCardDrawPile: remainingDrawPile, actionCardDiscardPile: discardPile } },
          players: {
            ...stateForLog.players,
            [playerId]: { ...player, hand: { ...player.hand, actionCards: handCards, personalDiscardPile } }
          },
          drawnCatalogIds
        };
      }
      function awardMeeple(state, playerId, source = "staff_in_training") {
        const player = getPlayerOrThrow(state, playerId, "awardMeeple");
        if (player.timeMeeples.active.length >= player.timeMeeples.maxAllowed) {
          console.warn(
            `awardMeeple: ${playerId} already at maxAllowed (${player.timeMeeples.maxAllowed}), no-op`
          );
          return state;
        }
        const newMeeple = {
          instanceId: generateMeepleInstanceId(playerId),
          status: "in_supply",
          locationSpaceId: null
        };
        return {
          ...state,
          players: {
            ...state.players,
            [playerId]: {
              ...player,
              timeMeeples: {
                ...player.timeMeeples,
                active: [...player.timeMeeples.active, newMeeple]
              }
            }
          },
          // FIX: this player now has a usable meeple in supply, but if they'd
          // already exhausted every other meeple earlier this round, placeMeeple
          // would have already removed them from phase.playersWithMeeplesRemaining
          // — and settleGameLoop advances straight to pre-bidding once that list
          // is empty, regardless of what's actually sitting in any player's
          // timeMeeples.active. Without this, a bonus meeple granted mid-round
          // (a milestone reward, a board-space grant) was correctly created as
          // available but the player could never actually get a turn to place
          // it before the round ended. Same re-add pattern already used by
          // meeple recall (see workerPlacementReducer.js's own comment on this).
          // Only meaningful during WORKER_PLACEMENT — a milestone firing outside
          // that phase (e.g. from a card played during a different phase, if
          // that's ever possible) shouldn't touch this list at all.
          phase: state.phase.current === "WORKER_PLACEMENT" ? {
            ...state.phase,
            playersWithMeeplesRemaining: state.phase.playersWithMeeplesRemaining.includes(playerId) ? state.phase.playersWithMeeplesRemaining : [...state.phase.playersWithMeeplesRemaining, playerId]
          } : state.phase
        };
      }
      function adjustOfficeSlots(state, playerId, delta) {
        const player = getPlayerOrThrow(state, playerId, "adjustOfficeSlots");
        const offices = player.tracks.offices;
        const newOffices = {
          ...offices,
          unlocked: Math.max(0, offices.unlocked + delta)
        };
        return {
          ...state,
          players: {
            ...state.players,
            [playerId]: {
              ...player,
              tracks: {
                ...player.tracks,
                offices: newOffices
              }
            }
          }
        };
      }
      function hireStaff(state, playerId) {
        const player = getPlayerOrThrow(state, playerId, "hireStaff");
        const totalMeeples = player.timeMeeples.active.length + player.timeMeeples.staffInTraining.length;
        if (totalMeeples >= player.timeMeeples.maxAllowed) {
          console.warn(`hireStaff: ${playerId} already at maxAllowed (${player.timeMeeples.maxAllowed}), no-op`);
          return state;
        }
        const newMeeple = {
          instanceId: generateMeepleInstanceId(playerId),
          status: "staff_in_training",
          locationSpaceId: null
        };
        return {
          ...state,
          players: {
            ...state.players,
            [playerId]: {
              ...player,
              timeMeeples: {
                ...player.timeMeeples,
                staffInTraining: [...player.timeMeeples.staffInTraining, newMeeple]
              }
            }
          }
        };
      }
      function adjustMarketShare(state, playerId, delta) {
        const player = getPlayerOrThrow(state, playerId, "adjustMarketShare");
        const maxIndex = MARKET_SHARE_TRACK_SPACES.length - 1;
        return {
          ...state,
          players: {
            ...state.players,
            [playerId]: {
              ...player,
              tracks: {
                ...player.tracks,
                marketShare: { ...player.tracks.marketShare, position: clamp(player.tracks.marketShare.position + delta, 0, maxIndex) }
              }
            }
          }
        };
      }
      function hasDeficitRequiringChoice(state, playerId, amountOwed) {
        const player = getPlayerOrThrow(state, playerId, "hasDeficitRequiringChoice");
        const deficit = Math.max(0, amountOwed - player.wallet.profitTokens);
        if (deficit === 0) return false;
        const allTracksAtZero = ["training", "technology", "recognition"].every((t) => player.tracks[t].value === 0);
        return !allTracksAtZero;
      }
      function payMandatoryProfitTokenDeficit(state, playerId, amountOwed, chosenTrack) {
        const player = getPlayerOrThrow(state, playerId, "payMandatoryProfitTokenDeficit");
        const deficit = Math.max(0, amountOwed - player.wallet.profitTokens);
        let nextState = adjustWallet(state, playerId, -amountOwed, 0);
        if (deficit === 0) {
          return { state: nextState, error: null, detail: { deficit: 0, trackDowngraded: null } };
        }
        const allTracksAtZero = ["training", "technology", "recognition"].every((t) => player.tracks[t].value === 0);
        if (allTracksAtZero) {
          return { state: nextState, error: null, detail: { deficit, trackDowngraded: null, floorForgiven: true } };
        }
        if (!chosenTrack || !["training", "technology", "recognition"].includes(chosenTrack)) {
          return { state, error: "DEFICIT_TRACK_CHOICE_REQUIRED", detail: { deficit } };
        }
        if (nextState.players[playerId].tracks[chosenTrack].value === 0) {
          return { state, error: "CHOSEN_TRACK_ALREADY_AT_ZERO", detail: { deficit, chosenTrack } };
        }
        nextState = adjustTrack(nextState, playerId, chosenTrack, -1);
        return { state: nextState, error: null, detail: { deficit, trackDowngraded: chosenTrack } };
      }
      function payProfitTokenDeficitWithHumanPause(state, playerId, amountOwed) {
        const player = getPlayerOrThrow(state, playerId, "payProfitTokenDeficitWithHumanPause");
        let nextState = adjustWallet(state, playerId, -amountOwed, 0);
        if (!hasDeficitRequiringChoice(state, playerId, amountOwed)) {
          return nextState;
        }
        return {
          ...nextState,
          phase: {
            ...nextState.phase,
            pendingInterrupt: { type: "DEFICIT_TRACK_CHOICE", sourcePlayerId: playerId, data: {} }
          }
        };
      }
      function resolveDeficitTrackChoice(state, playerId, chosenTrack) {
        const interrupt = state.phase.pendingInterrupt;
        if (!interrupt || interrupt.type !== "DEFICIT_TRACK_CHOICE" || interrupt.sourcePlayerId !== playerId) {
          return { state, error: "NO_PENDING_DEFICIT_CHOICE", detail: { playerId, pendingInterrupt: interrupt || null } };
        }
        const player = getPlayerOrThrow(state, playerId, "resolveDeficitTrackChoice");
        if (!LEVELED_TRACKS.has(chosenTrack)) {
          return { state, error: "INVALID_TRACK_NAME", detail: { chosenTrack } };
        }
        if (player.tracks[chosenTrack].value === 0) {
          return { state, error: "CHOSEN_TRACK_ALREADY_AT_ZERO", detail: { chosenTrack } };
        }
        let nextState = adjustTrack(state, playerId, chosenTrack, -1);
        nextState = { ...nextState, phase: { ...nextState.phase, pendingInterrupt: { type: "NULL", sourcePlayerId: null, data: {} } } };
        return { state: nextState, error: null, detail: { trackDowngraded: chosenTrack } };
      }
      function fireAgentFromRoster(state, playerId, agentInstanceId, reasonCatalogId) {
        const player = state.players[playerId];
        if (!player) return state;
        const target = player.roster.find((r) => r.agentInstanceId === agentInstanceId && !r.isVoided);
        if (!target) return state;
        const remainingRoster = player.roster.filter((r) => r.agentInstanceId !== agentInstanceId);
        let nextState = {
          ...state,
          players: { ...state.players, [playerId]: { ...player, roster: remainingRoster } }
        };
        nextState = appendLog(nextState, {
          type: "AGENT_FIRED",
          playerId,
          agentInstanceId,
          agentCatalogId: target.catalogId,
          catalogId: reasonCatalogId || null,
          message: `${playerId}'s agent (${target.catalogId}) is fired from the roster${reasonCatalogId ? ` (${reasonCatalogId})` : ""}.`
        });
        return nextState;
      }
      function fireAgentBySelector(state, playerId, selectorFn, reasonCatalogId) {
        const player = state.players[playerId];
        if (!player) return state;
        const agentCatalog = state.cardCatalog && state.cardCatalog.agentCards || {};
        const activeRoster = player.roster.filter((r) => !r.isVoided);
        const chosenInstanceId = selectorFn(activeRoster, agentCatalog);
        if (!chosenInstanceId) return state;
        return fireAgentFromRoster(state, playerId, chosenInstanceId, reasonCatalogId);
      }
      function pickRosterExtremeBy(rosterEntries, agentCatalog, statName, direction) {
        if (rosterEntries.length === 0) return null;
        let best = null;
        let bestValue = null;
        rosterEntries.forEach((entry) => {
          const catalogEntry = agentCatalog[entry.catalogId];
          const value = catalogEntry ? catalogEntry[statName] || 0 : 0;
          if (bestValue === null || (direction === "lowest" ? value < bestValue : value > bestValue)) {
            best = entry.agentInstanceId;
            bestValue = value;
          }
        });
        return best;
      }
      function wipeAndRefillActionCardMarket(state) {
        const drawPile = state.board.decks && state.board.decks.actionCardDrawPile || [];
        const discardPile = state.board.decks && state.board.decks.actionCardDiscardPile || [];
        const rowSize = (state.board.openMarketActionCards || []).length;
        let remainingDrawPile = drawPile;
        let remainingDiscardPile = discardPile;
        const newRow = [];
        while (newRow.length < rowSize) {
          if (remainingDrawPile.length === 0) {
            if (remainingDiscardPile.length === 0) break;
            remainingDrawPile = [...remainingDiscardPile];
            for (let i = remainingDrawPile.length - 1; i > 0; i -= 1) {
              const j = Math.floor(Math.random() * (i + 1));
              [remainingDrawPile[i], remainingDrawPile[j]] = [remainingDrawPile[j], remainingDrawPile[i]];
            }
            remainingDiscardPile = [];
          }
          newRow.push({ catalogId: remainingDrawPile[0] });
          remainingDrawPile = remainingDrawPile.slice(1);
        }
        return {
          ...state,
          board: {
            ...state.board,
            openMarketActionCards: newRow,
            decks: { ...state.board.decks, actionCardDrawPile: remainingDrawPile, actionCardDiscardPile: remainingDiscardPile }
          }
        };
      }
      function wipeAndRefillAgentMarket(state) {
        const drawPile = state.board.decks && state.board.decks.agentDrawPile || [];
        const discardPile = state.board.decks && state.board.decks.agentDiscardPile || [];
        const rowSize = (state.board.openMarketAgents || []).length;
        let remainingDrawPile = drawPile;
        let remainingDiscardPile = discardPile;
        const newRow = [];
        while (newRow.length < rowSize) {
          if (remainingDrawPile.length === 0) {
            if (remainingDiscardPile.length === 0) break;
            remainingDrawPile = [...remainingDiscardPile];
            for (let i = remainingDrawPile.length - 1; i > 0; i -= 1) {
              const j = Math.floor(Math.random() * (i + 1));
              [remainingDrawPile[i], remainingDrawPile[j]] = [remainingDrawPile[j], remainingDrawPile[i]];
            }
            remainingDiscardPile = [];
          }
          newRow.push({ catalogId: remainingDrawPile[0] });
          remainingDrawPile = remainingDrawPile.slice(1);
        }
        return {
          ...state,
          board: {
            ...state.board,
            openMarketAgents: newRow,
            decks: { ...state.board.decks, agentDrawPile: remainingDrawPile, agentDiscardPile: remainingDiscardPile }
          }
        };
      }
      module.exports = {
        wipeAndRefillActionCardMarket,
        wipeAndRefillAgentMarket,
        drawFromOpenMarketActionCards,
        drawFromSharedActionCardDeckBlind,
        resetMeepleCounter,
        setSharedRng,
        getSharedRng,
        adjustWallet,
        adjustTrack,
        awardMeeple,
        adjustOfficeSlots,
        hireStaff,
        adjustMarketShare,
        hasDeficitRequiringChoice,
        payMandatoryProfitTokenDeficit,
        payProfitTokenDeficitWithHumanPause,
        resolveDeficitTrackChoice,
        fireAgentFromRoster,
        fireAgentBySelector,
        pickRosterExtremeBy
      };
    }
  });

  // immunityReducer.js
  var require_immunityReducer = __commonJS({
    "immunityReducer.js"(exports, module) {
      function getPlayerOrThrow(state, playerId, fnName) {
        const player = state.players[playerId];
        if (!player) {
          throw new Error(`${fnName}: unknown playerId "${playerId}"`);
        }
        return player;
      }
      function playerHasShiftImmunity(player) {
        return player.shiftImmunity.active === true;
      }
      function grantShiftImmunity(state, playerId, cardInstanceId) {
        const player = getPlayerOrThrow(state, playerId, "grantShiftImmunity");
        return {
          ...state,
          players: {
            ...state.players,
            [playerId]: {
              ...player,
              shiftImmunity: {
                active: true,
                sourceCardInstanceId: cardInstanceId,
                grantedRound: state.phase.round,
                expiresEndOfRound: true
              }
            }
          }
        };
      }
      function clearShiftImmunity(state, playerId) {
        const player = getPlayerOrThrow(state, playerId, "clearShiftImmunity");
        return {
          ...state,
          players: {
            ...state.players,
            [playerId]: {
              ...player,
              shiftImmunity: {
                active: false,
                sourceCardInstanceId: null,
                grantedRound: null,
                expiresEndOfRound: true
              }
            }
          }
        };
      }
      function endOfRoundShiftImmunitySweep(state) {
        let nextState = state;
        Object.keys(nextState.players).forEach((playerId) => {
          if (nextState.players[playerId].shiftImmunity.active) {
            nextState = clearShiftImmunity(nextState, playerId);
          }
        });
        const logEntry = {
          seq: nextState.log.length + 1,
          timestamp: (/* @__PURE__ */ new Date()).toISOString(),
          round: nextState.phase.round,
          type: "SHIFT_IMMUNITY_CLEARED"
        };
        return { ...nextState, log: [...nextState.log, logEntry] };
      }
      module.exports = {
        playerHasShiftImmunity,
        grantShiftImmunity,
        clearShiftImmunity,
        endOfRoundShiftImmunitySweep
      };
    }
  });

  // scoringEngine.js
  var require_scoringEngine = __commonJS({
    "scoringEngine.js"(exports, module) {
      function appendLog(state, entry) {
        const logEntry = {
          seq: state.log.length + 1,
          timestamp: (/* @__PURE__ */ new Date()).toISOString(),
          round: state.phase.round,
          ...entry
        };
        return { ...state, log: [...state.log, logEntry] };
      }
      var { MARKET_SHARE_TRACK_SPACES } = require_boardConfigLoader();
      var MILESTONE_BONUS_POINTS = {
        OFFICE_MOGUL: 5,
        MARKET_LEADER: 5,
        MAXED_OUT_VALUE: 7,
        THE_MENTOR: 7,
        SUPERSTAR_RECRUITER: 10
      };
      function isGameOver(state) {
        if (state.phase.round > state.phase.maxRounds) return true;
        const maxMarketShareIndex = MARKET_SHARE_TRACK_SPACES.length - 1;
        return Object.values(state.players).some((p) => p.tracks.marketShare.position >= maxMarketShareIndex);
      }
      function getAgentCatalog(state) {
        return state.cardCatalog && state.cardCatalog.agentCards || {};
      }
      function calculateNetProfit(player, agentCatalog) {
        return player.roster.reduce((sum, entry) => {
          if (entry.isVoided) return sum;
          const stats = agentCatalog[entry.catalogId];
          if (!stats) return sum;
          const realContribution = (stats.totalProfit || 0) + (entry.coachTokens || 0) * 3;
          return sum + (entry.exhausted ? Math.floor(realContribution / 2) : realContribution);
        }, 0);
      }
      function calculateCultureScoreDoubled(player, agentCatalog) {
        const rawCulture = player.roster.reduce((sum, entry) => {
          if (entry.isVoided) return sum;
          const stats = agentCatalog[entry.catalogId];
          if (!stats) return sum;
          return sum + (stats.culture || 0);
        }, 0);
        return rawCulture * 2;
      }
      function calculateMarketShareScore(player) {
        return MARKET_SHARE_TRACK_SPACES[player.tracks.marketShare.position] ?? 0;
      }
      function calculateAgentCountScore(player) {
        return player.roster.length * 2;
      }
      function calculateLoyaltyBonus(player) {
        const loyaltyCount = player.roster.filter(
          (entry) => entry.loyaltyToken && entry.loyaltyToken.active
        ).length;
        return loyaltyCount * 4;
      }
      function calculateProfitTokenScore(player) {
        if (player.hasGoldenParachute) {
          return Math.min(10, Math.floor(player.wallet.profitTokens / 3));
        }
        return Math.floor(player.wallet.profitTokens / 4);
      }
      function calculateMilestoneScore(player) {
        return player.milestonesClaimed.reduce(
          (sum, milestoneId) => sum + (MILESTONE_BONUS_POINTS[milestoneId] || 0),
          0
        );
      }
      function calculatePlayerBreakdown(player, agentCatalog) {
        const netProfit = calculateNetProfit(player, agentCatalog);
        const cultureScoreDoubled = calculateCultureScoreDoubled(player, agentCatalog);
        const marketShareScore = calculateMarketShareScore(player);
        const agentCountScore = calculateAgentCountScore(player);
        const loyaltyBonus = calculateLoyaltyBonus(player);
        const profitTokenScore = calculateProfitTokenScore(player);
        const milestoneScore = calculateMilestoneScore(player);
        const total = netProfit + cultureScoreDoubled + marketShareScore + agentCountScore + loyaltyBonus + profitTokenScore + milestoneScore;
        return {
          netProfit,
          cultureScoreDoubled,
          marketShareScore,
          agentCountScore,
          loyaltyBonus,
          profitTokenScore,
          milestoneScore,
          total
        };
      }
      function compareLeaderboardEntries(a, b, playersById) {
        if (b.finalScore !== a.finalScore) return b.finalScore - a.finalScore;
        if (b.breakdowns.netProfit !== a.breakdowns.netProfit) {
          return b.breakdowns.netProfit - a.breakdowns.netProfit;
        }
        const aLoyaltyCount = countLoyaltyAgents(playersById[a.playerId]);
        const bLoyaltyCount = countLoyaltyAgents(playersById[b.playerId]);
        if (bLoyaltyCount !== aLoyaltyCount) return bLoyaltyCount - aLoyaltyCount;
        const aTokens = playersById[a.playerId].wallet.profitTokens;
        const bTokens = playersById[b.playerId].wallet.profitTokens;
        return bTokens - aTokens;
      }
      function countLoyaltyAgents(player) {
        return player.roster.filter((entry) => entry.loyaltyToken && entry.loyaltyToken.active).length;
      }
      function calculateFinalScores(state) {
        const agentCatalog = getAgentCatalog(state);
        const playerIds = Object.keys(state.players);
        const entries = playerIds.map((playerId) => {
          const player = state.players[playerId];
          const breakdowns = calculatePlayerBreakdown(player, agentCatalog);
          return {
            playerId,
            finalScore: breakdowns.total,
            breakdowns,
            rank: null
            // assigned below
          };
        });
        entries.sort((a, b) => compareLeaderboardEntries(a, b, state.players));
        let currentRank = 0;
        let previousEntry = null;
        entries.forEach((entry, index) => {
          const isTiedWithPrevious = previousEntry !== null && compareLeaderboardEntries(entry, previousEntry, state.players) === 0;
          currentRank = isTiedWithPrevious ? currentRank : index + 1;
          entry.rank = currentRank;
          previousEntry = entry;
        });
        return entries;
      }
      function applyFinalScoresToState(state, leaderboard) {
        let nextState = { ...state, players: { ...state.players } };
        leaderboard.forEach((entry) => {
          const player = nextState.players[entry.playerId];
          nextState.players[entry.playerId] = {
            ...player,
            score: {
              finalized: true,
              netProfit: entry.breakdowns.netProfit,
              cultureScoreDoubled: entry.breakdowns.cultureScoreDoubled,
              marketShareScore: entry.breakdowns.marketShareScore,
              agentCountScore: entry.breakdowns.agentCountScore,
              loyaltyBonus: entry.breakdowns.loyaltyBonus,
              profitTokenScore: entry.breakdowns.profitTokenScore,
              milestoneScore: entry.breakdowns.milestoneScore,
              total: entry.finalScore
            }
          };
        });
        nextState = { ...nextState, finalLeaderboard: leaderboard };
        return appendLog(nextState, {
          type: "FINAL_SCORES_CALCULATED",
          leaderboard: leaderboard.map((e) => ({
            playerId: e.playerId,
            finalScore: e.finalScore,
            rank: e.rank
          }))
        });
      }
      function runFinalScoring(state) {
        const leaderboard = calculateFinalScores(state);
        let nextState = applyFinalScoresToState(state, leaderboard);
        nextState = {
          ...nextState,
          phase: { ...nextState.phase, current: "FINAL_SCORING" }
        };
        return nextState;
      }
      module.exports = {
        isGameOver,
        calculateFinalScores,
        applyFinalScoresToState,
        runFinalScoring,
        MILESTONE_BONUS_POINTS
      };
    }
  });

  // engineConfig.js
  var require_engineConfig = __commonJS({
    "engineConfig.js"(exports, module) {
      var engineConfig = {
        // false (default): unimplemented catalogIds resolve as a safe no-op +
        //   CARD_EFFECT_NOT_IMPLEMENTED log entry (dev/playtest builds).
        // true: unimplemented catalogIds throw UnimplementedCardEffectError
        //   before any effect-step state mutation (pre-release/production/CI).
        STRICT_CARD_RESOLUTION: false
        // ...other engine-level flags live here as they're added
      };
      module.exports = { engineConfig };
    }
  });

  // handlers/actionCards/growth.js
  var require_growth = __commonJS({
    "handlers/actionCards/growth.js"(exports, module) {
      var { adjustWallet, adjustTrack, adjustOfficeSlots, adjustMarketShare, drawFromOpenMarketActionCards, drawFromSharedActionCardDeckBlind } = require_cardEffectHelpers();
      var { MARKET_SHARE_TRACK_SPACES } = require_boardConfigLoader();
      var { checkGlobalFirstToMilestones } = require_techTrackReducer();
      var DEFAULT_OUTCOME = { skipDefaultDiscard: false, customDestination: null };
      function getNextOpponentId(state, playerId) {
        const turnOrder = state.phase.turnOrder || [];
        const idx = turnOrder.indexOf(playerId);
        if (idx === -1) return null;
        for (let step = 1; step <= turnOrder.length; step += 1) {
          const candidateId = turnOrder[(idx + step) % turnOrder.length];
          if (candidateId !== playerId) {
            return candidateId;
          }
        }
        return null;
      }
      function appendLog(state, entry) {
        const logEntry = {
          seq: state.log.length + 1,
          timestamp: (/* @__PURE__ */ new Date()).toISOString(),
          round: state.phase.round,
          ...entry
        };
        return { ...state, log: [...state.log, logEntry] };
      }
      function getAgentStats(state, catalogId) {
        return (state.cardCatalog && state.cardCatalog.agentCards || {})[catalogId] || null;
      }
      function advanceMarketShareWithBonusCheck(state, playerId, delta) {
        const beforeIndex = state.players[playerId].tracks.marketShare.position;
        let nextState = adjustMarketShare(state, playerId, delta);
        const afterIndex = nextState.players[playerId].tracks.marketShare.position;
        if (afterIndex > beforeIndex && nextState.marketShareTrack) {
          const beforeValue = MARKET_SHARE_TRACK_SPACES[beforeIndex];
          const afterValue = MARKET_SHARE_TRACK_SPACES[afterIndex];
          Object.keys(nextState.marketShareTrack.bonusStacks).forEach((milestoneKey) => {
            const milestoneValue = Number(milestoneKey);
            const crossed = beforeValue < milestoneValue && afterValue >= milestoneValue;
            if (!crossed) return;
            const stack = nextState.marketShareTrack.bonusStacks[milestoneKey];
            if (stack.claimedBy.includes(playerId) || stack.claimedBy.length >= 2) return;
            const claimedTokenType = stack.claimedBy.length === 0 ? stack.top : stack.bottom;
            const claimOrder = stack.claimedBy.length === 0 ? "1st" : "2nd";
            nextState = {
              ...nextState,
              marketShareTrack: {
                ...nextState.marketShareTrack,
                bonusStacks: {
                  ...nextState.marketShareTrack.bonusStacks,
                  [milestoneKey]: { ...stack, claimedBy: [...stack.claimedBy, playerId] }
                }
              },
              players: {
                ...nextState.players,
                [playerId]: { ...nextState.players[playerId], bankedBonusTokens: [...nextState.players[playerId].bankedBonusTokens, claimedTokenType] }
              }
            };
            nextState = appendLog(nextState, {
              type: "MARKET_SHARE_BONUS_CLAIMED",
              playerId,
              milestoneValue,
              tokenType: claimedTokenType,
              claimOrder,
              message: `${playerId} reaches Market Share ${milestoneValue} as the ${claimOrder} player and banks a ${claimedTokenType} token.`
            });
          });
          nextState = checkGlobalFirstToMilestones(nextState, playerId);
        }
        return nextState;
      }
      function handleGrw001(state, context) {
        const nextState = adjustWallet(state, context.playerId, 6, 0);
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleGrw002(state, context) {
        const { playerId } = context;
        const player = state.players[playerId];
        const nextState = {
          ...state,
          players: {
            ...state.players,
            [playerId]: {
              ...player,
              hand: { ...player.hand, maxHandSize: player.hand.maxHandSize + 1 }
            }
          }
        };
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleGrw005(state, context) {
        const nextState = adjustTrack(state, context.playerId, "recognition", 3);
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleGrw009(state, context) {
        let nextState = adjustWallet(state, context.playerId, 4, 0);
        nextState = adjustTrack(nextState, context.playerId, "training", 2);
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleGrw003(state, context) {
        const { playerId } = context;
        let nextState = adjustTrack(state, playerId, "training", 1);
        nextState = adjustTrack(nextState, playerId, "technology", 1);
        nextState = adjustTrack(nextState, playerId, "recognition", 1);
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleGrw008(state, context) {
        const { playerId } = context;
        const player = state.players[playerId];
        const targetLevel = 6;
        const delta = Math.max(0, targetLevel - player.tracks.recognition.value);
        const nextState = adjustTrack(state, playerId, "recognition", delta);
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleGrw014(state, context) {
        const { playerId, extra } = context;
        const usedDefaultTarget = !(extra && extra.targetPlayerId);
        const targetPlayerId = extra && extra.targetPlayerId || getNextOpponentId(state, playerId);
        if (!targetPlayerId || !state.players[targetPlayerId]) {
          return {
            state: appendLog(state, {
              type: "ACTION_CARD_EFFECT_NEW_LEADS_SKIPPED",
              playerId,
              catalogId: "GRW_014",
              reason: "NO_VALID_TARGET"
            }),
            effectOutcome: DEFAULT_OUTCOME
          };
        }
        const target = state.players[targetPlayerId];
        const stolenAmount = Math.min(5, target.wallet.profitTokens);
        let nextState = state;
        if (stolenAmount > 0) {
          nextState = adjustWallet(nextState, targetPlayerId, -stolenAmount, 0);
          nextState = adjustWallet(nextState, playerId, stolenAmount, 0);
        }
        nextState = appendLog(nextState, {
          type: "ACTION_CARD_EFFECT_NEW_LEADS",
          playerId,
          catalogId: "GRW_014",
          targetPlayerId,
          stolenAmount,
          usedDefaultTarget,
          message: `${playerId} takes ${stolenAmount} PT from ${targetPlayerId}'s brokerage (New Leads).`
        });
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleGrw016(state, context) {
        const { playerId, cardInstanceId, extra } = context;
        const pendingChoice = state.phase.pendingInterrupt;
        if (extra && pendingChoice && pendingChoice.type === "ACTION_CARD_EFFECT_CHOICE" && pendingChoice.data && pendingChoice.data.choiceType === "CRM_UPDATE_RECRUIT" && pendingChoice.data.cardInstanceId === cardInstanceId) {
          const { candidateCatalogIds: candidateCatalogIds2 } = pendingChoice.data;
          const chosenCatalogId = extra.chosenCatalogId;
          const isValidChoice = chosenCatalogId && candidateCatalogIds2.includes(chosenCatalogId);
          let nextState2 = { ...state, phase: { ...state.phase, pendingInterrupt: { type: "NULL", sourcePlayerId: null, data: {} } } };
          if (isValidChoice) {
            nextState2 = localAddAgentToRoster(nextState2, playerId, chosenCatalogId, cardInstanceId);
            nextState2 = appendLog(nextState2, {
              type: "ACTION_CARD_EFFECT_CRM_UPDATE_RECRUITED",
              playerId,
              catalogId: "GRW_016",
              recruitedCatalogId: chosenCatalogId
            });
          } else {
            nextState2 = appendLog(nextState2, {
              type: "ACTION_CARD_EFFECT_CRM_UPDATE_SKIPPED",
              playerId,
              catalogId: "GRW_016",
              reason: chosenCatalogId ? "INVALID_CHOICE" : "PLAYER_SKIPPED"
            });
          }
          return { state: nextState2, effectOutcome: DEFAULT_OUTCOME };
        }
        const drawPile = state.board.decks && state.board.decks.agentDrawPile || [];
        if (drawPile.length === 0) {
          return {
            state: appendLog(state, {
              type: "ACTION_CARD_EFFECT_CRM_UPDATE_SKIPPED",
              playerId,
              catalogId: "GRW_016",
              reason: "AGENT_DECK_EMPTY"
            }),
            effectOutcome: DEFAULT_OUTCOME
          };
        }
        const peekCount = Math.min(3, drawPile.length);
        const candidateCatalogIds = drawPile.slice(0, peekCount);
        const remainingDrawPile = drawPile.slice(peekCount);
        let nextState = {
          ...state,
          board: {
            ...state.board,
            decks: { ...state.board.decks, agentDrawPile: remainingDrawPile }
          },
          phase: {
            ...state.phase,
            pendingInterrupt: {
              type: "ACTION_CARD_EFFECT_CHOICE",
              sourcePlayerId: playerId,
              data: {
                catalogId: "GRW_016",
                choiceType: "CRM_UPDATE_RECRUIT",
                cardInstanceId,
                candidateCatalogIds
              }
            }
          }
        };
        nextState = appendLog(nextState, {
          type: "ACTION_CARD_EFFECT_CRM_UPDATE_AWAITING_CHOICE",
          playerId,
          catalogId: "GRW_016",
          candidateCatalogIds
        });
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleGrw006(state, context) {
        const nextState = adjustWallet(state, context.playerId, 7, 0);
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleGrw011(state, context) {
        const { playerId } = context;
        let nextState = adjustWallet(state, playerId, 1, 0);
        const drawResult = drawFromOpenMarketActionCards(nextState, playerId, 2);
        nextState = appendLog(drawResult, {
          type: "ACTION_CARD_EFFECT_APPLIED",
          playerId,
          catalogId: "GRW_011",
          drawnCatalogIds: drawResult.drawnCatalogIds,
          message: `${playerId}'s Lunch & Learn gains 1 PT and acquires ${drawResult.drawnCatalogIds.length} card(s) from the Open Market.`
        });
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleGrw012(state, context) {
        const nextState = adjustTrack(state, context.playerId, "technology", 2);
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleGrw013(state, context) {
        const { playerId, cardInstanceId, extra } = context;
        const player = state.players[playerId];
        if (!extra) {
          let nextState2 = adjustTrack(state, playerId, "technology", 3);
          nextState2 = {
            ...nextState2,
            phase: {
              ...nextState2.phase,
              pendingInterrupt: {
                type: "ACTION_CARD_EFFECT_CHOICE",
                sourcePlayerId: playerId,
                data: { catalogId: "GRW_013", choiceType: "GRW013_COACH_TARGET", cardInstanceId }
              }
            }
          };
          return {
            state: appendLog(nextState2, { type: "ACTION_CARD_EFFECT_GRW013_AWAITING_CHOICE", playerId, catalogId: "GRW_013" }),
            effectOutcome: DEFAULT_OUTCOME
          };
        }
        const targetEntry = player.roster.find((r) => r.agentInstanceId === extra.targetAgentInstanceId && !r.isVoided);
        let nextState = state;
        if (targetEntry) {
          nextState = {
            ...nextState,
            players: {
              ...nextState.players,
              [playerId]: {
                ...nextState.players[playerId],
                roster: nextState.players[playerId].roster.map((r) => r.agentInstanceId === extra.targetAgentInstanceId ? { ...r, coachTokens: r.coachTokens + 1 } : r)
              }
            }
          };
        }
        nextState = { ...nextState, phase: { ...nextState.phase, pendingInterrupt: { type: "NULL", sourcePlayerId: null, data: {} } } };
        nextState = appendLog(nextState, {
          type: "ACTION_CARD_EFFECT_APPLIED",
          playerId,
          catalogId: "GRW_013",
          targetAgentInstanceId: targetEntry ? extra.targetAgentInstanceId : null,
          message: targetEntry ? `${playerId}'s Website Refresh assigns a Coach Token to ${targetEntry.catalogId}.` : `${playerId}'s Website Refresh had no valid coach target.`
        });
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleGrw015(state, context) {
        const { playerId, cardInstanceId, extra } = context;
        const player = state.players[playerId];
        if (!extra) {
          let nextState2 = adjustTrack(state, playerId, "training", 3);
          nextState2 = {
            ...nextState2,
            phase: {
              ...nextState2.phase,
              pendingInterrupt: {
                type: "ACTION_CARD_EFFECT_CHOICE",
                sourcePlayerId: playerId,
                data: { catalogId: "GRW_015", choiceType: "GRW015_COACH_TARGET", cardInstanceId }
              }
            }
          };
          return {
            state: appendLog(nextState2, { type: "ACTION_CARD_EFFECT_GRW015_AWAITING_CHOICE", playerId, catalogId: "GRW_015" }),
            effectOutcome: DEFAULT_OUTCOME
          };
        }
        const targetEntry = player.roster.find((r) => r.agentInstanceId === extra.targetAgentInstanceId && !r.isVoided);
        let nextState = state;
        if (targetEntry) {
          nextState = {
            ...nextState,
            players: {
              ...nextState.players,
              [playerId]: {
                ...nextState.players[playerId],
                roster: nextState.players[playerId].roster.map((r) => r.agentInstanceId === extra.targetAgentInstanceId ? { ...r, coachTokens: r.coachTokens + 1 } : r)
              }
            }
          };
        }
        nextState = { ...nextState, phase: { ...nextState.phase, pendingInterrupt: { type: "NULL", sourcePlayerId: null, data: {} } } };
        nextState = appendLog(nextState, {
          type: "ACTION_CARD_EFFECT_APPLIED",
          playerId,
          catalogId: "GRW_015",
          targetAgentInstanceId: targetEntry ? extra.targetAgentInstanceId : null,
          message: targetEntry ? `${playerId}'s Agent Coaching assigns a Coach Token to ${targetEntry.catalogId}.` : `${playerId}'s Agent Coaching had no valid coach target.`
        });
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleGrw017(state, context) {
        const nextState = adjustWallet(state, context.playerId, 7, 0);
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleGrw018(state, context) {
        const nextState = adjustTrack(state, context.playerId, "recognition", 3);
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleGrw019(state, context) {
        const nextState = adjustTrack(state, context.playerId, "training", 3);
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleGrw020(state, context) {
        const { playerId } = context;
        let nextState = adjustTrack(state, playerId, "training", 1);
        nextState = adjustTrack(nextState, playerId, "technology", 1);
        nextState = adjustTrack(nextState, playerId, "recognition", 1);
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function localAddAgentToRoster(state, playerId, agentCatalogId, cardInstanceId) {
        const player = state.players[playerId];
        const entry = {
          agentInstanceId: `agt-${playerId}-${cardInstanceId}-r${state.phase.round}`,
          catalogId: agentCatalogId,
          acquiredVia: "recruited",
          acquiredRound: state.phase.round,
          onboardingToken: { active: true, expiresEndOfRound: state.phase.round },
          loyaltyToken: { active: false },
          coachTokens: 0,
          isVoided: false
        };
        return {
          ...state,
          players: { ...state.players, [playerId]: { ...player, roster: [...player.roster, entry] } }
        };
      }
      function localRemoveAgentFromMarketAndRefill(state, agentCatalogId) {
        const market = state.board.openMarketAgents || [];
        const remaining = market.filter((a) => a.catalogId !== agentCatalogId);
        const drawPile = state.board.decks && state.board.decks.agentDrawPile || [];
        const refillCount = Math.min(1, drawPile.length);
        const refilled = drawPile.slice(0, refillCount).map((catalogId) => ({ catalogId }));
        const newDrawPile = drawPile.slice(refillCount);
        return {
          ...state,
          board: {
            ...state.board,
            openMarketAgents: [...refilled, ...remaining],
            decks: { ...state.board.decks, agentDrawPile: newDrawPile }
          }
        };
      }
      function handleGrw004(state, context) {
        const { playerId, cardInstanceId, extra } = context;
        if (!extra) {
          const nextState2 = {
            ...state,
            phase: {
              ...state.phase,
              pendingInterrupt: {
                type: "ACTION_CARD_EFFECT_CHOICE",
                sourcePlayerId: playerId,
                data: { catalogId: "GRW_004", choiceType: "GRW004_RECRUIT_TARGET", cardInstanceId }
              }
            }
          };
          return {
            state: appendLog(nextState2, { type: "ACTION_CARD_EFFECT_GRW004_AWAITING_CHOICE", playerId, catalogId: "GRW_004" }),
            effectOutcome: DEFAULT_OUTCOME
          };
        }
        const { targetCatalogId } = extra;
        const inMarket = (state.board.openMarketAgents || []).some((a) => a.catalogId === targetCatalogId);
        let nextState = { ...state, phase: { ...state.phase, pendingInterrupt: { type: "NULL", sourcePlayerId: null, data: {} } } };
        if (inMarket) {
          nextState = localRemoveAgentFromMarketAndRefill(nextState, targetCatalogId);
          nextState = localAddAgentToRoster(nextState, playerId, targetCatalogId, cardInstanceId || "grw004");
        }
        nextState = appendLog(nextState, {
          type: "ACTION_CARD_EFFECT_APPLIED",
          playerId,
          catalogId: "GRW_004",
          targetCatalogId: inMarket ? targetCatalogId : null,
          message: inMarket ? `${playerId}'s Coffee Run recruits ${targetCatalogId} for free, all Brokerage Values waived.` : `${playerId}'s Coffee Run had no valid target in the Open Market.`
        });
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleGrw010(state, context) {
        const { playerId, cardInstanceId, extra } = context;
        if (!extra) {
          const nextState2 = {
            ...state,
            phase: {
              ...state.phase,
              pendingInterrupt: {
                type: "ACTION_CARD_EFFECT_CHOICE",
                sourcePlayerId: playerId,
                data: { catalogId: "GRW_010", choiceType: "GRW010_RECRUIT_TARGET", cardInstanceId }
              }
            }
          };
          return {
            state: appendLog(nextState2, { type: "ACTION_CARD_EFFECT_GRW010_AWAITING_CHOICE", playerId, catalogId: "GRW_010" }),
            effectOutcome: DEFAULT_OUTCOME
          };
        }
        const { targetCatalogId } = extra;
        const inMarket = (state.board.openMarketAgents || []).some((a) => a.catalogId === targetCatalogId);
        let nextState = { ...state, phase: { ...state.phase, pendingInterrupt: { type: "NULL", sourcePlayerId: null, data: {} } } };
        if (inMarket) {
          nextState = localRemoveAgentFromMarketAndRefill(nextState, targetCatalogId);
          nextState = localAddAgentToRoster(nextState, playerId, targetCatalogId, cardInstanceId || "grw010");
        }
        nextState = appendLog(nextState, {
          type: "ACTION_CARD_EFFECT_APPLIED",
          playerId,
          catalogId: "GRW_010",
          targetCatalogId: inMarket ? targetCatalogId : null,
          message: inMarket ? `${playerId}'s Online Listing recruits ${targetCatalogId}, Broker Values +1 for this check.` : `${playerId}'s Online Listing had no valid target in the Open Market.`
        });
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleGrw007(state, context) {
        const { playerId, cardInstanceId, extra } = context;
        if (!extra || !Array.isArray(extra.candidateCatalogIds)) {
          const openMarket = (state.board.openMarketActionCards || []).map((c) => c.catalogId);
          const peekCount = Math.min(3, openMarket.length);
          const candidateCatalogIds2 = openMarket.slice(0, peekCount);
          if (candidateCatalogIds2.length === 0) {
            return {
              state: appendLog(state, { type: "ACTION_CARD_EFFECT_GRW007_SKIPPED", playerId, catalogId: "GRW_007", reason: "OPEN_MARKET_EMPTY" }),
              effectOutcome: DEFAULT_OUTCOME
            };
          }
          const remainingMarket = (state.board.openMarketActionCards || []).slice(peekCount);
          const drawPile = state.board.decks && state.board.decks.actionCardDrawPile || [];
          const refillCount = Math.min(peekCount, drawPile.length);
          const refilled = drawPile.slice(0, refillCount).map((catalogId) => ({ catalogId }));
          const newDrawPile = drawPile.slice(refillCount);
          let nextState2 = {
            ...state,
            board: {
              ...state.board,
              openMarketActionCards: [...refilled, ...remainingMarket],
              decks: { ...state.board.decks, actionCardDrawPile: newDrawPile }
            },
            phase: {
              ...state.phase,
              pendingInterrupt: {
                type: "ACTION_CARD_EFFECT_CHOICE",
                sourcePlayerId: playerId,
                data: { catalogId: "GRW_007", choiceType: "GRW007_PLAY_OR_FIRE", cardInstanceId, candidateCatalogIds: candidateCatalogIds2 }
              }
            }
          };
          return {
            state: appendLog(nextState2, { type: "ACTION_CARD_EFFECT_GRW007_AWAITING_CHOICE", playerId, catalogId: "GRW_007", candidateCatalogIds: candidateCatalogIds2 }),
            effectOutcome: DEFAULT_OUTCOME
          };
        }
        const { keptCatalogId, candidateCatalogIds } = extra;
        const player = state.players[playerId];
        const keptEntry = keptCatalogId ? { instanceId: `ac-${playerId}-propertytour-r${state.phase.round}`, catalogId: keptCatalogId } : null;
        const bothPersonalPilesEmpty = player.hand.personalDrawPile.length === 0 && player.hand.personalDiscardPile.length === 0;
        const goesToHand = keptEntry && (player.hand.actionCards.length < player.hand.maxHandSize || bothPersonalPilesEmpty);
        let nextState = {
          ...state,
          players: {
            ...state.players,
            [playerId]: {
              ...player,
              hand: {
                ...player.hand,
                actionCards: goesToHand ? [...player.hand.actionCards, keptEntry] : player.hand.actionCards,
                personalDiscardPile: keptEntry && !goesToHand ? [...player.hand.personalDiscardPile, keptEntry] : player.hand.personalDiscardPile
              }
            }
          },
          phase: { ...state.phase, pendingInterrupt: { type: "NULL", sourcePlayerId: null, data: {} } }
        };
        const removedCatalogIds = (candidateCatalogIds || []).filter((id) => id !== keptCatalogId);
        nextState = appendLog(nextState, {
          type: "ACTION_CARD_EFFECT_APPLIED",
          playerId,
          catalogId: "GRW_007",
          keptCatalogId: keptCatalogId || null,
          removedCatalogIds,
          message: keptCatalogId ? `${playerId}'s Property Tour keeps ${keptCatalogId} for free; ${removedCatalogIds.join(", ") || "the rest"} fired out of the game.` : `${playerId}'s Property Tour: all 3 cards fired out of the game, none kept.`
        });
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleGrw021(state, context) {
        const { playerId } = context;
        let nextState = adjustWallet(state, playerId, 4, 0);
        nextState = adjustTrack(nextState, playerId, "recognition", 1);
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleGrw022(state, context) {
        const { playerId, cardInstanceId, extra } = context;
        const player = state.players[playerId];
        if (!extra) {
          const nextState2 = {
            ...state,
            phase: {
              ...state.phase,
              pendingInterrupt: {
                type: "ACTION_CARD_EFFECT_CHOICE",
                sourcePlayerId: playerId,
                data: { catalogId: "GRW_022", choiceType: "GRW022_LOYALTY_TARGET", cardInstanceId }
              }
            }
          };
          return {
            state: appendLog(nextState2, { type: "ACTION_CARD_EFFECT_GRW022_AWAITING_CHOICE", playerId, catalogId: "GRW_022" }),
            effectOutcome: DEFAULT_OUTCOME
          };
        }
        const targetEntry = player.roster.find((r) => r.agentInstanceId === extra.targetAgentInstanceId && !r.isVoided);
        const canPlace = targetEntry && (!targetEntry.loyaltyToken || !targetEntry.loyaltyToken.active) && player.loyaltyTokensUsed < player.loyaltyTokensMax;
        let nextState = { ...state, phase: { ...state.phase, pendingInterrupt: { type: "NULL", sourcePlayerId: null, data: {} } } };
        if (canPlace) {
          nextState = {
            ...nextState,
            players: {
              ...nextState.players,
              [playerId]: {
                ...nextState.players[playerId],
                loyaltyTokensUsed: nextState.players[playerId].loyaltyTokensUsed + 1,
                roster: nextState.players[playerId].roster.map((r) => r.agentInstanceId === extra.targetAgentInstanceId ? { ...r, loyaltyToken: { active: true } } : r)
              }
            }
          };
        }
        nextState = appendLog(nextState, {
          type: "ACTION_CARD_EFFECT_APPLIED",
          playerId,
          catalogId: "GRW_022",
          targetAgentInstanceId: canPlace ? extra.targetAgentInstanceId : null,
          message: canPlace ? `${playerId}'s Top Performer Award places a Loyalty Token on ${targetEntry.catalogId}.` : `${playerId}'s Top Performer Award had no valid target (already loyal, invalid Agent, or Loyalty Tokens exhausted).`
        });
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleGrw023(state, context) {
        const nextState = adjustTrack(state, context.playerId, "training", 3);
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleGrw024(state, context) {
        const { playerId } = context;
        let nextState = adjustTrack(state, playerId, "technology", 1);
        const drawResult = drawFromOpenMarketActionCards(nextState, playerId, 1);
        nextState = appendLog(drawResult, {
          type: "ACTION_CARD_EFFECT_APPLIED",
          playerId,
          catalogId: "GRW_024",
          drawnCatalogIds: drawResult.drawnCatalogIds,
          message: `${playerId}'s Tech Training gains +1 Technology and acquires ${drawResult.drawnCatalogIds.length} card from the Open Market.`
        });
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleGrw025(state, context) {
        const { playerId } = context;
        let nextState = adjustWallet(state, playerId, 5, 0);
        nextState = advanceMarketShareWithBonusCheck(nextState, playerId, 1);
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleGrw026(state, context) {
        const nextState = adjustWallet(state, context.playerId, 7, 0);
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleGrw027(state, context) {
        const { playerId } = context;
        let nextState = adjustTrack(state, playerId, "training", 1);
        nextState = adjustTrack(nextState, playerId, "recognition", 2);
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleGrw028(state, context) {
        const { playerId, extra } = context;
        const usedDefaultTarget = !(extra && extra.targetPlayerId);
        const targetPlayerId = extra && extra.targetPlayerId || getNextOpponentId(state, playerId);
        if (!targetPlayerId || !state.players[targetPlayerId]) {
          return {
            state: appendLog(state, { type: "ACTION_CARD_EFFECT_GRW028_SKIPPED", playerId, catalogId: "GRW_028", reason: "NO_VALID_TARGET" }),
            effectOutcome: DEFAULT_OUTCOME
          };
        }
        const target = state.players[targetPlayerId];
        const ptLost = Math.min(2, target.wallet.profitTokens);
        let nextState = state;
        if (ptLost > 0) {
          nextState = adjustWallet(nextState, targetPlayerId, -ptLost, 0);
        }
        nextState = adjustTrack(nextState, targetPlayerId, "technology", -1);
        nextState = adjustTrack(nextState, playerId, "technology", 2);
        nextState = appendLog(nextState, {
          type: "ACTION_CARD_EFFECT_APPLIED",
          playerId,
          catalogId: "GRW_028",
          targetPlayerId,
          ptLost,
          usedDefaultTarget,
          message: `${playerId}'s Lead Capture System costs ${targetPlayerId} ${ptLost} PT and 1 Technology; ${playerId} gains +2 Technology.`
        });
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleGrw029(state, context) {
        const nextState = adjustTrack(state, context.playerId, "recognition", 3);
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleGrw030(state, context) {
        const nextState = adjustTrack(state, context.playerId, "recognition", 3);
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleGrw031(state, context) {
        const { playerId, cardInstanceId, extra } = context;
        const player = state.players[playerId];
        if (!extra) {
          let nextState2 = adjustTrack(state, playerId, "training", 3);
          nextState2 = {
            ...nextState2,
            phase: {
              ...nextState2.phase,
              pendingInterrupt: {
                type: "ACTION_CARD_EFFECT_CHOICE",
                sourcePlayerId: playerId,
                data: { catalogId: "GRW_031", choiceType: "GRW031_COACH_TARGET", cardInstanceId }
              }
            }
          };
          return {
            state: appendLog(nextState2, { type: "ACTION_CARD_EFFECT_GRW031_AWAITING_CHOICE", playerId, catalogId: "GRW_031" }),
            effectOutcome: DEFAULT_OUTCOME
          };
        }
        const targetEntry = player.roster.find((r) => r.agentInstanceId === extra.targetAgentInstanceId && !r.isVoided);
        let nextState = state;
        if (targetEntry) {
          nextState = {
            ...nextState,
            players: {
              ...nextState.players,
              [playerId]: {
                ...nextState.players[playerId],
                roster: nextState.players[playerId].roster.map((r) => r.agentInstanceId === extra.targetAgentInstanceId ? { ...r, coachTokens: r.coachTokens + 1 } : r)
              }
            }
          };
        }
        nextState = { ...nextState, phase: { ...nextState.phase, pendingInterrupt: { type: "NULL", sourcePlayerId: null, data: {} } } };
        nextState = appendLog(nextState, {
          type: "ACTION_CARD_EFFECT_APPLIED",
          playerId,
          catalogId: "GRW_031",
          targetAgentInstanceId: targetEntry ? extra.targetAgentInstanceId : null,
          message: targetEntry ? `${playerId}'s Skill Building Workshop assigns a Coach Token to ${targetEntry.catalogId}.` : `${playerId}'s Skill Building Workshop had no valid coach target.`
        });
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleGrw032(state, context) {
        const { playerId, extra } = context;
        const usedDefaultTarget = !(extra && extra.targetPlayerId);
        const targetPlayerId = extra && extra.targetPlayerId || getNextOpponentId(state, playerId);
        if (!targetPlayerId || !state.players[targetPlayerId]) {
          return {
            state: appendLog(state, { type: "ACTION_CARD_EFFECT_GRW032_SKIPPED", playerId, catalogId: "GRW_032", reason: "NO_VALID_TARGET" }),
            effectOutcome: DEFAULT_OUTCOME
          };
        }
        const target = state.players[targetPlayerId];
        const stolenAmount = Math.min(6, target.wallet.profitTokens);
        let nextState = state;
        if (stolenAmount > 0) {
          nextState = adjustWallet(nextState, targetPlayerId, -stolenAmount, 0);
          nextState = adjustWallet(nextState, playerId, stolenAmount, 0);
        }
        nextState = appendLog(nextState, {
          type: "ACTION_CARD_EFFECT_APPLIED",
          playerId,
          catalogId: "GRW_032",
          targetPlayerId,
          stolenAmount,
          usedDefaultTarget,
          message: `${playerId}'s Networking Gala takes ${stolenAmount} PT from ${targetPlayerId}.`
        });
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleGrw033(state, context) {
        const nextState = adjustOfficeSlots(state, context.playerId, 2);
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleGrw034(state, context) {
        const nextState = advanceMarketShareWithBonusCheck(state, context.playerId, 2);
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleGrw035(state, context) {
        const { playerId } = context;
        let nextState = adjustWallet(state, playerId, 4, 0);
        nextState = advanceMarketShareWithBonusCheck(nextState, playerId, 1);
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleGrw036(state, context) {
        const { playerId } = context;
        const turnOrder = state.phase.turnOrder || [];
        const rivalIds = turnOrder.filter((id) => id !== playerId);
        if (rivalIds.length === 0) {
          return {
            state: appendLog(state, { type: "ACTION_CARD_EFFECT_GRW036_SKIPPED", playerId, catalogId: "GRW_036", reason: "NO_RIVALS" }),
            effectOutcome: DEFAULT_OUTCOME
          };
        }
        const shareTarget = Math.ceil(8 / rivalIds.length);
        let nextState = state;
        let totalCollected = 0;
        const perRival = {};
        rivalIds.forEach((rivalId) => {
          if (totalCollected >= 8) return;
          const rival = nextState.players[rivalId];
          const take = Math.min(shareTarget, rival.wallet.profitTokens, 8 - totalCollected);
          if (take > 0) {
            nextState = adjustWallet(nextState, rivalId, -take, 0);
            totalCollected += take;
            perRival[rivalId] = take;
          }
        });
        if (totalCollected > 0) {
          nextState = adjustWallet(nextState, playerId, totalCollected, 0);
        }
        nextState = appendLog(nextState, {
          type: "ACTION_CARD_EFFECT_APPLIED",
          playerId,
          catalogId: "GRW_036",
          totalCollected,
          perRival,
          message: `${playerId}'s Brokerage of the Year Award collects ${totalCollected} PT total from ${Object.keys(perRival).length} rival brokerage(s).`
        });
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleGrw037(state, context) {
        const { playerId, cardInstanceId, extra } = context;
        if (!extra || !extra.trackChoice) {
          const nextState2 = {
            ...state,
            phase: {
              ...state.phase,
              pendingInterrupt: {
                type: "ACTION_CARD_EFFECT_CHOICE",
                sourcePlayerId: playerId,
                data: { catalogId: "GRW_037", choiceType: "GRW037_SINGLE_TRACK_CHOICE", cardInstanceId }
              }
            }
          };
          return {
            state: appendLog(nextState2, { type: "ACTION_CARD_EFFECT_GRW037_AWAITING_CHOICE", playerId, catalogId: "GRW_037" }),
            effectOutcome: DEFAULT_OUTCOME
          };
        }
        const validTracks = /* @__PURE__ */ new Set(["training", "technology", "recognition"]);
        let nextState = { ...state, phase: { ...state.phase, pendingInterrupt: { type: "NULL", sourcePlayerId: null, data: {} } } };
        if (validTracks.has(extra.trackChoice)) {
          nextState = adjustTrack(nextState, playerId, extra.trackChoice, 3);
        }
        nextState = appendLog(nextState, {
          type: "ACTION_CARD_EFFECT_APPLIED",
          playerId,
          catalogId: "GRW_037",
          trackChoice: validTracks.has(extra.trackChoice) ? extra.trackChoice : null,
          message: `${playerId}'s Leadership Academy raises ${extra.trackChoice || "nothing"} by 3.`
        });
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleGrw038(state, context) {
        const { playerId } = context;
        const player = state.players[playerId];
        const newMeepleInstanceId = `m-${playerId}-virtualoffice-r${state.phase.round}`;
        let nextState = {
          ...state,
          players: {
            ...state.players,
            [playerId]: {
              ...player,
              timeMeeples: {
                ...player.timeMeeples,
                active: [...player.timeMeeples.active, { instanceId: newMeepleInstanceId, status: "in_supply", locationSpaceId: null }],
                maxAllowed: player.timeMeeples.maxAllowed + 1
              }
            }
          }
        };
        nextState = advanceMarketShareWithBonusCheck(nextState, playerId, 1);
        nextState = appendLog(nextState, {
          type: "ACTION_CARD_EFFECT_APPLIED",
          playerId,
          catalogId: "GRW_038",
          newMeepleInstanceId,
          message: `${playerId}'s Virtual Office grants an extra Time Meeple this round and +1 Market Share.`
        });
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleGrw039(state, context) {
        const { playerId, cardInstanceId, extra } = context;
        if (!extra || !extra.recruitedCatalogId) {
          const drawPile = state.board.decks && state.board.decks.agentDrawPile || [];
          if (drawPile.length === 0) {
            return {
              state: appendLog(state, { type: "ACTION_CARD_EFFECT_GRW039_SKIPPED", playerId, catalogId: "GRW_039", reason: "AGENT_DECK_EMPTY" }),
              effectOutcome: DEFAULT_OUTCOME
            };
          }
          const peekCount = Math.min(2, drawPile.length);
          const candidateCatalogIds = drawPile.slice(0, peekCount);
          const remainingDrawPile = drawPile.slice(peekCount);
          let nextState2 = {
            ...state,
            board: { ...state.board, decks: { ...state.board.decks, agentDrawPile: remainingDrawPile } },
            phase: {
              ...state.phase,
              pendingInterrupt: {
                type: "ACTION_CARD_EFFECT_CHOICE",
                sourcePlayerId: playerId,
                data: { catalogId: "GRW_039", choiceType: "GRW039_RECRUIT_OR_FIRE", cardInstanceId, candidateCatalogIds }
              }
            }
          };
          return {
            state: appendLog(nextState2, { type: "ACTION_CARD_EFFECT_GRW039_AWAITING_CHOICE", playerId, catalogId: "GRW_039", candidateCatalogIds }),
            effectOutcome: DEFAULT_OUTCOME
          };
        }
        const { recruitedCatalogId } = extra;
        const entry = {
          agentInstanceId: `agt-${playerId}-${cardInstanceId || "grw039"}-r${state.phase.round}`,
          catalogId: recruitedCatalogId,
          acquiredVia: "recruited",
          acquiredRound: state.phase.round,
          onboardingToken: { active: true, expiresEndOfRound: state.phase.round },
          loyaltyToken: { active: false },
          coachTokens: 0,
          isVoided: false
        };
        let nextState = {
          ...state,
          players: { ...state.players, [playerId]: { ...state.players[playerId], roster: [...state.players[playerId].roster, entry] } },
          phase: { ...state.phase, pendingInterrupt: { type: "NULL", sourcePlayerId: null, data: {} } }
        };
        nextState = appendLog(nextState, {
          type: "ACTION_CARD_EFFECT_APPLIED",
          playerId,
          catalogId: "GRW_039",
          recruitedCatalogId,
          message: `${playerId}'s Press Release recruits ${recruitedCatalogId} for free; the other candidate is fired out of the game.`
        });
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleGrw040(state, context) {
        const { playerId } = context;
        let nextState = advanceMarketShareWithBonusCheck(state, playerId, 1);
        const drawResult = drawFromOpenMarketActionCards(nextState, playerId, 1);
        nextState = appendLog(drawResult, {
          type: "ACTION_CARD_EFFECT_APPLIED",
          playerId,
          catalogId: "GRW_040",
          drawnCatalogIds: drawResult.drawnCatalogIds,
          message: `${playerId}'s Top Producer Circle gains +1 Market Share and acquires ${drawResult.drawnCatalogIds.length} card from the Open Market.`
        });
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleGrw041(state, context) {
        const { playerId, cardInstanceId, extra } = context;
        const player = state.players[playerId];
        if (!extra) {
          let nextState2 = adjustOfficeSlots(state, playerId, 3);
          nextState2 = {
            ...nextState2,
            phase: {
              ...nextState2.phase,
              pendingInterrupt: { type: "ACTION_CARD_EFFECT_CHOICE", sourcePlayerId: playerId, data: { catalogId: "GRW_041", choiceType: "GRW041_COACH_TARGET", cardInstanceId } }
            }
          };
          return {
            state: appendLog(nextState2, { type: "ACTION_CARD_EFFECT_GRW041_AWAITING_CHOICE", playerId, catalogId: "GRW_041" }),
            effectOutcome: DEFAULT_OUTCOME
          };
        }
        const targetEntry = player.roster.find((r) => r.agentInstanceId === extra.targetAgentInstanceId && !r.isVoided);
        let nextState = state;
        if (targetEntry) {
          nextState = {
            ...nextState,
            players: {
              ...nextState.players,
              [playerId]: { ...nextState.players[playerId], roster: nextState.players[playerId].roster.map((r) => r.agentInstanceId === extra.targetAgentInstanceId ? { ...r, coachTokens: r.coachTokens + 1 } : r) }
            }
          };
        }
        nextState = { ...nextState, phase: { ...nextState.phase, pendingInterrupt: { type: "NULL", sourcePlayerId: null, data: {} } } };
        nextState = appendLog(nextState, {
          type: "ACTION_CARD_EFFECT_APPLIED",
          playerId,
          catalogId: "GRW_041",
          targetAgentInstanceId: targetEntry ? extra.targetAgentInstanceId : null,
          message: targetEntry ? `${playerId}'s Office Overhaul assigns a Coach Token to ${targetEntry.catalogId}.` : `${playerId}'s Office Overhaul had no valid coach target.`
        });
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleGrw042(state, context) {
        const nextState = adjustWallet(state, context.playerId, 10, 0);
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleGrw043(state, context) {
        const { playerId } = context;
        const turnOrder = state.phase.turnOrder || [];
        const rivalIds = turnOrder.filter((id) => id !== playerId);
        const expiresRound = state.phase.round + 2;
        let nextState = state;
        rivalIds.forEach((rivalId) => {
          nextState = {
            ...nextState,
            players: {
              ...nextState.players,
              [rivalId]: {
                ...nextState.players[rivalId],
                marketDominanceEffectsAgainstMe: [...nextState.players[rivalId].marketDominanceEffectsAgainstMe || [], { sourcePlayerId: playerId, expiresRound }]
              }
            }
          };
        });
        nextState = appendLog(nextState, {
          type: "ACTION_CARD_EFFECT_APPLIED",
          playerId,
          catalogId: "GRW_043",
          expiresRound,
          rivalIds,
          message: `${playerId}'s Market Dominance taxes all rivals 2 PT per Recruit action through round ${expiresRound}.`
        });
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleGrw044(state, context) {
        const { playerId, cardInstanceId, extra } = context;
        const player = state.players[playerId];
        if (!extra) {
          const nextState2 = {
            ...state,
            phase: {
              ...state.phase,
              pendingInterrupt: { type: "ACTION_CARD_EFFECT_CHOICE", sourcePlayerId: playerId, data: { catalogId: "GRW_044", choiceType: "GRW044_LOYALTY_AND_COACH_TARGET", cardInstanceId } }
            }
          };
          return {
            state: appendLog(nextState2, { type: "ACTION_CARD_EFFECT_GRW044_AWAITING_CHOICE", playerId, catalogId: "GRW_044" }),
            effectOutcome: DEFAULT_OUTCOME
          };
        }
        const targetEntry = player.roster.find((r) => r.agentInstanceId === extra.targetAgentInstanceId && !r.isVoided);
        const canPlaceLoyalty = targetEntry && (!targetEntry.loyaltyToken || !targetEntry.loyaltyToken.active) && player.loyaltyTokensUsed < player.loyaltyTokensMax;
        let nextState = { ...state, phase: { ...state.phase, pendingInterrupt: { type: "NULL", sourcePlayerId: null, data: {} } } };
        if (targetEntry) {
          nextState = {
            ...nextState,
            players: {
              ...nextState.players,
              [playerId]: {
                ...nextState.players[playerId],
                loyaltyTokensUsed: canPlaceLoyalty ? nextState.players[playerId].loyaltyTokensUsed + 1 : nextState.players[playerId].loyaltyTokensUsed,
                roster: nextState.players[playerId].roster.map(
                  (r) => r.agentInstanceId === extra.targetAgentInstanceId ? { ...r, coachTokens: r.coachTokens + 1, loyaltyToken: canPlaceLoyalty ? { active: true } : r.loyaltyToken } : r
                )
              }
            }
          };
        }
        nextState = appendLog(nextState, {
          type: "ACTION_CARD_EFFECT_APPLIED",
          playerId,
          catalogId: "GRW_044",
          targetAgentInstanceId: targetEntry ? extra.targetAgentInstanceId : null,
          loyaltyApplied: canPlaceLoyalty,
          message: targetEntry ? `${playerId}'s Community Hero Award assigns a Coach Token${canPlaceLoyalty ? " and a Loyalty Token" : ""} to ${targetEntry.catalogId}.` : `${playerId}'s Community Hero Award had no valid target.`
        });
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleGrw045(state, context) {
        const { playerId } = context;
        let nextState = adjustTrack(state, playerId, "training", 2);
        nextState = adjustTrack(nextState, playerId, "recognition", 1);
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleGrw046(state, context) {
        const nextState = advanceMarketShareWithBonusCheck(state, context.playerId, 1);
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleGrw047(state, context) {
        const { playerId } = context;
        let nextState = adjustWallet(state, playerId, 15, 0);
        nextState = advanceMarketShareWithBonusCheck(nextState, playerId, 1);
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleGrw048(state, context) {
        const { playerId, cardInstanceId, extra } = context;
        const player = state.players[playerId];
        if (!extra) {
          const nextState2 = {
            ...state,
            phase: { ...state.phase, pendingInterrupt: { type: "ACTION_CARD_EFFECT_CHOICE", sourcePlayerId: playerId, data: { catalogId: "GRW_048", choiceType: "GRW048_LOYALTY_TARGET", cardInstanceId } } }
          };
          return {
            state: appendLog(nextState2, { type: "ACTION_CARD_EFFECT_GRW048_AWAITING_CHOICE", playerId, catalogId: "GRW_048" }),
            effectOutcome: DEFAULT_OUTCOME
          };
        }
        const targetEntry = player.roster.find((r) => r.agentInstanceId === extra.targetAgentInstanceId && !r.isVoided);
        const canPlace = targetEntry && (!targetEntry.loyaltyToken || !targetEntry.loyaltyToken.active) && player.loyaltyTokensUsed < player.loyaltyTokensMax;
        let nextState = { ...state, phase: { ...state.phase, pendingInterrupt: { type: "NULL", sourcePlayerId: null, data: {} } } };
        if (canPlace) {
          nextState = {
            ...nextState,
            players: {
              ...nextState.players,
              [playerId]: {
                ...nextState.players[playerId],
                loyaltyTokensUsed: nextState.players[playerId].loyaltyTokensUsed + 1,
                roster: nextState.players[playerId].roster.map((r) => r.agentInstanceId === extra.targetAgentInstanceId ? { ...r, loyaltyToken: { active: true } } : r)
              }
            }
          };
        }
        nextState = appendLog(nextState, {
          type: "ACTION_CARD_EFFECT_APPLIED",
          playerId,
          catalogId: "GRW_048",
          targetAgentInstanceId: canPlace ? extra.targetAgentInstanceId : null,
          message: canPlace ? `${playerId}'s Tech Platform Launch places a Loyalty Token on ${targetEntry.catalogId}.` : `${playerId}'s Tech Platform Launch had no valid target.`
        });
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleGrw049(state, context) {
        const { playerId } = context;
        const turnOrder = state.phase.turnOrder || [];
        const rivalIds = turnOrder.filter((id) => id !== playerId);
        const catalog = state.cardCatalog && state.cardCatalog.actionCards || {};
        let nextState = adjustWallet(state, playerId, 7, 0);
        const discardedPerRival = {};
        rivalIds.forEach((rivalId) => {
          const rival = nextState.players[rivalId];
          if (!rival.hand.actionCards.length) return;
          const sorted = [...rival.hand.actionCards].sort((a, b) => (catalog[b.catalogId] ? catalog[b.catalogId].cost : 0) - (catalog[a.catalogId] ? catalog[a.catalogId].cost : 0));
          const toDiscard = sorted[0];
          nextState = {
            ...nextState,
            players: {
              ...nextState.players,
              [rivalId]: {
                ...nextState.players[rivalId],
                hand: {
                  ...nextState.players[rivalId].hand,
                  actionCards: nextState.players[rivalId].hand.actionCards.filter((c) => c.instanceId !== toDiscard.instanceId),
                  personalDiscardPile: [...nextState.players[rivalId].hand.personalDiscardPile, toDiscard]
                }
              }
            }
          };
          discardedPerRival[rivalId] = toDiscard.catalogId;
        });
        nextState = appendLog(nextState, {
          type: "ACTION_CARD_EFFECT_APPLIED",
          playerId,
          catalogId: "GRW_049",
          discardedPerRival,
          message: `${playerId}'s Mega-Event Sponsorship gains 7 PT; ${Object.keys(discardedPerRival).length} rival(s) forced to discard a card.`
        });
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleGrw050(state, context) {
        const { playerId, cardInstanceId, extra } = context;
        const player = state.players[playerId];
        if (!extra) {
          let nextState2 = adjustWallet(state, playerId, 11, 0);
          nextState2 = {
            ...nextState2,
            phase: { ...nextState2.phase, pendingInterrupt: { type: "ACTION_CARD_EFFECT_CHOICE", sourcePlayerId: playerId, data: { catalogId: "GRW_050", choiceType: "GRW050_LOYALTY_TARGET", cardInstanceId } } }
          };
          return {
            state: appendLog(nextState2, { type: "ACTION_CARD_EFFECT_GRW050_AWAITING_CHOICE", playerId, catalogId: "GRW_050" }),
            effectOutcome: DEFAULT_OUTCOME
          };
        }
        const targetEntry = player.roster.find((r) => r.agentInstanceId === extra.targetAgentInstanceId && !r.isVoided);
        const canPlace = targetEntry && (!targetEntry.loyaltyToken || !targetEntry.loyaltyToken.active) && player.loyaltyTokensUsed < player.loyaltyTokensMax;
        let nextState = { ...state, phase: { ...state.phase, pendingInterrupt: { type: "NULL", sourcePlayerId: null, data: {} } } };
        if (canPlace) {
          nextState = {
            ...nextState,
            players: {
              ...nextState.players,
              [playerId]: {
                ...nextState.players[playerId],
                loyaltyTokensUsed: nextState.players[playerId].loyaltyTokensUsed + 1,
                roster: nextState.players[playerId].roster.map((r) => r.agentInstanceId === extra.targetAgentInstanceId ? { ...r, loyaltyToken: { active: true } } : r)
              }
            }
          };
        }
        nextState = appendLog(nextState, {
          type: "ACTION_CARD_EFFECT_APPLIED",
          playerId,
          catalogId: "GRW_050",
          targetAgentInstanceId: canPlace ? extra.targetAgentInstanceId : null,
          message: canPlace ? `${playerId}'s Hall of Fame Induction places a Loyalty Token on ${targetEntry.catalogId}.` : `${playerId}'s Hall of Fame Induction had no valid target.`
        });
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleGrw051(state, context) {
        const { playerId, cardInstanceId, extra } = context;
        if (!extra) {
          const nextState2 = {
            ...state,
            phase: { ...state.phase, pendingInterrupt: { type: "ACTION_CARD_EFFECT_CHOICE", sourcePlayerId: playerId, data: { catalogId: "GRW_051", choiceType: "GRW051_MARKET_TARGET", cardInstanceId } } }
          };
          return {
            state: appendLog(nextState2, { type: "ACTION_CARD_EFFECT_GRW051_AWAITING_CHOICE", playerId, catalogId: "GRW_051" }),
            effectOutcome: DEFAULT_OUTCOME
          };
        }
        if (extra.stage === "market") {
          const inMarket = extra.targetCatalogId && (state.board.openMarketAgents || []).some((a) => a.catalogId === extra.targetCatalogId);
          let nextState2 = state;
          if (inMarket) {
            nextState2 = localRemoveAgentFromMarketAndRefill(nextState2, extra.targetCatalogId);
            nextState2 = localAddAgentToRoster(nextState2, playerId, extra.targetCatalogId, `${cardInstanceId || "grw051"}-market`);
          }
          nextState2 = {
            ...nextState2,
            phase: { ...nextState2.phase, pendingInterrupt: { type: "ACTION_CARD_EFFECT_CHOICE", sourcePlayerId: playerId, data: { catalogId: "GRW_051", choiceType: "GRW051_RIVAL_TARGET", cardInstanceId } } }
          };
          return {
            state: appendLog(nextState2, { type: "ACTION_CARD_EFFECT_GRW051_MARKET_STEP_DONE", playerId, catalogId: "GRW_051", targetCatalogId: inMarket ? extra.targetCatalogId : null }),
            effectOutcome: DEFAULT_OUTCOME
          };
        }
        const { targetPlayerId, targetAgentInstanceId } = extra;
        let nextState = { ...state, phase: { ...state.phase, pendingInterrupt: { type: "NULL", sourcePlayerId: null, data: {} } } };
        if (targetPlayerId && targetAgentInstanceId && state.players[targetPlayerId]) {
          const rival = state.players[targetPlayerId];
          const rivalEntry = rival.roster.find((r) => r.agentInstanceId === targetAgentInstanceId && !r.isVoided);
          const rivalStats = rivalEntry ? getAgentStats(state, rivalEntry.catalogId) : null;
          const rivalIsTetheredFollower = rivalStats && rivalStats.network.role === "follower" && rivalStats.network.influencerCatalogId && rival.roster.some((r) => !r.isVoided && r.catalogId === rivalStats.network.influencerCatalogId) && !(rivalEntry.loyaltyToken && rivalEntry.loyaltyToken.active);
          const eligible = rivalEntry && rivalStats && rivalStats.totalProfit <= 5 && (!rivalEntry.onboardingToken || !rivalEntry.onboardingToken.active) && (!rivalEntry.loyaltyToken || !rivalEntry.loyaltyToken.active) && !rivalIsTetheredFollower;
          if (eligible) {
            nextState = {
              ...nextState,
              players: {
                ...nextState.players,
                [targetPlayerId]: { ...nextState.players[targetPlayerId], roster: nextState.players[targetPlayerId].roster.filter((r) => r.agentInstanceId !== targetAgentInstanceId) },
                [playerId]: { ...nextState.players[playerId], roster: [...nextState.players[playerId].roster, rivalEntry] }
              }
            };
          }
        }
        nextState = appendLog(nextState, {
          type: "ACTION_CARD_EFFECT_APPLIED",
          playerId,
          catalogId: "GRW_051",
          targetPlayerId: targetPlayerId || null,
          targetAgentInstanceId: targetAgentInstanceId || null,
          message: `${playerId}'s Brokerage Buyout completes.`
        });
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleGrw052(state, context) {
        const { playerId, cardInstanceId, extra } = context;
        if (!extra) {
          const nextState2 = {
            ...state,
            phase: { ...state.phase, pendingInterrupt: { type: "ACTION_CARD_EFFECT_CHOICE", sourcePlayerId: playerId, data: { catalogId: "GRW_052", choiceType: "GRW052_RIVAL_TARGET", cardInstanceId } } }
          };
          return {
            state: appendLog(nextState2, { type: "ACTION_CARD_EFFECT_GRW052_AWAITING_CHOICE", playerId, catalogId: "GRW_052" }),
            effectOutcome: DEFAULT_OUTCOME
          };
        }
        const { targetPlayerId, targetAgentInstanceId } = extra;
        let nextState = { ...state, phase: { ...state.phase, pendingInterrupt: { type: "NULL", sourcePlayerId: null, data: {} } } };
        const rival = state.players[targetPlayerId];
        const rivalEntry = rival ? rival.roster.find((r) => r.agentInstanceId === targetAgentInstanceId && !r.isVoided) : null;
        const rivalEntryStats = rivalEntry ? getAgentStats(state, rivalEntry.catalogId) : null;
        const rivalIsTetheredFollower = rival && rivalEntryStats && rivalEntryStats.network.role === "follower" && rivalEntryStats.network.influencerCatalogId && rival.roster.some((r) => !r.isVoided && r.catalogId === rivalEntryStats.network.influencerCatalogId) && !(rivalEntry.loyaltyToken && rivalEntry.loyaltyToken.active);
        const eligible = rivalEntry && (!rivalEntry.onboardingToken || !rivalEntry.onboardingToken.active) && (!rivalEntry.loyaltyToken || !rivalEntry.loyaltyToken.active) && !rivalIsTetheredFollower;
        if (eligible) {
          const movedEntry = { ...rivalEntry, loyaltyToken: { active: true } };
          nextState = {
            ...nextState,
            players: {
              ...nextState.players,
              [targetPlayerId]: { ...nextState.players[targetPlayerId], roster: nextState.players[targetPlayerId].roster.filter((r) => r.agentInstanceId !== targetAgentInstanceId) },
              [playerId]: {
                ...nextState.players[playerId],
                loyaltyTokensUsed: nextState.players[playerId].loyaltyTokensUsed + 1,
                roster: [...nextState.players[playerId].roster, movedEntry]
              }
            }
          };
        }
        nextState = appendLog(nextState, {
          type: "ACTION_CARD_EFFECT_APPLIED",
          playerId,
          catalogId: "GRW_052",
          targetPlayerId,
          targetAgentInstanceId: eligible ? targetAgentInstanceId : null,
          message: eligible ? `${playerId}'s Market Leadership steals ${rivalEntry.catalogId} from ${targetPlayerId} and locks it with Loyalty.` : `${playerId}'s Market Leadership had no valid target.`
        });
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleGrw053(state, context) {
        const { playerId, cardInstanceId, extra } = context;
        if (!extra || !Array.isArray(extra.candidateCatalogIds)) {
          const openMarket = (state.board.openMarketActionCards || []).map((c) => c.catalogId);
          const peekCount = Math.min(4, openMarket.length);
          const candidateCatalogIds2 = openMarket.slice(0, peekCount);
          if (candidateCatalogIds2.length === 0) {
            return {
              state: appendLog(state, { type: "ACTION_CARD_EFFECT_GRW053_SKIPPED", playerId, catalogId: "GRW_053", reason: "OPEN_MARKET_EMPTY" }),
              effectOutcome: DEFAULT_OUTCOME
            };
          }
          const remainingMarket = (state.board.openMarketActionCards || []).slice(peekCount);
          const drawPile = state.board.decks && state.board.decks.actionCardDrawPile || [];
          const refillCount = Math.min(peekCount, drawPile.length);
          const refilled = drawPile.slice(0, refillCount).map((catalogId) => ({ catalogId }));
          const newDrawPile = drawPile.slice(refillCount);
          let nextState2 = {
            ...state,
            board: { ...state.board, openMarketActionCards: [...refilled, ...remainingMarket], decks: { ...state.board.decks, actionCardDrawPile: newDrawPile } },
            phase: { ...state.phase, pendingInterrupt: { type: "ACTION_CARD_EFFECT_CHOICE", sourcePlayerId: playerId, data: { catalogId: "GRW_053", choiceType: "GRW053_KEEP_TWO_CHOICE", cardInstanceId, candidateCatalogIds: candidateCatalogIds2 } } }
          };
          return {
            state: appendLog(nextState2, { type: "ACTION_CARD_EFFECT_GRW053_AWAITING_CHOICE", playerId, catalogId: "GRW_053", candidateCatalogIds: candidateCatalogIds2 }),
            effectOutcome: DEFAULT_OUTCOME
          };
        }
        const { keptCatalogIds, candidateCatalogIds } = extra;
        const player = state.players[playerId];
        const kept = (keptCatalogIds || []).slice(0, 2);
        const discarded = (candidateCatalogIds || []).filter((id) => !kept.includes(id) || kept.indexOf(id) !== candidateCatalogIds.indexOf(id));
        const keptRemaining = [...kept];
        const finalKept = [];
        const finalDiscarded = [];
        (candidateCatalogIds || []).forEach((catalogId) => {
          const idx = keptRemaining.indexOf(catalogId);
          if (idx !== -1) {
            finalKept.push(catalogId);
            keptRemaining.splice(idx, 1);
          } else {
            finalDiscarded.push(catalogId);
          }
        });
        const bothPersonalPilesEmpty = player.hand.personalDrawPile.length === 0 && player.hand.personalDiscardPile.length === 0;
        let handCards = [...player.hand.actionCards];
        let discardPile = [...player.hand.personalDiscardPile];
        finalKept.forEach((catalogId, i) => {
          const entry = { instanceId: `ac-${playerId}-dataanalysis-r${state.phase.round}-${i}`, catalogId };
          if (handCards.length < player.hand.maxHandSize || bothPersonalPilesEmpty) {
            handCards = [...handCards, entry];
          } else {
            discardPile = [...discardPile, entry];
          }
        });
        finalDiscarded.forEach((catalogId, i) => {
          discardPile = [...discardPile, { instanceId: `ac-${playerId}-dataanalysis-discard-r${state.phase.round}-${i}`, catalogId }];
        });
        let nextState = {
          ...state,
          players: { ...state.players, [playerId]: { ...player, hand: { ...player.hand, actionCards: handCards, personalDiscardPile: discardPile } } },
          phase: { ...state.phase, pendingInterrupt: { type: "NULL", sourcePlayerId: null, data: {} } }
        };
        nextState = appendLog(nextState, {
          type: "ACTION_CARD_EFFECT_APPLIED",
          playerId,
          catalogId: "GRW_053",
          keptCatalogIds: finalKept,
          discardedCatalogIds: finalDiscarded,
          message: `${playerId}'s Data Analysis keeps ${finalKept.join(", ") || "nothing"}; discards ${finalDiscarded.join(", ") || "nothing"}.`
        });
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleGrw054(state, context) {
        const { playerId, cardInstanceId, extra } = context;
        const player = state.players[playerId];
        if (!extra) {
          let nextState2 = adjustWallet(state, playerId, 3, 0);
          nextState2 = {
            ...nextState2,
            phase: { ...nextState2.phase, pendingInterrupt: { type: "ACTION_CARD_EFFECT_CHOICE", sourcePlayerId: playerId, data: { catalogId: "GRW_054", choiceType: "GRW054_LOYALTY_TARGET", cardInstanceId } } }
          };
          return {
            state: appendLog(nextState2, { type: "ACTION_CARD_EFFECT_GRW054_AWAITING_CHOICE", playerId, catalogId: "GRW_054" }),
            effectOutcome: DEFAULT_OUTCOME
          };
        }
        const targetEntry = player.roster.find((r) => r.agentInstanceId === extra.targetAgentInstanceId && !r.isVoided);
        const canPlace = targetEntry && (!targetEntry.loyaltyToken || !targetEntry.loyaltyToken.active) && player.loyaltyTokensUsed < player.loyaltyTokensMax;
        let nextState = { ...state, phase: { ...state.phase, pendingInterrupt: { type: "NULL", sourcePlayerId: null, data: {} } } };
        if (canPlace) {
          nextState = {
            ...nextState,
            players: {
              ...nextState.players,
              [playerId]: {
                ...nextState.players[playerId],
                loyaltyTokensUsed: nextState.players[playerId].loyaltyTokensUsed + 1,
                roster: nextState.players[playerId].roster.map((r) => r.agentInstanceId === extra.targetAgentInstanceId ? { ...r, loyaltyToken: { active: true } } : r)
              }
            }
          };
        }
        nextState = appendLog(nextState, {
          type: "ACTION_CARD_EFFECT_APPLIED",
          playerId,
          catalogId: "GRW_054",
          targetAgentInstanceId: canPlace ? extra.targetAgentInstanceId : null,
          message: canPlace ? `${playerId}'s High-Level Meeting places a Loyalty Token on ${targetEntry.catalogId}.` : `${playerId}'s High-Level Meeting had no valid target.`
        });
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleGrw055(state, context) {
        const { playerId, cardInstanceId, extra } = context;
        const player = state.players[playerId];
        if (!extra) {
          let nextState2 = adjustWallet(state, playerId, 3, 0);
          nextState2 = {
            ...nextState2,
            phase: { ...nextState2.phase, pendingInterrupt: { type: "ACTION_CARD_EFFECT_CHOICE", sourcePlayerId: playerId, data: { catalogId: "GRW_055", choiceType: "GRW055_DOUBLE_COACH_TARGET", cardInstanceId } } }
          };
          return {
            state: appendLog(nextState2, { type: "ACTION_CARD_EFFECT_GRW055_AWAITING_CHOICE", playerId, catalogId: "GRW_055" }),
            effectOutcome: DEFAULT_OUTCOME
          };
        }
        const targetEntry = player.roster.find((r) => r.agentInstanceId === extra.targetAgentInstanceId && !r.isVoided);
        let nextState = state;
        if (targetEntry) {
          nextState = {
            ...nextState,
            players: {
              ...nextState.players,
              [playerId]: { ...nextState.players[playerId], roster: nextState.players[playerId].roster.map((r) => r.agentInstanceId === extra.targetAgentInstanceId ? { ...r, coachTokens: r.coachTokens + 2 } : r) }
            }
          };
        }
        nextState = { ...nextState, phase: { ...nextState.phase, pendingInterrupt: { type: "NULL", sourcePlayerId: null, data: {} } } };
        nextState = appendLog(nextState, {
          type: "ACTION_CARD_EFFECT_APPLIED",
          playerId,
          catalogId: "GRW_055",
          targetAgentInstanceId: targetEntry ? extra.targetAgentInstanceId : null,
          message: targetEntry ? `${playerId}'s Agent Retreat assigns 2 Coach Tokens to ${targetEntry.catalogId}.` : `${playerId}'s Agent Retreat had no valid coach target.`
        });
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleGrw056(state, context) {
        const { playerId, cardInstanceId, extra } = context;
        if (!extra || !extra.stage) {
          const nextState2 = {
            ...state,
            phase: { ...state.phase, pendingInterrupt: { type: "ACTION_CARD_EFFECT_CHOICE", sourcePlayerId: playerId, data: { catalogId: "GRW_056", choiceType: "GRW056_RECRUIT_TARGET_1", cardInstanceId } } }
          };
          return {
            state: appendLog(nextState2, { type: "ACTION_CARD_EFFECT_GRW056_AWAITING_CHOICE", playerId, catalogId: "GRW_056" }),
            effectOutcome: DEFAULT_OUTCOME
          };
        }
        if (extra.stage === "first") {
          let nextState2 = state;
          if (extra.targetCatalogId && (state.board.openMarketAgents || []).some((a) => a.catalogId === extra.targetCatalogId)) {
            nextState2 = localRemoveAgentFromMarketAndRefill(nextState2, extra.targetCatalogId);
            nextState2 = localAddAgentToRoster(nextState2, playerId, extra.targetCatalogId, `${cardInstanceId || "grw056"}-first`);
          }
          nextState2 = {
            ...nextState2,
            phase: { ...nextState2.phase, pendingInterrupt: { type: "ACTION_CARD_EFFECT_CHOICE", sourcePlayerId: playerId, data: { catalogId: "GRW_056", choiceType: "GRW056_RECRUIT_TARGET_2", cardInstanceId } } }
          };
          return {
            state: appendLog(nextState2, { type: "ACTION_CARD_EFFECT_GRW056_FIRST_STEP_DONE", playerId, catalogId: "GRW_056", targetCatalogId: extra.targetCatalogId || null }),
            effectOutcome: DEFAULT_OUTCOME
          };
        }
        let nextState = { ...state, phase: { ...state.phase, pendingInterrupt: { type: "NULL", sourcePlayerId: null, data: {} } } };
        if (extra.targetCatalogId && (state.board.openMarketAgents || []).some((a) => a.catalogId === extra.targetCatalogId)) {
          nextState = localRemoveAgentFromMarketAndRefill(nextState, extra.targetCatalogId);
          nextState = localAddAgentToRoster(nextState, playerId, extra.targetCatalogId, `${cardInstanceId || "grw056"}-second`);
        }
        nextState = appendLog(nextState, {
          type: "ACTION_CARD_EFFECT_APPLIED",
          playerId,
          catalogId: "GRW_056",
          message: `${playerId}'s Market Expansion recruits up to 2 free Agents from the Open Market.`
        });
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleGrw057(state, context) {
        const { playerId, cardInstanceId, extra } = context;
        const player = state.players[playerId];
        if (!extra) {
          let nextState2 = adjustTrack(state, playerId, "technology", 4);
          nextState2 = {
            ...nextState2,
            phase: { ...nextState2.phase, pendingInterrupt: { type: "ACTION_CARD_EFFECT_CHOICE", sourcePlayerId: playerId, data: { catalogId: "GRW_057", choiceType: "GRW057_COACH_TARGET", cardInstanceId } } }
          };
          return {
            state: appendLog(nextState2, { type: "ACTION_CARD_EFFECT_GRW057_AWAITING_CHOICE", playerId, catalogId: "GRW_057" }),
            effectOutcome: DEFAULT_OUTCOME
          };
        }
        const targetEntry = player.roster.find((r) => r.agentInstanceId === extra.targetAgentInstanceId && !r.isVoided);
        let nextState = state;
        if (targetEntry) {
          nextState = {
            ...nextState,
            players: {
              ...nextState.players,
              [playerId]: { ...nextState.players[playerId], roster: nextState.players[playerId].roster.map((r) => r.agentInstanceId === extra.targetAgentInstanceId ? { ...r, coachTokens: r.coachTokens + 1 } : r) }
            }
          };
        }
        nextState = { ...nextState, phase: { ...nextState.phase, pendingInterrupt: { type: "NULL", sourcePlayerId: null, data: {} } } };
        nextState = appendLog(nextState, {
          type: "ACTION_CARD_EFFECT_APPLIED",
          playerId,
          catalogId: "GRW_057",
          targetAgentInstanceId: targetEntry ? extra.targetAgentInstanceId : null,
          message: targetEntry ? `${playerId}'s Technology Investment assigns a Coach Token to ${targetEntry.catalogId}.` : `${playerId}'s Technology Investment had no valid coach target.`
        });
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleGrw058(state, context) {
        const { playerId } = context;
        let nextState = adjustTrack(state, playerId, "recognition", 4);
        nextState = adjustWallet(nextState, playerId, 5, 0);
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleGrw059(state, context) {
        const { playerId, cardInstanceId, extra } = context;
        if (!extra) {
          const nextState2 = {
            ...state,
            phase: { ...state.phase, pendingInterrupt: { type: "ACTION_CARD_EFFECT_CHOICE", sourcePlayerId: playerId, data: { catalogId: "GRW_059", choiceType: "GRW059_RECRUIT_TARGET", cardInstanceId } } }
          };
          return {
            state: appendLog(nextState2, { type: "ACTION_CARD_EFFECT_GRW059_AWAITING_CHOICE", playerId, catalogId: "GRW_059" }),
            effectOutcome: DEFAULT_OUTCOME
          };
        }
        const { targetCatalogId } = extra;
        const inMarket = (state.board.openMarketAgents || []).some((a) => a.catalogId === targetCatalogId);
        let nextState = { ...state, phase: { ...state.phase, pendingInterrupt: { type: "NULL", sourcePlayerId: null, data: {} } } };
        if (inMarket) {
          nextState = localRemoveAgentFromMarketAndRefill(nextState, targetCatalogId);
          nextState = localAddAgentToRoster(nextState, playerId, targetCatalogId, cardInstanceId || "grw059");
        }
        nextState = appendLog(nextState, {
          type: "ACTION_CARD_EFFECT_APPLIED",
          playerId,
          catalogId: "GRW_059",
          targetCatalogId: inMarket ? targetCatalogId : null,
          message: inMarket ? `${playerId}'s Strategic Hiring recruits ${targetCatalogId} for free.` : `${playerId}'s Strategic Hiring had no valid target.`
        });
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleGrw060(state, context) {
        const { playerId } = context;
        let nextState = advanceMarketShareWithBonusCheck(state, playerId, 2);
        const drawResult = drawFromOpenMarketActionCards(nextState, playerId, 2);
        nextState = appendLog(drawResult, {
          type: "ACTION_CARD_EFFECT_APPLIED",
          playerId,
          catalogId: "GRW_060",
          drawnCatalogIds: drawResult.drawnCatalogIds,
          message: `${playerId}'s Tech Workshop gains +2 Market Share and acquires ${drawResult.drawnCatalogIds.length} card(s) from the Open Market.`
        });
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleGrw061(state, context) {
        const { playerId, cardInstanceId, extra } = context;
        const player = state.players[playerId];
        if (!extra) {
          let nextState2 = adjustWallet(state, playerId, 3, 0);
          nextState2 = {
            ...nextState2,
            phase: { ...nextState2.phase, pendingInterrupt: { type: "ACTION_CARD_EFFECT_CHOICE", sourcePlayerId: playerId, data: { catalogId: "GRW_061", choiceType: "GRW061_COACH_TARGET", cardInstanceId } } }
          };
          return {
            state: appendLog(nextState2, { type: "ACTION_CARD_EFFECT_GRW061_AWAITING_CHOICE", playerId, catalogId: "GRW_061" }),
            effectOutcome: DEFAULT_OUTCOME
          };
        }
        const targetEntry = player.roster.find((r) => r.agentInstanceId === extra.targetAgentInstanceId && !r.isVoided);
        let nextState = state;
        if (targetEntry) {
          nextState = {
            ...nextState,
            players: {
              ...nextState.players,
              [playerId]: { ...nextState.players[playerId], roster: nextState.players[playerId].roster.map((r) => r.agentInstanceId === extra.targetAgentInstanceId ? { ...r, coachTokens: r.coachTokens + 1 } : r) }
            }
          };
        }
        nextState = { ...nextState, phase: { ...nextState.phase, pendingInterrupt: { type: "NULL", sourcePlayerId: null, data: {} } } };
        nextState = appendLog(nextState, {
          type: "ACTION_CARD_EFFECT_APPLIED",
          playerId,
          catalogId: "GRW_061",
          targetAgentInstanceId: targetEntry ? extra.targetAgentInstanceId : null,
          message: targetEntry ? `${playerId}'s Community Event assigns a Coach Token to ${targetEntry.catalogId}.` : `${playerId}'s Community Event had no valid coach target.`
        });
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleGrw062(state, context) {
        const { playerId } = context;
        const player = state.players[playerId];
        const targetLevel = 5;
        const delta = Math.max(0, targetLevel - player.tracks.technology.value);
        const nextState = adjustTrack(state, playerId, "technology", delta);
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleGrw063(state, context) {
        const { playerId } = context;
        let nextState = adjustTrack(state, playerId, "recognition", 5);
        const drawResult = drawFromOpenMarketActionCards(nextState, playerId, 2);
        nextState = appendLog(drawResult, {
          type: "ACTION_CARD_EFFECT_APPLIED",
          playerId,
          catalogId: "GRW_063",
          drawnCatalogIds: drawResult.drawnCatalogIds,
          message: `${playerId}'s Public Relations Campaign gains +5 Recognition and acquires ${drawResult.drawnCatalogIds.length} card(s) from the Open Market.`
        });
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleGrw064(state, context) {
        const { playerId } = context;
        let nextState = adjustOfficeSlots(state, playerId, 1);
        const drawResult = drawFromSharedActionCardDeckBlind(nextState, playerId, 1);
        nextState = appendLog(drawResult, {
          type: "ACTION_CARD_EFFECT_APPLIED",
          playerId,
          catalogId: "GRW_064",
          drawnCatalogIds: drawResult.drawnCatalogIds,
          message: `${playerId}'s Professional Development draws 1 facedown Action Card and gains +1 Office expansion.`
        });
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleGrw065(state, context) {
        const { playerId } = context;
        let nextState = adjustWallet(state, playerId, 10, 0);
        const drawResult = drawFromOpenMarketActionCards(nextState, playerId, 3);
        nextState = appendLog(drawResult, {
          type: "ACTION_CARD_EFFECT_APPLIED",
          playerId,
          catalogId: "GRW_065",
          drawnCatalogIds: drawResult.drawnCatalogIds,
          message: `${playerId}'s Strategic Partnership gains +10 PT and acquires ${drawResult.drawnCatalogIds.length} card(s) from the Open Market.`
        });
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleGrw066(state, context) {
        const { playerId, cardInstanceId } = context;
        const openMarketAgents = (state.board.openMarketAgents || []).filter((a) => a && a.catalogId);
        const catalog = state.cardCatalog && state.cardCatalog.agentCards || {};
        let lowest = null;
        openMarketAgents.forEach((entry) => {
          const stats = catalog[entry.catalogId];
          if (!stats) return;
          if (!lowest || stats.totalProfit < lowest.totalProfit) {
            lowest = { catalogId: entry.catalogId, totalProfit: stats.totalProfit };
          }
        });
        let nextState = adjustOfficeSlots(state, playerId, 1);
        if (lowest) {
          nextState = localRemoveAgentFromMarketAndRefill(nextState, lowest.catalogId);
          nextState = localAddAgentToRoster(nextState, playerId, lowest.catalogId, cardInstanceId || "grw066");
        }
        nextState = appendLog(nextState, {
          type: "ACTION_CARD_EFFECT_APPLIED",
          playerId,
          catalogId: "GRW_066",
          recruitedCatalogId: lowest ? lowest.catalogId : null,
          message: lowest ? `${playerId}'s Influencer Marketing recruits ${lowest.catalogId} (lowest Income in the Open Market) and gains +1 Office.` : `${playerId}'s Influencer Marketing had no Open Market Agent to recruit, but still gains +1 Office.`
        });
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleGrw067(state, context) {
        const { playerId } = context;
        let nextState = adjustWallet(state, playerId, 3, 0);
        nextState = adjustTrack(nextState, playerId, "recognition", 2);
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleGrw068(state, context) {
        const { playerId } = context;
        let nextState = adjustTrack(state, playerId, "training", 3);
        const drawResult = drawFromOpenMarketActionCards(nextState, playerId, 1);
        nextState = appendLog(drawResult, {
          type: "ACTION_CARD_EFFECT_APPLIED",
          playerId,
          catalogId: "GRW_068",
          drawnCatalogIds: drawResult.drawnCatalogIds,
          message: `${playerId}'s Growth Seminar gains +3 Training and acquires ${drawResult.drawnCatalogIds.length} card from the Open Market.`
        });
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleGrw069(state, context) {
        const { playerId } = context;
        const player = state.players[playerId];
        const catalog = state.cardCatalog && state.cardCatalog.agentCards || {};
        const qualifyingCount = player.roster.filter((entry) => {
          if (entry.isVoided) return false;
          const stats = catalog[entry.catalogId];
          return stats && typeof stats.technology === "number" && stats.technology >= 5;
        }).length;
        const totalGain = qualifyingCount * 5;
        let nextState = totalGain > 0 ? adjustWallet(state, playerId, totalGain, 0) : state;
        nextState = appendLog(nextState, {
          type: "ACTION_CARD_EFFECT_APPLIED",
          playerId,
          catalogId: "GRW_069",
          qualifyingCount,
          totalGain,
          message: `${playerId}'s Automated Marketing gains ${totalGain} PT (${qualifyingCount} Agent(s) with Technology 5+).`
        });
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      module.exports = {
        handleGrw001,
        handleGrw002,
        handleGrw003,
        handleGrw004,
        handleGrw005,
        handleGrw006,
        handleGrw007,
        handleGrw008,
        handleGrw009,
        handleGrw010,
        handleGrw011,
        handleGrw012,
        handleGrw013,
        handleGrw014,
        handleGrw015,
        handleGrw016,
        handleGrw017,
        handleGrw018,
        handleGrw019,
        handleGrw020,
        handleGrw021,
        handleGrw022,
        handleGrw023,
        handleGrw024,
        handleGrw025,
        handleGrw026,
        handleGrw027,
        handleGrw028,
        handleGrw029,
        handleGrw030,
        handleGrw031,
        handleGrw032,
        handleGrw033,
        handleGrw034,
        handleGrw035,
        handleGrw036,
        handleGrw037,
        handleGrw038,
        handleGrw039,
        handleGrw040,
        handleGrw041,
        handleGrw042,
        handleGrw043,
        handleGrw044,
        handleGrw045,
        handleGrw046,
        handleGrw047,
        handleGrw048,
        handleGrw049,
        handleGrw050,
        handleGrw051,
        handleGrw052,
        handleGrw053,
        handleGrw054,
        handleGrw055,
        handleGrw056,
        handleGrw057,
        handleGrw058,
        handleGrw059,
        handleGrw060,
        handleGrw061,
        handleGrw062,
        handleGrw063,
        handleGrw064,
        handleGrw065,
        handleGrw066,
        handleGrw067,
        handleGrw068,
        handleGrw069
      };
    }
  });

  // handlers/actionCards/strategy.js
  var require_strategy = __commonJS({
    "handlers/actionCards/strategy.js"(exports, module) {
      var { grantShiftImmunity } = require_immunityReducer();
      var { adjustOfficeSlots, adjustWallet, adjustTrack, adjustMarketShare, fireAgentBySelector, pickRosterExtremeBy } = require_cardEffectHelpers();
      function getAgentRecruitmentHelpers() {
        return require_agentRecruitmentReducer();
      }
      var DEFAULT_OUTCOME = { skipDefaultDiscard: false, customDestination: null };
      function appendLog(state, entry) {
        const logEntry = {
          seq: state.log.length + 1,
          timestamp: (/* @__PURE__ */ new Date()).toISOString(),
          round: state.phase.round,
          ...entry
        };
        return { ...state, log: [...state.log, logEntry] };
      }
      function forceDrawAndDiscardShiftCard(state) {
        let drawPile = state.shiftDeck.drawPile;
        let discardPile = state.shiftDeck.discardPile;
        if (drawPile.length === 0 && discardPile.length > 0) {
          drawPile = [...discardPile];
          discardPile = [];
        }
        if (drawPile.length === 0) {
          return { state, drawnCatalogId: null };
        }
        const drawnCatalogId = drawPile[0].catalogId;
        const nextState = {
          ...state,
          shiftDeck: {
            drawPile: drawPile.slice(1),
            discardPile: [...discardPile, drawPile[0]]
          }
        };
        return { state: nextState, drawnCatalogId };
      }
      function handleStr071(state, context) {
        const nextState = adjustOfficeSlots(state, context.playerId, 2);
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleStr075(state, context) {
        const nextState = grantShiftImmunity(state, context.playerId, context.cardInstanceId);
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleStr070(state, context) {
        const { playerId, cardInstanceId, extra } = context;
        const player = state.players[playerId];
        if (!extra) {
          let nextState2 = adjustOfficeSlots(state, playerId, -1);
          const drawResult = forceDrawAndDiscardShiftCard(nextState2);
          nextState2 = drawResult.state;
          nextState2 = {
            ...nextState2,
            phase: { ...nextState2.phase, pendingInterrupt: { type: "ACTION_CARD_EFFECT_CHOICE", sourcePlayerId: playerId, data: { catalogId: "STR_070", choiceType: "STR070_PROTECT_TARGET", cardInstanceId } } }
          };
          return {
            state: appendLog(nextState2, { type: "ACTION_CARD_EFFECT_STR070_AWAITING_CHOICE", playerId, catalogId: "STR_070", drawnShiftCatalogId: drawResult.drawnCatalogId }),
            effectOutcome: DEFAULT_OUTCOME
          };
        }
        const targetEntry = player.roster.find((r) => r.agentInstanceId === extra.targetAgentInstanceId && !r.isVoided);
        let nextState = state;
        if (targetEntry) {
          nextState = {
            ...nextState,
            players: {
              ...nextState.players,
              [playerId]: {
                ...nextState.players[playerId],
                roster: nextState.players[playerId].roster.map((r) => r.agentInstanceId === extra.targetAgentInstanceId ? { ...r, recruitmentProtectedUntilRound: nextState.phase.round } : r)
              }
            }
          };
        }
        nextState = { ...nextState, phase: { ...nextState.phase, pendingInterrupt: { type: "NULL", sourcePlayerId: null, data: {} } } };
        nextState = appendLog(nextState, {
          type: "ACTION_CARD_EFFECT_APPLIED",
          playerId,
          catalogId: "STR_070",
          targetAgentInstanceId: targetEntry ? extra.targetAgentInstanceId : null,
          message: targetEntry ? `${playerId}'s Office Offer Save protects ${targetEntry.catalogId} from recruitment this round.` : `${playerId}'s Office Offer Save had no valid target.`
        });
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleStr072(state, context) {
        const { playerId, cardInstanceId, extra } = context;
        const player = state.players[playerId];
        if (!extra) {
          const drawResult = forceDrawAndDiscardShiftCard(state);
          let nextState2 = {
            ...drawResult.state,
            phase: { ...drawResult.state.phase, pendingInterrupt: { type: "ACTION_CARD_EFFECT_CHOICE", sourcePlayerId: playerId, data: { catalogId: "STR_072", choiceType: "STR072_PROTECT_TARGET", cardInstanceId } } }
          };
          return {
            state: appendLog(nextState2, { type: "ACTION_CARD_EFFECT_STR072_AWAITING_CHOICE", playerId, catalogId: "STR_072", drawnShiftCatalogId: drawResult.drawnCatalogId }),
            effectOutcome: DEFAULT_OUTCOME
          };
        }
        const targetEntry = player.roster.find((r) => r.agentInstanceId === extra.targetAgentInstanceId && !r.isVoided);
        let nextState = state;
        if (targetEntry) {
          nextState = {
            ...nextState,
            players: {
              ...nextState.players,
              [playerId]: {
                ...nextState.players[playerId],
                roster: nextState.players[playerId].roster.map((r) => r.agentInstanceId === extra.targetAgentInstanceId ? { ...r, recruitmentProtectedUntilRound: nextState.phase.round } : r)
              }
            }
          };
        }
        nextState = { ...nextState, phase: { ...nextState.phase, pendingInterrupt: { type: "NULL", sourcePlayerId: null, data: {} } } };
        nextState = appendLog(nextState, {
          type: "ACTION_CARD_EFFECT_APPLIED",
          playerId,
          catalogId: "STR_072",
          targetAgentInstanceId: targetEntry ? extra.targetAgentInstanceId : null,
          message: targetEntry ? `${playerId}'s Compliance Review protects ${targetEntry.catalogId} from recruitment this turn.` : `${playerId}'s Compliance Review had no valid target.`
        });
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleStr073(state, context) {
        const nextState = grantShiftImmunity(state, context.playerId, context.cardInstanceId);
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleStr074(state, context) {
        const { playerId, cardInstanceId, extra } = context;
        if (!extra) {
          const nextState2 = {
            ...state,
            phase: { ...state.phase, pendingInterrupt: { type: "ACTION_CARD_EFFECT_CHOICE", sourcePlayerId: playerId, data: { catalogId: "STR_074", choiceType: "STR074_RIVAL_TARGET", cardInstanceId } } }
          };
          return {
            state: appendLog(nextState2, { type: "ACTION_CARD_EFFECT_STR074_AWAITING_CHOICE", playerId, catalogId: "STR_074" }),
            effectOutcome: DEFAULT_OUTCOME
          };
        }
        const { targetPlayerId } = extra;
        let nextState = { ...state, phase: { ...state.phase, pendingInterrupt: { type: "NULL", sourcePlayerId: null, data: {} } } };
        if (state.players[targetPlayerId]) {
          nextState = {
            ...nextState,
            players: {
              ...nextState.players,
              [targetPlayerId]: { ...nextState.players[targetPlayerId], marketplacePtBlockedUntilRound: nextState.phase.round }
            }
          };
        }
        nextState = appendLog(nextState, {
          type: "ACTION_CARD_EFFECT_APPLIED",
          playerId,
          catalogId: "STR_074",
          targetPlayerId,
          message: `${playerId}'s Timely Advice blocks ${targetPlayerId} from gaining Profit Tokens this round.`
        });
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleStr076(state, context) {
        const drawResult = forceDrawAndDiscardShiftCard(state);
        let nextState = grantShiftImmunity(drawResult.state, context.playerId, context.cardInstanceId);
        nextState = appendLog(nextState, {
          type: "ACTION_CARD_EFFECT_APPLIED",
          playerId: context.playerId,
          catalogId: "STR_076",
          drawnShiftCatalogId: drawResult.drawnCatalogId,
          message: `${context.playerId}'s Market Insight draws a Shift Card and grants shift immunity.`
        });
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleStr077(state, context) {
        const { playerId } = context;
        const player = state.players[playerId];
        const nextState = {
          ...state,
          players: {
            ...state.players,
            [playerId]: {
              ...player,
              roster: player.roster.map((r) => r.isVoided ? r : { ...r, recruitmentProtectedUntilRound: state.phase.round })
            }
          }
        };
        return {
          state: appendLog(nextState, {
            type: "ACTION_CARD_EFFECT_APPLIED",
            playerId,
            catalogId: "STR_077",
            protectedCount: player.roster.filter((r) => !r.isVoided).length,
            message: `${playerId}'s Brokerage Reputation protects all ${player.roster.filter((r) => !r.isVoided).length} Agent(s) from recruitment this round.`
          }),
          effectOutcome: DEFAULT_OUTCOME
        };
      }
      function handleStr078(state, context) {
        const { playerId, cardInstanceId, extra } = context;
        if (!extra || !extra.trackChoice) {
          const drawResult = forceDrawAndDiscardShiftCard(state);
          let nextState2 = {
            ...drawResult.state,
            phase: { ...drawResult.state.phase, pendingInterrupt: { type: "ACTION_CARD_EFFECT_CHOICE", sourcePlayerId: playerId, data: { catalogId: "STR_078", choiceType: "STR078_SPACE_TRACK_CHOICE", cardInstanceId } } }
          };
          return {
            state: appendLog(nextState2, { type: "ACTION_CARD_EFFECT_STR078_AWAITING_CHOICE", playerId, catalogId: "STR_078", drawnShiftCatalogId: drawResult.drawnCatalogId }),
            effectOutcome: DEFAULT_OUTCOME
          };
        }
        const TRACK_TO_SPACE_ID = { training: "OPS_TRAINING", technology: "OPS_TECHNOLOGY", recognition: "OPS_RECOGNITION" };
        const targetSpaceId = TRACK_TO_SPACE_ID[extra.trackChoice];
        let nextState = { ...state, phase: { ...state.phase, pendingInterrupt: { type: "NULL", sourcePlayerId: null, data: {} } } };
        if (targetSpaceId) {
          nextState = {
            ...nextState,
            board: {
              ...nextState.board,
              actionSpaces: nextState.board.actionSpaces.map((s) => s.spaceId === targetSpaceId ? { ...s, status: "blocked", blockedUntilRound: nextState.phase.round } : s)
            }
          };
        }
        nextState = appendLog(nextState, {
          type: "ACTION_CARD_EFFECT_APPLIED",
          playerId,
          catalogId: "STR_078",
          targetSpaceId: targetSpaceId || null,
          message: targetSpaceId ? `${playerId}'s Mentor Program blocks all Meeple placements on ${targetSpaceId} this round.` : `${playerId}'s Mentor Program had no valid track choice.`
        });
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleStr079(state, context) {
        const { playerId, cardInstanceId, extra } = context;
        const player = state.players[playerId];
        if (!extra) {
          const drawResult = forceDrawAndDiscardShiftCard(state);
          let nextState2 = {
            ...drawResult.state,
            phase: { ...drawResult.state.phase, pendingInterrupt: { type: "ACTION_CARD_EFFECT_CHOICE", sourcePlayerId: playerId, data: { catalogId: "STR_079", choiceType: "STR079_PROTECT_TARGET", cardInstanceId } } }
          };
          return {
            state: appendLog(nextState2, { type: "ACTION_CARD_EFFECT_STR079_AWAITING_CHOICE", playerId, catalogId: "STR_079", drawnShiftCatalogId: drawResult.drawnCatalogId }),
            effectOutcome: DEFAULT_OUTCOME
          };
        }
        const targetEntry = player.roster.find((r) => r.agentInstanceId === extra.targetAgentInstanceId && !r.isVoided);
        let nextState = state;
        if (targetEntry) {
          nextState = {
            ...nextState,
            players: {
              ...nextState.players,
              [playerId]: {
                ...nextState.players[playerId],
                roster: nextState.players[playerId].roster.map((r) => r.agentInstanceId === extra.targetAgentInstanceId ? { ...r, recruitmentProtectedUntilRound: nextState.phase.round } : r)
              }
            }
          };
        }
        nextState = { ...nextState, phase: { ...nextState.phase, pendingInterrupt: { type: "NULL", sourcePlayerId: null, data: {} } } };
        nextState = appendLog(nextState, {
          type: "ACTION_CARD_EFFECT_APPLIED",
          playerId,
          catalogId: "STR_079",
          targetAgentInstanceId: targetEntry ? extra.targetAgentInstanceId : null,
          message: targetEntry ? `${playerId}'s Tech Support protects ${targetEntry.catalogId} from recruitment this turn.` : `${playerId}'s Tech Support had no valid target.`
        });
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleStr080(state, context) {
        const { playerId, cardInstanceId, extra } = context;
        if (!extra) {
          const nextState2 = {
            ...state,
            phase: { ...state.phase, pendingInterrupt: { type: "ACTION_CARD_EFFECT_CHOICE", sourcePlayerId: playerId, data: { catalogId: "STR_080", choiceType: "STR080_RIVAL_TARGET", cardInstanceId } } }
          };
          return {
            state: appendLog(nextState2, { type: "ACTION_CARD_EFFECT_STR080_AWAITING_CHOICE", playerId, catalogId: "STR_080" }),
            effectOutcome: DEFAULT_OUTCOME
          };
        }
        const { targetPlayerId } = extra;
        let nextState = { ...state, phase: { ...state.phase, pendingInterrupt: { type: "NULL", sourcePlayerId: null, data: {} } } };
        let paidAmount = 0;
        if (state.players[targetPlayerId]) {
          paidAmount = Math.min(5, state.players[targetPlayerId].wallet.profitTokens);
          if (paidAmount > 0) {
            nextState = adjustWallet(nextState, targetPlayerId, -paidAmount, 0);
            nextState = adjustWallet(nextState, playerId, paidAmount, 0);
          }
        }
        nextState = appendLog(nextState, {
          type: "ACTION_CARD_EFFECT_APPLIED",
          playerId,
          catalogId: "STR_080",
          targetPlayerId,
          paidAmount,
          message: `${playerId}'s Community Relations collects ${paidAmount} PT from ${targetPlayerId}.`
        });
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleStr085(state, context) {
        const { playerId } = context;
        const player = state.players[playerId];
        const nextState = {
          ...state,
          players: {
            ...state.players,
            [playerId]: { ...player, roster: player.roster.map((r) => r.isVoided ? r : { ...r, recruitmentProtectedUntilRound: state.phase.round }) }
          }
        };
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleStr086(state, context) {
        const { playerId, cardInstanceId, extra } = context;
        if (!extra) {
          const nextState2 = { ...state, phase: { ...state.phase, pendingInterrupt: { type: "ACTION_CARD_EFFECT_CHOICE", sourcePlayerId: playerId, data: { catalogId: "STR_086", choiceType: "STR074_RIVAL_TARGET", cardInstanceId } } } };
          return { state: appendLog(nextState2, { type: "ACTION_CARD_EFFECT_STR086_AWAITING_CHOICE", playerId, catalogId: "STR_086" }), effectOutcome: DEFAULT_OUTCOME };
        }
        const { targetPlayerId } = extra;
        let nextState = { ...state, phase: { ...state.phase, pendingInterrupt: { type: "NULL", sourcePlayerId: null, data: {} } } };
        const target = nextState.players[targetPlayerId];
        if (target) {
          const active = target.timeMeeples.active;
          const idx = active.findIndex((m) => m.status === "in_supply");
          if (idx >= 0) {
            const meeple = active[idx];
            const newTargetActive = active.filter((_, i) => i !== idx);
            const player = nextState.players[playerId];
            nextState = {
              ...nextState,
              players: {
                ...nextState.players,
                [targetPlayerId]: { ...target, timeMeeples: { ...target.timeMeeples, active: newTargetActive } },
                [playerId]: {
                  ...player,
                  timeMeeples: {
                    ...player.timeMeeples,
                    active: [...player.timeMeeples.active, { ...meeple, status: "in_supply", controlledFromPlayerId: targetPlayerId, controlExpiresAfterRound: nextState.phase.round + 1 }]
                  }
                }
              }
            };
          }
        }
        nextState = appendLog(nextState, { type: "ACTION_CARD_EFFECT_APPLIED", playerId, catalogId: "STR_086", targetPlayerId, message: `${playerId}'s Hall of Fame Nomination steals a Time Meeple from ${targetPlayerId}.` });
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleStr088(state, context) {
        const { playerId } = context;
        let nextState = state;
        Object.keys(nextState.players).forEach((pid) => {
          if (pid === playerId) return;
          nextState = { ...nextState, players: { ...nextState.players, [pid]: { ...nextState.players[pid], recruitBannedUntilRound: nextState.phase.round } } };
        });
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleStr090(state, context) {
        const { playerId } = context;
        const drawResult = forceDrawAndDiscardShiftCard(state);
        return { state: drawResult.state, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleStr091(state, context) {
        const { playerId } = context;
        const player = state.players[playerId];
        const agentCatalog = state.cardCatalog && state.cardCatalog.agentCards || {};
        const activeRoster = player.roster.filter((r) => !r.isVoided);
        const targetInstanceId = pickRosterExtremeBy(activeRoster, agentCatalog, "technology", "lowest");
        if (!targetInstanceId) {
          return { state, effectOutcome: DEFAULT_OUTCOME };
        }
        const protectedState = {
          ...state,
          players: {
            ...state.players,
            [playerId]: {
              ...player,
              // Infinity, not the current round: STR_091 grants permanent
              // Unrecruitable status ("Franchise Agreement" has no "this
              // round" qualifier, unlike every round-scoped protection card
              // in this deck) — reusing the exact same enforced
              // recruitmentProtectedUntilRound field (state.phase.round
              // will never exceed Infinity, so the existing round<=check
              // enforces this correctly without new plumbing).
              roster: player.roster.map((r) => r.agentInstanceId === targetInstanceId ? { ...r, recruitmentProtectedUntilRound: Infinity } : r)
            }
          }
        };
        return { state: protectedState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleStr092(state, context) {
        const { playerId, cardInstanceId, extra } = context;
        if (!extra) {
          const nextState2 = { ...state, phase: { ...state.phase, pendingInterrupt: { type: "ACTION_CARD_EFFECT_CHOICE", sourcePlayerId: playerId, data: { catalogId: "STR_092", choiceType: "GRW010_RECRUIT_TARGET", cardInstanceId } } } };
          return { state: appendLog(nextState2, { type: "ACTION_CARD_EFFECT_STR092_AWAITING_CHOICE", playerId, catalogId: "STR_092" }), effectOutcome: DEFAULT_OUTCOME };
        }
        let nextState = adjustTrack(state, playerId, "recognition", 5);
        nextState = { ...nextState, phase: { ...nextState.phase, pendingInterrupt: { type: "NULL", sourcePlayerId: null, data: {} } } };
        if (extra.targetCatalogId) {
          const { recruitOpenMarketAgent: recruit } = getAgentRecruitmentHelpers();
          const result = recruit(nextState, playerId, extra.targetCatalogId);
          if (!result.error) nextState = result.state;
        }
        nextState = appendLog(nextState, { type: "ACTION_CARD_EFFECT_APPLIED", playerId, catalogId: "STR_092", message: `${playerId}'s Public Endorsement grants +5 Recognition.` });
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleStr094(state, context) {
        const { playerId, cardInstanceId, extra } = context;
        if (!extra) {
          const nextState2 = { ...state, phase: { ...state.phase, pendingInterrupt: { type: "ACTION_CARD_EFFECT_CHOICE", sourcePlayerId: playerId, data: { catalogId: "STR_094", choiceType: "STR074_RIVAL_TARGET", cardInstanceId } } } };
          return { state: appendLog(nextState2, { type: "ACTION_CARD_EFFECT_STR094_AWAITING_CHOICE", playerId, catalogId: "STR_094" }), effectOutcome: DEFAULT_OUTCOME };
        }
        const { targetPlayerId } = extra;
        let nextState = { ...state, phase: { ...state.phase, pendingInterrupt: { type: "NULL", sourcePlayerId: null, data: {} } } };
        if (targetPlayerId && nextState.players[targetPlayerId]) {
          nextState = fireAgentBySelector(nextState, targetPlayerId, (roster, cat) => pickRosterExtremeBy(roster, cat, "training", "lowest"), "STR_094");
        }
        nextState = appendLog(nextState, { type: "ACTION_CARD_EFFECT_APPLIED", playerId, catalogId: "STR_094", targetPlayerId, message: `${playerId}'s Agent Audit forces ${targetPlayerId} to fire their lowest-skill Agent.` });
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleStr082(state, context) {
        const { playerId, cardInstanceId, extra } = context;
        if (!extra) {
          const nextState2 = { ...state, phase: { ...state.phase, pendingInterrupt: { type: "ACTION_CARD_EFFECT_CHOICE", sourcePlayerId: playerId, data: { catalogId: "STR_082", choiceType: "STR074_RIVAL_TARGET", cardInstanceId } } } };
          return { state: appendLog(nextState2, { type: "ACTION_CARD_EFFECT_STR082_AWAITING_CHOICE", playerId, catalogId: "STR_082" }), effectOutcome: DEFAULT_OUTCOME };
        }
        const { targetPlayerId } = extra;
        let nextState = { ...state, phase: { ...state.phase, pendingInterrupt: { type: "NULL", sourcePlayerId: null, data: {} } } };
        const agentCatalog = nextState.cardCatalog && nextState.cardCatalog.agentCards || {};
        const ownRoster = nextState.players[playerId].roster.filter((r) => !r.isVoided);
        const bestOwnInstanceId = pickRosterExtremeBy(ownRoster, agentCatalog, "totalProfit", "highest");
        if (bestOwnInstanceId) {
          nextState = { ...nextState, players: { ...nextState.players, [playerId]: { ...nextState.players[playerId], roster: nextState.players[playerId].roster.map((r) => r.agentInstanceId === bestOwnInstanceId ? { ...r, recruitmentProtectedUntilRound: nextState.phase.round } : r) } } };
        }
        if (targetPlayerId && nextState.players[targetPlayerId]) {
          const drawResult = forceDrawAndDiscardShiftCard(nextState);
          nextState = drawResult.state;
        }
        nextState = grantShiftImmunity(nextState, playerId, cardInstanceId);
        nextState = appendLog(nextState, { type: "ACTION_CARD_EFFECT_APPLIED", playerId, catalogId: "STR_082", targetPlayerId, message: `${playerId}'s Office Security protects an Agent, forces ${targetPlayerId} to draw a Shift Card, and grants self Shift immunity.` });
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleStr083(state, context) {
        const { playerId, cardInstanceId, extra } = context;
        if (!extra) {
          const nextState2 = { ...state, phase: { ...state.phase, pendingInterrupt: { type: "ACTION_CARD_EFFECT_CHOICE", sourcePlayerId: playerId, data: { catalogId: "STR_083", choiceType: "STR074_RIVAL_TARGET", cardInstanceId } } } };
          return { state: appendLog(nextState2, { type: "ACTION_CARD_EFFECT_STR083_AWAITING_CHOICE", playerId, catalogId: "STR_083" }), effectOutcome: DEFAULT_OUTCOME };
        }
        const { targetPlayerId } = extra;
        let nextState = { ...state, phase: { ...state.phase, pendingInterrupt: { type: "NULL", sourcePlayerId: null, data: {} } } };
        if (targetPlayerId && nextState.players[targetPlayerId]) {
          const target = nextState.players[targetPlayerId];
          if (target.hand.actionCards.length > 0) {
            const [, ...rest] = target.hand.actionCards;
            nextState = { ...nextState, players: { ...nextState.players, [targetPlayerId]: { ...target, hand: { ...target.hand, actionCards: rest } } } };
          }
        }
        nextState = appendLog(nextState, { type: "ACTION_CARD_EFFECT_APPLIED", playerId, catalogId: "STR_083", targetPlayerId, message: `${playerId}'s Influence Campaign forces ${targetPlayerId} to trash a card.` });
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleStr089(state, context) {
        const { playerId } = context;
        let nextState = adjustMarketShare(state, playerId, 1);
        const drawPile = nextState.board.decks && nextState.board.decks.actionCardDrawPile || [];
        const drawn = drawPile.slice(0, 2);
        const remaining = drawPile.slice(2);
        nextState = { ...nextState, board: { ...nextState.board, decks: { ...nextState.board.decks, actionCardDrawPile: remaining } } };
        if (drawn.length > 0) {
          const catalogActionCards = nextState.cardCatalog.actionCards || {};
          const sorted = [...drawn].sort((a, b) => (catalogActionCards[b] && catalogActionCards[b].cost || 0) - (catalogActionCards[a] && catalogActionCards[a].cost || 0));
          const kept = sorted[0];
          const player = nextState.players[playerId];
          const newCardEntry = { instanceId: `ac-${playerId}-str089-${kept}`, catalogId: kept };
          nextState = { ...nextState, players: { ...nextState.players, [playerId]: { ...player, hand: { ...player.hand, actionCards: [...player.hand.actionCards, newCardEntry] } } } };
        }
        nextState = appendLog(nextState, { type: "ACTION_CARD_EFFECT_APPLIED", playerId, catalogId: "STR_089", message: `${playerId}'s Leadership Retreat draws 2 Action Cards, keeps 1, trashes 1.` });
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleStr093(state, context) {
        const { playerId, cardInstanceId, extra } = context;
        if (!extra || !extra.firstTargetPlayerId) {
          const nextState2 = { ...state, phase: { ...state.phase, pendingInterrupt: { type: "ACTION_CARD_EFFECT_CHOICE", sourcePlayerId: playerId, data: { catalogId: "STR_093", choiceType: "STR074_RIVAL_TARGET", cardInstanceId, stage: "first" } } } };
          return { state: appendLog(nextState2, { type: "ACTION_CARD_EFFECT_STR093_AWAITING_FIRST_CHOICE", playerId, catalogId: "STR_093" }), effectOutcome: DEFAULT_OUTCOME };
        }
        if (!extra.secondTargetPlayerId) {
          let nextState2 = adjustOfficeSlots(state, extra.firstTargetPlayerId, -1);
          nextState2 = {
            ...nextState2,
            phase: {
              ...nextState2.phase,
              pendingInterrupt: { type: "ACTION_CARD_EFFECT_CHOICE", sourcePlayerId: playerId, data: { catalogId: "STR_093", choiceType: "STR074_RIVAL_TARGET", cardInstanceId, stage: "second", firstTargetPlayerId: extra.firstTargetPlayerId } }
            }
          };
          return { state: appendLog(nextState2, { type: "ACTION_CARD_EFFECT_STR093_FIRST_APPLIED", playerId, catalogId: "STR_093", targetPlayerId: extra.firstTargetPlayerId }), effectOutcome: DEFAULT_OUTCOME };
        }
        let nextState = extra.secondTargetPlayerId !== extra.firstTargetPlayerId ? adjustOfficeSlots(state, extra.secondTargetPlayerId, -1) : state;
        nextState = adjustOfficeSlots(nextState, playerId, 2);
        nextState = { ...nextState, phase: { ...nextState.phase, pendingInterrupt: { type: "NULL", sourcePlayerId: null, data: {} } } };
        nextState = appendLog(nextState, { type: "ACTION_CARD_EFFECT_APPLIED", playerId, catalogId: "STR_093", firstTargetPlayerId: extra.firstTargetPlayerId, secondTargetPlayerId: extra.secondTargetPlayerId, message: `${playerId}'s Lobbying Effort reduces 2 rivals' Office space and gains +2 Office space.` });
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      module.exports = {
        handleStr070,
        handleStr071,
        handleStr072,
        handleStr073,
        handleStr074,
        handleStr075,
        handleStr076,
        handleStr077,
        handleStr078,
        handleStr079,
        handleStr080,
        handleStr085,
        handleStr086,
        handleStr088,
        handleStr090,
        handleStr091,
        handleStr092,
        handleStr094,
        handleStr082,
        handleStr083,
        handleStr089,
        handleStr093
      };
    }
  });

  // handlers/actionCards/influence.js
  var require_influence = __commonJS({
    "handlers/actionCards/influence.js"(exports, module) {
      var { adjustTrack, adjustWallet, adjustOfficeSlots, fireAgentBySelector, pickRosterExtremeBy } = require_cardEffectHelpers();
      var { grantShiftImmunity } = require_immunityReducer();
      function getAgentRecruitmentHelpers() {
        return require_agentRecruitmentReducer();
      }
      var DEFAULT_OUTCOME = { skipDefaultDiscard: false, customDestination: null };
      function forceDrawAndDiscardShiftCard(state) {
        let drawPile = state.shiftDeck.drawPile;
        let discardPile = state.shiftDeck.discardPile;
        if (drawPile.length === 0 && discardPile.length > 0) {
          drawPile = [...discardPile];
          discardPile = [];
        }
        if (drawPile.length === 0) {
          return { state, drawnCatalogId: null };
        }
        const drawnCatalogId = drawPile[0].catalogId;
        const nextState = {
          ...state,
          shiftDeck: { drawPile: drawPile.slice(1), discardPile: [...discardPile, drawPile[0]] }
        };
        return { state: nextState, drawnCatalogId };
      }
      function getNextOpponentId(state, playerId) {
        const turnOrder = state.phase.turnOrder || [];
        const idx = turnOrder.indexOf(playerId);
        if (idx === -1) return null;
        for (let step = 1; step <= turnOrder.length; step += 1) {
          const candidateId = turnOrder[(idx + step) % turnOrder.length];
          if (candidateId !== playerId) {
            return candidateId;
          }
        }
        return null;
      }
      function appendLog(state, entry) {
        const logEntry = {
          seq: state.log.length + 1,
          timestamp: (/* @__PURE__ */ new Date()).toISOString(),
          round: state.phase.round,
          ...entry
        };
        return { ...state, log: [...state.log, logEntry] };
      }
      function resolveTarget(state, playerId, extra) {
        const usedDefaultTarget = !(extra && extra.targetPlayerId);
        const targetPlayerId = extra && extra.targetPlayerId || getNextOpponentId(state, playerId);
        return { targetPlayerId, usedDefaultTarget };
      }
      function handleInf096(state, context) {
        const { playerId, extra } = context;
        const { targetPlayerId, usedDefaultTarget } = resolveTarget(state, playerId, extra);
        if (!targetPlayerId || !state.players[targetPlayerId]) {
          return {
            state: appendLog(state, {
              type: "ACTION_CARD_EFFECT_COLD_CALLING_BLITZ_SKIPPED",
              playerId,
              catalogId: "INF_096",
              reason: "NO_VALID_TARGET"
            }),
            effectOutcome: DEFAULT_OUTCOME
          };
        }
        let nextState = adjustTrack(state, targetPlayerId, "training", -2);
        nextState = appendLog(nextState, {
          type: "ACTION_CARD_EFFECT_COLD_CALLING_BLITZ",
          playerId,
          catalogId: "INF_096",
          targetPlayerId,
          trainingDelta: -2,
          usedDefaultTarget,
          message: `${playerId} forces ${targetPlayerId} to reduce Training by 2 (Cold Calling Blitz).`
        });
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleInf111(state, context) {
        const { playerId, extra } = context;
        const { targetPlayerId, usedDefaultTarget } = resolveTarget(state, playerId, extra);
        if (!targetPlayerId || !state.players[targetPlayerId]) {
          return {
            state: appendLog(state, {
              type: "ACTION_CARD_EFFECT_CORPORATE_ESPIONAGE_SKIPPED",
              playerId,
              catalogId: "INF_111",
              reason: "NO_VALID_TARGET"
            }),
            effectOutcome: DEFAULT_OUTCOME
          };
        }
        const target = state.players[targetPlayerId];
        let nextState = state;
        let discardedCard = null;
        if (target.hand.actionCards.length === 0) {
          nextState = appendLog(nextState, {
            type: "ACTION_CARD_EFFECT_CORPORATE_ESPIONAGE_DISCARD_WASTED",
            playerId,
            catalogId: "INF_111",
            targetPlayerId,
            reason: "TARGET_HAND_EMPTY"
          });
        } else {
          discardedCard = target.hand.actionCards[0];
          const remainingHand = target.hand.actionCards.slice(1);
          nextState = {
            ...nextState,
            players: {
              ...nextState.players,
              [targetPlayerId]: {
                ...target,
                hand: {
                  ...target.hand,
                  actionCards: remainingHand,
                  personalDiscardPile: [...target.hand.personalDiscardPile, discardedCard]
                }
              }
            }
          };
          nextState = appendLog(nextState, {
            type: "ACTION_CARD_EFFECT_CORPORATE_ESPIONAGE_DISCARD",
            playerId,
            catalogId: "INF_111",
            targetPlayerId,
            discardedInstanceId: discardedCard.instanceId,
            discardedCatalogId: discardedCard.catalogId,
            message: `${playerId} views ${targetPlayerId}'s hand and forces a discard (Corporate Espionage).`
          });
        }
        const shiftDeck = nextState.shiftDeck;
        if (shiftDeck && shiftDeck.drawPile && shiftDeck.drawPile.length > 0) {
          const drawnCard = shiftDeck.drawPile[0];
          nextState = {
            ...nextState,
            shiftDeck: {
              ...shiftDeck,
              drawPile: shiftDeck.drawPile.slice(1),
              discardPile: [...shiftDeck.discardPile, drawnCard.catalogId]
            }
          };
          nextState = appendLog(nextState, {
            type: "ACTION_CARD_EFFECT_CORPORATE_ESPIONAGE_SHIFT_DRAW_DEFERRED",
            playerId,
            catalogId: "INF_111",
            targetPlayerId,
            drawnShiftCatalogId: drawnCard.catalogId,
            reason: "SINGLE_TARGET_SHIFT_APPLICATION_NOT_SUPPORTED",
            message: `${targetPlayerId} draws Shift Card ${drawnCard.catalogId} (Corporate Espionage) \u2014 deck state updated, but its single-target effect application is not yet supported by this engine and was NOT applied.`
          });
        } else {
          nextState = appendLog(nextState, {
            type: "ACTION_CARD_EFFECT_CORPORATE_ESPIONAGE_SHIFT_DRAW_SKIPPED",
            playerId,
            catalogId: "INF_111",
            targetPlayerId,
            reason: "NO_SHIFT_DECK_OR_EMPTY"
          });
        }
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleInf095(state, context) {
        const { playerId, extra } = context;
        const { targetPlayerId, usedDefaultTarget } = resolveTarget(state, playerId, extra);
        if (!targetPlayerId || !state.players[targetPlayerId]) {
          return { state: appendLog(state, { type: "ACTION_CARD_EFFECT_MARKET_RUMORS_SKIPPED", playerId, catalogId: "INF_095", reason: "NO_VALID_TARGET" }), effectOutcome: DEFAULT_OUTCOME };
        }
        const target = state.players[targetPlayerId];
        let nextState = state;
        if (target.hand.actionCards.length > 0) {
          const [, ...rest] = target.hand.actionCards;
          nextState = { ...nextState, players: { ...nextState.players, [targetPlayerId]: { ...target, hand: { ...target.hand, actionCards: rest } } } };
        }
        nextState = appendLog(nextState, { type: "ACTION_CARD_EFFECT_MARKET_RUMORS", playerId, catalogId: "INF_095", targetPlayerId, usedDefaultTarget, message: `${playerId}'s Market Rumors forces ${targetPlayerId} to trash a card from hand.` });
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleInf097(state, context) {
        const { playerId, extra } = context;
        const { targetPlayerId, usedDefaultTarget } = resolveTarget(state, playerId, extra);
        if (!targetPlayerId || !state.players[targetPlayerId]) {
          return { state: appendLog(state, { type: "ACTION_CARD_EFFECT_RE_DIVISION_COMPLAINT_SKIPPED", playerId, catalogId: "INF_097", reason: "NO_VALID_TARGET" }), effectOutcome: DEFAULT_OUTCOME };
        }
        let nextState = adjustTrack(state, targetPlayerId, "recognition", -2);
        nextState = appendLog(nextState, { type: "ACTION_CARD_EFFECT_RE_DIVISION_COMPLAINT", playerId, catalogId: "INF_097", targetPlayerId, usedDefaultTarget, message: `${playerId} forces ${targetPlayerId} to reduce Recognition by 2.` });
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleInf099(state, context) {
        const { playerId, extra } = context;
        const { targetPlayerId, usedDefaultTarget } = resolveTarget(state, playerId, extra);
        if (!targetPlayerId || !state.players[targetPlayerId]) {
          return { state: appendLog(state, { type: "ACTION_CARD_EFFECT_OFFICE_DISRUPTION_SKIPPED", playerId, catalogId: "INF_099", reason: "NO_VALID_TARGET" }), effectOutcome: DEFAULT_OUTCOME };
        }
        const target = state.players[targetPlayerId];
        const active = target.timeMeeples.active;
        const idx = active.findIndex((m) => m.status === "in_supply");
        let nextState = state;
        if (idx >= 0) {
          const newActive = active.filter((_, i) => i !== idx);
          nextState = { ...state, players: { ...state.players, [targetPlayerId]: { ...target, timeMeeples: { ...target.timeMeeples, active: newActive } } } };
        }
        nextState = appendLog(nextState, { type: "ACTION_CARD_EFFECT_OFFICE_DISRUPTION", playerId, catalogId: "INF_099", targetPlayerId, usedDefaultTarget, message: `${playerId}'s Office Disruption removes a Time Meeple from ${targetPlayerId}.` });
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleInf100(state, context) {
        const { playerId, extra } = context;
        const { targetPlayerId, usedDefaultTarget } = resolveTarget(state, playerId, extra);
        if (!targetPlayerId || !state.players[targetPlayerId]) {
          return { state: appendLog(state, { type: "ACTION_CARD_EFFECT_AGENT_DISCONTENT_SKIPPED", playerId, catalogId: "INF_100", reason: "NO_VALID_TARGET" }), effectOutcome: DEFAULT_OUTCOME };
        }
        const drawResult = forceDrawAndDiscardShiftCard(state);
        const nextState = appendLog(drawResult.state, { type: "ACTION_CARD_EFFECT_AGENT_DISCONTENT_SHIFT_DRAWN", playerId, catalogId: "INF_100", targetPlayerId, usedDefaultTarget, drawnCatalogId: drawResult.drawnCatalogId, message: `${targetPlayerId} draws Shift Card ${drawResult.drawnCatalogId || "(deck empty)"} (Agent Discontent) \u2014 its single-target effect is not applied by this engine.` });
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleInf103(state, context) {
        const { playerId, extra } = context;
        const { targetPlayerId, usedDefaultTarget } = resolveTarget(state, playerId, extra);
        if (!targetPlayerId || !state.players[targetPlayerId]) {
          return { state: appendLog(state, { type: "ACTION_CARD_EFFECT_NEGATIVE_RECRUITING_SKIPPED", playerId, catalogId: "INF_103", reason: "NO_VALID_TARGET" }), effectOutcome: DEFAULT_OUTCOME };
        }
        const drawResult = forceDrawAndDiscardShiftCard(state);
        const nextState = appendLog(drawResult.state, { type: "ACTION_CARD_EFFECT_NEGATIVE_RECRUITING_SHIFT_DRAWN", playerId, catalogId: "INF_103", targetPlayerId, usedDefaultTarget, drawnCatalogId: drawResult.drawnCatalogId, message: `${targetPlayerId} draws Shift Card ${drawResult.drawnCatalogId || "(deck empty)"} (Negative Recruiting) \u2014 its single-target effect is not applied by this engine.` });
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleInf105(state, context) {
        const { playerId, extra } = context;
        const { targetPlayerId, usedDefaultTarget } = resolveTarget(state, playerId, extra);
        if (!targetPlayerId || !state.players[targetPlayerId]) {
          return { state: appendLog(state, { type: "ACTION_CARD_EFFECT_MARKET_SATURATION_SKIPPED", playerId, catalogId: "INF_105", reason: "NO_VALID_TARGET" }), effectOutcome: DEFAULT_OUTCOME };
        }
        let nextState = adjustOfficeSlots(state, targetPlayerId, -1);
        nextState = adjustOfficeSlots(nextState, playerId, 1);
        nextState = appendLog(nextState, { type: "ACTION_CARD_EFFECT_MARKET_SATURATION", playerId, catalogId: "INF_105", targetPlayerId, usedDefaultTarget, message: `${playerId}'s Market Saturation shifts an Office space from ${targetPlayerId}.` });
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleInf107(state, context) {
        const { playerId } = context;
        const agentCatalog = state.cardCatalog && state.cardCatalog.agentCards || {};
        let nextState = state;
        Object.keys(nextState.players).forEach((pid) => {
          if (pid === playerId) return;
          let target = nextState.players[pid];
          const toFire = target.roster.filter((r) => !r.isVoided && agentCatalog[r.catalogId] && agentCatalog[r.catalogId].training === 3);
          toFire.forEach((entry) => {
            nextState = fireAgentBySelector(nextState, pid, () => entry.agentInstanceId, "INF_107");
          });
        });
        nextState = appendLog(nextState, { type: "ACTION_CARD_EFFECT_EXCLUSIVE_TRAINING", playerId, catalogId: "INF_107", message: `${playerId}'s Exclusive Training fires every rival Agent with Training 3.` });
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleInf108(state, context) {
        const { playerId, extra } = context;
        const { targetPlayerId, usedDefaultTarget } = resolveTarget(state, playerId, extra);
        if (!targetPlayerId || !state.players[targetPlayerId]) {
          return { state: appendLog(state, { type: "ACTION_CARD_EFFECT_TECH_SABOTAGE_SKIPPED", playerId, catalogId: "INF_108", reason: "NO_VALID_TARGET" }), effectOutcome: DEFAULT_OUTCOME };
        }
        const nextState = fireAgentBySelector(state, targetPlayerId, (roster, cat) => pickRosterExtremeBy(roster, cat, "technology", "lowest"), "INF_108");
        return { state: appendLog(nextState, { type: "ACTION_CARD_EFFECT_TECH_SABOTAGE", playerId, catalogId: "INF_108", targetPlayerId, usedDefaultTarget, message: `${playerId}'s Tech Sabotage fires ${targetPlayerId}'s lowest-Technology Agent.` }), effectOutcome: DEFAULT_OUTCOME };
      }
      function handleInf110(state, context) {
        const { playerId, extra } = context;
        const { targetPlayerId, usedDefaultTarget } = resolveTarget(state, playerId, extra);
        if (!targetPlayerId || !state.players[targetPlayerId]) {
          return { state: appendLog(state, { type: "ACTION_CARD_EFFECT_TEAM_SPLIT_SKIPPED", playerId, catalogId: "INF_110", reason: "NO_VALID_TARGET" }), effectOutcome: DEFAULT_OUTCOME };
        }
        const agentCatalog = state.cardCatalog && state.cardCatalog.agentCards || {};
        const targetRoster = state.players[targetPlayerId].roster.filter((r) => !r.isVoided);
        const bestInstanceId = pickRosterExtremeBy(targetRoster, agentCatalog, "totalProfit", "highest");
        let nextState = state;
        if (bestInstanceId) {
          const { poachCompetingBrokerAgent: poach } = getAgentRecruitmentHelpers();
          const result = poach(nextState, playerId, targetPlayerId, bestInstanceId);
          if (!result.error) nextState = result.state;
        }
        const drawResult = forceDrawAndDiscardShiftCard(nextState);
        nextState = appendLog(drawResult.state, { type: "ACTION_CARD_EFFECT_TEAM_SPLIT", playerId, catalogId: "INF_110", targetPlayerId, usedDefaultTarget, drawnCatalogId: drawResult.drawnCatalogId, message: `${playerId}'s Team Split targets ${targetPlayerId}'s highest-profit Agent and draws a Shift Card.` });
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleInf113(state, context) {
        const { playerId, extra } = context;
        const { targetPlayerId, usedDefaultTarget } = resolveTarget(state, playerId, extra);
        if (!targetPlayerId || !state.players[targetPlayerId]) {
          return { state: appendLog(state, { type: "ACTION_CARD_EFFECT_MARKET_KINGPIN_SKIPPED", playerId, catalogId: "INF_113", reason: "NO_VALID_TARGET" }), effectOutcome: DEFAULT_OUTCOME };
        }
        const agentCatalog = state.cardCatalog && state.cardCatalog.agentCards || {};
        const targetRoster = state.players[targetPlayerId].roster.filter((r) => !r.isVoided);
        const bestInstanceId = pickRosterExtremeBy(targetRoster, agentCatalog, "totalProfit", "highest");
        let nextState = state;
        if (bestInstanceId) {
          const { poachCompetingBrokerAgent: poach } = getAgentRecruitmentHelpers();
          const result = poach(nextState, playerId, targetPlayerId, bestInstanceId);
          if (!result.error) nextState = result.state;
        }
        const drawResult = forceDrawAndDiscardShiftCard(nextState);
        nextState = appendLog(drawResult.state, { type: "ACTION_CARD_EFFECT_MARKET_KINGPIN", playerId, catalogId: "INF_113", targetPlayerId, usedDefaultTarget, drawnCatalogId: drawResult.drawnCatalogId, message: `${playerId}'s Market Kingpin takes ${targetPlayerId}'s highest-profit Agent and draws a Shift Card.` });
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleInf114(state, context) {
        const { playerId, extra } = context;
        const { targetPlayerId, usedDefaultTarget } = resolveTarget(state, playerId, extra);
        if (!targetPlayerId || !state.players[targetPlayerId]) {
          return { state: appendLog(state, { type: "ACTION_CARD_EFFECT_DISBANDING_AGENCY_SKIPPED", playerId, catalogId: "INF_114", reason: "NO_VALID_TARGET" }), effectOutcome: DEFAULT_OUTCOME };
        }
        const nextState = fireAgentBySelector(state, targetPlayerId, (roster, cat) => pickRosterExtremeBy(roster, cat, "training", "lowest"), "INF_114");
        return { state: appendLog(nextState, { type: "ACTION_CARD_EFFECT_DISBANDING_AGENCY", playerId, catalogId: "INF_114", targetPlayerId, usedDefaultTarget, message: `${playerId}'s Disbanding Agency fires ${targetPlayerId}'s lowest-skill Agent.` }), effectOutcome: DEFAULT_OUTCOME };
      }
      function handleInf102(state, context) {
        const { playerId, extra } = context;
        const { targetPlayerId, usedDefaultTarget } = resolveTarget(state, playerId, extra);
        if (!targetPlayerId || !state.players[targetPlayerId]) {
          return { state: appendLog(state, { type: "ACTION_CARD_EFFECT_HOSTILE_TAKEOVER_SKIPPED", playerId, catalogId: "INF_102", reason: "NO_VALID_TARGET" }), effectOutcome: DEFAULT_OUTCOME };
        }
        const agentCatalog = state.cardCatalog && state.cardCatalog.agentCards || {};
        const targetRoster = state.players[targetPlayerId].roster.filter((r) => !r.isVoided);
        const bestInstanceId = pickRosterExtremeBy(targetRoster, agentCatalog, "totalProfit", "highest");
        let nextState = state;
        if (bestInstanceId) {
          const { poachCompetingBrokerAgent: poach } = getAgentRecruitmentHelpers();
          const result = poach(nextState, playerId, targetPlayerId, bestInstanceId);
          if (!result.error) nextState = result.state;
        }
        const drawResult = forceDrawAndDiscardShiftCard(nextState);
        nextState = appendLog(drawResult.state, { type: "ACTION_CARD_EFFECT_HOSTILE_TAKEOVER", playerId, catalogId: "INF_102", targetPlayerId, usedDefaultTarget, drawnCatalogId: drawResult.drawnCatalogId, message: `${playerId}'s Hostile Takeover targets ${targetPlayerId} and draws a Shift Card.` });
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleInf109(state, context) {
        const { playerId, extra } = context;
        const { targetPlayerId, usedDefaultTarget } = resolveTarget(state, playerId, extra);
        if (!targetPlayerId || !state.players[targetPlayerId]) {
          return { state: appendLog(state, { type: "ACTION_CARD_EFFECT_RECRUIT_MEGA_AGENT_SKIPPED", playerId, catalogId: "INF_109", reason: "NO_VALID_TARGET" }), effectOutcome: DEFAULT_OUTCOME };
        }
        const agentCatalog = state.cardCatalog && state.cardCatalog.agentCards || {};
        const targetRoster = state.players[targetPlayerId].roster.filter((r) => !r.isVoided);
        const bestInstanceId = pickRosterExtremeBy(targetRoster, agentCatalog, "totalProfit", "highest");
        let nextState = state;
        if (bestInstanceId) {
          const { poachCompetingBrokerAgent: poach } = getAgentRecruitmentHelpers();
          const result = poach(nextState, playerId, targetPlayerId, bestInstanceId);
          if (!result.error) nextState = result.state;
        }
        nextState = appendLog(nextState, { type: "ACTION_CARD_EFFECT_RECRUIT_MEGA_AGENT", playerId, catalogId: "INF_109", targetPlayerId, usedDefaultTarget, message: `${playerId}'s Recruit a Mega Agent targets ${targetPlayerId}'s highest-profit Agent.` });
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleInf104(state, context) {
        const { playerId } = context;
        const agentCatalog = state.cardCatalog && state.cardCatalog.agentCards || {};
        const market = state.board.openMarketAgents || [];
        let bestCatalogId = null;
        let bestValue = -1;
        market.forEach((m) => {
          const v = agentCatalog[m.catalogId] && agentCatalog[m.catalogId].totalProfit || 0;
          if (v > bestValue) {
            bestValue = v;
            bestCatalogId = m.catalogId;
          }
        });
        let nextState = state;
        if (bestCatalogId) {
          const { recruitOpenMarketAgent: recruit } = getAgentRecruitmentHelpers();
          const result = recruit(nextState, playerId, bestCatalogId);
          if (!result.error) nextState = result.state;
        }
        nextState = appendLog(nextState, { type: "ACTION_CARD_EFFECT_COMPETITIVE_OFFER", playerId, catalogId: "INF_104", message: `${playerId}'s Competitive Offer targets the Open Market's highest-profit Agent.` });
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleInf098(state, context) {
        const { playerId, extra } = context;
        const { targetPlayerId, usedDefaultTarget } = resolveTarget(state, playerId, extra);
        if (!targetPlayerId || !state.players[targetPlayerId]) {
          return { state: appendLog(state, { type: "ACTION_CARD_EFFECT_FEE_REDUCTION_SKIPPED", playerId, catalogId: "INF_098", reason: "NO_VALID_TARGET" }), effectOutcome: DEFAULT_OUTCOME };
        }
        const agentCatalog = state.cardCatalog && state.cardCatalog.agentCards || {};
        const targetRoster = state.players[targetPlayerId].roster.filter((r) => !r.isVoided);
        const bestInstanceId = pickRosterExtremeBy(targetRoster, agentCatalog, "totalProfit", "highest");
        let nextState = state;
        if (bestInstanceId) {
          const { poachCompetingBrokerAgent: poach } = getAgentRecruitmentHelpers();
          const result = poach(nextState, playerId, targetPlayerId, bestInstanceId);
          if (!result.error) nextState = result.state;
        }
        nextState = appendLog(nextState, { type: "ACTION_CARD_EFFECT_FEE_REDUCTION", playerId, catalogId: "INF_098", targetPlayerId, usedDefaultTarget, message: `${playerId}'s Fee Reduction recruits from ${targetPlayerId}'s roster (block option not simulated).` });
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleInf101(state, context) {
        const { playerId, extra } = context;
        const { targetPlayerId, usedDefaultTarget } = resolveTarget(state, playerId, extra);
        if (!targetPlayerId || !state.players[targetPlayerId]) {
          return { state: appendLog(state, { type: "ACTION_CARD_EFFECT_SPYWARE_SKIPPED", playerId, catalogId: "INF_101", reason: "NO_VALID_TARGET" }), effectOutcome: DEFAULT_OUTCOME };
        }
        const target = state.players[targetPlayerId];
        const trashCount = Math.min(2, target.hand.actionCards.length);
        const remaining = target.hand.actionCards.slice(trashCount);
        const nextState = appendLog(
          { ...state, players: { ...state.players, [targetPlayerId]: { ...target, hand: { ...target.hand, actionCards: remaining } } } },
          { type: "ACTION_CARD_EFFECT_SPYWARE", playerId, catalogId: "INF_101", targetPlayerId, usedDefaultTarget, trashedCount: trashCount, message: `${playerId}'s Spyware forces ${targetPlayerId} to trash ${trashCount} card(s).` }
        );
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleInf106(state, context) {
        const { playerId, cardInstanceId } = context;
        const eligibleRivals = Object.keys(state.players).filter((pid) => pid !== playerId && state.players[pid].tracks.training.value <= 4);
        const agentCatalog = state.cardCatalog && state.cardCatalog.agentCards || {};
        const market = state.board.openMarketAgents || [];
        let bestCatalogId = null;
        let bestValue = -1;
        market.forEach((m) => {
          const v = agentCatalog[m.catalogId] && agentCatalog[m.catalogId].totalProfit || 0;
          if (v > bestValue) {
            bestValue = v;
            bestCatalogId = m.catalogId;
          }
        });
        let nextState = state;
        if (bestCatalogId) {
          const { recruitOpenMarketAgent: recruit } = getAgentRecruitmentHelpers();
          const result = recruit(nextState, playerId, bestCatalogId);
          if (!result.error) nextState = result.state;
        }
        const targetPlayerId = eligibleRivals[0] || null;
        if (targetPlayerId) {
          const drawResult = forceDrawAndDiscardShiftCard(nextState);
          nextState = drawResult.state;
        }
        nextState = grantShiftImmunity(nextState, playerId, cardInstanceId);
        nextState = appendLog(nextState, { type: "ACTION_CARD_EFFECT_VULNERABLE_AGENT", playerId, catalogId: "INF_106", targetPlayerId, message: `${playerId}'s Vulnerable Agent recruits from the Open Market for free, ${targetPlayerId || "no eligible rival"} draws a Shift Card, and self gains Shift immunity.` });
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleInf112(state, context) {
        const { playerId, extra } = context;
        const { targetPlayerId, usedDefaultTarget } = resolveTarget(state, playerId, extra);
        if (!targetPlayerId || !state.players[targetPlayerId]) {
          return { state: appendLog(state, { type: "ACTION_CARD_EFFECT_FORCED_MERGER_SKIPPED", playerId, catalogId: "INF_112", reason: "NO_VALID_TARGET" }), effectOutcome: DEFAULT_OUTCOME };
        }
        const agentCatalog = state.cardCatalog && state.cardCatalog.agentCards || {};
        let nextState = state;
        const { poachCompetingBrokerAgent: poach } = getAgentRecruitmentHelpers();
        for (let i = 0; i < 2; i += 1) {
          const targetRoster = nextState.players[targetPlayerId].roster.filter((r) => !r.isVoided);
          const bestInstanceId = pickRosterExtremeBy(targetRoster, agentCatalog, "totalProfit", "highest");
          if (!bestInstanceId) break;
          const result = poach(nextState, playerId, targetPlayerId, bestInstanceId);
          if (result.error) break;
          nextState = result.state;
        }
        const drawResult = forceDrawAndDiscardShiftCard(nextState);
        nextState = appendLog(drawResult.state, { type: "ACTION_CARD_EFFECT_FORCED_MERGER", playerId, catalogId: "INF_112", targetPlayerId, usedDefaultTarget, drawnCatalogId: drawResult.drawnCatalogId, message: `${playerId}'s Forced Merger recruits up to 2 Agents from ${targetPlayerId} and draws a Shift Card.` });
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      module.exports = {
        handleInf096,
        handleInf111,
        handleInf095,
        handleInf097,
        handleInf099,
        handleInf100,
        handleInf103,
        handleInf105,
        handleInf107,
        handleInf108,
        handleInf110,
        handleInf113,
        handleInf114,
        handleInf102,
        handleInf109,
        handleInf104,
        handleInf098,
        handleInf101,
        handleInf106,
        handleInf112
      };
    }
  });

  // handlers/actionCards/start.js
  var require_start = __commonJS({
    "handlers/actionCards/start.js"(exports, module) {
      var { adjustWallet, adjustTrack, adjustOfficeSlots } = require_cardEffectHelpers();
      var DEFAULT_OUTCOME = { skipDefaultDiscard: false, customDestination: null };
      var LEVELED_TRACKS = /* @__PURE__ */ new Set(["training", "technology", "recognition"]);
      function appendLog(state, entry) {
        return {
          ...state,
          log: [...state.log, { seq: state.log.length + 1, timestamp: (/* @__PURE__ */ new Date()).toISOString(), round: state.phase.round, ...entry }]
        };
      }
      function drawFromSharedActionCardDeck(state, playerId, count) {
        const drawPile = state.board && state.board.decks && state.board.decks.actionCardDrawPile || [];
        const drawCount = Math.min(count, drawPile.length);
        const drawnCatalogIds = drawPile.slice(0, drawCount);
        const remainingDrawPile = drawPile.slice(drawCount);
        const player = state.players[playerId];
        const newCards = drawnCatalogIds.map((catalogId, i) => ({ instanceId: `ac-${playerId}-startacquire-r${state.phase.round}-${i}`, catalogId }));
        const availableHandSlots = Math.max(0, player.hand.maxHandSize - player.hand.actionCards.length);
        const toHand = newCards.slice(0, availableHandSlots);
        const toDiscard = newCards.slice(availableHandSlots);
        return {
          ...state,
          board: { ...state.board, decks: { ...state.board.decks, actionCardDrawPile: remainingDrawPile } },
          players: {
            ...state.players,
            [playerId]: {
              ...player,
              hand: {
                ...player.hand,
                actionCards: [...player.hand.actionCards, ...toHand],
                personalDiscardPile: [...player.hand.personalDiscardPile, ...toDiscard]
              }
            }
          },
          drawnCount: drawCount,
          drawnToHandCount: toHand.length,
          drawnToDiscardCount: toDiscard.length
        };
      }
      function handleS1(state, context) {
        const { playerId, cardInstanceId, extra } = context;
        const player = state.players[playerId];
        if (!extra || !Array.isArray(extra.discardInstanceIds)) {
          const nextState2 = {
            ...state,
            phase: {
              ...state.phase,
              pendingInterrupt: {
                type: "ACTION_CARD_EFFECT_CHOICE",
                sourcePlayerId: playerId,
                data: { catalogId: "S1", choiceType: "S1_DISCARD_FOR_TRACKS", cardInstanceId }
              }
            }
          };
          return {
            state: appendLog(nextState2, { type: "ACTION_CARD_EFFECT_S1_AWAITING_CHOICE", playerId, catalogId: "S1" }),
            effectOutcome: DEFAULT_OUTCOME
          };
        }
        const discardIds = extra.discardInstanceIds.filter((id) => player.hand.actionCards.some((c) => c.instanceId === id)).slice(0, 2);
        const trackChoices = (extra.trackChoices || []).filter((t) => LEVELED_TRACKS.has(t)).slice(0, discardIds.length);
        const discardedCards = player.hand.actionCards.filter((c) => discardIds.includes(c.instanceId));
        let nextState = {
          ...state,
          players: {
            ...state.players,
            [playerId]: {
              ...player,
              hand: {
                ...player.hand,
                actionCards: player.hand.actionCards.filter((c) => !discardIds.includes(c.instanceId)),
                personalDiscardPile: [...player.hand.personalDiscardPile, ...discardedCards]
              }
            }
          },
          phase: { ...state.phase, pendingInterrupt: { type: "NULL", sourcePlayerId: null, data: {} } }
        };
        trackChoices.forEach((trackName) => {
          nextState = adjustTrack(nextState, playerId, trackName, 1);
        });
        nextState = appendLog(nextState, {
          type: "ACTION_CARD_EFFECT_APPLIED",
          playerId,
          catalogId: "S1",
          discardedCount: discardIds.length,
          trackChoices,
          message: `${playerId} discards ${discardIds.length} card(s) via New Year Strategic Planning, raising ${trackChoices.join(", ") || "no tracks"}.`
        });
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleS2(state, context) {
        const { playerId, cardInstanceId, extra } = context;
        if (!extra || !Array.isArray(extra.trackChoices) || extra.trackChoices.length === 0) {
          const nextState2 = {
            ...state,
            phase: {
              ...state.phase,
              pendingInterrupt: {
                type: "ACTION_CARD_EFFECT_CHOICE",
                sourcePlayerId: playerId,
                data: { catalogId: "S2", choiceType: "S2_TRIPLE_TRACK_BOOST", cardInstanceId, requiredCount: 3 }
              }
            }
          };
          return {
            state: appendLog(nextState2, { type: "ACTION_CARD_EFFECT_S2_AWAITING_CHOICE", playerId, catalogId: "S2" }),
            effectOutcome: DEFAULT_OUTCOME
          };
        }
        const trackChoices = extra.trackChoices.filter((t) => LEVELED_TRACKS.has(t)).slice(0, 3);
        let nextState = { ...state, phase: { ...state.phase, pendingInterrupt: { type: "NULL", sourcePlayerId: null, data: {} } } };
        trackChoices.forEach((trackName) => {
          nextState = adjustTrack(nextState, playerId, trackName, 1);
        });
        nextState = appendLog(nextState, {
          type: "ACTION_CARD_EFFECT_APPLIED",
          playerId,
          catalogId: "S2",
          trackChoices,
          message: `${playerId}'s Talent Management raises ${trackChoices.join(", ")}.`
        });
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleS3(state, context) {
        const { playerId, cardInstanceId, extra } = context;
        if (!extra || !Array.isArray(extra.trackChoices) || extra.trackChoices.length === 0) {
          let nextState2 = adjustWallet(state, playerId, 2, 0);
          nextState2 = {
            ...nextState2,
            phase: {
              ...nextState2.phase,
              pendingInterrupt: {
                type: "ACTION_CARD_EFFECT_CHOICE",
                sourcePlayerId: playerId,
                data: { catalogId: "S3", choiceType: "S3_DOUBLE_TRACK_BOOST", cardInstanceId, requiredCount: 2 }
              }
            }
          };
          return {
            state: appendLog(nextState2, { type: "ACTION_CARD_EFFECT_S3_AWAITING_CHOICE", playerId, catalogId: "S3" }),
            effectOutcome: DEFAULT_OUTCOME
          };
        }
        const trackChoices = extra.trackChoices.filter((t) => LEVELED_TRACKS.has(t)).slice(0, 2);
        let nextState = { ...state, phase: { ...state.phase, pendingInterrupt: { type: "NULL", sourcePlayerId: null, data: {} } } };
        trackChoices.forEach((trackName) => {
          nextState = adjustTrack(nextState, playerId, trackName, 1);
        });
        nextState = appendLog(nextState, {
          type: "ACTION_CARD_EFFECT_APPLIED",
          playerId,
          catalogId: "S3",
          trackChoices,
          message: `${playerId}'s Brokerage Expansion raises ${trackChoices.join(", ")} (the +2 PT was already granted at play time).`
        });
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleS4(state, context) {
        const { playerId } = context;
        const result = drawFromSharedActionCardDeck(state, playerId, 2);
        const nextState = appendLog(result, {
          type: "ACTION_CARD_EFFECT_APPLIED",
          playerId,
          catalogId: "S4",
          drawnCount: result.drawnCount,
          message: `${playerId}'s Trend Forecasting acquires ${result.drawnCount} Action Card(s).`
        });
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleS5(state, context) {
        const { playerId, cardInstanceId, extra } = context;
        const player = state.players[playerId];
        if (!extra) {
          const nextState2 = {
            ...state,
            phase: {
              ...state.phase,
              pendingInterrupt: {
                type: "ACTION_CARD_EFFECT_CHOICE",
                sourcePlayerId: playerId,
                data: { catalogId: "S5", choiceType: "S5_HIRE_COACH_TARGET", cardInstanceId }
              }
            }
          };
          return {
            state: appendLog(nextState2, { type: "ACTION_CARD_EFFECT_S5_AWAITING_CHOICE", playerId, catalogId: "S5" }),
            effectOutcome: DEFAULT_OUTCOME
          };
        }
        const targetEntry = player.roster.find((r) => r.agentInstanceId === extra.targetAgentInstanceId && !r.isVoided);
        let nextState = state;
        if (targetEntry) {
          nextState = {
            ...nextState,
            players: {
              ...nextState.players,
              [playerId]: {
                ...nextState.players[playerId],
                roster: nextState.players[playerId].roster.map((r) => r.agentInstanceId === extra.targetAgentInstanceId ? { ...r, coachTokens: r.coachTokens + 1 } : r)
              }
            }
          };
        }
        const drawResult = drawFromSharedActionCardDeck(nextState, playerId, 1);
        nextState = { ...drawResult, phase: { ...drawResult.phase, pendingInterrupt: { type: "NULL", sourcePlayerId: null, data: {} } } };
        nextState = appendLog(nextState, {
          type: "ACTION_CARD_EFFECT_APPLIED",
          playerId,
          catalogId: "S5",
          targetAgentInstanceId: targetEntry ? extra.targetAgentInstanceId : null,
          drawnCount: drawResult.drawnCount,
          message: targetEntry ? `${playerId}'s Networking assigns a Coach Token to ${targetEntry.catalogId} and acquires ${drawResult.drawnCount} card.` : `${playerId}'s Networking acquires ${drawResult.drawnCount} card (no valid coach target provided).`
        });
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleS6(state, context) {
        const { playerId, cardInstanceId, extra } = context;
        const player = state.players[playerId];
        if (!extra || !Array.isArray(extra.meepleInstanceIds)) {
          const playCardSpace = (state.board.actionSpaces || []).find((s) => s.spaceId === "EXEC_TAKE_PLAY_CARD");
          const activeMeepleInstanceIds = new Set(
            (playCardSpace ? playCardSpace.occupiedBy : []).filter((entry) => entry.playerId === playerId).map((entry) => entry.meepleInstanceId)
          );
          const onBoardMeepleIds = player.timeMeeples.active.filter((m) => m.status === "on_board" && !activeMeepleInstanceIds.has(m.instanceId)).map((m) => m.instanceId);
          if (onBoardMeepleIds.length === 0) {
            return {
              state: appendLog(state, { type: "ACTION_CARD_EFFECT_S6_SKIPPED", playerId, catalogId: "S6", reason: "NO_MEEPLES_ON_BOARD" }),
              effectOutcome: DEFAULT_OUTCOME
            };
          }
          const nextState2 = {
            ...state,
            phase: {
              ...state.phase,
              pendingInterrupt: {
                type: "ACTION_CARD_EFFECT_CHOICE",
                sourcePlayerId: playerId,
                data: { catalogId: "S6", choiceType: "S6_RECALL_MEEPLES", cardInstanceId, candidateMeepleInstanceIds: onBoardMeepleIds, maxSelect: 3 }
              }
            }
          };
          return {
            state: appendLog(nextState2, { type: "ACTION_CARD_EFFECT_S6_AWAITING_CHOICE", playerId, catalogId: "S6" }),
            effectOutcome: DEFAULT_OUTCOME
          };
        }
        const playCardSpaceResume = (state.board.actionSpaces || []).find((s) => s.spaceId === "EXEC_TAKE_PLAY_CARD");
        const activeMeepleInstanceIdsResume = new Set(
          (playCardSpaceResume ? playCardSpaceResume.occupiedBy : []).filter((entry) => entry.playerId === playerId).map((entry) => entry.meepleInstanceId)
        );
        const recallIds = extra.meepleInstanceIds.filter((id) => !activeMeepleInstanceIdsResume.has(id)).slice(0, 3);
        let nextState = {
          ...state,
          players: {
            ...state.players,
            [playerId]: {
              ...player,
              timeMeeples: {
                ...player.timeMeeples,
                active: player.timeMeeples.active.map((m) => recallIds.includes(m.instanceId) ? { ...m, status: "in_supply", locationSpaceId: null } : m)
              }
            }
          },
          // Recalling a meeple frees the board space it occupied — the space's
          // own occupiedBy list must be updated too, or the space would
          // incorrectly stay "occupied" by a meeple that's back in supply.
          board: {
            ...state.board,
            actionSpaces: state.board.actionSpaces.map((space) => ({
              ...space,
              occupiedBy: space.occupiedBy.filter((entry) => !recallIds.includes(entry.meepleInstanceId))
            }))
          },
          phase: {
            ...state.phase,
            pendingInterrupt: { type: "NULL", sourcePlayerId: null, data: {} },
            // BUGFIX (confirmed via direct reproduction): recalling a meeple
            // back to supply must also make sure the player is still listed
            // as able to act this round — placeMeeple's own step would have
            // removed them if the meeple used to play this very card was
            // their last active one. Without this, the end-of-round check
            // incorrectly thinks the player has no meeples left, ending the
            // round prematurely while real, usable meeples sit in their
            // supply. Same re-add pattern workerPlacementReducer.js's
            // cancelDeferredSpaceChoice already uses for its own case.
            playersWithMeeplesRemaining: recallIds.length > 0 && !state.phase.playersWithMeeplesRemaining.includes(playerId) ? [...state.phase.playersWithMeeplesRemaining, playerId] : state.phase.playersWithMeeplesRemaining
          }
        };
        nextState = appendLog(nextState, {
          type: "ACTION_CARD_EFFECT_APPLIED",
          playerId,
          catalogId: "S6",
          recalledCount: recallIds.length,
          message: `${playerId}'s The 25th Hour recalls ${recallIds.length} Meeple(s) back to supply.`
        });
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleS7(state, context) {
        const { playerId } = context;
        const nextState = adjustWallet(state, playerId, 0, 1);
        return {
          state: appendLog(nextState, {
            type: "ACTION_CARD_EFFECT_APPLIED",
            playerId,
            catalogId: "S7",
            message: `${playerId}'s Executive Capacity grants 1 Priority Token.`
          }),
          effectOutcome: DEFAULT_OUTCOME
        };
      }
      module.exports = {
        handleS1,
        handleS2,
        handleS3,
        handleS4,
        handleS5,
        handleS6,
        handleS7
      };
    }
  });

  // handlers/shiftCards/shiftCards.js
  var require_shiftCards = __commonJS({
    "handlers/shiftCards/shiftCards.js"(exports, module) {
      var {
        adjustTrack,
        adjustWallet,
        adjustOfficeSlots,
        hasDeficitRequiringChoice,
        payMandatoryProfitTokenDeficit,
        payProfitTokenDeficitWithHumanPause,
        fireAgentFromRoster,
        fireAgentBySelector,
        pickRosterExtremeBy
      } = require_cardEffectHelpers();
      var { playerHasShiftImmunity } = require_immunityReducer();
      var DEFAULT_OUTCOME = { skipDefaultDiscard: false, customDestination: null };
      var _marketAgentInstanceCounter = 0;
      function resetMarketAgentInstanceCounter() {
        _marketAgentInstanceCounter = 0;
      }
      function generateMarketAgentInstanceId() {
        _marketAgentInstanceCounter += 1;
        return `mkt-${_marketAgentInstanceCounter}`;
      }
      function appendLog(state, entry) {
        const logEntry = {
          seq: state.log.length + 1,
          timestamp: (/* @__PURE__ */ new Date()).toISOString(),
          round: state.phase.round,
          ...entry
        };
        return { ...state, log: [...state.log, logEntry] };
      }
      function handleSft002(state, context) {
        let nextState = state;
        Object.keys(nextState.players).forEach((playerId) => {
          const player = nextState.players[playerId];
          if (playerHasShiftImmunity(player)) {
            return;
          }
          nextState = adjustTrack(nextState, playerId, "recognition", -2);
        });
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function autoChooseDeficitTrack(player) {
        const TRACK_ORDER = ["training", "technology", "recognition"];
        const candidates = TRACK_ORDER.filter((t) => player.tracks[t].value > 0);
        if (candidates.length === 0) return null;
        return candidates.sort((a, b) => player.tracks[b].value - player.tracks[a].value)[0];
      }
      function handleSft042(state, context) {
        let nextState = state;
        Object.keys(nextState.players).forEach((playerId) => {
          const player = nextState.players[playerId];
          if (playerHasShiftImmunity(player)) {
            return;
          }
          if (player.isBot) {
            const chosenTrack = hasDeficitRequiringChoice(nextState, playerId, 7) ? autoChooseDeficitTrack(player) : null;
            const result = payMandatoryProfitTokenDeficit(nextState, playerId, 7, chosenTrack);
            nextState = result.state;
          } else {
            nextState = payProfitTokenDeficitWithHumanPause(nextState, playerId, 7);
          }
          nextState = adjustTrack(nextState, playerId, "recognition", -1);
        });
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleSft044(state, context) {
        let nextState = state;
        Object.keys(nextState.players).forEach((playerId) => {
          const player = nextState.players[playerId];
          if (playerHasShiftImmunity(player)) {
            return;
          }
          nextState = adjustTrack(nextState, playerId, "technology", -1);
          if (player.isBot) {
            const chosenTrack = hasDeficitRequiringChoice(nextState, playerId, 3) ? autoChooseDeficitTrack(nextState.players[playerId]) : null;
            const result = payMandatoryProfitTokenDeficit(nextState, playerId, 3, chosenTrack);
            nextState = result.state;
          } else {
            nextState = payProfitTokenDeficitWithHumanPause(nextState, playerId, 3);
          }
        });
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleSft004(state, context) {
        let nextState = state;
        const agentCatalog = nextState.cardCatalog && nextState.cardCatalog.agentCards || {};
        Object.keys(nextState.players).forEach((playerId) => {
          const player = nextState.players[playerId];
          if (playerHasShiftImmunity(player)) {
            return;
          }
          nextState = adjustOfficeSlots(nextState, playerId, -1);
          const updatedPlayer = nextState.players[playerId];
          const capacity = updatedPlayer.tracks.offices.unlocked;
          if (updatedPlayer.roster.length <= capacity) {
            return;
          }
          const sortedByProfitAscending = [...updatedPlayer.roster].sort((a, b) => {
            const profitA = agentCatalog[a.catalogId] && agentCatalog[a.catalogId].totalProfit || 0;
            const profitB = agentCatalog[b.catalogId] && agentCatalog[b.catalogId].totalProfit || 0;
            return profitA - profitB;
          });
          const excessCount = updatedPlayer.roster.length - capacity;
          const firedInstanceIds = new Set(sortedByProfitAscending.slice(0, excessCount).map((a) => a.agentInstanceId));
          const remainingRoster = updatedPlayer.roster.filter((a) => !firedInstanceIds.has(a.agentInstanceId));
          nextState = {
            ...nextState,
            players: {
              ...nextState.players,
              [playerId]: { ...updatedPlayer, roster: remainingRoster }
            }
          };
          nextState = appendLog(nextState, {
            type: "SHIFT_EFFECT_OFFICE_SHUTDOWN_AGENTS_FIRED",
            playerId,
            catalogId: "SFT_004",
            firedAgentInstanceIds: Array.from(firedInstanceIds),
            newCapacity: capacity,
            message: `${playerId} fires ${firedInstanceIds.size} agent(s) (lowest profit first) \u2014 roster exceeded the new office capacity (Office Shutdown).`
          });
        });
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleSft029(state, context) {
        let nextState = state;
        Object.keys(nextState.players).forEach((playerId) => {
          const player = nextState.players[playerId];
          if (playerHasShiftImmunity(player)) {
            return;
          }
          nextState = adjustTrack(nextState, playerId, "recognition", -2);
          nextState = adjustWallet(nextState, playerId, -1, 0);
        });
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleSft038(state, context) {
        const discardedCount = state.board.openMarketAgents.length;
        const discardedCatalogIds = state.board.openMarketAgents.map((a) => a.catalogId);
        let drawPile = state.board.agentDrawPile || [];
        const refilled = [];
        for (let i = 0; i < discardedCount && drawPile.length > 0; i += 1) {
          refilled.push({ catalogId: drawPile[0], agentInstanceId: generateMarketAgentInstanceId() });
          drawPile = drawPile.slice(1);
        }
        let nextState = {
          ...state,
          board: {
            ...state.board,
            openMarketAgents: refilled,
            agentDrawPile: drawPile
          }
        };
        nextState = appendLog(nextState, {
          type: "SHIFT_EFFECT_MARKET_CRASH",
          catalogId: "SFT_038",
          discardedCatalogIds,
          discardedCount,
          refilledCount: refilled.length,
          message: `The Open Market crashes: ${discardedCount} Agent(s) discarded, ${refilled.length} new Agent(s) drawn to replace them (Market Crash).`
        });
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleSft043(state, context) {
        let nextState = state;
        Object.keys(nextState.players).forEach((playerId) => {
          const player = nextState.players[playerId];
          if (playerHasShiftImmunity(player)) {
            return;
          }
          const loss = Math.ceil(player.wallet.profitTokens / 2);
          if (loss > 0) {
            nextState = adjustWallet(nextState, playerId, -loss, 0);
          }
        });
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleSft005(state, context) {
        let nextState = state;
        Object.keys(nextState.players).forEach((playerId) => {
          const player = nextState.players[playerId];
          if (playerHasShiftImmunity(player)) return;
          nextState = adjustTrack(nextState, playerId, "recognition", -3);
        });
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleSft006(state, context) {
        let nextState = state;
        Object.keys(nextState.players).forEach((playerId) => {
          const player = nextState.players[playerId];
          if (playerHasShiftImmunity(player)) return;
          const active = player.timeMeeples.active;
          if (active.length === 0) return;
          const idx = active.findIndex((m) => m.status === "in_supply");
          const removeIdx = idx >= 0 ? idx : 0;
          const newActive = active.filter((_, i) => i !== removeIdx);
          nextState = {
            ...nextState,
            players: { ...nextState.players, [playerId]: { ...player, timeMeeples: { ...player.timeMeeples, active: newActive } } }
          };
        });
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleSft009(state, context) {
        let nextState = state;
        Object.keys(nextState.players).forEach((playerId) => {
          const player = nextState.players[playerId];
          if (playerHasShiftImmunity(player)) return;
          nextState = adjustTrack(nextState, playerId, "training", -2);
        });
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleSft013(state, context) {
        const { playerId } = context;
        const player = state.players[playerId];
        if (playerHasShiftImmunity(player)) {
          return { state, effectOutcome: DEFAULT_OUTCOME };
        }
        const nextState = adjustTrack(state, playerId, "recognition", -3);
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleSft015(state, context) {
        let nextState = state;
        Object.keys(nextState.players).forEach((playerId) => {
          const player = nextState.players[playerId];
          if (playerHasShiftImmunity(player)) return;
          nextState = {
            ...nextState,
            players: { ...nextState.players, [playerId]: { ...player, hand: { ...player.hand, maxHandSize: Math.max(1, player.hand.maxHandSize - 1) } } }
          };
        });
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleSft019(state, context) {
        let nextState = state;
        Object.keys(nextState.players).forEach((playerId) => {
          const player = nextState.players[playerId];
          if (playerHasShiftImmunity(player)) return;
          const cost = player.roster.filter((a) => !a.isVoided).length * 2;
          if (cost > 0) nextState = adjustWallet(nextState, playerId, -cost, 0);
        });
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleSft020(state, context) {
        let nextState = state;
        Object.keys(nextState.players).forEach((playerId) => {
          const player = nextState.players[playerId];
          if (playerHasShiftImmunity(player)) return;
          nextState = adjustTrack(nextState, playerId, "recognition", -2);
          const updatedPlayer = nextState.players[playerId];
          if (updatedPlayer.hand.actionCards.length > 0) {
            const [, ...rest] = updatedPlayer.hand.actionCards;
            nextState = {
              ...nextState,
              players: { ...nextState.players, [playerId]: { ...updatedPlayer, hand: { ...updatedPlayer.hand, actionCards: rest } } }
            };
          }
        });
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleSft027(state, context) {
        let nextState = state;
        Object.keys(nextState.players).forEach((playerId) => {
          const player = nextState.players[playerId];
          if (playerHasShiftImmunity(player)) return;
          nextState = adjustTrack(nextState, playerId, "training", -2);
          nextState = adjustTrack(nextState, playerId, "recognition", -2);
        });
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleSft033(state, context) {
        let nextState = state;
        Object.keys(nextState.players).forEach((playerId) => {
          const player = nextState.players[playerId];
          if (playerHasShiftImmunity(player)) return;
          nextState = adjustTrack(nextState, playerId, "training", -3);
        });
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleSft040(state, context) {
        const { playerId } = context;
        const player = state.players[playerId];
        if (playerHasShiftImmunity(player)) {
          return { state, effectOutcome: DEFAULT_OUTCOME };
        }
        let nextState = adjustWallet(state, playerId, -5, 0);
        nextState = adjustTrack(nextState, playerId, "technology", -2);
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleSft047(state, context) {
        const { playerId } = context;
        const player = state.players[playerId];
        if (playerHasShiftImmunity(player)) {
          return { state, effectOutcome: DEFAULT_OUTCOME };
        }
        let nextState = adjustTrack(state, playerId, "recognition", -3);
        nextState = adjustWallet(nextState, playerId, -5, 0);
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function findPlayerWithMostAgents(state) {
        let best = null;
        let bestCount = -1;
        Object.keys(state.players).forEach((playerId) => {
          const count = state.players[playerId].roster.filter((r) => !r.isVoided).length;
          if (count > bestCount) {
            best = playerId;
            bestCount = count;
          }
        });
        return best;
      }
      function shrinkOfficeAndFireExcess(state, playerId, agentCatalog, reasonCatalogId) {
        let nextState = adjustOfficeSlots(state, playerId, -1);
        const updatedPlayer = nextState.players[playerId];
        const capacity = updatedPlayer.tracks.offices.unlocked;
        const activeRoster = updatedPlayer.roster.filter((r) => !r.isVoided);
        if (activeRoster.length <= capacity) return nextState;
        const excessCount = activeRoster.length - capacity;
        const sortedByProfitAscending = [...activeRoster].sort((a, b) => {
          const profitA = agentCatalog[a.catalogId] && agentCatalog[a.catalogId].totalProfit || 0;
          const profitB = agentCatalog[b.catalogId] && agentCatalog[b.catalogId].totalProfit || 0;
          return profitA - profitB;
        });
        sortedByProfitAscending.slice(0, excessCount).forEach((entry) => {
          nextState = fireAgentFromRoster(nextState, playerId, entry.agentInstanceId, reasonCatalogId);
        });
        return nextState;
      }
      function handleSft008(state, context) {
        const agentCatalog = state.cardCatalog && state.cardCatalog.agentCards || {};
        const targetPlayerId = findPlayerWithMostAgents(state);
        if (!targetPlayerId || playerHasShiftImmunity(state.players[targetPlayerId])) {
          return { state, effectOutcome: DEFAULT_OUTCOME };
        }
        const nextState = shrinkOfficeAndFireExcess(state, targetPlayerId, agentCatalog, "SFT_008");
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleSft010(state, context) {
        const agentCatalog = state.cardCatalog && state.cardCatalog.agentCards || {};
        const targetPlayerId = findPlayerWithMostAgents(state);
        if (!targetPlayerId || playerHasShiftImmunity(state.players[targetPlayerId])) {
          return { state, effectOutcome: DEFAULT_OUTCOME };
        }
        const nextState = shrinkOfficeAndFireExcess(state, targetPlayerId, agentCatalog, "SFT_010");
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleSft011(state, context) {
        let nextState = state;
        Object.keys(nextState.players).forEach((playerId) => {
          if (playerHasShiftImmunity(nextState.players[playerId])) return;
          nextState = fireAgentBySelector(nextState, playerId, (roster, cat) => pickRosterExtremeBy(roster, cat, "training", "lowest"), "SFT_011");
        });
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleSft014(state, context) {
        const { playerId } = context;
        if (playerHasShiftImmunity(state.players[playerId])) {
          return { state, effectOutcome: DEFAULT_OUTCOME };
        }
        const nextState = fireAgentBySelector(state, playerId, (roster, cat) => pickRosterExtremeBy(roster, cat, "totalProfit", "lowest"), "SFT_014");
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleSft017(state, context) {
        let nextState = state;
        Object.keys(nextState.players).forEach((playerId) => {
          if (playerHasShiftImmunity(nextState.players[playerId])) return;
          nextState = fireAgentBySelector(nextState, playerId, (roster, cat) => pickRosterExtremeBy(roster, cat, "technology", "lowest"), "SFT_017");
        });
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleSft021(state, context) {
        const drawPile = state.board.decks && state.board.decks.agentDrawPile || state.board.agentDrawPile || [];
        const removedCount = Math.min(3, drawPile.length);
        const remaining = drawPile.slice(removedCount);
        let nextState = {
          ...state,
          board: {
            ...state.board,
            agentDrawPile: remaining,
            decks: state.board.decks ? { ...state.board.decks, agentDrawPile: remaining } : state.board.decks
          }
        };
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleSft025(state, context) {
        const agentCatalog = state.cardCatalog && state.cardCatalog.agentCards || {};
        let bestPlayerId = null;
        let bestInstanceId = null;
        let bestProfit = -1;
        Object.keys(state.players).forEach((playerId) => {
          if (playerHasShiftImmunity(state.players[playerId])) return;
          state.players[playerId].roster.forEach((entry) => {
            if (entry.isVoided || entry.loyaltyToken && entry.loyaltyToken.active) return;
            const profit = agentCatalog[entry.catalogId] && agentCatalog[entry.catalogId].totalProfit || 0;
            if (profit > bestProfit) {
              bestProfit = profit;
              bestPlayerId = playerId;
              bestInstanceId = entry.agentInstanceId;
            }
          });
        });
        if (!bestPlayerId) return { state, effectOutcome: DEFAULT_OUTCOME };
        const nextState = fireAgentFromRoster(state, bestPlayerId, bestInstanceId, "SFT_025");
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleSft030(state, context) {
        let nextState = state;
        Object.keys(nextState.players).forEach((playerId) => {
          if (playerHasShiftImmunity(nextState.players[playerId])) return;
          nextState = fireAgentBySelector(nextState, playerId, (roster, cat) => pickRosterExtremeBy(roster, cat, "training", "highest"), "SFT_030");
        });
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleSft031(state, context) {
        const { playerId } = context;
        if (playerHasShiftImmunity(state.players[playerId])) {
          return { state, effectOutcome: DEFAULT_OUTCOME };
        }
        const nextState = fireAgentBySelector(state, playerId, (roster, cat) => pickRosterExtremeBy(roster, cat, "recognition", "lowest"), "SFT_031");
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleSft041(state, context) {
        const { playerId } = context;
        if (playerHasShiftImmunity(state.players[playerId])) {
          return { state, effectOutcome: DEFAULT_OUTCOME };
        }
        let nextState = adjustWallet(state, playerId, -5, 0);
        nextState = fireAgentBySelector(nextState, playerId, (roster, cat) => pickRosterExtremeBy(roster, cat, "totalProfit", "lowest"), "SFT_041");
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleSft046(state, context) {
        const { playerId } = context;
        if (playerHasShiftImmunity(state.players[playerId])) {
          return { state, effectOutcome: DEFAULT_OUTCOME };
        }
        const agentCatalog = state.cardCatalog && state.cardCatalog.agentCards || {};
        let nextState = adjustTrack(state, playerId, "recognition", -1);
        nextState = shrinkOfficeAndFireExcess(nextState, playerId, agentCatalog, "SFT_046");
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleSft051(state, context) {
        const { playerId } = context;
        if (playerHasShiftImmunity(state.players[playerId])) {
          return { state, effectOutcome: DEFAULT_OUTCOME };
        }
        let nextState = adjustTrack(state, playerId, "recognition", -2);
        nextState = fireAgentBySelector(nextState, playerId, (roster, cat) => pickRosterExtremeBy(roster, cat, "culture", "highest"), "SFT_051");
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleSft052(state, context) {
        let nextState = state;
        Object.keys(nextState.players).forEach((playerId) => {
          if (playerHasShiftImmunity(nextState.players[playerId])) return;
          nextState = fireAgentBySelector(nextState, playerId, (roster, cat) => pickRosterExtremeBy(roster, cat, "training", "lowest"), "SFT_052");
        });
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleSft052(state, context) {
        let nextState = state;
        Object.keys(nextState.players).forEach((playerId) => {
          if (playerHasShiftImmunity(nextState.players[playerId])) return;
          nextState = fireAgentBySelector(nextState, playerId, (roster, cat) => pickRosterExtremeBy(roster, cat, "training", "lowest"), "SFT_052");
        });
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function leftNeighborId(state, playerId) {
        const order = state.phase.turnOrder || [];
        const idx = order.indexOf(playerId);
        if (idx === -1 || order.length < 2) return null;
        return order[(idx + 1) % order.length];
      }
      function handleSft001(state, context) {
        let nextState = state;
        Object.keys(nextState.players).forEach((playerId) => {
          if (playerHasShiftImmunity(nextState.players[playerId])) return;
          nextState = { ...nextState, players: { ...nextState.players, [playerId]: { ...nextState.players[playerId], recruitmentBanTrainingFloorUntilRound: nextState.phase.round } } };
        });
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleSft003(state, context) {
        let nextState = state;
        Object.keys(nextState.players).forEach((playerId) => {
          if (playerHasShiftImmunity(nextState.players[playerId])) return;
          nextState = { ...nextState, players: { ...nextState.players, [playerId]: { ...nextState.players[playerId], recruitmentSurchargeUntilRound: nextState.phase.round, recruitmentSurchargeAmount: 2 } } };
        });
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleSft007(state, context) {
        const { playerId } = context;
        const player = state.players[playerId];
        const targetPlayerId = leftNeighborId(state, playerId);
        if (!targetPlayerId || player.hand.actionCards.length === 0) {
          return { state, effectOutcome: DEFAULT_OUTCOME };
        }
        const [given, ...rest] = player.hand.actionCards;
        const target = state.players[targetPlayerId];
        const nextState = {
          ...state,
          players: {
            ...state.players,
            [playerId]: { ...player, hand: { ...player.hand, actionCards: rest } },
            [targetPlayerId]: { ...target, hand: { ...target.hand, actionCards: [...target.hand.actionCards, given] } }
          }
        };
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleSft012(state, context) {
        let nextState = state;
        Object.keys(nextState.players).forEach((playerId) => {
          if (playerHasShiftImmunity(nextState.players[playerId])) return;
          nextState = { ...nextState, players: { ...nextState.players, [playerId]: { ...nextState.players[playerId], recruitmentSurchargeUntilRound: nextState.phase.round, recruitmentSurchargeAmount: 5 } } };
        });
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleSft016(state, context) {
        let nextState = state;
        Object.keys(nextState.players).forEach((playerId) => {
          const player = nextState.players[playerId];
          if (playerHasShiftImmunity(player)) return;
          const active = player.timeMeeples.active;
          const idx = active.findIndex((m) => m.status === "in_supply");
          if (idx < 0) return;
          const newActive = active.map((m, i) => i === idx ? { ...m, status: "disabled_until_round", disabledUntilRound: nextState.phase.round + 1 } : m);
          nextState = { ...nextState, players: { ...nextState.players, [playerId]: { ...player, timeMeeples: { ...player.timeMeeples, active: newActive } } } };
        });
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleSft018(state, context) {
        let nextState = state;
        Object.keys(nextState.players).forEach((playerId) => {
          if (playerHasShiftImmunity(nextState.players[playerId])) return;
          nextState = { ...nextState, players: { ...nextState.players, [playerId]: { ...nextState.players[playerId], recruitmentRequirementDoubledUntilRound: nextState.phase.round } } };
        });
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleSft022(state, context) {
        const { playerId } = context;
        let nextState = playerHasShiftImmunity(state.players[playerId]) ? state : adjustTrack(state, playerId, "recognition", -3);
        Object.keys(nextState.players).forEach((pid) => {
          if (playerHasShiftImmunity(nextState.players[pid])) return;
          nextState = { ...nextState, players: { ...nextState.players, [pid]: { ...nextState.players[pid], recruitBannedUntilRound: nextState.phase.round } } };
        });
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleSft023(state, context) {
        let nextState = state;
        Object.keys(nextState.players).forEach((playerId) => {
          if (playerHasShiftImmunity(nextState.players[playerId])) return;
          nextState = adjustWallet(nextState, playerId, -5, 0);
          nextState = { ...nextState, players: { ...nextState.players, [playerId]: { ...nextState.players[playerId], openMarketRecruitBannedUntilRound: nextState.phase.round } } };
        });
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleSft024(state, context) {
        let nextState = state;
        Object.keys(nextState.players).forEach((playerId) => {
          if (playerHasShiftImmunity(nextState.players[playerId])) return;
          nextState = { ...nextState, players: { ...nextState.players, [playerId]: { ...nextState.players[playerId], highProfitRecruitSurchargeUntilRound: nextState.phase.round, highProfitRecruitSurchargeAmount: 5, highProfitRecruitThreshold: 5 } } };
        });
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleSft026(state, context) {
        const agentCatalog = state.cardCatalog && state.cardCatalog.agentCards || {};
        let nextState = state;
        Object.keys(nextState.players).forEach((playerId) => {
          const player = nextState.players[playerId];
          if (playerHasShiftImmunity(player)) return;
          if (player.wallet.profitTokens >= 4) {
            nextState = adjustWallet(nextState, playerId, -4, 0);
          } else {
            const eligible = player.roster.filter((r) => !r.isVoided && (agentCatalog[r.catalogId] && agentCatalog[r.catalogId].totalProfit || 0) <= 4);
            if (eligible.length > 0) {
              nextState = fireAgentBySelector(nextState, playerId, (roster, cat) => pickRosterExtremeBy(eligible, cat, "totalProfit", "lowest"), "SFT_026");
            }
          }
        });
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleSft032(state, context) {
        const { playerId } = context;
        const player = state.players[playerId];
        let nextState = state;
        if (player.hand.actionCards.length > 0) {
          const [, ...rest] = player.hand.actionCards;
          nextState = { ...nextState, players: { ...nextState.players, [playerId]: { ...player, hand: { ...player.hand, actionCards: rest } } } };
        }
        const active = nextState.players[playerId].timeMeeples.active;
        const idx = active.findIndex((m) => m.status === "in_supply");
        if (idx >= 0) {
          const newActive = active.map((m, i) => i === idx ? { ...m, status: "disabled_until_round", disabledUntilRound: nextState.phase.round + 1 } : m);
          nextState = { ...nextState, players: { ...nextState.players, [playerId]: { ...nextState.players[playerId], timeMeeples: { ...nextState.players[playerId].timeMeeples, active: newActive } } } };
        }
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleSft034(state, context) {
        let nextState = state;
        Object.keys(nextState.players).forEach((playerId) => {
          if (playerHasShiftImmunity(nextState.players[playerId])) return;
          nextState = { ...nextState, players: { ...nextState.players, [playerId]: { ...nextState.players[playerId], playCardActionBannedUntilRound: nextState.phase.round } } };
        });
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleSft035(state, context) {
        const agentCatalog = state.cardCatalog && state.cardCatalog.agentCards || {};
        let nextState = state;
        Object.keys(nextState.players).forEach((playerId) => {
          const player = nextState.players[playerId];
          if (playerHasShiftImmunity(player)) return;
          if (player.wallet.profitTokens >= 6) {
            nextState = adjustWallet(nextState, playerId, -6, 0);
          } else {
            nextState = fireAgentBySelector(nextState, playerId, (roster, cat) => pickRosterExtremeBy(roster, cat, "totalProfit", "highest"), "SFT_035");
          }
        });
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleSft036(state, context) {
        let nextState = state;
        Object.keys(nextState.players).forEach((playerId) => {
          const player = nextState.players[playerId];
          if (playerHasShiftImmunity(player)) return;
          if (player.wallet.profitTokens >= 5) {
            nextState = adjustWallet(nextState, playerId, -5, 0);
          } else {
            const active = player.timeMeeples.active;
            if (active.length > 0) {
              const idx = active.findIndex((m) => m.status === "in_supply");
              const removeIdx = idx >= 0 ? idx : 0;
              const newActive = active.filter((_, i) => i !== removeIdx);
              nextState = { ...nextState, players: { ...nextState.players, [playerId]: { ...player, timeMeeples: { ...player.timeMeeples, active: newActive } } } };
            }
          }
        });
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleSft037(state, context) {
        const { playerId } = context;
        const player = state.players[playerId];
        if (player.hand.actionCards.length === 0) {
          return { state, effectOutcome: DEFAULT_OUTCOME };
        }
        const [, ...rest] = player.hand.actionCards;
        const nextState = { ...state, players: { ...state.players, [playerId]: { ...player, hand: { ...player.hand, actionCards: rest } } } };
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleSft039(state, context) {
        let nextState = state;
        Object.keys(nextState.players).forEach((playerId) => {
          const player = nextState.players[playerId];
          if (playerHasShiftImmunity(player)) return;
          const cost = player.roster.filter((a) => !a.isVoided).length * 2;
          if (cost === 0) return;
          if (player.wallet.profitTokens >= cost) {
            nextState = adjustWallet(nextState, playerId, -cost, 0);
          } else {
            nextState = adjustWallet(nextState, playerId, -player.wallet.profitTokens, 0);
            const agentCatalog = nextState.cardCatalog && nextState.cardCatalog.agentCards || {};
            const activeRoster = nextState.players[playerId].roster.filter((r) => !r.isVoided);
            const worst = pickRosterExtremeBy(activeRoster, agentCatalog, "totalProfit", "lowest");
            if (worst) nextState = fireAgentFromRoster(nextState, playerId, worst, "SFT_039");
          }
        });
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleSft045(state, context) {
        const { playerId } = context;
        let nextState = playerHasShiftImmunity(state.players[playerId]) ? state : adjustWallet(state, playerId, -5, 0);
        nextState = { ...nextState, players: { ...nextState.players, [playerId]: { ...nextState.players[playerId], hireStaffBannedUntilRound: nextState.phase.round } } };
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleSft048(state, context) {
        const agentCatalog = state.cardCatalog && state.cardCatalog.agentCards || {};
        let lowestPlayerId = null;
        let lowestWallet = Infinity;
        Object.keys(state.players).forEach((playerId) => {
          const pt = state.players[playerId].wallet.profitTokens;
          if (pt < lowestWallet) {
            lowestWallet = pt;
            lowestPlayerId = playerId;
          }
        });
        if (!lowestPlayerId) return { state, effectOutcome: DEFAULT_OUTCOME };
        const market = state.board.openMarketAgents || [];
        let bestCatalogId = null;
        let bestValue = -1;
        market.forEach((m) => {
          const v = agentCatalog[m.catalogId] && agentCatalog[m.catalogId].totalProfit || 0;
          if (v > bestValue) {
            bestValue = v;
            bestCatalogId = m.catalogId;
          }
        });
        if (!bestCatalogId) return { state, effectOutcome: DEFAULT_OUTCOME };
        const { recruitOpenMarketAgent: recruit } = require_agentRecruitmentReducer();
        const result = recruit(state, lowestPlayerId, bestCatalogId);
        const nextState = result.error ? state : result.state;
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleSft049(state, context) {
        let nextState = state;
        Object.keys(nextState.players).forEach((playerId) => {
          if (playerHasShiftImmunity(nextState.players[playerId])) return;
          nextState = { ...nextState, players: { ...nextState.players, [playerId]: { ...nextState.players[playerId], trackIncreasesBannedUntilRound: nextState.phase.round } } };
        });
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleSft050(state, context) {
        const { playerId } = context;
        const player = state.players[playerId];
        const discarded = player.hand.actionCards.slice(0, 2);
        const remaining = player.hand.actionCards.slice(2);
        let nextState = { ...state, players: { ...state.players, [playerId]: { ...player, hand: { ...player.hand, actionCards: remaining } } } };
        nextState = { ...nextState, players: { ...nextState.players, [playerId]: { ...nextState.players[playerId], additionalProfitBannedUntilRound: nextState.phase.round } } };
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleSft028(state, context) {
        let nextState = state;
        Object.keys(nextState.players).forEach((playerId) => {
          const player = nextState.players[playerId];
          if (playerHasShiftImmunity(player)) return;
          nextState = adjustTrack(nextState, playerId, "technology", -4);
          const currentPlayer = nextState.players[playerId];
          const discarded = currentPlayer.hand.actionCards.slice(0, 2);
          const remaining = currentPlayer.hand.actionCards.slice(2);
          nextState = { ...nextState, players: { ...nextState.players, [playerId]: { ...currentPlayer, hand: { ...currentPlayer.hand, actionCards: remaining } } } };
        });
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      module.exports = {
        resetMarketAgentInstanceCounter,
        handleSft002,
        handleSft004,
        handleSft029,
        handleSft038,
        handleSft042,
        handleSft043,
        handleSft044,
        handleSft005,
        handleSft006,
        handleSft009,
        handleSft013,
        handleSft015,
        handleSft019,
        handleSft020,
        handleSft027,
        handleSft033,
        handleSft040,
        handleSft047,
        handleSft008,
        handleSft010,
        handleSft011,
        handleSft014,
        handleSft017,
        handleSft021,
        handleSft025,
        handleSft030,
        handleSft031,
        handleSft041,
        handleSft046,
        handleSft051,
        handleSft052,
        handleSft001,
        handleSft003,
        handleSft007,
        handleSft012,
        handleSft016,
        handleSft018,
        handleSft022,
        handleSft023,
        handleSft024,
        handleSft026,
        handleSft032,
        handleSft034,
        handleSft035,
        handleSft036,
        handleSft037,
        handleSft039,
        handleSft045,
        handleSft048,
        handleSft049,
        handleSft050,
        handleSft028
      };
    }
  });

  // handlers/specialistCards/specialistCards.js
  var require_specialistCards = __commonJS({
    "handlers/specialistCards/specialistCards.js"(exports, module) {
      var { adjustWallet, adjustOfficeSlots, getSharedRng } = require_cardEffectHelpers();
      var DEFAULT_OUTCOME = { skipDefaultDiscard: false, customDestination: null };
      var _instanceCounter = 0;
      function resetSpecialistCardInstanceCounter() {
        _instanceCounter = 0;
      }
      function generateActionCardInstanceId(playerId) {
        _instanceCounter += 1;
        return `ac-${playerId}-cleanslate-${_instanceCounter}`;
      }
      function appendLog(state, entry) {
        const logEntry = {
          seq: state.log.length + 1,
          timestamp: (/* @__PURE__ */ new Date()).toISOString(),
          round: state.phase.round,
          ...entry
        };
        return { ...state, log: [...state.log, logEntry] };
      }
      function getNextOpponentId(state, playerId) {
        const turnOrder = state.phase.turnOrder || [];
        const idx = turnOrder.indexOf(playerId);
        if (idx === -1) return null;
        for (let step = 1; step <= turnOrder.length; step += 1) {
          const candidateId = turnOrder[(idx + step) % turnOrder.length];
          if (candidateId !== playerId) {
            return candidateId;
          }
        }
        return null;
      }
      var VALUE_DIMENSIONS = ["training", "technology", "recognition"];
      var MIN_MATCHING_VALUES_TO_RECRUIT = 1;
      function getAgentStats(state, catalogId) {
        return (state.cardCatalog && state.cardCatalog.agentCards || {})[catalogId] || null;
      }
      function computeDeskUsage(state, playerId) {
        const player = state.players[playerId];
        const agentCards = state.cardCatalog && state.cardCatalog.agentCards || {};
        return player.roster.reduce((used, entry) => {
          if (entry.isVoided) return used;
          const stats = agentCards[entry.catalogId];
          if (!stats) return used + 1;
          if (stats.network.role === "follower" && stats.network.influencerCatalogId) {
            const influencerPresent = player.roster.some((r) => !r.isVoided && r.catalogId === stats.network.influencerCatalogId);
            if (influencerPresent) return used;
          }
          return used + 1;
        }, 0);
      }
      function hasOpenDesk(state, playerId) {
        const player = state.players[playerId];
        return computeDeskUsage(state, playerId) < player.tracks.offices.unlocked;
      }
      function countMatchingValues(playerTracks, agentStats) {
        return VALUE_DIMENSIONS.filter((dim) => playerTracks[dim].value >= agentStats[dim]).length;
      }
      function drawOneActionCardCatalogId(drawPile, discardPile) {
        if (drawPile.length > 0) {
          return { catalogId: drawPile[0], drawPile: drawPile.slice(1), discardPile };
        }
        if (discardPile.length > 0) {
          const rng = getSharedRng();
          const shuffled = discardPile.map((c) => c.catalogId);
          for (let i = shuffled.length - 1; i > 0; i -= 1) {
            const j = Math.floor(rng() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
          }
          return { catalogId: shuffled[0], drawPile: shuffled.slice(1), discardPile: [] };
        }
        return { catalogId: null, drawPile, discardPile };
      }
      function handleSpec1(state, context) {
        const { playerId, extra } = context;
        const usedDefaultTarget = !(extra && extra.targetPlayerId);
        const targetPlayerId = extra && extra.targetPlayerId || getNextOpponentId(state, playerId);
        if (!targetPlayerId || !state.players[targetPlayerId]) {
          return {
            state: appendLog(state, {
              type: "SPECIALIST_EFFECT_SNOOP_SKIPPED",
              playerId,
              catalogId: "SPEC_1",
              reason: "NO_VALID_TARGET"
            }),
            effectOutcome: DEFAULT_OUTCOME
          };
        }
        const target = state.players[targetPlayerId];
        if (target.hand.actionCards.length === 0) {
          return {
            state: appendLog(state, {
              type: "SPECIALIST_EFFECT_SNOOP_WASTED",
              playerId,
              catalogId: "SPEC_1",
              targetPlayerId,
              reason: "TARGET_HAND_EMPTY",
              usedDefaultTarget
            }),
            effectOutcome: DEFAULT_OUTCOME
          };
        }
        const stolenCard = target.hand.actionCards[0];
        const remainingTargetHand = target.hand.actionCards.slice(1);
        const draw = drawOneActionCardCatalogId(target.hand.personalDrawPile, target.hand.personalDiscardPile);
        const newTargetHandCards = draw.catalogId ? [...remainingTargetHand, { instanceId: generateActionCardInstanceId(targetPlayerId), catalogId: draw.catalogId }] : remainingTargetHand;
        const claimer = state.players[playerId];
        let nextState = {
          ...state,
          players: {
            ...state.players,
            [playerId]: {
              ...claimer,
              hand: {
                ...claimer.hand,
                actionCards: [...claimer.hand.actionCards, stolenCard]
              }
            },
            [targetPlayerId]: {
              ...target,
              hand: {
                ...target.hand,
                actionCards: newTargetHandCards,
                personalDrawPile: draw.drawPile,
                personalDiscardPile: draw.discardPile
              }
            }
          }
        };
        nextState = appendLog(nextState, {
          type: "SPECIALIST_EFFECT_SNOOP",
          playerId,
          catalogId: "SPEC_1",
          targetPlayerId,
          stolenCardInstanceId: stolenCard.instanceId,
          stolenCardCatalogId: stolenCard.catalogId,
          replacementCatalogId: draw.catalogId,
          usedDefaultTarget,
          message: `${playerId} steals an Action Card from ${targetPlayerId} (The Snoop).`
        });
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleSpec2(state, context) {
        const { playerId, extra } = context;
        const usedDefaultTarget = !(extra && extra.targetPlayerId);
        const targetPlayerId = extra && extra.targetPlayerId || getNextOpponentId(state, playerId);
        if (!targetPlayerId || !state.players[targetPlayerId]) {
          return {
            state: appendLog(state, {
              type: "SPECIALIST_EFFECT_WHISTLEBLOWER_SKIPPED",
              playerId,
              catalogId: "SPEC_2",
              reason: "NO_VALID_TARGET"
            }),
            effectOutcome: DEFAULT_OUTCOME
          };
        }
        const target = state.players[targetPlayerId];
        if (!target.roster || target.roster.length === 0) {
          return {
            state: appendLog(state, {
              type: "SPECIALIST_EFFECT_WHISTLEBLOWER_WASTED",
              playerId,
              catalogId: "SPEC_2",
              targetPlayerId,
              reason: "TARGET_ROSTER_EMPTY",
              usedDefaultTarget
            }),
            effectOutcome: DEFAULT_OUTCOME
          };
        }
        const usedDefaultAgent = !(extra && extra.agentInstanceId);
        const agentInstanceId = extra && extra.agentInstanceId || target.roster[0].agentInstanceId;
        const agentEntry = target.roster.find((a) => a.agentInstanceId === agentInstanceId);
        if (!agentEntry) {
          return {
            state: appendLog(state, {
              type: "SPECIALIST_EFFECT_WHISTLEBLOWER_SKIPPED",
              playerId,
              catalogId: "SPEC_2",
              targetPlayerId,
              reason: "AGENT_NOT_FOUND",
              agentInstanceId
            }),
            effectOutcome: DEFAULT_OUTCOME
          };
        }
        const agentCatalog = state.cardCatalog && state.cardCatalog.agentCards || {};
        const stats = agentCatalog[agentEntry.catalogId];
        const profitCompensation = stats && stats.totalProfit || 0;
        const updatedRoster = target.roster.filter((a) => a.agentInstanceId !== agentInstanceId);
        let nextState = {
          ...state,
          players: {
            ...state.players,
            [targetPlayerId]: { ...target, roster: updatedRoster }
          },
          board: {
            ...state.board,
            openMarketAgents: [
              ...state.board.openMarketAgents || [],
              { catalogId: agentEntry.catalogId, agentInstanceId: agentEntry.agentInstanceId }
            ]
          }
        };
        if (profitCompensation > 0) {
          nextState = adjustWallet(nextState, targetPlayerId, profitCompensation, 0);
        }
        nextState = appendLog(nextState, {
          type: "SPECIALIST_EFFECT_WHISTLEBLOWER",
          playerId,
          catalogId: "SPEC_2",
          targetPlayerId,
          agentInstanceId,
          agentCatalogId: agentEntry.catalogId,
          profitCompensation,
          usedDefaultTarget,
          usedDefaultAgent,
          message: `${playerId} forces ${targetPlayerId} to release an Agent to the open market; ${targetPlayerId} is compensated ${profitCompensation} PT (The Whistleblower).`
        });
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleSpec5(state, context) {
        const { playerId } = context;
        let nextState = adjustOfficeSlots(state, playerId, 1);
        const player = nextState.players[playerId];
        nextState = {
          ...nextState,
          players: {
            ...nextState.players,
            [playerId]: {
              ...player,
              hand: { ...player.hand, maxHandSize: player.hand.maxHandSize + 2 }
            }
          }
        };
        nextState = appendLog(nextState, {
          type: "SPECIALIST_EFFECT_GHOST_BROKER",
          playerId,
          catalogId: "SPEC_5",
          officeCapacityDelta: 1,
          handSizeDelta: 2,
          message: `${playerId} permanently gains +1 roster capacity and +2 hand size (The Ghost Broker).`
        });
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function performCleanSlateTrashAndDraw(state, playerId, selectedIds, usedDefaultSelection) {
        const player = state.players[playerId];
        const selectedSet = new Set(selectedIds);
        const remainingHand = player.hand.actionCards.filter((c) => !selectedSet.has(c.instanceId));
        let discardPile = player.hand.personalDiscardPile.filter((c) => !selectedSet.has(c.instanceId));
        let drawPile = player.hand.personalDrawPile;
        const drawnCatalogIds = [];
        for (let i = 0; i < selectedIds.length; i += 1) {
          const draw = drawOneActionCardCatalogId(drawPile, discardPile);
          drawPile = draw.drawPile;
          discardPile = draw.discardPile;
          if (draw.catalogId) {
            drawnCatalogIds.push(draw.catalogId);
          } else {
            break;
          }
        }
        const newHandCards = [
          ...remainingHand,
          ...drawnCatalogIds.map((catalogId) => ({ instanceId: generateActionCardInstanceId(playerId), catalogId }))
        ];
        let nextState = {
          ...state,
          players: {
            ...state.players,
            [playerId]: {
              ...player,
              hand: {
                ...player.hand,
                actionCards: newHandCards,
                personalDrawPile: drawPile,
                personalDiscardPile: discardPile
              }
            }
          }
        };
        nextState = appendLog(nextState, {
          type: "SPECIALIST_EFFECT_CLEAN_SLATE",
          playerId,
          catalogId: "SPEC_6",
          trashedInstanceIds: selectedIds,
          drawnCount: drawnCatalogIds.length,
          usedDefaultSelection,
          message: `${playerId} trashes ${selectedIds.length} card(s) and draws ${drawnCatalogIds.length} replacement(s) (The Clean Slate).`
        });
        return nextState;
      }
      function handleSpec6(state, context) {
        const { playerId, extra } = context;
        const player = state.players[playerId];
        const combinedPool = [...player.hand.actionCards, ...player.hand.personalDiscardPile];
        if (combinedPool.length === 0) {
          return {
            state: appendLog(state, {
              type: "SPECIALIST_EFFECT_CLEAN_SLATE_SKIPPED",
              playerId,
              catalogId: "SPEC_6",
              reason: "NO_CARDS_AVAILABLE"
            }),
            effectOutcome: DEFAULT_OUTCOME
          };
        }
        const hasExplicitSelection = extra && Array.isArray(extra.trashInstanceIds) && extra.trashInstanceIds.length > 0;
        if (!hasExplicitSelection) {
          const candidateInstanceIds = combinedPool.map((c) => c.instanceId);
          let nextState2 = {
            ...state,
            phase: {
              ...state.phase,
              pendingInterrupt: {
                type: "SPECIALIST_CARD_CHOICE",
                sourcePlayerId: playerId,
                data: {
                  catalogId: "SPEC_6",
                  choiceType: "SELECT_TRASH_CARDS",
                  candidateInstanceIds,
                  maxSelect: 3,
                  minSelect: 0
                }
              }
            }
          };
          nextState2 = appendLog(nextState2, {
            type: "SPECIALIST_EFFECT_CLEAN_SLATE_AWAITING_CHOICE",
            playerId,
            catalogId: "SPEC_6",
            candidateCount: candidateInstanceIds.length,
            maxSelect: 3,
            message: `${playerId} must choose up to 3 cards to trash (The Clean Slate) \u2014 engine paused awaiting a response.`
          });
          return { state: nextState2, effectOutcome: DEFAULT_OUTCOME };
        }
        const selectedIds = extra.trashInstanceIds.filter((id) => combinedPool.some((c) => c.instanceId === id)).slice(0, 3);
        if (selectedIds.length === 0) {
          return {
            state: appendLog(state, {
              type: "SPECIALIST_EFFECT_CLEAN_SLATE_SKIPPED",
              playerId,
              catalogId: "SPEC_6",
              reason: "NO_VALID_SELECTION"
            }),
            effectOutcome: DEFAULT_OUTCOME
          };
        }
        const nextState = performCleanSlateTrashAndDraw(state, playerId, selectedIds, false);
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleSpec8(state, context) {
        const { playerId } = context;
        const player = state.players[playerId];
        const bonusSpaces = /* @__PURE__ */ new Set([5, 7, 9]);
        const trackNames = ["training", "technology", "recognition"];
        const matchingTracks = trackNames.filter((t) => bonusSpaces.has(player.tracks[t].value));
        const payout = matchingTracks.length * 3;
        let nextState = { ...state, players: { ...state.players, [playerId]: { ...player, ventureCapitalistActive: true } } };
        if (payout > 0) {
          nextState = adjustWallet(nextState, playerId, payout, 0);
        }
        nextState = appendLog(nextState, {
          type: "SPECIALIST_EFFECT_VENTURE_CAPITALIST",
          playerId,
          catalogId: "SPEC_8",
          matchingTracks,
          payout,
          message: payout > 0 ? `${playerId} collects ${payout} PT for tracks currently on an odd space (${matchingTracks.join(", ")}) (The Venture Capitalist) \u2014 future track moves onto an odd space now also trigger +3 PT for the rest of the game.` : `${playerId} claims The Venture Capitalist \u2014 no tracks currently sit on an odd space, but future track moves onto an odd space now trigger +3 PT for the rest of the game.`
        });
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function handleSpec9(state, context) {
        const { playerId } = context;
        const nextState = { ...state, players: { ...state.players, [playerId]: { ...state.players[playerId], executiveOverdriveAvailable: true } } };
        return {
          state: appendLog(nextState, {
            type: "SPECIALIST_EFFECT_EXECUTIVE_OVERDRIVE_CLAIMED",
            playerId,
            catalogId: "SPEC_9",
            message: `${playerId} claims The Executive Overdrive \u2014 may resolve 1 Action Space twice back-to-back later this round (2nd activation free).`
          }),
          effectOutcome: DEFAULT_OUTCOME
        };
      }
      function handleSpec11(state, context) {
        const { playerId, extra } = context;
        const eligibleOpponents = Object.keys(state.players).filter((pid) => pid !== playerId).map((pid) => ({ playerId: pid, tech: state.players[pid].tracks.technology })).filter((p) => p.tech.branch === "A" || p.tech.branch === "B").filter((p) => p.tech.value >= 5);
        let chosenTargetPlayerId = extra && extra.targetPlayerId;
        let usedDefaultTarget = false;
        if (!chosenTargetPlayerId) {
          usedDefaultTarget = true;
          const sorted = [...eligibleOpponents].sort((a, b) => b.tech.value - a.tech.value);
          chosenTargetPlayerId = sorted[0] ? sorted[0].playerId : null;
        }
        if (!chosenTargetPlayerId || !state.players[chosenTargetPlayerId]) {
          return {
            state: appendLog(state, {
              type: "SPECIALIST_EFFECT_GHOST_IN_THE_MACHINE_SKIPPED",
              playerId,
              catalogId: "SPEC_11",
              reason: "NO_ELIGIBLE_OPPONENT",
              message: `${playerId} claims The Ghost in the Machine, but no opponent has reached Level 5 Technology yet \u2014 nothing to copy.`
            }),
            effectOutcome: DEFAULT_OUTCOME
          };
        }
        const targetTech = state.players[chosenTargetPlayerId].tracks.technology;
        if (targetTech.branch !== "A" && targetTech.branch !== "B") {
          return {
            state: appendLog(state, {
              type: "SPECIALIST_EFFECT_GHOST_IN_THE_MACHINE_SKIPPED",
              playerId,
              catalogId: "SPEC_11",
              reason: "TARGET_HAS_NO_LEVEL_5_BRANCH",
              message: `${playerId}'s Ghost in the Machine target has not reached a Level 5 Technology branch \u2014 nothing to copy.`
            }),
            effectOutcome: DEFAULT_OUTCOME
          };
        }
        const nextState = {
          ...state,
          players: {
            ...state.players,
            [playerId]: { ...state.players[playerId], ghostInTheMachineBorrowedBranch: targetTech.branch }
          }
        };
        const passiveName = targetTech.branch === "A" ? "Overtime Manager" : "Proprietary Algorithm";
        return {
          state: appendLog(nextState, {
            type: "SPECIALIST_EFFECT_GHOST_IN_THE_MACHINE",
            playerId,
            catalogId: "SPEC_11",
            targetPlayerId: chosenTargetPlayerId,
            copiedBranch: targetTech.branch,
            usedDefaultTarget,
            message: `${playerId}'s Ghost in the Machine copies ${chosenTargetPlayerId}'s Technology-${targetTech.branch} passive (${passiveName}) for the rest of this round.`
          }),
          effectOutcome: DEFAULT_OUTCOME
        };
      }
      function handleSpec12(state, context) {
        const { playerId, extra } = context;
        const player = state.players[playerId];
        const drawPile = state.board.decks && state.board.decks.agentDrawPile || [];
        const drawCount = Math.min(5, drawPile.length);
        const stash = drawPile.slice(0, drawCount).map((catalogId, i) => ({ stashInstanceId: `shell-${playerId}-${state.phase.round}-${i}`, catalogId }));
        const remainingDrawPile = drawPile.slice(drawCount);
        let nextState = {
          ...state,
          board: { ...state.board, decks: { ...state.board.decks, agentDrawPile: remainingDrawPile } },
          players: { ...state.players, [playerId]: { ...player, shellCompanyStash: stash, shellCompanyRecruitsUsed: 0 } }
        };
        nextState = appendLog(nextState, {
          type: "SPECIALIST_EFFECT_SHELL_COMPANY_DRAWN",
          playerId,
          catalogId: "SPEC_12",
          stashSize: stash.length,
          message: `${playerId} privately draws ${stash.length} Agent(s) into a hidden stash (The Shell Company).`
        });
        const chosenStashInstanceId = extra && extra.stashInstanceId ? extra.stashInstanceId : extra && extra.skipFirstRecruit ? null : (stash.slice().sort((a, b) => {
          const statsA = getAgentStats(nextState, a.catalogId);
          const statsB = getAgentStats(nextState, b.catalogId);
          return (statsB ? statsB.totalProfit : 0) - (statsA ? statsA.totalProfit : 0);
        })[0] || {}).stashInstanceId;
        const usedDefaultChoice = !(extra && (extra.stashInstanceId || extra.skipFirstRecruit));
        if (!chosenStashInstanceId) {
          return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
        }
        const stashEntry = stash.find((s) => s.stashInstanceId === chosenStashInstanceId);
        if (!stashEntry) {
          return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
        }
        if (!hasOpenDesk(nextState, playerId)) {
          nextState = appendLog(nextState, {
            type: "SPECIALIST_EFFECT_SHELL_COMPANY_FIRST_RECRUIT_SKIPPED",
            playerId,
            catalogId: "SPEC_12",
            reason: "NO_OPEN_DESK"
          });
          return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
        }
        nextState = addShellCompanyStashEntryToRoster(nextState, playerId, stashEntry);
        nextState = appendLog(nextState, {
          type: "SPECIALIST_EFFECT_SHELL_COMPANY_FIRST_RECRUIT",
          playerId,
          catalogId: "SPEC_12",
          recruitedCatalogId: stashEntry.catalogId,
          usedDefaultChoice,
          message: `${playerId} recruits ${stashEntry.catalogId} for free from the hidden stash (The Shell Company, 1st recruit \u2014 all requirements waived).`
        });
        return { state: nextState, effectOutcome: DEFAULT_OUTCOME };
      }
      function addShellCompanyStashEntryToRoster(state, playerId, stashEntry) {
        const player = state.players[playerId];
        const newEntry = {
          agentInstanceId: `agt-${playerId}-shell-${stashEntry.stashInstanceId}`,
          catalogId: stashEntry.catalogId,
          acquiredVia: "recruited",
          acquiredRound: state.phase.round,
          onboardingToken: { active: true, expiresEndOfRound: state.phase.round },
          loyaltyToken: { active: false },
          coachTokens: 0,
          isVoided: false
        };
        return {
          ...state,
          players: {
            ...state.players,
            [playerId]: {
              ...player,
              roster: [...player.roster, newEntry],
              shellCompanyStash: player.shellCompanyStash.filter((s) => s.stashInstanceId !== stashEntry.stashInstanceId),
              shellCompanyRecruitsUsed: player.shellCompanyRecruitsUsed + 1
            }
          }
        };
      }
      function resolveShellCompanySecondRecruit(state, playerId, stashInstanceId) {
        const player = state.players[playerId];
        if (!player) {
          return { state, error: "PLAYER_NOT_FOUND", detail: null };
        }
        if (player.shellCompanyRecruitsUsed >= 2) {
          return { state, error: "SHELL_COMPANY_RECRUIT_LIMIT_REACHED", detail: { recruitsUsed: player.shellCompanyRecruitsUsed } };
        }
        const stashEntry = (player.shellCompanyStash || []).find((s) => s.stashInstanceId === stashInstanceId);
        if (!stashEntry) {
          return { state, error: "STASH_ENTRY_NOT_FOUND", detail: { stashInstanceId } };
        }
        if (!hasOpenDesk(state, playerId)) {
          return { state, error: "NO_OPEN_DESK", detail: { deskUsed: computeDeskUsage(state, playerId), capacity: player.tracks.offices.unlocked } };
        }
        const agentStats = getAgentStats(state, stashEntry.catalogId);
        if (!agentStats) {
          return { state, error: "AGENT_CATALOG_ENTRY_NOT_FOUND", detail: { catalogId: stashEntry.catalogId } };
        }
        const matchCount = countMatchingValues(player.tracks, agentStats);
        if (matchCount < MIN_MATCHING_VALUES_TO_RECRUIT) {
          return { state, error: "INSUFFICIENT_MATCHING_VALUES", detail: { required: MIN_MATCHING_VALUES_TO_RECRUIT, matched: matchCount } };
        }
        let nextState = addShellCompanyStashEntryToRoster(state, playerId, stashEntry);
        nextState = appendLog(nextState, {
          type: "SPECIALIST_EFFECT_SHELL_COMPANY_SECOND_RECRUIT",
          playerId,
          catalogId: "SPEC_12",
          recruitedCatalogId: stashEntry.catalogId,
          message: `${playerId} recruits ${stashEntry.catalogId} from the hidden stash at normal requirements (The Shell Company, 2nd recruit).`
        });
        return { state: nextState, error: null, detail: null };
      }
      function handleSpec3(state, context) {
        const { playerId, extra } = context;
        const spacesByHub = {};
        (state.board.actionSpaces || []).forEach((s) => {
          if (!spacesByHub[s.hub]) spacesByHub[s.hub] = [];
          if (s.status !== "blocked" && s.status !== "void") spacesByHub[s.hub].push(s);
        });
        const availableHubs = Object.keys(spacesByHub).filter((hub) => spacesByHub[hub].length > 0);
        if (availableHubs.length === 0) {
          return { state, effectOutcome: DEFAULT_OUTCOME };
        }
        if (!extra || !extra.targetHub || !availableHubs.includes(extra.targetHub)) {
          return {
            state: {
              ...state,
              phase: {
                ...state.phase,
                pendingInterrupt: {
                  type: "ACTION_CARD_EFFECT_CHOICE",
                  sourcePlayerId: playerId,
                  data: { catalogId: "SPEC_3", choiceType: "SPEC3_HUB_TARGET", cardInstanceId: context.cardInstanceId, availableHubs, isSpecialistCardChoice: true }
                }
              }
            },
            effectOutcome: DEFAULT_OUTCOME
          };
        }
        const targetHub = extra.targetHub;
        const nextState = {
          ...state,
          board: {
            ...state.board,
            actionSpaces: state.board.actionSpaces.map((s) => s.hub === targetHub ? { ...s, status: "blocked", blockedByCatalogId: "SPEC_3", blockedUntilEndOfRound: state.phase.round } : s)
          },
          phase: { ...state.phase, pendingInterrupt: { type: "NULL", sourcePlayerId: null, data: {} } }
        };
        return {
          state: appendLog(nextState, { type: "SPECIALIST_EFFECT_LOBBYIST", playerId, catalogId: "SPEC_3", blockedHub: targetHub, message: `${playerId}'s Lobbyist blocks the ${targetHub} hub for the rest of the round.` }),
          effectOutcome: DEFAULT_OUTCOME
        };
      }
      function handleSpec4(state, context) {
        const { playerId, extra } = context;
        if (!extra || !extra.selectedCatalogIds) {
          const drawPile = state.board.decks && state.board.decks.agentDrawPile || [];
          const drawn = drawPile.slice(0, 5);
          const remainingDrawPile = drawPile.slice(5);
          if (drawn.length === 0) {
            return {
              state: appendLog(state, { type: "SPECIALIST_EFFECT_INSIDE_SOURCE_SKIPPED", playerId, catalogId: "SPEC_4", reason: "AGENT_DECK_EMPTY" }),
              effectOutcome: DEFAULT_OUTCOME
            };
          }
          return {
            state: {
              ...state,
              board: { ...state.board, decks: { ...state.board.decks, agentDrawPile: remainingDrawPile } },
              phase: {
                ...state.phase,
                pendingInterrupt: {
                  type: "ACTION_CARD_EFFECT_CHOICE",
                  sourcePlayerId: playerId,
                  data: { catalogId: "SPEC_4", choiceType: "SPEC4_AGENT_SELECTION", cardInstanceId: context.cardInstanceId, drawnCatalogIds: drawn, isSpecialistCardChoice: true }
                }
              }
            },
            effectOutcome: DEFAULT_OUTCOME
          };
        }
        const interrupt = state.phase.pendingInterrupt;
        const drawnCatalogIds = interrupt && interrupt.data && interrupt.data.drawnCatalogIds || [];
        const selected = (extra.selectedCatalogIds || []).filter((id) => drawnCatalogIds.includes(id)).slice(0, 2);
        const unselected = drawnCatalogIds.filter((id) => !selected.includes(id));
        let nextState = { ...state, phase: { ...state.phase, pendingInterrupt: { type: "NULL", sourcePlayerId: null, data: {} } } };
        const recruited = [];
        for (const catalogId of selected) {
          const player = nextState.players[playerId];
          const capacity = player.tracks.offices.unlocked;
          const activeCount = player.roster.filter((r) => !r.isVoided).length;
          if (activeCount >= capacity) break;
          const newEntry = {
            agentInstanceId: `agt-${playerId}-insidesource-${catalogId}-${activeCount}`,
            catalogId,
            acquiredVia: "recruited",
            acquiredRound: nextState.phase.round,
            onboardingToken: { active: true, expiresEndOfRound: nextState.phase.round },
            loyaltyToken: { active: false },
            coachTokens: 0,
            isVoided: false
          };
          nextState = { ...nextState, players: { ...nextState.players, [playerId]: { ...player, roster: [...player.roster, newEntry] } } };
          recruited.push(catalogId);
        }
        const returnedToBottom = [...unselected, ...selected.filter((id) => !recruited.includes(id))];
        nextState = { ...nextState, board: { ...nextState.board, decks: { ...nextState.board.decks, agentDrawPile: [...nextState.board.decks.agentDrawPile, ...returnedToBottom] } } };
        return {
          state: appendLog(nextState, { type: "SPECIALIST_EFFECT_INSIDE_SOURCE", playerId, catalogId: "SPEC_4", recruited, message: `${playerId}'s Inside Source recruits ${recruited.length ? recruited.join(", ") : "no one"}; the rest return to the bottom of the deck.` }),
          effectOutcome: DEFAULT_OUTCOME
        };
      }
      function handleSpec7(state, context) {
        const { playerId } = context;
        const defaultSpaceId = "OPS_TRAINING";
        const nextState = { ...state, players: { ...state.players, [playerId]: { ...state.players[playerId], copiedActionSpaceId: defaultSpaceId, automationEngineerUsedThisRound: false } } };
        return {
          state: appendLog(nextState, { type: "SPECIALIST_EFFECT_AUTOMATION_ENGINEER_CLAIMED", playerId, catalogId: "SPEC_7", copiedSpaceId: defaultSpaceId, message: `${playerId} claims The Automation Engineer, copying ${defaultSpaceId} \u2014 once-per-round free trigger is not yet enforced by this engine.` }),
          effectOutcome: DEFAULT_OUTCOME
        };
      }
      function handleSpec10(state, context) {
        const { playerId } = context;
        const player = state.players[playerId];
        const trackNames = ["training", "technology", "recognition"];
        const sorted = [...trackNames].sort((a, b) => player.tracks[a].value - player.tracks[b].value);
        const bridged = sorted.slice(0, 2);
        const nextState = { ...state, players: { ...state.players, [playerId]: { ...player, bridgedTracks: bridged, bridgedTracksUntilRound: state.phase.round } } };
        return {
          state: appendLog(nextState, { type: "SPECIALIST_EFFECT_CORPORATE_MERGER", playerId, catalogId: "SPEC_10", bridgedTracks: bridged, message: `${playerId}'s Corporate Merger bridges ${bridged.join(" and ")} for the round \u2014 advancing either track now auto-advances the other.` }),
          effectOutcome: DEFAULT_OUTCOME
        };
      }
      function handleSpec13(state, context) {
        const { playerId } = context;
        const nextState = { ...state, session: { ...state.session, guaranteedFirstPlayerNextRound: playerId } };
        return {
          state: appendLog(nextState, { type: "SPECIALIST_EFFECT_HOSTILE_TAKEOVER_CLAIMED", playerId, catalogId: "SPEC_13", message: `${playerId} claims The Hostile Takeover \u2014 guaranteed 1st player next round is written, but the extra back-to-back turn is not yet enforced by this engine.` }),
          effectOutcome: DEFAULT_OUTCOME
        };
      }
      module.exports = {
        resetSpecialistCardInstanceCounter,
        handleSpec1,
        handleSpec2,
        handleSpec5,
        handleSpec6,
        handleSpec8,
        handleSpec9,
        handleSpec11,
        handleSpec12,
        handleSpec3,
        handleSpec4,
        handleSpec7,
        handleSpec10,
        handleSpec13,
        resolveShellCompanySecondRecruit,
        performCleanSlateTrashAndDraw,
        // Exported for tests only — not part of the public handler contract.
        __testables: {
          getNextOpponentId,
          drawOneActionCardCatalogId
        }
      };
    }
  });

  // cardEffectRegistry.js
  var require_cardEffectRegistry = __commonJS({
    "cardEffectRegistry.js"(exports, module) {
      var { engineConfig } = require_engineConfig();
      var growthHandlers = require_growth();
      var strategyHandlers = require_strategy();
      var influenceHandlers = require_influence();
      var startHandlers = require_start();
      var shiftCardHandlerModule = require_shiftCards();
      var specialistCardHandlerModule = require_specialistCards();
      var actionCardHandlers = {
        // Start family (S1-S7)
        S1: startHandlers.handleS1,
        S2: startHandlers.handleS2,
        S3: startHandlers.handleS3,
        S4: startHandlers.handleS4,
        S5: startHandlers.handleS5,
        S6: startHandlers.handleS6,
        S7: startHandlers.handleS7,
        // Growth family
        GRW_001: growthHandlers.handleGrw001,
        GRW_002: growthHandlers.handleGrw002,
        GRW_003: growthHandlers.handleGrw003,
        GRW_005: growthHandlers.handleGrw005,
        GRW_008: growthHandlers.handleGrw008,
        GRW_004: growthHandlers.handleGrw004,
        GRW_006: growthHandlers.handleGrw006,
        GRW_007: growthHandlers.handleGrw007,
        GRW_009: growthHandlers.handleGrw009,
        GRW_010: growthHandlers.handleGrw010,
        GRW_011: growthHandlers.handleGrw011,
        GRW_012: growthHandlers.handleGrw012,
        GRW_013: growthHandlers.handleGrw013,
        GRW_014: growthHandlers.handleGrw014,
        GRW_015: growthHandlers.handleGrw015,
        GRW_016: growthHandlers.handleGrw016,
        GRW_017: growthHandlers.handleGrw017,
        GRW_018: growthHandlers.handleGrw018,
        GRW_019: growthHandlers.handleGrw019,
        GRW_020: growthHandlers.handleGrw020,
        GRW_021: growthHandlers.handleGrw021,
        GRW_022: growthHandlers.handleGrw022,
        GRW_023: growthHandlers.handleGrw023,
        GRW_024: growthHandlers.handleGrw024,
        GRW_025: growthHandlers.handleGrw025,
        GRW_026: growthHandlers.handleGrw026,
        GRW_027: growthHandlers.handleGrw027,
        GRW_028: growthHandlers.handleGrw028,
        GRW_029: growthHandlers.handleGrw029,
        GRW_030: growthHandlers.handleGrw030,
        GRW_031: growthHandlers.handleGrw031,
        GRW_032: growthHandlers.handleGrw032,
        GRW_033: growthHandlers.handleGrw033,
        GRW_034: growthHandlers.handleGrw034,
        GRW_035: growthHandlers.handleGrw035,
        GRW_036: growthHandlers.handleGrw036,
        GRW_037: growthHandlers.handleGrw037,
        GRW_038: growthHandlers.handleGrw038,
        GRW_039: growthHandlers.handleGrw039,
        GRW_040: growthHandlers.handleGrw040,
        GRW_041: growthHandlers.handleGrw041,
        GRW_042: growthHandlers.handleGrw042,
        GRW_043: growthHandlers.handleGrw043,
        GRW_044: growthHandlers.handleGrw044,
        GRW_045: growthHandlers.handleGrw045,
        GRW_046: growthHandlers.handleGrw046,
        GRW_047: growthHandlers.handleGrw047,
        GRW_048: growthHandlers.handleGrw048,
        GRW_049: growthHandlers.handleGrw049,
        GRW_050: growthHandlers.handleGrw050,
        GRW_051: growthHandlers.handleGrw051,
        GRW_052: growthHandlers.handleGrw052,
        GRW_053: growthHandlers.handleGrw053,
        GRW_054: growthHandlers.handleGrw054,
        GRW_055: growthHandlers.handleGrw055,
        GRW_056: growthHandlers.handleGrw056,
        GRW_057: growthHandlers.handleGrw057,
        GRW_058: growthHandlers.handleGrw058,
        GRW_059: growthHandlers.handleGrw059,
        GRW_060: growthHandlers.handleGrw060,
        GRW_061: growthHandlers.handleGrw061,
        GRW_062: growthHandlers.handleGrw062,
        GRW_063: growthHandlers.handleGrw063,
        GRW_064: growthHandlers.handleGrw064,
        GRW_065: growthHandlers.handleGrw065,
        GRW_066: growthHandlers.handleGrw066,
        GRW_067: growthHandlers.handleGrw067,
        GRW_068: growthHandlers.handleGrw068,
        GRW_069: growthHandlers.handleGrw069,
        // Strategy family
        STR_070: strategyHandlers.handleStr070,
        STR_071: strategyHandlers.handleStr071,
        STR_072: strategyHandlers.handleStr072,
        STR_073: strategyHandlers.handleStr073,
        STR_074: strategyHandlers.handleStr074,
        STR_075: strategyHandlers.handleStr075,
        STR_076: strategyHandlers.handleStr076,
        STR_077: strategyHandlers.handleStr077,
        STR_078: strategyHandlers.handleStr078,
        STR_079: strategyHandlers.handleStr079,
        STR_080: strategyHandlers.handleStr080,
        STR_085: strategyHandlers.handleStr085,
        STR_086: strategyHandlers.handleStr086,
        STR_088: strategyHandlers.handleStr088,
        STR_090: strategyHandlers.handleStr090,
        STR_091: strategyHandlers.handleStr091,
        STR_092: strategyHandlers.handleStr092,
        STR_094: strategyHandlers.handleStr094,
        STR_082: strategyHandlers.handleStr082,
        STR_083: strategyHandlers.handleStr083,
        STR_089: strategyHandlers.handleStr089,
        STR_093: strategyHandlers.handleStr093,
        // Influence family
        INF_096: influenceHandlers.handleInf096,
        INF_111: influenceHandlers.handleInf111,
        INF_095: influenceHandlers.handleInf095,
        INF_097: influenceHandlers.handleInf097,
        INF_099: influenceHandlers.handleInf099,
        INF_100: influenceHandlers.handleInf100,
        INF_103: influenceHandlers.handleInf103,
        INF_105: influenceHandlers.handleInf105,
        INF_107: influenceHandlers.handleInf107,
        INF_108: influenceHandlers.handleInf108,
        INF_110: influenceHandlers.handleInf110,
        INF_113: influenceHandlers.handleInf113,
        INF_114: influenceHandlers.handleInf114,
        INF_102: influenceHandlers.handleInf102,
        INF_109: influenceHandlers.handleInf109,
        INF_104: influenceHandlers.handleInf104,
        INF_098: influenceHandlers.handleInf098,
        INF_101: influenceHandlers.handleInf101,
        INF_106: influenceHandlers.handleInf106,
        INF_112: influenceHandlers.handleInf112
      };
      var shiftCardHandlers = {
        SFT_002: shiftCardHandlerModule.handleSft002,
        SFT_004: shiftCardHandlerModule.handleSft004,
        SFT_029: shiftCardHandlerModule.handleSft029,
        SFT_038: shiftCardHandlerModule.handleSft038,
        SFT_042: shiftCardHandlerModule.handleSft042,
        SFT_043: shiftCardHandlerModule.handleSft043,
        SFT_044: shiftCardHandlerModule.handleSft044,
        SFT_005: shiftCardHandlerModule.handleSft005,
        SFT_006: shiftCardHandlerModule.handleSft006,
        SFT_009: shiftCardHandlerModule.handleSft009,
        SFT_013: shiftCardHandlerModule.handleSft013,
        SFT_015: shiftCardHandlerModule.handleSft015,
        SFT_019: shiftCardHandlerModule.handleSft019,
        SFT_020: shiftCardHandlerModule.handleSft020,
        SFT_027: shiftCardHandlerModule.handleSft027,
        SFT_033: shiftCardHandlerModule.handleSft033,
        SFT_040: shiftCardHandlerModule.handleSft040,
        SFT_047: shiftCardHandlerModule.handleSft047,
        SFT_008: shiftCardHandlerModule.handleSft008,
        SFT_010: shiftCardHandlerModule.handleSft010,
        SFT_011: shiftCardHandlerModule.handleSft011,
        SFT_014: shiftCardHandlerModule.handleSft014,
        SFT_017: shiftCardHandlerModule.handleSft017,
        SFT_021: shiftCardHandlerModule.handleSft021,
        SFT_025: shiftCardHandlerModule.handleSft025,
        SFT_030: shiftCardHandlerModule.handleSft030,
        SFT_031: shiftCardHandlerModule.handleSft031,
        SFT_041: shiftCardHandlerModule.handleSft041,
        SFT_046: shiftCardHandlerModule.handleSft046,
        SFT_051: shiftCardHandlerModule.handleSft051,
        SFT_052: shiftCardHandlerModule.handleSft052,
        SFT_001: shiftCardHandlerModule.handleSft001,
        SFT_003: shiftCardHandlerModule.handleSft003,
        SFT_007: shiftCardHandlerModule.handleSft007,
        SFT_012: shiftCardHandlerModule.handleSft012,
        SFT_016: shiftCardHandlerModule.handleSft016,
        SFT_018: shiftCardHandlerModule.handleSft018,
        SFT_022: shiftCardHandlerModule.handleSft022,
        SFT_023: shiftCardHandlerModule.handleSft023,
        SFT_024: shiftCardHandlerModule.handleSft024,
        SFT_026: shiftCardHandlerModule.handleSft026,
        SFT_032: shiftCardHandlerModule.handleSft032,
        SFT_034: shiftCardHandlerModule.handleSft034,
        SFT_035: shiftCardHandlerModule.handleSft035,
        SFT_036: shiftCardHandlerModule.handleSft036,
        SFT_037: shiftCardHandlerModule.handleSft037,
        SFT_039: shiftCardHandlerModule.handleSft039,
        SFT_045: shiftCardHandlerModule.handleSft045,
        SFT_048: shiftCardHandlerModule.handleSft048,
        SFT_049: shiftCardHandlerModule.handleSft049,
        SFT_050: shiftCardHandlerModule.handleSft050,
        SFT_028: shiftCardHandlerModule.handleSft028
      };
      var specialistCardHandlers = {
        SPEC_1: specialistCardHandlerModule.handleSpec1,
        SPEC_2: specialistCardHandlerModule.handleSpec2,
        SPEC_5: specialistCardHandlerModule.handleSpec5,
        SPEC_6: specialistCardHandlerModule.handleSpec6,
        SPEC_8: specialistCardHandlerModule.handleSpec8,
        SPEC_9: specialistCardHandlerModule.handleSpec9,
        SPEC_11: specialistCardHandlerModule.handleSpec11,
        SPEC_12: specialistCardHandlerModule.handleSpec12,
        SPEC_3: specialistCardHandlerModule.handleSpec3,
        SPEC_4: specialistCardHandlerModule.handleSpec4,
        SPEC_7: specialistCardHandlerModule.handleSpec7,
        SPEC_10: specialistCardHandlerModule.handleSpec10,
        SPEC_13: specialistCardHandlerModule.handleSpec13
      };
      function appendLog(state, entry) {
        const logEntry = {
          seq: state.log.length + 1,
          timestamp: (/* @__PURE__ */ new Date()).toISOString(),
          round: state.phase.round,
          ...entry
        };
        return { ...state, log: [...state.log, logEntry] };
      }
      var UnimplementedCardEffectError = class extends Error {
        constructor(catalogId, cardInstanceId, playerId, cardFamily) {
          super(
            `[CardEffectRegistry] STRICT_CARD_RESOLUTION: no handler registered for catalogId "${catalogId}" (family: ${cardFamily}, cardInstanceId: ${cardInstanceId}, playerId: ${playerId}).`
          );
          this.name = "UnimplementedCardEffectError";
          this.catalogId = catalogId;
          this.cardInstanceId = cardInstanceId;
          this.playerId = playerId;
          this.cardFamily = cardFamily;
        }
      };
      function defaultFallbackHandler(state, context) {
        console.warn(
          `[CardEffectRegistry] No handler registered for catalogId "${context.catalogId}" (cardInstanceId: ${context.cardInstanceId}, playerId: ${context.playerId}). Effect not implemented yet \u2014 state left unchanged.`
        );
        const nextState = appendLog(state, {
          type: "CARD_EFFECT_NOT_IMPLEMENTED",
          catalogId: context.catalogId,
          cardInstanceId: context.cardInstanceId,
          playerId: context.playerId
        });
        return {
          state: nextState,
          effectOutcome: { skipDefaultDiscard: false, customDestination: null }
        };
      }
      function dispatchCardEffect(table, cardFamily, state, playerId, catalogId, cardInstanceId, extra) {
        const handler = table[catalogId];
        if (!handler) {
          if (engineConfig.STRICT_CARD_RESOLUTION) {
            throw new UnimplementedCardEffectError(catalogId, cardInstanceId, playerId, cardFamily);
          }
          const context2 = { playerId, catalogId, cardInstanceId, extra: extra || null };
          const result2 = defaultFallbackHandler(state, context2);
          result2.state.pendingEffectOutcome = result2.effectOutcome;
          return result2.state;
        }
        const context = { playerId, catalogId, cardInstanceId, extra: extra || null };
        const result = handler(state, context);
        const effectOutcome = result.effectOutcome || { skipDefaultDiscard: false, customDestination: null };
        let nextState = result.state;
        nextState = { ...nextState, pendingEffectOutcome: effectOutcome };
        return nextState;
      }
      function resolveActionCardEffect(state, playerId, catalogId, cardInstanceId, extra = null) {
        return dispatchCardEffect(
          actionCardHandlers,
          "actionCard",
          state,
          playerId,
          catalogId,
          cardInstanceId,
          extra
        );
      }
      function resolveShiftCardEffect(state, playerId, catalogId, cardInstanceId, extra = null) {
        return dispatchCardEffect(
          shiftCardHandlers,
          "shiftCard",
          state,
          playerId,
          catalogId,
          cardInstanceId,
          extra
        );
      }
      function resolveSpecialistCardEffect(state, playerId, catalogId, cardInstanceId, extra = null) {
        return dispatchCardEffect(
          specialistCardHandlers,
          "specialistCard",
          state,
          playerId,
          catalogId,
          cardInstanceId,
          extra
        );
      }
      module.exports = {
        resolveActionCardEffect,
        resolveShiftCardEffect,
        resolveSpecialistCardEffect,
        UnimplementedCardEffectError,
        // Exported for tests only — reducers must never import these tables
        // directly (spec §2: "they never import individual handler files
        // directly, and they never import cardEffectHelpers.js directly").
        __testables: {
          actionCardHandlers,
          shiftCardHandlers,
          specialistCardHandlers,
          defaultFallbackHandler
        }
      };
    }
  });

  // shiftReducer.js
  var require_shiftReducer = __commonJS({
    "shiftReducer.js"(exports, module) {
      var { playerHasShiftImmunity } = require_immunityReducer();
      var { getSharedRng } = require_cardEffectHelpers();
      var NULL_INTERRUPT = { type: "NULL", sourcePlayerId: null, data: {} };
      function appendLog(state, entry) {
        const logEntry = {
          seq: state.log.length + 1,
          timestamp: (/* @__PURE__ */ new Date()).toISOString(),
          round: state.phase.round,
          ...entry
        };
        return { ...state, log: [...state.log, logEntry] };
      }
      function drawTopCard(drawPile) {
        if (!drawPile || drawPile.length === 0) return null;
        return drawPile[0];
      }
      function applyShiftCardEffect(state, playerId, drawnCard) {
        let resolveShiftCardEffect;
        try {
          ({ resolveShiftCardEffect } = require_cardEffectRegistry());
        } catch (e) {
          resolveShiftCardEffect = null;
        }
        if (typeof resolveShiftCardEffect === "function") {
          return resolveShiftCardEffect(state, playerId, drawnCard.catalogId);
        }
        return appendLog(state, {
          type: "CARD_EFFECT_NOT_IMPLEMENTED",
          playerId,
          catalogId: drawnCard.catalogId,
          context: "shiftCard"
        });
      }
      function reshuffleDiscardIntoDrawPile(shiftDeck) {
        const rng = getSharedRng();
        const shuffled = [...shiftDeck.discardPile];
        for (let i = shuffled.length - 1; i > 0; i -= 1) {
          const j = Math.floor(rng() * (i + 1));
          [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        const shuffledCards = shuffled.map((catalogId) => ({ catalogId }));
        return { drawPile: shuffledCards, discardPile: [] };
      }
      function resolveShiftTrigger(state) {
        if (state.shiftTracker.position < state.shiftTracker.max) {
          return state;
        }
        let { shiftDeck } = state;
        let drawnCard = drawTopCard(shiftDeck.drawPile);
        let remainingDrawPile = shiftDeck.drawPile.slice(1);
        if (drawnCard === null) {
          const reshuffled = reshuffleDiscardIntoDrawPile(shiftDeck);
          shiftDeck = { ...shiftDeck, ...reshuffled };
          drawnCard = drawTopCard(shiftDeck.drawPile);
          remainingDrawPile = shiftDeck.drawPile.slice(1);
        }
        if (drawnCard === null) {
          let nextState = appendLog(state, {
            type: "SHIFT_DECK_EMPTY_NO_CARD_DRAWN",
            sourcePlayerId: state.phase.activePlayerId
          });
          nextState = {
            ...nextState,
            shiftTracker: { ...nextState.shiftTracker, position: nextState.shiftTracker.min }
          };
          return nextState;
        }
        return {
          ...state,
          shiftDeck: { ...shiftDeck, drawPile: remainingDrawPile },
          phase: {
            ...state.phase,
            pendingInterrupt: {
              type: "SHIFT_CARD_RESOLUTION",
              sourcePlayerId: state.phase.activePlayerId,
              data: { drawnCardCatalogId: drawnCard.catalogId, stage: "announcement" }
            }
          }
        };
      }
      function resolveShiftEffectStage2(state, playerId) {
        const interrupt = state.phase.pendingInterrupt;
        if (!interrupt || interrupt.type !== "SHIFT_CARD_RESOLUTION" || interrupt.data.stage !== "announcement") {
          return { state, error: "NO_PENDING_SHIFT_ANNOUNCEMENT", detail: { pendingInterrupt: interrupt || null } };
        }
        if (playerId !== interrupt.sourcePlayerId) {
          return { state, error: "NOT_YOUR_SHIFT_CARD_TO_RESOLVE", detail: { expected: interrupt.sourcePlayerId, actual: playerId } };
        }
        const drawnCard = { catalogId: interrupt.data.drawnCardCatalogId };
        const seatPlayerIds = state.session.seats.map((s) => s.playerId);
        const triggeringPlayerId = interrupt.sourcePlayerId;
        const logLengthBeforeEffect = state.log.length;
        let nextState = applyShiftCardEffect(state, triggeringPlayerId, drawnCard);
        seatPlayerIds.forEach((pid) => {
          const player = nextState.players[pid];
          if (playerHasShiftImmunity(player)) {
            nextState = appendLog(nextState, { type: "SHIFT_EFFECT_BLOCKED_BY_IMMUNITY", playerId: pid, catalogId: drawnCard.catalogId });
          } else {
            nextState = appendLog(nextState, { type: "SHIFT_EFFECT_APPLIED", playerId: pid, catalogId: drawnCard.catalogId });
          }
        });
        nextState = {
          ...nextState,
          shiftDeck: { ...nextState.shiftDeck, discardPile: [...nextState.shiftDeck.discardPile, drawnCard.catalogId] },
          shiftTracker: {
            ...nextState.shiftTracker,
            position: nextState.shiftTracker.min,
            history: [
              ...nextState.shiftTracker.history || [],
              { round: nextState.phase.round, triggeredByPlayerId: triggeringPlayerId, shiftCardCatalogId: drawnCard.catalogId, resolvedAt: (/* @__PURE__ */ new Date()).toISOString() }
            ]
          },
          phase: {
            ...nextState.phase,
            pendingInterrupt: {
              type: "SHIFT_CARD_RESOLUTION",
              sourcePlayerId: triggeringPlayerId,
              data: { drawnCardCatalogId: drawnCard.catalogId, stage: "consequences", consequencesLogEntries: nextState.log.slice(logLengthBeforeEffect) }
            }
          }
        };
        return { state: nextState, error: null, detail: null };
      }
      function acknowledgeShiftCardResolution(state, playerId) {
        const interrupt = state.phase.pendingInterrupt;
        if (!interrupt || interrupt.type !== "SHIFT_CARD_RESOLUTION" || interrupt.data.stage !== "consequences") {
          return { state, error: "NO_PENDING_SHIFT_CARD_ACKNOWLEDGMENT", detail: { pendingInterrupt: interrupt || null } };
        }
        if (playerId !== interrupt.sourcePlayerId) {
          return { state, error: "NOT_YOUR_ACKNOWLEDGMENT_TO_GIVE", detail: { expected: interrupt.sourcePlayerId, actual: playerId } };
        }
        const nextState = { ...state, phase: { ...state.phase, pendingInterrupt: NULL_INTERRUPT } };
        return { state: nextState, error: null, detail: null };
      }
      module.exports = {
        resolveShiftTrigger,
        resolveShiftEffectStage2,
        drawTopCard,
        reshuffleDiscardIntoDrawPile,
        applyShiftCardEffect,
        acknowledgeShiftCardResolution
      };
    }
  });

  // workerPlacementValidation.js
  var require_workerPlacementValidation = __commonJS({
    "workerPlacementValidation.js"(exports, module) {
      function verifyActivePlayer(state, playerId) {
        const player = state.players[playerId];
        if (!player) {
          return { ok: false, error: "PLAYER_NOT_FOUND", detail: { playerId } };
        }
        if (state.phase.activePlayerId !== playerId) {
          return {
            ok: false,
            error: "NOT_ACTIVE_PLAYER",
            detail: { playerId, activePlayerId: state.phase.activePlayerId }
          };
        }
        return { ok: true, player };
      }
      function verifyMeepleAvailable(state, playerId, meepleInstanceId) {
        const player = state.players[playerId];
        if (!player) {
          return { ok: false, error: "PLAYER_NOT_FOUND", detail: { playerId } };
        }
        const meeple = player.timeMeeples.active.find((m) => m.instanceId === meepleInstanceId) || (player.timeMeeples.copycatMeeple && player.timeMeeples.copycatMeeple.instanceId === meepleInstanceId ? player.timeMeeples.copycatMeeple : void 0);
        if (meeple === void 0) {
          return { ok: false, error: "MEEPLE_NOT_FOUND", detail: { meepleInstanceId } };
        }
        if (meeple.status !== "in_supply") {
          return {
            ok: false,
            error: "MEEPLE_NOT_IN_SUPPLY",
            detail: { meepleInstanceId, currentStatus: meeple.status }
          };
        }
        return { ok: true, meeple };
      }
      function cardGrantsSpaceSharing(state, playerId, extra) {
        if (!extra || extra.useOvertimeManager !== true) {
          return false;
        }
        const player = state.players[playerId];
        if (!player) {
          return false;
        }
        const tech = player.tracks.technology;
        const hasAbility = tech.branch === "A" && tech.value >= 5 || player.ghostInTheMachineBorrowedBranch === "A";
        const alreadyUsed = player.oncePerRoundAbilitiesUsed.includes("OVERTIME_MANAGER");
        const canAfford = player.wallet.profitTokens >= 2;
        return hasAbility && !alreadyUsed && canAfford;
      }
      function meepleIsCopycatBypass(player, meeple) {
        return !!(player.timeMeeples.copycatMeeple && meeple && meeple.instanceId === player.timeMeeples.copycatMeeple.instanceId);
      }
      function verifySpaceOpen(state, spaceId, playerId, extra, meeple = null) {
        const space = state.board.actionSpaces.find((s) => s.spaceId === spaceId);
        if (space === void 0) {
          return { ok: false, error: "SPACE_NOT_FOUND", detail: { spaceId } };
        }
        if (space.status === "blocked" || space.status === "void") {
          return { ok: false, error: "SPACE_BLOCKED", detail: { spaceId, status: space.status } };
        }
        const effectiveCapacity = space.capacityScalesWithPlayerCount ? Math.max(1, (state.settings.playerCount || 2) - 1) : space.capacity;
        if (effectiveCapacity !== null && space.occupiedBy.length >= effectiveCapacity) {
          const player = state.players[playerId];
          const allowsSharing = cardGrantsSpaceSharing(state, playerId, extra) || meepleIsCopycatBypass(player, meeple);
          if (!allowsSharing) {
            return {
              ok: false,
              error: "SPACE_AT_CAPACITY",
              detail: {
                spaceId,
                capacity: effectiveCapacity,
                currentOccupants: space.occupiedBy.length
              }
            };
          }
        }
        return { ok: true, space };
      }
      function verifyCanAffordSpace(state, playerId, space) {
        const cost = space.cost;
        if (!cost) {
          return { ok: true };
        }
        const wallet = state.players[playerId].wallet;
        const requiredProfit = cost.profitTokens || 0;
        const requiredPriority = cost.priorityTokens || 0;
        if (wallet.profitTokens < requiredProfit || wallet.priorityTokens < requiredPriority) {
          return {
            ok: false,
            error: "INSUFFICIENT_FUNDS_FOR_PLACEMENT",
            detail: {
              spaceId: space.spaceId,
              required: { profitTokens: requiredProfit, priorityTokens: requiredPriority },
              available: { profitTokens: wallet.profitTokens, priorityTokens: wallet.priorityTokens }
            }
          };
        }
        return { ok: true };
      }
      function verifySpecialistHubNotSpent(state, spaceId) {
        const statusTokens = state.board.statusTokens || [];
        const spentToken = statusTokens.find(
          (t) => t.targetType === "action_space" && t.targetId === spaceId && t.type === "EXECUTED"
        );
        if (spentToken) {
          return {
            ok: false,
            error: "SPECIALIST_HUB_ALREADY_SPENT",
            detail: { spaceId, tokenId: spentToken.tokenId, placedRound: spentToken.placedRound }
          };
        }
        return { ok: true };
      }
      function verifyMeepleCommitment(state, playerId, space, meeple, extra) {
        const meepleCost = space.cost && space.cost.meepleCost;
        if (!meepleCost) {
          return { ok: true, additionalMeeples: [] };
        }
        const player = state.players[playerId];
        const additionalIds = extra && extra.additionalMeepleInstanceIds || [];
        if (additionalIds.includes(meeple.instanceId)) {
          return {
            ok: false,
            error: "DUPLICATE_MEEPLE_IN_COMMITMENT",
            detail: { meepleInstanceId: meeple.instanceId }
          };
        }
        if (new Set(additionalIds).size !== additionalIds.length) {
          return {
            ok: false,
            error: "DUPLICATE_MEEPLE_IN_COMMITMENT",
            detail: { additionalMeepleInstanceIds: additionalIds }
          };
        }
        const totalCommitted = 1 + additionalIds.length;
        if (totalCommitted !== meepleCost) {
          return {
            ok: false,
            error: "INCORRECT_MEEPLE_COMMITMENT_COUNT",
            detail: { spaceId: space.spaceId, required: meepleCost, provided: totalCommitted }
          };
        }
        const additionalMeeples = [];
        for (let i = 0; i < additionalIds.length; i += 1) {
          const id = additionalIds[i];
          const m = player.timeMeeples.active.find((mm) => mm.instanceId === id);
          if (!m) {
            return { ok: false, error: "MEEPLE_NOT_FOUND", detail: { meepleInstanceId: id } };
          }
          if (m.status !== "in_supply") {
            return {
              ok: false,
              error: "MEEPLE_NOT_IN_SUPPLY",
              detail: { meepleInstanceId: id, currentStatus: m.status }
            };
          }
          additionalMeeples.push(m);
        }
        return { ok: true, additionalMeeples };
      }
      function verifySpecialistAction(state, playerId, space, meeple, extra) {
        if (space.type === "specialist_action") {
          const lockoutCheck = verifySpecialistHubNotSpent(state, space.spaceId);
          if (!lockoutCheck.ok) {
            return lockoutCheck;
          }
        }
        return verifyMeepleCommitment(state, playerId, space, meeple, extra);
      }
      function validatePlacement(state, playerId, meepleInstanceId, spaceId, extra) {
        if (state.phase.current !== "WORKER_PLACEMENT") {
          return {
            ok: false,
            error: "WRONG_PHASE",
            detail: { expected: "WORKER_PLACEMENT", actual: state.phase.current }
          };
        }
        if (state.phase.pendingInterrupt && state.phase.pendingInterrupt.type !== "NULL") {
          return {
            ok: false,
            error: "PENDING_INTERRUPT_ACTIVE",
            detail: { pendingInterrupt: state.phase.pendingInterrupt }
          };
        }
        const activePlayerCheck = verifyActivePlayer(state, playerId);
        if (!activePlayerCheck.ok) {
          return activePlayerCheck;
        }
        const supplyCheck = verifyMeepleAvailable(state, playerId, meepleInstanceId);
        if (!supplyCheck.ok) {
          return supplyCheck;
        }
        const spaceCheck = verifySpaceOpen(state, spaceId, playerId, extra, supplyCheck.meeple);
        if (!spaceCheck.ok) {
          return spaceCheck;
        }
        const affordCheck = verifyCanAffordSpace(state, playerId, spaceCheck.space);
        if (!affordCheck.ok) {
          return affordCheck;
        }
        const specialistCheck = verifySpecialistAction(state, playerId, spaceCheck.space, supplyCheck.meeple, extra);
        if (!specialistCheck.ok) {
          return specialistCheck;
        }
        return {
          ok: true,
          meeple: supplyCheck.meeple,
          space: spaceCheck.space,
          additionalMeeples: specialistCheck.additionalMeeples || []
        };
      }
      module.exports = {
        validatePlacement,
        verifyActivePlayer,
        verifyMeepleAvailable,
        verifySpaceOpen,
        verifyCanAffordSpace,
        verifySpecialistAction,
        verifySpecialistHubNotSpent,
        verifyMeepleCommitment,
        cardGrantsSpaceSharing
      };
    }
  });

  // workerPlacementReducer.js
  var require_workerPlacementReducer = __commonJS({
    "workerPlacementReducer.js"(exports, module) {
      var { adjustWallet, adjustTrack, awardMeeple, adjustOfficeSlots, hireStaff, adjustMarketShare, wipeAndRefillActionCardMarket, wipeAndRefillAgentMarket } = require_cardEffectHelpers();
      var { MARKET_SHARE_TRACK_SPACES } = require_boardConfigLoader();
      var { checkTrackMilestonesIfEligible, checkGlobalFirstToMilestones } = require_techTrackReducer();
      var {
        validatePlacement,
        verifyActivePlayer,
        verifyMeepleAvailable,
        verifySpaceOpen,
        verifyCanAffordSpace,
        verifySpecialistAction,
        cardGrantsSpaceSharing
      } = require_workerPlacementValidation();
      var { resolveSpecialistCardEffect } = require_cardEffectRegistry();
      function appendLog(state, entry) {
        const logEntry = {
          seq: state.log.length + 1,
          timestamp: (/* @__PURE__ */ new Date()).toISOString(),
          round: state.phase.round,
          ...entry
        };
        return {
          ...state,
          log: [...state.log, logEntry]
        };
      }
      var IMMEDIATE_SPACE_TYPES = [
        "single_value_boost",
        "flat_resource_grant",
        "specialist_action",
        "office_expansion",
        "hire_staff",
        "market_share_advance"
      ];
      var DEFERRED_SPACE_TYPES = [
        "acquire_or_play_action_card",
        "draft_open_market_agent",
        "executive_decision_choice",
        "dual_value_boost",
        "hire_coach"
      ];
      function getSpaceRewardConfig(space, occupantOrder) {
        if (space.rewardByArrivalOrder) {
          const arrivalIndex = Math.max(0, occupantOrder - 1);
          const amount = space.rewardByArrivalOrder[arrivalIndex] ?? 0;
          if (space.trackName) {
            return { type: "track", trackName: space.trackName, amount };
          }
          return { type: "profitTokens", amount };
        }
        return space.reward || { type: "none", amount: 0 };
      }
      function claimMarketShareBonusIfEligible(state, playerId, beforeIndex) {
        const player = state.players[playerId];
        const afterIndex = player.tracks.marketShare.position;
        if (afterIndex <= beforeIndex) {
          return state;
        }
        const beforeValue = MARKET_SHARE_TRACK_SPACES[beforeIndex];
        const afterValue = MARKET_SHARE_TRACK_SPACES[afterIndex];
        let nextState = state;
        Object.keys(state.marketShareTrack.bonusStacks).forEach((milestoneKey) => {
          const milestoneValue = Number(milestoneKey);
          const crossed = beforeValue < milestoneValue && afterValue >= milestoneValue;
          if (!crossed) return;
          const stack = nextState.marketShareTrack.bonusStacks[milestoneKey];
          if (stack.claimedBy.includes(playerId)) return;
          if (stack.claimedBy.length >= 2) return;
          const claimedTokenType = stack.claimedBy.length === 0 ? stack.top : stack.bottom;
          const claimOrder = stack.claimedBy.length === 0 ? "1st" : "2nd";
          nextState = {
            ...nextState,
            marketShareTrack: {
              ...nextState.marketShareTrack,
              bonusStacks: {
                ...nextState.marketShareTrack.bonusStacks,
                [milestoneKey]: { ...stack, claimedBy: [...stack.claimedBy, playerId] }
              }
            },
            players: {
              ...nextState.players,
              [playerId]: {
                ...nextState.players[playerId],
                bankedBonusTokens: [...nextState.players[playerId].bankedBonusTokens, claimedTokenType]
              }
            }
          };
          nextState = appendLog(nextState, {
            type: "MARKET_SHARE_BONUS_CLAIMED",
            playerId,
            milestoneValue,
            tokenType: claimedTokenType,
            claimOrder,
            message: `${playerId} reaches Market Share ${milestoneValue} as the ${claimOrder} player and banks a ${claimedTokenType} token.`
          });
        });
        return nextState;
      }
      function applyRewardConfig(state, playerId, reward) {
        switch (reward.type) {
          case "profitTokens":
            return adjustWallet(state, playerId, reward.amount || 0, 0);
          case "priorityTokens":
            return adjustWallet(state, playerId, 0, reward.amount || 0);
          case "track": {
            const beforeValue = state.players[playerId].tracks[reward.trackName].value;
            let nextState = adjustTrack(state, playerId, reward.trackName, reward.amount || 0);
            nextState = checkTrackMilestonesIfEligible(nextState, playerId, reward.trackName, beforeValue);
            return nextState;
          }
          case "meeple":
            return reward.destination === "staff_in_training" ? hireStaff(state, playerId) : awardMeeple(state, playerId, reward.source || "action_space_grant");
          case "office": {
            const officeState = adjustOfficeSlots(state, playerId, reward.amount || 0);
            return checkGlobalFirstToMilestones(officeState, playerId);
          }
          case "marketShareTrack": {
            const beforeIndex = state.players[playerId].tracks.marketShare.position;
            let nextState = adjustMarketShare(state, playerId, reward.amount || 0);
            nextState = claimMarketShareBonusIfEligible(nextState, playerId, beforeIndex);
            nextState = checkGlobalFirstToMilestones(nextState, playerId);
            return nextState;
          }
          case "none":
          default:
            return state;
        }
      }
      function resolveImmediateSpace(state, playerId, space, extra, occupantOrder) {
        const reward = getSpaceRewardConfig(space, occupantOrder);
        let nextState = applyRewardConfig(state, playerId, reward);
        nextState = appendLog(nextState, {
          type: "ACTION_SPACE_RESOLVED",
          spaceId: space.spaceId,
          playerId,
          resolution: "immediate",
          reward
        });
        return { state: nextState, deferred: false };
      }
      function resolveSpecialistAction(state, playerId, space) {
        const statusToken = {
          tokenId: `status-executed-${space.spaceId}`,
          type: "EXECUTED",
          targetType: "action_space",
          targetId: space.spaceId,
          placedByPlayerId: playerId,
          placedRound: state.phase.round,
          expiresAt: "end_of_round",
          expiryCondition: null
        };
        let nextState = {
          ...state,
          board: {
            ...state.board,
            statusTokens: [...state.board.statusTokens || [], statusToken]
          }
        };
        nextState = appendLog(nextState, {
          type: "SPECIALIST_HUB_SPENT",
          spaceId: space.spaceId,
          playerId,
          tokenId: statusToken.tokenId
        });
        const activeCard = nextState.specialistDeck && nextState.specialistDeck.activeCard;
        if (activeCard && activeCard.catalogId) {
          nextState = resolveSpecialistCardEffect(nextState, playerId, activeCard.catalogId);
          nextState = appendLog(nextState, {
            type: "SPECIALIST_CARD_ACTIVATED",
            spaceId: space.spaceId,
            playerId,
            catalogId: activeCard.catalogId,
            revealedRound: activeCard.revealedRound,
            effectDispatched: true
          });
          nextState = {
            ...nextState,
            specialistDeck: {
              ...nextState.specialistDeck,
              activeCard: {
                ...nextState.specialistDeck.activeCard,
                claimedByPlayerId: playerId
              }
            }
          };
        } else {
          nextState = appendLog(nextState, {
            type: "SPECIALIST_CARD_ACTIVATION_SKIPPED",
            spaceId: space.spaceId,
            playerId,
            reason: "NO_ACTIVE_SPECIALIST_CARD"
          });
        }
        return { state: nextState, deferred: false };
      }
      function resolveDeferredSpace(state, playerId, space, meeple, extra) {
        const nextState = {
          ...state,
          phase: {
            ...state.phase,
            pendingInterrupt: {
              type: "ACTION_SPACE_DEFERRED_CHOICE",
              sourcePlayerId: playerId,
              data: {
                spaceId: space.spaceId,
                spaceType: space.type,
                meepleInstanceId: meeple.instanceId,
                extra
              }
            }
          }
        };
        const loggedState = appendLog(nextState, {
          type: "ACTION_SPACE_DEFERRED",
          spaceId: space.spaceId,
          playerId
        });
        return { state: loggedState, deferred: true };
      }
      function resolveActionSpace(state, playerId, space, meeple, extra, occupantOrder) {
        if (space.type === "specialist_action") {
          return resolveSpecialistAction(state, playerId, space);
        }
        if (IMMEDIATE_SPACE_TYPES.includes(space.type)) {
          return resolveImmediateSpace(state, playerId, space, extra, occupantOrder);
        }
        if (DEFERRED_SPACE_TYPES.includes(space.type)) {
          return resolveDeferredSpace(state, playerId, space, meeple, extra);
        }
        console.warn(`resolveActionSpace: unrecognized space.type "${space.type}" for ${space.spaceId}`);
        return { state, deferred: false };
      }
      function advanceActivePlayer(state) {
        const { turnOrder, playersWithMeeplesRemaining, activePlayerId } = state.phase;
        if (playersWithMeeplesRemaining.length === 0) {
          return state;
        }
        const currentIndex = turnOrder.indexOf(activePlayerId);
        const startIndex = currentIndex === -1 ? 0 : currentIndex;
        for (let step = 1; step <= turnOrder.length; step += 1) {
          const candidateId = turnOrder[(startIndex + step) % turnOrder.length];
          if (playersWithMeeplesRemaining.includes(candidateId)) {
            return {
              ...state,
              phase: {
                ...state.phase,
                activePlayerId: candidateId
              }
            };
          }
        }
        return state;
      }
      function placeMeeple(state, playerId, meepleInstanceId, spaceId, extra = null) {
        const validation = validatePlacement(state, playerId, meepleInstanceId, spaceId, extra);
        if (!validation.ok) {
          return { state, error: validation.error, detail: validation.detail, deferred: false };
        }
        const { meeple, space, additionalMeeples } = validation;
        const player = state.players[playerId];
        const overtimeManagerWasUsed = !!(extra && extra.useOvertimeManager) && space.capacity !== null && space.occupiedBy.length >= space.capacity;
        const committedMeeples = [meeple, ...additionalMeeples];
        const committedInstanceIds = new Set(committedMeeples.map((m) => m.instanceId));
        const updatedActive = player.timeMeeples.active.map(
          (m) => committedInstanceIds.has(m.instanceId) ? { ...m, status: "on_board", locationSpaceId: space.spaceId } : m
        );
        const updatedCopycatMeeple = player.timeMeeples.copycatMeeple && committedInstanceIds.has(player.timeMeeples.copycatMeeple.instanceId) ? { ...player.timeMeeples.copycatMeeple, status: "on_board", locationSpaceId: space.spaceId } : player.timeMeeples.copycatMeeple;
        const startingOrder = space.occupiedBy.length + 1;
        const newOccupiedByEntries = committedMeeples.map((m, index) => ({
          playerId,
          meepleInstanceId: m.instanceId,
          order: startingOrder + index
        }));
        const updatedOccupiedBy = [...space.occupiedBy, ...newOccupiedByEntries];
        const updatedSpaces = state.board.actionSpaces.map(
          (s) => s.spaceId === space.spaceId ? { ...s, occupiedBy: updatedOccupiedBy } : s
        );
        const occupantOrder = startingOrder;
        const remainingInSupply = updatedActive.filter((m) => m.status === "in_supply").length;
        const updatedPlayersWithMeeplesRemaining = remainingInSupply === 0 ? state.phase.playersWithMeeplesRemaining.filter((id) => id !== playerId) : state.phase.playersWithMeeplesRemaining;
        let nextState = {
          ...state,
          players: {
            ...state.players,
            [playerId]: {
              ...player,
              timeMeeples: {
                ...player.timeMeeples,
                active: updatedActive,
                copycatMeeple: updatedCopycatMeeple
              }
            }
          },
          board: {
            ...state.board,
            actionSpaces: updatedSpaces
          },
          phase: {
            ...state.phase,
            playersWithMeeplesRemaining: updatedPlayersWithMeeplesRemaining
          }
        };
        if (space.cost) {
          nextState = adjustWallet(
            nextState,
            playerId,
            -(space.cost.profitTokens || 0),
            -(space.cost.priorityTokens || 0)
          );
        }
        nextState = appendLog(nextState, {
          type: "MEEPLE_PLACED",
          playerId,
          meepleInstanceId: meeple.instanceId,
          additionalMeepleInstanceIds: additionalMeeples.map((m) => m.instanceId),
          spaceId: space.spaceId,
          cost: space.cost || null
        });
        if (player.hasMarketHijack && updatedCopycatMeeple !== player.timeMeeples.copycatMeeple) {
          nextState = adjustMarketShare(nextState, playerId, 1);
          nextState = appendLog(nextState, {
            type: "MARKET_HIJACK_TRIGGERED",
            playerId,
            message: `${playerId}'s Market Hijack advances the Market Share Track by 1 for free (Copycat Meeple placed).`
          });
        }
        const updatedSpace = nextState.board.actionSpaces.find((s) => s.spaceId === space.spaceId);
        const resolution = resolveActionSpace(nextState, playerId, updatedSpace, meeple, extra, occupantOrder);
        nextState = resolution.state;
        if (!resolution.deferred) {
          nextState = advanceActivePlayer(nextState);
        }
        if (overtimeManagerWasUsed) {
          nextState = adjustWallet(nextState, playerId, -2, 0);
          nextState = {
            ...nextState,
            players: {
              ...nextState.players,
              [playerId]: {
                ...nextState.players[playerId],
                oncePerRoundAbilitiesUsed: [...nextState.players[playerId].oncePerRoundAbilitiesUsed, "OVERTIME_MANAGER"]
              }
            }
          };
          nextState = appendLog(nextState, {
            type: "MILESTONE_APPLIED",
            playerId,
            milestoneKey: "OVERTIME_MANAGER",
            spaceId: space.spaceId,
            message: `${playerId}'s Overtime Manager pays $2 to place on ${space.spaceId}, already fully occupied by an opponent.`
          });
        }
        return { state: nextState, error: null, detail: null, deferred: resolution.deferred };
      }
      var NULL_INTERRUPT = { type: "NULL", sourcePlayerId: null, data: {} };
      function cancelDeferredSpaceChoice(state, playerId) {
        const interrupt = state.phase.pendingInterrupt;
        if (!interrupt || interrupt.type !== "ACTION_SPACE_DEFERRED_CHOICE" || interrupt.sourcePlayerId !== playerId) {
          return { state, error: "NO_PENDING_DEFERRED_CHOICE_TO_CANCEL", detail: { playerId, pendingInterrupt: interrupt || null } };
        }
        const { spaceId, meepleInstanceId } = interrupt.data;
        const space = state.board.actionSpaces.find((s) => s.spaceId === spaceId);
        if (!space) {
          return { state, error: "SPACE_NOT_FOUND", detail: { spaceId } };
        }
        const player = state.players[playerId];
        const updatedActive = player.timeMeeples.active.map(
          (m) => m.instanceId === meepleInstanceId ? { ...m, status: "in_supply", locationSpaceId: null } : m
        );
        const updatedCopycatMeeple = player.timeMeeples.copycatMeeple && player.timeMeeples.copycatMeeple.instanceId === meepleInstanceId ? { ...player.timeMeeples.copycatMeeple, status: "in_supply", locationSpaceId: null } : player.timeMeeples.copycatMeeple;
        const updatedOccupiedBy = space.occupiedBy.filter((o) => o.meepleInstanceId !== meepleInstanceId);
        const updatedSpaces = state.board.actionSpaces.map((s) => s.spaceId === spaceId ? { ...s, occupiedBy: updatedOccupiedBy } : s);
        let nextState = {
          ...state,
          players: {
            ...state.players,
            [playerId]: { ...player, timeMeeples: { ...player.timeMeeples, active: updatedActive, copycatMeeple: updatedCopycatMeeple } }
          },
          board: { ...state.board, actionSpaces: updatedSpaces },
          phase: {
            ...state.phase,
            pendingInterrupt: NULL_INTERRUPT,
            // The player has a meeple back in supply — make sure they're still
            // listed as able to act this round (placeMeeple's own step 3 would
            // have removed them if this was their last active meeple).
            playersWithMeeplesRemaining: state.phase.playersWithMeeplesRemaining.includes(playerId) ? state.phase.playersWithMeeplesRemaining : [...state.phase.playersWithMeeplesRemaining, playerId]
          }
        };
        if (space.cost && (space.cost.profitTokens || space.cost.priorityTokens)) {
          nextState = adjustWallet(nextState, playerId, space.cost.profitTokens || 0, space.cost.priorityTokens || 0);
        }
        return {
          state: appendLog(nextState, {
            type: "DEFERRED_ACTION_CANCELLED",
            playerId,
            spaceId,
            meepleInstanceId,
            message: `${playerId} cancels their pending choice at ${spaceId} \u2014 meeple and any cost returned; turn continues.`
          }),
          error: null,
          detail: null
        };
      }
      function resolveDualTrackChoice(state, playerId, trackA, trackB) {
        const interrupt = state.phase.pendingInterrupt;
        if (!interrupt || interrupt.type !== "ACTION_SPACE_DEFERRED_CHOICE" || interrupt.sourcePlayerId !== playerId || !interrupt.data || interrupt.data.spaceType !== "dual_value_boost" || interrupt.data.spaceId !== "OPS_2X_COMBO") {
          return { state, error: "NO_PENDING_DUAL_TRACK_CHOICE", detail: { playerId, pendingInterrupt: interrupt || null } };
        }
        const validTracks = /* @__PURE__ */ new Set(["training", "technology", "recognition"]);
        if (!validTracks.has(trackA) || !validTracks.has(trackB)) {
          return { state, error: "INVALID_TRACK_NAME", detail: { trackA, trackB } };
        }
        let nextState = adjustTrack(state, playerId, trackA, 1);
        nextState = adjustTrack(nextState, playerId, trackB, 1);
        nextState = { ...nextState, phase: { ...nextState.phase, pendingInterrupt: NULL_INTERRUPT } };
        nextState = appendLog(nextState, {
          type: "DUAL_TRACK_CHOICE_RESOLVED",
          playerId,
          trackA,
          trackB,
          message: trackA === trackB ? `${playerId} advances ${trackA} by 2 via the 2x Combo space.` : `${playerId} advances ${trackA} and ${trackB} by 1 each via the 2x Combo space.`
        });
        return { state: advanceActivePlayer(nextState), error: null, detail: null };
      }
      function resolveHireCoachChoice(state, playerId, targetAgentInstanceId) {
        const interrupt = state.phase.pendingInterrupt;
        if (!interrupt || interrupt.type !== "ACTION_SPACE_DEFERRED_CHOICE" || interrupt.sourcePlayerId !== playerId || !interrupt.data || interrupt.data.spaceType !== "hire_coach" || interrupt.data.spaceId !== "LDR_HIRE_COACH") {
          return { state, error: "NO_PENDING_HIRE_COACH_CHOICE", detail: { playerId, pendingInterrupt: interrupt || null } };
        }
        const player = state.players[playerId];
        if (targetAgentInstanceId === null || targetAgentInstanceId === void 0) {
          let skippedState = { ...state, phase: { ...state.phase, pendingInterrupt: NULL_INTERRUPT } };
          skippedState = appendLog(skippedState, {
            type: "HIRE_COACH_SKIPPED",
            playerId,
            message: `${playerId} has no eligible roster Agent to coach \u2014 the token is not assigned.`
          });
          return { state: advanceActivePlayer(skippedState), error: null, detail: null };
        }
        const targetEntry = player.roster.find((r) => r.agentInstanceId === targetAgentInstanceId && !r.isVoided);
        if (!targetEntry) {
          return { state, error: "TARGET_AGENT_NOT_FOUND", detail: { targetAgentInstanceId } };
        }
        let nextState = {
          ...state,
          players: {
            ...state.players,
            [playerId]: {
              ...player,
              roster: player.roster.map((r) => r.agentInstanceId === targetAgentInstanceId ? { ...r, coachTokens: r.coachTokens + 1 } : r)
            }
          }
        };
        nextState = { ...nextState, phase: { ...nextState.phase, pendingInterrupt: NULL_INTERRUPT } };
        nextState = appendLog(nextState, {
          type: "COACH_TOKEN_ASSIGNED",
          playerId,
          targetAgentInstanceId,
          message: `${playerId} assigns a Coach Token to ${targetEntry.catalogId} \u2014 Profit permanently +3.`
        });
        nextState = checkGlobalFirstToMilestones(nextState, playerId);
        return { state: advanceActivePlayer(nextState), error: null, detail: null };
      }
      function resolveClearOpenMarketChoice(state, playerId, choice) {
        const interrupt = state.phase.pendingInterrupt;
        if (!interrupt || interrupt.type !== "ACTION_SPACE_DEFERRED_CHOICE" || interrupt.sourcePlayerId !== playerId || !interrupt.data || interrupt.data.spaceId !== "EXEC_CLEAR_OPEN_MARKET" || interrupt.data.stage) {
          return { state, error: "NO_PENDING_CLEAR_OPEN_MARKET_CHOICE", detail: { playerId, pendingInterrupt: interrupt || null } };
        }
        if (choice !== "wipe_both" && choice !== "wipe_action_and_take_free" && choice !== "wipe_agent_and_take_free_action") {
          return { state, error: "INVALID_CLEAR_OPEN_MARKET_CHOICE", detail: { choice } };
        }
        let nextState = { ...state, phase: { ...state.phase, pendingInterrupt: NULL_INTERRUPT } };
        if (choice === "wipe_both") {
          nextState = wipeAndRefillActionCardMarket(nextState);
          nextState = wipeAndRefillAgentMarket(nextState);
          nextState = appendLog(nextState, {
            type: "EXEC_CLEAR_OPEN_MARKET_RESOLVED",
            playerId,
            choice,
            message: `${playerId} clears and fully refreshes BOTH the Agent and Action Card Open Market rows.`
          });
          return { state: advanceActivePlayer(nextState), error: null, detail: null };
        }
        if (choice === "wipe_action_and_take_free") {
          nextState = wipeAndRefillActionCardMarket(nextState);
          nextState = appendLog(nextState, {
            type: "EXEC_CLEAR_OPEN_MARKET_ROW_WIPED",
            playerId,
            choice,
            message: `${playerId} clears the Action Card row \u2014 choosing 1 free card from the fresh row.`
          });
        } else {
          nextState = wipeAndRefillAgentMarket(nextState);
          nextState = appendLog(nextState, {
            type: "EXEC_CLEAR_OPEN_MARKET_ROW_WIPED",
            playerId,
            choice,
            message: `${playerId} clears the Agent row \u2014 choosing 1 free Action Card from the (unaffected) Action Card row.`
          });
        }
        nextState = {
          ...nextState,
          phase: {
            ...nextState.phase,
            pendingInterrupt: {
              type: "ACTION_SPACE_DEFERRED_CHOICE",
              sourcePlayerId: playerId,
              data: { spaceId: "EXEC_CLEAR_OPEN_MARKET", spaceType: "executive_decision_choice", stage: "pick_free_card" }
            }
          }
        };
        return { state: nextState, error: null, detail: null };
      }
      function resolveClearOpenMarketFreeCardPick(state, playerId, pickedCatalogId) {
        const interrupt = state.phase.pendingInterrupt;
        if (!interrupt || interrupt.type !== "ACTION_SPACE_DEFERRED_CHOICE" || interrupt.sourcePlayerId !== playerId || !interrupt.data || interrupt.data.spaceId !== "EXEC_CLEAR_OPEN_MARKET" || interrupt.data.stage !== "pick_free_card") {
          return { state, error: "NO_PENDING_CLEAR_OPEN_MARKET_FREE_CARD_PICK", detail: { playerId, pendingInterrupt: interrupt || null } };
        }
        const freshRow = state.board.openMarketActionCards || [];
        const pickedIndex = freshRow.findIndex((c) => c.catalogId === pickedCatalogId);
        if (pickedIndex === -1) {
          return { state, error: "PICKED_CARD_NOT_IN_OPEN_MARKET", detail: { pickedCatalogId } };
        }
        const player = state.players[playerId];
        const remainingRow = [...freshRow.slice(0, pickedIndex), ...freshRow.slice(pickedIndex + 1)];
        const drawPile = state.board.decks && state.board.decks.actionCardDrawPile || [];
        const backfillCount = Math.min(1, drawPile.length);
        const backfilled = drawPile.slice(0, backfillCount).map((catalogId) => ({ catalogId }));
        const newDrawPile = drawPile.slice(backfillCount);
        const newEntry = { instanceId: `ac-${playerId}-clearmarket-r${state.phase.round}`, catalogId: pickedCatalogId };
        const bothPersonalPilesEmpty = player.hand.personalDrawPile.length === 0 && player.hand.personalDiscardPile.length === 0;
        const handHasRoom = player.hand.actionCards.length < player.hand.maxHandSize || bothPersonalPilesEmpty;
        let nextState = {
          ...state,
          board: {
            ...state.board,
            openMarketActionCards: [...remainingRow, ...backfilled],
            decks: { ...state.board.decks, actionCardDrawPile: newDrawPile }
          },
          players: {
            ...state.players,
            [playerId]: {
              ...player,
              hand: {
                ...player.hand,
                actionCards: handHasRoom ? [...player.hand.actionCards, newEntry] : player.hand.actionCards,
                personalDiscardPile: handHasRoom ? player.hand.personalDiscardPile : [...player.hand.personalDiscardPile, newEntry]
              }
            }
          },
          phase: { ...state.phase, pendingInterrupt: NULL_INTERRUPT }
        };
        nextState = appendLog(nextState, {
          type: "EXEC_CLEAR_OPEN_MARKET_RESOLVED",
          playerId,
          choice: "wipe_action_and_take_free",
          takenCatalogId: pickedCatalogId,
          message: `${playerId} clears the Action Card row and takes ${pickedCatalogId} for free.`
        });
        return { state: advanceActivePlayer(nextState), error: null, detail: null };
      }
      function useExecutiveOverdrive(state, playerId, spaceId) {
        const player = state.players[playerId];
        if (!player) {
          return { state, error: "PLAYER_NOT_FOUND", detail: null };
        }
        if (!player.executiveOverdriveAvailable) {
          return { state, error: "ABILITY_NOT_UNLOCKED", detail: null };
        }
        if (player.oncePerRoundAbilitiesUsed.includes("EXECUTIVE_OVERDRIVE")) {
          return { state, error: "ALREADY_USED_THIS_ROUND", detail: null };
        }
        const space = state.board.actionSpaces.find((s) => s.spaceId === spaceId);
        if (!space) {
          return { state, error: "SPACE_NOT_FOUND", detail: { spaceId } };
        }
        if (DEFERRED_SPACE_TYPES.includes(space.type)) {
          return { state, error: "SPACE_TYPE_NOT_SUPPORTED_FOR_OVERDRIVE", detail: { spaceType: space.type } };
        }
        if (space.cost && (space.cost.profitTokens || 0) > 0 && player.wallet.profitTokens < space.cost.profitTokens) {
          return { state, error: "INSUFFICIENT_FUNDS", detail: { required: space.cost.profitTokens, current: player.wallet.profitTokens } };
        }
        const occupantOrderFirst = space.occupiedBy.length + 1;
        let nextState = state;
        if (space.cost && (space.cost.profitTokens || space.cost.priorityTokens)) {
          nextState = adjustWallet(nextState, playerId, -(space.cost.profitTokens || 0), -(space.cost.priorityTokens || 0));
        }
        nextState = resolveImmediateSpace(nextState, playerId, space, null, occupantOrderFirst).state;
        nextState = resolveImmediateSpace(nextState, playerId, space, null, occupantOrderFirst).state;
        nextState = {
          ...nextState,
          players: {
            ...nextState.players,
            [playerId]: { ...nextState.players[playerId], oncePerRoundAbilitiesUsed: [...nextState.players[playerId].oncePerRoundAbilitiesUsed, "EXECUTIVE_OVERDRIVE"] }
          }
        };
        nextState = appendLog(nextState, {
          type: "SPECIALIST_EFFECT_EXECUTIVE_OVERDRIVE_USED",
          playerId,
          spaceId,
          message: `${playerId}'s Executive Overdrive resolves ${spaceId} twice back-to-back \u2014 the 2nd activation waives its cost.`
        });
        return { state: nextState, error: null, detail: null };
      }
      function executeFreeBoardAction(state, playerId, spaceId) {
        const space = state.board.actionSpaces.find((s) => s.spaceId === spaceId);
        if (!space) {
          return { state, error: "SPACE_NOT_FOUND", detail: { spaceId } };
        }
        if (space.status === "blocked" || space.status === "void") {
          return { state, error: "SPACE_BLOCKED", detail: { spaceId, status: space.status } };
        }
        const syntheticMeeple = { instanceId: `free-action-${playerId}-${state.phase.round}` };
        const occupantOrder = (space.occupiedBy ? space.occupiedBy.length : 0) + 1;
        const result = resolveActionSpace(state, playerId, space, syntheticMeeple, null, occupantOrder);
        let nextState = appendLog(result.state, {
          type: "FREE_ACTION_SPACE_EXECUTED",
          playerId,
          spaceId,
          message: `${playerId} performs ${spaceId} for free via a banked Free Action token \u2014 no Time Meeple spent or checked.`
        });
        return { state: nextState, error: null, detail: null };
      }
      function useAutomationEngineer(state, playerId) {
        const player = state.players[playerId];
        if (!player) {
          return { state, error: "PLAYER_NOT_FOUND", detail: null };
        }
        if (!player.copiedActionSpaceId) {
          return { state, error: "ABILITY_NOT_UNLOCKED", detail: null };
        }
        if (player.automationEngineerUsedThisRound) {
          return { state, error: "ALREADY_USED_THIS_ROUND", detail: null };
        }
        const space = state.board.actionSpaces.find((s) => s.spaceId === player.copiedActionSpaceId);
        if (!space) {
          return { state, error: "SPACE_NOT_FOUND", detail: { spaceId: player.copiedActionSpaceId } };
        }
        if (DEFERRED_SPACE_TYPES.includes(space.type)) {
          return { state, error: "SPACE_TYPE_NOT_SUPPORTED_FOR_AUTOMATION", detail: { spaceType: space.type } };
        }
        if (space.cost && (space.cost.profitTokens || 0) > 0 && player.wallet.profitTokens < space.cost.profitTokens) {
          return { state, error: "INSUFFICIENT_FUNDS", detail: { required: space.cost.profitTokens, current: player.wallet.profitTokens } };
        }
        let nextState = state;
        if (space.cost && (space.cost.profitTokens || space.cost.priorityTokens)) {
          nextState = adjustWallet(nextState, playerId, -(space.cost.profitTokens || 0), -(space.cost.priorityTokens || 0));
        }
        const syntheticMeeple = { instanceId: `automation-engineer-${playerId}-${state.phase.round}` };
        const occupantOrder = (space.occupiedBy ? space.occupiedBy.length : 0) + 1;
        const result = resolveActionSpace(nextState, playerId, space, syntheticMeeple, null, occupantOrder);
        nextState = {
          ...result.state,
          players: {
            ...result.state.players,
            [playerId]: { ...result.state.players[playerId], automationEngineerUsedThisRound: true }
          }
        };
        nextState = appendLog(nextState, {
          type: "SPECIALIST_EFFECT_AUTOMATION_ENGINEER_USED",
          playerId,
          spaceId: space.spaceId,
          message: `${playerId}'s Automation Engineer triggers ${space.spaceId} for free (no Meeple) \u2014 any operational cost was still paid normally.`
        });
        return { state: nextState, error: null, detail: null };
      }
      module.exports = {
        claimMarketShareBonusIfEligible,
        executeFreeBoardAction,
        placeMeeple,
        cancelDeferredSpaceChoice,
        resolveDualTrackChoice,
        resolveHireCoachChoice,
        resolveClearOpenMarketChoice,
        resolveClearOpenMarketFreeCardPick,
        useExecutiveOverdrive,
        useAutomationEngineer,
        resolveImmediateSpace,
        validatePlacement,
        verifyActivePlayer,
        verifyMeepleAvailable,
        verifySpaceOpen,
        verifyCanAffordSpace,
        verifySpecialistAction,
        resolveActionSpace,
        resolveSpecialistAction,
        advanceActivePlayer,
        IMMEDIATE_SPACE_TYPES
      };
    }
  });

  // transactionGuard.js
  var require_transactionGuard = __commonJS({
    "transactionGuard.js"(exports, module) {
      function appendLog(state, entry) {
        const logEntry = {
          seq: state.log.length + 1,
          timestamp: (/* @__PURE__ */ new Date()).toISOString(),
          round: state.phase.round,
          ...entry
        };
        return { ...state, log: [...state.log, logEntry] };
      }
      var DEFAULT_INVARIANT_VALIDATORS = [
        function walletsNeverNegative(state) {
          for (const playerId of Object.keys(state.players)) {
            const wallet = state.players[playerId].wallet;
            if (wallet.profitTokens < 0) {
              return `player ${playerId} has negative profitTokens (${wallet.profitTokens})`;
            }
            if (wallet.priorityTokens < 0) {
              return `player ${playerId} has negative priorityTokens (${wallet.priorityTokens})`;
            }
            if (!Number.isFinite(wallet.profitTokens) || !Number.isFinite(wallet.priorityTokens)) {
              return `player ${playerId} has a non-finite wallet value (profitTokens=${wallet.profitTokens}, priorityTokens=${wallet.priorityTokens})`;
            }
          }
          return null;
        },
        function leveledTracksWithinBounds(state) {
          const trackNames = ["training", "technology", "recognition"];
          for (const playerId of Object.keys(state.players)) {
            const tracks = state.players[playerId].tracks;
            for (const trackName of trackNames) {
              const track = tracks[trackName];
              if (!Number.isFinite(track.value) || track.value < 0 || track.value > track.max) {
                return `player ${playerId}'s ${trackName} track is out of bounds (value=${track.value}, max=${track.max})`;
              }
            }
          }
          return null;
        },
        function officeCapacityWithinBounds(state) {
          for (const playerId of Object.keys(state.players)) {
            const offices = state.players[playerId].tracks.offices;
            if (!Number.isFinite(offices.unlocked) || offices.unlocked < 0 || offices.unlocked > offices.max) {
              return `player ${playerId}'s office capacity is out of bounds (unlocked=${offices.unlocked}, max=${offices.max})`;
            }
          }
          return null;
        },
        function handSizeWithinCapacity(state) {
          for (const playerId of Object.keys(state.players)) {
            const hand = state.players[playerId].hand;
            if (hand.actionCards.length > hand.maxHandSize) {
              return `player ${playerId}'s hand (${hand.actionCards.length} cards) exceeds maxHandSize (${hand.maxHandSize})`;
            }
          }
          return null;
        }
      ];
      function runInvariantChecks(state, validators) {
        for (const validator of validators) {
          const violation = validator(state);
          if (violation) {
            return violation;
          }
        }
        return null;
      }
      function executeTransaction(state, mutationFn, options = {}) {
        const validators = options.validators || DEFAULT_INVARIANT_VALIDATORS;
        const context = options.context || {};
        let resultState;
        try {
          resultState = mutationFn(state);
        } catch (err) {
          const detail = { reason: "RUNTIME_EXCEPTION", message: err.message, ...context };
          return {
            state: appendLog(state, {
              type: "TRANSACTION_ROLLBACK_TRIGGERED",
              ...detail
            }),
            error: "TRANSACTION_ROLLBACK_TRIGGERED",
            detail
          };
        }
        if (resultState === state) {
          return { state: resultState, error: null, detail: null };
        }
        const violation = runInvariantChecks(resultState, validators);
        if (violation) {
          const detail = { reason: "INVARIANT_VIOLATION", violation, ...context };
          return {
            state: appendLog(state, {
              type: "TRANSACTION_ROLLBACK_TRIGGERED",
              ...detail
            }),
            error: "TRANSACTION_ROLLBACK_TRIGGERED",
            detail
          };
        }
        return { state: resultState, error: null, detail: null };
      }
      module.exports = {
        executeTransaction,
        DEFAULT_INVARIANT_VALIDATORS,
        runInvariantChecks
      };
    }
  });

  // actionCardReducer.js
  var require_actionCardReducer = __commonJS({
    "actionCardReducer.js"(exports, module) {
      var { adjustWallet } = require_cardEffectHelpers();
      var { resolveActionCardEffect, resolveSpecialistCardEffect } = require_cardEffectRegistry();
      var { advanceActivePlayer } = require_workerPlacementReducer();
      var { executeTransaction } = require_transactionGuard();
      var { MARKET_SHARE_TRACK_SPACES } = require_boardConfigLoader();
      var NULL_INTERRUPT = { type: "NULL", sourcePlayerId: null, data: {} };
      function appendLog(state, entry) {
        const logEntry = {
          seq: state.log.length + 1,
          timestamp: (/* @__PURE__ */ new Date()).toISOString(),
          round: state.phase.round,
          ...entry
        };
        return { ...state, log: [...state.log, logEntry] };
      }
      function verifyPendingActionCardChoice(state, playerId) {
        const interrupt = state.phase.pendingInterrupt;
        if (!interrupt || interrupt.type !== "ACTION_SPACE_DEFERRED_CHOICE" || interrupt.sourcePlayerId !== playerId || !interrupt.data || interrupt.data.spaceType !== "acquire_or_play_action_card") {
          return {
            ok: false,
            error: "NO_PENDING_ACTION_CARD_CHOICE",
            detail: { playerId, pendingInterrupt: interrupt || null }
          };
        }
        return { ok: true };
      }
      function verifyPlayRequirement(state, playerId, catalogId) {
        const card = state.cardCatalog.actionCards[catalogId];
        const requirement = card.playRequirement;
        if (requirement === null || requirement === void 0) {
          return { ok: true };
        }
        const player = state.players[playerId];
        switch (requirement.type) {
          case "track": {
            const current = player.tracks[requirement.track].value;
            if (current >= requirement.level) {
              return { ok: true };
            }
            return {
              ok: false,
              error: "REQUIREMENT_NOT_MET",
              detail: { track: requirement.track, required: requirement.level, current }
            };
          }
          case "marketShare": {
            const currentPosition = player.tracks.marketShare.position;
            const currentValue = MARKET_SHARE_TRACK_SPACES[currentPosition];
            if (currentValue >= requirement.level) {
              return { ok: true };
            }
            return {
              ok: false,
              error: "REQUIREMENT_NOT_MET",
              detail: { track: "marketShare", required: requirement.level, current: currentValue }
            };
          }
          case "rosterSize": {
            const current = player.roster.filter((r) => !r.isVoided).length;
            if (current >= requirement.count) {
              return { ok: true };
            }
            return {
              ok: false,
              error: "REQUIREMENT_NOT_MET",
              detail: { track: "rosterSize", required: requirement.count, current }
            };
          }
          case "unparsed":
          default:
            return {
              ok: false,
              error: "REQUIREMENT_TYPE_NOT_SUPPORTED",
              detail: { catalogId, raw: requirement.raw || requirement }
            };
        }
      }
      function moveToPersonalDiscardPile(state, playerId, handEntry) {
        const outcome = state.pendingEffectOutcome;
        if (outcome && outcome.skipDefaultDiscard) {
          console.warn(
            `[actionCardReducer] skipDefaultDiscard was set (customDestination: "${outcome.customDestination}") but applyCustomDestination is not implemented yet. Card left out of all piles \u2014 flagged, not silently dropped.`
          );
          return { ...state, pendingEffectOutcome: null };
        }
        return {
          ...state,
          pendingEffectOutcome: null,
          // consumed — cleared so it can't leak into the next card play
          players: {
            ...state.players,
            [playerId]: {
              ...state.players[playerId],
              hand: {
                ...state.players[playerId].hand,
                personalDiscardPile: [...state.players[playerId].hand.personalDiscardPile, handEntry]
              }
            }
          }
        };
      }
      function playActionCard(state, playerId, cardInstanceId) {
        const interruptCheck = verifyPendingActionCardChoice(state, playerId);
        if (!interruptCheck.ok) {
          return { state, error: interruptCheck.error, detail: interruptCheck.detail };
        }
        const player = state.players[playerId];
        if (!player) {
          return { state, error: "PLAYER_NOT_FOUND", detail: { playerId } };
        }
        if (player.hand.actionCards.length === 0) {
          let nextState2 = appendLog(state, {
            type: "ACTION_CARD_CHOICE_SKIPPED_EMPTY_HAND",
            playerId,
            message: `${playerId} has no cards to play \u2014 choice resolved with no action taken.`
          });
          nextState2 = { ...nextState2, phase: { ...nextState2.phase, pendingInterrupt: NULL_INTERRUPT } };
          nextState2 = advanceActivePlayer(nextState2);
          return { state: nextState2, error: null, detail: null };
        }
        const handEntry = player.hand.actionCards.find((c) => c.instanceId === cardInstanceId);
        if (!handEntry) {
          return { state, error: "CARD_NOT_IN_HAND", detail: { cardInstanceId } };
        }
        const catalogId = handEntry.catalogId;
        const card = state.cardCatalog && state.cardCatalog.actionCards ? state.cardCatalog.actionCards[catalogId] : void 0;
        if (!card) {
          return { state, error: "CARD_CATALOG_ENTRY_NOT_FOUND", detail: { catalogId } };
        }
        const reqCheck = verifyPlayRequirement(state, playerId, catalogId);
        if (!reqCheck.ok) {
          return { state, error: reqCheck.error, detail: reqCheck.detail };
        }
        if (player.wallet.profitTokens < card.cost) {
          return {
            state,
            error: "INSUFFICIENT_FUNDS",
            detail: { required: card.cost, current: player.wallet.profitTokens }
          };
        }
        let nextState = adjustWallet(state, playerId, -card.cost, 0);
        nextState = {
          ...nextState,
          players: {
            ...nextState.players,
            [playerId]: {
              ...nextState.players[playerId],
              hand: {
                ...nextState.players[playerId].hand,
                actionCards: nextState.players[playerId].hand.actionCards.filter(
                  (c) => c.instanceId !== cardInstanceId
                )
              }
            }
          }
        };
        const interruptBeforeEffect = nextState.phase.pendingInterrupt;
        nextState = resolveActionCardEffect(nextState, playerId, catalogId, handEntry.instanceId);
        nextState = moveToPersonalDiscardPile(nextState, playerId, handEntry);
        nextState = appendLog(nextState, {
          type: "ACTION_CARD_PLAYED",
          playerId,
          catalogId,
          cardInstanceId
        });
        if (nextState.phase.pendingInterrupt !== interruptBeforeEffect && nextState.phase.pendingInterrupt.type !== "NULL") {
          return { state: nextState, error: null };
        }
        nextState = { ...nextState, phase: { ...nextState.phase, pendingInterrupt: NULL_INTERRUPT } };
        nextState = advanceActivePlayer(nextState);
        return { state: nextState, error: null };
      }
      function playActionCardTransactional(state, playerId, cardInstanceId) {
        let capturedError = null;
        let capturedDetail = null;
        const result = executeTransaction(
          state,
          (s) => {
            const inner = playActionCard(s, playerId, cardInstanceId);
            capturedError = inner.error;
            capturedDetail = inner.detail;
            return inner.state;
          },
          { context: { source: "playActionCard", playerId, cardInstanceId } }
        );
        if (result.error) {
          return result;
        }
        return { state: result.state, error: capturedError, detail: capturedDetail };
      }
      function resolveActionCardEffectChoice(state, playerId, extra) {
        const interrupt = state.phase.pendingInterrupt;
        if (!interrupt || interrupt.type !== "ACTION_CARD_EFFECT_CHOICE" || interrupt.sourcePlayerId !== playerId || !interrupt.data || interrupt.data.isSpecialistCardChoice) {
          return { state, error: "NO_PENDING_ACTION_CARD_CHOICE", detail: { playerId, pendingInterrupt: interrupt || null } };
        }
        const { catalogId, cardInstanceId } = interrupt.data;
        let nextState = resolveActionCardEffect(state, playerId, catalogId, cardInstanceId, extra || {});
        if (nextState.phase.pendingInterrupt.type === "NULL") {
          nextState = advanceActivePlayer(nextState);
        }
        return { state: nextState, error: null, detail: null };
      }
      function resolveSpecialistCardEffectChoice(state, playerId, extra) {
        const interrupt = state.phase.pendingInterrupt;
        if (!interrupt || interrupt.type !== "ACTION_CARD_EFFECT_CHOICE" || interrupt.sourcePlayerId !== playerId || !interrupt.data || !interrupt.data.isSpecialistCardChoice) {
          return { state, error: "NO_PENDING_SPECIALIST_CARD_CHOICE", detail: { playerId, pendingInterrupt: interrupt || null } };
        }
        const { catalogId, cardInstanceId } = interrupt.data;
        const nextState = resolveSpecialistCardEffect(state, playerId, catalogId, cardInstanceId, extra || {});
        return { state: nextState, error: null, detail: null };
      }
      module.exports = {
        playActionCard,
        resolveActionCardEffectChoice,
        resolveSpecialistCardEffectChoice,
        playActionCardTransactional,
        verifyPlayRequirement,
        verifyPendingActionCardChoice,
        NULL_INTERRUPT
      };
    }
  });

  // agentRecruitmentReducer.js
  var require_agentRecruitmentReducer = __commonJS({
    "agentRecruitmentReducer.js"(exports, module) {
      var { adjustWallet } = require_cardEffectHelpers();
      var { resolveShiftTrigger } = require_shiftReducer();
      var { NULL_INTERRUPT, playActionCard } = require_actionCardReducer();
      var { checkGlobalFirstToMilestones } = require_techTrackReducer();
      var { advanceActivePlayer } = require_workerPlacementReducer();
      var VALUE_DIMENSIONS = ["training", "technology", "recognition"];
      var MIN_MATCHING_VALUES_TO_RECRUIT = 1;
      var MIN_MATCHING_VALUES_TO_POACH = 2;
      var MIN_MATCHING_VALUES_FOR_LOYALTY = VALUE_DIMENSIONS.length;
      function appendLog(state, entry) {
        const logEntry = {
          seq: state.log.length + 1,
          timestamp: (/* @__PURE__ */ new Date()).toISOString(),
          round: state.phase.round,
          ...entry
        };
        return { ...state, log: [...state.log, logEntry] };
      }
      var _agentInstanceCounter = 0;
      function resetAgentInstanceCounter() {
        _agentInstanceCounter = 0;
      }
      function generateAgentInstanceId(playerId) {
        _agentInstanceCounter += 1;
        return `agt-${playerId}-${_agentInstanceCounter}`;
      }
      function getAgentStats(state, catalogId) {
        return (state.cardCatalog && state.cardCatalog.agentCards || {})[catalogId] || null;
      }
      function computeDeskUsage(state, playerId) {
        const player = state.players[playerId];
        const agentCards = state.cardCatalog && state.cardCatalog.agentCards || {};
        return player.roster.reduce((used, entry) => {
          if (entry.isVoided) return used;
          const stats = agentCards[entry.catalogId];
          if (!stats) return used + 1;
          if (stats.network.role === "follower" && stats.network.influencerCatalogId) {
            const influencerPresent = player.roster.some(
              (r) => !r.isVoided && r.catalogId === stats.network.influencerCatalogId
            );
            if (influencerPresent) return used;
          }
          return used + 1;
        }, 0);
      }
      function hasOpenDesk(state, playerId) {
        const player = state.players[playerId];
        return computeDeskUsage(state, playerId) < player.tracks.offices.unlocked;
      }
      function countMatchingValues(playerTracks, agentStats, requirementReduction = 0) {
        return VALUE_DIMENSIONS.filter((dim) => playerTracks[dim].value >= Math.max(0, agentStats[dim] - requirementReduction)).length;
      }
      function getAggressivePoacherReduction(player) {
        const hasAbility = player.tracks.training.branch === "A" && player.tracks.training.value >= 5;
        const alreadyUsed = player.oncePerRoundAbilitiesUsed.includes("AGGRESSIVE_POACHER");
        return hasAbility && !alreadyUsed ? 2 : 0;
      }
      function markOncePerRoundAbilityUsed(state, playerId, abilityKey) {
        const player = state.players[playerId];
        if (player.oncePerRoundAbilitiesUsed.includes(abilityKey)) {
          return state;
        }
        return {
          ...state,
          players: {
            ...state.players,
            [playerId]: { ...player, oncePerRoundAbilitiesUsed: [...player.oncePerRoundAbilitiesUsed, abilityKey] }
          }
        };
      }
      function advanceMarketReport(state) {
        let nextState = {
          ...state,
          shiftTracker: { ...state.shiftTracker, position: Math.min(state.shiftTracker.position + 1, state.shiftTracker.max) }
        };
        nextState = appendLog(nextState, {
          type: "MARKET_REPORT_ADVANCED",
          newPosition: nextState.shiftTracker.position,
          message: `The Market Report tracker (Shift Tracker) advances to ${nextState.shiftTracker.position}/${nextState.shiftTracker.max}.`
        });
        return resolveShiftTrigger(nextState);
      }
      function shuffleArray(array) {
        const result = [...array];
        for (let i = result.length - 1; i > 0; i -= 1) {
          const j = Math.floor(Math.random() * (i + 1));
          [result[i], result[j]] = [result[j], result[i]];
        }
        return result;
      }
      function drawAgentCardsWithAutoRecruitCheck(state, drawPile, count, discardPile = []) {
        let nextState = state;
        let remainingDrawPile = drawPile;
        let remainingDiscardPile = discardPile;
        const marketEntries = [];
        while (marketEntries.length < count) {
          if (remainingDrawPile.length === 0) {
            if (remainingDiscardPile.length === 0) break;
            remainingDrawPile = shuffleArray(remainingDiscardPile);
            remainingDiscardPile = [];
            nextState = appendLog(nextState, {
              type: "AGENT_DECK_RESHUFFLED",
              cardCount: remainingDrawPile.length,
              message: `The Agent deck ran out \u2014 reshuffling ${remainingDrawPile.length} card(s) from the discard pile into a new deck.`
            });
          }
          const catalogId = remainingDrawPile[0];
          remainingDrawPile = remainingDrawPile.slice(1);
          const stats = getAgentStats(nextState, catalogId);
          const matchedPlayerId = stats && stats.network.role === "follower" && stats.network.influencerCatalogId ? Object.keys(nextState.players).find(
            (pid) => nextState.players[pid].roster.some((r) => !r.isVoided && r.catalogId === stats.network.influencerCatalogId)
          ) : null;
          if (matchedPlayerId) {
            nextState = addAgentToRoster(nextState, matchedPlayerId, catalogId, "recruited");
            nextState = appendLog(nextState, {
              type: "NETWORK_AUTO_RECRUIT_ON_REFILL",
              playerId: matchedPlayerId,
              followerCatalogId: catalogId,
              message: `${stats.name} is drawn from the deck and automatically joins ${matchedPlayerId}'s roster \u2014 their Influencer is already there.`
            });
            continue;
          }
          marketEntries.push({ catalogId });
        }
        return { state: nextState, marketEntries, remainingDrawPile, remainingDiscardPile };
      }
      function removeFromOpenMarketAndRefill(state, agentCatalogId) {
        const market = state.board.openMarketAgents || [];
        const remaining = market.filter((a) => a.catalogId !== agentCatalogId);
        const drawPile = state.board.decks && state.board.decks.agentDrawPile || [];
        const discardPile = state.board.decks && state.board.decks.agentDiscardPile || [];
        const {
          state: stateAfterAutoRecruit,
          marketEntries: drawnEntries,
          remainingDrawPile,
          remainingDiscardPile
        } = drawAgentCardsWithAutoRecruitCheck(state, drawPile, 1, discardPile);
        return {
          ...stateAfterAutoRecruit,
          board: {
            ...stateAfterAutoRecruit.board,
            openMarketAgents: [...drawnEntries, ...remaining],
            decks: { ...stateAfterAutoRecruit.board.decks, agentDrawPile: remainingDrawPile, agentDiscardPile: remainingDiscardPile }
          }
        };
      }
      function addAgentToRoster(state, playerId, agentCatalogId, acquiredVia) {
        const player = state.players[playerId];
        const entry = {
          agentInstanceId: generateAgentInstanceId(playerId),
          catalogId: agentCatalogId,
          acquiredVia,
          acquiredRound: state.phase.round,
          onboardingToken: { active: true, expiresEndOfRound: state.phase.round },
          loyaltyToken: { active: false },
          coachTokens: 0,
          isVoided: false
        };
        return {
          ...state,
          players: { ...state.players, [playerId]: { ...player, roster: [...player.roster, entry] } }
        };
      }
      function pullInfluencerNetwork(state, recruitingPlayerId, influencerCatalogId) {
        const influencerStats = getAgentStats(state, influencerCatalogId);
        if (!influencerStats || !influencerStats.network.followerCatalogIds) return state;
        let nextState = state;
        influencerStats.network.followerCatalogIds.forEach((followerCatalogId) => {
          const followerStats = getAgentStats(nextState, followerCatalogId);
          const followerName = followerStats ? followerStats.name : followerCatalogId;
          const marketEntry = (nextState.board.openMarketAgents || []).find((a) => a.catalogId === followerCatalogId);
          if (marketEntry) {
            nextState = removeFromOpenMarketAndRefill(nextState, followerCatalogId);
            nextState = addAgentToRoster(nextState, recruitingPlayerId, followerCatalogId, "recruited");
            nextState = appendLog(nextState, {
              type: "NETWORK_MARKET_PULL",
              playerId: recruitingPlayerId,
              followerCatalogId,
              influencerCatalogId,
              message: `${recruitingPlayerId}'s network pulls ${followerName} from the Open Market for $0 (Market Pull).`
            });
            return;
          }
          const rivalPlayerId = Object.keys(nextState.players).find(
            (pid) => pid !== recruitingPlayerId && nextState.players[pid].roster.some((r) => !r.isVoided && r.catalogId === followerCatalogId)
          );
          if (!rivalPlayerId) return;
          const rival = nextState.players[rivalPlayerId];
          const followerEntry = rival.roster.find((r) => !r.isVoided && r.catalogId === followerCatalogId);
          if (followerEntry.loyaltyToken && followerEntry.loyaltyToken.active) {
            nextState = appendLog(nextState, {
              type: "NETWORK_GRAVITATIONAL_POACH_BLOCKED",
              playerId: recruitingPlayerId,
              rivalPlayerId,
              followerCatalogId,
              message: `${followerName} is anchored by a Loyalty Token at ${rivalPlayerId}'s brokerage \u2014 the influence link is blocked.`
            });
            return;
          }
          nextState = {
            ...nextState,
            players: {
              ...nextState.players,
              [rivalPlayerId]: { ...rival, roster: rival.roster.filter((r) => r.agentInstanceId !== followerEntry.agentInstanceId) }
            }
          };
          nextState = addAgentToRoster(nextState, recruitingPlayerId, followerCatalogId, "poached");
          nextState = appendLog(nextState, {
            type: "NETWORK_GRAVITATIONAL_POACH",
            playerId: recruitingPlayerId,
            rivalPlayerId,
            followerCatalogId,
            message: `${followerName} quits ${rivalPlayerId}'s brokerage to follow their Influencer to ${recruitingPlayerId} (Gravitational Poach) \u2014 no compensation paid.`
          });
        });
        return nextState;
      }
      function followerFlight(state, poachingPlayerId, formerOwnerPlayerId, influencerCatalogId) {
        const influencerStats = getAgentStats(state, influencerCatalogId);
        if (!influencerStats || !influencerStats.network.followerCatalogIds) return state;
        let nextState = state;
        influencerStats.network.followerCatalogIds.forEach((followerCatalogId) => {
          const followerStats = getAgentStats(nextState, followerCatalogId);
          const followerName = followerStats ? followerStats.name : followerCatalogId;
          const formerOwner = nextState.players[formerOwnerPlayerId];
          const followerEntry = formerOwner.roster.find((r) => !r.isVoided && r.catalogId === followerCatalogId);
          if (!followerEntry) return;
          if (followerEntry.loyaltyToken && followerEntry.loyaltyToken.active) {
            nextState = appendLog(nextState, {
              type: "FOLLOWER_FLIGHT_BLOCKED",
              playerId: poachingPlayerId,
              formerOwnerPlayerId,
              followerCatalogId,
              message: `${followerName} is anchored by a Loyalty Token \u2014 stays at ${formerOwnerPlayerId}'s brokerage despite losing their Influencer.`
            });
            return;
          }
          nextState = {
            ...nextState,
            players: {
              ...nextState.players,
              [formerOwnerPlayerId]: {
                ...nextState.players[formerOwnerPlayerId],
                roster: nextState.players[formerOwnerPlayerId].roster.filter((r) => r.agentInstanceId !== followerEntry.agentInstanceId)
              }
            }
          };
          nextState = addAgentToRoster(nextState, poachingPlayerId, followerCatalogId, "poached");
          nextState = appendLog(nextState, {
            type: "FOLLOWER_FLIGHT",
            playerId: poachingPlayerId,
            formerOwnerPlayerId,
            followerCatalogId,
            message: `${followerName} follows their Influencer to ${poachingPlayerId}'s brokerage (Follower Flight).`
          });
        });
        return nextState;
      }
      function networkBreakSpaceCheck(state, playerId) {
        const player = state.players[playerId];
        const used = computeDeskUsage(state, playerId);
        const capacity = player.tracks.offices.unlocked;
        if (used <= capacity) return state;
        const agentCards = state.cardCatalog && state.cardCatalog.agentCards || {};
        const overage = used - capacity;
        const fireable = player.roster.filter((r) => !r.isVoided).filter((r) => !(r.onboardingToken && r.onboardingToken.active)).filter((r) => !(r.loyaltyToken && r.loyaltyToken.active)).filter((r) => {
          const stats = agentCards[r.catalogId];
          if (!stats) return true;
          if (stats.network.role === "follower" && stats.network.influencerCatalogId) {
            const influencerPresent = player.roster.some((x) => !x.isVoided && x.catalogId === stats.network.influencerCatalogId);
            if (influencerPresent) return false;
          }
          return true;
        }).sort(
          (a, b) => (agentCards[a.catalogId] ? agentCards[a.catalogId].totalProfit : 0) - (agentCards[b.catalogId] ? agentCards[b.catalogId].totalProfit : 0)
        );
        const toFire = fireable.slice(0, overage);
        let nextState = state;
        toFire.forEach((entry) => {
          nextState = {
            ...nextState,
            players: {
              ...nextState.players,
              [playerId]: {
                ...nextState.players[playerId],
                roster: nextState.players[playerId].roster.map((r) => r.agentInstanceId === entry.agentInstanceId ? { ...r, isVoided: true } : r)
              }
            }
          };
        });
        return appendLog(nextState, {
          type: "NETWORK_BREAK_SPACE_CHECK",
          playerId,
          overage,
          firedAgentInstanceIds: toFire.map((e) => e.agentInstanceId),
          firedCount: toFire.length,
          coveredOverage: toFire.length >= overage,
          message: `${playerId}'s desk space is over capacity after losing an Influencer \u2014 ${toFire.length} agent(s) fired (lowest Total Profit first) to comply.`
        });
      }
      function recruitOpenMarketAgent(state, playerId, agentCatalogId) {
        const player = state.players[playerId];
        if (!player) {
          return { state, error: "PLAYER_NOT_FOUND", detail: { playerId } };
        }
        const marketEntry = (state.board.openMarketAgents || []).find((a) => a.catalogId === agentCatalogId);
        if (!marketEntry) {
          return { state, error: "AGENT_NOT_IN_OPEN_MARKET", detail: { agentCatalogId } };
        }
        if (!hasOpenDesk(state, playerId)) {
          return { state, error: "NO_OPEN_DESK", detail: { deskUsed: computeDeskUsage(state, playerId), capacity: player.tracks.offices.unlocked } };
        }
        const agentStats = getAgentStats(state, agentCatalogId);
        if (!agentStats) {
          return { state, error: "AGENT_CATALOG_ENTRY_NOT_FOUND", detail: { agentCatalogId } };
        }
        const matchCount = countMatchingValues(player.tracks, agentStats, getAggressivePoacherReduction(player));
        if (matchCount < MIN_MATCHING_VALUES_TO_RECRUIT) {
          return { state, error: "NO_MATCHING_VALUE", detail: { required: MIN_MATCHING_VALUES_TO_RECRUIT, matched: matchCount } };
        }
        const poacherReductionApplied = getAggressivePoacherReduction(player) > 0;
        let nextState = removeFromOpenMarketAndRefill(state, agentCatalogId);
        nextState = addAgentToRoster(nextState, playerId, agentCatalogId, "recruited");
        nextState = adjustWallet(nextState, playerId, agentStats.totalProfit, 0);
        nextState = advanceMarketReport(nextState);
        if (poacherReductionApplied) {
          nextState = markOncePerRoundAbilityUsed(nextState, playerId, "AGGRESSIVE_POACHER");
        }
        nextState = appendLog(nextState, {
          type: "AGENT_RECRUITED",
          playerId,
          agentCatalogId,
          netProfit: agentStats.totalProfit,
          message: `${playerId} recruits ${agentStats.name} from the Open Market for $0 PT (+${agentStats.totalProfit} PT Net Profit bonus).`
        });
        if (agentStats.network.role === "influencer") {
          nextState = pullInfluencerNetwork(nextState, playerId, agentCatalogId);
        }
        nextState = checkGlobalFirstToMilestones(nextState, playerId);
        const activeEffects = (nextState.players[playerId].marketDominanceEffectsAgainstMe || []).filter(
          (e) => e.sourcePlayerId !== playerId && nextState.phase.round <= e.expiresRound
        );
        activeEffects.forEach((effect) => {
          if (!nextState.players[effect.sourcePlayerId]) return;
          nextState = adjustWallet(nextState, playerId, -2, 0);
          nextState = adjustWallet(nextState, effect.sourcePlayerId, 2, 0);
          nextState = appendLog(nextState, {
            type: "MARKET_DOMINANCE_TAX_PAID",
            playerId,
            sourcePlayerId: effect.sourcePlayerId,
            message: `${playerId} pays ${effect.sourcePlayerId} 2 PT (Market Dominance) for recruiting.`
          });
        });
        return { state: nextState, error: null, detail: null };
      }
      function poachCompetingBrokerAgent(state, playerId, targetPlayerId, targetAgentInstanceId) {
        const player = state.players[playerId];
        const target = state.players[targetPlayerId];
        if (!player || !target) {
          return { state, error: "PLAYER_NOT_FOUND", detail: { playerId, targetPlayerId } };
        }
        if (playerId === targetPlayerId) {
          return { state, error: "CANNOT_POACH_OWN_AGENT", detail: null };
        }
        const targetEntry = target.roster.find((r) => r.agentInstanceId === targetAgentInstanceId && !r.isVoided);
        if (!targetEntry) {
          return { state, error: "AGENT_NOT_FOUND", detail: { targetAgentInstanceId } };
        }
        if (targetEntry.onboardingToken && targetEntry.onboardingToken.active) {
          return { state, error: "AGENT_HAS_ONBOARDING_TOKEN", detail: null };
        }
        if (targetEntry.loyaltyToken && targetEntry.loyaltyToken.active) {
          return { state, error: "AGENT_HAS_LOYALTY_TOKEN", detail: null };
        }
        if (typeof targetEntry.recruitmentProtectedUntilRound === "number" && state.phase.round <= targetEntry.recruitmentProtectedUntilRound) {
          return { state, error: "AGENT_RECRUITMENT_PROTECTED", detail: { protectedUntilRound: targetEntry.recruitmentProtectedUntilRound } };
        }
        const targetStats = getAgentStats(state, targetEntry.catalogId);
        if (targetStats && targetStats.network.role === "follower" && targetStats.network.influencerCatalogId) {
          const influencerStillPresent = target.roster.some((r) => !r.isVoided && r.catalogId === targetStats.network.influencerCatalogId);
          const followerHasLoyalty = targetEntry.loyaltyToken && targetEntry.loyaltyToken.active;
          if (influencerStillPresent && !followerHasLoyalty) {
            return { state, error: "FOLLOWER_TETHERED_TO_INFLUENCER", detail: { influencerCatalogId: targetStats.network.influencerCatalogId } };
          }
        }
        if (!hasOpenDesk(state, playerId)) {
          return { state, error: "NO_OPEN_DESK", detail: { deskUsed: computeDeskUsage(state, playerId), capacity: player.tracks.offices.unlocked } };
        }
        const agentStats = getAgentStats(state, targetEntry.catalogId);
        if (!agentStats) {
          return { state, error: "AGENT_CATALOG_ENTRY_NOT_FOUND", detail: { catalogId: targetEntry.catalogId } };
        }
        const matchCount = countMatchingValues(player.tracks, agentStats, getAggressivePoacherReduction(player));
        if (matchCount < MIN_MATCHING_VALUES_TO_POACH) {
          return { state, error: "INSUFFICIENT_MATCHING_VALUES", detail: { required: MIN_MATCHING_VALUES_TO_POACH, matched: matchCount } };
        }
        const poacherReductionApplied = getAggressivePoacherReduction(player) > 0;
        let nextState = {
          ...state,
          players: {
            ...state.players,
            [targetPlayerId]: { ...target, roster: target.roster.filter((r) => r.agentInstanceId !== targetAgentInstanceId) }
          }
        };
        if (poacherReductionApplied) {
          nextState = markOncePerRoundAbilityUsed(nextState, playerId, "AGGRESSIVE_POACHER");
        }
        nextState = addAgentToRoster(nextState, playerId, targetEntry.catalogId, "poached");
        if (targetEntry.coachTokens > 0) {
          const newEntry = nextState.players[playerId].roster[nextState.players[playerId].roster.length - 1];
          nextState = {
            ...nextState,
            players: {
              ...nextState.players,
              [playerId]: {
                ...nextState.players[playerId],
                roster: nextState.players[playerId].roster.map(
                  (r) => r.agentInstanceId === newEntry.agentInstanceId ? { ...r, coachTokens: targetEntry.coachTokens } : r
                )
              }
            }
          };
        }
        nextState = appendLog(nextState, {
          type: "AGENT_POACHED",
          playerId,
          targetPlayerId,
          agentCatalogId: targetEntry.catalogId,
          coachTokensTransferred: targetEntry.coachTokens,
          message: `${playerId} poaches ${agentStats.name} directly from ${targetPlayerId}'s brokerage \u2014 no PT paid, no Market Report triggered.`
        });
        if (agentStats.network.role === "influencer") {
          nextState = networkBreakSpaceCheck(nextState, targetPlayerId);
          nextState = followerFlight(nextState, playerId, targetPlayerId, targetEntry.catalogId);
        }
        nextState = checkGlobalFirstToMilestones(nextState, playerId);
        return { state: nextState, error: null, detail: null };
      }
      function placeLoyaltyToken(state, playerId, agentInstanceId) {
        const player = state.players[playerId];
        if (!player) {
          return { state, error: "PLAYER_NOT_FOUND", detail: { playerId } };
        }
        if (player.loyaltyTokensUsed >= player.loyaltyTokensMax) {
          return { state, error: "LOYALTY_TOKENS_EXHAUSTED", detail: { used: player.loyaltyTokensUsed, max: player.loyaltyTokensMax } };
        }
        const entry = player.roster.find((r) => r.agentInstanceId === agentInstanceId && !r.isVoided);
        if (!entry) {
          return { state, error: "AGENT_NOT_FOUND", detail: { agentInstanceId } };
        }
        if (entry.loyaltyToken && entry.loyaltyToken.active) {
          return { state, error: "AGENT_ALREADY_LOYAL", detail: null };
        }
        const agentStats = getAgentStats(state, entry.catalogId);
        if (!agentStats) {
          return { state, error: "AGENT_CATALOG_ENTRY_NOT_FOUND", detail: { catalogId: entry.catalogId } };
        }
        const matchCount = countMatchingValues(player.tracks, agentStats);
        if (matchCount < VALUE_DIMENSIONS.length) {
          return { state, error: "ALL_VALUES_NOT_MET", detail: { required: VALUE_DIMENSIONS.length, matched: matchCount } };
        }
        const nextState = {
          ...state,
          players: {
            ...state.players,
            [playerId]: {
              ...player,
              loyaltyTokensUsed: player.loyaltyTokensUsed + 1,
              roster: player.roster.map((r) => r.agentInstanceId === agentInstanceId ? { ...r, loyaltyToken: { active: true } } : r)
            }
          }
        };
        return {
          state: appendLog(nextState, {
            type: "LOYALTY_TOKEN_PLACED",
            playerId,
            agentInstanceId,
            agentCatalogId: entry.catalogId,
            message: `${playerId} places a Loyalty Token on ${agentStats.name} \u2014 all 3 values met (${player.loyaltyTokensUsed + 1}/${player.loyaltyTokensMax} used).`
          }),
          error: null,
          detail: null
        };
      }
      function moveLoyaltyToken(state, playerId, fromAgentInstanceId, toAgentInstanceId) {
        const player = state.players[playerId];
        if (!player) {
          return { state, error: "PLAYER_NOT_FOUND", detail: { playerId } };
        }
        if (player.loyaltyTokensUsed < player.loyaltyTokensMax) {
          return { state, error: "NOT_ALL_TOKENS_DEPLOYED_YET", detail: { used: player.loyaltyTokensUsed, max: player.loyaltyTokensMax } };
        }
        const fromEntry = player.roster.find((r) => r.agentInstanceId === fromAgentInstanceId && !r.isVoided);
        if (!fromEntry || !fromEntry.loyaltyToken || !fromEntry.loyaltyToken.active) {
          return { state, error: "SOURCE_AGENT_NOT_LOYAL", detail: { fromAgentInstanceId } };
        }
        const toEntry = player.roster.find((r) => r.agentInstanceId === toAgentInstanceId && !r.isVoided);
        if (!toEntry) {
          return { state, error: "TARGET_AGENT_NOT_FOUND", detail: { toAgentInstanceId } };
        }
        if (toEntry.loyaltyToken && toEntry.loyaltyToken.active) {
          return { state, error: "TARGET_ALREADY_LOYAL", detail: null };
        }
        const agentStats = getAgentStats(state, toEntry.catalogId);
        if (!agentStats) {
          return { state, error: "AGENT_CATALOG_ENTRY_NOT_FOUND", detail: { catalogId: toEntry.catalogId } };
        }
        const matchCount = countMatchingValues(player.tracks, agentStats);
        if (matchCount < VALUE_DIMENSIONS.length) {
          return { state, error: "ALL_VALUES_NOT_MET", detail: { required: VALUE_DIMENSIONS.length, matched: matchCount } };
        }
        const nextState = {
          ...state,
          players: {
            ...state.players,
            [playerId]: {
              ...player,
              roster: player.roster.map((r) => {
                if (r.agentInstanceId === fromAgentInstanceId) return { ...r, loyaltyToken: { active: false } };
                if (r.agentInstanceId === toAgentInstanceId) return { ...r, loyaltyToken: { active: true } };
                return r;
              })
            }
          }
        };
        return {
          state: appendLog(nextState, {
            type: "LOYALTY_TOKEN_MOVED",
            playerId,
            fromAgentInstanceId,
            toAgentInstanceId,
            message: `${playerId} moves their Loyalty Token to ${agentStats.name}, leaving the previous agent vulnerable to poaching.`
          }),
          error: null,
          detail: null
        };
      }
      function verifyPendingGrowthHubAgentChoice(state, playerId, expectedSpaceId) {
        const interrupt = state.phase.pendingInterrupt;
        if (!interrupt || interrupt.type !== "ACTION_SPACE_DEFERRED_CHOICE" || interrupt.sourcePlayerId !== playerId || !interrupt.data || interrupt.data.spaceType !== "draft_open_market_agent" || interrupt.data.spaceId !== expectedSpaceId) {
          return {
            ok: false,
            error: "NO_PENDING_AGENT_ACTION_CHOICE",
            detail: { playerId, expectedSpaceId, pendingInterrupt: interrupt || null }
          };
        }
        return { ok: true };
      }
      function clearInterruptAndPassTurn(state) {
        if (state.phase.pendingInterrupt && state.phase.pendingInterrupt.type === "SHIFT_CARD_RESOLUTION") {
          return state;
        }
        return advanceActivePlayer({ ...state, phase: { ...state.phase, pendingInterrupt: NULL_INTERRUPT } });
      }
      function resolveRecruitFromGrowthHub(state, playerId, agentCatalogId) {
        const check = verifyPendingGrowthHubAgentChoice(state, playerId, "GRW_RECRUIT_AGENT");
        if (!check.ok) {
          return { state, error: check.error, detail: check.detail };
        }
        const result = recruitOpenMarketAgent(state, playerId, agentCatalogId);
        if (result.error) {
          return result;
        }
        return { state: clearInterruptAndPassTurn(result.state), error: null, detail: null };
      }
      function resolvePoachFromGrowthHub(state, playerId, targetPlayerId, targetAgentInstanceId) {
        const check = verifyPendingGrowthHubAgentChoice(state, playerId, "GRW_POACH_AGENT");
        if (!check.ok) {
          return { state, error: check.error, detail: check.detail };
        }
        const result = poachCompetingBrokerAgent(state, playerId, targetPlayerId, targetAgentInstanceId);
        if (result.error) {
          return result;
        }
        return { state: clearInterruptAndPassTurn(result.state), error: null, detail: null };
      }
      function resolveLoyaltyFromGrowthHub(state, playerId, agentInstanceId, fromAgentInstanceId) {
        const check = verifyPendingGrowthHubAgentChoice(state, playerId, "GRW_LOYALTY_TOKEN");
        if (!check.ok) {
          return { state, error: check.error, detail: check.detail };
        }
        const player = state.players[playerId];
        if (!player) {
          return { state, error: "PLAYER_NOT_FOUND", detail: { playerId } };
        }
        const result = player.loyaltyTokensUsed >= player.loyaltyTokensMax ? moveLoyaltyToken(state, playerId, fromAgentInstanceId, agentInstanceId) : placeLoyaltyToken(state, playerId, agentInstanceId);
        if (result.error) {
          return result;
        }
        return { state: clearInterruptAndPassTurn(result.state), error: null, detail: null };
      }
      function resolveCrmUpdateChoice(state, playerId, chosenCatalogId) {
        const interrupt = state.phase.pendingInterrupt;
        if (!interrupt || interrupt.type !== "ACTION_CARD_EFFECT_CHOICE" || interrupt.sourcePlayerId !== playerId || !interrupt.data || interrupt.data.choiceType !== "CRM_UPDATE_RECRUIT") {
          return { state, error: "NO_PENDING_CRM_UPDATE_CHOICE", detail: { playerId, pendingInterrupt: interrupt || null } };
        }
        const { candidateCatalogIds } = interrupt.data;
        if (!candidateCatalogIds.includes(chosenCatalogId)) {
          return { state, error: "CATALOG_ID_NOT_A_CANDIDATE", detail: { chosenCatalogId, candidateCatalogIds } };
        }
        const crmPlayer = state.players[playerId];
        if (!hasOpenDesk(state, playerId)) {
          return { state, error: "NO_OPEN_DESK", detail: { deskUsed: computeDeskUsage(state, playerId), capacity: crmPlayer.tracks.offices.unlocked } };
        }
        const agentStats = getAgentStats(state, chosenCatalogId);
        if (!agentStats) {
          return { state, error: "AGENT_CATALOG_ENTRY_NOT_FOUND", detail: { catalogId: chosenCatalogId } };
        }
        const matchCount = countMatchingValues(crmPlayer.tracks, agentStats);
        if (matchCount < MIN_MATCHING_VALUES_TO_RECRUIT) {
          return { state, error: "NO_MATCHING_VALUE", detail: { required: MIN_MATCHING_VALUES_TO_RECRUIT, matched: matchCount } };
        }
        let nextState = addAgentToRoster(state, playerId, chosenCatalogId, "recruited");
        const returnedCatalogIds = candidateCatalogIds.filter((id) => id !== chosenCatalogId);
        const drawPile = nextState.board.decks && nextState.board.decks.agentDrawPile || [];
        nextState = {
          ...nextState,
          board: {
            ...nextState.board,
            decks: { ...nextState.board.decks, agentDrawPile: [...returnedCatalogIds, ...drawPile] }
          },
          phase: { ...nextState.phase, pendingInterrupt: NULL_INTERRUPT }
        };
        nextState = appendLog(nextState, {
          type: "ACTION_CARD_EFFECT_CRM_UPDATE_RESOLVED",
          playerId,
          catalogId: "GRW_016",
          recruitedCatalogId: chosenCatalogId,
          returnedCatalogIds,
          message: `${playerId} recruits ${agentStats.name} via CRM Update \u2014 the other ${returnedCatalogIds.length} peeked Agent(s) return to the top of the deck.`
        });
        return { state: advanceActivePlayer(nextState), error: null, detail: null };
      }
      function deployBankedBonusToken(state, playerId, tokenType, options = {}) {
        const player = state.players[playerId];
        if (!player) {
          return { state, error: "PLAYER_NOT_FOUND", detail: { playerId } };
        }
        const tokenIndex = player.bankedBonusTokens.indexOf(tokenType);
        if (tokenIndex === -1) {
          return { state, error: "TOKEN_NOT_BANKED", detail: { tokenType, banked: player.bankedBonusTokens } };
        }
        const consumeToken = (s) => ({
          ...s,
          players: {
            ...s.players,
            [playerId]: {
              ...s.players[playerId],
              bankedBonusTokens: s.players[playerId].bankedBonusTokens.filter((_, i) => i !== tokenIndex)
            }
          }
        });
        if (tokenType === "FREE_5PT") {
          const nextState = appendLog(consumeToken(adjustWallet(state, playerId, 5, 0)), {
            type: "BANKED_TOKEN_DEPLOYED",
            playerId,
            tokenType,
            message: `${playerId} deploys a banked FREE_5PT token \u2014 +5 PT.`
          });
          return { state: nextState, error: null, detail: null };
        }
        if (tokenType === "FREE_1PT") {
          const nextState = appendLog(consumeToken(adjustWallet(state, playerId, 1, 0)), {
            type: "BANKED_TOKEN_DEPLOYED",
            playerId,
            tokenType,
            message: `${playerId} deploys a banked FREE_1PT token \u2014 +1 PT.`
          });
          return { state: nextState, error: null, detail: null };
        }
        if (tokenType === "FREE_OPEN_MARKET_AGENT") {
          const { targetCatalogId } = options;
          if (!targetCatalogId) {
            return { state, error: "TARGET_CATALOG_ID_REQUIRED", detail: null };
          }
          if (!(state.board.openMarketAgents || []).some((a) => a.catalogId === targetCatalogId)) {
            return { state, error: "AGENT_NOT_IN_OPEN_MARKET", detail: { targetCatalogId } };
          }
          if (!hasOpenDesk(state, playerId)) {
            return { state, error: "NO_OPEN_DESK", detail: null };
          }
          let nextState = addAgentToRoster(state, playerId, targetCatalogId, "recruited");
          nextState = removeFromOpenMarketAndRefill(nextState, targetCatalogId);
          nextState = consumeToken(nextState);
          const agentStats = getAgentStats(nextState, targetCatalogId);
          nextState = appendLog(nextState, {
            type: "BANKED_TOKEN_DEPLOYED",
            playerId,
            tokenType,
            targetCatalogId,
            message: `${playerId} deploys a banked FREE_OPEN_MARKET_AGENT token \u2014 recruits ${agentStats ? agentStats.name : targetCatalogId} for free, all Brokerage Values waived.`
          });
          return { state: nextState, error: null, detail: null };
        }
        if (tokenType === "FREE_COACH_TOKEN") {
          const { targetAgentInstanceId } = options;
          const entry = player.roster.find((r) => r.agentInstanceId === targetAgentInstanceId && !r.isVoided);
          if (!entry) {
            return { state, error: "AGENT_NOT_FOUND", detail: { targetAgentInstanceId } };
          }
          let nextState = {
            ...state,
            players: {
              ...state.players,
              [playerId]: {
                ...player,
                roster: player.roster.map((r) => r.agentInstanceId === targetAgentInstanceId ? { ...r, coachTokens: r.coachTokens + 1 } : r)
              }
            }
          };
          nextState = consumeToken(nextState);
          nextState = appendLog(nextState, {
            type: "BANKED_TOKEN_DEPLOYED",
            playerId,
            tokenType,
            targetAgentInstanceId,
            message: `${playerId} deploys a banked FREE_COACH_TOKEN token \u2014 assigns a Coach Token to ${entry.catalogId}.`
          });
          return { state: nextState, error: null, detail: null };
        }
        if (tokenType === "FREE_LOYALTY_TOKEN") {
          const { targetAgentInstanceId } = options;
          const result = placeLoyaltyToken(state, playerId, targetAgentInstanceId);
          if (result.error) {
            return result;
          }
          const nextState = appendLog(consumeToken(result.state), {
            type: "BANKED_TOKEN_DEPLOYED",
            playerId,
            tokenType,
            targetAgentInstanceId,
            message: `${playerId} deploys a banked FREE_LOYALTY_TOKEN token \u2014 locks down an Agent for free (all 3 Brokerage Values still required, per placeLoyaltyToken's own real gate).`
          });
          return { state: nextState, error: null, detail: null };
        }
        if (tokenType === "FREE_ACTION") {
          const { mode, cardInstanceId } = options;
          if (mode === "acquire") {
            const drawPile = player.hand.personalDrawPile;
            if (drawPile.length === 0) {
              return { state, error: "DRAW_PILE_EMPTY", detail: null };
            }
            const [drawnCatalogId, ...restDrawPile] = drawPile;
            const newCardInstanceId = `ac-${playerId}-freeaction-r${state.phase.round}-${player.hand.actionCards.length}`;
            let nextState = {
              ...state,
              players: {
                ...state.players,
                [playerId]: {
                  ...player,
                  hand: {
                    ...player.hand,
                    actionCards: [...player.hand.actionCards, { instanceId: newCardInstanceId, catalogId: drawnCatalogId }],
                    personalDrawPile: restDrawPile
                  }
                }
              }
            };
            nextState = consumeToken(nextState);
            nextState = appendLog(nextState, {
              type: "BANKED_TOKEN_DEPLOYED",
              playerId,
              tokenType,
              mode,
              drawnCatalogId,
              message: `${playerId} deploys a banked FREE_ACTION token \u2014 acquires ${drawnCatalogId} without spending a Time Meeple.`
            });
            return { state: nextState, error: null, detail: null };
          }
          if (mode === "acquire_from_open_market") {
            const { targetCatalogId: marketCatalogId } = options;
            const openMarket = state.board && state.board.openMarketActionCards || [];
            const marketIndex = openMarket.findIndex((c) => c.catalogId === marketCatalogId);
            if (marketIndex === -1) {
              return { state, error: "CARD_NOT_IN_OPEN_MARKET", detail: { marketCatalogId } };
            }
            const acquiredCatalogId = openMarket[marketIndex].catalogId;
            const remainingMarket = openMarket.filter((_, i) => i !== marketIndex);
            const drawPile = state.board && state.board.decks && state.board.decks.actionCardDrawPile || [];
            const refillCatalogId = drawPile.length > 0 ? drawPile[0] : null;
            const newOpenMarket = refillCatalogId ? [{ catalogId: refillCatalogId }, ...remainingMarket] : remainingMarket;
            const newDrawPile = refillCatalogId ? drawPile.slice(1) : drawPile;
            const newCardEntry = { instanceId: `ac-${playerId}-freeactionmarket-r${state.phase.round}-${player.hand.actionCards.length}`, catalogId: acquiredCatalogId };
            const bothPersonalPilesEmpty = player.hand.personalDrawPile.length === 0 && player.hand.personalDiscardPile.length === 0;
            const goesToHand = player.hand.actionCards.length < player.hand.maxHandSize || bothPersonalPilesEmpty;
            let nextState = {
              ...state,
              board: {
                ...state.board,
                openMarketActionCards: newOpenMarket,
                decks: { ...state.board.decks, actionCardDrawPile: newDrawPile }
              },
              players: {
                ...state.players,
                [playerId]: {
                  ...player,
                  hand: {
                    ...player.hand,
                    actionCards: goesToHand ? [...player.hand.actionCards, newCardEntry] : player.hand.actionCards,
                    personalDiscardPile: goesToHand ? player.hand.personalDiscardPile : [...player.hand.personalDiscardPile, newCardEntry]
                  }
                }
              }
            };
            nextState = consumeToken(nextState);
            nextState = appendLog(nextState, {
              type: "BANKED_TOKEN_DEPLOYED",
              playerId,
              tokenType,
              mode,
              acquiredCatalogId,
              message: `${playerId} deploys a banked FREE_ACTION token \u2014 acquires ${acquiredCatalogId} directly from the Open Market for $0 PT.`
            });
            return { state: nextState, error: null, detail: null };
          }
          if (mode === "play") {
            const result = playActionCard(state, playerId, cardInstanceId);
            if (result.error) {
              return result;
            }
            const nextState = appendLog(consumeToken(result.state), {
              type: "BANKED_TOKEN_DEPLOYED",
              playerId,
              tokenType,
              mode,
              cardInstanceId,
              message: `${playerId} deploys a banked FREE_ACTION token \u2014 plays a card without spending a Time Meeple (still paid its PT cost).`
            });
            return { state: nextState, error: null, detail: null };
          }
          return { state, error: "INVALID_FREE_ACTION_MODE", detail: { mode } };
        }
        return { state, error: "UNKNOWN_TOKEN_TYPE", detail: { tokenType } };
      }
      module.exports = {
        resetAgentInstanceCounter,
        recruitOpenMarketAgent,
        poachCompetingBrokerAgent,
        placeLoyaltyToken,
        moveLoyaltyToken,
        resolveRecruitFromGrowthHub,
        resolvePoachFromGrowthHub,
        resolveLoyaltyFromGrowthHub,
        resolveCrmUpdateChoice,
        deployBankedBonusToken,
        computeDeskUsage,
        hasOpenDesk,
        countMatchingValues,
        getAggressivePoacherReduction,
        markOncePerRoundAbilityUsed,
        addAgentToRoster,
        getAgentStats,
        drawAgentCardsWithAutoRecruitCheck,
        VALUE_DIMENSIONS,
        MIN_MATCHING_VALUES_TO_RECRUIT,
        MIN_MATCHING_VALUES_TO_POACH
      };
    }
  });

  // endOfRoundReducer.js
  var require_endOfRoundReducer = __commonJS({
    "endOfRoundReducer.js"(exports, module) {
      var { adjustWallet, getSharedRng } = require_cardEffectHelpers();
      var { endOfRoundShiftImmunitySweep } = require_immunityReducer();
      var { isGameOver, runFinalScoring } = require_scoringEngine();
      function appendLog(state, entry) {
        const logEntry = {
          seq: state.log.length + 1,
          timestamp: (/* @__PURE__ */ new Date()).toISOString(),
          round: state.phase.round,
          ...entry
        };
        return { ...state, log: [...state.log, logEntry] };
      }
      var _actionCardInstanceCounter = 0;
      function resetActionCardInstanceCounter() {
        _actionCardInstanceCounter = 0;
      }
      function generateActionCardInstanceId(playerId) {
        _actionCardInstanceCounter += 1;
        return `ac-${playerId}-redraw-${_actionCardInstanceCounter}`;
      }
      var BASE_ROUND_DIVIDEND = 4;
      function incomeCollectionSweep(state) {
        let nextState = { ...state, phase: { ...state.phase, current: "END_OF_ROUND_INCOME" } };
        Object.keys(nextState.players).forEach((playerId) => {
          nextState = adjustWallet(nextState, playerId, BASE_ROUND_DIVIDEND, 0);
        });
        nextState = appendLog(nextState, {
          type: "BASE_ROUND_DIVIDEND_PAID",
          amount: BASE_ROUND_DIVIDEND,
          playerIds: Object.keys(nextState.players),
          message: `Every player receives the flat ${BASE_ROUND_DIVIDEND} PT Base Round Dividend.`
        });
        return nextState;
      }
      var MEEPLE_TAX_RATE = 4;
      var MEEPLE_TAX_FREE_THRESHOLD = 3;
      function byHiredRoundDescending(entries) {
        return [...entries].sort((a, b) => {
          const aKey = a.meeple.hiredRound ?? a.originalIndex;
          const bKey = b.meeple.hiredRound ?? b.originalIndex;
          return bKey - aKey;
        });
      }
      function repossessMeeples(state, playerId, count) {
        const player = state.players[playerId];
        const active = player.timeMeeples.active;
        const taxablePool = active.map((meeple, originalIndex) => ({ meeple, originalIndex })).filter((entry) => entry.originalIndex >= MEEPLE_TAX_FREE_THRESHOLD);
        const ranked = byHiredRoundDescending(taxablePool);
        const toRemove = ranked.slice(0, count).map((entry) => entry.meeple);
        const removeIds = new Set(toRemove.map((m) => m.instanceId));
        const updatedActive = active.filter((m) => !removeIds.has(m.instanceId));
        const nextState = {
          ...state,
          players: {
            ...state.players,
            [playerId]: {
              ...player,
              timeMeeples: { ...player.timeMeeples, active: updatedActive }
            }
          },
          bank: {
            ...state.bank,
            timeMeeples: state.bank.timeMeeples + toRemove.length
          }
        };
        return { state: nextState, removed: toRemove };
      }
      function meepleTaxSweep(state) {
        let nextState = { ...state, phase: { ...state.phase, current: "END_OF_ROUND_MEEPLE_TAX" } };
        Object.keys(nextState.players).forEach((playerId) => {
          const activeCount = nextState.players[playerId].timeMeeples.active.length;
          const taxableCount = Math.max(0, activeCount - MEEPLE_TAX_FREE_THRESHOLD);
          const taxOwed = taxableCount * MEEPLE_TAX_RATE;
          if (taxOwed === 0) {
            return;
          }
          const walletBalance = nextState.players[playerId].wallet.profitTokens;
          if (walletBalance >= taxOwed) {
            nextState = adjustWallet(nextState, playerId, -taxOwed, 0);
            nextState = appendLog(nextState, {
              type: "MEEPLE_TAX_PAID",
              playerId,
              amount: taxOwed
            });
          } else {
            const affordablePayment = walletBalance;
            nextState = adjustWallet(nextState, playerId, -affordablePayment, 0);
            const shortfall = taxOwed - affordablePayment;
            const meeplesToRepossess = Math.ceil(shortfall / MEEPLE_TAX_RATE);
            const repossession = repossessMeeples(nextState, playerId, meeplesToRepossess);
            nextState = repossession.state;
            nextState = appendLog(nextState, {
              type: "MEEPLE_TAX_DEFAULTED",
              playerId,
              partialPaymentMade: affordablePayment,
              meeplesRepossessed: repossession.removed.map((m) => m.instanceId)
            });
          }
        });
        return nextState;
      }
      function compareBids(a, b) {
        const aHasPriority = a.priorityBid > 0;
        const bHasPriority = b.priorityBid > 0;
        if (aHasPriority !== bHasPriority) {
          return aHasPriority ? -1 : 1;
        }
        if (a.priorityBid !== b.priorityBid) {
          return b.priorityBid - a.priorityBid;
        }
        if (a.cashBid !== b.cashBid) {
          return b.cashBid - a.cashBid;
        }
        return a.legacyRank - b.legacyRank;
      }
      function resolveTurnOrderBidding(state) {
        let nextState = { ...state, phase: { ...state.phase, current: "TURN_ORDER_BIDDING" } };
        const legacyOrder = nextState.phase.turnOrder;
        const ranked = Object.values(nextState.players).map((player) => ({
          playerId: player.playerId,
          priorityBid: player.turnOrderBid.priorityTokensBid,
          cashBid: player.turnOrderBid.profitTokensBid,
          legacyRank: legacyOrder.indexOf(player.playerId)
        })).sort(compareBids);
        ranked.forEach((entry) => {
          nextState = {
            ...nextState,
            players: {
              ...nextState.players,
              [entry.playerId]: {
                ...nextState.players[entry.playerId],
                turnOrderBid: { ...nextState.players[entry.playerId].turnOrderBid, status: "revealed" }
              }
            }
          };
        });
        const newTurnOrder = ranked.map((entry) => entry.playerId);
        nextState = {
          ...nextState,
          phase: {
            ...nextState.phase,
            current: "TURN_ORDER_RESOLUTION",
            turnOrder: newTurnOrder,
            activePlayerId: newTurnOrder[0]
          }
        };
        nextState = appendLog(nextState, {
          type: "TURN_ORDER_RESOLVED",
          turnOrder: newTurnOrder,
          bids: ranked
        });
        newTurnOrder.forEach((playerId, index) => {
          if (index === 0) return;
          nextState = adjustWallet(nextState, playerId, index, 0);
        });
        nextState = appendLog(nextState, {
          type: "TURN_ORDER_COMPENSATION_PAID",
          turnOrder: newTurnOrder,
          message: `Turn order compensation paid: ${newTurnOrder.map((playerId, index) => `${playerId} +${index} PT`).join(", ")}.`
        });
        Object.keys(nextState.players).forEach((playerId) => {
          nextState = {
            ...nextState,
            players: {
              ...nextState.players,
              [playerId]: {
                ...nextState.players[playerId],
                turnOrderBid: { status: "hidden", profitTokensBid: 0, priorityTokensBid: 0, submitted: false }
              }
            }
          };
        });
        return nextState;
      }
      function endOfRoundHandDiscardSweep(state) {
        let nextState = { ...state, phase: { ...state.phase, current: "END_OF_ROUND_HAND_DISCARD" } };
        Object.keys(nextState.players).forEach((playerId) => {
          const player = nextState.players[playerId];
          if (player.hand.actionCards.length === 0) {
            return;
          }
          const discardedIds = player.hand.actionCards.map((c) => c.instanceId);
          nextState = {
            ...nextState,
            players: {
              ...nextState.players,
              [playerId]: {
                ...player,
                hand: {
                  ...player.hand,
                  actionCards: [],
                  personalDiscardPile: [...player.hand.personalDiscardPile, ...player.hand.actionCards],
                  overHandSizeLimit: false,
                  pendingDiscardCount: 0
                }
              }
            }
          };
          nextState = appendLog(nextState, {
            type: "HAND_DISCARDED_END_OF_ROUND",
            playerId,
            discardedInstanceIds: discardedIds
          });
        });
        return nextState;
      }
      function meepleReturnSweep(state) {
        let nextState = state;
        Object.keys(nextState.players).forEach((playerId) => {
          const player = nextState.players[playerId];
          const updatedActive = player.timeMeeples.active.map(
            (m) => m.status === "on_board" ? { ...m, status: "in_supply", locationSpaceId: null } : m
          );
          const updatedCopycatMeeple = player.timeMeeples.copycatMeeple && player.timeMeeples.copycatMeeple.status === "on_board" ? { ...player.timeMeeples.copycatMeeple, status: "in_supply", locationSpaceId: null } : player.timeMeeples.copycatMeeple;
          nextState = {
            ...nextState,
            players: {
              ...nextState.players,
              [playerId]: { ...player, timeMeeples: { ...player.timeMeeples, active: updatedActive, copycatMeeple: updatedCopycatMeeple } }
            }
          };
        });
        nextState = {
          ...nextState,
          board: {
            ...nextState.board,
            actionSpaces: nextState.board.actionSpaces.map((s) => ({ ...s, occupiedBy: [] }))
          }
        };
        return appendLog(nextState, { type: "MEEPLES_RETURNED_TO_SUPPLY" });
      }
      function advanceRoundTracker(state) {
        const nextState = { ...state, phase: { ...state.phase, round: state.phase.round + 1 } };
        return appendLog(nextState, { type: "ROUND_ADVANCED", newRound: nextState.phase.round });
      }
      function drawOneActionCardCatalogId(drawPile, discardPile) {
        if (drawPile.length > 0) {
          return { catalogId: drawPile[0], drawPile: drawPile.slice(1), discardPile, reshuffled: false };
        }
        if (discardPile.length > 0) {
          const rng = getSharedRng();
          const shuffled = discardPile.map((c) => c.catalogId);
          for (let i = shuffled.length - 1; i > 0; i -= 1) {
            const j = Math.floor(rng() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
          }
          return { catalogId: shuffled[0], drawPile: shuffled.slice(1), discardPile: [], reshuffled: true };
        }
        return { catalogId: null, drawPile, discardPile, reshuffled: false };
      }
      function endOfRoundHandRedrawSweep(state) {
        let nextState = state;
        Object.keys(nextState.players).forEach((playerId) => {
          const player = nextState.players[playerId];
          const targetSize = player.hand.maxHandSize;
          let drawPile = player.hand.personalDrawPile;
          let discardPile = player.hand.personalDiscardPile;
          const drawnCatalogIds = [];
          let reshuffleOccurred = false;
          while (player.hand.actionCards.length + drawnCatalogIds.length < targetSize) {
            const draw = drawOneActionCardCatalogId(drawPile, discardPile);
            drawPile = draw.drawPile;
            discardPile = draw.discardPile;
            if (draw.reshuffled) {
              reshuffleOccurred = true;
            }
            if (draw.catalogId) {
              drawnCatalogIds.push(draw.catalogId);
            } else {
              break;
            }
          }
          if (drawnCatalogIds.length === 0 && !reshuffleOccurred) {
            return;
          }
          const newHandCards = drawnCatalogIds.map((catalogId) => ({
            instanceId: generateActionCardInstanceId(playerId),
            catalogId
          }));
          nextState = {
            ...nextState,
            players: {
              ...nextState.players,
              [playerId]: {
                ...player,
                hand: {
                  ...player.hand,
                  actionCards: [...player.hand.actionCards, ...newHandCards],
                  personalDrawPile: drawPile,
                  personalDiscardPile: discardPile
                }
              }
            }
          };
          nextState = appendLog(nextState, {
            type: "HAND_REDRAWN_END_OF_ROUND",
            playerId,
            drawnCount: drawnCatalogIds.length,
            reshuffleOccurred,
            handSizeAfter: player.hand.actionCards.length + drawnCatalogIds.length,
            message: `${playerId} draws ${drawnCatalogIds.length} card(s) to refresh their hand${reshuffleOccurred ? " (discard pile reshuffled into a new draw pile mid-draw)" : ""}.`
          });
        });
        return nextState;
      }
      var { drawAgentCardsWithAutoRecruitCheck } = require_agentRecruitmentReducer();
      function churnAgentMarketRowWithAutoRecruit(state, existingEntries, drawPile, discardPile = []) {
        const KEPT_COUNT = Math.max(0, existingEntries.length - 2);
        const kept = existingEntries.slice(0, KEPT_COUNT);
        const {
          state: nextState,
          marketEntries: drawn,
          remainingDrawPile,
          remainingDiscardPile
        } = drawAgentCardsWithAutoRecruitCheck(state, drawPile, 2, discardPile);
        return {
          state: nextState,
          newRow: [...drawn, ...kept],
          newDrawPile: remainingDrawPile,
          newDiscardPile: remainingDiscardPile,
          purgedCount: existingEntries.length - KEPT_COUNT
        };
      }
      function churnMarketRow(existingEntries, drawPile) {
        const KEPT_COUNT = Math.max(0, existingEntries.length - 2);
        const kept = existingEntries.slice(0, KEPT_COUNT);
        const drawCount = Math.min(2, drawPile.length);
        const drawn = drawPile.slice(0, drawCount).map((catalogId) => ({ catalogId }));
        const newDrawPile = drawPile.slice(drawCount);
        return { newRow: [...drawn, ...kept], newDrawPile, purgedCount: existingEntries.length - KEPT_COUNT };
      }
      function openMarketChurnSweep(state) {
        let nextState = state;
        const actionCardRow = nextState.board.openMarketActionCards || [];
        const actionCardDrawPile = nextState.board.decks && nextState.board.decks.actionCardDrawPile || [];
        if (actionCardRow.length > 0) {
          const churned = churnMarketRow(actionCardRow, actionCardDrawPile);
          nextState = {
            ...nextState,
            board: {
              ...nextState.board,
              openMarketActionCards: churned.newRow,
              decks: { ...nextState.board.decks, actionCardDrawPile: churned.newDrawPile }
            }
          };
          if (churned.purgedCount > 0) {
            nextState = appendLog(nextState, {
              type: "OPEN_MARKET_CHURNED",
              market: "actionCards",
              purgedCount: churned.purgedCount,
              message: `The Action Card Open Market churns: ${churned.purgedCount} card(s) purged from the game, ${churned.newRow.length - (actionCardRow.length - churned.purgedCount)} new card(s) dealt.`
            });
          }
        }
        const agentRow = nextState.board.openMarketAgents || [];
        const agentDrawPile = nextState.board.decks && nextState.board.decks.agentDrawPile || [];
        const agentDiscardPile = nextState.board.decks && nextState.board.decks.agentDiscardPile || [];
        if (agentRow.length > 0) {
          const churned = churnAgentMarketRowWithAutoRecruit(nextState, agentRow, agentDrawPile, agentDiscardPile);
          nextState = {
            ...churned.state,
            board: {
              ...churned.state.board,
              openMarketAgents: churned.newRow,
              decks: { ...churned.state.board.decks, agentDrawPile: churned.newDrawPile, agentDiscardPile: churned.newDiscardPile }
            }
          };
          if (churned.purgedCount > 0) {
            nextState = appendLog(nextState, {
              type: "OPEN_MARKET_CHURNED",
              market: "agents",
              purgedCount: churned.purgedCount,
              message: `The Agent Open Market churns: ${churned.purgedCount} card(s) purged from the game, ${churned.newRow.length - (agentRow.length - churned.purgedCount)} new card(s) dealt.`
            });
          }
        }
        return nextState;
      }
      function onboardingTokenClearSweep(state) {
        let nextState = state;
        Object.keys(nextState.players).forEach((playerId) => {
          const player = nextState.players[playerId];
          const hasActiveOnboarding = player.roster.some((r) => r.onboardingToken && r.onboardingToken.active);
          if (!hasActiveOnboarding) return;
          const clearedCount = player.roster.filter((r) => r.onboardingToken && r.onboardingToken.active).length;
          nextState = {
            ...nextState,
            players: {
              ...nextState.players,
              [playerId]: {
                ...player,
                roster: player.roster.map(
                  (r) => r.onboardingToken && r.onboardingToken.active ? { ...r, onboardingToken: { active: false, expiresEndOfRound: null } } : r
                )
              }
            }
          };
          nextState = appendLog(nextState, {
            type: "ONBOARDING_TOKENS_CLEARED",
            playerId,
            clearedCount,
            message: `${playerId}'s ${clearedCount} Onboarding Token(s) expire \u2014 those Agents are now poachable.`
          });
        });
        return nextState;
      }
      function shellCompanyStashDiscardSweep(state) {
        let nextState = state;
        Object.keys(nextState.players).forEach((playerId) => {
          const player = nextState.players[playerId];
          if (!player.shellCompanyStash || player.shellCompanyStash.length === 0) return;
          const discardedCount = player.shellCompanyStash.length;
          nextState = {
            ...nextState,
            players: {
              ...nextState.players,
              [playerId]: { ...player, shellCompanyStash: [], shellCompanyRecruitsUsed: 0 }
            }
          };
          nextState = appendLog(nextState, {
            type: "SHELL_COMPANY_STASH_DISCARDED",
            playerId,
            discardedCount,
            message: `${playerId}'s ${discardedCount} remaining Shell Company stash Agent(s) are permanently discarded out of the game.`
          });
        });
        return nextState;
      }
      function graduateStaffInTrainingSweep(state) {
        let nextState = state;
        Object.keys(nextState.players).forEach((playerId) => {
          const player = nextState.players[playerId];
          const staffInTraining = player.timeMeeples && player.timeMeeples.staffInTraining || [];
          if (staffInTraining.length === 0) return;
          const graduated = staffInTraining.map((m) => ({ ...m, status: "in_supply", locationSpaceId: null }));
          const graduatedCount = graduated.length;
          nextState = {
            ...nextState,
            players: {
              ...nextState.players,
              [playerId]: {
                ...player,
                timeMeeples: {
                  ...player.timeMeeples,
                  active: [...player.timeMeeples.active, ...graduated],
                  staffInTraining: []
                }
              }
            }
          };
          nextState = appendLog(nextState, {
            type: "STAFF_IN_TRAINING_GRADUATED",
            playerId,
            graduatedCount,
            message: `${playerId}'s ${graduatedCount} Staff-in-Training meeple(s) become available to place starting next round.`
          });
        });
        return nextState;
      }
      function oncePerRoundAbilitiesResetSweep(state) {
        const updatedPlayers = {};
        Object.keys(state.players).forEach((playerId) => {
          updatedPlayers[playerId] = { ...state.players[playerId], oncePerRoundAbilitiesUsed: [], ghostInTheMachineBorrowedBranch: null };
        });
        return { ...state, players: { ...state.players, ...updatedPlayers } };
      }
      function signalJammerLockClearSweep(state) {
        return {
          ...state,
          board: {
            ...state.board,
            actionSpaces: state.board.actionSpaces.map((s) => s.status === "blocked" ? { ...s, status: "open" } : s)
          }
        };
      }
      function expiredStatusTokenClearSweep(state) {
        const statusTokens = state.board.statusTokens || [];
        const remaining = statusTokens.filter((t) => t.expiresAt !== "end_of_round");
        if (remaining.length === statusTokens.length) return state;
        return { ...state, board: { ...state.board, statusTokens: remaining } };
      }
      function runCleanupSweeps(state) {
        let nextState = endOfRoundHandDiscardSweep(state);
        nextState = endOfRoundHandRedrawSweep(nextState);
        nextState = endOfRoundShiftImmunitySweep(nextState);
        nextState = onboardingTokenClearSweep(nextState);
        nextState = openMarketChurnSweep(nextState);
        nextState = shellCompanyStashDiscardSweep(nextState);
        nextState = graduateStaffInTrainingSweep(nextState);
        nextState = meepleReturnSweep(nextState);
        nextState = oncePerRoundAbilitiesResetSweep(nextState);
        nextState = signalJammerLockClearSweep(nextState);
        nextState = expiredStatusTokenClearSweep(nextState);
        nextState = advanceRoundTracker(nextState);
        return nextState;
      }
      function allPlayerIdsWithActiveMeeples(state) {
        return Object.keys(state.players).filter(
          (playerId) => state.players[playerId].timeMeeples.active.length > 0
        );
      }
      function advanceToNextRoundOrFinalScoring(state) {
        if (isGameOver(state)) {
          return runFinalScoring(state);
        }
        return {
          ...state,
          phase: {
            ...state.phase,
            current: "SPECIALIST_REVEAL",
            // next round's opening phase, per schema enum order
            playersWithMeeplesRemaining: allPlayerIdsWithActiveMeeples(state)
          }
        };
      }
      function runPreBiddingSequence(state) {
        let nextState = incomeCollectionSweep(state);
        nextState = meepleTaxSweep(nextState);
        return { ...nextState, phase: { ...nextState.phase, current: "TURN_ORDER_BIDDING" } };
      }
      function runEndOfRoundSequence(state) {
        let nextState = incomeCollectionSweep(state);
        nextState = meepleTaxSweep(nextState);
        nextState = resolveTurnOrderBidding(nextState);
        nextState = runCleanupSweeps(nextState);
        return advanceToNextRoundOrFinalScoring(nextState);
      }
      module.exports = {
        resetActionCardInstanceCounter,
        runEndOfRoundSequence,
        runPreBiddingSequence,
        incomeCollectionSweep,
        meepleTaxSweep,
        repossessMeeples,
        resolveTurnOrderBidding,
        compareBids,
        runCleanupSweeps,
        endOfRoundHandDiscardSweep,
        endOfRoundShiftImmunitySweep,
        meepleReturnSweep,
        advanceRoundTracker,
        advanceToNextRoundOrFinalScoring
      };
    }
  });

  // openMarketActionCardReducer.js
  var require_openMarketActionCardReducer = __commonJS({
    "openMarketActionCardReducer.js"(exports, module) {
      var { verifyPendingActionCardChoice, NULL_INTERRUPT } = require_actionCardReducer();
      var { advanceActivePlayer } = require_workerPlacementReducer();
      function appendLog(state, entry) {
        const logEntry = {
          seq: state.log.length + 1,
          timestamp: (/* @__PURE__ */ new Date()).toISOString(),
          round: state.phase.round,
          ...entry
        };
        return { ...state, log: [...state.log, logEntry] };
      }
      var _actionCardInstanceCounter = 0;
      function resetActionCardInstanceCounter() {
        _actionCardInstanceCounter = 0;
      }
      function generateActionCardInstanceId(playerId) {
        _actionCardInstanceCounter += 1;
        return `ac-${playerId}-market-${_actionCardInstanceCounter}`;
      }
      function acquireActionCard(state, playerId, marketCatalogId) {
        const interruptCheck = verifyPendingActionCardChoice(state, playerId);
        if (!interruptCheck.ok) {
          return { state, error: interruptCheck.error, detail: interruptCheck.detail };
        }
        const player = state.players[playerId];
        if (!player) {
          return { state, error: "PLAYER_NOT_FOUND", detail: { playerId } };
        }
        const openMarket = state.board && state.board.openMarketActionCards || [];
        if (openMarket.length === 0) {
          return { state, error: "OPEN_MARKET_EMPTY", detail: null };
        }
        const usedDefaultSelection = marketCatalogId === void 0 || marketCatalogId === null;
        const marketIndex = usedDefaultSelection ? 0 : openMarket.findIndex((c) => c.catalogId === marketCatalogId);
        if (marketIndex === -1) {
          return { state, error: "CARD_NOT_IN_OPEN_MARKET", detail: { marketCatalogId } };
        }
        const acquiredCatalogId = openMarket[marketIndex].catalogId;
        const remainingMarket = openMarket.filter((_, i) => i !== marketIndex);
        const drawPile = state.board && state.board.decks && state.board.decks.actionCardDrawPile || [];
        const refillCatalogId = drawPile.length > 0 ? drawPile[0] : null;
        const newOpenMarket = refillCatalogId ? [{ catalogId: refillCatalogId }, ...remainingMarket] : remainingMarket;
        const newDrawPile = refillCatalogId ? drawPile.slice(1) : drawPile;
        const bothPersonalPilesEmpty = player.hand.personalDrawPile.length === 0 && player.hand.personalDiscardPile.length === 0;
        const goesToHand = player.hand.actionCards.length < player.hand.maxHandSize || bothPersonalPilesEmpty;
        const newCardEntry = { instanceId: generateActionCardInstanceId(playerId), catalogId: acquiredCatalogId };
        let nextState = {
          ...state,
          board: {
            ...state.board,
            openMarketActionCards: newOpenMarket,
            decks: { ...state.board.decks, actionCardDrawPile: newDrawPile }
          },
          players: {
            ...state.players,
            [playerId]: {
              ...player,
              hand: {
                ...player.hand,
                actionCards: goesToHand ? [...player.hand.actionCards, newCardEntry] : player.hand.actionCards,
                personalDiscardPile: goesToHand ? player.hand.personalDiscardPile : [...player.hand.personalDiscardPile, newCardEntry]
              }
            }
          }
        };
        nextState = appendLog(nextState, {
          type: "ACTION_CARD_ACQUIRED",
          playerId,
          catalogId: acquiredCatalogId,
          destination: goesToHand ? "hand" : "personalDiscardPile",
          usedDefaultSelection,
          message: `${playerId} acquires ${acquiredCatalogId} from the Open Market, going to their ${goesToHand ? "hand" : "discard pile"}.`
        });
        nextState = { ...nextState, phase: { ...nextState.phase, pendingInterrupt: NULL_INTERRUPT } };
        nextState = advanceActivePlayer(nextState);
        return { state: nextState, error: null, detail: null };
      }
      module.exports = {
        resetActionCardInstanceCounter,
        acquireActionCard
      };
    }
  });

  // gameSetupController.js
  var require_gameSetupController = __commonJS({
    "gameSetupController.js"(exports, module) {
      var { createInitialState } = require_initialGameState();
      var { loadBoardConfig } = require_boardConfigLoader();
      var { resetMeepleCounter, setSharedRng } = require_cardEffectHelpers();
      var { resetActionCardInstanceCounter: resetEndOfRoundActionCardCounter } = require_endOfRoundReducer();
      var { resetActionCardInstanceCounter: resetOpenMarketActionCardCounter } = require_openMarketActionCardReducer();
      var { resetAgentInstanceCounter } = require_agentRecruitmentReducer();
      var { resetSpecialistCardInstanceCounter } = require_specialistCards();
      var { resetMarketAgentInstanceCounter } = require_shiftCards();
      var TURN_ORDER_STRATEGIES = {
        /** Default: lobby seat order IS turn order (seatIndex 0 leads). Deterministic, no RNG. */
        seatOrder: (playerIds) => [...playerIds],
        /**
         * Randomly selects which seated player leads, then preserves clockwise
         * (seat-order) adjacency for everyone else — i.e. rotates the seat-order
         * array to start at the chosen player, rather than a full shuffle. This
         * is the closer digital analogue to "one player is singled out as first,
         * everyone else still goes in existing seat order."
         */
        randomFirstPlayer: (playerIds, rng = Math.random) => {
          const startIndex = Math.floor(rng() * playerIds.length);
          return [...playerIds.slice(startIndex), ...playerIds.slice(0, startIndex)];
        }
      };
      function appendLog(state, entry) {
        const logEntry = {
          seq: state.log.length + 1,
          timestamp: (/* @__PURE__ */ new Date()).toISOString(),
          round: state.phase.round,
          ...entry
        };
        return { ...state, log: [...state.log, logEntry] };
      }
      function deepClone(value) {
        if (typeof structuredClone === "function") {
          return structuredClone(value);
        }
        return JSON.parse(JSON.stringify(value));
      }
      function initializeGame(playerConfigs, options = {}) {
        const {
          specialistCatalogIds,
          // Rulebook setup step 7: the Action Card Open Market row (5 face-up +
          // a face-down draw pile). Optional, unlike specialistCatalogIds —
          // this codebase's own existing comment already flagged
          // openMarketActionCards/decks as "out of scope here... a separate
          // 'dealSetup' module's job" (see below); a game without a real Action
          // Card catalog for this is a real limitation (Acquire won't have
          // anything to acquire) but not a broken game clock the way a missing
          // Specialist deck is, so this does not throw when omitted.
          actionCardCatalogIds,
          // The real, loaded Agent Catalog — agentCatalogLoader.js's
          // loadAgentCatalog().agentCatalog, an { [catalogId]: entry } object
          // (not a list of ids, unlike actionCardCatalogIds — the Open Market
          // setup needs each entry's own isStarter flag, not just its id).
          // Optional, same treatment as actionCardCatalogIds.
          agentCatalog,
          shuffle,
          turnOrderStrategy = "seatOrder",
          rng = Math.random,
          // PHASE 5, STEP 5: pre-loaded card catalog, i.e. the RETURN VALUE of
          // cardCatalogLoader.js's loadCardCatalog() — not a set of CSV paths.
          // Deliberately NOT re-reading/re-parsing CSVs from disk on every single
          // game creation: the catalog is identical for every game (it's not
          // per-game data, unlike specialistCatalogIds' shuffle), so loading it
          // once (server startup, or lazily cached) and passing the already-
          // parsed object in here avoids repeated disk I/O. See cardCatalogLoader.js
          // for the loader itself and this function's own JSDoc below for the
          // exact wiring example.
          cardCatalog
        } = options;
        resetMeepleCounter();
        setSharedRng(rng);
        resetEndOfRoundActionCardCounter();
        resetOpenMarketActionCardCounter();
        resetAgentInstanceCounter();
        resetSpecialistCardInstanceCounter();
        resetMarketAgentInstanceCounter();
        if (!Array.isArray(specialistCatalogIds) || specialistCatalogIds.length !== 13) {
          throw new Error(
            `initializeGame: options.specialistCatalogIds is required and must contain exactly 13 Specialist Card catalogIds (got ${Array.isArray(specialistCatalogIds) ? specialistCatalogIds.length : typeof specialistCatalogIds}). No default catalog exists in this codebase yet \u2014 see specialistCards.js.`
          );
        }
        const strategy = TURN_ORDER_STRATEGIES[turnOrderStrategy];
        if (!strategy) {
          throw new Error(
            `initializeGame: unknown turnOrderStrategy "${turnOrderStrategy}". Valid options: ${Object.keys(TURN_ORDER_STRATEGIES).join(", ")}`
          );
        }
        const RANDOMIZABLE_ARCHETYPES = ["Aggressive", "Growth", "Engine", "Cautious"];
        const resolvedPlayerConfigs = playerConfigs.map((config) => {
          if (config.isBot && config.archetype === "Random") {
            const resolved = RANDOMIZABLE_ARCHETYPES[Math.floor(rng() * RANDOMIZABLE_ARCHETYPES.length)];
            return { ...config, archetype: resolved };
          }
          return config;
        });
        let state = createInitialState(resolvedPlayerConfigs);
        const boardConfig = loadBoardConfig(state.settings.playerCount, {
          specialistCatalogIds,
          actionCardCatalogIds,
          agentCatalog,
          shuffle
        });
        state = {
          ...state,
          board: {
            ...state.board,
            actionSpaces: boardConfig.actionSpaces,
            // FLAGGED_GAP filled: openMarketActionCards / decks.actionCardDrawPile
            // used to remain the permanently-empty containers createInitialState
            // sets by default (per this function's own prior comment: "out of
            // scope here... needs the shuffled Agent/Action Card catalog, a
            // separate 'dealSetup' module's job"). Now populated for real, per
            // rulebook setup step 7 — but only when actionCardCatalogIds was
            // actually supplied; otherwise these stay the same empty containers
            // as before, so a caller that doesn't care about this feature yet
            // (most existing test fixtures) is completely unaffected.
            ...boardConfig.actionCardOpenMarket ? {
              openMarketActionCards: boardConfig.actionCardOpenMarket.openMarketActionCards,
              decks: { ...state.board.decks, actionCardDrawPile: boardConfig.actionCardOpenMarket.actionCardDrawPile }
            } : {},
            // Same treatment for the Agent Open Market — populated only when a
            // real agentCatalog was supplied.
            ...boardConfig.agentOpenMarket ? {
              openMarketAgents: boardConfig.agentOpenMarket.openMarketAgents,
              decks: {
                ...state.board.decks,
                ...boardConfig.actionCardOpenMarket ? { actionCardDrawPile: boardConfig.actionCardOpenMarket.actionCardDrawPile } : {},
                agentDrawPile: boardConfig.agentOpenMarket.agentDrawPile
              }
            } : {}
          },
          marketShareTrack: boardConfig.marketShareTrack,
          specialistDeck: boardConfig.specialistDeck
        };
        state = {
          ...state,
          cardCatalog: cardCatalog || { actionCards: {}, shiftCards: {}, specialistCards: {}, agentCards: agentCatalog || {} }
        };
        const orderedPlayerIds = strategy(state.phase.turnOrder, rng);
        state = {
          ...state,
          phase: {
            ...state.phase,
            turnOrder: orderedPlayerIds,
            playersWithMeeplesRemaining: [...orderedPlayerIds],
            activePlayerId: orderedPlayerIds[0]
          }
        };
        state = appendLog(state, {
          type: "GAME_INITIALIZED",
          playerCount: state.settings.playerCount,
          playerIds: Object.keys(state.players),
          turnOrder: state.phase.turnOrder,
          turnOrderStrategy,
          activePlayerId: state.phase.activePlayerId,
          actionSpaceCount: state.board.actionSpaces.length,
          specialistDeckSize: specialistCatalogIds.length,
          actionCardCatalogSize: Object.keys(state.cardCatalog.actionCards).length,
          shiftCardCatalogSize: Object.keys(state.cardCatalog.shiftCards).length
        });
        state = { ...state, updatedAt: (/* @__PURE__ */ new Date()).toISOString() };
        return deepClone(state);
      }
      module.exports = {
        initializeGame,
        TURN_ORDER_STRATEGIES
      };
    }
  });

  // uiStateBridge.js
  var require_uiStateBridge = __commonJS({
    "uiStateBridge.js"(exports, module) {
      function deepFreeze(value) {
        if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
          Object.getOwnPropertyNames(value).forEach((key) => deepFreeze(value[key]));
          Object.freeze(value);
        }
        return value;
      }
      function getDisplayName(state, playerId) {
        const seat = state.session.seats.find((s) => s.playerId === playerId);
        return seat && seat.displayName || playerId;
      }
      function getActionCardCatalogEntry(state, catalogId) {
        return state.cardCatalog && state.cardCatalog.actionCards && state.cardCatalog.actionCards[catalogId] || null;
      }
      var { VALUE_DIMENSIONS, MIN_MATCHING_VALUES_TO_RECRUIT, computeDeskUsage, hasOpenDesk } = require_agentRecruitmentReducer();
      var ACTION_CARD_CANDIDATE_CHOICE_TYPES = /* @__PURE__ */ new Set(["GRW007_PLAY_OR_FIRE", "GRW053_KEEP_TWO_CHOICE"]);
      var { MILESTONE_BONUS_POINTS } = require_scoringEngine();
      function resolveHandCard(state, entry) {
        const catalogEntry = getActionCardCatalogEntry(state, entry.catalogId);
        return {
          instanceId: entry.instanceId,
          catalogId: entry.catalogId,
          name: catalogEntry ? catalogEntry.name : null,
          cost: catalogEntry ? catalogEntry.cost : null,
          cardImage: catalogEntry ? catalogEntry.cardImage : null,
          // Real rules text from the catalog, exposed for hover tooltips and the
          // "card played" toast — never fabricated, always the exact CSV text.
          description: catalogEntry ? catalogEntry.description : null,
          // Mirrors actionCardReducer.js's verifyPlayRequirement contract shape
          // exactly: null (Instant, no prerequisite) or { type, track?, level }.
          // Real prerequisite data, not fabricated — the same object the real
          // engine-level check reads.
          playRequirement: catalogEntry ? catalogEntry.playRequirement : null,
          resolved: catalogEntry !== null
        };
      }
      function resolveRosterAgent(state, entry) {
        const agentCatalog = state.cardCatalog && state.cardCatalog.agentCards || {};
        const catalogEntry = agentCatalog[entry.catalogId] || null;
        return {
          agentInstanceId: entry.agentInstanceId,
          catalogId: entry.catalogId,
          isVoided: !!entry.isVoided,
          acquiredVia: entry.acquiredVia || null,
          acquiredRound: entry.acquiredRound || null,
          onboardingToken: entry.onboardingToken ? { ...entry.onboardingToken } : { active: false, expiresEndOfRound: null },
          loyaltyToken: { ...entry.loyaltyToken },
          coachTokens: entry.coachTokens || 0,
          name: catalogEntry ? catalogEntry.name : null,
          title: catalogEntry ? catalogEntry.title : null,
          culture: catalogEntry ? catalogEntry.culture : null,
          training: catalogEntry ? catalogEntry.training : null,
          technology: catalogEntry ? catalogEntry.technology : null,
          recognition: catalogEntry ? catalogEntry.recognition : null,
          totalProfit: catalogEntry ? catalogEntry.totalProfit : null,
          image: catalogEntry ? catalogEntry.image : null,
          network: catalogEntry && catalogEntry.network ? {
            role: catalogEntry.network.role,
            color: catalogEntry.network.color,
            influencerCatalogId: catalogEntry.network.influencerCatalogId,
            followerCatalogIds: catalogEntry.network.followerCatalogIds || null
          } : null,
          resolved: catalogEntry !== null
        };
      }
      function resolveOpenMarketAgent(state, entry) {
        const agentCatalog = state.cardCatalog && state.cardCatalog.agentCards || {};
        const catalogEntry = agentCatalog[entry.catalogId] || null;
        return {
          catalogId: entry.catalogId,
          name: catalogEntry ? catalogEntry.name : null,
          title: catalogEntry ? catalogEntry.title : null,
          culture: catalogEntry ? catalogEntry.culture : null,
          training: catalogEntry ? catalogEntry.training : null,
          technology: catalogEntry ? catalogEntry.technology : null,
          recognition: catalogEntry ? catalogEntry.recognition : null,
          totalProfit: catalogEntry ? catalogEntry.totalProfit : null,
          image: catalogEntry ? catalogEntry.image : null,
          network: catalogEntry && catalogEntry.network ? {
            role: catalogEntry.network.role,
            color: catalogEntry.network.color,
            influencerCatalogId: catalogEntry.network.influencerCatalogId,
            followerCatalogIds: catalogEntry.network.followerCatalogIds || null
          } : null,
          resolved: catalogEntry !== null
        };
      }
      function buildPlayerViewModels(state) {
        const playerViewModels = {};
        Object.keys(state.players).forEach((playerId) => {
          const player = state.players[playerId];
          playerViewModels[playerId] = {
            playerId,
            displayName: getDisplayName(state, playerId),
            color: player.color,
            isBot: !!player.isBot,
            archetype: player.archetype || null,
            wallet: { ...player.wallet },
            tracks: {
              training: { ...player.tracks.training },
              technology: { ...player.tracks.technology },
              recognition: { ...player.tracks.recognition },
              offices: { ...player.tracks.offices },
              marketShare: { ...player.tracks.marketShare }
            },
            hand: {
              maxHandSize: player.hand.maxHandSize,
              cards: player.hand.actionCards.map((entry) => resolveHandCard(state, entry)),
              drawPileCount: player.hand.personalDrawPile.length,
              discardPileCount: player.hand.personalDiscardPile.length
            },
            roster: player.roster.map((agent) => resolveRosterAgent(state, agent)),
            milestonesClaimed: [...player.milestonesClaimed || []],
            shiftImmunity: { ...player.shiftImmunity },
            loyaltyTokensUsed: player.loyaltyTokensUsed,
            turnOrderBid: { ...player.turnOrderBid },
            bankedBonusTokens: [...player.bankedBonusTokens || []],
            shellCompanyStash: (player.shellCompanyStash || []).map((s) => ({ ...s })),
            shellCompanyRecruitsUsed: player.shellCompanyRecruitsUsed || 0,
            timeMeeples: {
              availableCount: player.timeMeeples.active.filter((m) => m.status === "in_supply").length,
              activeTotal: player.timeMeeples.active.length,
              staffInTrainingCount: (player.timeMeeples.staffInTraining || []).length,
              maxAllowed: player.timeMeeples.maxAllowed
            },
            loyaltyTokensMax: player.loyaltyTokensMax,
            score: player.score && player.score.finalized ? { ...player.score } : null,
            oncePerRoundAbilitiesUsed: [...player.oncePerRoundAbilitiesUsed || []],
            hasMarketHijack: !!player.hasMarketHijack,
            hasGoldenParachute: !!player.hasGoldenParachute,
            liquidityStaffPT: player.liquidityStaffPT || 0,
            liquidityStaffPTUsableRound: player.liquidityStaffPTUsableRound || null,
            // v=49: expose SPEC_9/SPEC_7's claimed-ability state so the front end
            // can actually render a button for them — these existed in engine
            // state already but were never surfaced here, so there was no way
            // for the UI to know the ability had been claimed at all.
            executiveOverdriveAvailable: !!player.executiveOverdriveAvailable,
            copiedActionSpaceId: player.copiedActionSpaceId || null,
            automationEngineerUsedThisRound: !!player.automationEngineerUsedThisRound
          };
        });
        return playerViewModels;
      }
      function buildBoardViewModel(state) {
        const actionSpaces = (state.board.actionSpaces || []).map((space) => ({
          spaceId: space.spaceId,
          hub: space.hub,
          type: space.type,
          // Official v2.0 18x18 board: some spaces scale capacity with player
          // count via numbered circles (confirmed formula: playerCount - 1)
          // rather than a fixed number — this is the real capacity the UI
          // should show and gate against, not the static fallback field.
          capacity: space.capacityScalesWithPlayerCount ? Math.max(1, (state.settings.playerCount || 2) - 1) : space.capacity,
          cost: space.cost ? { ...space.cost } : null,
          reward: space.reward ? { ...space.reward } : null,
          occupiedBy: (space.occupiedBy || []).map((entry) => ({ ...entry })),
          status: space.status,
          statusToken: space.statusToken ? { ...space.statusToken } : null
          // No x/y here — see file header. The frontend maps spaceId -> screen
          // position using its own static layout table.
        }));
        return {
          actionSpaces,
          openMarketAgents: (state.board.openMarketAgents || []).map((entry) => resolveOpenMarketAgent(state, entry)),
          openMarketActionCards: (state.board.openMarketActionCards || []).map(
            (entry) => resolveHandCard(state, { instanceId: `market-${entry.catalogId}`, catalogId: entry.catalogId })
          )
        };
      }
      function buildSpecialistViewModel(state) {
        const deck = state.specialistDeck;
        if (!deck) return null;
        return {
          activeCard: deck.activeCard ? { ...deck.activeCard } : null,
          cardsRemainingInDrawPile: deck.drawPile ? deck.drawPile.length : 0
        };
      }
      function buildShiftTrackerViewModel(state) {
        const tracker = state.shiftTracker;
        return {
          position: tracker.position,
          max: tracker.max,
          // A UI progress bar's fill ratio — pure display arithmetic on values
          // that already exist, not a new game-state computation.
          percentToTrigger: tracker.max > 0 ? Math.round(tracker.position / tracker.max * 100) : 0
        };
      }
      function buildInterruptViewModel(state) {
        const interrupt = state.phase.pendingInterrupt;
        if (!interrupt || interrupt.type === "NULL") {
          return null;
        }
        const respondingPlayer = state.players[interrupt.sourcePlayerId];
        const data = interrupt.data || {};
        const resolvedCandidates = respondingPlayer && Array.isArray(data.candidateInstanceIds) ? data.candidateInstanceIds.map((instanceId) => {
          const fromHand = respondingPlayer.hand.actionCards.find((c) => c.instanceId === instanceId);
          const fromDiscard = respondingPlayer.hand.personalDiscardPile.find((c) => c.instanceId === instanceId);
          const entry = fromHand || fromDiscard;
          return entry ? resolveHandCard(state, entry) : { instanceId, catalogId: null, name: null, cost: null, cardImage: null, resolved: false };
        }) : [];
        let resolvedAgentCandidates = Array.isArray(data.candidateCatalogIds) ? data.candidateCatalogIds.map((catalogId) => resolveOpenMarketAgent(state, { catalogId })) : [];
        let deskStatus = null;
        if (data.spaceId === "GRW_RECRUIT_AGENT" && respondingPlayer) {
          const deskUsed = computeDeskUsage(state, interrupt.sourcePlayerId);
          deskStatus = {
            deskUsed,
            deskCapacity: respondingPlayer.tracks.offices.unlocked,
            hasOpenDesk: hasOpenDesk(state, interrupt.sourcePlayerId)
          };
        }
        if (data.spaceId === "GRW_RECRUIT_AGENT" && respondingPlayer) {
          resolvedAgentCandidates = (state.board.openMarketAgents || []).map((entry) => {
            const resolved = resolveOpenMarketAgent(state, entry);
            if (!resolved.resolved) return resolved;
            const eligibility = VALUE_DIMENSIONS.map((dim) => ({
              dimension: dim,
              playerValue: respondingPlayer.tracks[dim].value,
              agentValue: resolved[dim],
              met: respondingPlayer.tracks[dim].value >= resolved[dim]
            }));
            const matchedCount = eligibility.filter((e) => e.met).length;
            return {
              ...resolved,
              eligibility,
              eligibleToRecruit: matchedCount >= MIN_MATCHING_VALUES_TO_RECRUIT
            };
          });
        }
        return {
          type: interrupt.type,
          sourcePlayerId: interrupt.sourcePlayerId,
          sourcePlayerDisplayName: getDisplayName(state, interrupt.sourcePlayerId),
          choiceType: data.choiceType || null,
          catalogId: data.catalogId || null,
          spaceType: data.spaceType || null,
          spaceId: data.spaceId || null,
          stage: data.stage || null,
          openMarketActionCardRow: data.spaceId === "EXEC_CLEAR_OPEN_MARKET" && data.stage === "pick_free_card" ? (state.board.openMarketActionCards || []).map((c) => ({ catalogId: c.catalogId })) : [],
          trackName: data.trackName || null,
          level: typeof data.level === "number" ? data.level : null,
          milestoneKey: data.milestoneKey || null,
          maxSelect: typeof data.maxSelect === "number" ? data.maxSelect : null,
          minSelect: typeof data.minSelect === "number" ? data.minSelect : 0,
          requiredCount: typeof data.requiredCount === "number" ? data.requiredCount : null,
          candidateMeepleInstanceIds: Array.isArray(data.candidateMeepleInstanceIds) ? [...data.candidateMeepleInstanceIds] : [],
          // GRW_007's own raw Action Card catalogIds (distinct from
          // resolvedAgentCandidates above, which reinterprets this SAME
          // data.candidateCatalogIds field as Agent catalogIds for CRM
          // Update's unrelated feature) — only meaningful when choiceType is
          // GRW007_PLAY_OR_FIRE, gated the same way to avoid any ambiguity.
          actionCardCandidateCatalogIds: ACTION_CARD_CANDIDATE_CHOICE_TYPES.has(data.choiceType) && Array.isArray(data.candidateCatalogIds) ? [...data.candidateCatalogIds] : [],
          cardInstanceId: data.cardInstanceId || null,
          drawnCardCatalogId: data.drawnCardCatalogId || null,
          consequencesLogEntries: Array.isArray(data.consequencesLogEntries) ? [...data.consequencesLogEntries] : [],
          isSpecialistCardChoice: !!data.isSpecialistCardChoice,
          availableHubs: Array.isArray(data.availableHubs) ? [...data.availableHubs] : [],
          // v=53: SPEC_4 (The Inside Source) — the 5 agent catalogIds drawn and
          // awaiting the player's up-to-2 selection. Same explicit-field
          // pattern as availableHubs immediately above; buildInterruptViewModel
          // only forwards fields it names here, so this needed adding rather
          // than assuming a generic passthrough existed.
          drawnCatalogIds: Array.isArray(data.drawnCatalogIds) ? [...data.drawnCatalogIds] : [],
          candidates: resolvedCandidates,
          agentCandidates: resolvedAgentCandidates,
          deskStatus
        };
      }
      var GLOBAL_MILESTONE_DEFINITIONS = [
        { key: "OFFICE_MOGUL", name: "Office Mogul", criteria: "First to own 6 Offices" },
        { key: "MARKET_LEADER", name: "The Market Leader", criteria: "First to reach 17 Points on Market Share Track" },
        { key: "MAXED_OUT_VALUE", name: "Maxed-Out Value", criteria: "First to reach 10 on any one Value Track" },
        { key: "THE_MENTOR", name: "The Mentor", criteria: "First to have 4 Coach Tokens" },
        { key: "SUPERSTAR_RECRUITER", name: "Superstar Recruiter", criteria: "First to have 8 Agents" }
      ];
      function buildGlobalMilestonesViewModel(state) {
        return GLOBAL_MILESTONE_DEFINITIONS.map((def) => {
          const ownerId = Object.keys(state.players).find((pid) => state.players[pid].milestonesClaimed.includes(def.key)) || null;
          return {
            key: def.key,
            name: def.name,
            criteria: def.criteria,
            bonusPoints: MILESTONE_BONUS_POINTS[def.key] || 0,
            ownerId,
            ownerDisplayName: ownerId ? getDisplayName(state, ownerId) : null,
            ownerColor: ownerId ? state.players[ownerId].color : null
          };
        });
      }
      function buildMarketShareTrackViewModel(state) {
        if (!state.marketShareTrack) {
          return { spaces: [], bonusStacks: {} };
        }
        const bonusStacks = {};
        Object.keys(state.marketShareTrack.bonusStacks).forEach((position) => {
          const stack = state.marketShareTrack.bonusStacks[position];
          bonusStacks[position] = {
            top: stack.top,
            bottom: stack.bottom,
            topClaimedBy: stack.claimedBy[0] || null,
            bottomClaimedBy: stack.claimedBy[1] || null,
            depleted: stack.claimedBy.length >= 2
          };
        });
        return { spaces: [...state.marketShareTrack.spaces], bonusStacks };
      }
      function buildLogViewModel(state) {
        return state.log.map((entry) => ({
          seq: entry.seq,
          round: entry.round,
          type: entry.type,
          displayText: entry.message || `${entry.type}${entry.playerId ? ` (${entry.playerId})` : ""}`
        }));
      }
      function getUiViewModel(state) {
        const viewModel = {
          meta: {
            round: state.phase.round,
            maxRounds: state.phase.maxRounds,
            phase: state.phase.current,
            activePlayerId: state.phase.activePlayerId,
            playerCount: state.settings.playerCount,
            turnOrder: [...state.phase.turnOrder]
          },
          players: buildPlayerViewModels(state),
          board: buildBoardViewModel(state),
          specialist: buildSpecialistViewModel(state),
          shiftTracker: buildShiftTrackerViewModel(state),
          marketShareTrack: buildMarketShareTrackViewModel(state),
          pendingInterrupt: buildInterruptViewModel(state),
          log: buildLogViewModel(state),
          globalMilestones: buildGlobalMilestonesViewModel(state),
          leaderboard: state.phase.current === "FINAL_SCORING" && Array.isArray(state.finalLeaderboard) ? state.finalLeaderboard.map((entry) => ({ ...entry, breakdowns: { ...entry.breakdowns } })) : null
        };
        return deepFreeze(viewModel);
      }
      function buildPlaceMeepleActionPayload(meepleInstanceId, spaceId, additionalMeepleInstanceIds, useOvertimeManager) {
        if (typeof meepleInstanceId !== "string" || meepleInstanceId.length === 0) {
          return { ok: false, error: "INVALID_MEEPLE_INSTANCE_ID" };
        }
        if (typeof spaceId !== "string" || spaceId.length === 0) {
          return { ok: false, error: "INVALID_SPACE_ID" };
        }
        if (additionalMeepleInstanceIds !== void 0 && !Array.isArray(additionalMeepleInstanceIds)) {
          return { ok: false, error: "ADDITIONAL_MEEPLES_MUST_BE_ARRAY" };
        }
        return {
          ok: true,
          action: {
            type: "PLACE_MEEPLE",
            payload: {
              meepleInstanceId,
              spaceId,
              ...additionalMeepleInstanceIds ? { additionalMeepleInstanceIds } : {},
              ...useOvertimeManager ? { useOvertimeManager: true } : {}
            }
          }
        };
      }
      function buildPlayActionCardPayload(playerId, cardInstanceId) {
        if (typeof playerId !== "string" || playerId.length === 0) {
          return { ok: false, error: "INVALID_PLAYER_ID" };
        }
        if (cardInstanceId !== null && (typeof cardInstanceId !== "string" || cardInstanceId.length === 0)) {
          return { ok: false, error: "INVALID_CARD_INSTANCE_ID" };
        }
        return { ok: true, playerId, cardInstanceId };
      }
      function buildInterruptResponsePayload(interruptViewModel, rawSelection) {
        if (!interruptViewModel) {
          return { ok: false, error: "NO_ACTIVE_INTERRUPT" };
        }
        if (interruptViewModel.choiceType === "SELECT_TRASH_CARDS") {
          if (!Array.isArray(rawSelection)) {
            return { ok: false, error: "SELECTION_MUST_BE_ARRAY" };
          }
          if (rawSelection.length > (interruptViewModel.maxSelect || 0)) {
            return { ok: false, error: "SELECTION_EXCEEDS_MAX", detail: { maxSelect: interruptViewModel.maxSelect } };
          }
          const validIds = new Set(interruptViewModel.candidates.map((c) => c.instanceId));
          if (!rawSelection.every((id) => validIds.has(id))) {
            return { ok: false, error: "SELECTION_CONTAINS_UNKNOWN_ID" };
          }
          return {
            ok: true,
            respondingPlayerId: interruptViewModel.sourcePlayerId,
            payload: { selectedInstanceIds: rawSelection }
          };
        }
        return { ok: false, error: "UNSUPPORTED_CHOICE_TYPE", detail: { choiceType: interruptViewModel.choiceType } };
      }
      function buildAcquireActionCardPayload(playerId, marketCatalogId) {
        if (typeof playerId !== "string" || playerId.length === 0) {
          return { ok: false, error: "INVALID_PLAYER_ID" };
        }
        if (marketCatalogId !== void 0 && marketCatalogId !== null && (typeof marketCatalogId !== "string" || marketCatalogId.length === 0)) {
          return { ok: false, error: "INVALID_MARKET_CATALOG_ID" };
        }
        return { ok: true, playerId, marketCatalogId: marketCatalogId === void 0 ? null : marketCatalogId };
      }
      function buildRecruitAgentPayload(playerId, agentCatalogId) {
        if (typeof playerId !== "string" || playerId.length === 0) {
          return { ok: false, error: "INVALID_PLAYER_ID" };
        }
        if (typeof agentCatalogId !== "string" || agentCatalogId.length === 0) {
          return { ok: false, error: "INVALID_AGENT_CATALOG_ID" };
        }
        return { ok: true, playerId, agentCatalogId };
      }
      function buildPoachAgentPayload(playerId, targetPlayerId, targetAgentInstanceId) {
        if (typeof playerId !== "string" || playerId.length === 0) {
          return { ok: false, error: "INVALID_PLAYER_ID" };
        }
        if (typeof targetPlayerId !== "string" || targetPlayerId.length === 0) {
          return { ok: false, error: "INVALID_TARGET_PLAYER_ID" };
        }
        if (typeof targetAgentInstanceId !== "string" || targetAgentInstanceId.length === 0) {
          return { ok: false, error: "INVALID_TARGET_AGENT_INSTANCE_ID" };
        }
        return { ok: true, playerId, targetPlayerId, targetAgentInstanceId };
      }
      function buildPlaceLoyaltyTokenPayload(playerId, agentInstanceId, fromAgentInstanceId) {
        if (typeof playerId !== "string" || playerId.length === 0) {
          return { ok: false, error: "INVALID_PLAYER_ID" };
        }
        if (typeof agentInstanceId !== "string" || agentInstanceId.length === 0) {
          return { ok: false, error: "INVALID_AGENT_INSTANCE_ID" };
        }
        if (fromAgentInstanceId !== void 0 && fromAgentInstanceId !== null && (typeof fromAgentInstanceId !== "string" || fromAgentInstanceId.length === 0)) {
          return { ok: false, error: "INVALID_FROM_AGENT_INSTANCE_ID" };
        }
        return { ok: true, playerId, agentInstanceId, fromAgentInstanceId: fromAgentInstanceId || null };
      }
      function buildCrmUpdateChoicePayload(playerId, chosenCatalogId) {
        if (typeof playerId !== "string" || playerId.length === 0) {
          return { ok: false, error: "INVALID_PLAYER_ID" };
        }
        if (typeof chosenCatalogId !== "string" || chosenCatalogId.length === 0) {
          return { ok: false, error: "INVALID_CATALOG_ID" };
        }
        return { ok: true, playerId, chosenCatalogId };
      }
      module.exports = {
        getUiViewModel,
        buildPlaceMeepleActionPayload,
        buildPlayActionCardPayload,
        buildAcquireActionCardPayload,
        buildRecruitAgentPayload,
        buildPoachAgentPayload,
        buildPlaceLoyaltyTokenPayload,
        buildCrmUpdateChoicePayload,
        buildInterruptResponsePayload,
        // Exported for tests only.
        __testables: { deepFreeze, resolveHandCard }
      };
    }
  });

  // gameBoardRenderer.js
  var require_gameBoardRenderer = __commonJS({
    "gameBoardRenderer.js"(exports, module) {
      var KNOWN_HUBS = ["EXECUTIVE_SEARCH", "EXECUTIVE_DECISIONS", "OPERATIONS", "GROWTH", "LEADERSHIP"];
      var UNRECOGNIZED_HUB_BUCKET = "UNRECOGNIZED_HUB";
      function buildMeepleSlots(space, playersById) {
        return space.occupiedBy.map((occupant) => {
          const player = playersById[occupant.playerId];
          return {
            meepleInstanceId: occupant.meepleInstanceId,
            playerId: occupant.playerId,
            order: occupant.order,
            color: player ? player.color : null,
            displayName: player ? player.displayName : null,
            resolved: player !== void 0 && player !== null
          };
        });
      }
      function buildStatusTokenSlot(space) {
        if (!space.statusToken) {
          return null;
        }
        return { ...space.statusToken };
      }
      function buildSpaceLayoutBlock(space, playersById) {
        return {
          spaceId: space.spaceId,
          hub: space.hub,
          type: space.type,
          capacity: space.capacity,
          cost: space.cost,
          reward: space.reward,
          status: space.status,
          occupancyCount: space.occupiedBy.length,
          isFull: space.capacity !== null && space.occupiedBy.length >= space.capacity,
          meepleSlots: buildMeepleSlots(space, playersById),
          statusTokenSlot: buildStatusTokenSlot(space)
        };
      }
      function groupSpacesByHub(actionSpaces, playersById) {
        const grouped = {};
        KNOWN_HUBS.forEach((hub) => {
          grouped[hub] = [];
        });
        actionSpaces.forEach((space) => {
          const bucket = KNOWN_HUBS.includes(space.hub) ? space.hub : UNRECOGNIZED_HUB_BUCKET;
          if (!grouped[bucket]) {
            grouped[bucket] = [];
          }
          grouped[bucket].push(buildSpaceLayoutBlock(space, playersById));
        });
        return grouped;
      }
      function buildSpecialistHubPanel(vm) {
        if (!vm.specialist) {
          return null;
        }
        return {
          activeCard: vm.specialist.activeCard,
          cardsRemainingInDrawPile: vm.specialist.cardsRemainingInDrawPile
        };
      }
      function buildAgentBadges(agent) {
        const networkBadge = agent.network && agent.network.role !== "independent" ? agent.network.role : null;
        return {
          networkBadge,
          networkColor: agent.network ? agent.network.color : null,
          hasOnboardingToken: !!(agent.onboardingToken && agent.onboardingToken.active),
          hasLoyaltyToken: !!(agent.loyaltyToken && agent.loyaltyToken.active)
        };
      }
      function buildPlayerOfficePanels(vm) {
        const panels = {};
        Object.keys(vm.players).forEach((playerId) => {
          const player = vm.players[playerId];
          panels[playerId] = {
            playerId,
            displayName: player.displayName,
            color: player.color,
            officeCapacity: { ...player.tracks.offices },
            roster: player.roster.map((agent) => ({ ...agent, badges: buildAgentBadges(agent) })),
            rosterFillRatio: player.tracks.offices.unlocked > 0 ? Math.round(player.roster.length / player.tracks.offices.unlocked * 100) : null
          };
        });
        return panels;
      }
      function buildOpenMarketPanel(vm) {
        return vm.board.openMarketAgents.map((agent) => ({ ...agent, badges: buildAgentBadges(agent) }));
      }
      function renderGameBoard(vm) {
        return {
          hubs: groupSpacesByHub(vm.board.actionSpaces, vm.players),
          specialistHubPanel: buildSpecialistHubPanel(vm),
          playerOfficePanels: buildPlayerOfficePanels(vm),
          openMarketPanel: buildOpenMarketPanel(vm)
        };
      }
      module.exports = {
        renderGameBoard,
        KNOWN_HUBS,
        UNRECOGNIZED_HUB_BUCKET,
        // Exported for tests only.
        __testables: {
          groupSpacesByHub,
          buildSpaceLayoutBlock,
          buildMeepleSlots,
          buildStatusTokenSlot
        }
      };
    }
  });

  // playerDashboardRenderer.js
  var require_playerDashboardRenderer = __commonJS({
    "playerDashboardRenderer.js"(exports, module) {
      var TRACK_METER_CONFIG = [
        { key: "training", label: "Training" },
        { key: "technology", label: "Technology" },
        { key: "recognition", label: "Recognition" },
        { key: "offices", label: "Offices", valueField: "unlocked" },
        { key: "marketShare", label: "Market Share", valueField: "position", noMax: true }
      ];
      function buildWalletHud(player) {
        return {
          profitTokens: player.wallet.profitTokens,
          priorityTokens: player.wallet.priorityTokens
        };
      }
      function buildTrackMeters(player) {
        return TRACK_METER_CONFIG.map((config) => {
          const track = player.tracks[config.key];
          const valueField = config.valueField || "value";
          const value = track[valueField];
          const max = config.noMax ? null : track.max;
          return {
            key: config.key,
            label: config.label,
            value,
            max,
            fillRatio: max !== null && max > 0 ? Math.round(value / max * 100) : null,
            // BATCH 8 (Section 6): only the 3 leveled tracks have a branch fork —
            // offices/marketShare simply don't carry this field at all.
            branch: typeof track.branch !== "undefined" ? track.branch : null,
            claimedMilestones: Array.isArray(track.claimedMilestones) ? [...track.claimedMilestones] : []
          };
        });
      }
      function buildHandCardFrames(player) {
        return player.hand.cards.map((card) => {
          if (card.resolved) {
            return {
              instanceId: card.instanceId,
              catalogId: card.catalogId,
              isPlaceholder: false,
              name: card.name,
              cost: card.cost,
              cardImage: card.cardImage,
              description: card.description,
              playRequirement: card.playRequirement
            };
          }
          return {
            instanceId: card.instanceId,
            catalogId: card.catalogId,
            isPlaceholder: true,
            name: null,
            cost: null,
            cardImage: null,
            description: null,
            playRequirement: null
          };
        });
      }
      function buildHandSummary(player) {
        return {
          count: player.hand.cards.length,
          maxHandSize: player.hand.maxHandSize,
          drawPileCount: player.hand.drawPileCount,
          discardPileCount: player.hand.discardPileCount
        };
      }
      function buildRosterMonitor(player) {
        return {
          // FIX: this previously counted every roster entry including
          // ones marked isVoided:true (fired via office-capacity
          // overflow, kept in the array rather than removed) — the
          // "Roster: X/Y" display shown throughout the game was
          // inflated whenever a player had any fired agents, and a
          // rosterSize play requirement could look satisfied here even
          // when the engine's own real enforcement (verifyPlayRequirement)
          // correctly rejected it, a confusing mismatch. Matches the
          // same !r.isVoided convention used everywhere else this field
          // is checked.
          count: player.roster.filter((r) => !r.isVoided).length,
          capacity: player.tracks.offices.unlocked,
          agents: player.roster.map((agent) => ({
            agentInstanceId: agent.agentInstanceId,
            catalogId: agent.catalogId,
            isPlaceholder: !agent.resolved,
            name: agent.resolved ? agent.name : null,
            title: agent.resolved ? agent.title : null,
            culture: agent.resolved ? agent.culture : null,
            training: agent.resolved ? agent.training : null,
            technology: agent.resolved ? agent.technology : null,
            recognition: agent.resolved ? agent.recognition : null,
            totalProfit: agent.resolved ? agent.totalProfit : null,
            image: agent.resolved ? agent.image : null,
            isVoided: agent.isVoided,
            acquiredVia: agent.acquiredVia,
            acquiredRound: agent.acquiredRound,
            coachTokens: agent.coachTokens || 0,
            hasOnboardingToken: !!(agent.onboardingToken && agent.onboardingToken.active),
            hasLoyaltyToken: !!(agent.loyaltyToken && agent.loyaltyToken.active),
            network: agent.resolved && agent.network ? {
              role: agent.network.role,
              color: agent.network.color,
              influencerCatalogId: agent.network.influencerCatalogId,
              followerCatalogIds: agent.network.followerCatalogIds
            } : null
          }))
        };
      }
      function renderPlayerDashboard(vm, playerId) {
        const player = vm.players[playerId];
        if (!player) {
          return null;
        }
        return {
          playerId: player.playerId,
          displayName: player.displayName,
          color: player.color,
          isBot: player.isBot,
          archetype: player.archetype,
          wallet: buildWalletHud(player),
          trackMeters: buildTrackMeters(player),
          timeMeeples: { ...player.timeMeeples },
          marketShare: { position: player.tracks.marketShare.position },
          hand: {
            summary: buildHandSummary(player),
            cards: buildHandCardFrames(player)
          },
          roster: buildRosterMonitor(player),
          bankedBonusTokens: [...player.bankedBonusTokens || []],
          shellCompanyStash: (player.shellCompanyStash || []).map((s) => ({ ...s })),
          shellCompanyRecruitsUsed: player.shellCompanyRecruitsUsed || 0,
          score: player.score ? { ...player.score } : null,
          oncePerRoundAbilitiesUsed: [...player.oncePerRoundAbilitiesUsed || []],
          hasMarketHijack: !!player.hasMarketHijack,
          hasGoldenParachute: !!player.hasGoldenParachute,
          liquidityStaffPT: player.liquidityStaffPT || 0,
          liquidityStaffPTUsableRound: player.liquidityStaffPTUsableRound || null
        };
      }
      module.exports = {
        renderPlayerDashboard,
        TRACK_METER_CONFIG,
        // Exported for tests only.
        __testables: {
          buildWalletHud,
          buildTrackMeters,
          buildHandCardFrames,
          buildHandSummary,
          buildRosterMonitor
        }
      };
    }
  });

  // interruptOverlayRenderer.js
  var require_interruptOverlayRenderer = __commonJS({
    "interruptOverlayRenderer.js"(exports, module) {
      var PROMPT_TEXT_BY_CHOICE_TYPE = {
        SELECT_TRASH_CARDS: (interrupt) => `Select up to ${interrupt.maxSelect} card${interrupt.maxSelect === 1 ? "" : "s"} to trash.`
      };
      function subjectVerbAgreement(displayName) {
        return displayName === "You" ? "have" : "has";
      }
      function possessiveLabel(displayName) {
        return displayName === "You" ? "Your" : `${displayName}'s`;
      }
      function buildHeaderText(sourcePlayerDisplayName) {
        return `${possessiveLabel(sourcePlayerDisplayName)} Choice`;
      }
      function buildPromptText(interrupt) {
        const builder = PROMPT_TEXT_BY_CHOICE_TYPE[interrupt.choiceType];
        if (builder) {
          return builder(interrupt);
        }
        return `${interrupt.sourcePlayerDisplayName} ${subjectVerbAgreement(interrupt.sourcePlayerDisplayName)} a pending choice to make.`;
      }
      var DEFERRED_SPACE_PROMPT_TEXT_BY_SPACE_TYPE = {
        acquire_or_play_action_card: () => "Select a card from your hand to play."
      };
      var DEFERRED_SPACE_PROMPT_TEXT_BY_SPACE_ID = {
        GRW_RECRUIT_AGENT: () => "Choose an Agent from the Open Market to recruit.",
        GRW_POACH_AGENT: () => "Choose a rival's Agent to poach.",
        GRW_LOYALTY_TOKEN: () => "Choose an Agent from your roster for a Loyalty Token."
      };
      function buildDeferredSpacePromptText(interrupt) {
        const byId = DEFERRED_SPACE_PROMPT_TEXT_BY_SPACE_ID[interrupt.spaceId];
        if (byId) {
          return byId(interrupt);
        }
        const builder = DEFERRED_SPACE_PROMPT_TEXT_BY_SPACE_TYPE[interrupt.spaceType];
        if (builder) {
          return builder(interrupt);
        }
        return `${interrupt.sourcePlayerDisplayName} ${subjectVerbAgreement(interrupt.sourcePlayerDisplayName)} a pending action to take.`;
      }
      function buildCandidateNode(candidate) {
        if (candidate.resolved) {
          return {
            instanceId: candidate.instanceId,
            catalogId: candidate.catalogId,
            isPlaceholder: false,
            name: candidate.name,
            cost: candidate.cost,
            cardImage: candidate.cardImage,
            description: candidate.description,
            playRequirement: candidate.playRequirement
          };
        }
        return {
          instanceId: candidate.instanceId,
          catalogId: candidate.catalogId,
          isPlaceholder: true,
          name: null,
          cost: null,
          cardImage: null,
          description: null,
          playRequirement: null
        };
      }
      var CONFIRMABLE_CHOICE_TYPES = /* @__PURE__ */ new Set(["SELECT_TRASH_CARDS"]);
      function buildInterruptOverlayModal(vm) {
        const interrupt = vm.pendingInterrupt;
        if (!interrupt) {
          return { active: false };
        }
        const headerText = buildHeaderText(interrupt.sourcePlayerDisplayName);
        if (interrupt.type === "ACTION_SPACE_DEFERRED_CHOICE" && interrupt.spaceType === "acquire_or_play_action_card") {
          return {
            active: true,
            mode: "HAND_SELECTION_HINT",
            sourcePlayerId: interrupt.sourcePlayerId,
            sourcePlayerDisplayName: interrupt.sourcePlayerDisplayName,
            headerText,
            promptText: buildDeferredSpacePromptText(interrupt),
            choiceType: interrupt.choiceType,
            candidates: []
          };
        }
        if (interrupt.type === "ACTION_SPACE_DEFERRED_CHOICE" && interrupt.spaceType === "draft_open_market_agent") {
          return {
            active: true,
            mode: "AGENT_ACTION_HINT",
            spaceId: interrupt.spaceId,
            sourcePlayerId: interrupt.sourcePlayerId,
            sourcePlayerDisplayName: interrupt.sourcePlayerDisplayName,
            headerText,
            promptText: buildDeferredSpacePromptText(interrupt),
            choiceType: interrupt.choiceType,
            candidates: [],
            deskStatus: interrupt.deskStatus || null
          };
        }
        if (interrupt.type === "ACTION_SPACE_DEFERRED_CHOICE" && interrupt.spaceType === "dual_value_boost") {
          return {
            active: true,
            mode: "DUAL_TRACK_CHOICE_HINT",
            sourcePlayerId: interrupt.sourcePlayerId,
            sourcePlayerDisplayName: interrupt.sourcePlayerDisplayName,
            headerText,
            promptText: "Allocate 2 points across Training / Technology / Recognition \u2014 both on one track, or split across two."
          };
        }
        if (interrupt.type === "ACTION_SPACE_DEFERRED_CHOICE" && interrupt.spaceType === "hire_coach") {
          return {
            active: true,
            mode: "HIRE_COACH_HINT",
            sourcePlayerId: interrupt.sourcePlayerId,
            sourcePlayerDisplayName: interrupt.sourcePlayerDisplayName,
            headerText,
            promptText: "Hire a Coach: choose an Agent in your brokerage to receive the Coach Token (+3 Profit, permanent)."
          };
        }
        if (interrupt.type === "ACTION_SPACE_DEFERRED_CHOICE" && interrupt.spaceId === "EXEC_CLEAR_OPEN_MARKET" && !interrupt.stage) {
          return {
            active: true,
            mode: "CLEAR_OPEN_MARKET_HINT",
            sourcePlayerId: interrupt.sourcePlayerId,
            sourcePlayerDisplayName: interrupt.sourcePlayerDisplayName,
            headerText,
            promptText: "Clear Open Market Cards: choose one option."
          };
        }
        if (interrupt.type === "ACTION_SPACE_DEFERRED_CHOICE" && interrupt.spaceId === "EXEC_CLEAR_OPEN_MARKET" && interrupt.stage === "pick_free_card") {
          return {
            active: true,
            mode: "CLEAR_OPEN_MARKET_PICK_CARD_HINT",
            sourcePlayerId: interrupt.sourcePlayerId,
            sourcePlayerDisplayName: interrupt.sourcePlayerDisplayName,
            headerText,
            promptText: "Choose 1 free Action Card from the freshly-refreshed Open Market row.",
            openMarketActionCardRow: interrupt.openMarketActionCardRow || []
          };
        }
        if (interrupt.type === "TRACK_BRANCH_CHOICE") {
          return {
            active: true,
            mode: "TRACK_BRANCH_CHOICE_HINT",
            sourcePlayerId: interrupt.sourcePlayerId,
            sourcePlayerDisplayName: interrupt.sourcePlayerDisplayName,
            headerText,
            promptText: `Level 5 Specialization Fork: choose a permanent branch for ${interrupt.trackName}. This choice cannot be changed for the rest of the game.`,
            trackName: interrupt.trackName
          };
        }
        if (interrupt.type === "DEFICIT_TRACK_CHOICE") {
          return {
            active: true,
            mode: "DEFICIT_TRACK_CHOICE_HINT",
            sourcePlayerId: interrupt.sourcePlayerId,
            sourcePlayerDisplayName: interrupt.sourcePlayerDisplayName,
            headerText,
            promptText: "Insufficient Profit Tokens to cover the full penalty \u2014 choose one non-zero track to drop by 1 space (flat penalty, regardless of how much you were short)."
          };
        }
        if (interrupt.type === "TRACK_MILESTONE_CHOICE") {
          return {
            active: true,
            mode: "TRACK_MILESTONE_CHOICE_HINT",
            sourcePlayerId: interrupt.sourcePlayerId,
            sourcePlayerDisplayName: interrupt.sourcePlayerDisplayName,
            headerText,
            promptText: `A Level ${interrupt.level} Milestone has triggered \u2014 resolve it now, or it is permanently forfeited.`,
            trackName: interrupt.trackName,
            level: interrupt.level,
            milestoneKey: interrupt.milestoneKey
          };
        }
        if (interrupt.type === "ACTION_CARD_EFFECT_CHOICE" && interrupt.choiceType === "CRM_UPDATE_RECRUIT") {
          return {
            active: true,
            mode: "CRM_UPDATE_HINT",
            sourcePlayerId: interrupt.sourcePlayerId,
            sourcePlayerDisplayName: interrupt.sourcePlayerDisplayName,
            headerText,
            promptText: "CRM Update: choose 1 of these 3 Agents to recruit \u2014 the other 2 return to the top of the deck.",
            agentCandidates: interrupt.agentCandidates || []
          };
        }
        const START_CARD_CHOICE_TYPES = /* @__PURE__ */ new Set([
          "S1_DISCARD_FOR_TRACKS",
          "S2_TRIPLE_TRACK_BOOST",
          "S3_DOUBLE_TRACK_BOOST",
          "S5_HIRE_COACH_TARGET",
          "S6_RECALL_MEEPLES",
          "GRW004_RECRUIT_TARGET",
          "GRW010_RECRUIT_TARGET",
          "GRW013_COACH_TARGET",
          "GRW015_COACH_TARGET",
          "GRW007_PLAY_OR_FIRE",
          "GRW022_LOYALTY_TARGET",
          "GRW031_COACH_TARGET",
          "GRW037_SINGLE_TRACK_CHOICE",
          "GRW039_RECRUIT_OR_FIRE",
          "GRW041_COACH_TARGET",
          "GRW044_LOYALTY_AND_COACH_TARGET",
          "GRW048_LOYALTY_TARGET",
          "GRW050_LOYALTY_TARGET",
          "GRW051_MARKET_TARGET",
          "GRW051_RIVAL_TARGET",
          "GRW052_RIVAL_TARGET",
          "GRW053_KEEP_TWO_CHOICE",
          "GRW054_LOYALTY_TARGET",
          "GRW055_DOUBLE_COACH_TARGET",
          "GRW056_RECRUIT_TARGET_1",
          "GRW056_RECRUIT_TARGET_2",
          "GRW057_COACH_TARGET",
          "GRW059_RECRUIT_TARGET",
          "GRW061_COACH_TARGET",
          "STR070_PROTECT_TARGET",
          "STR072_PROTECT_TARGET",
          "STR074_RIVAL_TARGET",
          "STR078_SPACE_TRACK_CHOICE",
          "STR079_PROTECT_TARGET",
          "STR080_RIVAL_TARGET"
        ]);
        if (interrupt.type === "ACTION_CARD_EFFECT_CHOICE" && START_CARD_CHOICE_TYPES.has(interrupt.choiceType)) {
          const PROMPT_TEXT_BY_CHOICE_TYPE2 = {
            S1_DISCARD_FOR_TRACKS: "New Year Strategic Planning: discard up to 2 cards from your hand \u2014 raise 1 Operation Hub value for each card discarded.",
            S2_TRIPLE_TRACK_BOOST: "Talent Management: choose 3 Operation Hub values to raise (any combination).",
            S3_DOUBLE_TRACK_BOOST: "Brokerage Expansion: choose 2 Operation Hub values to raise (any combination). The +2 PT was already granted.",
            S5_HIRE_COACH_TARGET: "Networking: choose an Agent in your brokerage to receive a Coach Token.",
            S6_RECALL_MEEPLES: "The 25th Hour: choose up to 3 of your other Meeples on the board to recall to your supply.",
            GRW004_RECRUIT_TARGET: "Coffee Run: choose an Open Market Agent with Recognition below 5 \u2014 all other requirements waived.",
            GRW010_RECRUIT_TARGET: "Online Listing: choose an Open Market Agent to recruit \u2014 your Broker Values count as +1 for this check.",
            GRW013_COACH_TARGET: "Website Refresh: choose an Agent in your brokerage to receive a Coach Token.",
            GRW015_COACH_TARGET: "Agent Coaching: choose an Agent in your brokerage to receive a Coach Token.",
            GRW007_PLAY_OR_FIRE: "Property Tour: choose 1 of these 3 Action Cards to keep for free \u2014 the other 2 are fired out of the game.",
            GRW022_LOYALTY_TARGET: "Top Performer Award: choose an Agent in your roster to receive a Loyalty Token (Unrecruitable).",
            GRW031_COACH_TARGET: "Skill Building Workshop: choose an Agent in your brokerage to receive a Coach Token.",
            GRW037_SINGLE_TRACK_CHOICE: "Leadership Academy: choose ONE Operation Hub value to raise by 3.",
            GRW039_RECRUIT_OR_FIRE: "Press Release: choose 1 of these 2 Agents to recruit for free \u2014 the other is fired out of the game.",
            GRW041_COACH_TARGET: "Office Overhaul: choose an Agent in your brokerage to receive a Coach Token.",
            GRW044_LOYALTY_AND_COACH_TARGET: "Community Hero Award: choose an Agent to receive both a Coach Token and a Loyalty Token.",
            GRW048_LOYALTY_TARGET: "Tech Platform Launch: choose an Agent in your roster to receive a Loyalty Token (Unrecruitable).",
            GRW050_LOYALTY_TARGET: "Hall of Fame Induction: choose an Agent in your roster to receive a Loyalty Token (Unrecruitable).",
            GRW051_MARKET_TARGET: "Brokerage Buyout (Step 1 of 2): choose an Open Market Agent to recruit for free.",
            GRW051_RIVAL_TARGET: "Brokerage Buyout (Step 2 of 2): choose a rival Agent with Profit 5 or less to recruit.",
            GRW052_RIVAL_TARGET: "Market Leadership: choose a rival Agent to recruit and immediately lock with a Loyalty Token.",
            GRW053_KEEP_TWO_CHOICE: "Data Analysis: choose exactly 2 of these 4 Action Cards to keep \u2014 the other 2 are discarded.",
            GRW054_LOYALTY_TARGET: "High-Level Meeting: choose an Agent in your roster to receive a Loyalty Token (Unrecruitable).",
            GRW055_DOUBLE_COACH_TARGET: "Agent Retreat: choose an Agent in your brokerage to receive 2 Coach Tokens.",
            GRW056_RECRUIT_TARGET_1: "Market Expansion (Agent 1 of 2): choose an Open Market Agent to recruit for free.",
            GRW056_RECRUIT_TARGET_2: "Market Expansion (Agent 2 of 2): choose another Open Market Agent to recruit for free.",
            GRW057_COACH_TARGET: "Technology Investment: choose an Agent in your brokerage to receive a Coach Token.",
            GRW059_RECRUIT_TARGET: "Strategic Hiring: choose an Open Market Agent to recruit for free.",
            GRW061_COACH_TARGET: "Community Event: choose an Agent in your brokerage to receive a Coach Token.",
            STR070_PROTECT_TARGET: "Office Offer Save: choose an Agent in your roster to protect from recruitment this round.",
            STR072_PROTECT_TARGET: "Compliance Review: choose an Agent in your roster to protect from recruitment this turn.",
            STR074_RIVAL_TARGET: "Timely Advice: choose a rival to block from gaining Profit Tokens this round.",
            STR078_SPACE_TRACK_CHOICE: "Mentor Program: choose ONE Operation Hub space to block all Meeple placements on this round.",
            STR079_PROTECT_TARGET: "Tech Support: choose an Agent in your roster to protect from recruitment this turn.",
            STR080_RIVAL_TARGET: "Community Relations: choose a rival \u2014 they pay you 5 Profit Tokens."
          };
          return {
            active: true,
            mode: "START_CARD_CHOICE_HINT",
            sourcePlayerId: interrupt.sourcePlayerId,
            sourcePlayerDisplayName: interrupt.sourcePlayerDisplayName,
            headerText,
            promptText: PROMPT_TEXT_BY_CHOICE_TYPE2[interrupt.choiceType] || "Make your choice.",
            choiceType: interrupt.choiceType,
            requiredCount: interrupt.requiredCount,
            candidateMeepleInstanceIds: interrupt.candidateMeepleInstanceIds || [],
            candidateCatalogIds: interrupt.actionCardCandidateCatalogIds || [],
            agentCandidateCatalogIds: interrupt.agentCandidates || []
          };
        }
        if (interrupt.type === "ACTION_SPACE_DEFERRED_CHOICE") {
          return {
            active: true,
            mode: "UNKNOWN_HINT",
            sourcePlayerId: interrupt.sourcePlayerId,
            sourcePlayerDisplayName: interrupt.sourcePlayerDisplayName,
            headerText,
            promptText: buildDeferredSpacePromptText(interrupt),
            choiceType: interrupt.choiceType,
            candidates: []
          };
        }
        if (!CONFIRMABLE_CHOICE_TYPES.has(interrupt.choiceType)) {
          return {
            active: true,
            mode: "UNKNOWN_HINT",
            sourcePlayerId: interrupt.sourcePlayerId,
            sourcePlayerDisplayName: interrupt.sourcePlayerDisplayName,
            headerText,
            promptText: buildPromptText(interrupt),
            choiceType: interrupt.choiceType,
            candidates: []
          };
        }
        return {
          active: true,
          mode: "CONFIRMABLE_SELECTION",
          sourcePlayerId: interrupt.sourcePlayerId,
          sourcePlayerDisplayName: interrupt.sourcePlayerDisplayName,
          headerText,
          promptText: buildPromptText(interrupt),
          choiceType: interrupt.choiceType,
          minSelect: interrupt.minSelect,
          maxSelect: interrupt.maxSelect,
          candidates: interrupt.candidates.map(buildCandidateNode)
        };
      }
      function buildHistoryTickerStream(vm) {
        return vm.log.map((entry) => ({
          seq: entry.seq,
          round: entry.round,
          type: entry.type,
          displayText: entry.displayText
        }));
      }
      function renderInterruptOverlay(vm) {
        return {
          modal: buildInterruptOverlayModal(vm),
          historyTicker: buildHistoryTickerStream(vm)
        };
      }
      module.exports = {
        renderInterruptOverlay,
        PROMPT_TEXT_BY_CHOICE_TYPE,
        CONFIRMABLE_CHOICE_TYPES,
        // Exported for tests only.
        __testables: {
          buildInterruptOverlayModal,
          buildHistoryTickerStream,
          buildCandidateNode,
          buildPromptText,
          buildDeferredSpacePromptText,
          buildHeaderText,
          subjectVerbAgreement,
          possessiveLabel
        }
      };
    }
  });

  // turnOrderBiddingReducer.js
  var require_turnOrderBiddingReducer = __commonJS({
    "turnOrderBiddingReducer.js"(exports, module) {
      var { adjustWallet } = require_cardEffectHelpers();
      var { resolveTurnOrderBidding, runCleanupSweeps, advanceToNextRoundOrFinalScoring } = require_endOfRoundReducer();
      function appendLog(state, entry) {
        const logEntry = {
          seq: state.log.length + 1,
          timestamp: (/* @__PURE__ */ new Date()).toISOString(),
          round: state.phase.round,
          ...entry
        };
        return { ...state, log: [...state.log, logEntry] };
      }
      function allPlayersHaveSubmittedBids(state) {
        return Object.values(state.players).every((player) => player.turnOrderBid.submitted === true);
      }
      function submitTurnOrderBid(state, playerId, action) {
        const payload = action && action.payload || {};
        const { profitTokensBid, priorityTokensBid } = payload;
        if (typeof profitTokensBid !== "number" || typeof priorityTokensBid !== "number" || profitTokensBid < 0 || priorityTokensBid < 0 || !Number.isInteger(profitTokensBid) || !Number.isInteger(priorityTokensBid)) {
          return {
            state,
            error: "INVALID_BID_PAYLOAD",
            detail: { profitTokensBid, priorityTokensBid },
            resolved: false
          };
        }
        if (state.phase.current !== "TURN_ORDER_BIDDING") {
          return {
            state,
            error: "WRONG_PHASE",
            detail: { expected: "TURN_ORDER_BIDDING", actual: state.phase.current },
            resolved: false
          };
        }
        const player = state.players[playerId];
        if (!player) {
          return { state, error: "PLAYER_NOT_FOUND", detail: { playerId }, resolved: false };
        }
        if (player.turnOrderBid.submitted) {
          return { state, error: "BID_ALREADY_SUBMITTED", detail: { playerId }, resolved: false };
        }
        if (player.wallet.profitTokens < profitTokensBid || player.wallet.priorityTokens < priorityTokensBid) {
          return {
            state,
            error: "INSUFFICIENT_FUNDS_FOR_BID",
            detail: {
              playerId,
              required: { profitTokens: profitTokensBid, priorityTokens: priorityTokensBid },
              available: { profitTokens: player.wallet.profitTokens, priorityTokens: player.wallet.priorityTokens }
            },
            resolved: false
          };
        }
        let nextState = adjustWallet(state, playerId, -profitTokensBid, -priorityTokensBid);
        nextState = {
          ...nextState,
          players: {
            ...nextState.players,
            [playerId]: {
              ...nextState.players[playerId],
              turnOrderBid: {
                status: "hidden",
                profitTokensBid,
                priorityTokensBid,
                submitted: true
              }
            }
          }
        };
        nextState = appendLog(nextState, {
          type: "TURN_ORDER_BID_SUBMITTED",
          playerId,
          message: `${playerId} submitted a secret turn-order bid.`
        });
        if (allPlayersHaveSubmittedBids(nextState)) {
          let resolvedState = resolveTurnOrderBidding(nextState);
          resolvedState = runCleanupSweeps(resolvedState);
          resolvedState = advanceToNextRoundOrFinalScoring(resolvedState);
          return { state: resolvedState, error: null, resolved: true };
        }
        return { state: nextState, error: null, resolved: false };
      }
      module.exports = {
        submitTurnOrderBid
      };
    }
  });

  // specialistReducer.js
  var require_specialistReducer = __commonJS({
    "specialistReducer.js"(exports, module) {
      var { placeMeeple } = require_workerPlacementReducer();
      var { verifySpecialistHubNotSpent, verifyCanAffordSpace } = require_workerPlacementValidation();
      function appendLog(state, entry) {
        const logEntry = {
          seq: state.log.length + 1,
          timestamp: (/* @__PURE__ */ new Date()).toISOString(),
          round: state.phase.round,
          ...entry
        };
        return { ...state, log: [...state.log, logEntry] };
      }
      function findSpecialistHubSpace(state) {
        const spaces = state.board && state.board.actionSpaces || [];
        return spaces.find((s) => s.type === "specialist_action") || null;
      }
      function claimSpecialistCard(state, playerId, meepleInstanceId, extra = null) {
        const hubSpace = findSpecialistHubSpace(state);
        if (!hubSpace) {
          return {
            state: appendLog(state, {
              type: "SPECIALIST_PROCUREMENT_ERROR",
              playerId,
              reason: "NO_SPECIALIST_HUB_ON_BOARD"
            }),
            error: "NO_SPECIALIST_HUB_ON_BOARD",
            detail: null
          };
        }
        const result = placeMeeple(state, playerId, meepleInstanceId, hubSpace.spaceId, extra);
        if (result.error) {
          return {
            state: appendLog(result.state, {
              type: "SPECIALIST_PROCUREMENT_ERROR",
              playerId,
              spaceId: hubSpace.spaceId,
              reason: result.error,
              detail: result.detail
            }),
            error: result.error,
            detail: result.detail
          };
        }
        return { state: result.state, error: null, detail: null };
      }
      function evaluateBotSpecialistDecision(state, playerId) {
        const player = state.players[playerId];
        if (!player || !player.isBot) {
          return { state, decision: "SKIPPED", reason: "NOT_A_BOT", error: null };
        }
        const hubSpace = findSpecialistHubSpace(state);
        const activeCard = state.specialistDeck && state.specialistDeck.activeCard;
        const cardUnclaimed = !!(activeCard && activeCard.catalogId && !activeCard.claimedByPlayerId);
        const hubOpen = !!hubSpace && verifySpecialistHubNotSpent(state, hubSpace.spaceId).ok;
        if (!hubSpace || !cardUnclaimed || !hubOpen) {
          return {
            state: appendLog(state, {
              type: "BOT_SPECIALIST_DECISION_SKIPPED",
              playerId,
              reason: !hubSpace ? "NO_SPECIALIST_HUB_ON_BOARD" : !cardUnclaimed ? "CARD_ALREADY_CLAIMED" : "HUB_ALREADY_SPENT"
            }),
            decision: "SKIPPED",
            reason: !hubSpace ? "NO_SPECIALIST_HUB_ON_BOARD" : !cardUnclaimed ? "CARD_ALREADY_CLAIMED" : "HUB_ALREADY_SPENT",
            error: null
          };
        }
        const affordCheck = verifyCanAffordSpace(state, playerId, hubSpace);
        const meepleCost = hubSpace.cost && hubSpace.cost.meepleCost || 1;
        const inSupplyMeeples = player.timeMeeples.active.filter((m) => m.status === "in_supply");
        const hasEnoughMeeples = inSupplyMeeples.length >= meepleCost;
        if (!affordCheck.ok || !hasEnoughMeeples) {
          return {
            state: appendLog(state, {
              type: "BOT_SPECIALIST_DECISION_SKIPPED",
              playerId,
              reason: !affordCheck.ok ? "INSUFFICIENT_FUNDS" : "INSUFFICIENT_MEEPLES"
            }),
            decision: "SKIPPED",
            reason: !affordCheck.ok ? "INSUFFICIENT_FUNDS" : "INSUFFICIENT_MEEPLES",
            error: null
          };
        }
        const primaryMeepleId = inSupplyMeeples[0].instanceId;
        const additionalMeepleInstanceIds = inSupplyMeeples.slice(1, meepleCost).map((m) => m.instanceId);
        let nextState = appendLog(state, {
          type: "BOT_SPECIALIST_DECISION_MADE",
          playerId,
          spaceId: hubSpace.spaceId,
          catalogId: activeCard.catalogId,
          meepleInstanceId: primaryMeepleId,
          additionalMeepleInstanceIds
        });
        const claimResult = claimSpecialistCard(nextState, playerId, primaryMeepleId, {
          additionalMeepleInstanceIds
        });
        return { state: claimResult.state, decision: "CLAIMED", reason: null, error: claimResult.error };
      }
      module.exports = {
        claimSpecialistCard,
        evaluateBotSpecialistDecision,
        findSpecialistHubSpace
      };
    }
  });

  // interruptResolutionReducer.js
  var require_interruptResolutionReducer = __commonJS({
    "interruptResolutionReducer.js"(exports, module) {
      var specialistCards = require_specialistCards();
      var NULL_INTERRUPT = { type: "NULL", sourcePlayerId: null, data: {} };
      function appendLog(state, entry) {
        const logEntry = {
          seq: state.log.length + 1,
          timestamp: (/* @__PURE__ */ new Date()).toISOString(),
          round: state.phase.round,
          ...entry
        };
        return { ...state, log: [...state.log, logEntry] };
      }
      function validateSelectTrashCards(interrupt, respondingPlayerId, payload) {
        if (interrupt.sourcePlayerId !== respondingPlayerId) {
          return { ok: false, error: "NOT_YOUR_INTERRUPT_TO_RESOLVE" };
        }
        const { selectedInstanceIds } = payload || {};
        if (!Array.isArray(selectedInstanceIds)) {
          return { ok: false, error: "MALFORMED_RESPONSE", detail: { reason: "selectedInstanceIds must be an array" } };
        }
        const { candidateInstanceIds, maxSelect, minSelect } = interrupt.data;
        if (selectedInstanceIds.length > maxSelect || selectedInstanceIds.length < (minSelect || 0)) {
          return {
            ok: false,
            error: "INVALID_SELECTION_COUNT",
            detail: { selectedCount: selectedInstanceIds.length, minSelect: minSelect || 0, maxSelect }
          };
        }
        const candidateSet = new Set(candidateInstanceIds);
        const allValid = selectedInstanceIds.every((id) => candidateSet.has(id));
        if (!allValid) {
          return {
            ok: false,
            error: "INVALID_SELECTION_IDS",
            detail: { selectedInstanceIds, candidateInstanceIds }
          };
        }
        if (new Set(selectedInstanceIds).size !== selectedInstanceIds.length) {
          return { ok: false, error: "DUPLICATE_SELECTION_IDS", detail: { selectedInstanceIds } };
        }
        return { ok: true };
      }
      var CHOICE_RESOLVERS = {
        "SPECIALIST_CARD_CHOICE:SELECT_TRASH_CARDS": {
          validate: validateSelectTrashCards,
          apply(state, interrupt, respondingPlayerId, payload) {
            const { selectedInstanceIds } = payload;
            if (selectedInstanceIds.length === 0) {
              return appendLog(state, {
                type: "SPECIALIST_EFFECT_CLEAN_SLATE_SKIPPED",
                playerId: respondingPlayerId,
                catalogId: interrupt.data.catalogId,
                reason: "PLAYER_SELECTED_ZERO_CARDS"
              });
            }
            return specialistCards.performCleanSlateTrashAndDraw(
              state,
              respondingPlayerId,
              selectedInstanceIds,
              false
              // usedDefaultSelection: false — this was a real, explicit player response
            );
          }
        }
      };
      function handleInterruptResolution(state, respondingPlayerId, payload) {
        const interrupt = state.phase.pendingInterrupt;
        if (!interrupt || interrupt.type === "NULL") {
          return { state, error: "NO_PENDING_INTERRUPT", detail: null };
        }
        const resolverKey = `${interrupt.type}:${interrupt.data && interrupt.data.choiceType}`;
        const resolver = CHOICE_RESOLVERS[resolverKey];
        if (!resolver) {
          return {
            state,
            error: "UNKNOWN_INTERRUPT_TYPE",
            detail: { type: interrupt.type, choiceType: interrupt.data && interrupt.data.choiceType }
          };
        }
        const validation = resolver.validate(interrupt, respondingPlayerId, payload);
        if (!validation.ok) {
          return { state, error: validation.error, detail: validation.detail || null };
        }
        let nextState = resolver.apply(state, interrupt, respondingPlayerId, payload);
        nextState = {
          ...nextState,
          phase: { ...nextState.phase, pendingInterrupt: NULL_INTERRUPT }
        };
        nextState = appendLog(nextState, {
          type: "INTERRUPT_RESOLVED",
          interruptType: interrupt.type,
          choiceType: interrupt.data && interrupt.data.choiceType,
          respondingPlayerId
        });
        return { state: nextState, error: null, detail: null };
      }
      module.exports = {
        handleInterruptResolution,
        // Exported for tests only — not part of the public handler contract.
        __testables: {
          CHOICE_RESOLVERS,
          validateSelectTrashCards
        }
      };
    }
  });

  // botDecisionEngine.js
  var require_botDecisionEngine = __commonJS({
    "botDecisionEngine.js"(exports, module) {
      var {
        computeDeskUsage,
        hasOpenDesk,
        countMatchingValues,
        getAgentStats,
        VALUE_DIMENSIONS,
        MIN_MATCHING_VALUES_TO_RECRUIT,
        MIN_MATCHING_VALUES_TO_POACH
      } = require_agentRecruitmentReducer();
      var ARCHETYPE_WEIGHTS = {
        Aggressive: { poach: 3, recruit: 1, loyalty: 1, engineSpaces: 1, playCard: 1, marketShareSprint: 5 },
        Growth: { poach: 1, recruit: 3, loyalty: 2, engineSpaces: 1, playCard: 1, marketShareSprint: 5 },
        Engine: { poach: 0.5, recruit: 1, loyalty: 1, engineSpaces: 3, playCard: 1, marketShareSprint: 5 }
      };
      function getArchetypeWeights(archetype) {
        return ARCHETYPE_WEIGHTS[archetype] || { poach: 1, recruit: 1, loyalty: 1, engineSpaces: 1, playCard: 1, marketShareSprint: 5 };
      }
      function evaluateTurnOrderBid(state, playerId) {
        const player = state.players[playerId];
        if (player.wallet.priorityTokens >= 1) {
          return { profitTokensBid: 0, priorityTokensBid: 1 };
        }
        const CASH_BID_BY_ARCHETYPE = { Aggressive: 3, Growth: 2, Engine: 1 };
        const desiredCashBid = CASH_BID_BY_ARCHETYPE[player.archetype] || 1;
        return { profitTokensBid: Math.min(desiredCashBid, player.wallet.profitTokens), priorityTokensBid: 0 };
      }
      function evaluateRecruitCandidates(state, playerId) {
        const player = state.players[playerId];
        if (!hasOpenDesk(state, playerId)) {
          return null;
        }
        const candidates = (state.board.openMarketAgents || []).map((entry) => {
          const stats = getAgentStats(state, entry.catalogId);
          if (!stats) return null;
          const matched = countMatchingValues(player.tracks, stats);
          if (matched < MIN_MATCHING_VALUES_TO_RECRUIT) return null;
          const influencerBonus = stats.network && stats.network.role === "influencer" ? stats.totalProfit * 0.5 : 0;
          return { catalogId: entry.catalogId, score: stats.totalProfit + influencerBonus };
        }).filter(Boolean);
        if (candidates.length === 0) return null;
        candidates.sort((a, b) => b.score - a.score);
        return candidates[0].catalogId;
      }
      function evaluatePoachCandidates(state, playerId) {
        if (!hasOpenDesk(state, playerId)) {
          return null;
        }
        const player = state.players[playerId];
        const candidates = [];
        Object.keys(state.players).forEach((rivalId) => {
          if (rivalId === playerId) return;
          const rival = state.players[rivalId];
          rival.roster.forEach((entry) => {
            if (entry.isVoided) return;
            if (entry.onboardingToken && entry.onboardingToken.active) return;
            if (entry.loyaltyToken && entry.loyaltyToken.active) return;
            if (typeof entry.recruitmentProtectedUntilRound === "number" && state.phase.round <= entry.recruitmentProtectedUntilRound) return;
            const stats = getAgentStats(state, entry.catalogId);
            if (!stats) return;
            if (stats.network.role === "follower" && stats.network.influencerCatalogId) {
              const influencerStillPresent = rival.roster.some((r) => !r.isVoided && r.catalogId === stats.network.influencerCatalogId);
              if (influencerStillPresent) return;
            }
            const matched = countMatchingValues(player.tracks, stats);
            if (matched < MIN_MATCHING_VALUES_TO_POACH) return;
            candidates.push({ targetPlayerId: rivalId, targetAgentInstanceId: entry.agentInstanceId, score: stats.totalProfit });
          });
        });
        if (candidates.length === 0) return null;
        candidates.sort((a, b) => b.score - a.score);
        return { targetPlayerId: candidates[0].targetPlayerId, targetAgentInstanceId: candidates[0].targetAgentInstanceId };
      }
      function evaluateLoyaltyCandidates(state, playerId) {
        const player = state.players[playerId];
        if (player.loyaltyTokensUsed >= player.loyaltyTokensMax) {
          return null;
        }
        const candidates = player.roster.filter((entry) => !entry.isVoided).filter((entry) => !(entry.loyaltyToken && entry.loyaltyToken.active)).filter((entry) => !(entry.onboardingToken && entry.onboardingToken.active)).map((entry) => {
          const stats = getAgentStats(state, entry.catalogId);
          if (!stats) return null;
          const matched = VALUE_DIMENSIONS.filter((dim) => player.tracks[dim].value >= stats[dim]).length;
          if (matched < VALUE_DIMENSIONS.length) return null;
          return { agentInstanceId: entry.agentInstanceId, score: stats.totalProfit };
        }).filter(Boolean);
        if (candidates.length === 0) return null;
        candidates.sort((a, b) => b.score - a.score);
        return candidates[0].agentInstanceId;
      }
      var { verifyPlayRequirement } = require_actionCardReducer();
      function evaluateActionCardChoice(state, playerId) {
        const player = state.players[playerId];
        const catalog = state.cardCatalog && state.cardCatalog.actionCards || {};
        const playable = player.hand.actionCards.map((entry) => {
          const stats = catalog[entry.catalogId];
          if (!stats) return null;
          if (stats.cost > player.wallet.profitTokens) return null;
          const requirementCheck = verifyPlayRequirement(state, playerId, entry.catalogId);
          if (!requirementCheck.ok) return null;
          const isTargeted = !!(stats.description && /another (player|brokerage)|rival|opponent|target/i.test(stats.description));
          return { instanceId: entry.instanceId, catalogId: entry.catalogId, cost: stats.cost, isTargeted };
        }).filter(Boolean);
        if (playable.length === 0) return null;
        const archetype = player.archetype;
        if (archetype === "Aggressive") {
          const targeted = playable.filter((c) => c.isTargeted);
          if (targeted.length > 0) {
            targeted.sort((a, b) => b.cost - a.cost);
            return targeted[0].instanceId;
          }
        }
        playable.sort((a, b) => a.cost - b.cost);
        return playable[0].instanceId;
      }
      module.exports = {
        evaluateTurnOrderBid,
        getArchetypeWeights,
        evaluateRecruitCandidates,
        evaluatePoachCandidates,
        evaluateLoyaltyCandidates,
        evaluateActionCardChoice,
        ARCHETYPE_WEIGHTS
      };
    }
  });

  // botInterruptResolver.js
  var require_botInterruptResolver = __commonJS({
    "botInterruptResolver.js"(exports, module) {
      var { handleInterruptResolution } = require_interruptResolutionReducer();
      var { resolveDualTrackChoice, resolveHireCoachChoice, resolveClearOpenMarketChoice, resolveClearOpenMarketFreeCardPick, advanceActivePlayer, cancelDeferredSpaceChoice } = require_workerPlacementReducer();
      var { resolveTrackBranchChoice, resolveTargetedMilestone } = require_techTrackReducer();
      var { evaluateRecruitCandidates, evaluatePoachCandidates, evaluateLoyaltyCandidates, evaluateActionCardChoice } = require_botDecisionEngine();
      var { resolveRecruitFromGrowthHub, resolvePoachFromGrowthHub, resolveLoyaltyFromGrowthHub } = require_agentRecruitmentReducer();
      var { playActionCard, resolveActionCardEffectChoice, resolveSpecialistCardEffectChoice } = require_actionCardReducer();
      var { resolveShiftEffectStage2 } = require_shiftReducer();
      var DEAD_CARD_TRACK_LEVEL_THRESHOLD = 3;
      function appendLog(state, entry) {
        const logEntry = {
          seq: state.log.length + 1,
          timestamp: (/* @__PURE__ */ new Date()).toISOString(),
          round: state.phase.round,
          ...entry
        };
        return { ...state, log: [...state.log, logEntry] };
      }
      function getCardCatalogEntry(state, catalogId) {
        return state.cardCatalog && state.cardCatalog.actionCards && state.cardCatalog.actionCards[catalogId] || null;
      }
      function findCandidateCard(player, instanceId) {
        return player.hand.actionCards.find((c) => c.instanceId === instanceId) || player.hand.personalDiscardPile.find((c) => c.instanceId === instanceId) || null;
      }
      function computeCleanSlateBotSelection(state, player, interrupt) {
        const { candidateInstanceIds, maxSelect } = interrupt.data;
        const candidates = candidateInstanceIds.map((instanceId) => {
          const card = findCandidateCard(player, instanceId);
          const catalogEntry = card ? getCardCatalogEntry(state, card.catalogId) : null;
          return {
            instanceId,
            catalogId: card ? card.catalogId : null,
            cost: catalogEntry ? catalogEntry.cost : null,
            playRequirement: catalogEntry ? catalogEntry.playRequirement : null
          };
        });
        if (player.archetype === "Aggressive") {
          const withKnownCost = candidates.filter((c) => c.cost !== null).sort((a, b) => a.cost - b.cost);
          const selectedInstanceIds = withKnownCost.slice(0, maxSelect).map((c) => c.instanceId);
          return { selectedInstanceIds, rationale: "AGGRESSIVE_LOWEST_COST_CHURN" };
        }
        if (player.archetype === "Cautious") {
          const deadCards = candidates.filter((c) => {
            if (!c.playRequirement || c.playRequirement.type !== "track") return false;
            const currentLevel = player.tracks[c.playRequirement.track] ? player.tracks[c.playRequirement.track].value : 0;
            return c.playRequirement.level - currentLevel >= DEAD_CARD_TRACK_LEVEL_THRESHOLD;
          });
          const selectedInstanceIds = deadCards.slice(0, maxSelect).map((c) => c.instanceId);
          return {
            selectedInstanceIds,
            rationale: deadCards.length > 0 ? "CAUTIOUS_DEAD_CARD_PRUNE" : "CAUTIOUS_NO_DEAD_CARDS_FOUND"
          };
        }
        return { selectedInstanceIds: [], rationale: "DEFAULT_ARCHETYPE_NO_POLICY_TRASH_NONE" };
      }
      var BOT_CHOICE_COMPUTERS = {
        "SPECIALIST_CARD_CHOICE:SELECT_TRASH_CARDS": computeCleanSlateBotSelection
      };
      function computeDualTrackBotChoice(player) {
        const TRACK_ORDER = ["training", "technology", "recognition"];
        const sorted = [...TRACK_ORDER].sort((a, b) => player.tracks[a].value - player.tracks[b].value);
        return { trackA: sorted[0], trackB: sorted[1], rationale: "LOWEST_TWO_TRACKS" };
      }
      function computeBotStartCardChoice(state, playerId, choiceType, interruptData) {
        const player = state.players[playerId];
        const TRACK_ORDER = ["training", "technology", "recognition"];
        const lowestTrack = () => [...TRACK_ORDER].sort((a, b) => player.tracks[a].value - player.tracks[b].value)[0];
        const lowestTwoTracks = () => [...TRACK_ORDER].sort((a, b) => player.tracks[a].value - player.tracks[b].value).slice(0, 2);
        if (choiceType === "S1_DISCARD_FOR_TRACKS") {
          const sortedByCost = [...player.hand.actionCards].sort((a, b) => {
            const catalog = state.cardCatalog && state.cardCatalog.actionCards || {};
            const costA = catalog[a.catalogId] && catalog[a.catalogId].cost || 0;
            const costB = catalog[b.catalogId] && catalog[b.catalogId].cost || 0;
            return costA - costB;
          });
          const discardInstanceIds = sortedByCost.slice(0, 2).map((c) => c.instanceId);
          return { discardInstanceIds, trackChoices: lowestTwoTracks() };
        }
        if (choiceType === "S2_TRIPLE_TRACK_BOOST") {
          const lowest = lowestTrack();
          return { trackChoices: [lowest, lowest, lowest] };
        }
        if (choiceType === "S3_DOUBLE_TRACK_BOOST") {
          return { trackChoices: lowestTwoTracks() };
        }
        if (choiceType === "S5_HIRE_COACH_TARGET") {
          const candidate = player.roster.find((r) => !r.isVoided);
          return { targetAgentInstanceId: candidate ? candidate.agentInstanceId : null };
        }
        if (choiceType === "S6_RECALL_MEEPLES") {
          return { meepleInstanceIds: [] };
        }
        if (choiceType === "CRM_UPDATE_RECRUIT") {
          const candidateCatalogIds = interruptData && interruptData.candidateCatalogIds || [];
          const catalog = state.cardCatalog && state.cardCatalog.agentCards || {};
          let best = null;
          candidateCatalogIds.forEach((catalogId) => {
            const stats = catalog[catalogId];
            if (!stats) return;
            if (!best || stats.totalProfit > catalog[best].totalProfit) {
              best = catalogId;
            }
          });
          return { chosenCatalogId: best };
        }
        if (choiceType === "GRW013_COACH_TARGET" || choiceType === "GRW015_COACH_TARGET") {
          const candidate = player.roster.find((r) => !r.isVoided);
          return { targetAgentInstanceId: candidate ? candidate.agentInstanceId : null };
        }
        if (choiceType === "GRW004_RECRUIT_TARGET" || choiceType === "GRW010_RECRUIT_TARGET") {
          const openMarketAgents = (state.board.openMarketAgents || []).filter((a) => a && a.catalogId);
          if (choiceType === "GRW004_RECRUIT_TARGET") {
            const catalog = state.cardCatalog && state.cardCatalog.agentCards || {};
            const filtered = openMarketAgents.filter((a) => {
              const stats = catalog[a.catalogId];
              return stats && typeof stats.recognition === "number" && stats.recognition < 5;
            });
            const chosen2 = filtered[0] || null;
            return { targetCatalogId: chosen2 ? chosen2.catalogId : null };
          }
          const chosen = openMarketAgents[0] || null;
          return { targetCatalogId: chosen ? chosen.catalogId : null };
        }
        if (choiceType === "GRW007_PLAY_OR_FIRE") {
          const candidateCatalogIds = interruptData && interruptData.candidateCatalogIds || [];
          const catalog = state.cardCatalog && state.cardCatalog.actionCards || {};
          const sorted = [...candidateCatalogIds].sort((a, b) => (catalog[a] ? catalog[a].cost : 0) - (catalog[b] ? catalog[b].cost : 0));
          return { keptCatalogId: sorted[0] || null, candidateCatalogIds };
        }
        if (choiceType === "GRW022_LOYALTY_TARGET" || choiceType === "GRW031_COACH_TARGET") {
          const candidate = player.roster.find((r) => !r.isVoided);
          return { targetAgentInstanceId: candidate ? candidate.agentInstanceId : null };
        }
        if (choiceType === "GRW037_SINGLE_TRACK_CHOICE") {
          return { trackChoice: lowestTrack() };
        }
        if (choiceType === "GRW039_RECRUIT_OR_FIRE") {
          const candidateCatalogIds = interruptData && interruptData.candidateCatalogIds || [];
          const agentCatalog = state.cardCatalog && state.cardCatalog.agentCards || {};
          const sorted = [...candidateCatalogIds].sort((a, b) => {
            const statsA = agentCatalog[a];
            const statsB = agentCatalog[b];
            return (statsB ? statsB.totalProfit : 0) - (statsA ? statsA.totalProfit : 0);
          });
          return { recruitedCatalogId: sorted[0] || null };
        }
        if (choiceType === "GRW061_COACH_TARGET") {
          const candidate = player.roster.find((r) => !r.isVoided);
          return { targetAgentInstanceId: candidate ? candidate.agentInstanceId : null };
        }
        if (choiceType === "STR070_PROTECT_TARGET" || choiceType === "STR072_PROTECT_TARGET" || choiceType === "STR079_PROTECT_TARGET") {
          const agentCatalog = state.cardCatalog && state.cardCatalog.agentCards || {};
          const eligible = player.roster.filter((r) => !r.isVoided);
          const sorted = [...eligible].sort((a, b) => {
            const statsA = agentCatalog[a.catalogId];
            const statsB = agentCatalog[b.catalogId];
            return (statsB ? statsB.totalProfit : 0) - (statsA ? statsA.totalProfit : 0);
          });
          return { targetAgentInstanceId: sorted[0] ? sorted[0].agentInstanceId : null };
        }
        if (choiceType === "STR074_RIVAL_TARGET" || choiceType === "STR080_RIVAL_TARGET") {
          const turnOrder = state.phase.turnOrder || [];
          const rivalIds = turnOrder.filter((id) => id !== playerId);
          const sorted = [...rivalIds].sort((a, b) => (state.players[b] ? state.players[b].wallet.profitTokens : 0) - (state.players[a] ? state.players[a].wallet.profitTokens : 0));
          return { targetPlayerId: sorted[0] || null };
        }
        if (choiceType === "STR078_SPACE_TRACK_CHOICE") {
          return { trackChoice: lowestTrack() };
        }
        if (choiceType === "GRW041_COACH_TARGET" || choiceType === "GRW044_LOYALTY_AND_COACH_TARGET" || choiceType === "GRW048_LOYALTY_TARGET" || choiceType === "GRW050_LOYALTY_TARGET" || choiceType === "GRW054_LOYALTY_TARGET" || choiceType === "GRW055_DOUBLE_COACH_TARGET" || choiceType === "GRW057_COACH_TARGET") {
          const candidate = player.roster.find((r) => !r.isVoided);
          return { targetAgentInstanceId: candidate ? candidate.agentInstanceId : null };
        }
        if (choiceType === "GRW051_MARKET_TARGET" || choiceType === "GRW056_RECRUIT_TARGET_1") {
          const openMarketAgents = (state.board.openMarketAgents || []).filter((a) => a && a.catalogId);
          const chosen = openMarketAgents[0] || null;
          return { stage: choiceType === "GRW051_MARKET_TARGET" ? "market" : "first", targetCatalogId: chosen ? chosen.catalogId : null };
        }
        if (choiceType === "GRW056_RECRUIT_TARGET_2") {
          const openMarketAgents = (state.board.openMarketAgents || []).filter((a) => a && a.catalogId);
          const chosen = openMarketAgents[0] || null;
          return { stage: "second", targetCatalogId: chosen ? chosen.catalogId : null };
        }
        if (choiceType === "GRW059_RECRUIT_TARGET") {
          const openMarketAgents = (state.board.openMarketAgents || []).filter((a) => a && a.catalogId);
          const chosen = openMarketAgents[0] || null;
          return { targetCatalogId: chosen ? chosen.catalogId : null };
        }
        if (choiceType === "GRW051_RIVAL_TARGET" || choiceType === "GRW052_RIVAL_TARGET") {
          const turnOrder = state.phase.turnOrder || [];
          const rivalIds = turnOrder.filter((id) => id !== playerId);
          const agentCatalog = state.cardCatalog && state.cardCatalog.agentCards || {};
          let best = null;
          rivalIds.forEach((rivalId) => {
            const rival = state.players[rivalId];
            if (!rival) return;
            rival.roster.forEach((entry) => {
              if (entry.isVoided) return;
              if (entry.onboardingToken && entry.onboardingToken.active) return;
              if (entry.loyaltyToken && entry.loyaltyToken.active) return;
              if (typeof entry.recruitmentProtectedUntilRound === "number" && state.phase.round <= entry.recruitmentProtectedUntilRound) return;
              const stats = agentCatalog[entry.catalogId];
              if (!stats) return;
              if (stats.network.role === "follower" && stats.network.influencerCatalogId) {
                const influencerStillPresent = rival.roster.some((r) => !r.isVoided && r.catalogId === stats.network.influencerCatalogId);
                if (influencerStillPresent) return;
              }
              if (choiceType === "GRW051_RIVAL_TARGET" && stats.totalProfit > 5) return;
              if (!best || stats.totalProfit < best.totalProfit) {
                best = { rivalId, agentInstanceId: entry.agentInstanceId, totalProfit: stats.totalProfit };
              }
            });
          });
          return { targetPlayerId: best ? best.rivalId : null, targetAgentInstanceId: best ? best.agentInstanceId : null };
        }
        if (choiceType === "GRW053_KEEP_TWO_CHOICE") {
          const candidateCatalogIds = interruptData && interruptData.candidateCatalogIds || [];
          const catalog = state.cardCatalog && state.cardCatalog.actionCards || {};
          const sorted = [...candidateCatalogIds].sort((a, b) => (catalog[a] ? catalog[a].cost : 0) - (catalog[b] ? catalog[b].cost : 0));
          return { keptCatalogIds: sorted.slice(0, 2), candidateCatalogIds };
        }
        return {};
      }
      function computeBotMilestoneChoice(state, playerId, milestoneKey) {
        const player = state.players[playerId];
        if (milestoneKey === "HEADHUNTER") {
          const drawn = (state.board.decks.agentDrawPile || []).slice(0, 2);
          return { keepCatalogId: drawn[0] || null };
        }
        if (milestoneKey === "POISON_PILL" || milestoneKey === "HOSTILE_BUYOUT") {
          const candidates = [];
          Object.keys(state.players).forEach((rivalId) => {
            if (rivalId === playerId) return;
            state.players[rivalId].roster.forEach((entry) => {
              if (entry.isVoided) return;
              if (milestoneKey === "POISON_PILL" && (entry.onboardingToken.active || entry.loyaltyToken.active)) return;
              if (milestoneKey === "HOSTILE_BUYOUT" && entry.loyaltyToken.active) return;
              candidates.push({ targetPlayerId: rivalId, targetAgentInstanceId: entry.agentInstanceId });
            });
          });
          return candidates[0] || {};
        }
        if (milestoneKey === "IRONCLAD_CONTRACT") {
          const candidate = player.roster.find((r) => !r.isVoided && !r.loyaltyToken.active);
          return { targetAgentInstanceId: candidate ? candidate.agentInstanceId : null };
        }
        if (milestoneKey === "SIGNAL_JAMMER") {
          const realSpaces = state.board.actionSpaces.filter((s) => s.status !== "blocked");
          const occupiedSpace = realSpaces.find((s) => s.occupiedBy && s.occupiedBy.length > 0);
          const chosen = occupiedSpace || realSpaces[0];
          return { targetSpaceId: chosen ? chosen.spaceId : null };
        }
        if (milestoneKey === "SILICON_VALLEY_SWEEP") {
          const drawn = player.hand.personalDrawPile.slice(0, 4);
          return { keepCatalogId: drawn[0] || null };
        }
        if (milestoneKey === "MASTER_ALGORITHM") {
          const trashInstanceIds = player.hand.actionCards.slice(0, 2).map((c) => c.instanceId);
          return { trashInstanceIds };
        }
        return {};
      }
      function resolveBotInterrupt(state) {
        const interrupt = state.phase.pendingInterrupt;
        if (!interrupt || interrupt.type === "NULL") {
          return { state, action: "NONE", reason: "NO_PENDING_INTERRUPT" };
        }
        const player = state.players[interrupt.sourcePlayerId];
        if (!player || !player.isBot) {
          return { state, action: "NONE", reason: "NOT_A_BOT_INTERRUPT" };
        }
        if (interrupt.type === "ACTION_SPACE_DEFERRED_CHOICE" && interrupt.data && interrupt.data.spaceType === "dual_value_boost") {
          const { trackA, trackB, rationale: rationale2 } = computeDualTrackBotChoice(player);
          const loggedState2 = appendLog(state, {
            type: "BOT_INTERRUPT_DECISION_MADE",
            playerId: interrupt.sourcePlayerId,
            archetype: player.archetype || null,
            interruptType: interrupt.type,
            choiceType: "DUAL_TRACK_CHOICE",
            trackA,
            trackB,
            rationale: rationale2
          });
          const result2 = resolveDualTrackChoice(loggedState2, interrupt.sourcePlayerId, trackA, trackB);
          if (result2.error) {
            return {
              state: appendLog(loggedState2, { type: "BOT_INTERRUPT_RESOLUTION_FAILED", playerId: interrupt.sourcePlayerId, error: result2.error }),
              action: "BOT_INTERRUPT_RESOLUTION_FAILED",
              reason: result2.error
            };
          }
          return { state: result2.state, action: "BOT_INTERRUPT_RESOLVED", reason: null };
        }
        if (interrupt.type === "ACTION_SPACE_DEFERRED_CHOICE" && interrupt.data && interrupt.data.spaceType === "hire_coach") {
          const candidate = player.roster.find((r) => !r.isVoided);
          if (!candidate) {
            return {
              state: { ...state, phase: { ...state.phase, pendingInterrupt: { type: "NULL", sourcePlayerId: null, data: {} } } },
              action: "NONE",
              reason: "NO_ROSTER_AGENT_TO_COACH"
            };
          }
          const loggedState2 = appendLog(state, {
            type: "BOT_INTERRUPT_DECISION_MADE",
            playerId: interrupt.sourcePlayerId,
            archetype: player.archetype || null,
            interruptType: interrupt.type,
            choiceType: "HIRE_COACH",
            targetAgentInstanceId: candidate.agentInstanceId,
            rationale: "FIRST_REAL_ROSTER_AGENT"
          });
          const result2 = resolveHireCoachChoice(loggedState2, interrupt.sourcePlayerId, candidate.agentInstanceId);
          if (result2.error) {
            const cancelResult = cancelDeferredSpaceChoice(loggedState2, interrupt.sourcePlayerId);
            const cancelledState = cancelResult.error ? loggedState2 : cancelResult.state;
            return {
              state: appendLog(cancelledState, { type: "BOT_INTERRUPT_RESOLUTION_FAILED", playerId: interrupt.sourcePlayerId, error: result2.error }),
              action: "BOT_INTERRUPT_RESOLUTION_FAILED",
              reason: result2.error
            };
          }
          return { state: result2.state, action: "BOT_INTERRUPT_RESOLVED", reason: null };
        }
        if (interrupt.type === "ACTION_SPACE_DEFERRED_CHOICE" && interrupt.data && interrupt.data.spaceId === "EXEC_CLEAR_OPEN_MARKET" && !interrupt.data.stage) {
          const choice = "wipe_action_and_take_free";
          const loggedState2 = appendLog(state, {
            type: "BOT_INTERRUPT_DECISION_MADE",
            playerId: interrupt.sourcePlayerId,
            archetype: player.archetype || null,
            interruptType: interrupt.type,
            choiceType: "EXEC_CLEAR_OPEN_MARKET",
            choice,
            rationale: "PREFER_SELF_BENEFITING_OPTION"
          });
          const clearResult = resolveClearOpenMarketChoice(loggedState2, interrupt.sourcePlayerId, choice);
          if (clearResult.error) {
            return {
              state: appendLog(loggedState2, { type: "BOT_INTERRUPT_RESOLUTION_FAILED", playerId: interrupt.sourcePlayerId, error: clearResult.error }),
              action: "BOT_INTERRUPT_RESOLUTION_FAILED",
              reason: clearResult.error
            };
          }
          return { state: clearResult.state, action: "BOT_INTERRUPT_RESOLVED", reason: null };
        }
        if (interrupt.type === "ACTION_SPACE_DEFERRED_CHOICE" && interrupt.data && interrupt.data.spaceId === "EXEC_CLEAR_OPEN_MARKET" && interrupt.data.stage === "pick_free_card") {
          const freshRow = (state.board.openMarketActionCards || []).filter((c) => c && c.catalogId);
          const catalog = state.cardCatalog && state.cardCatalog.actionCards || {};
          const sorted = [...freshRow].sort((a, b) => (catalog[a.catalogId] ? catalog[a.catalogId].cost : 0) - (catalog[b.catalogId] ? catalog[b.catalogId].cost : 0));
          const pickedCatalogId = sorted[0] ? sorted[0].catalogId : null;
          if (!pickedCatalogId) {
            return {
              state: { ...state, phase: { ...state.phase, pendingInterrupt: { type: "NULL", sourcePlayerId: null, data: {} } } },
              action: "NONE",
              reason: "OPEN_MARKET_EMPTY"
            };
          }
          const loggedState3 = appendLog(state, {
            type: "BOT_INTERRUPT_DECISION_MADE",
            playerId: interrupt.sourcePlayerId,
            archetype: player.archetype || null,
            interruptType: interrupt.type,
            choiceType: "EXEC_CLEAR_OPEN_MARKET_FREE_CARD_PICK",
            pickedCatalogId,
            rationale: "CHEAPEST_REAL_CANDIDATE"
          });
          const pickResult = resolveClearOpenMarketFreeCardPick(loggedState3, interrupt.sourcePlayerId, pickedCatalogId);
          if (pickResult.error) {
            return {
              state: appendLog(loggedState3, { type: "BOT_INTERRUPT_RESOLUTION_FAILED", playerId: interrupt.sourcePlayerId, error: pickResult.error }),
              action: "BOT_INTERRUPT_RESOLUTION_FAILED",
              reason: pickResult.error
            };
          }
          return { state: pickResult.state, action: "BOT_INTERRUPT_RESOLVED", reason: null };
        }
        if (interrupt.type === "ACTION_CARD_EFFECT_CHOICE" && interrupt.data && interrupt.data.isSpecialistCardChoice && interrupt.data.choiceType === "SPEC3_HUB_TARGET") {
          const availableHubs = interrupt.data.availableHubs || [];
          const spacesByHub = {};
          (state.board.actionSpaces || []).forEach((s) => {
            if (!spacesByHub[s.hub]) spacesByHub[s.hub] = [];
            if (s.status !== "blocked" && s.status !== "void") spacesByHub[s.hub].push(s);
          });
          let chosenHub = availableHubs[0] || null;
          let bestCount = -1;
          availableHubs.forEach((hub) => {
            const count = (spacesByHub[hub] || []).length;
            if (count > bestCount) {
              bestCount = count;
              chosenHub = hub;
            }
          });
          const loggedState2 = appendLog(state, {
            type: "BOT_INTERRUPT_DECISION_MADE",
            playerId: interrupt.sourcePlayerId,
            archetype: player.archetype || null,
            interruptType: interrupt.type,
            choiceType: "SPEC3_HUB_TARGET",
            chosenHub,
            rationale: "MOST_DISRUPTIVE_HUB_DEFAULT"
          });
          const result2 = resolveSpecialistCardEffectChoice(loggedState2, interrupt.sourcePlayerId, { targetHub: chosenHub });
          if (result2.error) {
            return {
              state: appendLog(loggedState2, { type: "BOT_INTERRUPT_RESOLUTION_FAILED", playerId: interrupt.sourcePlayerId, error: result2.error }),
              action: "BOT_INTERRUPT_RESOLUTION_FAILED",
              reason: result2.error
            };
          }
          return { state: result2.state, action: "BOT_INTERRUPT_RESOLVED", reason: null };
        }
        if (interrupt.type === "ACTION_CARD_EFFECT_CHOICE") {
          const { choiceType } = interrupt.data;
          const options = computeBotStartCardChoice(state, interrupt.sourcePlayerId, choiceType, interrupt.data);
          const loggedState2 = appendLog(state, {
            type: "BOT_INTERRUPT_DECISION_MADE",
            playerId: interrupt.sourcePlayerId,
            archetype: player.archetype || null,
            interruptType: interrupt.type,
            choiceType,
            options,
            rationale: "START_CARD_DEFAULT_POLICY"
          });
          const result2 = resolveActionCardEffectChoice(loggedState2, interrupt.sourcePlayerId, options);
          if (result2.error) {
            return {
              state: appendLog(loggedState2, { type: "BOT_INTERRUPT_RESOLUTION_FAILED", playerId: interrupt.sourcePlayerId, error: result2.error }),
              action: "BOT_INTERRUPT_RESOLUTION_FAILED",
              reason: result2.error
            };
          }
          return { state: result2.state, action: "BOT_INTERRUPT_RESOLVED", reason: null };
        }
        if (interrupt.type === "TRACK_BRANCH_CHOICE") {
          const { trackName } = interrupt.data;
          const chosenBranch = player.archetype === "Aggressive" ? "A" : "B";
          const loggedState2 = appendLog(state, {
            type: "BOT_INTERRUPT_DECISION_MADE",
            playerId: interrupt.sourcePlayerId,
            archetype: player.archetype || null,
            interruptType: interrupt.type,
            choiceType: "TRACK_BRANCH_CHOICE",
            trackName,
            chosenBranch,
            rationale: "ARCHETYPE_DEFAULT"
          });
          const result2 = resolveTrackBranchChoice(loggedState2, interrupt.sourcePlayerId, trackName, chosenBranch);
          if (result2.error) {
            return {
              state: appendLog(loggedState2, { type: "BOT_INTERRUPT_RESOLUTION_FAILED", playerId: interrupt.sourcePlayerId, error: result2.error }),
              action: "BOT_INTERRUPT_RESOLUTION_FAILED",
              reason: result2.error
            };
          }
          return { state: result2.state, action: "BOT_INTERRUPT_RESOLVED", reason: null };
        }
        if (interrupt.type === "TRACK_MILESTONE_CHOICE") {
          const { milestoneKey } = interrupt.data;
          const options = computeBotMilestoneChoice(state, interrupt.sourcePlayerId, milestoneKey);
          const loggedState2 = appendLog(state, {
            type: "BOT_INTERRUPT_DECISION_MADE",
            playerId: interrupt.sourcePlayerId,
            archetype: player.archetype || null,
            interruptType: interrupt.type,
            choiceType: "TRACK_MILESTONE_CHOICE",
            milestoneKey,
            options,
            rationale: "FIRST_LEGAL_OPTION_OR_FORFEIT"
          });
          const result2 = resolveTargetedMilestone(loggedState2, interrupt.sourcePlayerId, options);
          if (result2.error) {
            const clearedState = {
              ...loggedState2,
              phase: { ...loggedState2.phase, pendingInterrupt: { type: "NULL", sourcePlayerId: null, data: {} } }
            };
            return {
              state: appendLog(clearedState, {
                type: "TRACK_MILESTONE_FORFEITED",
                playerId: interrupt.sourcePlayerId,
                milestoneKey,
                reason: result2.error
              }),
              action: "TRACK_MILESTONE_FORFEITED",
              reason: result2.error
            };
          }
          return { state: result2.state, action: "BOT_INTERRUPT_RESOLVED", reason: null };
        }
        if (interrupt.type === "ACTION_SPACE_DEFERRED_CHOICE" && interrupt.data && interrupt.data.spaceType === "draft_open_market_agent") {
          if (interrupt.data.spaceId === "GRW_RECRUIT_AGENT") {
            const chosenCatalogId = evaluateRecruitCandidates(state, interrupt.sourcePlayerId);
            if (!chosenCatalogId) {
              const cancelResult = cancelDeferredSpaceChoice(state, interrupt.sourcePlayerId);
              const cancelledState = cancelResult.error ? state : cancelResult.state;
              return { state: appendLog(cancelledState, { type: "BOT_INTERRUPT_NO_CANDIDATE", playerId: interrupt.sourcePlayerId, choiceType: "RECRUIT_AGENT" }), action: "NONE", reason: "NO_BOT_RECRUIT_CANDIDATE" };
            }
            const loggedState2 = appendLog(state, {
              type: "BOT_INTERRUPT_DECISION_MADE",
              playerId: interrupt.sourcePlayerId,
              archetype: player.archetype || null,
              interruptType: interrupt.type,
              choiceType: "RECRUIT_AGENT",
              chosenCatalogId,
              rationale: "HIGHEST_INCOME_ELIGIBLE_CANDIDATE"
            });
            const result2 = resolveRecruitFromGrowthHub(loggedState2, interrupt.sourcePlayerId, chosenCatalogId);
            if (result2.error) {
              return {
                state: appendLog(loggedState2, { type: "BOT_INTERRUPT_RESOLUTION_FAILED", playerId: interrupt.sourcePlayerId, error: result2.error }),
                action: "BOT_INTERRUPT_RESOLUTION_FAILED",
                reason: result2.error
              };
            }
            return { state: result2.state, action: "BOT_INTERRUPT_RESOLVED", reason: null };
          }
          if (interrupt.data.spaceId === "GRW_POACH_AGENT") {
            const chosen = evaluatePoachCandidates(state, interrupt.sourcePlayerId);
            if (!chosen) {
              const cancelResult = cancelDeferredSpaceChoice(state, interrupt.sourcePlayerId);
              const cancelledState = cancelResult.error ? state : cancelResult.state;
              return { state: appendLog(cancelledState, { type: "BOT_INTERRUPT_NO_CANDIDATE", playerId: interrupt.sourcePlayerId, choiceType: "POACH_AGENT" }), action: "NONE", reason: "NO_BOT_POACH_CANDIDATE" };
            }
            const loggedState2 = appendLog(state, {
              type: "BOT_INTERRUPT_DECISION_MADE",
              playerId: interrupt.sourcePlayerId,
              archetype: player.archetype || null,
              interruptType: interrupt.type,
              choiceType: "POACH_AGENT",
              targetPlayerId: chosen.targetPlayerId,
              targetAgentInstanceId: chosen.targetAgentInstanceId,
              rationale: "HIGHEST_INCOME_UNPROTECTED_TARGET"
            });
            const result2 = resolvePoachFromGrowthHub(loggedState2, interrupt.sourcePlayerId, chosen.targetPlayerId, chosen.targetAgentInstanceId);
            if (result2.error) {
              return {
                state: appendLog(loggedState2, { type: "BOT_INTERRUPT_RESOLUTION_FAILED", playerId: interrupt.sourcePlayerId, error: result2.error }),
                action: "BOT_INTERRUPT_RESOLUTION_FAILED",
                reason: result2.error
              };
            }
            return { state: result2.state, action: "BOT_INTERRUPT_RESOLVED", reason: null };
          }
          if (interrupt.data.spaceId === "GRW_LOYALTY_TOKEN") {
            const chosenAgentInstanceId = evaluateLoyaltyCandidates(state, interrupt.sourcePlayerId);
            if (!chosenAgentInstanceId) {
              const cancelResult = cancelDeferredSpaceChoice(state, interrupt.sourcePlayerId);
              const cancelledState = cancelResult.error ? state : cancelResult.state;
              return { state: appendLog(cancelledState, { type: "BOT_INTERRUPT_NO_CANDIDATE", playerId: interrupt.sourcePlayerId, choiceType: "LOYALTY_TOKEN" }), action: "NONE", reason: "NO_BOT_LOYALTY_CANDIDATE" };
            }
            const loggedState2 = appendLog(state, {
              type: "BOT_INTERRUPT_DECISION_MADE",
              playerId: interrupt.sourcePlayerId,
              archetype: player.archetype || null,
              interruptType: interrupt.type,
              choiceType: "LOYALTY_TOKEN",
              chosenAgentInstanceId,
              rationale: "HIGHEST_INCOME_VULNERABLE_QUALIFYING_AGENT"
            });
            const result2 = resolveLoyaltyFromGrowthHub(loggedState2, interrupt.sourcePlayerId, chosenAgentInstanceId, null);
            if (result2.error) {
              return {
                state: appendLog(loggedState2, { type: "BOT_INTERRUPT_RESOLUTION_FAILED", playerId: interrupt.sourcePlayerId, error: result2.error }),
                action: "BOT_INTERRUPT_RESOLUTION_FAILED",
                reason: result2.error
              };
            }
            return { state: result2.state, action: "BOT_INTERRUPT_RESOLVED", reason: null };
          }
        }
        if (interrupt.type === "SHIFT_CARD_RESOLUTION") {
          const stage = interrupt.data && interrupt.data.stage;
          if (stage === "announcement") {
            const result2 = resolveShiftEffectStage2(state, interrupt.sourcePlayerId);
            const loggedState2 = appendLog(result2.error ? state : result2.state, {
              type: "BOT_INTERRUPT_DECISION_MADE",
              playerId: interrupt.sourcePlayerId,
              archetype: player.archetype || null,
              interruptType: interrupt.type,
              choiceType: "SHIFT_CARD_AUTO_RESOLVE_STAGE2",
              rationale: "BOTS_DO_NOT_NEED_TO_PAUSE_FOR_ANNOUNCEMENT"
            });
            if (result2.error) {
              return { state: appendLog(loggedState2, { type: "BOT_INTERRUPT_RESOLUTION_FAILED", playerId: interrupt.sourcePlayerId, error: result2.error }), action: "BOT_INTERRUPT_RESOLUTION_FAILED", reason: result2.error };
            }
            return { state: loggedState2, action: "BOT_INTERRUPT_RESOLVED", reason: null };
          }
          const nextState = { ...state, phase: { ...state.phase, pendingInterrupt: { type: "NULL", sourcePlayerId: null, data: {} } } };
          return {
            state: appendLog(nextState, { type: "BOT_INTERRUPT_DECISION_MADE", playerId: interrupt.sourcePlayerId, archetype: player.archetype || null, interruptType: interrupt.type, choiceType: "SHIFT_CARD_AUTO_ACKNOWLEDGED", rationale: "BOTS_DO_NOT_NEED_TO_PAUSE_FOR_ACKNOWLEDGMENT" }),
            action: "BOT_INTERRUPT_RESOLVED",
            reason: null
          };
        }
        if (interrupt.type === "ACTION_SPACE_DEFERRED_CHOICE" && interrupt.data && interrupt.data.spaceType === "acquire_or_play_action_card") {
          const chosenInstanceId = evaluateActionCardChoice(state, interrupt.sourcePlayerId);
          if (!chosenInstanceId) {
            const drawPile = state.board && state.board.decks && state.board.decks.actionCardDrawPile || [];
            if (drawPile.length === 0) {
              const clearedState = {
                ...state,
                phase: { ...state.phase, pendingInterrupt: { type: "NULL", sourcePlayerId: null, data: {} } }
              };
              return {
                state: appendLog(advanceActivePlayer(clearedState), {
                  type: "BOT_INTERRUPT_ACQUIRE_FALLBACK_SKIPPED",
                  playerId: interrupt.sourcePlayerId,
                  reason: "NO_PLAYABLE_CARD_AND_DECK_EMPTY"
                }),
                action: "NONE",
                reason: "NO_PLAYABLE_CARD_AND_DECK_EMPTY"
              };
            }
            const drawnCatalogId = drawPile[0];
            const remainingDrawPile = drawPile.slice(1);
            const acquiringPlayer = state.players[interrupt.sourcePlayerId];
            const newCard = { instanceId: `ac-${interrupt.sourcePlayerId}-botacquire-r${state.phase.round}`, catalogId: drawnCatalogId };
            let nextState = {
              ...state,
              board: { ...state.board, decks: { ...state.board.decks, actionCardDrawPile: remainingDrawPile } },
              players: {
                ...state.players,
                [interrupt.sourcePlayerId]: { ...acquiringPlayer, hand: { ...acquiringPlayer.hand, actionCards: [...acquiringPlayer.hand.actionCards, newCard] } }
              },
              phase: { ...state.phase, pendingInterrupt: { type: "NULL", sourcePlayerId: null, data: {} } }
            };
            nextState = advanceActivePlayer(nextState);
            return {
              state: appendLog(nextState, {
                type: "BOT_INTERRUPT_DECISION_MADE",
                playerId: interrupt.sourcePlayerId,
                archetype: player.archetype || null,
                interruptType: interrupt.type,
                choiceType: "ACQUIRE_ACTION_CARD_FALLBACK",
                acquiredCatalogId: drawnCatalogId,
                rationale: "NO_PLAYABLE_CARD_FALL_BACK_TO_ACQUIRE"
              }),
              action: "BOT_INTERRUPT_RESOLVED",
              reason: null
            };
          }
          const chosenEntry = player.hand.actionCards.find((c) => c.instanceId === chosenInstanceId);
          const loggedState2 = appendLog(state, {
            type: "BOT_INTERRUPT_DECISION_MADE",
            playerId: interrupt.sourcePlayerId,
            archetype: player.archetype || null,
            interruptType: interrupt.type,
            choiceType: "PLAY_ACTION_CARD",
            chosenCatalogId: chosenEntry ? chosenEntry.catalogId : null,
            rationale: player.archetype === "Aggressive" ? "PREFERRED_TARGETED_CARD_OR_CHEAPEST" : "CHEAPEST_AFFORDABLE_CARD"
          });
          const result2 = playActionCard(loggedState2, interrupt.sourcePlayerId, chosenInstanceId);
          if (result2.error) {
            const failedState = appendLog(loggedState2, { type: "BOT_INTERRUPT_RESOLUTION_FAILED", playerId: interrupt.sourcePlayerId, error: result2.error });
            const drawPile = failedState.board && failedState.board.decks && failedState.board.decks.actionCardDrawPile || [];
            if (drawPile.length === 0) {
              const clearedState = { ...failedState, phase: { ...failedState.phase, pendingInterrupt: { type: "NULL", sourcePlayerId: null, data: {} } } };
              return { state: advanceActivePlayer(clearedState), action: "BOT_INTERRUPT_RESOLUTION_FAILED", reason: result2.error };
            }
            const drawnCatalogId = drawPile[0];
            const remainingDrawPile = drawPile.slice(1);
            const acquiringPlayer = failedState.players[interrupt.sourcePlayerId];
            const newCard = { instanceId: `ac-${interrupt.sourcePlayerId}-botacquirefallback-r${failedState.phase.round}`, catalogId: drawnCatalogId };
            let nextState = {
              ...failedState,
              board: { ...failedState.board, decks: { ...failedState.board.decks, actionCardDrawPile: remainingDrawPile } },
              players: {
                ...failedState.players,
                [interrupt.sourcePlayerId]: { ...acquiringPlayer, hand: { ...acquiringPlayer.hand, actionCards: [...acquiringPlayer.hand.actionCards, newCard] } }
              },
              phase: { ...failedState.phase, pendingInterrupt: { type: "NULL", sourcePlayerId: null, data: {} } }
            };
            nextState = advanceActivePlayer(nextState);
            return { state: nextState, action: "BOT_INTERRUPT_RESOLUTION_FAILED", reason: result2.error };
          }
          return { state: result2.state, action: "BOT_INTERRUPT_RESOLVED", reason: null };
        }
        const resolverKey = `${interrupt.type}:${interrupt.data && interrupt.data.choiceType}`;
        const computeChoice = BOT_CHOICE_COMPUTERS[resolverKey];
        if (!computeChoice) {
          return { state, action: "NONE", reason: "NO_BOT_POLICY_FOR_INTERRUPT_TYPE" };
        }
        const { selectedInstanceIds, rationale } = computeChoice(state, player, interrupt);
        const loggedState = appendLog(state, {
          type: "BOT_INTERRUPT_DECISION_MADE",
          playerId: interrupt.sourcePlayerId,
          archetype: player.archetype || null,
          interruptType: interrupt.type,
          choiceType: interrupt.data.choiceType,
          selectedInstanceIds,
          rationale
        });
        const result = handleInterruptResolution(loggedState, interrupt.sourcePlayerId, { selectedInstanceIds });
        if (result.error) {
          return {
            state: appendLog(loggedState, {
              type: "BOT_INTERRUPT_RESOLUTION_FAILED",
              playerId: interrupt.sourcePlayerId,
              error: result.error
            }),
            action: "BOT_INTERRUPT_RESOLUTION_FAILED",
            reason: result.error
          };
        }
        return { state: result.state, action: "BOT_INTERRUPT_RESOLVED", reason: null };
      }
      module.exports = {
        resolveBotInterrupt,
        computeCleanSlateBotSelection
      };
    }
  });

  // gameActionDispatcher.js
  var require_gameActionDispatcher = __commonJS({
    "gameActionDispatcher.js"(exports, module) {
      var { placeMeeple, advanceActivePlayer, IMMEDIATE_SPACE_TYPES } = require_workerPlacementReducer();
      var { verifySpaceOpen, verifyCanAffordSpace } = require_workerPlacementValidation();
      var { submitTurnOrderBid } = require_turnOrderBiddingReducer();
      var { playActionCard } = require_actionCardReducer();
      var { evaluateBotSpecialistDecision } = require_specialistReducer();
      var { resolveBotInterrupt } = require_botInterruptResolver();
      var { getArchetypeWeights, evaluateRecruitCandidates, evaluatePoachCandidates, evaluateLoyaltyCandidates, evaluateActionCardChoice } = require_botDecisionEngine();
      var { hasOpenDesk } = require_agentRecruitmentReducer();
      var { MARKET_SHARE_TRACK_SPACES } = require_boardConfigLoader();
      var OUT_OF_TURN_ACTION_TYPES = /* @__PURE__ */ new Set(["SUBMIT_TURN_ORDER_BID"]);
      function appendLog(state, entry) {
        const logEntry = {
          seq: state.log.length + 1,
          timestamp: (/* @__PURE__ */ new Date()).toISOString(),
          round: state.phase.round,
          ...entry
        };
        return { ...state, log: [...state.log, logEntry] };
      }
      var ACTION_TYPE_TO_REDUCER = {
        PLACE_MEEPLE: (state, actingPlayerId, payload) => {
          const { meepleInstanceId, spaceId, additionalMeepleInstanceIds, useOvertimeManager } = payload || {};
          const extra = additionalMeepleInstanceIds || useOvertimeManager ? { ...additionalMeepleInstanceIds ? { additionalMeepleInstanceIds } : {}, ...useOvertimeManager ? { useOvertimeManager: true } : {} } : null;
          return placeMeeple(state, actingPlayerId, meepleInstanceId, spaceId, extra);
        },
        SUBMIT_TURN_ORDER_BID: (state, actingPlayerId, payload) => submitTurnOrderBid(state, actingPlayerId, { type: "SUBMIT_TURN_ORDER_BID", payload }),
        // PLAY_ACTION_CARD is NOT out-of-turn: it's a RESUME of the acting
        // player's own outstanding TAKE_PLAY_CARD interrupt (see
        // actionCardReducer.js's header), so ordinary turn ownership still
        // applies — the fix in workerPlacementReducer.js (advanceActivePlayer
        // now skips deferred placements) is what keeps activePlayerId correctly
        // pointed at THIS player while they resolve it.
        PLAY_ACTION_CARD: (state, actingPlayerId, payload) => {
          const { cardInstanceId } = payload || {};
          return playActionCard(state, actingPlayerId, cardInstanceId);
        }
      };
      function findFallbackImmediateSpace(state, playerId) {
        const player = state.players[playerId];
        const availableMeeple = player.timeMeeples.active.find((m) => m.status === "in_supply");
        if (!availableMeeple) {
          return null;
        }
        const candidateTypes = IMMEDIATE_SPACE_TYPES.filter((t) => t !== "specialist_action");
        for (const space of state.board.actionSpaces) {
          if (!candidateTypes.includes(space.type)) {
            continue;
          }
          const openCheck = verifySpaceOpen(state, space.spaceId, playerId, null);
          if (!openCheck.ok) {
            continue;
          }
          const affordCheck = verifyCanAffordSpace(state, playerId, openCheck.space);
          if (!affordCheck.ok) {
            continue;
          }
          return { space: openCheck.space, meepleInstanceId: availableMeeple.instanceId };
        }
        return null;
      }
      function findAgentActionFallback(state, playerId, spaceId, evaluator) {
        const player = state.players[playerId];
        const availableMeeple = player.timeMeeples.active.find((m) => m.status === "in_supply");
        if (!availableMeeple) {
          return null;
        }
        const space = state.board.actionSpaces.find((s) => s.spaceId === spaceId);
        if (!space) {
          return null;
        }
        const openCheck = verifySpaceOpen(state, space.spaceId, playerId, null);
        if (!openCheck.ok) {
          return null;
        }
        const affordCheck = verifyCanAffordSpace(state, playerId, openCheck.space);
        if (!affordCheck.ok) {
          return null;
        }
        if (!evaluator(state, playerId)) {
          return null;
        }
        return { space: openCheck.space, meepleInstanceId: availableMeeple.instanceId };
      }
      function triggerBotTurnIfActive(state) {
        const existingInterrupt = state.phase.pendingInterrupt;
        if (existingInterrupt && existingInterrupt.type !== "NULL") {
          const interruptOwner = state.players[existingInterrupt.sourcePlayerId];
          if (interruptOwner && interruptOwner.isBot) {
            return resolveBotInterrupt(state);
          }
          return { state, action: "NONE", reason: "PENDING_INTERRUPT_NOT_BOT_OWNED" };
        }
        if (state.phase.current !== "WORKER_PLACEMENT") {
          return { state, action: "NONE", reason: "WRONG_PHASE" };
        }
        const activePlayerId = state.phase.activePlayerId;
        const player = state.players[activePlayerId];
        if (!player || !player.isBot) {
          return { state, action: "NONE", reason: "NOT_A_BOT" };
        }
        const specialistResult = evaluateBotSpecialistDecision(state, activePlayerId);
        if (specialistResult.decision === "CLAIMED" && specialistResult.error === null) {
          const postClaimInterrupt = specialistResult.state.phase.pendingInterrupt;
          const claimLeftAnInterruptForThisBot = postClaimInterrupt && postClaimInterrupt.type !== "NULL" && postClaimInterrupt.sourcePlayerId === activePlayerId;
          if (claimLeftAnInterruptForThisBot) {
            const resumed = resolveBotInterrupt(specialistResult.state);
            return { state: resumed.state, action: "SPECIALIST_CLAIMED_AND_INTERRUPT_RESOLVED", reason: null };
          }
          return { state: specialistResult.state, action: "SPECIALIST_CLAIMED", reason: null };
        }
        let nextState = specialistResult.state;
        const weights = getArchetypeWeights(player.archetype);
        const deferredTierAttempts = [
          { key: "poach", weight: weights.poach, spaceId: "GRW_POACH_AGENT", evaluator: evaluatePoachCandidates, actionLabel: "POACH_FALLBACK_PLACEMENT_AND_RESOLVED" },
          { key: "recruit", weight: weights.recruit, spaceId: "GRW_RECRUIT_AGENT", evaluator: evaluateRecruitCandidates, actionLabel: "RECRUIT_FALLBACK_PLACEMENT_AND_RESOLVED" },
          { key: "loyalty", weight: weights.loyalty, spaceId: "GRW_LOYALTY_TOKEN", evaluator: evaluateLoyaltyCandidates, actionLabel: "LOYALTY_FALLBACK_PLACEMENT_AND_RESOLVED" },
          { key: "dualTrack", weight: weights.engineSpaces, spaceId: "OPS_2X_COMBO", evaluator: () => true, actionLabel: "DUAL_TRACK_FALLBACK_PLACEMENT_AND_RESOLVED" },
          { key: "playCard", weight: weights.playCard, spaceId: "EXEC_TAKE_PLAY_CARD", evaluator: evaluateActionCardChoice, actionLabel: "PLAY_CARD_FALLBACK_PLACEMENT_AND_RESOLVED" },
          {
            key: "hireCoach",
            weight: 1,
            spaceId: "LDR_HIRE_COACH",
            evaluator: (s, pid) => s.players[pid].roster.some((r) => !r.isVoided) && s.players[pid].wallet.profitTokens >= 3,
            actionLabel: "HIRE_COACH_FALLBACK_PLACEMENT_AND_RESOLVED"
          },
          {
            key: "marketShareSprint",
            weight: weights.marketShareSprint || 3,
            spaceId: "GRW_MARKET_SHARE_ADVANCE",
            evaluator: (s, pid) => {
              const currentIndex = s.players[pid].tracks.marketShare.position;
              const currentValue = MARKET_SHARE_TRACK_SPACES[currentIndex];
              const nextValue = MARKET_SHARE_TRACK_SPACES[Math.min(currentIndex + 1, MARKET_SHARE_TRACK_SPACES.length - 1)];
              return Object.keys(s.marketShareTrack.bonusStacks).some((milestoneKey) => {
                const milestoneValue = Number(milestoneKey);
                const stack = s.marketShareTrack.bonusStacks[milestoneKey];
                return currentValue < milestoneValue && nextValue >= milestoneValue && stack.claimedBy.length < 2 && !stack.claimedBy.includes(pid);
              });
            },
            actionLabel: "MARKET_SHARE_SPRINT_FALLBACK_PLACEMENT_AND_RESOLVED"
          }
        ].sort((a, b) => b.weight - a.weight);
        for (const attempt of deferredTierAttempts) {
          const deferredFallback = findAgentActionFallback(nextState, activePlayerId, attempt.spaceId, attempt.evaluator);
          if (!deferredFallback) continue;
          const deferredPlacement = placeMeeple(nextState, activePlayerId, deferredFallback.meepleInstanceId, deferredFallback.space.spaceId);
          if (deferredPlacement.error === null && deferredPlacement.deferred) {
            const resumed = resolveBotInterrupt(deferredPlacement.state);
            return { state: resumed.state, action: attempt.actionLabel, reason: null };
          }
          if (deferredPlacement.error === null && !deferredPlacement.deferred) {
            return { state: deferredPlacement.state, action: attempt.actionLabel, reason: null };
          }
          nextState = appendLog(nextState, {
            type: "BOT_TURN_FALLBACK_REJECTED",
            playerId: activePlayerId,
            spaceId: deferredFallback.space.spaceId,
            reason: deferredPlacement.error
          });
        }
        const fallback = findFallbackImmediateSpace(nextState, activePlayerId);
        if (fallback) {
          const placement = placeMeeple(nextState, activePlayerId, fallback.meepleInstanceId, fallback.space.spaceId);
          if (placement.error === null) {
            return { state: placement.state, action: "FALLBACK_PLACEMENT", reason: null };
          }
          nextState = appendLog(nextState, {
            type: "BOT_TURN_FALLBACK_REJECTED",
            playerId: activePlayerId,
            spaceId: fallback.space.spaceId,
            reason: placement.error
          });
        }
        nextState = appendLog(nextState, {
          type: "BOT_TURN_NO_VALID_ACTION",
          playerId: activePlayerId
        });
        nextState = {
          ...nextState,
          phase: {
            ...nextState.phase,
            playersWithMeeplesRemaining: nextState.phase.playersWithMeeplesRemaining.filter(
              (id) => id !== activePlayerId
            )
          }
        };
        nextState = advanceActivePlayer(nextState);
        return { state: nextState, action: "FORCED_PASS", reason: "NO_VALID_ACTION" };
      }
      function dispatchAction(state, action, actingPlayerId) {
        if (!action || typeof action.type !== "string" || action.type.length === 0) {
          return { state, error: "MALFORMED_ACTION", detail: { action } };
        }
        const { type, payload } = action;
        if (!state.players[actingPlayerId]) {
          return { state, error: "PLAYER_NOT_FOUND", detail: { actingPlayerId } };
        }
        const isOutOfTurnAllowed = OUT_OF_TURN_ACTION_TYPES.has(type);
        if (!isOutOfTurnAllowed && state.phase.activePlayerId !== actingPlayerId) {
          return {
            state,
            error: "NOT_YOUR_TURN",
            detail: { actingPlayerId, activePlayerId: state.phase.activePlayerId, actionType: type }
          };
        }
        const reducer = ACTION_TYPE_TO_REDUCER[type];
        if (!reducer) {
          return { state, error: "UNKNOWN_ACTION_TYPE", detail: { actionType: type } };
        }
        const result = reducer(state, actingPlayerId, payload || {});
        if (!result || typeof result !== "object" || !("state" in result)) {
          console.warn(`dispatchAction: reducer for action type "${type}" returned a malformed result`, result);
          return { state, error: "REDUCER_CONTRACT_VIOLATION", detail: { actionType: type } };
        }
        return result;
      }
      module.exports = {
        dispatchAction,
        triggerBotTurnIfActive,
        OUT_OF_TURN_ACTION_TYPES,
        ACTION_TYPE_TO_REDUCER
      };
    }
  });

  // specialistRevealReducer.js
  var require_specialistRevealReducer = __commonJS({
    "specialistRevealReducer.js"(exports, module) {
      function appendLog(state, entry) {
        const logEntry = {
          seq: state.log.length + 1,
          timestamp: (/* @__PURE__ */ new Date()).toISOString(),
          round: state.phase.round,
          ...entry
        };
        return { ...state, log: [...state.log, logEntry] };
      }
      function revealNextSpecialist(state) {
        if (state.phase.current !== "SPECIALIST_REVEAL") {
          return state;
        }
        let nextState = state;
        const specialistDeck = nextState.specialistDeck || { drawPile: [], discardPile: [], activeCard: null };
        const outgoingCard = specialistDeck.activeCard;
        let updatedDiscardPile = specialistDeck.discardPile || [];
        if (outgoingCard && outgoingCard.catalogId) {
          if (!outgoingCard.claimedByPlayerId) {
            updatedDiscardPile = [...updatedDiscardPile, outgoingCard.catalogId];
            nextState = appendLog(nextState, {
              type: "SPECIALIST_CARD_DISCARDED_UNCLAIMED",
              catalogId: outgoingCard.catalogId,
              revealedRound: outgoingCard.revealedRound
            });
          } else {
            nextState = appendLog(nextState, {
              type: "SPECIALIST_CARD_RETAINED",
              catalogId: outgoingCard.catalogId,
              claimedByPlayerId: outgoingCard.claimedByPlayerId,
              revealedRound: outgoingCard.revealedRound
            });
          }
        }
        const drawPile = specialistDeck.drawPile || [];
        const nextCatalogId = drawPile.length > 0 ? drawPile[0] : null;
        const remainingDrawPile = drawPile.slice(1);
        let newActiveCard = null;
        if (nextCatalogId) {
          newActiveCard = {
            catalogId: nextCatalogId,
            revealedRound: nextState.phase.round,
            claimedByPlayerId: null,
            cubeState: "unused",
            cubeLocation: null
          };
          nextState = appendLog(nextState, {
            type: "SPECIALIST_CARD_REVEALED",
            catalogId: nextCatalogId,
            revealedRound: nextState.phase.round
          });
          if (remainingDrawPile.length === 0) {
            nextState = appendLog(nextState, {
              type: "SPECIALIST_DECK_FINAL_CARD_REVEALED",
              catalogId: nextCatalogId,
              revealedRound: nextState.phase.round
            });
          }
        } else {
          nextState = appendLog(nextState, {
            type: "SPECIALIST_DECK_EXHAUSTED",
            round: nextState.phase.round
          });
        }
        nextState = {
          ...nextState,
          specialistDeck: {
            ...specialistDeck,
            drawPile: remainingDrawPile,
            discardPile: updatedDiscardPile,
            activeCard: newActiveCard
          }
        };
        nextState = {
          ...nextState,
          phase: { ...nextState.phase, current: "WORKER_PLACEMENT" }
        };
        return nextState;
      }
      module.exports = {
        revealNextSpecialist
      };
    }
  });

  // gameLoopController.js
  var require_gameLoopController = __commonJS({
    "gameLoopController.js"(exports, module) {
      var {
        getUiViewModel,
        buildPlaceMeepleActionPayload,
        buildPlayActionCardPayload,
        buildAcquireActionCardPayload,
        buildRecruitAgentPayload,
        buildPoachAgentPayload,
        buildPlaceLoyaltyTokenPayload,
        buildCrmUpdateChoicePayload,
        buildInterruptResponsePayload
      } = require_uiStateBridge();
      var { renderGameBoard } = require_gameBoardRenderer();
      var { renderPlayerDashboard } = require_playerDashboardRenderer();
      var { renderInterruptOverlay } = require_interruptOverlayRenderer();
      var { dispatchAction, triggerBotTurnIfActive } = require_gameActionDispatcher();
      var { cancelDeferredSpaceChoice, resolveDualTrackChoice, resolveHireCoachChoice, resolveClearOpenMarketChoice, resolveClearOpenMarketFreeCardPick, executeFreeBoardAction, useExecutiveOverdrive, useAutomationEngineer } = require_workerPlacementReducer();
      var { resolveShellCompanySecondRecruit } = require_specialistCards();
      var { resolveTrackBranchChoice, resolveTargetedMilestone, forfeitTargetedMilestone, useProprietaryAlgorithm, useLiquidationEngine } = require_techTrackReducer();
      var { resolveDeficitTrackChoice } = require_cardEffectHelpers();
      var { resolveShiftEffectStage2, acknowledgeShiftCardResolution } = require_shiftReducer();
      var { playActionCardTransactional, resolveActionCardEffectChoice, resolveSpecialistCardEffectChoice } = require_actionCardReducer();
      var { acquireActionCard } = require_openMarketActionCardReducer();
      var {
        resolveRecruitFromGrowthHub,
        resolvePoachFromGrowthHub,
        resolveLoyaltyFromGrowthHub,
        resolveCrmUpdateChoice,
        deployBankedBonusToken
      } = require_agentRecruitmentReducer();
      var { handleInterruptResolution } = require_interruptResolutionReducer();
      var { runEndOfRoundSequence, runPreBiddingSequence } = require_endOfRoundReducer();
      var { acknowledgeShiftCardResolution, resolveShiftEffectStage2 } = require_shiftReducer();
      var { submitTurnOrderBid } = require_turnOrderBiddingReducer();
      var { evaluateTurnOrderBid } = require_botDecisionEngine();
      var { revealNextSpecialist } = require_specialistRevealReducer();
      var DEFAULT_MAX_SETTLE_ITERATIONS = 500;
      function dispatchHumanAction(state, userIntent) {
        if (!userIntent || typeof userIntent.type !== "string") {
          return { state, error: "MALFORMED_USER_INTENT", detail: null };
        }
        switch (userIntent.type) {
          case "SUBMIT_TURN_ORDER_BID": {
            if (typeof userIntent.playerId !== "string" || userIntent.playerId.length === 0) {
              return { state, error: "INVALID_PLAYER_ID", detail: null };
            }
            const result = dispatchAction(
              state,
              { type: "SUBMIT_TURN_ORDER_BID", payload: { profitTokensBid: userIntent.profitTokensBid, priorityTokensBid: userIntent.priorityTokensBid } },
              userIntent.playerId
            );
            return { state: result.state, error: result.error, detail: result.detail };
          }
          case "PLACE_MEEPLE": {
            const payload = buildPlaceMeepleActionPayload(
              userIntent.meepleInstanceId,
              userIntent.spaceId,
              userIntent.additionalMeepleInstanceIds,
              userIntent.useOvertimeManager
            );
            if (!payload.ok) {
              return { state, error: payload.error, detail: null };
            }
            const result = dispatchAction(state, payload.action, userIntent.playerId);
            return { state: result.state, error: result.error, detail: result.detail };
          }
          case "PLAY_ACTION_CARD": {
            const payload = buildPlayActionCardPayload(userIntent.playerId, userIntent.cardInstanceId);
            if (!payload.ok) {
              return { state, error: payload.error, detail: null };
            }
            const result = playActionCardTransactional(state, payload.playerId, payload.cardInstanceId);
            return { state: result.state, error: result.error, detail: result.detail };
          }
          case "ACQUIRE_ACTION_CARD": {
            const payload = buildAcquireActionCardPayload(userIntent.playerId, userIntent.marketCatalogId);
            if (!payload.ok) {
              return { state, error: payload.error, detail: null };
            }
            const result = acquireActionCard(state, payload.playerId, payload.marketCatalogId);
            return { state: result.state, error: result.error, detail: result.detail };
          }
          case "RECRUIT_AGENT": {
            const payload = buildRecruitAgentPayload(userIntent.playerId, userIntent.agentCatalogId);
            if (!payload.ok) {
              return { state, error: payload.error, detail: null };
            }
            const result = resolveRecruitFromGrowthHub(state, payload.playerId, payload.agentCatalogId);
            return { state: result.state, error: result.error, detail: result.detail };
          }
          case "POACH_AGENT": {
            const payload = buildPoachAgentPayload(userIntent.playerId, userIntent.targetPlayerId, userIntent.targetAgentInstanceId);
            if (!payload.ok) {
              return { state, error: payload.error, detail: null };
            }
            const result = resolvePoachFromGrowthHub(state, payload.playerId, payload.targetPlayerId, payload.targetAgentInstanceId);
            return { state: result.state, error: result.error, detail: result.detail };
          }
          case "PLACE_LOYALTY_TOKEN": {
            const payload = buildPlaceLoyaltyTokenPayload(userIntent.playerId, userIntent.agentInstanceId, userIntent.fromAgentInstanceId);
            if (!payload.ok) {
              return { state, error: payload.error, detail: null };
            }
            const result = resolveLoyaltyFromGrowthHub(state, payload.playerId, payload.agentInstanceId, payload.fromAgentInstanceId);
            return { state: result.state, error: result.error, detail: result.detail };
          }
          case "CANCEL_DEFERRED_ACTION": {
            if (typeof userIntent.playerId !== "string" || userIntent.playerId.length === 0) {
              return { state, error: "INVALID_PLAYER_ID", detail: null };
            }
            const result = cancelDeferredSpaceChoice(state, userIntent.playerId);
            return { state: result.state, error: result.error, detail: result.detail };
          }
          // v=49: wires SPEC_9 (Executive Overdrive) and SPEC_7 (Automation
          // Engineer)'s consuming abilities — both engine functions already
          // existed and were correct, but neither had a dispatch case, so
          // there was no way for a player to ever actually trigger them.
          case "USE_EXECUTIVE_OVERDRIVE": {
            if (typeof userIntent.playerId !== "string" || userIntent.playerId.length === 0) {
              return { state, error: "INVALID_PLAYER_ID", detail: null };
            }
            if (typeof userIntent.spaceId !== "string" || userIntent.spaceId.length === 0) {
              return { state, error: "INVALID_SPACE_ID", detail: null };
            }
            const result = useExecutiveOverdrive(state, userIntent.playerId, userIntent.spaceId);
            return { state: result.state, error: result.error, detail: result.detail };
          }
          case "USE_AUTOMATION_ENGINEER": {
            if (typeof userIntent.playerId !== "string" || userIntent.playerId.length === 0) {
              return { state, error: "INVALID_PLAYER_ID", detail: null };
            }
            const result = useAutomationEngineer(state, userIntent.playerId);
            return { state: result.state, error: result.error, detail: result.detail };
          }
          case "RESOLVE_DUAL_TRACK_CHOICE": {
            if (typeof userIntent.playerId !== "string" || userIntent.playerId.length === 0) {
              return { state, error: "INVALID_PLAYER_ID", detail: null };
            }
            if (typeof userIntent.trackA !== "string" || typeof userIntent.trackB !== "string") {
              return { state, error: "INVALID_TRACK_NAME", detail: null };
            }
            const result = resolveDualTrackChoice(state, userIntent.playerId, userIntent.trackA, userIntent.trackB);
            return { state: result.state, error: result.error, detail: result.detail };
          }
          case "RESOLVE_TRACK_BRANCH_CHOICE": {
            if (typeof userIntent.playerId !== "string" || userIntent.playerId.length === 0) {
              return { state, error: "INVALID_PLAYER_ID", detail: null };
            }
            if (typeof userIntent.trackName !== "string" || typeof userIntent.chosenBranch !== "string") {
              return { state, error: "INVALID_BRANCH_CHOICE_PARAMS", detail: null };
            }
            const result = resolveTrackBranchChoice(state, userIntent.playerId, userIntent.trackName, userIntent.chosenBranch);
            return { state: result.state, error: result.error, detail: result.detail };
          }
          case "ACKNOWLEDGE_SHIFT_CARD": {
            if (typeof userIntent.playerId !== "string" || userIntent.playerId.length === 0) {
              return { state, error: "INVALID_PLAYER_ID", detail: null };
            }
            const result = acknowledgeShiftCardResolution(state, userIntent.playerId);
            return { state: result.state, error: result.error, detail: result.detail };
          }
          case "RESOLVE_SHIFT_EFFECT": {
            if (typeof userIntent.playerId !== "string" || userIntent.playerId.length === 0) {
              return { state, error: "INVALID_PLAYER_ID", detail: null };
            }
            const result = resolveShiftEffectStage2(state, userIntent.playerId);
            return { state: result.state, error: result.error, detail: result.detail };
          }
          case "USE_LIQUIDITY_STAFF_PT": {
            if (typeof userIntent.playerId !== "string" || userIntent.playerId.length === 0) {
              return { state, error: "INVALID_PLAYER_ID", detail: null };
            }
            if (typeof userIntent.spaceId !== "string" || userIntent.spaceId.length === 0) {
              return { state, error: "INVALID_SPACE_ID", detail: null };
            }
            const lpPlayer = state.players[userIntent.playerId];
            if (!lpPlayer || !(lpPlayer.liquidityStaffPT > 0)) {
              return { state, error: "NO_LIQUIDITY_STAFF_PT", detail: null };
            }
            if (lpPlayer.liquidityStaffPTUsableRound !== state.phase.round) {
              return { state, error: "LIQUIDITY_STAFF_PT_NOT_USABLE_THIS_ROUND", detail: { usableRound: lpPlayer.liquidityStaffPTUsableRound, currentRound: state.phase.round } };
            }
            const lpResult = executeFreeBoardAction(state, userIntent.playerId, userIntent.spaceId);
            if (lpResult.error) {
              return { state, error: lpResult.error, detail: lpResult.detail };
            }
            const nextStateLp = {
              ...lpResult.state,
              players: {
                ...lpResult.state.players,
                [userIntent.playerId]: {
                  ...lpResult.state.players[userIntent.playerId],
                  liquidityStaffPT: lpResult.state.players[userIntent.playerId].liquidityStaffPT - 1
                }
              }
            };
            return { state: nextStateLp, error: null, detail: null };
          }
          case "USE_PROPRIETARY_ALGORITHM": {
            if (typeof userIntent.playerId !== "string" || userIntent.playerId.length === 0) {
              return { state, error: "INVALID_PLAYER_ID", detail: null };
            }
            const result = useProprietaryAlgorithm(state, userIntent.playerId, userIntent.mode, userIntent.cardInstanceId);
            return { state: result.state, error: result.error, detail: result.detail };
          }
          case "USE_LIQUIDATION_ENGINE": {
            if (typeof userIntent.playerId !== "string" || userIntent.playerId.length === 0) {
              return { state, error: "INVALID_PLAYER_ID", detail: null };
            }
            const result = useLiquidationEngine(state, userIntent.playerId, userIntent.targetAgentInstanceId);
            return { state: result.state, error: result.error, detail: result.detail };
          }
          case "RESOLVE_TRACK_MILESTONE_CHOICE": {
            if (typeof userIntent.playerId !== "string" || userIntent.playerId.length === 0) {
              return { state, error: "INVALID_PLAYER_ID", detail: null };
            }
            const result = resolveTargetedMilestone(state, userIntent.playerId, userIntent.options || {});
            return { state: result.state, error: result.error, detail: result.detail };
          }
          case "FORFEIT_TRACK_MILESTONE": {
            if (typeof userIntent.playerId !== "string" || userIntent.playerId.length === 0) {
              return { state, error: "INVALID_PLAYER_ID", detail: null };
            }
            const result = forfeitTargetedMilestone(state, userIntent.playerId);
            return { state: result.state, error: result.error, detail: result.detail };
          }
          case "DEPLOY_BANKED_BONUS_TOKEN": {
            if (typeof userIntent.playerId !== "string" || userIntent.playerId.length === 0) {
              return { state, error: "INVALID_PLAYER_ID", detail: null };
            }
            if (typeof userIntent.tokenType !== "string" || userIntent.tokenType.length === 0) {
              return { state, error: "INVALID_TOKEN_TYPE", detail: null };
            }
            if (state.phase.current !== "WORKER_PLACEMENT" || state.phase.activePlayerId !== userIntent.playerId) {
              return { state, error: "NOT_YOUR_ACTIVE_TURN", detail: { phase: state.phase.current, activePlayerId: state.phase.activePlayerId } };
            }
            const result = deployBankedBonusToken(state, userIntent.playerId, userIntent.tokenType, userIntent.options || {});
            return { state: result.state, error: result.error, detail: result.detail };
          }
          case "EXECUTE_FREE_ACTION_SPACE": {
            if (typeof userIntent.playerId !== "string" || userIntent.playerId.length === 0) {
              return { state, error: "INVALID_PLAYER_ID", detail: null };
            }
            if (typeof userIntent.spaceId !== "string" || userIntent.spaceId.length === 0) {
              return { state, error: "INVALID_SPACE_ID", detail: null };
            }
            if (state.phase.current !== "WORKER_PLACEMENT" || state.phase.activePlayerId !== userIntent.playerId) {
              return { state, error: "NOT_YOUR_ACTIVE_TURN", detail: { phase: state.phase.current, activePlayerId: state.phase.activePlayerId } };
            }
            const player = state.players[userIntent.playerId];
            if (!player || !(player.bankedBonusTokens || []).includes("FREE_ACTION")) {
              return { state, error: "TOKEN_NOT_BANKED", detail: { tokenType: "FREE_ACTION" } };
            }
            const actionResult = executeFreeBoardAction(state, userIntent.playerId, userIntent.spaceId);
            if (actionResult.error) {
              return { state, error: actionResult.error, detail: actionResult.detail };
            }
            const tokenIndex = player.bankedBonusTokens.indexOf("FREE_ACTION");
            const nextState = {
              ...actionResult.state,
              players: {
                ...actionResult.state.players,
                [userIntent.playerId]: {
                  ...actionResult.state.players[userIntent.playerId],
                  bankedBonusTokens: actionResult.state.players[userIntent.playerId].bankedBonusTokens.filter((_, i) => i !== tokenIndex)
                }
              }
            };
            return { state: nextState, error: null, detail: null };
          }
          case "RESOLVE_HIRE_COACH_CHOICE": {
            if (typeof userIntent.playerId !== "string" || userIntent.playerId.length === 0) {
              return { state, error: "INVALID_PLAYER_ID", detail: null };
            }
            if (userIntent.targetAgentInstanceId !== null && (typeof userIntent.targetAgentInstanceId !== "string" || userIntent.targetAgentInstanceId.length === 0)) {
              return { state, error: "INVALID_TARGET_AGENT_INSTANCE_ID", detail: null };
            }
            const result = resolveHireCoachChoice(state, userIntent.playerId, userIntent.targetAgentInstanceId);
            return { state: result.state, error: result.error, detail: result.detail };
          }
          case "RESOLVE_CLEAR_OPEN_MARKET_CHOICE": {
            if (typeof userIntent.playerId !== "string" || userIntent.playerId.length === 0) {
              return { state, error: "INVALID_PLAYER_ID", detail: null };
            }
            if (userIntent.choice !== "wipe_both" && userIntent.choice !== "wipe_action_and_take_free" && userIntent.choice !== "wipe_agent_and_take_free_action") {
              return { state, error: "INVALID_CLEAR_OPEN_MARKET_CHOICE", detail: null };
            }
            const result = resolveClearOpenMarketChoice(state, userIntent.playerId, userIntent.choice);
            return { state: result.state, error: result.error, detail: result.detail };
          }
          case "RESOLVE_CLEAR_OPEN_MARKET_FREE_CARD_PICK": {
            if (typeof userIntent.playerId !== "string" || userIntent.playerId.length === 0) {
              return { state, error: "INVALID_PLAYER_ID", detail: null };
            }
            if (typeof userIntent.pickedCatalogId !== "string" || userIntent.pickedCatalogId.length === 0) {
              return { state, error: "INVALID_PICKED_CATALOG_ID", detail: null };
            }
            const result = resolveClearOpenMarketFreeCardPick(state, userIntent.playerId, userIntent.pickedCatalogId);
            return { state: result.state, error: result.error, detail: result.detail };
          }
          case "RESOLVE_SHELL_COMPANY_SECOND_RECRUIT": {
            if (typeof userIntent.playerId !== "string" || userIntent.playerId.length === 0) {
              return { state, error: "INVALID_PLAYER_ID", detail: null };
            }
            if (typeof userIntent.stashInstanceId !== "string" || userIntent.stashInstanceId.length === 0) {
              return { state, error: "INVALID_STASH_INSTANCE_ID", detail: null };
            }
            const result = resolveShellCompanySecondRecruit(state, userIntent.playerId, userIntent.stashInstanceId);
            return { state: result.state, error: result.error, detail: result.detail };
          }
          case "RESOLVE_DEFICIT_TRACK_CHOICE": {
            if (typeof userIntent.playerId !== "string" || userIntent.playerId.length === 0) {
              return { state, error: "INVALID_PLAYER_ID", detail: null };
            }
            if (typeof userIntent.chosenTrack !== "string") {
              return { state, error: "INVALID_TRACK_NAME", detail: null };
            }
            const result = resolveDeficitTrackChoice(state, userIntent.playerId, userIntent.chosenTrack);
            return { state: result.state, error: result.error, detail: result.detail };
          }
          case "RESOLVE_ACTION_CARD_EFFECT_CHOICE": {
            if (typeof userIntent.playerId !== "string" || userIntent.playerId.length === 0) {
              return { state, error: "INVALID_PLAYER_ID", detail: null };
            }
            const result = resolveActionCardEffectChoice(state, userIntent.playerId, userIntent.extra || {});
            return { state: result.state, error: result.error, detail: result.detail };
          }
          case "RESOLVE_SPECIALIST_CARD_EFFECT_CHOICE": {
            if (typeof userIntent.playerId !== "string" || userIntent.playerId.length === 0) {
              return { state, error: "INVALID_PLAYER_ID", detail: null };
            }
            const result = resolveSpecialistCardEffectChoice(state, userIntent.playerId, userIntent.extra || {});
            return { state: result.state, error: result.error, detail: result.detail };
          }
          case "RESOLVE_CRM_UPDATE_CHOICE": {
            const payload = buildCrmUpdateChoicePayload(userIntent.playerId, userIntent.chosenCatalogId);
            if (!payload.ok) {
              return { state, error: payload.error, detail: null };
            }
            const result = resolveCrmUpdateChoice(state, payload.playerId, payload.chosenCatalogId);
            return { state: result.state, error: result.error, detail: result.detail };
          }
          case "RESOLVE_INTERRUPT": {
            const payload = buildInterruptResponsePayload(userIntent.interruptViewModel, userIntent.selection);
            if (!payload.ok) {
              return { state, error: payload.error, detail: payload.detail || null };
            }
            const result = handleInterruptResolution(state, payload.respondingPlayerId, payload.payload);
            return { state: result.state, error: result.error, detail: result.detail };
          }
          default:
            return { state, error: "UNKNOWN_USER_INTENT_TYPE", detail: { type: userIntent.type } };
        }
      }
      function settleGameLoop(state, options = {}) {
        const maxIterations = options.maxIterations || DEFAULT_MAX_SETTLE_ITERATIONS;
        let iterations = 0;
        let current = state;
        while (current.phase.current !== "FINAL_SCORING") {
          iterations += 1;
          if (iterations > maxIterations) {
            return { state: current, settled: false, reason: "MAX_ITERATIONS_EXCEEDED" };
          }
          if (current.phase.current === "WORKER_PLACEMENT") {
            const interrupt = current.phase.pendingInterrupt;
            if (interrupt && interrupt.type !== "NULL") {
              const owner = current.players[interrupt.sourcePlayerId];
              if (!owner || !owner.isBot) {
                return { state: current, settled: true, reason: "WAITING_ON_HUMAN_INTERRUPT" };
              }
              const result = triggerBotTurnIfActive(current);
              current = result.state;
              continue;
            }
            if (current.phase.playersWithMeeplesRemaining.length === 0) {
              current = runPreBiddingSequence(current);
              continue;
            }
            const activePlayer = current.players[current.phase.activePlayerId];
            if (activePlayer && activePlayer.isBot) {
              const result = triggerBotTurnIfActive(current);
              current = result.state;
              continue;
            }
            return { state: current, settled: true, reason: "WAITING_ON_HUMAN_TURN" };
          }
          if (current.phase.current === "TURN_ORDER_BIDDING") {
            const unsubmittedBot = Object.values(current.players).find((p) => p.isBot && !p.turnOrderBid.submitted);
            if (unsubmittedBot) {
              const bid = evaluateTurnOrderBid(current, unsubmittedBot.playerId);
              const result = submitTurnOrderBid(current, unsubmittedBot.playerId, {
                type: "SUBMIT_TURN_ORDER_BID",
                payload: bid
              });
              current = result.state;
              continue;
            }
            const unsubmittedHuman = Object.values(current.players).find((p) => !p.isBot && !p.turnOrderBid.submitted);
            if (unsubmittedHuman) {
              return { state: current, settled: true, reason: "WAITING_ON_HUMAN_BID" };
            }
            continue;
          }
          if (current.phase.current === "SPECIALIST_REVEAL") {
            current = revealNextSpecialist(current);
            continue;
          }
          return { state: current, settled: false, reason: `UNKNOWN_PHASE_${current.phase.current}` };
        }
        return { state: current, settled: true, reason: "FINAL_SCORING" };
      }
      function buildFullViewSync(state) {
        const vm = getUiViewModel(state);
        const dashboards = {};
        Object.keys(vm.players).forEach((playerId) => {
          dashboards[playerId] = renderPlayerDashboard(vm, playerId);
        });
        return {
          vm,
          board: renderGameBoard(vm),
          dashboards,
          overlay: renderInterruptOverlay(vm)
        };
      }
      function executeUserAction(state, userIntent, options = {}) {
        const dispatchResult = dispatchHumanAction(state, userIntent);
        if (dispatchResult.error) {
          return {
            state: dispatchResult.state,
            error: dispatchResult.error,
            detail: dispatchResult.detail,
            settleReason: null,
            view: buildFullViewSync(dispatchResult.state)
          };
        }
        const settleResult = settleGameLoop(dispatchResult.state, options);
        return {
          state: settleResult.state,
          error: null,
          detail: null,
          settleReason: settleResult.reason,
          view: buildFullViewSync(settleResult.state)
        };
      }
      module.exports = {
        executeUserAction,
        settleGameLoop,
        dispatchHumanAction,
        buildFullViewSync
      };
    }
  });

  // browserEntry.js
  var require_browserEntry = __commonJS({
    "browserEntry.js"(exports, module) {
      var { initializeGame } = require_gameSetupController();
      var { createInitialState } = require_initialGameState();
      var { executeUserAction, settleGameLoop, buildFullViewSync, dispatchHumanAction } = require_gameLoopController();
      var { getUiViewModel } = require_uiStateBridge();
      var { renderGameBoard } = require_gameBoardRenderer();
      var { renderPlayerDashboard } = require_playerDashboardRenderer();
      var { renderInterruptOverlay } = require_interruptOverlayRenderer();
      var { MARKET_SHARE_TRACK_SPACES } = require_boardConfigLoader();
      module.exports = {
        initializeGame,
        createInitialState,
        executeUserAction,
        settleGameLoop,
        buildFullViewSync,
        dispatchHumanAction,
        getUiViewModel,
        renderGameBoard,
        renderPlayerDashboard,
        renderInterruptOverlay,
        MARKET_SHARE_TRACK_SPACES
      };
    }
  });
  return require_browserEntry();
})();
