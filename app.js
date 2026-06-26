"use strict";

const STORAGE_KEY = "baseball-score-mvp-v2";
const LEGACY_STORAGE_KEY = "baseball-score-mvp-v1";
const DB_NAME = "baseball-score-offline-db";
const DB_VERSION = 1;
const STATE_STORE = "app_state";
const STATE_RECORD_ID = "main";

const pitchTypes = {
  called: "見逃しストライク",
  swinging: "空振りストライク",
  ball: "ボール",
  foul: "ファール",
  inplay: "インプレー",
};

const resultTypes = {
  single: { label: "単打", out: false, hit: true, ab: true },
  double: { label: "二塁打", out: false, hit: true, ab: true },
  triple: { label: "三塁打", out: false, hit: true, ab: true },
  homerun: { label: "本塁打", out: false, hit: true, ab: true },
  groundout: { label: "ゴロアウト", out: true, hit: false, ab: true },
  flyout: { label: "フライアウト", out: true, hit: false, ab: true },
  lineout: { label: "ライナーアウト", out: true, hit: false, ab: true },
  strikeout: { label: "三振", out: true, hit: false, ab: true },
  doubleplay: { label: "併殺", out: true, outs: 2, hit: false, ab: true, gidp: true },
  walk: { label: "四球", out: false, hit: false, walk: true },
  hbp: { label: "死球", out: false, hit: false, hbp: true },
  sacrifice: { label: "犠打", out: true, hit: false, sacrifice: true },
  error: { label: "失策", out: false, hit: false, ab: true, errorReach: true },
};

Object.assign(pitchTypes, {
  called: "見逃しストライク",
  swinging: "空振りストライク",
  ball: "ボール",
  foul: "ファール",
  inplay: "インプレー",
});

Object.assign(resultTypes, {
  single: { label: "単打", out: false, hit: true, ab: true },
  double: { label: "二塁打", out: false, hit: true, ab: true },
  triple: { label: "三塁打", out: false, hit: true, ab: true },
  homerun: { label: "本塁打", out: false, hit: true, ab: true },
  groundout: { label: "ゴロアウト", out: true, hit: false, ab: true },
  flyout: { label: "フライアウト", out: true, hit: false, ab: true },
  lineout: { label: "ライナーアウト", out: true, hit: false, ab: true },
  strikeout: { label: "三振", out: true, hit: false, ab: true },
  doubleplay: { label: "併殺", out: true, outs: 2, hit: false, ab: true, gidp: true },
  walk: { label: "四球", out: false, hit: false, walk: true },
  hbp: { label: "死球", out: false, hit: false, hbp: true },
  sacrifice: { label: "犠打", out: true, hit: false, sacrifice: true },
  error: { label: "失策", out: false, hit: false, ab: true, errorReach: true },
});

const initialState = {
  players: [],
  games: [],
  gameLineups: [],
  plateAppearances: [],
  pitches: [],
  battingResults: [],
  substitutions: [],
  gameEvents: [],
  undoStack: [],
  gameActionHistory: [],
  currentGameId: null,
  screen: "home",
  statsTab: "batting",
  editingPlayerId: null,
  pendingRuns: 0,
};

let state = structuredClone(initialState);

async function loadState() {
  const persisted = await readStateFromIndexedDb();
  const raw = persisted ? JSON.stringify(persisted) : localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY);
  if (!raw) return structuredClone(initialState);
  try {
    return migrateState({ ...structuredClone(initialState), ...JSON.parse(raw) });
  } catch {
    return structuredClone(initialState);
  }
}

function migrateState(source) {
  const migrated = { ...structuredClone(initialState), ...source };
  migrated.gameLineups = migrated.gameLineups || [];
  migrated.substitutions = migrated.substitutions || [];
  migrated.gameEvents = migrated.gameEvents || [];
  migrated.undoStack = migrated.undoStack || [];
  migrated.gameActionHistory = migrated.gameActionHistory || [];
  migrated.statsTab = migrated.statsTab || "batting";

  migrated.gameLineups = migrated.gameLineups.map((lineup) => ({
    ...lineup,
    originalPlayerId: lineup.originalPlayerId || lineup.playerId,
    currentPlayerId: lineup.currentPlayerId || lineup.playerId,
    replacedAt: lineup.replacedAt || null,
    replacedByPlayerId: lineup.replacedByPlayerId || null,
  }));

  migrated.games = migrated.games.map((game) => {
    const currentBatterOrder = normalizeOrder(game.currentBatterOrder || ((game.currentBatterIndex || 0) + 1));
    const starter = migrated.gameLineups.find((lineup) => lineup.gameId === game.id && lineup.battingOrder === currentBatterOrder);
    const selfIsAway = game.battingOrder === "top";
    const currentAwayPitcherId = game.currentAwayPitcherId || (selfIsAway ? (game.currentPitcherId || game.startingPitcherId || null) : null);
    const currentHomePitcherId = game.currentHomePitcherId || (!selfIsAway ? (game.currentPitcherId || game.startingPitcherId || null) : null);
    return {
      ...game,
      currentBatterOrder,
      currentBatterId: game.currentBatterId || starter?.playerId || null,
      startingPitcherId: game.startingPitcherId || null,
      currentPitcherId: game.currentPitcherId || game.startingPitcherId || null,
      currentAwayPitcherId,
      currentHomePitcherId,
      currentAwayPitcherName: game.currentAwayPitcherName || (currentAwayPitcherId ? "" : "相手投手"),
      currentHomePitcherName: game.currentHomePitcherName || (currentHomePitcherId ? "" : "相手投手"),
      currentDefensivePitcherId: game.currentDefensivePitcherId || (game.half === "top" ? currentHomePitcherId : currentAwayPitcherId),
      runnerOnFirst: Boolean(game.runnerOnFirst),
      runnerOnSecond: Boolean(game.runnerOnSecond),
      runnerOnThird: Boolean(game.runnerOnThird),
      pendingInPlay: Boolean(game.pendingInPlay),
    };
  });

  migrated.plateAppearances = migrated.plateAppearances.map((pa) => ({
    ...pa,
    batterId: pa.batterId || pa.playerId || null,
    pitcherId: pa.pitcherId || null,
    pitcherName: pa.pitcherName || null,
    halfInning: pa.halfInning || `${pa.inning}_${pa.half}`,
    isTop: typeof pa.isTop === "boolean" ? pa.isTop : pa.half === "top",
    battingTeamType: pa.battingTeamType || pa.battingSide || "self",
    result: pa.result || null,
    rbi: Number(pa.rbi || 0),
    runsScored: Number(pa.runsScored || 0),
    earnedRuns: Number(pa.earnedRuns || 0),
  }));

  migrated.pitches = migrated.pitches.map((pitch) => {
    const pa = migrated.plateAppearances.find((item) => item.id === pitch.plateAppearanceId);
    return { ...pitch, pitcherId: pitch.pitcherId || pa?.pitcherId || null };
  });

  migrated.battingResults = migrated.battingResults.map((result) => {
    const pa = migrated.plateAppearances.find((item) => item.id === result.plateAppearanceId);
    return {
      ...result,
      batterId: result.batterId || result.playerId || pa?.batterId || null,
      pitcherId: result.pitcherId || pa?.pitcherId || null,
      pitcherName: result.pitcherName || pa?.pitcherName || null,
      battingTeamType: result.battingTeamType || result.battingSide || pa?.battingTeamType || "self",
      rbi: Number(result.rbi ?? (result.battingSide === "self" ? result.runs || 0 : 0)),
      runsScored: Number(result.runsScored ?? (result.battingSide === "self" ? result.runs || 0 : 0)),
      earnedRuns: Number(result.earnedRuns ?? (result.battingSide === "opponent" ? result.runs || 0 : 0)),
    };
  });

  return migrated;
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  writeStateToIndexedDb(state).catch((error) => console.warn("IndexedDBへの保存に失敗しました", error));
}

function openAppDb() {
  if (!("indexedDB" in window)) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STATE_STORE)) db.createObjectStore(STATE_STORE, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readStateFromIndexedDb() {
  const db = await openAppDb();
  if (!db) return null;
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STATE_STORE, "readonly");
    const store = transaction.objectStore(STATE_STORE);
    const request = store.get(STATE_RECORD_ID);
    request.onsuccess = () => resolve(request.result?.state || null);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => db.close();
  });
}

async function writeStateToIndexedDb(nextState) {
  const db = await openAppDb();
  if (!db) return;
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STATE_STORE, "readwrite");
    const store = transaction.objectStore(STATE_STORE);
    store.put({ id: STATE_RECORD_ID, state: nextState, updatedAt: new Date().toISOString() });
    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => reject(transaction.error);
  });
}

async function clearIndexedDbState() {
  const db = await openAppDb();
  if (!db) return;
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STATE_STORE, "readwrite");
    transaction.objectStore(STATE_STORE).delete(STATE_RECORD_ID);
    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => reject(transaction.error);
  });
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch((error) => console.warn("オフラインキャッシュの登録に失敗しました", error));
  });
}

function uid(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function setState(updater) {
  state = updater(state);
  saveState();
  render();
}

function stateSnapshot(source) {
  const snapshot = structuredClone(source);
  snapshot.gameActionHistory = [];
  return snapshot;
}

function pushActionHistory(draft, beforeState, actionType, gameId, related = {}) {
  draft.gameActionHistory = draft.gameActionHistory || [];
  draft.gameActionHistory.push({
    id: uid("action"),
    gameId,
    actionType,
    beforeState: stateSnapshot(beforeState),
    relatedPitchId: related.relatedPitchId || null,
    relatedPlateAppearanceId: related.relatedPlateAppearanceId || null,
    createdAt: new Date().toISOString(),
  });
  if (draft.gameActionHistory.length > 50) draft.gameActionHistory.shift();
}

function currentGame() {
  return state.games.find((game) => game.id === state.currentGameId) || null;
}

function currentSide(game) {
  return game.battingOrder === game.half ? "self" : "opponent";
}

function halfLabel(half) {
  return half === "top" ? "表" : "裏";
}

function normalizeOrder(order) {
  const value = Number(order || 1);
  return ((value - 1 + 9) % 9) + 1;
}

function playerName(playerId, fallback = "相手打者") {
  if (!playerId) return fallback;
  return state.players.find((player) => player.id === playerId)?.name || "削除済み選手";
}

function lineupsForGame(gameId) {
  return state.gameLineups.filter((lineup) => lineup.gameId === gameId);
}

function starterForOrder(source, gameId, order) {
  return source.gameLineups.find((lineup) => lineup.gameId === gameId && lineup.isStarter && Number(lineup.battingOrder) === Number(order));
}

function currentBatter(game, source = state) {
  if (currentSide(game) === "opponent") return null;
  const starter = starterForOrder(source, game.id, normalizeOrder(game.currentBatterOrder));
  if (starter) return source.players.find((player) => player.id === (starter.currentPlayerId || starter.playerId)) || null;

  if (!source.players.length) return null;
  const legacyIndex = game.currentBatterIndex || 0;
  return source.players[legacyIndex % source.players.length];
}

function currentPitcher(game, source = state) {
  return source.players.find((player) => player.id === game.currentPitcherId) || null;
}

function defensivePitcherInfo(game, source = state) {
  const defensiveHalf = game.half === "top" ? "home" : "away";
  const id = defensiveHalf === "home" ? game.currentHomePitcherId : game.currentAwayPitcherId;
  const name = id
    ? playerNameFromSource(source, id, "未設定")
    : (defensiveHalf === "home" ? game.currentHomePitcherName : game.currentAwayPitcherName) || "相手投手";
  const selfIsAway = game.battingOrder === "top";
  const isSelfPitcher = defensiveHalf === (selfIsAway ? "away" : "home");
  return { id: id || null, name, defensiveHalf, isSelfPitcher };
}

function playerNameFromSource(source, playerId, fallback = "未設定") {
  if (!playerId) return fallback;
  return source.players.find((player) => player.id === playerId)?.name || fallback;
}

function ensurePlateAppearance(draft, game) {
  let pa = draft.plateAppearances.find((item) => item.id === game.currentPlateAppearanceId);
  if (pa) return pa;

  const battingTeamType = currentSide(game);
  const batter = battingTeamType === "self" ? currentBatter(game, draft) : null;
  const pitcher = defensivePitcherInfo(game, draft);
  const pitcherId = battingTeamType === "opponent" && pitcher.isSelfPitcher ? pitcher.id : null;

  pa = {
    id: uid("pa"),
    gameId: game.id,
    playerId: batter?.id || null,
    batterId: batter?.id || null,
    pitcherId,
    pitcherName: pitcher.name,
    battingSide: battingTeamType,
    battingTeamType,
    inning: game.inning,
    half: game.half,
    halfInning: `${game.inning}_${game.half}`,
    isTop: game.half === "top",
    result: null,
    rbi: 0,
    runsScored: 0,
    earnedRuns: 0,
    startedAt: new Date().toISOString(),
    resultId: null,
  };
  draft.plateAppearances.push(pa);
  game.currentPlateAppearanceId = pa.id;
  return pa;
}

function recordPitch(type) {
  const game = currentGame();
  if (!game) return;

  setState((prev) => {
    const draft = structuredClone(prev);
    const targetGame = draft.games.find((item) => item.id === game.id);
    pushActionHistory(draft, prev, "pitch_input", targetGame.id);
    const pa = ensurePlateAppearance(draft, targetGame);
    const before = { balls: targetGame.balls, strikes: targetGame.strikes };

    if (type === "called" || type === "swinging") {
      targetGame.strikes += 1;
    } else if (type === "ball") {
      targetGame.balls += 1;
    } else if (type === "foul" && targetGame.strikes < 2) {
      targetGame.strikes += 1;
    }

    draft.pitches.push({
      id: uid("pitch"),
      gameId: targetGame.id,
      plateAppearanceId: pa.id,
      pitcherId: pa.pitcherId,
      pitcherName: pa.pitcherName,
      type,
      label: pitchTypes[type],
      countBefore: before,
      countAfter: { balls: targetGame.balls, strikes: targetGame.strikes },
      createdAt: new Date().toISOString(),
    });

    if (type === "inplay") {
      targetGame.pendingInPlay = true;
      draft.screen = "live";
      return draft;
    }

    if (targetGame.strikes >= 3) {
      finishPlateAppearance(draft, targetGame, "strikeout", 0);
    } else if (targetGame.balls >= 4) {
      finishPlateAppearance(draft, targetGame, "walk", 0);
    }

    draft.screen = "live";
    return draft;
  });
}

function submitResult(type) {
  const runsInput = document.querySelector("#runsInput");
  const runs = Math.max(0, Number(runsInput?.value || 0));
  const game = currentGame();
  if (!game) return;

  setState((prev) => {
    const draft = structuredClone(prev);
    const targetGame = draft.games.find((item) => item.id === game.id);
    pushActionHistory(draft, prev, "plate_appearance_result", targetGame.id);
    const pa = ensurePlateAppearance(draft, targetGame);
    const before = { balls: targetGame.balls, strikes: targetGame.strikes };
    draft.pitches.push({
      id: uid("pitch"),
      gameId: targetGame.id,
      plateAppearanceId: pa.id,
      pitcherId: pa.pitcherId,
      pitcherName: pa.pitcherName,
      type: "result",
      label: resultTypes[type].label,
      resultType: type,
      countBefore: before,
      countAfter: before,
      createdAt: new Date().toISOString(),
    });
    finishPlateAppearance(draft, targetGame, type, runs);
    draft.pendingRuns = 0;
    draft.screen = "live";
    return draft;
  });
}

function finishPlateAppearance(draft, game, type, runs) {
  const pa = ensurePlateAppearance(draft, game);
  const meta = resultTypes[type];
  const battingTeamType = pa.battingTeamType || pa.battingSide;
  const rbi = battingTeamType === "self" ? runs : 0;
  const runsScored = battingTeamType === "self" ? runs : 0;
  const earnedRuns = battingTeamType === "opponent" ? runs : 0;
  const outsAdded = Math.min(meta.outs ?? (meta.out ? 1 : 0), Math.max(0, 3 - game.outs));
  const result = {
    id: uid("result"),
    gameId: game.id,
    plateAppearanceId: pa.id,
    playerId: pa.batterId,
    batterId: pa.batterId,
    pitcherId: pa.pitcherId,
    pitcherName: pa.pitcherName,
    battingSide: battingTeamType,
    battingTeamType,
    type,
    label: meta.label,
    runs,
    rbi,
    runsScored,
    earnedRuns,
    outsAdded,
    createdAt: new Date().toISOString(),
  };

  draft.battingResults.push(result);
  pa.resultId = result.id;
  pa.result = type;
  pa.rbi = rbi;
  pa.runsScored = runsScored;
  pa.earnedRuns = earnedRuns;

  if (battingTeamType === "self") game.selfScore += runs;
  else game.opponentScore += runs;

  game.outs += result.outsAdded;
  game.balls = 0;
  game.strikes = 0;
  game.pendingInPlay = false;
  game.currentPlateAppearanceId = null;

  if (battingTeamType === "self") advanceSelfBatter(draft, game);
  if (game.outs >= 3) switchSides(game);
}

function advanceSelfBatter(draft, game) {
  const nextOrder = normalizeOrder((game.currentBatterOrder || 1) + 1);
  game.currentBatterOrder = nextOrder;
  const nextStarter = starterForOrder(draft, game.id, nextOrder);
  game.currentBatterId = nextStarter?.playerId || null;
  if (draft.players.length > 0) {
    game.currentBatterIndex = ((game.currentBatterIndex || 0) + 1) % draft.players.length;
  }
}

function switchSides(game) {
  game.outs = 0;
  game.balls = 0;
  game.strikes = 0;
  game.pendingInPlay = false;
  game.currentPlateAppearanceId = null;
  game.runnerOnFirst = false;
  game.runnerOnSecond = false;
  game.runnerOnThird = false;
  if (game.half === "top") {
    game.half = "bottom";
  } else {
    game.half = "top";
    game.inning += 1;
  }
  game.currentDefensivePitcherId = game.half === "top" ? game.currentHomePitcherId || null : game.currentAwayPitcherId || null;
}

function createGame(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const battingOrder = String(data.get("battingOrder"));
  const name = String(data.get("gameName") || "").trim() || new Date().toLocaleString("ja-JP");
  const starterIds = Array.from({ length: 9 }, (_, index) => String(data.get(`starter${index + 1}`) || ""));
  const uniqueStarterIds = new Set(starterIds.filter(Boolean));

  if (starterIds.some((id) => !id)) {
    alert("打順1番から9番まで、すべて選手を選択してください。");
    return;
  }
  if (uniqueStarterIds.size !== 9) {
    alert("同じ選手を複数の打順に登録することはできません。");
    return;
  }

  const startingPitcherId = String(data.get("startingPitcherId") || "");
  if (!startingPitcherId) {
    alert("先発ピッチャーを選択してください。");
    return;
  }
  const opponentStartingPitcherName = String(data.get("opponentStartingPitcherName") || "").trim() || "相手投手";
  const selfIsAway = battingOrder === "top";

  const gameId = uid("game");
  const game = {
    id: gameId,
    name,
    battingOrder,
    inning: 1,
    half: "top",
    outs: 0,
    balls: 0,
    strikes: 0,
    selfScore: 0,
    opponentScore: 0,
    currentBatterIndex: 0,
    currentBatterOrder: 1,
    currentBatterId: starterIds[0],
    startingPitcherId,
    currentPitcherId: startingPitcherId,
    currentAwayPitcherId: selfIsAway ? startingPitcherId : null,
    currentHomePitcherId: selfIsAway ? null : startingPitcherId,
    currentAwayPitcherName: selfIsAway ? "" : opponentStartingPitcherName,
    currentHomePitcherName: selfIsAway ? opponentStartingPitcherName : "",
    currentDefensivePitcherId: selfIsAway ? null : startingPitcherId,
    runnerOnFirst: false,
    runnerOnSecond: false,
    runnerOnThird: false,
    currentPlateAppearanceId: null,
    pendingInPlay: false,
    createdAt: new Date().toISOString(),
  };

  const starterLineups = starterIds.map((playerId, index) => ({
    id: uid("lineup"),
    gameId,
    battingOrder: index + 1,
    playerId,
    originalPlayerId: playerId,
    currentPlayerId: playerId,
    isStarter: true,
    position: "",
    isBench: false,
    replacedAt: null,
    replacedByPlayerId: null,
  }));
  const benchIds = Array.from(document.querySelectorAll("[name='benchPlayer']:checked")).map((input) => input.value);
  const benchLineups = benchIds
    .filter((playerId) => !uniqueStarterIds.has(playerId))
    .map((playerId) => ({
      id: uid("lineup"),
      gameId,
      battingOrder: null,
      playerId,
      originalPlayerId: playerId,
      currentPlayerId: playerId,
      isStarter: false,
      position: "",
      isBench: true,
      replacedAt: null,
      replacedByPlayerId: null,
    }));

  setState((prev) => ({
    ...prev,
    games: [game, ...prev.games],
    gameLineups: [...prev.gameLineups, ...starterLineups, ...benchLineups],
    currentGameId: game.id,
    screen: "live",
  }));
}

function savePlayer(event) {
  event.preventDefault();
  const input = event.currentTarget.querySelector("[name='playerName']");
  const name = input.value.trim();
  if (!name) return;

  setState((prev) => {
    if (prev.editingPlayerId) {
      return {
        ...prev,
        players: prev.players.map((player) => player.id === prev.editingPlayerId ? { ...player, name } : player),
        editingPlayerId: null,
      };
    }
    return {
      ...prev,
      players: [...prev.players, { id: uid("player"), name, createdAt: new Date().toISOString() }],
    };
  });
}

function deletePlayer(id) {
  if (!confirm("この選手を削除しますか？過去記録の選手名は「削除済み選手」表示になります。")) return;
  setState((prev) => ({ ...prev, players: prev.players.filter((player) => player.id !== id) }));
}

function pickGame(id) {
  setState((prev) => ({ ...prev, currentGameId: id, screen: "live" }));
}

function resetDemoData() {
  if (!confirm("保存済みデータをすべて削除しますか？")) return;
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(LEGACY_STORAGE_KEY);
  clearIndexedDbState().catch((error) => console.warn("IndexedDBの削除に失敗しました", error));
  state = structuredClone(initialState);
  render();
}

function setStatsTab(tabName) {
  setState((prev) => ({ ...prev, statsTab: tabName }));
}

const gameEventTypes = {
  steal_success: "盗塁",
  caught_stealing: "盗塁死",
  baserunning_out: "走塁死",
  passed_ball: "パスボール",
  wild_pitch: "ワイルドピッチ",
  balk: "ボーク",
  pickoff_out: "牽制死",
  run_scored: "得点",
  manual_base_change: "走者変更",
  note: "その他",
};

function simpleSituationOptions() {
  const keys = ["steal_success", "caught_stealing", "baserunning_out", "passed_ball", "wild_pitch", "balk", "pickoff_out", "note"];
  return keys.map((key) => `<option value="${key}">${gameEventTypes[key]}</option>`).join("");
}

function baseLabel(base) {
  return { home: "本塁", first: "一塁", second: "二塁", third: "三塁" }[base] || "";
}

function runnerSnapshot(game) {
  return {
    runnerOnFirst: Boolean(game.runnerOnFirst),
    runnerOnSecond: Boolean(game.runnerOnSecond),
    runnerOnThird: Boolean(game.runnerOnThird),
  };
}

function applyRunnerSnapshot(game, snapshot) {
  game.runnerOnFirst = Boolean(snapshot.runnerOnFirst);
  game.runnerOnSecond = Boolean(snapshot.runnerOnSecond);
  game.runnerOnThird = Boolean(snapshot.runnerOnThird);
}

function currentOffense(game) {
  return currentSide(game);
}

function currentDefensePitcherForEvent(game, source = state) {
  const pitcher = defensivePitcherInfo(game, source);
  return pitcher.isSelfPitcher ? pitcher.id : null;
}

function pushUndo(draft, game, eventId) {
  draft.undoStack = draft.undoStack || [];
  draft.undoStack.push({
    id: uid("undo"),
    gameId: game.id,
    eventId,
    gameBefore: {
      outs: game.outs,
      selfScore: game.selfScore,
      opponentScore: game.opponentScore,
      runnerOnFirst: Boolean(game.runnerOnFirst),
      runnerOnSecond: Boolean(game.runnerOnSecond),
      runnerOnThird: Boolean(game.runnerOnThird),
      inning: game.inning,
      half: game.half,
      currentPlateAppearanceId: game.currentPlateAppearanceId,
      currentDefensivePitcherId: game.currentDefensivePitcherId,
    },
  });
  if (draft.undoStack.length > 20) draft.undoStack.shift();
}

function createGameEvent(draft, game, payload) {
  const event = {
    id: uid("event"),
    gameId: game.id,
    inning: game.inning,
    half: game.half,
    halfInning: `${game.inning}_${game.half}`,
    battingTeamType: currentOffense(game),
    eventType: payload.eventType,
    relatedPlateAppearanceId: game.currentPlateAppearanceId || null,
    relatedPlayerId: payload.relatedPlayerId || null,
    pitcherId: currentDefensePitcherForEvent(game, draft),
    fromBase: payload.fromBase || "",
    toBase: payload.toBase || "",
    outsAdded: Number(payload.outsAdded || 0),
    runsAdded: Number(payload.runsAdded || 0),
    description: payload.description || "",
    createdAt: new Date().toISOString(),
  };
  pushUndo(draft, game, event.id);
  draft.gameEvents.push(event);
  game.outs += event.outsAdded;
  if (event.runsAdded > 0) {
    if (event.battingTeamType === "self") game.selfScore += event.runsAdded;
    else game.opponentScore += event.runsAdded;
  }
  if (payload.runners) applyRunnerSnapshot(game, payload.runners);
  if (game.outs >= 3) switchSides(game);
  return event;
}

function toggleRunner(base) {
  const game = currentGame();
  if (!game) return;
  if (base === "home") {
    addManualRun();
    return;
  }
  const key = { first: "runnerOnFirst", second: "runnerOnSecond", third: "runnerOnThird" }[base];
  if (!key) return;
  setState((prev) => {
    const draft = structuredClone(prev);
    const targetGame = draft.games.find((item) => item.id === game.id);
    const before = Boolean(targetGame[key]);
    const runners = runnerSnapshot(targetGame);
    runners[key] = !before;
    createGameEvent(draft, targetGame, {
      eventType: "manual_base_change",
      fromBase: base,
      toBase: base,
      runners,
      description: `${baseLabel(base)}を${before ? "走者なし" : "走者あり"}に変更`,
    });
    draft.screen = "live";
    return draft;
  });
}

function addManualRun() {
  const game = currentGame();
  if (!game) return;
  setState((prev) => {
    const draft = structuredClone(prev);
    const targetGame = draft.games.find((item) => item.id === game.id);
    pushActionHistory(draft, prev, "game_event", targetGame.id);
    createGameEvent(draft, targetGame, {
      eventType: "run_scored",
      runsAdded: 1,
      description: "本塁タップで1点追加",
    });
    draft.screen = "live";
    return draft;
  });
}

function recordSituationEvent() {
  const game = currentGame();
  if (!game) return;
  const eventType = document.querySelector("#situationEventType")?.value || "";
  if (!eventType) {
    alert("状況変化の種類を選択してください。");
    return;
  }
  const outsAdded = Math.max(0, Number(document.querySelector("#situationOuts")?.value || 0));
  const runsAdded = Math.max(0, Number(document.querySelector("#situationRuns")?.value || 0));

  setState((prev) => {
    const draft = structuredClone(prev);
    const targetGame = draft.games.find((item) => item.id === game.id);
    createGameEvent(draft, targetGame, {
      eventType,
      outsAdded,
      runsAdded,
      description: gameEventTypes[eventType] || "状況変化",
    });
    draft.screen = "live";
    return draft;
  });
}

function capitalizeBase(base) {
  return { first: "First", second: "Second", third: "Third" }[base] || "";
}

function undoLastAction() {
  const game = currentGame();
  if (!game) return;
  if (!confirm("直前の入力を取り消しますか？")) return;
  setState((prev) => {
    const draft = structuredClone(prev);
    const history = draft.gameActionHistory || [];
    const actionIndex = history.map((item) => item.gameId).lastIndexOf(game.id);
    if (actionIndex < 0) {
      alert("取り消せる入力がありません。");
      return draft;
    }
    const action = history[actionIndex];
    const restored = structuredClone(action.beforeState);
    restored.gameActionHistory = history.slice(0, actionIndex);
    restored.screen = "live";
    return restored;
  });
}

function substitutePinchHitter() {
  const game = currentGame();
  const incomingPlayerId = document.querySelector("#pinchHitterSelect")?.value;
  if (!game || currentSide(game) !== "self" || !incomingPlayerId) {
    alert("代打選手を選択してください。");
    return;
  }

  setState((prev) => {
    const draft = structuredClone(prev);
    const targetGame = draft.games.find((item) => item.id === game.id);
    const order = normalizeOrder(targetGame.currentBatterOrder);
    const lineup = starterForOrder(draft, targetGame.id, order);
    const outgoingPlayerId = lineup?.currentPlayerId || lineup?.playerId || targetGame.currentBatterId || null;

    if (lineup) {
      lineup.currentPlayerId = incomingPlayerId;
      lineup.playerId = incomingPlayerId;
      lineup.replacedAt = new Date().toISOString();
      lineup.replacedByPlayerId = incomingPlayerId;
    }
    targetGame.currentBatterId = incomingPlayerId;

    const activePa = draft.plateAppearances.find((item) => item.id === targetGame.currentPlateAppearanceId);
    if (activePa) {
      activePa.playerId = incomingPlayerId;
      activePa.batterId = incomingPlayerId;
    }

    draft.substitutions.push({
      id: uid("sub"),
      gameId: targetGame.id,
      inning: targetGame.inning,
      half: targetGame.half,
      halfInning: `${targetGame.inning}_${targetGame.half}`,
      teamType: "self",
      substitutionType: "substitution_pinch_hitter",
      battingOrder: order,
      outgoingPlayerId,
      incomingPlayerId,
      previousPitcherId: null,
      newPitcherId: null,
      createdAt: new Date().toISOString(),
    });

    draft.screen = "live";
    return draft;
  });
}

function substitutePitcher() {
  const game = currentGame();
  if (!game) return;
  const before = defensivePitcherInfo(game);
  const newSelfPitcherId = document.querySelector("#pitcherChangeSelect")?.value || "";
  const newOpponentPitcherName = document.querySelector("#opponentPitcherNameInput")?.value?.trim() || "";

  if (before.isSelfPitcher && !newSelfPitcherId) {
    alert("新しい投手を選択してください。");
    return;
  }
  if (!before.isSelfPitcher && !newOpponentPitcherName) {
    alert("相手の新しい投手名を入力してください。");
    return;
  }

  setState((prev) => {
    const draft = structuredClone(prev);
    const targetGame = draft.games.find((item) => item.id === game.id);
    const defensive = defensivePitcherInfo(targetGame, draft);
    const isHomeDefense = defensive.defensiveHalf === "home";
    const newPitcherId = defensive.isSelfPitcher ? newSelfPitcherId : null;
    const newPitcherName = defensive.isSelfPitcher ? playerNameFromSource(draft, newSelfPitcherId, "未設定") : newOpponentPitcherName;

    if (isHomeDefense) {
      targetGame.currentHomePitcherId = newPitcherId;
      targetGame.currentHomePitcherName = newPitcherId ? "" : newPitcherName;
    } else {
      targetGame.currentAwayPitcherId = newPitcherId;
      targetGame.currentAwayPitcherName = newPitcherId ? "" : newPitcherName;
    }
    if (defensive.isSelfPitcher) {
      targetGame.currentPitcherId = newPitcherId;
      targetGame.currentDefensivePitcherId = newPitcherId;
    } else {
      targetGame.currentDefensivePitcherId = null;
    }

    const activePa = draft.plateAppearances.find((item) => item.id === targetGame.currentPlateAppearanceId);
    if (activePa) {
      activePa.pitcherId = defensive.isSelfPitcher ? newPitcherId : null;
      activePa.pitcherName = newPitcherName;
    }

    draft.substitutions.push({
      id: uid("sub"),
      gameId: targetGame.id,
      inning: targetGame.inning,
      half: targetGame.half,
      halfInning: `${targetGame.inning}_${targetGame.half}`,
      teamType: defensive.isSelfPitcher ? "self" : "opponent",
      substitutionType: "substitution_pitcher",
      battingOrder: null,
      outgoingPlayerId: null,
      incomingPlayerId: null,
      previousPitcherId: defensive.id,
      previousPitcherName: defensive.name,
      newPitcherId,
      newPitcherName,
      createdAt: new Date().toISOString(),
    });

    draft.screen = "live";
    return draft;
  });
}

function exportBackup() {
  const payload = {
    app: "baseball-score-mvp",
    version: 2,
    exportedAt: new Date().toISOString(),
    state,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const date = new Date().toISOString().slice(0, 10);
  link.href = url;
  link.download = `baseball-score-backup-${date}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function importBackup(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(String(reader.result || "{}"));
      const importedState = parsed.state || parsed;
      state = migrateState({ ...structuredClone(initialState), ...importedState });
      saveState();
      render();
      alert("バックアップを復元しました。");
    } catch {
      alert("バックアップファイルを読み込めませんでした。");
    }
  };
  reader.readAsText(file);
}

function render() {
  const app = document.querySelector("#app");
  const game = currentGame();
  app.innerHTML = `
    <div class="app-shell">
      <header class="topbar">
        <div class="topbar-inner">
          <div class="brand">
            <h1>1球速報スコア</h1>
            <div class="game-chip">${game ? `${escapeHtml(game.name)} / ${game.inning}回${halfLabel(game.half)}` : "試合未選択"}</div>
          </div>
          <nav class="tabs">
            ${tab("home", "ホーム")}
            ${tab("players", "選手管理")}
            ${tab("newGame", "試合作成")}
            ${tab("live", "試合入力")}
            ${tab("timeline", "速報")}
            ${tab("stats", "集計")}
          </nav>
        </div>
      </header>
      <main class="main">${screenHtml()}</main>
    </div>
  `;
  bindEvents();
}
function tab(screen, label) {
  return `<button class="tab ${state.screen === screen ? "active" : ""}" data-screen="${screen}">${label}</button>`;
}

function screenHtml() {
  if (state.screen === "players") return playersHtml();
  if (state.screen === "newGame") return newGameHtml();
  if (state.screen === "live") return liveHtml();
  if (state.screen === "timeline") return timelineHtml();
  if (state.screen === "stats") return statsHtml();
  return homeHtml();
}

function homeHtml() {
  return `
    <div class="grid">
      <section class="section span-8">
        <h2>ホーム</h2>
        <p class="muted">選手、試合、打順、投手を登録して、1球ごとの内容と打席結果を記録できます。集計は自チームの攻撃と守備を分けて表示します。</p>
        <div class="score-line">
          <span>選手 ${state.players.length}名</span>
          <span>試合 ${state.games.length}件</span>
          <span>投球 ${state.pitches.length}球</span>
        </div>
      </section>
      <section class="section span-4">
        <h3>最近の試合</h3>
        <div class="list">
          ${state.games.slice(0, 5).map((game) => `
            <div class="list-item">
              <div>
                <strong>${escapeHtml(game.name)}</strong><br>
                <span class="muted">${game.inning}回${halfLabel(game.half)} / 自 ${game.selfScore} - 相 ${game.opponentScore}</span>
              </div>
              <button class="primary" data-pick-game="${game.id}">開く</button>
            </div>
          `).join("") || `<p class="muted">まだ試合がありません。</p>`}
        </div>
      </section>
    </div>
  `;
}

function playersHtml() {
  const editing = state.players.find((player) => player.id === state.editingPlayerId);
  return `
    <div class="grid">
      <section class="section span-6">
        <h2>選手登録</h2>
        <form id="playerForm" class="form-row">
          <label>
            氏名
            <input name="playerName" value="${editing ? escapeAttr(editing.name) : ""}" placeholder="例：山田 太郎" required>
          </label>
          <button class="primary" type="submit">${editing ? "更新" : "登録"}</button>
        </form>
        ${editing ? `<button class="secondary" data-cancel-edit="1">編集をやめる</button>` : ""}
      </section>
      <section class="section span-6">
        <h2>登録選手</h2>
        <div class="list">
          ${state.players.map((player, index) => `
            <div class="list-item">
              <div><strong>${index + 1}. ${escapeHtml(player.name)}</strong></div>
              <div class="actions">
                <button class="secondary" data-edit-player="${player.id}">編集</button>
                <button class="danger" data-delete-player="${player.id}">削除</button>
              </div>
            </div>
          `).join("") || `<p class="muted">選手を登録してください。</p>`}
        </div>
      </section>
    </div>
  `;
}

function playerOptions(selectedId = "") {
  return `<option value="">選択</option>${state.players.map((player) => `<option value="${player.id}" ${player.id === selectedId ? "selected" : ""}>${escapeHtml(player.name)}</option>`).join("")}`;
}

function newGameHtml() {
  const canCreate = state.players.length >= 9;
  return `
    <div class="grid">
      <section class="section span-8">
        <h2>試合作成</h2>
        ${canCreate ? "" : `<p class="notice">打順登録には選手が9名以上必要です。先に選手管理で登録してください。</p>`}
        <form id="gameForm" class="form-stack">
          <label>
            試合名
            <input name="gameName" placeholder="例：練習試合 vs A高校">
          </label>
          <label>
            自チーム
            <select name="battingOrder">
              <option value="top">先攻</option>
              <option value="bottom">後攻</option>
            </select>
          </label>
          <label>
            先発ピッチャー
            <select name="startingPitcherId">${playerOptions()}</select>
          </label>
          <label>
            相手先発投手名
            <input name="opponentStartingPitcherName" placeholder="例：佐藤">
          </label>
          <h3>打順登録</h3>
          <div class="lineup-grid">
            ${Array.from({ length: 9 }, (_, index) => `
              <label>
                ${index + 1}番
                <select name="starter${index + 1}">${playerOptions()}</select>
              </label>
            `).join("")}
          </div>
          <h3>ベンチ入り選手</h3>
          <div class="bench-grid">
            ${state.players.map((player) => `
              <label class="check-row">
                <input type="checkbox" name="benchPlayer" value="${player.id}">
                <span>${escapeHtml(player.name)}</span>
              </label>
            `).join("") || `<p class="muted">選手が未登録です。</p>`}
          </div>
          <button class="primary" type="submit" ${canCreate ? "" : "disabled"}>試合開始</button>
        </form>
      </section>
      <section class="section span-4">
        <h2>試合一覧</h2>
        <div class="list">
          ${state.games.map((game) => `
            <div class="list-item">
              <div>
                <strong>${escapeHtml(game.name)}</strong><br>
                <span class="muted">${game.battingOrder === "top" ? "自チーム先攻" : "自チーム後攻"} / 自 ${game.selfScore} - 相 ${game.opponentScore}</span><br>
                <span class="muted">先発 ${playerName(game.startingPitcherId, "未設定")}</span>
              </div>
              <button class="primary" data-pick-game="${game.id}">開く</button>
            </div>
          `).join("") || `<p class="muted">まだ試合がありません。</p>`}
        </div>
      </section>
    </div>
  `;
}

function liveHtml() {
  const game = currentGame();
  if (!game) return `<section class="section"><h2>試合入力</h2><p class="notice">先に試合を作成してください。</p></section>`;
  const batter = currentBatter(game);
  const pitcher = defensivePitcherInfo(game);
  const side = currentSide(game);
  const orderLabel = side === "self" ? `${normalizeOrder(game.currentBatterOrder)}番` : "相手打順";
  const inningText = `${game.inning}回${halfLabel(game.half)}`;

  return `
    <div class="live-layout">
      <section class="scoreboard-panel live-sticky">
        ${runningScoreHtml(game)}
      </section>
      <section class="game-now-panel">
        <div class="inning-now">${inningText}</div>
        <div class="game-now-grid">
          <div class="bso-board">
            ${bsoRow("B", Math.min(game.balls, 3), 3, "ball")}
            ${bsoRow("S", Math.min(game.strikes, 2), 2, "strike")}
            ${bsoRow("O", Math.min(game.outs, 2), 2, "out")}
          </div>
          <div class="player-now">
            <p><span>打者</span><strong>${side === "self" ? `${orderLabel} ${batter ? escapeHtml(batter.name) : "未設定"}` : "相手打者"}</strong></p>
            <p><span>投手</span><strong>${escapeHtml(pitcher.name)}</strong></p>
          </div>
        </div>
        ${side === "self" && !batter ? `<p class="notice">この試合の打順が見つかりません。新しい試合では1〜9番を登録してください。</p>` : ""}
      </section>
      <section class="section live-substitution-panel">
        <h3>選手交代</h3>
        <div class="substitution-grid">
          <div class="substitution-box">
            <label>
              代打
              <select id="pinchHitterSelect" ${side === "self" ? "" : "disabled"}>${pinchHitterOptions(game)}</select>
            </label>
            <button class="secondary" data-pinch-hit="1" ${side === "self" ? "" : "disabled"}>代打を実行</button>
          </div>
          <div class="substitution-box">
            ${pitcherChangeControl(pitcher)}
            <button class="secondary" data-pitcher-change="1">投手交代</button>
          </div>
        </div>
      </section>
      <section class="section live-input-panel">
        <h3>1球入力</h3>
        <div class="button-grid">
          <button class="primary" data-pitch="called">見逃しストライク</button>
          <button class="primary" data-pitch="swinging">空振りストライク</button>
          <button class="secondary" data-pitch="ball">ボール</button>
          <button class="warning" data-pitch="foul">ファール</button>
        </div>
      </section>
      <section class="section live-result-panel">
        <h3>打席結果入力</h3>
        <label>
          この打席の得点
          <input id="runsInput" type="number" min="0" value="${state.pendingRuns || 0}">
        </label>
        <div class="result-grid" style="margin-top: 10px;">
          ${Object.entries(resultTypes).filter(([key]) => !["strikeout", "walk"].includes(key)).map(([key, value]) => `<button class="${value.out ? "danger" : value.hit ? "success" : "secondary"}" data-result="${key}">${value.label}</button>`).join("")}
        </div>
      </section>
      <section class="section live-event-panel">
        <h3>状況変化</h3>
        <div class="situation-grid">
          <label>
            種類
            <select id="situationEventType">
              <option value="">選択</option>
              ${simpleSituationOptions()}
            </select>
          </label>
          <label>
            アウト増加
            <select id="situationOuts">
              <option value="0">0</option>
              <option value="1">1</option>
              <option value="2">2</option>
              <option value="3">3</option>
            </select>
          </label>
          <label>
            得点
            <select id="situationRuns">
              <option value="0">0</option>
              <option value="1">1</option>
              <option value="2">2</option>
              <option value="3">3</option>
              <option value="4">4</option>
            </select>
          </label>
        </div>
        <div class="actions situation-actions">
          <button class="accent" data-situation-event="1">状況変化を記録</button>
          <button class="secondary" data-undo-action="1">直前の入力を取り消す</button>
        </div>
      </section>
    </div>
  `;
}

function runningScoreHtml(game) {
  const innings = Array.from({ length: 9 }, (_, index) => index + 1);
  const topRowTeamType = game.battingOrder === "top" ? "self" : "opponent";
  const bottomRowTeamType = topRowTeamType === "self" ? "opponent" : "self";
  const scoreRow = (teamType) => `
    <tr>
      <th>${teamType === "self" ? "自" : "相"}</th>
      ${innings.map((inning) => scoreCell(game, teamType, inning)).join("")}
      <td class="total">${teamType === "self" ? game.selfScore : game.opponentScore}</td>
    </tr>
  `;
  return `
    <div class="scoreboard-title">ランニングスコア</div>
    <div class="scoreboard-scroll">
      <table class="running-score">
        <thead>
          <tr><th></th>${innings.map((inning) => `<th>${inning}</th>`).join("")}<th>計</th></tr>
        </thead>
        <tbody>
          ${scoreRow(topRowTeamType)}
          ${scoreRow(bottomRowTeamType)}
        </tbody>
      </table>
    </div>
  `;
}

function scoreCell(game, teamType, inning) {
  const teamHalf = teamType === "self" ? game.battingOrder : (game.battingOrder === "top" ? "bottom" : "top");
  const active = game.inning === inning && game.half === teamHalf;
  const value = inningScore(game, teamType, inning);
  const shouldShow = inningShouldShow(game, teamHalf, inning) || value > 0;
  return `<td class="${active ? "active-inning" : ""}">${shouldShow ? value : ""}</td>`;
}

function inningScore(game, teamType, inning) {
  const battingRuns = state.battingResults
    .filter((result) => result.gameId === game.id && result.battingTeamType === teamType)
    .filter((result) => {
      const pa = state.plateAppearances.find((item) => item.id === result.plateAppearanceId);
      return pa && Number(pa.inning) === Number(inning);
    })
    .reduce((total, result) => total + Number(result.runs || 0), 0);
  const eventRuns = state.gameEvents
    .filter((event) => event.gameId === game.id && event.battingTeamType === teamType && Number(event.inning) === Number(inning))
    .reduce((total, event) => total + Number(event.runsAdded || 0), 0);
  return battingRuns + eventRuns;
}

function inningShouldShow(game, half, inning) {
  if (inning < game.inning) return true;
  if (inning > game.inning) return false;
  if (game.half === half) return true;
  return game.half === "bottom" && half === "top";
}

function bsoRow(label, count, max, type) {
  return `
    <div class="bso-row">
      <span class="bso-label">${label}</span>
      <span class="bso-lamps">
        ${Array.from({ length: max }, (_, index) => `<span class="lamp ${index < count ? `on ${type}` : ""}"></span>`).join("")}
      </span>
    </div>
  `;
}

function baseDiamondHtml(game) {
  return `
    <div class="base-diamond" aria-label="走者状況">
      <button class="base base-second ${game.runnerOnSecond ? "occupied" : ""}" data-base-toggle="second" title="二塁">二</button>
      <button class="base base-third ${game.runnerOnThird ? "occupied" : ""}" data-base-toggle="third" title="三塁">三</button>
      <button class="base base-first ${game.runnerOnFirst ? "occupied" : ""}" data-base-toggle="first" title="一塁">一</button>
      <button class="base base-home" data-base-toggle="home" title="本塁をタップで1点">本</button>
    </div>
  `;
}

function baseOptions() {
  return `
    <option value="">選択なし</option>
    <option value="first">一塁</option>
    <option value="second">二塁</option>
    <option value="third">三塁</option>
    <option value="home">本塁</option>
  `;
}

function timelineItems(game) {
  return [
    ...state.pitches.filter((pitch) => pitch.gameId === game.id).map((pitch) => ({ kind: "pitch", createdAt: pitch.createdAt, item: pitch })),
    ...state.battingResults.filter((result) => result.gameId === game.id).map((result) => ({ kind: "result", createdAt: result.createdAt, item: result })),
    ...state.substitutions.filter((substitution) => substitution.gameId === game.id).map((substitution) => ({ kind: "substitution", createdAt: substitution.createdAt, item: substitution })),
    ...state.gameEvents.filter((event) => event.gameId === game.id).map((event) => ({ kind: "event", createdAt: event.createdAt, item: event })),
  ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function timelineListHtml(game, limit = null) {
  const items = timelineItems(game);
  const visible = limit ? items.slice(0, limit) : items;
  return `
    <div class="timeline">
      ${visible.map((entry) => entry.kind === "pitch" ? pitchTimeline(entry.item) : entry.kind === "result" ? resultTimeline(entry.item) : entry.kind === "substitution" ? substitutionTimeline(entry.item) : gameEventTimeline(entry.item)).join("") || `<p class="muted">まだ記録がありません。</p>`}
    </div>
  `;
}

function pinchHitterOptions(game) {
  const current = currentBatter(game);
  return `<option value="">選択</option>${state.players
    .filter((player) => player.id !== current?.id)
    .map((player) => `<option value="${player.id}">${escapeHtml(player.name)}</option>`)
    .join("")}`;
}

function pitcherChangeControl(pitcher) {
  if (pitcher.isSelfPitcher) {
    return `
      <label>
        新しい投手
        <select id="pitcherChangeSelect">
          <option value="">選択</option>
          ${state.players
            .filter((player) => player.id !== pitcher.id)
            .map((player) => `<option value="${player.id}">${escapeHtml(player.name)}</option>`)
            .join("")}
        </select>
      </label>
    `;
  }
  return `
    <label>
      相手の新しい投手
      <input id="opponentPitcherNameInput" placeholder="例：佐藤">
    </label>
  `;
}

function stat(label, value) {
  return `<div class="stat-box"><div class="stat-label">${label}</div><div class="stat-value">${value}</div></div>`;
}

function timelineHtml() {
  const game = currentGame();
  if (!game) return `<section class="section"><h2>速報タイムライン</h2><p class="notice">試合を選択してください。</p></section>`;
  const plateItems = state.plateAppearances
    .filter((pa) => pa.gameId === game.id && pa.resultId)
    .map((pa) => ({ kind: "plate", createdAt: state.battingResults.find((result) => result.id === pa.resultId)?.createdAt || pa.startedAt, item: pa, order: state.plateAppearances.findIndex((item) => item.id === pa.id) }));
  const eventItems = [
    ...state.gameEvents.filter((event) => event.gameId === game.id).map((event) => ({ kind: "event", createdAt: event.createdAt, item: event, order: state.gameEvents.findIndex((item) => item.id === event.id) })),
    ...state.substitutions.filter((substitution) => substitution.gameId === game.id).map((substitution) => ({ kind: "substitution", createdAt: substitution.createdAt, item: substitution, order: state.substitutions.findIndex((item) => item.id === substitution.id) })),
  ];
  const items = [...plateItems, ...eventItems].sort((a, b) => {
    const byTime = new Date(b.createdAt) - new Date(a.createdAt);
    return byTime || b.order - a.order;
  });
  return `
    <section class="section">
      <h2>速報タイムライン</h2>
      <div class="plate-timeline">
        ${items.map((entry) => entry.kind === "plate" ? plateAppearanceCard(entry.item, game) : entry.kind === "event" ? gameEventTimeline(entry.item) : substitutionTimeline(entry.item)).join("") || `<p class="muted">まだ記録がありません。</p>`}
      </div>
    </section>
  `;
}

function plateAppearanceCard(pa, game) {
  const result = state.battingResults.find((item) => item.id === pa.resultId);
  const pitches = state.pitches
    .filter((pitch) => pitch.plateAppearanceId === pa.id)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  const batterLabel = pa.battingTeamType === "self"
    ? `${battingOrderLabel(game, pa.batterId)}${playerName(pa.batterId, "未設定")}`
    : "相手打者";
  return `
    <details class="plate-card">
      <summary>
        <span>${pa.inning}回${halfLabel(pa.half)}</span>
        <strong>${batterLabel}：${result?.label || "結果未設定"}</strong>
      </summary>
      <div class="pitch-detail">
        <div class="muted">投球内容</div>
        ${pitches.length ? pitches.map((pitch, index) => `<div>${index + 1}球目　${pitch.label}</div>`).join("") : `<div class="muted">投球記録なし</div>`}
      </div>
    </details>
  `;
}

function battingOrderLabel(game, playerId) {
  const lineup = state.gameLineups.find((item) => item.gameId === game.id && (item.currentPlayerId === playerId || item.playerId === playerId || item.originalPlayerId === playerId));
  return lineup?.battingOrder ? `${lineup.battingOrder}番 ` : "";
}

function pitchTimeline(pitch) {
  const pa = state.plateAppearances.find((item) => item.id === pitch.plateAppearanceId);
  return `
    <div class="timeline-item">
      <strong>${pitch.label}</strong>
      <div class="muted">${pa ? `${pa.inning}回${halfLabel(pa.half)} ${playerName(pa.batterId)}` : ""} / 投手 ${pitch.pitcherName || playerName(pitch.pitcherId, "なし")} / ${pitch.countBefore.balls}-${pitch.countBefore.strikes} → ${pitch.countAfter.balls}-${pitch.countAfter.strikes}</div>
    </div>
  `;
}

function resultTimeline(result) {
  const pa = state.plateAppearances.find((item) => item.id === result.plateAppearanceId);
  return `
    <div class="timeline-item">
      <strong>打席結果：${result.label}</strong>
      <div class="muted">${pa ? `${pa.inning}回${halfLabel(pa.half)} ${playerName(result.batterId)}` : ""} / 投手 ${result.pitcherName || playerName(result.pitcherId, "なし")} / 得点 ${result.runs}</div>
    </div>
  `;
}

function substitutionTimeline(substitution) {
  if (substitution.substitutionType === "substitution_pinch_hitter") {
    return `
      <div class="timeline-item substitution-event">
        <strong>代打</strong>
        <div class="muted">${substitution.inning}回${halfLabel(substitution.half)} ${substitution.battingOrder}番 ${playerName(substitution.outgoingPlayerId, "未設定")}に代わり、代打 ${playerName(substitution.incomingPlayerId, "未設定")}</div>
      </div>
    `;
  }
  return `
    <div class="timeline-item substitution-event">
      <strong>投手交代</strong>
      <div class="muted">${substitution.inning}回${halfLabel(substitution.half)} 投手 ${substitution.previousPitcherName || playerName(substitution.previousPitcherId, "未設定")}に代わり、${substitution.newPitcherName || playerName(substitution.newPitcherId, "未設定")}</div>
    </div>
  `;
}

function runnerStateText(event) {
  const parts = [];
  if (event.outsAdded) parts.push(`${event.outsAdded}アウト追加`);
  if (event.fromBase) parts.push(`${baseLabel(event.fromBase)}から`);
  if (event.toBase) parts.push(`${baseLabel(event.toBase)}へ`);
  if (event.runsAdded) parts.push(`${event.runsAdded}点`);
  return parts.join(" / ");
}

function gameEventTimeline(event) {
  const label = gameEventTypes[event.eventType] || "状況変化";
  const player = event.relatedPlayerId ? `${playerName(event.relatedPlayerId, "対象選手")}、` : "";
  const detail = event.description || runnerStateText(event);
  return `
    <div class="timeline-item game-event">
      <strong>${label}</strong>
      <div class="muted">${event.inning}回${halfLabel(event.half)} ${player}${detail}</div>
    </div>
  `;
}

function statsHtml() {
  const game = currentGame();
  if (!game) return `<section class="section"><h2>集計</h2><p class="notice">試合を選択してください。</p></section>`;
  return `
    <div class="grid">
      <section class="section span-12">
        <h2>集計</h2>
        <div class="score-line"><span>自チーム ${game.selfScore}</span><span>相手 ${game.opponentScore}</span><span>${game.inning}回${halfLabel(game.half)}</span></div>
        <div class="subtabs">
          <button class="${state.statsTab === "batting" ? "primary" : "secondary"}" data-stats-tab="batting">打撃集計</button>
          <button class="${state.statsTab === "pitching" ? "primary" : "secondary"}" data-stats-tab="pitching">投手集計</button>
        </div>
      </section>
      ${state.statsTab === "pitching" ? pitchingStatsHtml(game) : battingStatsHtml(game)}
      <section class="section span-12">
        <h3>管理</h3>
        <div class="actions">
          <button class="secondary" data-export-backup="1">JSONバックアップを書き出す</button>
          <label class="file-button">
            JSONバックアップを読み込む
            <input type="file" accept="application/json,.json" data-import-backup="1">
          </label>
        </div>
        <p class="muted">端末故障に備えて、試合後にJSONバックアップをファイルへ保存してください。</p>
        <button class="danger" data-reset="1">全データ削除</button>
      </section>
    </div>
  `;
}

function battingStatsHtml(game) {
  const rows = battingRows(game);
  return `
    <section class="section span-12">
      <h3>自チーム打撃集計</h3>
      <div class="table-wrap">
        <table>
          <thead><tr><th>選手</th><th>打席</th><th>打数</th><th>安打</th><th>単打</th><th>二塁打</th><th>三塁打</th><th>本塁打</th><th>三振</th><th>四球</th><th>死球</th><th>犠打</th><th>併殺</th><th>失策出塁</th><th>盗塁</th><th>盗塁死</th><th>打点</th><th>得点</th><th>打率</th><th>出塁率</th><th>OPS</th><th>コンタクト率</th></tr></thead>
          <tbody>${rows.map((row) => `<tr><td>${escapeHtml(row.name)}</td><td>${row.pa}</td><td>${row.ab}</td><td>${row.hits}</td><td>${row.single}</td><td>${row.double}</td><td>${row.triple}</td><td>${row.homerun}</td><td>${row.strikeouts}</td><td>${row.walks}</td><td>${row.hbp}</td><td>${row.sacrifice}</td><td>${row.doubleplay}</td><td>${row.errorReach}</td><td>${row.steals}</td><td>${row.caughtStealing}</td><td>${row.rbi}</td><td>${row.runs}</td><td>${formatRate(row.avg)}</td><td>${formatRate(row.obp)}</td><td>${formatRate(row.ops)}</td><td>${formatPercent(row.contactRate)}</td></tr>`).join("")}</tbody>
        </table>
      </div>
    </section>
  `;
}

function pitchingStatsHtml(game) {
  const rows = pitchingRows(game);
  return `
    <section class="section span-12">
      <h3>自チーム投手集計</h3>
      <div class="table-wrap">
        <table>
          <thead><tr><th>投手</th><th>投球数</th><th>見逃し</th><th>空振り</th><th>ボール</th><th>ストライク率</th><th>初球ストライク率</th><th>奪三振</th><th>与四球</th><th>与死球</th><th>被安打</th><th>被本塁打</th><th>暴投</th><th>ボーク</th><th>失点</th><th>自責点</th></tr></thead>
          <tbody>${rows.map((row) => `<tr><td>${escapeHtml(row.name)}</td><td>${row.pitchCount}</td><td>${row.called}</td><td>${row.swinging}</td><td>${row.ball}</td><td>${formatPercent(row.strikeRate)}</td><td>${formatPercent(row.firstPitchStrikeRate)}</td><td>${row.strikeouts}</td><td>${row.walks}</td><td>${row.hbp}</td><td>${row.hits}</td><td>${row.homerun}</td><td>${row.wildPitch}</td><td>${row.balk}</td><td>${row.runs}</td><td>${row.earnedRuns}</td></tr>`).join("")}</tbody>
        </table>
      </div>
    </section>
  `;
}

function battingRows(game) {
  const lineupPlayerIds = lineupsForGame(game.id).filter((lineup) => lineup.isStarter || lineup.isBench).map((lineup) => lineup.playerId);
  const eventPlayerIds = state.gameEvents.filter((event) => event.gameId === game.id && event.battingTeamType === "self").map((event) => event.relatedPlayerId).filter(Boolean);
  const ids = [...new Set([...lineupPlayerIds, ...state.battingResults.filter((result) => result.gameId === game.id && result.battingTeamType === "self").map((result) => result.batterId).filter(Boolean), ...eventPlayerIds])];
  return ids.map((playerId) => {
    const results = state.battingResults.filter((result) => result.gameId === game.id && result.battingTeamType === "self" && result.batterId === playerId);
    const events = state.gameEvents.filter((event) => event.gameId === game.id && event.battingTeamType === "self" && event.relatedPlayerId === playerId);
    const row = {
      name: playerName(playerId, "未設定"),
      pa: results.length,
      ab: results.filter((result) => resultTypes[result.type]?.ab).length,
      hits: results.filter((result) => resultTypes[result.type]?.hit).length,
      single: results.filter((result) => result.type === "single").length,
      double: results.filter((result) => result.type === "double").length,
      triple: results.filter((result) => result.type === "triple").length,
      homerun: results.filter((result) => result.type === "homerun").length,
      strikeouts: results.filter((result) => result.type === "strikeout").length,
      walks: results.filter((result) => result.type === "walk").length,
      hbp: results.filter((result) => result.type === "hbp").length,
      sacrifice: results.filter((result) => result.type === "sacrifice").length,
      doubleplay: results.filter((result) => result.type === "doubleplay").length,
      errorReach: results.filter((result) => result.type === "error").length,
      steals: events.filter((event) => event.eventType === "steal_success").length,
      caughtStealing: events.filter((event) => event.eventType === "caught_stealing").length,
      rbi: sum(results, "rbi"),
      runs: sum(results, "runsScored") + sum(events.filter((event) => event.eventType === "run_scored"), "runsAdded"),
      totalBases: 0,
      avg: 0,
      obp: 0,
      slg: 0,
      ops: 0,
      contactRate: 0,
    };
    row.totalBases = row.single + row.double * 2 + row.triple * 3 + row.homerun * 4;
    row.avg = row.ab ? row.hits / row.ab : null;
    const obpDenominator = row.ab + row.walks + row.hbp;
    row.obp = obpDenominator ? (row.hits + row.walks + row.hbp) / obpDenominator : null;
    row.slg = row.ab ? row.totalBases / row.ab : null;
    row.ops = row.obp !== null && row.slg !== null ? row.obp + row.slg : null;
    row.contactRate = row.pa ? (row.pa - row.strikeouts) / row.pa : null;
    return row;
  });
}

function pitchingRows(game) {
  const pitcherIds = [...new Set([
    game.startingPitcherId,
    game.currentPitcherId,
    ...state.pitches.filter((pitch) => pitch.gameId === game.id && pitch.pitcherId).map((pitch) => pitch.pitcherId),
    ...state.battingResults.filter((result) => result.gameId === game.id && result.battingTeamType === "opponent" && result.pitcherId).map((result) => result.pitcherId),
    ...state.gameEvents.filter((event) => event.gameId === game.id && event.battingTeamType === "opponent" && event.pitcherId).map((event) => event.pitcherId),
  ].filter(Boolean))];

  return pitcherIds.map((pitcherId) => {
    const pitches = state.pitches.filter((pitch) => pitch.gameId === game.id && pitch.pitcherId === pitcherId);
    const results = state.battingResults.filter((result) => result.gameId === game.id && result.battingTeamType === "opponent" && result.pitcherId === pitcherId);
    const events = state.gameEvents.filter((event) => event.gameId === game.id && event.battingTeamType === "opponent" && event.pitcherId === pitcherId);
    const plateAppearances = state.plateAppearances.filter((pa) => pa.gameId === game.id && pa.battingTeamType === "opponent" && pa.pitcherId === pitcherId && pa.result);
    const strikePitches = pitches.filter(isStrikePitch);
    const ballPitches = pitches.filter(isBallPitch);
    const firstPitchStrikeCount = plateAppearances.filter((pa) => {
      const firstPitch = state.pitches
        .filter((pitch) => pitch.plateAppearanceId === pa.id)
        .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))[0];
      return firstPitch ? isStrikePitch(firstPitch) : false;
    }).length;
    return {
      name: playerName(pitcherId, "未設定"),
      pitchCount: pitches.length,
      called: pitches.filter((pitch) => pitch.type === "called").length,
      swinging: pitches.filter((pitch) => pitch.type === "swinging").length,
      ball: ballPitches.length,
      strikeRate: pitches.length ? strikePitches.length / pitches.length : null,
      firstPitchStrikeRate: plateAppearances.length ? firstPitchStrikeCount / plateAppearances.length : null,
      strikeouts: results.filter((result) => result.type === "strikeout").length,
      walks: results.filter((result) => result.type === "walk").length,
      hbp: results.filter((result) => result.type === "hbp").length,
      hits: results.filter((result) => resultTypes[result.type]?.hit).length,
      homerun: results.filter((result) => result.type === "homerun").length,
      wildPitch: events.filter((event) => event.eventType === "wild_pitch").length,
      balk: events.filter((event) => event.eventType === "balk").length,
      runs: sum(results, "runs") + sum(events, "runsAdded"),
      earnedRuns: sum(results, "earnedRuns"),
    };
  });
}

function isStrikePitch(pitch) {
  if (["called", "swinging", "foul", "inplay"].includes(pitch.type)) return true;
  if (pitch.type === "result") return !["walk", "hbp"].includes(pitch.resultType);
  return false;
}

function isBallPitch(pitch) {
  if (pitch.type === "ball") return true;
  return pitch.type === "result" && ["walk", "hbp"].includes(pitch.resultType);
}

function sum(items, key) {
  return items.reduce((total, item) => total + Number(item[key] || 0), 0);
}

function formatRate(value) {
  if (value === null || Number.isNaN(value)) return "-";
  return value.toFixed(3).replace(/^0/, "");
}

function formatPercent(value) {
  if (value === null || Number.isNaN(value)) return "-";
  return `${Math.round(value * 1000) / 10}%`;
}

function bindEvents() {
  document.querySelectorAll("[data-screen]").forEach((button) => {
    button.addEventListener("click", () => setState((prev) => ({ ...prev, screen: button.dataset.screen })));
  });
  document.querySelector("#playerForm")?.addEventListener("submit", savePlayer);
  document.querySelector("#gameForm")?.addEventListener("submit", createGame);
  document.querySelectorAll("[data-edit-player]").forEach((button) => {
    button.addEventListener("click", () => setState((prev) => ({ ...prev, editingPlayerId: button.dataset.editPlayer })));
  });
  document.querySelectorAll("[data-delete-player]").forEach((button) => {
    button.addEventListener("click", () => deletePlayer(button.dataset.deletePlayer));
  });
  document.querySelector("[data-cancel-edit]")?.addEventListener("click", () => setState((prev) => ({ ...prev, editingPlayerId: null })));
  document.querySelectorAll("[data-pick-game]").forEach((button) => {
    button.addEventListener("click", () => pickGame(button.dataset.pickGame));
  });
  document.querySelectorAll("[data-pitch]").forEach((button) => {
    button.addEventListener("click", () => recordPitch(button.dataset.pitch));
  });
  document.querySelectorAll("[data-result]").forEach((button) => {
    button.addEventListener("click", () => submitResult(button.dataset.result));
  });
  document.querySelector("[data-pinch-hit]")?.addEventListener("click", substitutePinchHitter);
  document.querySelector("[data-pitcher-change]")?.addEventListener("click", substitutePitcher);
  document.querySelector("[data-situation-event]")?.addEventListener("click", recordSituationEvent);
  document.querySelector("[data-undo-action]")?.addEventListener("click", undoLastAction);
  document.querySelectorAll("[data-stats-tab]").forEach((button) => {
    button.addEventListener("click", () => setStatsTab(button.dataset.statsTab));
  });
  document.querySelector("[data-export-backup]")?.addEventListener("click", exportBackup);
  document.querySelector("[data-import-backup]")?.addEventListener("change", (event) => importBackup(event.target.files?.[0]));
  document.querySelector("[data-reset]")?.addEventListener("click", resetDemoData);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}

async function bootstrap() {
  state = await loadState();
  saveState();
  render();
  registerServiceWorker();
}

bootstrap().catch((error) => {
  console.error(error);
  state = structuredClone(initialState);
  render();
});


