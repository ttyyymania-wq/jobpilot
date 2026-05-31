/* eslint-disable no-console */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import {
  AppRenderer,
  type RequestHandlerExtra,
} from '@ggui-ai/react';
import {
  useMcpAppsChat,
  type ChatEntry,
  type RenderRef,
  type ToolCallEntry,
  type UseMcpAppsChatResult,
} from '@ggui-ai/react/chat-helpers';
import type {
  CallToolRequest,
  CallToolResult,
  ReadResourceRequest,
  ReadResourceResult,
} from '@modelcontextprotocol/sdk/types.js';

// ── PDF text extraction ──────────────────────────────────────────────────────
// 워커는 로컬 번들(Vite `?url`)로 로드 — 설치된 pdfjs-dist 버전과 항상 일치한다.
// (CDN 고정 버전은 라이브러리 버전과 어긋나면 "API version does not match Worker
//  version"으로 파싱이 통째로 실패하므로 사용하지 않는다.)
async function extractPdfText(file: File): Promise<string> {
  const pdfjs = await import('pdfjs-dist');
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url'))
    .default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
  const textParts: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ');
    textParts.push(pageText);
  }
  return textParts.join('\n');
}

const MAX_RESUME_CHARS = 20000;

async function extractFileText(file: File): Promise<string | null> {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'pdf') {
    return extractPdfText(file);
  }
  if (ext === 'txt' || ext === 'md') {
    return file.text();
  }
  return null;
}

/**
 * 이력서 추출 텍스트에서 노이즈 라인을 제거한다.
 * - `file://` URL 라인 (PDF 렌더링 아티팩트)
 * - `YY. M. D. 오전/오후 H:MM` 형태의 날짜/시간 라인
 * - `숫자/숫자` 형태의 페이지번호 단독 라인
 * - 3줄 이상 연속 빈 줄을 2줄로 압축
 */
function sanitizeResumeText(raw: string): string {
  return raw
    .split('\n')
    .filter((line) => {
      const t = line.trim();
      // file:// URL 라인
      if (/^file:\/\//i.test(t)) return false;
      // 날짜 라인: "26. 5. 31. 오전 9:46" 등
      if (/^\d{2,4}\.\s*\d{1,2}\.\s*\d{1,2}\.\s*(오전|오후)\s*\d{1,2}:\d{2}/.test(t)) return false;
      // 페이지번호 단독 라인: "1/1", "2/5" 등
      if (/^\d+\/\d+$/.test(t)) return false;
      return true;
    })
    .join('\n')
    // 연속 빈 줄 3개 이상 → 2개로 압축
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * 이력서 첨부 마커 — 사용자가 직접 입력할 수 없는 토큰.
 * 이 마커 이후의 내용은 화면에서 숨기고 에이전트에게만 전달된다.
 */
const RESUME_ATTACHMENT_MARKER = '\n\n⟦RESUME_ATTACHMENT⟧\n';

/**
 * The hook's drop-in `<AppRenderer onMessage>` handler. The sample
 * stays ggui-protocol-agnostic for the `ui/message` path — it forwards
 * the guest message verbatim through this handler; the agent-server
 * backend is the sole party that recognizes + guards any `ai.ggui/*`
 * `_meta` keys.
 */
type AppMessageHandler = UseMcpAppsChatResult['handleAppMessage'];

type LayoutMode = 'inline' | 'panel';

interface ChatProps {
  /**
   * MCP-Apps-spec agent backend base URL (e.g. `http://localhost:6790`).
   * Wired into the `useMcpAppsChat` hook for the single `POST /agent`
   * endpoint (`kind:'chat'` for prompts, `kind:'tool-call'` for the
   * iframe → MCP relay) + `GET /agent?chatId=X` rehydration. The
   * frontend stays SDK-agnostic — the backend decides which LLM it
   * drives.
   */
  readonly agentEndpoint: string;
  /**
   * Sandbox-proxy origin (second-origin iframe host, per MCP-Apps spec).
   * Read by {@link App} from the `GET /` manifest's `sandboxProxyUrl`
   * field and threaded down here so a `<Chat>` mount always has a
   * resolved URL — no in-component loading state.
   */
  readonly sandboxUrl: string;
}

// localStorage keys for the guest-token flow. The token survives
// reloads so a returning visitor lands on the same chats; the chatId
// is URL-resident so cross-tab links land on the same conversation.
const LS_GUEST_TOKEN = 'ggui-basic-web/guestToken';
const URL_CHAT_PARAM = 'chat';

/**
 * Read the URL `?chat=<id>` — returns the chatId when present so the
 * hook rehydrates that specific conversation, else `undefined` so the
 * server allocates a fresh id on the first POST.
 */
function getInitialChatId(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  const fromUrl = new URL(window.location.href).searchParams.get(
    URL_CHAT_PARAM,
  );
  return fromUrl && fromUrl.length > 0 ? fromUrl : undefined;
}

/**
 * Mint a fresh guest token via the agent backend's
 * `POST /auth/guest` mount (the spec-canonical endpoint mounted by
 * `@ggui-ai/agent-server`'s default `createGuestTokenAuth()`).
 */
async function mintGuestToken(agentEndpoint: string): Promise<string> {
  const res = await fetch(`${agentEndpoint}/auth/guest`, { method: 'POST' });
  if (!res.ok) {
    throw new Error(`POST /auth/guest returned ${res.status}`);
  }
  const body = (await res.json()) as { guestToken?: unknown };
  if (typeof body.guestToken !== 'string' || body.guestToken.length === 0) {
    throw new Error('POST /auth/guest response missing guestToken');
  }
  return body.guestToken;
}

/**
 * Chat panel + iframe area for an MCP-Apps-spec agent backend.
 *
 * Auth: bearer guest token resolved at mount (or cached in
 * localStorage). The token is the principal id the backend gates
 * chat-ownership on; clearing localStorage = fresh guest = new
 * conversations.
 */
export function Chat({ agentEndpoint, sandboxUrl }: ChatProps) {
  // Bearer token (kept in a ref so the per-fetch `getAuthToken`
  // callback always sees the latest). null = not yet minted.
  const guestTokenRef = useRef<string | null>(null);
  const [guestTokenReady, setGuestTokenReady] = useState(false);

  // Boot: pull cached token from localStorage; mint a fresh one if
  // absent. Async; the chat panel guards against premature renders
  // via `guestTokenReady`.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const cached =
          typeof window !== 'undefined'
            ? window.localStorage.getItem(LS_GUEST_TOKEN)
            : null;
        if (cached && cached.length > 0) {
          guestTokenRef.current = cached;
          if (!cancelled) setGuestTokenReady(true);
          return;
        }
        const fresh = await mintGuestToken(agentEndpoint);
        if (cancelled) return;
        guestTokenRef.current = fresh;
        window.localStorage.setItem(LS_GUEST_TOKEN, fresh);
        setGuestTokenReady(true);
      } catch (err) {
        console.warn('[Chat] guest-token mint failed', err);
        // Surface as "ready" anyway — requests will 401 + show error
        // entries; better than a permanent loading state.
        if (!cancelled) setGuestTokenReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [agentEndpoint]);

  // Stable chat id from URL (initial) + server-allocated thereafter.
  const [chatId, setChatId] = useState<string | undefined>(() =>
    getInitialChatId(),
  );

  const getAuthToken = useCallback(
    () => guestTokenRef.current ?? undefined,
    [],
  );

  // 401 handler: clear the cached token, mint a fresh one, signal
  // retry. The hook reissues the failing request once on `true`.
  const onUnauthenticated = useCallback(async (): Promise<boolean> => {
    try {
      const fresh = await mintGuestToken(agentEndpoint);
      guestTokenRef.current = fresh;
      window.localStorage.setItem(LS_GUEST_TOKEN, fresh);
      return true;
    } catch (err) {
      console.warn('[Chat] guest-token refresh failed', err);
      return false;
    }
  }, [agentEndpoint]);

  // Stamp the server-allocated chatId into URL + state once
  // received. Quiet when the URL already carries the right id (this
  // covers the rehydration path).
  const onChatAllocated = useCallback((allocated: string) => {
    setChatId((prev) => {
      if (prev === allocated) return prev;
      const url = new URL(window.location.href);
      url.searchParams.set(URL_CHAT_PARAM, allocated);
      window.history.replaceState({}, '', url.toString());
      return allocated;
    });
  }, []);

  const { entries, renders, hostDisplayMode, sending, send, handleAppMessage, abort } =
    useMcpAppsChat({
      chatEndpoint: `${agentEndpoint}/agent`,
      snapshotEndpoint: `${agentEndpoint}/agent`,
      ...(chatId !== undefined ? { chatId } : {}),
      onChatAllocated,
      getAuthToken,
      onUnauthenticated,
    });

  const [prompt, setPrompt] = useState('');
  // Default to panel (side-pane) layout; the agent's `hostDisplayMode`
  // hint (if any) still overrides via the effect below.
  const [layout, setLayout] = useState<LayoutMode>('panel');
  const historyRef = useRef<HTMLDivElement | null>(null);

  // ── File upload state ─────────────────────────────────────────────────────
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploadState, setUploadState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [uploadFileName, setUploadFileName] = useState<string>('');
  const [uploadMsg, setUploadMsg] = useState<string>('');
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    if (hostDisplayMode === undefined) return;
    setLayout(hostDisplayMode === 'inline' ? 'inline' : 'panel');
  }, [hostDisplayMode]);

  useEffect(() => {
    const el = historyRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [entries.length]);

  const newSession = useCallback(() => {
    // Stop any in-flight stream so its tail doesn't bleed into the fresh
    // conversation, then drop the URL chat param + local state. Clearing
    // `chatId` makes useMcpAppsChat reset entries/renders; the next POST
    // allocates a fresh server-side chatId, which lands via
    // onChatAllocated.
    abort();
    const url = new URL(window.location.href);
    url.searchParams.delete(URL_CHAT_PARAM);
    window.history.replaceState({}, '', url.toString());
    setChatId(undefined);
  }, [abort]);

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const text = prompt.trim();
    if (!text || sending) return;
    setPrompt('');
    void send(text);
  };

  const processUploadedFile = useCallback(async (file: File) => {
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    if (ext !== 'pdf' && ext !== 'txt' && ext !== 'md') {
      setUploadFileName(file.name);
      setUploadState('error');
      setUploadMsg('지원하지 않는 형식입니다. .txt / .md / .pdf 또는 텍스트로 붙여넣어 주세요.');
      return;
    }
    setUploadFileName(file.name);
    setUploadState('loading');
    setUploadMsg('');
    try {
      const text = await extractFileText(file);
      if (text === null || text.trim().length === 0) {
        setUploadState('error');
        setUploadMsg('텍스트를 추출할 수 없었습니다. 텍스트로 붙여넣어 주세요.');
        return;
      }
      let body = sanitizeResumeText(text);
      let truncated = false;
      if (body.length > MAX_RESUME_CHARS) {
        body = body.slice(0, MAX_RESUME_CHARS);
        truncated = true;
      }
      // 사용자 버블에는 짧은 라벨만 보이고, 에이전트에겐 마커 뒤 전문이 전달된다.
      const displayLabel = `📎 ${file.name} 분석 요청`;
      const agentPayload = `다음은 제 이력서입니다. 분석해서 맞는 공고를 찾아주세요:\n\n${body}${truncated ? '\n\n(※ 이력서가 너무 길어 앞부분만 전송됐습니다.)' : ''}`;
      const message = `${displayLabel}${RESUME_ATTACHMENT_MARKER}${agentPayload}`;
      setUploadState('done');
      setUploadMsg(truncated ? '이력서가 길어 앞부분만 전송됩니다.' : '');
      void send(message);
      // Reset after a short delay so user sees feedback
      setTimeout(() => {
        setUploadState('idle');
        setUploadFileName('');
        setUploadMsg('');
        if (fileInputRef.current) fileInputRef.current.value = '';
      }, 2000);
    } catch (err) {
      console.warn('[Upload] extraction failed', err);
      setUploadState('error');
      setUploadMsg('파일 읽기 실패. 텍스트로 붙여넣어 주세요.');
    }
  }, [send]);

  const onFileChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void processUploadedFile(file);
  }, [processUploadedFile]);

  const onDragOver = useCallback((e: DragEvent<HTMLFormElement>) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const onDragLeave = useCallback((e: DragEvent<HTMLFormElement>) => {
    e.preventDefault();
    setDragOver(false);
  }, []);

  const onDrop = useCallback((e: DragEvent<HTMLFormElement>) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void processUploadedFile(file);
  }, [processUploadedFile]);

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      e.key === 'Enter' &&
      !e.shiftKey &&
      !e.metaKey &&
      !e.ctrlKey &&
      !e.altKey
    ) {
      e.preventDefault();
      (e.currentTarget.form as HTMLFormElement).requestSubmit();
    }
  };

  if (!guestTokenReady) {
    return (
      <div style={{ padding: 24, color: '#888', fontFamily: 'system-ui' }}>
        Provisioning guest session…
      </div>
    );
  }

  return (
    <div className={`layout layout-${layout}`}>
      <aside className="chat">
        <header>
          <div className="title">
            <div className="jp-logo">
              <span className="jp-logo-icon" aria-hidden="true">🧭</span>
              <div>
                <h1>JobPilot</h1>
                <p className="subtitle">면접 전날 밤까지 챙기는 채용 에이전트</p>
              </div>
            </div>
          </div>
          <div className="header-actions">
            <button
              type="button"
              className="new-session"
              onClick={newSession}
              title="Start a fresh conversation"
              data-testid="new-session"
            >
              + New
            </button>
            <div className="layout-toggle" role="group" aria-label="Layout">
              <button
                type="button"
                className={layout === 'inline' ? 'active' : ''}
                onClick={() => setLayout('inline')}
                data-testid="layout-inline"
              >
                Inline
              </button>
              <button
                type="button"
                className={layout === 'panel' ? 'active' : ''}
                onClick={() => setLayout('panel')}
                data-testid="layout-panel"
              >
                Panel
              </button>
            </div>
          </div>
        </header>

        <div className="history" ref={historyRef} role="log" aria-live="polite">
          {entries.length === 0 ? <EmptyState onPrompt={(text) => { void send(text); }} /> : null}
          {entries.map((entry) => (
            <ChatEntryView
              key={entry.id}
              entry={entry}
              renderInline={layout === 'inline'}
              sandboxUrl={sandboxUrl}
              agentEndpoint={agentEndpoint}
              getAuthToken={getAuthToken}
              onAppMessage={handleAppMessage}
            />
          ))}
        </div>

        <form
          onSubmit={onSubmit}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          className={dragOver ? 'drag-over' : ''}
        >
          {/* Upload feedback bar */}
          {uploadState !== 'idle' ? (
            <div className={`upload-bar upload-bar-${uploadState}`}>
              {uploadState === 'loading' ? (
                <span className="upload-spinner" aria-hidden="true" />
              ) : uploadState === 'done' ? (
                <span aria-hidden="true">✓</span>
              ) : (
                <span aria-hidden="true">✕</span>
              )}
              <span className="upload-filename">{uploadFileName}</span>
              {uploadMsg ? <span className="upload-msg">{uploadMsg}</span> : null}
            </div>
          ) : null}
          <div className="composer-row">
            {/* Hidden file input */}
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt,.md,.pdf"
              style={{ display: 'none' }}
              onChange={onFileChange}
              aria-label="이력서 파일 업로드"
            />
            {/* Upload button */}
            <button
              type="button"
              className="upload-btn"
              onClick={() => fileInputRef.current?.click()}
              disabled={sending || uploadState === 'loading'}
              title="이력서 파일 업로드 (.txt / .md / .pdf)"
              aria-label="이력서 파일 업로드"
            >
              📎
            </button>
            <textarea
              name="prompt"
              placeholder="이력서 파일을 드래그하거나 📎로 올리세요  (Shift+Enter 줄바꿈)"
              rows={1}
              autoFocus
              value={prompt}
              disabled={sending}
              onChange={(e: ChangeEvent<HTMLTextAreaElement>) =>
                setPrompt(e.target.value)
              }
              onKeyDown={onKeyDown}
            />
            <button
              type={sending ? 'button' : 'submit'}
              disabled={!sending && !prompt.trim()}
              onClick={sending ? abort : undefined}
              aria-label={sending ? 'Stop' : 'Send'}
              title={sending ? 'Stop' : 'Send'}
            >
              {sending ? (
                <span
                  aria-hidden="true"
                  style={{
                    display: 'inline-block',
                    width: 10,
                    height: 10,
                    background: 'currentColor',
                    borderRadius: 2,
                  }}
                />
              ) : (
                'Send'
              )}
            </button>
          </div>
        </form>
      </aside>

      {layout === 'panel' ? (
        <main className="ui-pane">
          <PanelView
            renders={renders}
            sandboxUrl={sandboxUrl}
            agentEndpoint={agentEndpoint}
            getAuthToken={getAuthToken}
            onAppMessage={handleAppMessage}
          />
        </main>
      ) : null}
    </div>
  );
}

const QUICK_PROMPTS = [
  '3년차 프론트엔드 개발자 공고 찾아줘',
  '내 이력서로 맞는 공고 추천해줘',
  '토스 면접 6월 5일 오후 2시로 잡혔어',
  '면접 가는 길이랑 그날 날씨 알려줘',
] as const;

function EmptyState({ onPrompt }: { onPrompt: (text: string) => void }) {
  return (
    <div className="empty-state">
      <div className="empty-state-mark">🧭</div>
      <h2>JobPilot에 오신 걸 환영해요</h2>
      <p>
        공고 탐색, 일정 등록, 면접 준비, 이동 경로까지
        <br />
        채용의 모든 순간을 함께합니다.
      </p>
      <div className="jp-quick-prompts">
        {QUICK_PROMPTS.map((text) => (
          <button
            key={text}
            type="button"
            className="jp-quick-btn"
            onClick={() => onPrompt(text)}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

function ChatEntryView({
  entry,
  renderInline,
  sandboxUrl,
  agentEndpoint,
  getAuthToken,
  onAppMessage,
}: {
  entry: ChatEntry;
  renderInline: boolean;
  sandboxUrl: string;
  agentEndpoint: string;
  getAuthToken: () => string | undefined;
  onAppMessage: AppMessageHandler;
}) {
  if (entry.kind === 'render') {
    if (renderInline) {
      return (
        <div className="msg render-wrap">
          <ResourceFrame
            item={entry.render}
            sandboxUrl={sandboxUrl}
            agentEndpoint={agentEndpoint}
            getAuthToken={getAuthToken}
            onAppMessage={onAppMessage}
          />
        </div>
      );
    }
    return (
      <div className="msg tool">
        ← UI · {shortLabel(entry.render)}
      </div>
    );
  }
  if (entry.kind === 'end') {
    return (
      <div className="msg turn-end" data-testid="turn-end">
        turn ended · {entry.subtype}
      </div>
    );
  }
  if (entry.kind === 'tool-call') {
    return <ToolCallView entry={entry} />;
  }
  // user 메시지: 마커 이후 이력서 본문은 숨기고 첨부 칩만 표시한다.
  if (entry.kind === 'user') {
    const markerIdx = entry.text.indexOf('⟦RESUME_ATTACHMENT⟧');
    if (markerIdx !== -1) {
      const displayText = entry.text.slice(0, markerIdx).trim();
      const bodyLength = entry.text.length - markerIdx - '⟦RESUME_ATTACHMENT⟧'.length;
      return (
        <div className="msg user">
          <span>{displayText}</span>
          <span className="resume-attachment-chip" title={`이력서 본문 ${bodyLength.toLocaleString()}자 첨부됨 (에이전트에게 전달)`}>
            📄 이력서 본문 {Math.round(bodyLength / 100) * 100}자 첨부됨
          </span>
        </div>
      );
    }
  }
  return (
    <div className={`msg ${entry.kind}`}>{renderInlineMarkdown(entry.text)}</div>
  );
}

/**
 * 채팅 메시지의 경량 인라인 마크다운 렌더러.
 * `**볼드**`만 <strong>으로 변환하고 나머지는 그대로 둔다. (별표 노출 방지)
 * 외부 마크다운 라이브러리 없이 정규식 분할로 처리 — XSS 위험 없음(텍스트 노드만 생성).
 */
function renderInlineMarkdown(text: string): ReactNode {
  if (!text) return text;
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    const m = /^\*\*([^*]+)\*\*$/.exec(part);
    if (m) return <strong key={i}>{m[1]}</strong>;
    return <span key={i}>{part}</span>;
  });
}

/**
 * gcal_create_event 결과에서 icsContent를 안전하게 추출한다.
 * result는 unknown이므로 structuredContent 또는 JSON 파싱 양쪽을 시도.
 */
function extractIcsContent(result: unknown): string | null {
  if (result === undefined || result === null) return null;

  // structuredContent 직접 접근 (ggui SDK가 result에 그대로 넣음)
  const r = result as Record<string, unknown>;
  if (typeof r.icsContent === 'string' && r.icsContent.startsWith('BEGIN:VCALENDAR')) {
    return r.icsContent;
  }

  // content[0].text에 JSON 문자열로 들어오는 경우 처리
  const contentArr = r.content;
  if (Array.isArray(contentArr) && contentArr.length > 0) {
    const first = contentArr[0] as Record<string, unknown>;
    if (typeof first.text === 'string') {
      try {
        const parsed = JSON.parse(first.text) as Record<string, unknown>;
        if (typeof parsed.icsContent === 'string' && parsed.icsContent.startsWith('BEGIN:VCALENDAR')) {
          return parsed.icsContent;
        }
      } catch {
        // 파싱 실패 — 무시
      }
    }
  }

  return null;
}

/**
 * .ics 콘텐츠에서 단일 라인 값을 추출 (DTSTART/DTEND/SUMMARY/LOCATION 등).
 * RFC 5545 라인은 CRLF 구분 + `KEY:VALUE` 또는 `KEY;PARAM=...:VALUE` 형태.
 */
function icsLineValue(ics: string, key: string): string | null {
  const re = new RegExp(`^${key}(?:;[^:]*)?:(.*)$`, 'm');
  const m = re.exec(ics);
  return m ? m[1].replace(/\r$/, '').trim() : null;
}

/** .ics 이스케이프 해제 (\\, \; \, \n). */
function unescapeIcs(text: string): string {
  return text
    .replace(/\\n/g, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\');
}

/**
 * gcal_create_event 결과(또는 .ics)에서 구글 캘린더 이벤트 생성 URL을 만든다.
 * .ics의 DTSTART/DTEND는 이미 UTC(YYYYMMDDTHHMMSSZ) 형식이라 그대로 사용.
 * 추출 실패 시 null.
 */
function buildGoogleCalendarUrl(icsContent: string): string | null {
  const start = icsLineValue(icsContent, 'DTSTART');
  const end = icsLineValue(icsContent, 'DTEND');
  if (!start || !end) return null;
  const summary = unescapeIcs(icsLineValue(icsContent, 'SUMMARY') ?? '면접 일정');
  const location = unescapeIcs(icsLineValue(icsContent, 'LOCATION') ?? '');
  const details = unescapeIcs(icsLineValue(icsContent, 'DESCRIPTION') ?? '');

  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: summary,
    dates: `${start}/${end}`,
  });
  if (location) params.set('location', location);
  if (details) params.set('details', details);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

function openGoogleCalendar(icsContent: string): void {
  const url = buildGoogleCalendarUrl(icsContent);
  if (url) window.open(url, '_blank');
}

function downloadIcs(icsContent: string, summary: string): void {
  const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  // 파일명: 요약 텍스트를 안전하게 정리
  const safeName = summary.replace(/[^\w가-힣\s]/g, '').trim().slice(0, 40) || 'event';
  a.download = `${safeName}.ics`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function ToolCallView({ entry }: { entry: ToolCallEntry }) {
  const [open, setOpen] = useState(false);
  const shortName = entry.name.replace(/^mcp__[^_]+__/, '');
  const pending = entry.result === undefined && entry.isError !== true;
  const status = entry.isError ? 'error' : pending ? 'pending' : 'ok';

  // gcal_create_event 결과에서 .ics 다운로드 버튼 표시 여부 결정
  const isGcalCreate = shortName === 'gcal_create_event';
  const icsContent = isGcalCreate ? extractIcsContent(entry.result) : null;
  const inputSummary =
    isGcalCreate && entry.input !== null && typeof entry.input === 'object'
      ? ((entry.input as Record<string, unknown>).summary as string | undefined) ?? '면접 일정'
      : '면접 일정';

  return (
    <div className={`msg tool-call tool-call-${status}`}>
      <button
        type="button"
        className="tool-call-header"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="tool-call-chevron">{open ? '▾' : '▸'}</span>
        <span className="tool-call-name">{shortName}</span>
        <span className={`tool-call-status tool-call-status-${status}`}>
          {pending ? '…' : entry.isError ? 'error' : 'ok'}
        </span>
      </button>
      {icsContent !== null ? (
        <div className="ics-download-banner">
          <button
            type="button"
            className="ics-download-btn"
            onClick={() => openGoogleCalendar(icsContent)}
          >
            📅 Google 캘린더에 추가
          </button>
          <button
            type="button"
            className="ics-download-btn"
            onClick={() => downloadIcs(icsContent, inputSummary)}
          >
            .ics 다운로드 (애플/아웃룩)
          </button>
          <span className="ics-download-hint">
            Google 캘린더가 새 탭으로 열리면 "저장"만 누르면 등록됩니다. 애플/아웃룩은 .ics 파일을 여세요.
          </span>
        </div>
      ) : null}
      {open ? (
        <div className="tool-call-body">
          <div className="tool-call-section">
            <div className="tool-call-section-label">input</div>
            <pre className="tool-call-json">{prettyJson(entry.input)}</pre>
          </div>
          <div className="tool-call-section">
            <div className="tool-call-section-label">
              {entry.isError ? 'error result' : 'result'}
            </div>
            <pre className="tool-call-json">
              {entry.result === undefined
                ? '(awaiting)'
                : prettyJson(entry.result)}
            </pre>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function PanelView({
  renders,
  sandboxUrl,
  agentEndpoint,
  getAuthToken,
  onAppMessage,
}: {
  renders: ReadonlyArray<RenderRef>;
  sandboxUrl: string;
  agentEndpoint: string;
  getAuthToken: () => string | undefined;
  onAppMessage: AppMessageHandler;
}) {
  const top = useMemo(() => renders[renders.length - 1], [renders]);
  if (!top) {
    return (
      <div className="ui-placeholder">
        <p>The rendered UI will appear here once the agent emits one.</p>
      </div>
    );
  }
  return (
    <div className="panel-frame">
      <ResourceFrame
        item={top}
        sandboxUrl={sandboxUrl}
        agentEndpoint={agentEndpoint}
        getAuthToken={getAuthToken}
        onAppMessage={onAppMessage}
        fillContainer
      />
    </div>
  );
}

/**
 * Render one MCP-Apps resource. Mounts straight from the inlined
 * resource `@ggui-ai/agent-server`'s tool-result interceptor stamped
 * on `_meta.ui.resource` (zero-round-trip mount). On rehydration the
 * `GET /agent` replay re-inlines each render FRESH from the MCP, so
 * the inlined HTML always reflects current server state. When no
 * inlined HTML is present (a render that no longer resolves), the
 * frame shows a small "not inlined" notice rather than fetching.
 */
function ResourceFrame({
  item,
  sandboxUrl,
  agentEndpoint,
  getAuthToken,
  fillContainer = false,
  onAppMessage,
}: {
  item: RenderRef;
  sandboxUrl: string;
  agentEndpoint: string;
  getAuthToken: () => string | undefined;
  fillContainer?: boolean;
  onAppMessage?: AppMessageHandler;
}) {
  // Inlined resource ride-along from the library's interceptor wins.
  // No fetch needed — render straight from `inlinedResource.text`.
  const html = item.inlinedResource?.text;
  const inlinedCsp = item.inlinedResource?.csp;

  const sandbox = useMemo(() => {
    if (!inlinedCsp) return { url: new URL(sandboxUrl) };
    // SandboxConfig wants mutable string[] arrays; the RenderRef
    // shape keeps them readonly so reassignment doesn't leak. Copy
    // here at the boundary.
    const csp: {
      connectDomains?: string[];
      resourceDomains?: string[];
    } = {};
    if (inlinedCsp.connectDomains) {
      csp.connectDomains = [...inlinedCsp.connectDomains];
    }
    if (inlinedCsp.resourceDomains) {
      csp.resourceDomains = [...inlinedCsp.resourceDomains];
    }
    return { url: new URL(sandboxUrl), csp };
  }, [sandboxUrl, inlinedCsp]);

  // Spec-canonical tools/call proxy. The iframe holds no MCP client
  // credential, so we relay through the agent backend's single
  // `POST /agent` endpoint with the `kind:'tool-call'` discriminator.
  const onCallTool = useCallback(
    async (
      params: CallToolRequest['params'],
      _extra: RequestHandlerExtra,
    ): Promise<CallToolResult> => {
      console.log('[ResourceFrame] tool_call', params);
      try {
        const token = getAuthToken();
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        };
        if (token) headers.Authorization = `Bearer ${token}`;
        const resp = await fetch(`${agentEndpoint}/agent`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            kind: 'tool-call',
            name: params.name,
            arguments: params.arguments ?? {},
          }),
        });
        if (!resp.ok) {
          console.warn('[ResourceFrame] relay non-2xx', resp.status);
          return { isError: true, content: [] };
        }
        const jsonRpc = (await resp.json()) as {
          readonly result?: CallToolResult;
          readonly error?: { readonly message?: string };
        };
        if (jsonRpc.error !== undefined) {
          console.warn('[ResourceFrame] relay error envelope', jsonRpc.error);
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text: jsonRpc.error.message ?? 'relay error',
              },
            ],
          };
        }
        return jsonRpc.result ?? { content: [] };
      } catch (err) {
        console.warn('[ResourceFrame] relay transport error', err);
        return { isError: true, content: [] };
      }
    },
    [agentEndpoint, getAuthToken],
  );

  // The frontend's `onReadResource` callback shouldn't normally fire
  // any more — the library inlines the iframe HTML alongside every
  // tool result. Keep a defensive implementation that throws a
  // descriptive error, so any guest-initiated `resources/list-changed`
  // → re-read surfaces a clear message in dev tools rather than
  // hanging.
  const onReadResource = useCallback(
    async (
      params: ReadResourceRequest['params'],
      _extra: RequestHandlerExtra,
    ): Promise<ReadResourceResult> => {
      throw new Error(
        `[ResourceFrame] resources/read for ${params.uri} requested ` +
          `post-mount, but the host doesnt operate a relay endpoint. ` +
          `The agent-server library inlines resources on the FIRST tool ` +
          `result; guest-initiated re-reads need the host to add a custom ` +
          `relay (or upgrade to AppRenderer's built-in MCP client).`,
      );
    },
    [],
  );

  // No local `ui/message` parsing: the hook's `handleAppMessage`
  // joins the text + forwards the content block's `_meta` opaquely.
  // This sample stays ggui-protocol-agnostic — the agent-server backend
  // is the sole party that recognizes + guards `ai.ggui/*` keys.

  return (
    <div className="render">
      <div className="render-chrome">
        <span className="render-id">{shortLabel(item)}</span>
        <span className="render-action">{item.action}</span>
      </div>
      <div
        className="render-frame"
        style={fillContainer ? { flex: 1, minHeight: 0 } : undefined}
      >
        {html !== undefined ? (
          <AppRenderer
            key={item.resourceUri}
            toolName="ggui_render"
            sandbox={sandbox}
            html={html}
            onReadResource={onReadResource}
            onCallTool={onCallTool}
            {...(onAppMessage !== undefined ? { onMessage: onAppMessage } : {})}
            onError={(err) =>
              console.warn('[ResourceFrame] AppRenderer error', err)
            }
          />
        ) : (
          <div className="render-loading" aria-hidden="true">
            <p style={{ padding: 12, fontSize: 13, color: '#888' }}>
              Resource not inlined — the agent-server didn't pre-fetch the
              iframe HTML for <code>{item.resourceUri}</code>.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function shortLabel(item: RenderRef): string {
  if (item.toolUseId !== undefined && item.toolUseId.length > 0) {
    return `#${item.toolUseId.slice(0, 12)}`;
  }
  const tail = item.resourceUri.split('/').filter(Boolean).pop() ?? '';
  return tail.length > 0 ? `#${tail.slice(0, 12)}` : '#render';
}
