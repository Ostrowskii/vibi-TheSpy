export type RoomMode = "solo" | "multiplayer";
export type PlayerSlot = "p1" | "p2";
export type Seat = PlayerSlot | "spectator";
export type Role = "commander_spy" | "government_informant";
export type CardKind = "spy" | "agent" | "true_file" | "false_file";
export type MatchStatus = "waiting" | "playing" | "revealed" | "ended";

export interface Participant {
  id: string;
  name: string;
  joinedAt: number;
  isBot: boolean;
}

export interface ChatMessage {
  id: number;
  authorId: string;
  authorName: string;
  text: string;
  kind: "user" | "system";
}

export interface CardState {
  id: string;
  kind: CardKind;
  used: boolean;
}

export interface RevealState {
  p1Card: CardKind;
  p2Card: CardKind;
  points: {
    p1: number;
    p2: number;
  };
  roundEnded: boolean;
  summary: string;
  comboLabel: string;
}

export interface RoundSummary {
  round: number;
  p1Role: Role;
  p2Role: Role;
  winner: "p1" | "p2" | "tie";
  reason: string;
  p1Points: number;
  p2Points: number;
}

export interface MatchState {
  matchId: number;
  status: MatchStatus;
  p1Id: string | null;
  p2Id: string | null;
  roundIndex: number;
  turn: PlayerSlot | null;
  hands: {
    p1: CardState[];
    p2: CardState[];
  };
  selectedCardIds: {
    p1: string | null;
    p2: string | null;
  };
  reveal: RevealState | null;
  roundSummaries: RoundSummary[];
  totals: {
    p1: number;
    p2: number;
  };
  winner: "p1" | "p2" | "tie" | null;
}

export interface RoomState {
  roomId: string;
  participants: Record<string, Participant>;
  participantOrder: string[];
  chat: ChatMessage[];
  chatCounter: number;
  systemCounter: number;
  match: MatchState;
}

export type RoomPost =
  | {
      $: "join";
      id: string;
      name: string;
      isBot: 0 | 1;
    }
  | {
      $: "leave";
      id: string;
    }
  | {
      $: "chat";
      id: string;
      name: string;
      text: string;
    }
  | {
      $: "ready";
      id: string;
      name: string;
      isBot: 0 | 1;
      seat: 0 | 1;
    }
  | {
      $: "choose";
      id: string;
      cardId: string;
    }
  | {
      $: "advance";
      id: string;
    };
