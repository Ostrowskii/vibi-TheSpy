import { VibiNet } from "vibinet";
import {
  applyRoomPost,
  createInitialRoomState,
  createPacker,
  getBotIdentity,
  getCardLabel,
  getParticipantList,
  getRoleForSlot,
  getRoleName,
  getSeat,
} from "./game";
import type {
  CardKind,
  CardState,
  MatchState,
  PlayerSlot,
  Role,
  RoomPost,
  RoomState,
  RoundSummary,
  Seat,
} from "./types";

const STORAGE_NAME_KEY = "the-spy-name";
const STORAGE_ID_KEY = "the-spy-viewer-id";
const ROOM_SCHEMA_VERSION = "v4";
const ROOM_NAMESPACE = "the-spy-" + ROOM_SCHEMA_VERSION;
const VIBINET_SERVER_URL = "wss://net.vibistudiotest.site";
const PAGE_INSTANCE_ID =
  typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `page-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

let shouldFocusChatInputAfterRender = false;
let lastChatViewportKey = "";

function buildNetworkRoomId(roomId: string): string {
  return ROOM_NAMESPACE + "__" + roomId;
}

function oppositeSlot(slot: PlayerSlot): PlayerSlot {
  return slot === "p1" ? "p2" : "p1";
}

function firstTurnSlot(roundIndex: number): PlayerSlot {
  return getRoleForSlot(roundIndex, "p1") === "government_informant" ? "p1" : "p2";
}

function currentRoleForSeat(match: MatchState, seat: PlayerSlot): Role {
  return getRoleForSlot(match.roundIndex, seat);
}

function seatRoleName(match: MatchState, seat: PlayerSlot, useStartingRole = false): string {
  return getRoleName(useStartingRole ? getRoleForSlot(0, seat) : currentRoleForSeat(match, seat));
}


interface Controller {
  readonly viewerId: string;
  readonly viewerName: string;
  readonly roomId: string;
  readonly mode: "solo" | "multiplayer";
  subscribe(listener: () => void): () => void;
  getState(): RoomState;
  post(post: RoomPost): void;
  destroy(): void;
}

class SoloController implements Controller {
  readonly viewerId: string;
  readonly viewerName: string;
  readonly roomId: string;
  readonly mode = "solo" as const;
  private readonly listeners = new Set<() => void>();
  private readonly botId = getBotIdentity().id;
  private readonly botName = getBotIdentity().name;
  private state: RoomState;
  private botTimer: number | null = null;
  private continueTimer: number | null = null;
  private plannedBotCardId: string | null = null;

  constructor(viewerId: string, viewerName: string, roomId: string, viewerSeat: PlayerSlot) {
    this.viewerId = viewerId;
    this.viewerName = viewerName;
    this.roomId = roomId;
    this.state = createInitialRoomState(roomId);
    this.state = applyRoomPost(this.state, {
      $: "join",
      id: viewerId,
      name: viewerName,
      isBot: 0,
    });
    this.state = applyRoomPost(this.state, {
      $: "join",
      id: this.botId,
      name: this.botName,
      isBot: 1,
    });

    const botSeat = oppositeSlot(viewerSeat);
    this.state = applyRoomPost(this.state, {
      $: "ready",
      id: viewerId,
      name: viewerName,
      isBot: 0,
      seat: viewerSeat === "p1" ? 0 : 1,
    });
    this.state = applyRoomPost(this.state, {
      $: "ready",
      id: this.botId,
      name: this.botName,
      isBot: 1,
      seat: botSeat === "p1" ? 0 : 1,
    });
    this.maybeScheduleBot();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getState(): RoomState {
    return this.state;
  }

  post(post: RoomPost): void {
    this.state = applyRoomPost(this.state, post);
    this.emit();
    this.maybeScheduleBot();
  }

  destroy(): void {
    if (this.botTimer !== null) {
      window.clearTimeout(this.botTimer);
    }
    if (this.continueTimer !== null) {
      window.clearTimeout(this.continueTimer);
    }
  }

  private emit(): void {
    this.listeners.forEach((listener) => listener());
  }

  private maybeScheduleBot(): void {
    if (this.botTimer !== null) {
      window.clearTimeout(this.botTimer);
      this.botTimer = null;
    }
    if (this.continueTimer !== null) {
      window.clearTimeout(this.continueTimer);
      this.continueTimer = null;
    }

    const match = this.state.match;
    const botSeat = match.p1Id === this.botId ? "p1" : match.p2Id === this.botId ? "p2" : null;
    const viewerSeat = match.p1Id === this.viewerId ? "p1" : match.p2Id === this.viewerId ? "p2" : null;

    if (match.status === "waiting" && viewerSeat && !botSeat) {
      const emptySeat = oppositeSlot(viewerSeat);
      this.botTimer = window.setTimeout(() => {
        this.post({
          $: "ready",
          id: this.botId,
          name: this.botName,
          isBot: 1,
          seat: emptySeat === "p1" ? 0 : 1,
        });
      }, 650);
      return;
    }

    if (match.status === "playing" && botSeat) {
      const botSelectedCardId = match.selectedCardIds[botSeat];
      if (botSelectedCardId) {
        this.plannedBotCardId = null;
        return;
      }

      const card = nextBotCard(match, botSeat, this.plannedBotCardId);
      if (!card) {
        this.plannedBotCardId = null;
        return;
      }

      this.plannedBotCardId = card.id;
      if (match.turn === botSeat) {
        this.botTimer = window.setTimeout(() => {
          this.post({
            $: "choose",
            id: this.botId,
            cardId: card.id,
          });
        }, 750);
      }
      return;
    }

    this.plannedBotCardId = null;
    if (match.status === "revealed" && botSeat) {
      this.continueTimer = window.setTimeout(() => {
        this.post({
          $: "advance",
          id: this.botId,
        });
      }, 1300);
    }
  }
}

class MultiplayerController implements Controller {
  readonly viewerId: string;
  readonly viewerName: string;
  readonly roomId: string;
  readonly mode = "multiplayer" as const;
  private readonly listeners = new Set<() => void>();
  private readonly game: VibiNet<RoomState, RoomPost>;
  private readonly initialState: RoomState;
  private readonly unloadHandler: () => void;
  private readonly refreshTimerIds = new Set<number>();
  private isSynced = false;
  private pendingPosts: RoomPost[] = [];
  private lastRenderKey = "";

  constructor(viewerId: string, viewerName: string, roomId: string) {
    this.viewerId = viewerId;
    this.viewerName = viewerName;
    this.roomId = roomId;
    const networkRoomId = buildNetworkRoomId(roomId);
    this.initialState = applyRoomPost(createInitialRoomState(roomId), {
      $: "join",
      id: viewerId,
      name: viewerName,
      isBot: 0,
    });
    this.game = new VibiNet.game<RoomState, RoomPost>({
      room: networkRoomId,
      server: VIBINET_SERVER_URL,
      initial: this.initialState,
      on_tick: (state) => state,
      on_post: (post, currentState) => applyRoomPost(currentState, post),
      packer: createPacker(),
      tick_rate: 8,
      tolerance: 350,
    });

    this.unloadHandler = () => {
      if (!this.isSynced) {
        return;
      }
      this.safePostToGame({
        $: "leave",
        id: viewerId,
      });
    };

    this.installGameHooks();

    window.addEventListener("beforeunload", this.unloadHandler);
    this.game.on_sync(() => {
      this.isSynced = true;
      this.flushPendingPosts();
      this.emitIfChanged(true);
    });
    this.post({
      $: "join",
      id: viewerId,
      name: viewerName,
      isBot: 0,
    });
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getState(): RoomState {
    return this.isSynced ? this.game.compute_render_state() : this.initialState;
  }

  post(post: RoomPost): void {
    if (!this.isSynced) {
      this.pendingPosts.push(post);
      return;
    }

    this.safePostToGame(post);
  }

  destroy(): void {
    if (this.isSynced) {
      this.safePostToGame({
        $: "leave",
        id: this.viewerId,
      });
    }
    this.pendingPosts = [];
    this.clearRefreshTimers();
    window.removeEventListener("beforeunload", this.unloadHandler);
    this.game.close();
  }

  private emit(): void {
    this.listeners.forEach((listener) => listener());
  }

  private installGameHooks(): void {
    const internalGame = this.game as unknown as {
      add_local_post?: (name: string, post: unknown) => void;
      remove_local_post?: (name: string) => void;
      client_api?: {
        watch?: (room: string, packer: unknown, handler?: (post: unknown) => void) => void;
        load?: (room: string, from: number, packer: unknown, handler?: (post: unknown) => void) => void;
      };
    };

    const clientApi = internalGame.client_api;
    if (clientApi) {
      const watch = clientApi.watch;
      if (typeof watch === "function") {
        clientApi.watch = (room: string, packer: unknown, handler?: (post: unknown) => void) => {
          watch.call(clientApi, room, packer, (post: unknown) => {
            handler?.(post);
            this.queueRefreshPasses();
          });
        };
      }

      const load = clientApi.load;
      if (typeof load === "function") {
        clientApi.load = (room: string, from: number, packer: unknown, handler?: (post: unknown) => void) => {
          load.call(clientApi, room, from, packer, (post: unknown) => {
            handler?.(post);
            this.queueRefreshPasses();
          });
        };
      }
    }

    const addLocalPost = internalGame.add_local_post;
    if (typeof addLocalPost === "function") {
      internalGame.add_local_post = (name: string, post: unknown) => {
        addLocalPost.call(this.game, name, post);
        this.queueRefreshPasses();
      };
    }

    const removeLocalPost = internalGame.remove_local_post;
    if (typeof removeLocalPost === "function") {
      internalGame.remove_local_post = (name: string) => {
        removeLocalPost.call(this.game, name);
        this.queueRefreshPasses();
      };
    }
  }

  private emitIfChanged(force = false): void {
    const nextKey = JSON.stringify(this.game.compute_render_state());
    if (force || nextKey !== this.lastRenderKey) {
      this.lastRenderKey = nextKey;
      this.emit();
    }
  }

  private queueRefreshPasses(): void {
    this.emitIfChanged();
    this.queueRefreshAfter(80);
    this.queueRefreshAfter(this.toleranceWindowMs());
  }

  private queueRefreshAfter(delayMs: number): void {
    const timerId = window.setTimeout(() => {
      this.refreshTimerIds.delete(timerId);
      if (!this.isSynced) {
        return;
      }
      this.emitIfChanged();
    }, delayMs);
    this.refreshTimerIds.add(timerId);
  }

  private clearRefreshTimers(): void {
    for (const timerId of this.refreshTimerIds) {
      window.clearTimeout(timerId);
    }
    this.refreshTimerIds.clear();
  }

  private toleranceWindowMs(): number {
    const tickMs = Math.ceil(1000 / this.game.tick_rate);
    return Math.max(160, this.game.tolerance + tickMs);
  }

  private flushPendingPosts(): void {
    if (!this.isSynced || this.pendingPosts.length === 0) {
      return;
    }

    const queued = this.pendingPosts;
    this.pendingPosts = [];
    for (const post of queued) {
      this.safePostToGame(post);
    }
  }

  private safePostToGame(post: RoomPost): void {
    try {
      this.game.post(post);
    } catch (error) {
      console.error("[The Spy] failed to post room event", post.$, error);
    }
  }
}

interface AppState {
  screen: "home" | "room" | "solo";
  currentName: string;
  currentRoom: string;
  controller: Controller | null;
  dismissedMatchId: number | null;
}

export function mountApp(root: HTMLElement): void {
  const state: AppState = {
    screen: "home",
    currentName: loadName(),
    currentRoom: "",
    controller: null,
    dismissedMatchId: null,
  };

  const viewerId = loadViewerId();
  const rerender = (): void => {
    root.innerHTML = render(state, viewerId);
    bindEvents(state, viewerId, rerender);
  };

  rerender();
}

function render(state: AppState, viewerId: string): string {
  if (state.screen === "home" || !state.controller) {
    return renderHome(state);
  }

  const roomState = state.controller.getState();
  const match = roomState.match;
  const shouldOpenModal =
    match.status === "ended" && state.dismissedMatchId !== match.matchId && match.roundSummaries.length > 0;

  if (state.screen === "solo" && state.controller.mode === "solo") {
    return renderSoloScreen(roomState, viewerId, shouldOpenModal);
  }

  return `
    <div class="screen room-screen">
      <div class="main-surface">
        ${renderGamePanel(roomState, viewerId)}
        ${renderSidebar(roomState, viewerId, state.controller)}
      </div>
      ${shouldOpenModal ? renderResultModal(roomState, viewerId, "multiplayer") : ""}
    </div>
  `;
}

function renderHome(state: AppState): string {
  const multiplayerEnabled = Boolean(state.currentName.trim() && state.currentRoom.trim());
  return `
    <div class="screen home-screen">
      <section class="home-card">
        <div class="home-hero">
          <h1>The Spy</h1>
        </div>

        <div class="home-actions">
          <article class="action-card solo-start-card">
            <div class="solo-button-stack">
              <button class="secondary-button solo-start-button" data-action="start-solo" data-bot-role="government_informant">
                vs informante do governo (bot)
              </button>
              <button class="secondary-button solo-start-button" data-action="start-solo" data-bot-role="commander_spy">
                vs comandante espiao (bot)
              </button>
            </div>
          </article>

          <article class="action-card">
            <h2>Multiplayer</h2>
            <p>
              <code>usuario</code> e <code>sala</code> sao obrigatorios para entrar e sincronizar a partida.
            </p>
            <div class="field-grid">
              <label class="field-label">
                Nome
                <input
                  class="text-input"
                  id="name-input"
                  maxlength="24"
                  value="${escapeAttribute(state.currentName)}"
                  placeholder="Seu nick"
                />
              </label>
              <label class="field-label">
                Room
                <input
                  class="text-input"
                  id="room-input"
                  maxlength="32"
                  value="${escapeAttribute(state.currentRoom)}"
                  placeholder="codigo-da-sala"
                />
              </label>
            </div>
            <div class="button-row">
              <button class="primary-button" data-action="start-multiplayer" ${multiplayerEnabled ? "" : "disabled"}>
                Multiplayer
              </button>
            </div>
          </article>
        </div>
      </section>
    </div>
  `;
}

function renderSoloScreen(state: RoomState, viewerId: string, shouldOpenModal: boolean): string {
  return `
    <div class="screen solo-screen">
      <div class="main-surface solo-surface">
        ${renderSoloGamePanel(state, viewerId)}
        ${renderSoloSidebar(state, viewerId)}
      </div>
      ${shouldOpenModal ? renderResultModal(state, viewerId, "solo") : ""}
    </div>
  `;
}

function renderSoloGamePanel(state: RoomState, viewerId: string): string {
  const match = state.match;
  const viewerSeat = getSeat(state, viewerId);
  const roundLabel = match.status === "ended" ? "Partida encerrada" : `Rodada ${Math.min(match.roundIndex + 1, 4)} / 4`;

  return `
    <section class="game-panel solo-game-panel">
      <div class="game-top">
        <div class="status-block">
          <span class="eyebrow">${escapeHtml(roundLabel)}</span>
          <p class="status-text">${escapeHtml(soloStatusHeadline(match, viewerSeat))}</p>
        </div>
        <div class="button-row">
          <span class="score-pill">Voce ${viewerScore(match, viewerSeat)} pts</span>
          <span class="score-pill">Bot ${opponentScore(match, viewerSeat)} pts</span>
        </div>
      </div>

      ${renderBoard(state, viewerId)}

      <div class="board-footer">
        ${renderActionFooter(state, viewerId)}
      </div>
    </section>
  `;
}

function renderSoloSidebar(state: RoomState, viewerId: string): string {
  return `
    <aside class="sidebar solo-sidebar">
      ${renderLeavePanel()}
      ${renderSoloLogPanel(state, viewerId)}
    </aside>
  `;
}

function renderSoloLogPanel(state: RoomState, viewerId: string): string {
  const entries = getSoloLogEntries(state, viewerId);
  return `
    <section class="sidebar-panel solo-log-panel">
      <div>
        <h2 class="panel-title">Log de partida</h2>
      </div>
      <div class="chat-list solo-log-list">
        ${entries.map((entry) => `<p class="solo-log-entry">${escapeHtml(entry)}</p>`).join("")}
      </div>
    </section>
  `;
}

function renderSidebar(state: RoomState, viewerId: string, controller: Controller): string {
  return `
    <aside class="sidebar">
      ${renderLeavePanel()}
      ${renderChatPanel(state)}
      ${renderPlayersPanel(state, viewerId)}
      ${renderRoomInfoPanel(controller)}
    </aside>
  `;
}

function renderPlayersPanel(state: RoomState, viewerId: string): string {
  const rows = getParticipantList(state)
    .map((participant) => {
      const seat = getSeat(state, participant.id);
      const seatLabel =
        seat === "spectator"
          ? "spec"
          : seatRoleName(state.match, seat, state.match.status === "waiting" || state.match.status === "ended");
      const youLabel = participant.id === viewerId ? " · (voce)" : "";
      return `
        <div class="player-row">
          <p class="player-line"><strong>${escapeHtml(participant.name)}</strong>${youLabel} ${escapeHtml(seatLabel)}</p>
        </div>
      `;
    })
    .join("");

  return `
    <section class="sidebar-panel players-panel">
      <div>
        <h2 class="panel-title">Conectados</h2>
      </div>
      <div class="players-list">
        ${rows || '<p class="empty-state">Ainda nao ha jogadores conectados.</p>'}
      </div>
    </section>
  `;
}

function renderChatPanel(state: RoomState): string {
  type ChatGroup =
    | {
        kind: "system";
        lines: string[];
      }
    | {
        kind: "user";
        authorId: string;
        authorName: string;
        lines: string[];
      };

  const groups: ChatGroup[] = [];
  for (const message of state.chat) {
    if (message.kind === "system") {
      groups.push({
        kind: "system",
        lines: [message.text],
      });
      continue;
    }

    const lastGroup = groups[groups.length - 1];
    if (lastGroup && lastGroup.kind === "user" && lastGroup.authorId === message.authorId) {
      lastGroup.lines.push(message.text);
      continue;
    }

    groups.push({
      kind: "user",
      authorId: message.authorId,
      authorName: message.authorName,
      lines: [message.text],
    });
  }

  const messages = groups
    .map((group) => {
      if (group.kind === "system") {
        return `
          <article class="chat-message system">
            ${group.lines.map((line) => `<p class="chat-line">${escapeHtml(line)}</p>`).join("")}
          </article>
        `;
      }

      return `
        <article class="chat-message user">
          ${group.lines
            .map((line) => `<p class="chat-line"><strong>${escapeHtml(group.authorName)}</strong> - ${escapeHtml(line)}</p>`)
            .join("")}
        </article>
      `;
    })
    .join("");

  return `
    <section class="sidebar-panel chat-panel">
      <div>
        <h2 class="panel-title">Chat</h2>
      </div>
      <div class="chat-list">
        ${messages}
      </div>
      <form class="chat-form" data-action="send-chat" autocomplete="off">
        <input
          class="chat-input"
          id="chat-input"
          maxlength="220"
          placeholder="Escreva uma mensagem para a sala"
          autocomplete="off"
          autocapitalize="off"
          autocorrect="off"
          spellcheck="false"
          enterkeyhint="send"
        />
        <button class="primary-button" type="submit">Enviar</button>
      </form>
    </section>
  `;
}

function renderRoomInfoPanel(controller: Controller): string {
  return `
    <section class="sidebar-panel info-panel">
      <h2 class="panel-title">Sessao</h2>
      <p class="info-line"><span class="tiny">Sala:</span> <strong>${escapeHtml(controller.roomId)}</strong></p>
      <p class="info-line"><span class="tiny">Usuario:</span> <strong>${escapeHtml(controller.viewerName)}</strong></p>
      <p class="info-line"><span class="tiny">Modo:</span> <strong>${controller.mode === "solo" ? "Vs Bot" : "Online"}</strong></p>
    </section>
  `;
}

function renderLeavePanel(): string {
  return `
    <section class="sidebar-panel sidebar-actions">
      <button class="ghost-button sidebar-leave-button" data-action="leave-room">Sair da partida</button>
    </section>
  `;
}

function renderGamePanel(state: RoomState, viewerId: string): string {
  const match = state.match;
  const viewerSeat = getSeat(state, viewerId);
  const roundLabel = `Rodada ${Math.min(match.roundIndex + 1, 4)} / 4`;
  const p1Role = getRoleForSlot(match.roundIndex, "p1");
  const p2Role = getRoleForSlot(match.roundIndex, "p2");
  const showWaitingState = match.status === "waiting" || match.status === "ended";
  const gameTop = showWaitingState
    ? ""
    : `
      <div class="game-top">
        <div class="status-block">
          <span class="eyebrow">${roundLabel}</span>
          <p class="status-text">${escapeHtml(statusHeadline(match, viewerSeat))}</p>
        </div>
        <div class="button-row">
          <span class="score-pill">P1 ${match.totals.p1} pts</span>
          <span class="score-pill">P2 ${match.totals.p2} pts</span>
        </div>
      </div>
    `;

  const rolePanel = showWaitingState
    ? ""
    : `
      <div class="roles-grid">
        ${renderRoleCard("P1", match.p1Id, state, p1Role)}
        ${renderRoleCard("P2", match.p2Id, state, p2Role)}
      </div>
    `;

  return `
    <section class="game-panel">
      ${gameTop}
      ${rolePanel}

      ${showWaitingState ? renderWaitingPanel(state, viewerId) : renderBoard(state, viewerId)}

      <div class="board-footer">
        ${renderActionFooter(state, viewerId)}
      </div>
    </section>
  `;
}

function renderRoleCard(label: string, participantId: string | null, state: RoomState, role: Role): string {
  const participant = participantId ? state.participants[participantId] : null;
  return `
    <article class="role-card">
      <span class="role-pill ${role === "commander_spy" ? "spy" : ""}">${escapeHtml(label)}</span>
      <h3>${participant ? escapeHtml(participant.name) : "Aguardando jogador"}</h3>
      <p>${escapeHtml(getRoleName(role))}</p>
    </article>
  `;
}

function renderWaitingPanel(state: RoomState, viewerId: string): string {
  const match = state.match;
  const viewerSeat = getSeat(state, viewerId);
  const ended = match.status === "ended";
  const informantSeat = getRoleForSlot(0, "p1") === "government_informant" ? "p1" : "p2";
  const commanderSeat = oppositeSlot(informantSeat);
  const informantOccupantId = ended ? null : informantSeat === "p1" ? match.p1Id : match.p2Id;
  const commanderOccupantId = ended ? null : commanderSeat === "p1" ? match.p1Id : match.p2Id;
  const canChooseInformant = !informantOccupantId || informantOccupantId === viewerId;
  const canChooseCommander = !commanderOccupantId || commanderOccupantId === viewerId;
  const informantName = informantOccupantId ? state.participants[informantOccupantId]?.name ?? "Alguem" : "";
  const commanderName = commanderOccupantId ? state.participants[commanderOccupantId]?.name ?? "Alguem" : "";
  const waitingCopy = statusHeadline(match, viewerSeat);
  const informantText = !informantOccupantId
    ? "Entrar como informante do governo."
    : informantOccupantId === viewerId
      ? "Voce e informante do governo."
      : `${informantName} e informante do governo.`;
  const commanderText = !commanderOccupantId
    ? "Entrar como comandante espiao."
    : commanderOccupantId === viewerId
      ? "Voce e comandante espiao."
      : `${commanderName} e comandante espiao.`;
  const informantStateClass = informantOccupantId
    ? informantOccupantId === viewerId
      ? "selected"
      : "occupied"
    : "available";
  const commanderStateClass = commanderOccupantId
    ? commanderOccupantId === viewerId
      ? "selected"
      : "occupied"
    : "available";

  return `
    <div class="waiting-panel">
      <div class="waiting-seat-grid">
        <button
          class="seat-choice ${informantStateClass}"
          data-action="ready-role"
          data-seat="${informantSeat}"
          ${canChooseInformant ? "" : "disabled"}
        >
          <span class="seat-choice-kicker">${escapeHtml(waitingCopy)}</span>
          <strong class="seat-choice-title">Informante do Governo</strong>
          <span class="seat-choice-copy">${escapeHtml(informantText)}</span>
        </button>
        <button
          class="seat-choice ${commanderStateClass}"
          data-action="ready-role"
          data-seat="${commanderSeat}"
          ${canChooseCommander ? "" : "disabled"}
        >
          <span class="seat-choice-kicker">${escapeHtml(waitingCopy)}</span>
          <strong class="seat-choice-title">Comandante Espiao</strong>
          <span class="seat-choice-copy">${escapeHtml(commanderText)}</span>
        </button>
      </div>
    </div>
  `;
}

function renderBoard(state: RoomState, viewerId: string): string {
  const match = state.match;
  const viewerSeat = getSeat(state, viewerId);
  const perspective = boardPerspective(viewerSeat);
  const bottomCards = match.hands[perspective.bottom];
  const topCards = match.hands[perspective.top];
  const activeTurn = match.turn;
  const canSeeBottom = viewerSeat === perspective.bottom;
  const bottomSelectable = canSeeBottom && activeTurn === perspective.bottom;

  const slots = new Map<string, string>();
  topCards.forEach((card, index) => {
    slots.set(`r1c${index + 1}`, renderTopCard(card));
  });
  bottomCards.forEach((card, index) => {
    slots.set(`r4c${index + 1}`, renderBottomCard(card, canSeeBottom, bottomSelectable));
  });
  slots.set("r2c3", renderPlayedCard(match, perspective.top, viewerSeat, perspective.top));
  slots.set("r3c3", renderPlayedCard(match, perspective.bottom, viewerSeat, perspective.bottom));

  const grid: string[] = [];
  for (let row = 1; row <= 4; row += 1) {
    for (let column = 1; column <= 5; column += 1) {
      const key = `r${row}c${column}`;
      const extraClass = key === "r2c3" || key === "r3c3" ? "play-slot" : "";
      grid.push(`<div class="card-slot ${extraClass}">${slots.get(key) ?? ""}</div>`);
    }
  }

  return `
    <div class="game-board">
      <div class="board-grid">
        ${grid.join("")}
      </div>
      <div class="status-banner">
        <strong>${escapeHtml(boardNarration(match, viewerSeat))}</strong>
        <p class="status-text">${escapeHtml(match.reveal?.summary ?? "Cada jogada vai para o centro virada para baixo ate a revelacao.")}</p>
      </div>
    </div>
  `;
}

function renderTopCard(card: CardState): string {
  if (card.used) {
    return "";
  }
  return '<div class="card face-down"><span>Oculta</span></div>';
}

function renderBottomCard(card: CardState, canSeeLabel: boolean, selectable: boolean): string {
  if (card.used) {
    return "";
  }

  if (!canSeeLabel) {
    return '<div class="card face-down"><span>Oculta</span></div>';
  }

  const label = getCardLabel(card.kind);
  return `
    <button
      class="card face-up ${cardClass(card.kind)} ${selectable ? "selectable" : "disabled"}"
      ${selectable ? `data-action="choose-card" data-card-id="${escapeAttribute(card.id)}"` : "disabled"}
    >
      <span>${escapeHtml(label)}</span>
    </button>
  `;
}

function renderPlayedCard(
  match: MatchState,
  slot: PlayerSlot,
  viewerSeat: Seat,
  perspectiveSlot: PlayerSlot,
): string {
  const cardId = match.selectedCardIds[slot];
  if (!cardId) {
    return "";
  }

  if (match.status === "revealed" && match.reveal) {
    const kind = slot === "p1" ? match.reveal.p1Card : match.reveal.p2Card;
    return `
      <div class="card face-up ${cardClass(kind)}">
        <span>${escapeHtml(getCardLabel(kind))}</span>
      </div>
    `;
  }

  return '<div class="card face-down"><span>Travada</span></div>';
}

function renderActionFooter(state: RoomState, viewerId: string): string {
  const match = state.match;
  const seat = getSeat(state, viewerId);
  if (match.status !== "revealed" || seat === "spectator") {
    return "";
  }

  return `
    <button class="ghost-button" data-action="advance-turn">
      ${match.reveal?.roundEnded ? "Proxima etapa" : "Proximo turno"}
    </button>
  `;
}

function getSoloLogEntries(state: RoomState, viewerId: string): string[] {
  const match = state.match;
  const viewerSeat = getSeat(state, viewerId);
  const entries: string[] = [];

  if (viewerSeat === "p1" || viewerSeat === "p2") {
    const botSeat = oppositeSlot(viewerSeat);
    const botId = botSeat === "p1" ? match.p1Id : match.p2Id;
    const botName = botId ? state.participants[botId]?.name ?? "Cipher Bot" : "Cipher Bot";
    entries.push(`Voce comeca como ${seatRoleName(match, viewerSeat, true).toLowerCase()}.`);
    entries.push(`${botName} comeca como ${seatRoleName(match, botSeat, true).toLowerCase()}.`);
  }

  for (const summary of match.roundSummaries) {
    entries.push(`Rodada ${summary.round}: ${summary.reason}`);
  }

  if (match.status === "playing") {
    const currentRole = match.turn ? seatRoleName(match, match.turn).toLowerCase() : "";
    const currentTurnLine = currentRole
      ? `${capitalizeLine(currentRole)} abre o turno da rodada ${match.roundIndex + 1}.`
      : `Rodada ${match.roundIndex + 1} em andamento.`;
    entries.push(currentTurnLine);

    const firstSeat = firstTurnSlot(match.roundIndex);
    const secondSeat = oppositeSlot(firstSeat);
    if (match.selectedCardIds[firstSeat] && !match.selectedCardIds[secondSeat]) {
      entries.push(`${seatLabelForLog(state, match, secondSeat, viewerSeat)} ainda vai responder ao centro.`);
    }
  }

  if (match.status === "revealed" && match.reveal && !match.reveal.roundEnded) {
    entries.push(match.reveal.summary);
  }

  if (match.status === "ended") {
    entries.push(`Partida encerrada. ${matchWinnerLabel(match, state)}.`);
  }

  return entries.length > 0 ? entries : ["Partida local pronta."];
}

function viewerScore(match: MatchState, viewerSeat: Seat): number {
  if (viewerSeat === "p2") {
    return match.totals.p2;
  }
  return match.totals.p1;
}

function opponentScore(match: MatchState, viewerSeat: Seat): number {
  if (viewerSeat === "p2") {
    return match.totals.p1;
  }
  return match.totals.p2;
}

function soloStatusHeadline(match: MatchState, viewerSeat: Seat): string {
  if (match.status === "ended") {
    return "As quatro rodadas terminaram. O resumo final esta aberto.";
  }

  if (match.status === "revealed") {
    return match.reveal?.roundEnded
      ? "A rodada terminou. Avance para seguir ao proximo momento da partida."
      : "As cartas ja abriram. Avance para o proximo turno.";
  }

  if (match.turn === viewerSeat) {
    return "Sua vez de escolher uma carta e travar no centro.";
  }

  if (match.turn) {
    return "O bot esta escolhendo a resposta dele.";
  }

  return "Partida local em andamento.";
}

function seatLabelForLog(state: RoomState, match: MatchState, slot: PlayerSlot, viewerSeat: Seat): string {
  if (slot === viewerSeat) {
    return "Voce";
  }

  const participantId = slot === "p1" ? match.p1Id : match.p2Id;
  return participantId ? state.participants[participantId]?.name ?? "Cipher Bot" : "Cipher Bot";
}

function capitalizeLine(value: string): string {
  if (!value) {
    return value;
  }
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function renderResultModal(state: RoomState, viewerId: string, mode: "solo" | "multiplayer"): string {
  const match = state.match;
  const rows = match.roundSummaries.map((summary) => renderSummaryRow(summary)).join("");
  const winner = matchWinnerLabel(match, state);
  const viewerSeat = getSeat(state, viewerId);
  const footerCopy =
    mode === "solo"
      ? "Voltar fecha o resumo final e retorna para a tela inicial."
      : "Voltar fecha o popup e devolve a sala ao estado de lobby com os botoes de cargo.";
  const footerButton =
    mode === "solo"
      ? '<button class="primary-button" data-action="leave-room">Voltar ao inicio</button>'
      : '<button class="primary-button" data-action="dismiss-result">Voltar para o lobby</button>';

  return `
    <div class="modal">
      <div class="modal-card">
        <div>
          <span class="eyebrow">Fim da partida</span>
          <h2>${escapeHtml(winner)}</h2>
          <p class="panel-copy">${escapeHtml(resultSubtitle(match, viewerSeat, state))}</p>
        </div>

        <div class="modal-table">
          <div class="table-row head">
            <div>Rodada</div>
            <div>Resultado</div>
            <div>P1</div>
            <div>P2</div>
          </div>
          ${rows}
        </div>

        <div class="status-banner">
          <strong>Placares finais</strong>
          <p class="status-text">P1 fez ${match.totals.p1} ponto(s) e P2 fez ${match.totals.p2} ponto(s).</p>
        </div>

        <div class="modal-footer">
          <span class="tiny">${escapeHtml(footerCopy)}</span>
          ${footerButton}
        </div>
      </div>
    </div>
  `;
}

function renderSummaryRow(summary: RoundSummary): string {
  return `
    <div class="table-row">
      <div>#${summary.round}</div>
      <div>${escapeHtml(summary.reason)}</div>
      <div>${summary.p1Points}</div>
      <div>${summary.p2Points}</div>
    </div>
  `;
}

function bindEvents(state: AppState, viewerId: string, rerender: () => void): void {
  const nameInput = document.getElementById("name-input") as HTMLInputElement | null;
  const roomInput = document.getElementById("room-input") as HTMLInputElement | null;
  const multiplayerButton = document.querySelector('[data-action="start-multiplayer"]') as HTMLButtonElement | null;

  const syncMultiplayerButton = (): void => {
    if (!multiplayerButton) {
      return;
    }
    multiplayerButton.disabled = !(state.currentName.trim() && state.currentRoom.trim());
  };

  nameInput?.addEventListener("input", () => {
    state.currentName = nameInput.value;
    saveName(state.currentName);
    syncMultiplayerButton();
  });

  roomInput?.addEventListener("input", () => {
    state.currentRoom = sanitizeRoom(roomInput.value);
    roomInput.value = state.currentRoom;
    syncMultiplayerButton();
  });

  document.querySelectorAll<HTMLElement>('[data-action="start-solo"]').forEach((element) => {
    element.addEventListener("click", () => {
      const name = prepareName(state.currentName);
      state.currentName = name;
      saveName(name);
      const roomId = `solo-${Date.now().toString(36)}`;
      const botRole = element.dataset.botRole === "government_informant" ? "government_informant" : "commander_spy";
      const playerSeat = botRole === "government_informant" ? "p2" : "p1";
      state.controller?.destroy();
      const controller = new SoloController(viewerId, name, roomId, playerSeat);
      controller.subscribe(() => rerender());
      state.controller = controller;
      state.dismissedMatchId = null;
      state.screen = "solo";
      rerender();
    });
  });

  document.querySelector('[data-action="start-multiplayer"]')?.addEventListener("click", () => {
    const name = prepareName(state.currentName);
    const roomId = sanitizeRoom(state.currentRoom);
    if (!name || !roomId) {
      return;
    }
    state.currentName = name;
    state.currentRoom = roomId;
    saveName(name);
    state.controller?.destroy();
    const controller = new MultiplayerController(viewerId, name, roomId);
    controller.subscribe(() => rerender());
    state.controller = controller;
    state.dismissedMatchId = null;
    state.screen = "room";
    rerender();
  });

  document.querySelector('[data-action="leave-room"]')?.addEventListener("click", () => {
    state.controller?.destroy();
    state.controller = null;
    state.screen = "home";
    rerender();
  });

  document.querySelectorAll<HTMLElement>('[data-action="ready-role"]').forEach((element) => {
    element.addEventListener("click", () => {
      if (!state.controller) {
        return;
      }
      const seat = element.dataset.seat === "p2" ? 1 : 0;
      state.dismissedMatchId = null;
      state.controller.post({
        $: "ready",
        id: state.controller.viewerId,
        name: state.controller.viewerName,
        isBot: 0,
        seat,
      });
    });
  });

  document.querySelectorAll<HTMLElement>('[data-action="choose-card"]').forEach((element) => {
    element.addEventListener("click", () => {
      if (!state.controller) {
        return;
      }
      const cardId = element.dataset.cardId;
      if (!cardId) {
        return;
      }
      state.controller.post({
        $: "choose",
        id: state.controller.viewerId,
        cardId,
      });
    });
  });

  document.querySelector('[data-action="advance-turn"]')?.addEventListener("click", () => {
    if (!state.controller) {
      return;
    }
    state.controller.post({
      $: "advance",
      id: state.controller.viewerId,
    });
  });

  document.querySelector('[data-action="dismiss-result"]')?.addEventListener("click", () => {
    if (!state.controller) {
      return;
    }
    state.dismissedMatchId = state.controller.getState().match.matchId;
    rerender();
  });

  const chatForm = document.querySelector('[data-action="send-chat"]') as HTMLFormElement | null;
  const chatInput = document.getElementById("chat-input") as HTMLInputElement | null;
  chatForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!state.controller || !chatInput) {
      return;
    }
    const text = chatInput.value.trim();
    if (!text) {
      return;
    }
    shouldFocusChatInputAfterRender = true;
    state.controller.post({
      $: "chat",
      id: state.controller.viewerId,
      name: state.controller.viewerName,
      text,
    });
    chatInput.value = "";
  });

  syncAuxiliaryPanels(state, viewerId);
}

function syncAuxiliaryPanels(state: AppState, viewerId: string): void {
  if (!state.controller) {
    lastChatViewportKey = "";
    shouldFocusChatInputAfterRender = false;
    return;
  }

  const roomState = state.controller.getState();

  if (state.screen === "solo" && state.controller.mode === "solo") {
    shouldFocusChatInputAfterRender = false;
    const entries = getSoloLogEntries(roomState, viewerId);
    const lastEntry = entries[entries.length - 1] ?? "";
    const nextViewportKey = `${roomState.match.matchId}:${roomState.match.status}:${roomState.match.roundIndex}:${entries.length}:${lastEntry}`;
    const logList = document.querySelector(".solo-log-list") as HTMLDivElement | null;

    if (logList && nextViewportKey !== lastChatViewportKey) {
      lastChatViewportKey = nextViewportKey;
      window.requestAnimationFrame(() => {
        logList.scrollTop = logList.scrollHeight;
      });
    }
    return;
  }

  const chatInput = document.getElementById("chat-input") as HTMLInputElement | null;
  if (state.screen !== "room" || state.controller.mode !== "multiplayer") {
    lastChatViewportKey = "";
    shouldFocusChatInputAfterRender = false;
    return;
  }

  const latestMessage = roomState.chat[roomState.chat.length - 1] ?? null;
  const nextViewportKey = latestMessage ? `${roomState.chat.length}:${latestMessage.id}` : "empty";
  const chatList = document.querySelector(".chat-list") as HTMLDivElement | null;

  if (chatList && nextViewportKey !== lastChatViewportKey) {
    lastChatViewportKey = nextViewportKey;
    window.requestAnimationFrame(() => {
      chatList.scrollTop = chatList.scrollHeight;
    });
  }

  if (shouldFocusChatInputAfterRender && chatInput) {
    shouldFocusChatInputAfterRender = false;
    window.requestAnimationFrame(() => {
      chatInput.focus();
      const caret = chatInput.value.length;
      chatInput.setSelectionRange(caret, caret);
    });
  }
}

function nextBotCard(match: MatchState, seat: PlayerSlot, plannedCardId: string | null): CardState | null {
  const available = match.hands[seat].filter((card) => !card.used);
  if (available.length === 0) {
    return null;
  }

  const plannedCard = plannedCardId ? available.find((card) => card.id === plannedCardId) ?? null : null;
  if (plannedCard) {
    return plannedCard;
  }

  const randomIndex = Math.floor(Math.random() * available.length);
  return available[randomIndex] ?? null;
}

function boardPerspective(viewerSeat: Seat): { top: PlayerSlot; bottom: PlayerSlot } {
  if (viewerSeat === "p2") {
    return {
      top: "p1",
      bottom: "p2",
    };
  }

  return {
    top: "p2",
    bottom: "p1",
  };
}

function labelPerspective(state: RoomState, slot: PlayerSlot, viewerSeat: Seat, fallback: string): string {
  const participantId = slot === "p1" ? state.match.p1Id : state.match.p2Id;
  const participant = participantId ? state.participants[participantId] : null;
  if (!participant) {
    return fallback;
  }
  if (viewerSeat === slot) {
    return "sua mao";
  }
  return participant.name;
}

function statusHeadline(match: MatchState, viewerSeat: Seat): string {
  if (match.status === "waiting") {
    return "Cada jogador escolhe o cargo inicial antes da partida comecar.";
  }

  if (match.status === "ended") {
    return "As quatro rodadas terminaram. Veja o resumo final ou monte outra partida.";
  }

  if (match.status === "revealed") {
    return "As cartas do turno atual ja foram reveladas.";
  }

  if (match.turn === viewerSeat) {
    return "Sua vez de escolher uma carta e travar no centro.";
  }

  if (match.turn) {
    return `${seatRoleName(match, match.turn)} escolhe agora.`;
  }

  return "A rodada esta aguardando a resolucao atual.";
}

function boardNarration(match: MatchState, viewerSeat: Seat): string {
  if (match.status === "ended") {
    return "A partida terminou. O resumo final esta disponivel.";
  }

  if (match.status === "revealed" && match.reveal) {
    return `${match.reveal.comboLabel} · ${match.reveal.roundEnded ? "rodada encerrada" : "nenhuma pontuacao"}`;
  }

  if (match.turn === viewerSeat) {
    return "Clique numa carta da sua mao para enviar ao centro.";
  }

  if (match.turn) {
    return `${seatRoleName(match, match.turn)} decide agora. As duas cartas so abrem depois da resposta.`;
  }

  return "A jogada atual esta sendo resolvida.";
}

function resultSubtitle(match: MatchState, viewerSeat: Seat, state: RoomState): string {
  if (match.winner === "tie") {
    return "Empate tecnico depois das quatro rodadas.";
  }

  const slot = match.winner;
  if (!slot) {
    return "A partida foi encerrada.";
  }
  const participantId = slot === "p1" ? match.p1Id : match.p2Id;
  const participant = participantId ? state.participants[participantId] : null;
  const suffix = viewerSeat === slot ? "Voce venceu." : "Esse jogador venceu a partida.";
  return `${participant?.name ?? slot.toUpperCase()} venceu. ${suffix}`;
}

function matchWinnerLabel(match: MatchState, state: RoomState): string {
  if (match.winner === "tie") {
    return "Empate geral";
  }
  if (match.winner === "p1" && match.p1Id) {
    return `${state.participants[match.p1Id]?.name ?? "P1"} venceu`;
  }
  if (match.winner === "p2" && match.p2Id) {
    return `${state.participants[match.p2Id]?.name ?? "P2"} venceu`;
  }
  return "Partida encerrada";
}

function cardClass(kind: CardKind): string {
  switch (kind) {
    case "spy":
      return "spy";
    case "agent":
      return "agent";
    case "true_file":
      return "true-file";
    case "false_file":
      return "false-file";
  }
}

function prepareName(value: string): string {
  return value.trim().slice(0, 24) || "Operador";
}

function sanitizeRoom(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-_]/g, "")
    .slice(0, 32);
}

function loadName(): string {
  return window.localStorage.getItem(STORAGE_NAME_KEY) ?? "";
}

function saveName(name: string): void {
  window.localStorage.setItem(STORAGE_NAME_KEY, name);
}

function loadViewerId(): string {
  const existingSeed = window.sessionStorage.getItem(STORAGE_ID_KEY);
  if (existingSeed) {
    return `${existingSeed}::${PAGE_INSTANCE_ID}`;
  }

  // Older builds stored the viewer id in localStorage, which made all tabs
  // share the same identity. Clearing it here prevents cross-tab seat collisions.
  window.localStorage.removeItem(STORAGE_ID_KEY);

  const nextSeed =
    typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `viewer-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  window.sessionStorage.setItem(STORAGE_ID_KEY, nextSeed);
  return `${nextSeed}::${PAGE_INSTANCE_ID}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value);
}
