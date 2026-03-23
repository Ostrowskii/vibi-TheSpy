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
  RoomMode,
  RoomPost,
  RoomState,
  RoundSummary,
  Seat,
} from "./types";

const STORAGE_NAME_KEY = "the-spy-name";
const STORAGE_ID_KEY = "the-spy-viewer-id";
const ROOM_SCHEMA_VERSION = "v4";
const ROOM_NAMESPACE = "the-spy-" + ROOM_SCHEMA_VERSION;

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
  readonly mode: RoomMode;
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

  constructor(viewerId: string, viewerName: string, roomId: string) {
    this.viewerId = viewerId;
    this.viewerName = viewerName;
    this.roomId = roomId;
    this.state = createInitialRoomState(roomId);
    this.post({
      $: "join",
      id: viewerId,
      name: viewerName,
      isBot: 0,
    });
    this.post({
      $: "join",
      id: this.botId,
      name: this.botName,
      isBot: 1,
    });
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

    if (match.status === "playing" && match.turn && botSeat && match.turn === botSeat) {
      const card = nextBotCard(match, botSeat);
      if (!card) {
        return;
      }

      this.botTimer = window.setTimeout(() => {
        this.post({
          $: "choose",
          id: this.botId,
          cardId: card.id,
        });
      }, 750);
      return;
    }

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
    window.removeEventListener("beforeunload", this.unloadHandler);
    this.game.close();
  }

  private emit(): void {
    this.listeners.forEach((listener) => listener());
  }

  private installGameHooks(): void {
    const internalGame = this.game as unknown as {
      add_remote_post?: (post: unknown) => void;
      add_local_post?: (name: string, post: unknown) => void;
      remove_local_post?: (name: string) => void;
    };

    const addRemotePost = internalGame.add_remote_post;
    if (typeof addRemotePost === "function") {
      internalGame.add_remote_post = (post: unknown) => {
        addRemotePost.call(this.game, post);
        this.emitIfChanged();
      };
    }

    const addLocalPost = internalGame.add_local_post;
    if (typeof addLocalPost === "function") {
      internalGame.add_local_post = (name: string, post: unknown) => {
        addLocalPost.call(this.game, name, post);
        this.emitIfChanged();
      };
    }

    const removeLocalPost = internalGame.remove_local_post;
    if (typeof removeLocalPost === "function") {
      internalGame.remove_local_post = (name: string) => {
        removeLocalPost.call(this.game, name);
        this.emitIfChanged();
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
  screen: "home" | "room";
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

  return `
    <div class="screen room-screen">
      <div class="main-surface">
        ${renderGamePanel(roomState, viewerId, state.controller.mode)}
        ${renderSidebar(roomState, viewerId, state.controller)}
      </div>
      ${shouldOpenModal ? renderResultModal(roomState, viewerId) : ""}
    </div>
  `;
}

function renderHome(state: AppState): string {
  const multiplayerEnabled = Boolean(state.currentName.trim() && state.currentRoom.trim());
  return `
    <div class="screen home-screen">
      <section class="home-card">
        <div class="home-hero">
          <span class="eyebrow">Projeto multiplayer de cartas</span>
          <h1>The Spy</h1>
          <p>
            Entre numa sala para jogar online com espectadores e chat, ou valide
            as quatro rodadas primeiro no modo local contra o bot.
          </p>
        </div>

        <div class="home-actions">
          <article class="action-card">
            <h2>Vs Bot</h2>
            <p>
              Partida local com o mesmo tabuleiro, regras e alternancia de papeis.
            </p>
            <div class="button-row">
              <button class="secondary-button" data-action="start-solo">Iniciar vs bot</button>
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

function renderSidebar(state: RoomState, viewerId: string, controller: Controller): string {
  return `
    <aside class="sidebar">
      ${renderLeavePanel()}
      ${renderPlayersPanel(state, viewerId)}
      ${renderChatPanel(state)}
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
      const youLabel = participant.id === viewerId ? " · voce" : "";
      return `
        <div class="player-row">
          <strong>${escapeHtml(participant.name)}${youLabel}</strong>
          <div class="button-row">
            <span class="seat-pill ${seat === "spectator" ? "spectator" : ""}">${escapeHtml(seatLabel)}</span>
            ${participant.isBot ? '<span class="tag bot">bot</span>' : '<span class="tag">humano</span>'}
          </div>
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
  const messages = state.chat
    .map((message) => {
      if (message.kind === "system") {
        return `
          <article class="chat-message system">
            <p>${escapeHtml(message.text)}</p>
          </article>
        `;
      }

      return `
        <article class="chat-message">
          <strong>${escapeHtml(message.authorName)}</strong>
          <p>${escapeHtml(message.text)}</p>
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
      <form class="chat-form" data-action="send-chat">
        <input
          class="chat-input"
          id="chat-input"
          maxlength="220"
          placeholder="Escreva uma mensagem para a sala"
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
      <button class="ghost-button sidebar-leave-button" data-action="leave-room">Sair da sala</button>
    </section>
  `;
}

function renderGamePanel(state: RoomState, viewerId: string, mode: RoomMode): string {
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
        ${mode === "solo" ? '<span class="tiny">Modo local: o bot ocupa o cargo restante automaticamente.</span>' : ""}
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

  return `
    <div class="waiting-panel">
      <div class="waiting-seat-grid">
        <button
          class="seat-choice ${informantOccupantId ? "occupied" : "available"} ${informantOccupantId === viewerId ? "selected" : ""}"
          data-action="ready-role"
          data-seat="${informantSeat}"
          ${canChooseInformant ? "" : "disabled"}
        >
          <span class="seat-choice-kicker">${escapeHtml(waitingCopy)}</span>
          <strong class="seat-choice-title">Informante do Governo</strong>
          <span class="seat-choice-copy">${escapeHtml(informantText)}</span>
        </button>
        <button
          class="seat-choice ${commanderOccupantId ? "occupied" : "available"} ${commanderOccupantId === viewerId ? "selected" : ""}"
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

function renderResultModal(state: RoomState, viewerId: string): string {
  const match = state.match;
  const rows = match.roundSummaries.map((summary) => renderSummaryRow(summary)).join("");
  const winner = matchWinnerLabel(match, state);
  const viewerSeat = getSeat(state, viewerId);
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
          <span class="tiny">Voltar fecha o popup e devolve a sala ao estado de lobby com os botoes de cargo.</span>
          <button class="primary-button" data-action="dismiss-result">Voltar para o lobby</button>
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

  document.querySelector('[data-action="start-solo"]')?.addEventListener("click", () => {
    const name = prepareName(state.currentName);
    state.currentName = name;
    saveName(name);
    const roomId = `solo-${Date.now().toString(36)}`;
    state.controller?.destroy();
    const controller = new SoloController(viewerId, name, roomId);
    controller.subscribe(() => rerender());
    state.controller = controller;
    state.dismissedMatchId = null;
    state.screen = "room";
    rerender();
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
    state.controller.post({
      $: "chat",
      id: state.controller.viewerId,
      name: state.controller.viewerName,
      text,
    });
    chatInput.value = "";
  });
}

function nextBotCard(match: MatchState, seat: PlayerSlot): CardState | null {
  const available = match.hands[seat].filter((card) => !card.used);
  if (available.length === 0) {
    return null;
  }

  const opponentSeat = oppositeSlot(seat);
  const opponentCardId = match.selectedCardIds[opponentSeat];
  if (!opponentCardId) {
    return available[0] ?? null;
  }

  const opponentCard = match.hands[opponentSeat].find((card) => card.id === opponentCardId);
  const seatRole = getRoleForSlot(match.roundIndex, seat);
  if (!opponentCard) {
    return available[0] ?? null;
  }

  if (seatRole === "government_informant") {
    if (opponentCard.kind === "spy") {
      return available.find((card) => card.kind === "false_file") ?? available[0] ?? null;
    }
    return available.find((card) => card.kind === "true_file") ?? available[0] ?? null;
  }

  if (opponentCard.kind === "true_file") {
    return available.find((card) => card.kind === "spy") ?? available[0] ?? null;
  }
  return available.find((card) => card.kind === "agent") ?? available[0] ?? null;
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
    return "As quatro rodadas terminaram. Feche o popup e monte outra partida na mesma sala.";
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
  const existing = window.sessionStorage.getItem(STORAGE_ID_KEY);
  if (existing) {
    return existing;
  }

  // Older builds stored the viewer id in localStorage, which made all tabs
  // share the same identity. Clearing it here prevents cross-tab seat collisions.
  window.localStorage.removeItem(STORAGE_ID_KEY);

  const next =
    typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `viewer-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  window.sessionStorage.setItem(STORAGE_ID_KEY, next);
  return next;
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
