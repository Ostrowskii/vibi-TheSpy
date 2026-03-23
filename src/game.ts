import { VibiNet } from "vibinet";
import type {
  CardKind,
  CardState,
  MatchState,
  Participant,
  PlayerSlot,
  RevealState,
  Role,
  RoomPost,
  RoomState,
  RoundSummary,
  Seat,
} from "./types";

const MAX_CHAT_MESSAGES = 120;
const BOT_ID = "bot-cipher";
const BOT_NAME = "Cipher Bot";

const matchPostPacker: VibiNet.Packed = {
  $: "Union",
  variants: {
    join: {
      $: "Struct",
      fields: {
        id: { $: "String" },
        name: { $: "String" },
        isBot: { $: "UInt", size: 1 },
      },
    },
    leave: {
      $: "Struct",
      fields: {
        id: { $: "String" },
      },
    },
    chat: {
      $: "Struct",
      fields: {
        id: { $: "String" },
        name: { $: "String" },
        text: { $: "String" },
      },
    },
    ready: {
      $: "Struct",
      fields: {
        id: { $: "String" },
        name: { $: "String" },
        isBot: { $: "UInt", size: 1 },
      },
    },
    choose: {
      $: "Struct",
      fields: {
        id: { $: "String" },
        cardId: { $: "String" },
      },
    },
    advance: {
      $: "Struct",
      fields: {
        id: { $: "String" },
      },
    },
  },
};

const roleNames: Record<Role, string> = {
  commander_spy: "Comandante Espiao",
  government_informant: "Informante do Governo",
};

const initialState = (roomId: string): RoomState => ({
  roomId,
  participants: {},
  participantOrder: [],
  chat: [],
  chatCounter: 0,
  systemCounter: 0,
  match: createWaitingMatch(1),
});

function createWaitingMatch(matchId: number): MatchState {
  return {
    matchId,
    status: "waiting",
    p1Id: null,
    p2Id: null,
    roundIndex: 0,
    turn: null,
    hands: {
      p1: [],
      p2: [],
    },
    selectedCardIds: {
      p1: null,
      p2: null,
    },
    reveal: null,
    roundSummaries: [],
    totals: {
      p1: 0,
      p2: 0,
    },
    winner: null,
  };
}

function roleForRound(roundIndex: number, slot: PlayerSlot): Role {
  const p1Role = roundIndex % 2 === 0 ? "government_informant" : "commander_spy";
  if (slot === "p1") {
    return p1Role;
  }

  return p1Role === "government_informant" ? "commander_spy" : "government_informant";
}

function deckForRole(role: Role): CardState[] {
  if (role === "commander_spy") {
    return [
      { id: "spy-1", kind: "spy", used: false },
      { id: "agent-1", kind: "agent", used: false },
      { id: "agent-2", kind: "agent", used: false },
      { id: "agent-3", kind: "agent", used: false },
      { id: "agent-4", kind: "agent", used: false },
    ];
  }

  return [
    { id: "true-file-1", kind: "true_file", used: false },
    { id: "false-file-1", kind: "false_file", used: false },
    { id: "false-file-2", kind: "false_file", used: false },
    { id: "false-file-3", kind: "false_file", used: false },
    { id: "false-file-4", kind: "false_file", used: false },
  ];
}

function cloneCard(card: CardState): CardState {
  return {
    id: card.id,
    kind: card.kind,
    used: card.used,
  };
}

function cloneMatch(match: MatchState): MatchState {
  return {
    matchId: match.matchId,
    status: match.status,
    p1Id: match.p1Id,
    p2Id: match.p2Id,
    roundIndex: match.roundIndex,
    turn: match.turn,
    hands: {
      p1: match.hands.p1.map(cloneCard),
      p2: match.hands.p2.map(cloneCard),
    },
    selectedCardIds: {
      p1: match.selectedCardIds.p1,
      p2: match.selectedCardIds.p2,
    },
    reveal: match.reveal
      ? {
          p1Card: match.reveal.p1Card,
          p2Card: match.reveal.p2Card,
          points: { ...match.reveal.points },
          roundEnded: match.reveal.roundEnded,
          summary: match.reveal.summary,
          comboLabel: match.reveal.comboLabel,
        }
      : null,
    roundSummaries: match.roundSummaries.map((summary) => ({ ...summary })),
    totals: { ...match.totals },
    winner: match.winner,
  };
}

function cloneState(state: RoomState): RoomState {
  return {
    roomId: state.roomId,
    participants: Object.fromEntries(
      Object.entries(state.participants).map(([id, participant]) => [id, { ...participant }]),
    ),
    participantOrder: [...state.participantOrder],
    chat: state.chat.map((message) => ({ ...message })),
    chatCounter: state.chatCounter,
    systemCounter: state.systemCounter,
    match: cloneMatch(state.match),
  };
}

function ensureParticipant(
  state: RoomState,
  participant: {
    id: string;
    name: string;
    isBot: boolean;
  },
): void {
  const cleanName = participant.name.trim().slice(0, 24) || "Operador";
  const existing = state.participants[participant.id];
  if (existing) {
    existing.name = cleanName;
    existing.isBot = participant.isBot;
    return;
  }

  const joinedAt = state.participantOrder.length + 1;
  state.participants[participant.id] = {
    id: participant.id,
    name: cleanName,
    joinedAt,
    isBot: participant.isBot,
  };
  state.participantOrder.push(participant.id);
}

function systemMessage(state: RoomState, text: string): void {
  state.systemCounter += 1;
  state.chatCounter += 1;
  const nextMessage: RoomState["chat"][number] = {
    id: state.chatCounter,
    authorId: "system",
    authorName: "Central",
    text,
    kind: "system",
  };
  state.chat = [...state.chat, nextMessage].slice(-MAX_CHAT_MESSAGES);
}

function userMessage(state: RoomState, post: Extract<RoomPost, { $: "chat" }>): void {
  const clean = post.text.trim().replace(/\s+/g, " ").slice(0, 220);
  if (!clean) {
    return;
  }

  state.chatCounter += 1;
  const nextMessage: RoomState["chat"][number] = {
    id: state.chatCounter,
    authorId: post.id,
    authorName: post.name.trim().slice(0, 24) || "Operador",
    text: clean,
    kind: "user",
  };
  state.chat = [...state.chat, nextMessage].slice(-MAX_CHAT_MESSAGES);
}
function playerSeat(match: MatchState, id: string): Seat {
  if (match.p1Id === id) {
    return "p1";
  }
  if (match.p2Id === id) {
    return "p2";
  }
  return "spectator";
}

function startRound(match: MatchState): void {
  match.status = "playing";
  match.turn = "p1";
  match.hands = {
    p1: deckForRole(roleForRound(match.roundIndex, "p1")),
    p2: deckForRole(roleForRound(match.roundIndex, "p2")),
  };
  match.selectedCardIds = {
    p1: null,
    p2: null,
  };
  match.reveal = null;
}

function startMatchFromSeats(match: MatchState): void {
  if (!match.p1Id || !match.p2Id) {
    return;
  }
  match.roundIndex = 0;
  match.roundSummaries = [];
  match.totals = { p1: 0, p2: 0 };
  match.winner = null;
  startRound(match);
}

function availableCard(match: MatchState, slot: PlayerSlot, cardId: string): CardState | null {
  const found = match.hands[slot].find((card) => card.id === cardId);
  if (!found || found.used) {
    return null;
  }
  return found;
}

function labelCard(card: CardKind): string {
  switch (card) {
    case "spy":
      return "Spy";
    case "agent":
      return "Agent";
    case "true_file":
      return "True File";
    case "false_file":
      return "False File";
  }
}

function determineWinner(points: { p1: number; p2: number }): "p1" | "p2" | "tie" {
  if (points.p1 === points.p2) {
    return "tie";
  }

  return points.p1 > points.p2 ? "p1" : "p2";
}

function resolveCards(
  p1Card: CardKind,
  p2Card: CardKind,
  p1Role: Role,
  p2Role: Role,
): RevealState {
  const commanderSlot: PlayerSlot = p1Role === "commander_spy" ? "p1" : "p2";
  const informantSlot: PlayerSlot = commanderSlot === "p1" ? "p2" : "p1";
  const commanderCard = commanderSlot === "p1" ? p1Card : p2Card;
  const informantCard = informantSlot === "p1" ? p1Card : p2Card;
  const points = { p1: 0, p2: 0 };
  let roundEnded = false;
  let summary = "Nenhum ponto. As cartas restantes seguem para o proximo turno.";

  if (commanderCard === "agent" && informantCard === "false_file") {
    roundEnded = false;
    summary = "Agent encontrou False File. Rodada continua sem pontuacao.";
  } else if (commanderCard === "agent" && informantCard === "true_file") {
    roundEnded = true;
    points[informantSlot] += 1;
    summary = `${roleNames[p1Role]} x ${roleNames[p2Role]}: o informante acha o arquivo verdadeiro e marca 1 ponto.`;
  } else if (commanderCard === "spy" && informantCard === "false_file") {
    roundEnded = true;
    points[informantSlot] += 1;
    summary = `${roleNames[p1Role]} x ${roleNames[p2Role]}: o spy caiu num falso arquivo e o governo marca 1 ponto.`;
  } else if (commanderCard === "spy" && informantCard === "true_file") {
    roundEnded = true;
    points[commanderSlot] += 5;
    summary = `${roleNames[p1Role]} x ${roleNames[p2Role]}: o comandante espiao capturou o true file e marca 5 pontos.`;
  }

  return {
    p1Card,
    p2Card,
    points,
    roundEnded,
    summary,
    comboLabel: `${labelCard(p1Card)} x ${labelCard(p2Card)}`,
  };
}

function roundSummary(match: MatchState, reveal: RevealState): RoundSummary {
  return {
    round: match.roundIndex + 1,
    p1Role: roleForRound(match.roundIndex, "p1"),
    p2Role: roleForRound(match.roundIndex, "p2"),
    winner: determineWinner(reveal.points),
    reason: reveal.summary,
    p1Points: reveal.points.p1,
    p2Points: reveal.points.p2,
  };
}

function handleLeave(state: RoomState, id: string): void {
  if (!state.participants[id]) {
    return;
  }

  const participant = state.participants[id];
  delete state.participants[id];
  state.participantOrder = state.participantOrder.filter((participantId) => participantId !== id);

  const seat = playerSeat(state.match, id);
  if (seat === "p1" || seat === "p2") {
    const nextMatchId = state.match.matchId + 1;
    state.match = createWaitingMatch(nextMatchId);
    systemMessage(state, `${participant.name} saiu da partida. A sala voltou ao lobby.`);
    return;
  }

  systemMessage(state, `${participant.name} saiu da sala.`);
}

function assignReadySeat(state: RoomState, participant: Participant): void {
  const match = state.match;

  if (match.status === "ended") {
    state.match = createWaitingMatch(match.matchId + 1);
  }

  const current = state.match;
  if (current.status !== "waiting") {
    return;
  }

  if (current.p1Id === participant.id || current.p2Id === participant.id) {
    return;
  }

  if (!current.p1Id) {
    current.p1Id = participant.id;
    systemMessage(state, `${participant.name} assumiu a vaga de P1.`);
    return;
  }

  if (!current.p2Id) {
    current.p2Id = participant.id;
    systemMessage(state, `${participant.name} assumiu a vaga de P2.`);
    startMatchFromSeats(current);
  }
}

export function applyRoomPost(previous: RoomState, post: RoomPost): RoomState {
  const state = cloneState(previous);

  switch (post.$) {
    case "join": {
      const alreadyPresent = Boolean(state.participants[post.id]);
      ensureParticipant(state, {
        id: post.id,
        name: post.name,
        isBot: post.isBot === 1,
      });
      if (!alreadyPresent) {
        const participant = state.participants[post.id];
        systemMessage(state, `${participant.name} entrou na sala.`);
      }
      return state;
    }
    case "leave": {
      handleLeave(state, post.id);
      return state;
    }
    case "chat": {
      if (!state.participants[post.id]) {
        ensureParticipant(state, {
          id: post.id,
          name: post.name,
          isBot: false,
        });
      }
      userMessage(state, post);
      return state;
    }
    case "ready": {
      ensureParticipant(state, {
        id: post.id,
        name: post.name,
        isBot: post.isBot === 1,
      });
      assignReadySeat(state, state.participants[post.id]);
      return state;
    }
    case "choose": {
      const match = state.match;
      if (match.status !== "playing" || !match.turn) {
        return state;
      }

      const seat = playerSeat(match, post.id);
      if (seat !== match.turn) {
        return state;
      }

      const card = availableCard(match, seat, post.cardId);
      if (!card) {
        return state;
      }

      card.used = true;
      match.selectedCardIds[seat] = card.id;

      if (seat === "p1") {
        match.turn = "p2";
        return state;
      }

      const p1CardId = match.selectedCardIds.p1;
      const p2CardId = match.selectedCardIds.p2;
      if (!p1CardId || !p2CardId) {
        return state;
      }

      const p1Card = match.hands.p1.find((entry) => entry.id === p1CardId);
      const p2Card = match.hands.p2.find((entry) => entry.id === p2CardId);
      if (!p1Card || !p2Card) {
        return state;
      }

      match.status = "revealed";
      match.turn = null;
      match.reveal = resolveCards(
        p1Card.kind,
        p2Card.kind,
        roleForRound(match.roundIndex, "p1"),
        roleForRound(match.roundIndex, "p2"),
      );

      if (match.reveal.roundEnded) {
        match.totals.p1 += match.reveal.points.p1;
        match.totals.p2 += match.reveal.points.p2;
        match.roundSummaries = [...match.roundSummaries, roundSummary(match, match.reveal)];
      }
      return state;
    }
    case "advance": {
      const match = state.match;
      const seat = playerSeat(match, post.id);
      if (seat === "spectator" || match.status !== "revealed" || !match.reveal) {
        return state;
      }

      if (!match.reveal.roundEnded) {
        match.status = "playing";
        match.turn = "p1";
        match.selectedCardIds = { p1: null, p2: null };
        match.reveal = null;
        return state;
      }

      if (match.roundIndex === 3) {
        match.status = "ended";
        match.turn = null;
        match.selectedCardIds = { p1: null, p2: null };
        match.winner = determineWinner(match.totals);
        return state;
      }

      match.roundIndex += 1;
      startRound(match);
      return state;
    }
  }
}

export function createInitialRoomState(roomId: string): RoomState {
  return initialState(roomId);
}

export function createPacker(): VibiNet.Packed {
  return matchPostPacker;
}

export function getRoleName(role: Role): string {
  return roleNames[role];
}

export function getRoleForSlot(roundIndex: number, slot: PlayerSlot): Role {
  return roleForRound(roundIndex, slot);
}

export function getSeat(state: RoomState, id: string): Seat {
  return playerSeat(state.match, id);
}

export function getParticipantList(state: RoomState): Participant[] {
  return state.participantOrder
    .map((id) => state.participants[id])
    .filter((participant): participant is Participant => Boolean(participant));
}

export function getBotIdentity(): { id: string; name: string } {
  return {
    id: BOT_ID,
    name: BOT_NAME,
  };
}

export function getCardLabel(card: CardKind): string {
  return labelCard(card);
}
