/**
 * uiMessages.js — Broker Boss Online (v68.19)
 *
 * Presentation-only text helpers. No game rules, no state changes: these
 * functions only turn engine data (error codes, log entries) into words a
 * player can read. Loaded before app.js; exposes window.BrokerBossUiMessages.
 *
 *   friendlyError(code, detail)      -> plain-English reason an action was refused
 *   buildPublicLog(state, catalog)   -> [{ round, text }] for the Action Log
 *   playerName(state, playerId)      -> seat display name ("You", "Hunter Hayes", …)
 *   polishText(text, state, catalog) -> names instead of ids, "You" grammar fixed
 */
(function () {
  'use strict';

  var SPACE_NAMES = {
    EXEC_SEARCH_SPECIALTY_AGENT_HUB: 'Executive Search',
    EXEC_ADDITIONAL_PROFIT: 'Additional Profit',
    EXEC_TAKE_PLAY_CARD: 'Play or Acquire a Card',
    EXEC_CLEAR_OPEN_MARKET: 'Clear Open Market',
    GRW_MARKET_SHARE_ADVANCE: 'Market Share',
    GRW_RECRUIT_AGENT: 'Recruit Open Market Agent',
    GRW_POACH_AGENT: 'Recruit Competing Broker Agent',
    GRW_LOYALTY_TOKEN: 'Loyalty',
    OPS_TRAINING: 'Training',
    OPS_TECHNOLOGY: 'Technology',
    OPS_RECOGNITION: 'Recognition',
    OPS_2X_COMBO: '2x Combo',
    LDR_HIRE_STAFF: 'Hire Staff',
    LDR_OFFICE_EXPANSION: 'Office Expansion',
    LDR_HIRE_COACH: 'Hire a Coach',
  };

  function spaceName(id) {
    return SPACE_NAMES[id] || String(id || '').replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }

  function money(n) { return '$' + n + ' PT'; }

  // ---------------------------------------------------------------------
  // Error codes -> plain English. A string, or a function of the engine's
  // `detail` object. Anything not listed falls back to a generic sentence
  // (the raw code still goes to the browser console for debugging).
  var ERROR_TEXT = {
    // turn / phase
    NOT_YOUR_ACTIVE_TURN: "It isn't your turn yet.",
    NOT_YOUR_TURN: "It isn't your turn yet.",
    NOT_ACTIVE_PLAYER: "It isn't your turn yet.",
    WRONG_PHASE: "You can't do that during this part of the round.",
    PENDING_INTERRUPT_ACTIVE: 'Finish the choice that is already open first.',
    CHOICE_PENDING: 'Finish the choice that is already open first.',
    BID_ALREADY_SUBMITTED: 'You already submitted your bid for this round.',
    // meeples and spaces
    MEEPLE_NOT_IN_SUPPLY: "That meeple isn't available any more — pick another space.",
    MEEPLE_NOT_FOUND: "That meeple isn't available any more — pick another space.",
    INCORRECT_MEEPLE_COMMITMENT_COUNT: function (d) { return 'This space needs ' + ((d && d.required) || 2) + ' available meeples.'; },
    SPACE_AT_CAPACITY: 'That space is full this round.',
    SPACE_BLOCKED: 'That space is blocked this round.',
    SPECIALIST_HUB_ALREADY_SPENT: "This round's Specialist has already been hired.",
    SPACE_NOT_OPPONENT_OCCUPIED: "Overtime Manager only works on a space that's full because of an opponent.",
    LIQUIDITY_STAFF_SINGLE_MEEPLE_SPACES_ONLY: "A Liquidity Staff token can't be used on a 2-meeple space.",
    LIQUIDITY_STAFF_PT_NOT_USABLE_THIS_ROUND: 'Liquidity Staff tokens can only be used in the round after you bank them.',
    NO_LIQUIDITY_STAFF_PT: "You don't have any Liquidity Staff tokens.",
    // money
    INSUFFICIENT_FUNDS_FOR_PLACEMENT: function (d) {
      var need = d && d.required && d.required.profitTokens;
      var have = d && d.available && d.available.profitTokens;
      return typeof need === 'number' && typeof have === 'number'
        ? 'Not enough Profit Tokens — this space costs ' + money(need) + ' and you have ' + money(have) + '.'
        : "You don't have enough Profit Tokens for that space.";
    },
    INSUFFICIENT_FUNDS: function (d) {
      return d && typeof d.required === 'number' && typeof d.current === 'number'
        ? 'Not enough Profit Tokens — you need ' + money(d.required) + ' and have ' + money(d.current) + '.'
        : "You don't have enough Profit Tokens for that.";
    },
    INSUFFICIENT_PT: "You don't have enough Profit Tokens for that.",
    INSUFFICIENT_FUNDS_FOR_BID: "You can't bid more than you have.",
    // recruiting
    NO_MATCHING_VALUE: "You don't meet any of this Agent's values yet — raise Training, Technology or Recognition to at least one of their numbers.",
    INSUFFICIENT_MATCHING_VALUES: 'To poach, you must meet at least 2 of the Agent\'s values (Training, Technology, Recognition).',
    ALL_VALUES_NOT_MET: 'A Loyalty Token needs all 3 of the Agent\'s values met.',
    NO_OPEN_DESK: 'Your offices are full — expand your offices (Leadership hub) before hiring another Agent.',
    OFFICES_AT_MAX: 'All 16 office spaces on your board are already open — Office Expansion has nothing left to add.',
    COPYCAT_END_OF_ROUND_ONLY: 'The Copycat Meeple can only be placed in the End of Round window, after everyone has finished their turns.',
    AGENT_HAS_ONBOARDING_TOKEN: 'That Agent was just hired this round and is protected until the round ends.',
    AGENT_HAS_LOYALTY_TOKEN: "That Agent has a Loyalty Token and can't be poached.",
    AGENT_RECRUITMENT_PROTECTED: "That Agent is protected and can't be taken right now.",
    TARGET_AGENT_PROTECTED: "That Agent is protected and can't be targeted right now.",
    TARGET_AGENT_LOYALED: "That Agent has a Loyalty Token and can't be targeted.",
    CANNOT_POACH_OWN_AGENT: "That Agent already works for you.",
    AGENT_ALREADY_LOYAL: 'That Agent already has a Loyalty Token.',
    TARGET_ALREADY_LOYAL: 'That Agent already has a Loyalty Token.',
    LOYALTY_TOKENS_EXHAUSTED: 'You have used all of your Loyalty Tokens.',
    AGENT_NOT_IN_OPEN_MARKET: "That Agent isn't in the Open Market any more.",
    OPEN_MARKET_EMPTY: 'The Open Market is empty.',
    FOLLOWER_TETHERED_TO_INFLUENCER: "That Follower moves with their Influencer and can't be taken on their own.",
    SHELL_COMPANY_RECRUIT_LIMIT_REACHED: "You've already made both Shell Company recruits.",
    // cards
    CARD_NOT_IN_HAND: "That card isn't in your hand any more.",
    CARD_NOT_IN_OPEN_MARKET: "That card isn't in the Open Market any more.",
    PICKED_CARD_NOT_IN_OPEN_MARKET: "That card isn't in the Open Market any more.",
    REQUIREMENT_NOT_MET: function (d) {
      return d && d.track ? 'This card needs ' + d.track + ' Level ' + d.required + ' (you have ' + d.current + ').' : "You don't meet this card's requirement yet.";
    },
    REACTIVE_ONLY_CARD: "This card can only be played in response to a rival's move, so it stays in your hand.",
    DRAW_PILE_EMPTY: 'There are no cards left to draw.',
    INSUFFICIENT_CARDS_TO_TRASH: "You don't have enough cards to trash for that.",
    // abilities
    ALREADY_USED_THIS_ROUND: 'You already used that ability this round.',
    ABILITY_NOT_UNLOCKED: "You haven't unlocked that ability yet.",
    TOKEN_NOT_BANKED: "You don't have that bonus token.",
    COPYCAT_MEEPLE_NOT_AVAILABLE: 'Your Copycat Meeple is not available right now.',
    COPYCAT_MARKETING_NOT_UNLOCKED: "You haven't unlocked Copycat Marketing yet.",
    CHOSEN_TRACK_ALREADY_AT_ZERO: 'That track is already at 0 — pick another one.',
    DEFICIT_TRACK_CHOICE_REQUIRED: 'Choose a track to lower to cover the shortfall.',
    TRANSACTION_ROLLBACK_TRIGGERED: "That couldn't be completed, so nothing was changed.",
  };

  var GENERIC_ERROR = "That move isn't allowed right now.";

  function friendlyError(code, detail) {
    if (!code) return '';
    var entry = ERROR_TEXT[code];
    if (typeof entry === 'function') {
      try { return entry(detail); } catch (e) { /* fall through */ }
    } else if (typeof entry === 'string') {
      return entry;
    }
    if (typeof console !== 'undefined') console.warn('[BrokerBoss] unmapped error code:', code, detail);
    // Codes that only mean "the screen was out of date" — say so plainly.
    if (/^NO_PENDING_|^INVALID_|^MALFORMED_|^UNKNOWN_|_NOT_FOUND$/.test(code)) {
      return 'That choice is no longer available — the board has moved on. Try again.';
    }
    return GENERIC_ERROR;
  }

  // ---------------------------------------------------------------------
  // Names
  function playerName(state, playerId) {
    if (!state || !playerId) return playerId || '';
    var seats = state.session && state.session.seats;
    var seat = seats && seats.find(function (s) { return s.playerId === playerId; });
    if (seat && seat.displayName) return seat.displayName;
    var p = state.players && state.players[playerId];
    return (p && (p.displayName || p.name)) || playerId;
  }

  function agentName(catalog, id) {
    var a = catalog && catalog.agentCards && catalog.agentCards[id];
    return a && a.name;
  }
  function cardName(catalog, id) {
    var c = catalog && ((catalog.actionCards && catalog.actionCards[id]) || (catalog.specialistCards && catalog.specialistCards[id]) || (catalog.shiftCards && catalog.shiftCards[id]));
    return c && c.name;
  }

  // "You recruits" -> "You recruit", "You's X" -> "Your X", "You has" -> "You have".
  var IRREGULAR = { has: 'have', is: 'are', does: 'do', was: 'were', goes: 'go' };
  function baseVerb(word) {
    var lower = word.toLowerCase();
    if (IRREGULAR[lower]) return IRREGULAR[lower];
    if (/[^aeiou]ies$/.test(lower)) return word.slice(0, -3) + 'y';
    if (/(ches|shes|sses|xes|zes)$/.test(lower)) return word.slice(0, -2);
    if (/[^s]s$/.test(lower) && !/(us|is|ss)$/.test(lower)) return word.slice(0, -1);
    return word;
  }
  function fixYouGrammar(text) {
    var out = text
      .replace(/\bYou's (The |the )?/g, 'Your ')
      .replace(/\bYou (\w+ly )?([a-z]+)\b/g, function (m, adverb, verb) { return 'You ' + (adverb || '') + baseVerb(verb); });
    // "You draw 5 cards to refresh their hand" -> "your hand"
    if (/^(You|Your) /.test(out)) out = out.replace(/\btheir\b/g, 'your').replace(/\bthey\b/g, 'you');
    return out;
  }

  function polishText(text, state, catalog) {
    if (!text) return '';
    var out = String(text)
      .replace(/ — engine paused awaiting a response\.?/g, '.')
      .replace(/\bp([1-6])\b/g, function (m) { return playerName(state, m); })
      .replace(/\b(EXEC|OPS|GRW|LDR)_[A-Z0-9_]+\b/g, function (m) { return SPACE_NAMES[m] ? SPACE_NAMES[m] : (cardName(catalog, m) || m); })
      .replace(/\b(GRW|STR|INF)_\d{3}\b|\bSPEC_\d{1,2}\b|\bS[1-7]\b/g, function (m) { return cardName(catalog, m) || m; })
      .replace(/\bA(\d{1,2})\b/g, function (m) { return agentName(catalog, m) || m; });
    return fixYouGrammar(out);
  }

  // ---------------------------------------------------------------------
  // Public Action Log
  // Entries without a written message are internal bookkeeping (bot
  // decisions, "awaiting choice" markers, sweeps) and are hidden — except
  // these few, which get a plain sentence.
  function describeUntitled(entry, state, catalog) {
    var who = entry.playerId ? playerName(state, entry.playerId) : '';
    switch (entry.type) {
      case 'MEEPLE_PLACED':
        return who + ' places a meeple on ' + spaceName(entry.spaceId) + '.';
      case 'ACTION_CARD_PLAYED':
        return who + ' plays ' + (cardName(catalog, entry.catalogId) || 'an Action Card') + '.';
      case 'SPECIALIST_CARD_ACTIVATED':
        return who + ' hires ' + (cardName(catalog, entry.catalogId) || "this round's Specialist") + '.';
      case 'SPECIALIST_CARD_REVEALED':
      case 'SPECIALIST_DECK_FINAL_CARD_REVEALED':
        return 'New Specialist this round: ' + (cardName(catalog, entry.catalogId) || 'revealed') + '.';
      case 'ROUND_ADVANCED':
        return '— Round ' + entry.newRound + ' begins —';
      case 'TURN_ORDER_RESOLVED':
        return 'Turn order next round: ' + (entry.turnOrder || []).map(function (id) { return playerName(state, id); }).join(', ') + '.';
      case 'MEEPLE_TAX_PAID':
        return who + ' pays ' + money(entry.amount) + ' Meeple Tax.';
      case 'MEEPLE_TAX_DEFAULTED':
        var walked = Array.isArray(entry.meeplesRepossessed) ? entry.meeplesRepossessed.length : entry.meeplesRepossessed;
        return who + " can't cover the Meeple Tax — " + (walked || 'some') + ' staff ' + (walked === 1 ? 'walks' : 'walk') + ' out.';
      case 'SHIFT_EFFECT_APPLIED':
        return null; // the Shift card itself is announced by SHIFT_CARD_TRIGGERED
      case 'SHIFT_EFFECT_BLOCKED_BY_IMMUNITY':
        return who + ' is protected from ' + (cardName(catalog, entry.catalogId) || 'the Shift card') + ' by Shift immunity.';
      default:
        return null;
    }
  }

  function buildPublicLog(state, catalog, limit) {
    if (!state || !Array.isArray(state.log)) return [];
    var lines = [];
    for (var i = 0; i < state.log.length; i += 1) {
      var entry = state.log[i];
      var text = entry.message ? polishText(entry.message, state, catalog) : describeUntitled(entry, state, catalog);
      if (!text) continue;
      lines.push({ round: entry.round, text: fixYouGrammar(text) });
    }
    return typeof limit === 'number' ? lines.slice(-limit) : lines;
  }

  var api = { friendlyError: friendlyError, playerName: playerName, polishText: polishText, buildPublicLog: buildPublicLog, spaceName: spaceName, fixYouGrammar: fixYouGrammar };
  if (typeof window !== 'undefined') window.BrokerBossUiMessages = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
