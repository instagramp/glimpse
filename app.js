/**
 * Glimpse — opinion poll arena
 *
 * PASTE YOUR KEYS HERE (Supabase → Project Settings → API):
 * - url: Project URL
 * - anonKey: anon public key  (safe for a public website; never paste the service_role key)
 *
 * If these stay as placeholders, the site still works in demo mode on this device only.
 */
const CONFIG = {
  supabaseUrl: "https://hmfwgnazdmhdiydushzm.supabase.co",
  supabaseAnonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhtZndnbmF6ZG1oZGl5ZHVzaHptIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA4NDY2NzQsImV4cCI6MjEwNjQyMjY3NH0.9kqZDcfTvvB5DKONImi07sc5Ll5x4i3YAy8sTjNRDf0",
};

/**
 * Demo-mode polls. These are used ONLY when Supabase keys are missing.
 * With Supabase connected, polls are created and managed in admin.html.
 */
let POLLS = [
  {
    id: "politics-tinubu-vs-obi", category: "politics", kind: "choice",
    prompt: "Who currently owns the national conversation?", endsAt: null, winner: null,
    options: [
      { name: "Bola Ahmed Tinubu", img: "images/tinubu.jpg" },
      { name: "Peter Obi", img: "images/obi.jpg" },
    ],
  },
  {
    id: "afrobeats-burna-vs-wizkid", category: "afrobeats", kind: "choice",
    prompt: "Who is running the sound of the streets?", endsAt: "2026-11-01T00:00:00+01:00", winner: null,
    options: [
      { name: "Burna Boy", img: "images/burna-boy.jpg" },
      { name: "Wizkid", img: "images/wizkid.jpg" },
    ],
  },
  {
    id: "cinema-funke-vs-ali", category: "cinema", kind: "choice",
    prompt: "Nollywood vs Kannywood: whose screen is louder?", endsAt: "2026-11-01T00:00:00+01:00", winner: null,
    options: [
      { name: "Funke Akindele", img: "images/funke-akindele.jpg" },
      { name: "Ali Nuhu", img: "images/ali-nuhu.jpg" },
    ],
  },
];

const POLL_HISTORY = [];

const VOTE_KEY = (pollId) => `glimpse_vote_${pollId}`;
const HANDLE_KEY = "glimpse_handle";
const VOTER_STATE_KEY = "glimpse_voter_state";
const COMMENT_VOTE_KEY = "glimpse_comment_votes";

const state = {
  category: "politics",
  pollId: null,
  stateFilter: null,
  stateResults: null,
  pickMode: "filter",
  pendingSide: null,
  scores: {},
  comments: [],
  demo: true,
  lastClosed: false,
  client: null,
};

function keysReady() {
  return (
    CONFIG.supabaseUrl.includes("supabase.co") &&
    !CONFIG.supabaseUrl.includes("YOUR-PROJECT-ID") &&
    CONFIG.supabaseAnonKey.length > 40 &&
    !CONFIG.supabaseAnonKey.includes("YOUR-SUPABASE")
  );
}

let SECTIONS = [
  { id: "politics", label: "Politics", emoji: "🗳️", hasStates: true },
  { id: "afrobeats", label: "Afrobeats", emoji: "🎵", hasStates: false },
  { id: "cinema", label: "Cinema", emoji: "🎬", hasStates: false },
];

function sectionHasStates() {
  const sec = SECTIONS.find((x) => x.id === state.category);
  return Boolean(sec && sec.hasStates);
}

async function loadSections() {
  const { data, error } = await state.client
    .from("sections").select("*").eq("active", true).order("sort_order");
  if (error) {
    console.error(error);
    return;
  }
  SECTIONS = data.map((r) => ({ id: r.id, label: r.label, emoji: r.emoji, hasStates: r.has_states }));
}

function renderTabs() {
  document.getElementById("categoryTabs").innerHTML = SECTIONS.map(
    (sec) => `<button class="tab ${sec.id === state.category ? "active" : ""}" type="button" data-category="${escapeText(sec.id)}">${escapeText(sec.emoji)} ${escapeText(sec.label)}</button>`
  ).join("");
}

const NG_STATES = ["Abia","Adamawa","Akwa Ibom","Anambra","Bauchi","Bayelsa","Benue","Borno","Cross River","Delta","Ebonyi","Edo","Ekiti","Enugu","FCT Abuja","Gombe","Imo","Jigawa","Kaduna","Kano","Katsina","Kebbi","Kogi","Kwara","Lagos","Nasarawa","Niger","Ogun","Ondo","Osun","Oyo","Plateau","Rivers","Sokoto","Taraba","Yobe","Zamfara"];

function pollsInView() {
  return POLLS.filter(
    (p) =>
      p.category === state.category &&
      (!sectionHasStates() || (state.stateFilter ? p.state === state.stateFilter : !p.state))
  );
}

function currentPoll() {
  const list = pollsInView();
  return list.find((poll) => poll.id === state.pollId) || list[0] || null;
}

function renderStateBar() {
  const bar = document.getElementById("stateBar");
  bar.hidden = !sectionHasStates();
  if (bar.hidden) return;
  bar.innerHTML = state.stateFilter
    ? `<span>📍 ${escapeText(state.stateFilter)} races</span>
       <button class="ghost-button" type="button" data-state-open>Change state</button>
       <button class="ghost-button" type="button" data-state-clear>Back to national</button>`
    : `<span>🏛️ State races</span>
       <button class="ghost-button" type="button" data-state-open>States</button>`;
}

function openStates(mode = "filter") {
  state.pickMode = mode;
  document.getElementById("stateTitle").textContent = mode === "voter" ? "Which state are you voting from?" : "Choose a state";
  document.getElementById("skipState").hidden = mode !== "voter";
  const counts = {};
  if (mode === "filter") POLLS.filter((p) => p.category === state.category && p.state).forEach((p) => {
    counts[p.state] = (counts[p.state] || 0) + 1;
  });
  document.getElementById("stateList").innerHTML = NG_STATES.map(
    (n) => `<button type="button" class="state-btn ${counts[n] ? "has" : ""}" data-state="${n}">${n}${counts[n] ? `<span>${counts[n]}</span>` : ""}</button>`
  ).join("");
  const search = document.getElementById("stateSearch");
  search.value = "";
  document.getElementById("stateModal").hidden = false;
}

async function loadStateResults() {
  const poll = currentPoll();
  if (!poll || state.demo) {
    state.stateResults = null;
    return;
  }
  const { data, error } = await state.client.rpc("poll_state_results", { p_poll_id: poll.id });
  state.stateResults = { id: poll.id, rows: error ? [] : data || [] };
}

function renderStateResults() {
  const el = document.getElementById("stateResults");
  const poll = currentPoll();
  const sr = state.stateResults;
  if (!poll || !sr || sr.id !== poll.id || !sr.rows.length) {
    el.hidden = true;
    return;
  }
  const by = {};
  sr.rows.forEach((r) => {
    const o = by[r.voter_state] || (by[r.voter_state] = {});
    o[r.side] = (o[r.side] || 0) + Number(r.votes);
  });
  const rows = Object.entries(by)
    .map(([name, o]) => ({ name, o, t: Object.values(o).reduce((x, y) => x + y, 0) }))
    .sort((x, y) => y.t - x.t)
    .slice(0, 10);
  el.hidden = false;
  el.innerHTML =
    `<h3>🗺️ How states are voting</h3>
     <div class="sr-legend">${poll.options.map((o, i) => `<span><i style="background:${OPT_COLORS[i % 8]}"></i>${escapeText(o.name)}</span>`).join("")}</div>` +
    rows
      .map((r) => {
        const vals = poll.options.map((_, i) => r.o[i] || 0);
        const max = Math.max(...vals);
        const leaders = vals.filter((v) => v === max).length;
        const k = vals.indexOf(max);
        const lead = leaders > 1 ? "Tied" : `${poll.options[k].name} ${percent(max, r.t)}%`;
        const segs = vals.map((v, i) => `<span style="flex:${v};background:${OPT_COLORS[i % 8]}"></span>`).join("");
        return `<div class="sr-row"><span class="sr-state">${escapeText(r.name)}</span><div class="sr-bar">${segs}</div><span class="sr-lead">${escapeText(lead)}</span></div>`;
      })
      .join("") +
    '<p class="sr-note">Only states with enough votes are shown. States are chosen by voters.</p>';
}

function voterStateForServer() {
  const v = localStorage.getItem(VOTER_STATE_KEY);
  return v && v !== "Unspecified" ? v : null;
}

function renderVoterNote() {
  const el = document.getElementById("voterNote");
  const v = localStorage.getItem(VOTER_STATE_KEY);
  const cn = document.getElementById("commentStateNote");
  cn.innerHTML = v && v !== "Unspecified"
    ? `Your comments are tagged 📍 ${escapeText(v)} · <button type="button" data-voter-change>Change</button>`
    : `Want a state tag on your comments? <button type="button" data-voter-change>Pick your state</button>`;
  el.hidden = !v;
  el.innerHTML = v
    ? `📍 Voting from ${escapeText(v === "Unspecified" ? "an unspecified state" : v)} · <button type="button" data-voter-change>Change</button>`
    : "";
}

function closeStates() {
  state.pendingSide = null;
  document.getElementById("stateModal").hidden = true;
}

async function setVoterState(name) {
  localStorage.setItem(VOTER_STATE_KEY, name);
  document.getElementById("stateModal").hidden = true;
  renderVoterNote();
  if (!state.demo) {
    const { error } = await state.client.rpc("set_voter_state", { p_state: voterStateForServer() });
    if (error) console.error("set_voter_state failed:", error);
  }
  if (state.pendingSide) {
    const side = state.pendingSide;
    state.pendingSide = null;
    await castVote(side);
  }
}

async function pickState(name) {
  state.stateFilter = name;
  state.pollId = null;
  document.getElementById("stateModal").hidden = true;
  await refresh();
}

async function loadPolls() {
  const { data, error } = await state.client
    .from("polls").select("*").eq("archived", false).order("created_at", { ascending: false });
  if (error) {
    console.error(error);
    toast("Could not load polls.");
    return;
  }
  POLLS = data.map((r) => ({
    id: r.id, category: r.category, state: r.state, prompt: r.prompt,
    endsAt: r.ends_at, winner: r.winner, closed: r.closed,
    kind: r.kind || "choice", tabTitle: r.tab_title, image: r.image, imageCredit: r.image_credit,
    options: (Array.isArray(r.options) ? r.options : []).map((o) => ({ name: o.name, img: o.img || "", credit: o.credit || null })),
  }));
}

function renderPicker(current) {
  const el = document.getElementById("pollPicker");
  const list = pollsInView();
  el.hidden = list.length < 2;
  el.innerHTML = list
    .map((p) => `<button type="button" class="chip ${p.id === current.id ? "active" : ""}" data-poll-id="${escapeText(p.id)}">${escapeText(p.tabTitle || pollLabel(p))}</button>`)
    .join("");
}

function getStoredVote(pollId) {
  return localStorage.getItem(VOTE_KEY(pollId));
}

function getCommentVotes() {
  try {
    return JSON.parse(localStorage.getItem(COMMENT_VOTE_KEY) || "{}");
  } catch {
    return {};
  }
}

function setCommentVote(id, direction) {
  const votes = getCommentVotes();
  votes[id] = direction;
  localStorage.setItem(COMMENT_VOTE_KEY, JSON.stringify(votes));
}

function toast(message) {
  const el = document.getElementById("toast");
  el.textContent = message;
  el.classList.add("show");
  window.clearTimeout(toast._t);
  toast._t = window.setTimeout(() => el.classList.remove("show"), 2800);
}

function formatCount(n) {
  return new Intl.NumberFormat("en-NG").format(Math.max(0, n || 0));
}

function formatTime(iso) {
  const date = new Date(iso);
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return date.toLocaleDateString("en-NG", { day: "numeric", month: "short" });
}

function escapeText(value) {
  const div = document.createElement("div");
  div.textContent = value;
  return div.innerHTML;
}

function initials(handle) {
  return (handle || "AN").slice(0, 2).toUpperCase();
}

const OPT_COLORS = ["#2ee59d", "#8a5cff", "#ff4d9d", "#ffb84d", "#4dc3ff", "#ff6f4d", "#b6ff4d", "#4d6bff"];

function countsTotal(counts) {
  return Object.values(counts || {}).reduce((n, v) => n + Number(v || 0), 0);
}

function pollLabel(p, max = 44) {
  const text = p.kind === "yesno" ? p.prompt : p.options.map((o) => o.name).join(" vs ");
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}

function demoCounts(poll) {
  return poll.options.length >= 2 ? { 0: 12840, 1: 11990 } : {};
}

function percent(part, total) {
  if (!total) return 0;
  return Math.round((part / total) * 100);
}

function pollStatus(poll, score) {
  const w = poll.winner;
  if (w !== null && w !== undefined && w !== "" && poll.options[Number(w)]) {
    return { closed: true, winner: String(w), auto: false };
  }
  if (poll.closed || (poll.endsAt && Date.now() >= new Date(poll.endsAt).getTime())) {
    const vals = poll.options.map((_, i) => Number((score || {})[i] || 0));
    const max = Math.max(...vals);
    const leaders = vals.map((v, i) => (v === max ? i : -1)).filter((i) => i >= 0);
    const winner = max === 0 ? "none" : leaders.length > 1 ? "tie" : String(leaders[0]);
    return { closed: true, winner, auto: true };
  }
  return { closed: false };
}

function cardHtml(poll, idx, votes, total, mySide, status) {
  const opt = poll.options[idx];
  const side = String(idx);
  const share = percent(votes, total);
  const mine = mySide === side;
  const won = status.closed && status.winner === side;
  const yn = poll.kind === "yesno";
  let label = yn ? "VOTE " + opt.name.toUpperCase() : "VOTE";
  let cls = yn ? (idx === 0 ? "yes" : "no") : "";
  if (status.closed) {
    label = won ? "WINNER" : mine ? "YOU VOTED" : "FINAL";
    cls = won ? "closed winner" : "closed";
  } else if (mine) {
    label = "REMOVE VOTE";
    cls = "voted";
  } else if (mySide !== null && mySide !== undefined) {
    label = yn ? "SWITCH TO " + opt.name.toUpperCase() : "SWITCH VOTE";
    cls = "switch";
  }

  const overlay = `
        <div class="battle-overlay">
          <span class="battle-name">${escapeText(opt.name)}</span>
          ${opt.credit ? `<span class="photo-credit">Photo: ${escapeText(opt.credit)}</span>` : ""}
          <div class="overlay-meta"><strong>${share}%</strong><span>${formatCount(votes)} votes</span></div>
          <div class="vote-progress" aria-hidden="true">
            <div class="vote-progress-bar" style="width:${share}%"></div>
          </div>
        </div>`;
  const media = yn
    ? `<div class="battle-media yn-media"><span class="yn-icon">${idx === 0 ? "👍" : "👎"}</span>${overlay}</div>`
    : `<div class="battle-media">
        <img src="${opt.img}" alt="${escapeText(opt.name)}" loading="lazy" onerror="this.style.display='none'" />${overlay}
      </div>`;

  return `
    <article class="battle-card ${mine ? "voted" : ""} ${won ? "winner" : ""}" data-side="${side}">
      ${media}
      <div class="battle-body">
        <button class="vote-button ${cls}" type="button" data-vote="${side}" ${status.closed ? "disabled" : ""}>
          ${label}
        </button>
      </div>
    </article>
  `;
}

function renderArena() {
  const poll = currentPoll();
  renderStateBar();
  const arena = document.getElementById("battleArena");
  if (!poll) {
    document.getElementById("battleSubtitle").textContent = "";
    document.getElementById("resultBanner").hidden = true;
    document.getElementById("pollTimer").textContent = "";
    document.getElementById("pollPicker").hidden = true;
    arena.className = "battle-arena";
    arena.innerHTML = '<p class="empty-state">' + (state.stateFilter ? "No polls for " + escapeText(state.stateFilter) + " yet." : "No polls here yet. Check back soon.") + "</p>";
    return;
  }
  renderPicker(poll);

  const score = state.scores[poll.id] || {};
  const total = countsTotal(score);
  const mySide = getStoredVote(poll.id);
  const status = pollStatus(poll, score);
  const banner = document.getElementById("resultBanner");

  state.lastClosed = status.closed;
  document.getElementById("battleSubtitle").textContent = poll.prompt;

  if (status.closed) {
    banner.hidden = false;
    banner.textContent =
      status.winner === "tie" ? "Final result: it's a tie."
      : status.winner === "none" ? "Poll closed with no votes."
      : `🏆 Winner: ${poll.options[Number(status.winner)].name}`;
  } else {
    banner.hidden = true;
  }

  const n = poll.options.length;
  const yn = poll.kind === "yesno";
  arena.className = "battle-arena " + (yn ? "arena-yn" : n === 1 ? "arena-n1" : n === 2 ? "arena-n2" : "arena-multi");
  const cards = poll.options.map((_, i) => cardHtml(poll, i, Number(score[i] || 0), total, mySide, status));
  let html = n === 2 && !yn ? cards[0] + '<div class="vs-badge" aria-hidden="true">VS</div>' + cards[1] : cards.join("");
  if (yn && poll.image) {
    html = `<div class="yn-hero"><img src="${poll.image}" alt="" onerror="this.style.display='none'" />${poll.imageCredit ? `<span class="photo-credit yn-credit">Photo: ${escapeText(poll.imageCredit)}</span>` : ""}</div>` + html;
  }
  arena.innerHTML = html;
  tickTimer();
}

function commentItemHtml(comment, isReply) {
  const mine = getCommentVotes()[comment.id];
  return `
    <article class="comment-item ${isReply ? "reply" : ""}" data-id="${comment.id}">
      <div class="comment-avatar">${escapeText(initials(comment.handle))}</div>
      <div class="comment-main">
        <div class="comment-header">
          <span class="comment-author">${escapeText(comment.handle)}${comment.state ? `<span class="state-tag">${escapeText(comment.state)}</span>` : ""}</span>
          <time class="comment-time">${formatTime(comment.created_at)}</time>
        </div>
        <p class="comment-text">${escapeText(comment.body)}</p>
        <div class="comment-actions">
          <div class="comment-score">
            <button type="button" data-c-vote="up" class="${mine === "up" ? "active-up" : ""}" aria-label="Upvote">▲</button>
            <span>${formatCount(comment.score)}</span>
            <button type="button" data-c-vote="down" class="${mine === "down" ? "active-down" : ""}" aria-label="Downvote">▼</button>
          </div>
          ${isReply ? "" : '<button class="comment-reply" type="button" data-reply>Reply</button>'}
          <button class="comment-reply comment-report" type="button" data-report>Report</button>
        </div>
      </div>
    </article>
  `;
}

function renderCommentPreview(rows, parents) {
  const box = document.getElementById("commentPreview");
  document.getElementById("sheetTitle").textContent = rows.length
    ? `Chaos Comments (${formatCount(rows.length)})`
    : "Chaos Comments";
  const top = [...parents]
    .sort((a, b) => b.score - a.score || new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 3);
  const items = top.map((c) => `
    <article class="preview-item" data-open-comments>
      <div class="comment-avatar">${escapeText(initials(c.handle))}</div>
      <div class="comment-main">
        <div class="comment-header">
          <span class="comment-author">${escapeText(c.handle)}${c.state ? `<span class="state-tag">${escapeText(c.state)}</span>` : ""}</span>
          <time class="comment-time">${formatTime(c.created_at)}</time>
        </div>
        <p class="comment-text">${escapeText(c.body)}</p>
      </div>
      <span class="preview-score">▲ ${formatCount(c.score)}</span>
    </article>`).join("");
  box.innerHTML =
    (top.length
      ? `<div class="preview-list">${items}</div>`
      : '<p class="empty-state">The stands are quiet. Be the first to drop a take.</p>') +
    `<div class="preview-actions">
      ${rows.length ? `<button type="button" class="ghost-button" data-open-comments>View all ${formatCount(rows.length)} comments</button>` : ""}
      <button type="button" class="primary-button small" data-open-comments="write">${rows.length ? "Add comment" : "Drop the first take"}</button>
    </div>`;
}

function openComments(write) {
  document.getElementById("commentSheet").hidden = false;
  document.body.style.overflow = "hidden";
  if (write) setTimeout(() => document.getElementById("commentInput").focus(), 280);
}

function closeComments() {
  document.getElementById("commentSheet").hidden = true;
  document.body.style.overflow = "";
}

function renderComments() {
  const poll = currentPoll();
  const feed = document.getElementById("commentFeed");
  const pill = document.getElementById("commentPill");
  const rows = state.comments.filter((row) => poll && row.poll_id === poll.id);
  const parents = rows.filter((row) => !row.parent_id);
  const replies = rows.filter((row) => row.parent_id);

  pill.textContent = `${formatCount(rows.length)} in the stands`;
  renderCommentPreview(rows, parents);

  if (!parents.length) {
    feed.innerHTML = `<p class="empty-state">The stands are quiet. Drop the first take.</p>`;
    return;
  }

  feed.innerHTML = parents
    .map((parent) => {
      const kids = replies.filter((row) => row.parent_id === parent.id);
      return commentItemHtml(parent, false) + kids.map((kid) => commentItemHtml(kid, true)).join("");
    })
    .join("");
}

function renderHistory() {
  const finished = POLLS.map((p) => ({ p, s: state.scores[p.id] || {} }))
    .filter(({ p, s }) => pollStatus(p, s).closed)
    .map(({ p, s }) => {
      const st = pollStatus(p, s);
      const t = countsTotal(s);
      const parts = p.options.map((o, i) => `${o.name} ${percent(Number(s[i] || 0), t)}%`).join(" vs ");
      const tail = st.winner === "tie" ? " (tie)" : st.winner === "none" ? " (no votes)" : ` · ${p.options[Number(st.winner)].name} won`;
      return {
        week: p.endsAt ? new Date(p.endsAt).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" }) : "Announced",
        category: (SECTIONS.find((x) => x.id === p.category) || {}).label || p.category,
        result: (p.kind === "yesno" ? p.prompt + ": " : "") + parts + tail,
      };
    });
  const items = [...finished, ...POLL_HISTORY];
  document.getElementById("historyList").innerHTML = items.length
    ? items.map((item) => `
      <div class="history-item">
        <div>
          <strong>${escapeText(item.category)}</strong>
          <div class="comment-time">${escapeText(item.week)}</div>
        </div>
        <span>${escapeText(item.result)}</span>
      </div>`).join("")
    : '<p class="empty-state">No finished polls yet.</p>';
}

async function loadScores() {
  const poll = currentPoll();
  if (!poll) return;
  if (state.demo) {
    const local = JSON.parse(localStorage.getItem("glimpse_demo_scores") || "{}");
    state.scores[poll.id] = local[poll.id] || demoCounts(poll);
    return;
  }

  const { data, error } = await state.client
    .from("poll_scores")
    .select("poll_id, counts")
    .eq("poll_id", poll.id)
    .maybeSingle();

  if (error) {
    toast("Could not load live votes. Showing last known count.");
    return;
  }

  state.scores[poll.id] = (data && data.counts) || {};

  // The server is the source of truth for which card this person voted for
  const { data: mine } = await state.client
    .from("votes").select("side").eq("poll_id", poll.id).maybeSingle();
  if (mine) localStorage.setItem(VOTE_KEY(poll.id), mine.side);
  else localStorage.removeItem(VOTE_KEY(poll.id));
}

async function loadAllScores() {
  const ids = POLLS.map((p) => p.id);
  if (state.demo) {
    const local = JSON.parse(localStorage.getItem("glimpse_demo_scores") || "{}");
    POLLS.forEach((p) => { state.scores[p.id] = local[p.id] || demoCounts(p); });
    return;
  }
  const { data } = await state.client
    .from("poll_scores").select("poll_id, counts").in("poll_id", ids);
  (data || []).forEach((r) => { state.scores[r.poll_id] = r.counts || {}; });
}

async function ensureSession() {
  const { data } = await state.client.auth.getSession();
  if (data.session) return;
  const { error } = await state.client.auth.signInAnonymously();
  if (error) {
    console.error("Anonymous sign-in failed:", error);
    toast("Sign-in failed. Turn on anonymous sign-ins in Supabase.");
  }
}

async function loadComments() {
  const poll = currentPoll();
  if (!poll) {
    state.comments = [];
    return;
  }
  if (state.demo) {
    state.comments = JSON.parse(localStorage.getItem("glimpse_demo_comments") || "[]");
    return;
  }

  const { data, error } = await state.client
    .from("comments")
    .select("id, poll_id, parent_id, handle, body, score, created_at, state")
    .eq("poll_id", poll.id)
    .order("created_at", { ascending: false })
    .limit(80);

  if (error) {
    state.comments = [];
    toast("Comments could not load. Check your Supabase setup.");
    return;
  }

  state.comments = data || [];
}

function saveDemoScores() {
  localStorage.setItem("glimpse_demo_scores", JSON.stringify(state.scores));
}

function saveDemoComments() {
  localStorage.setItem("glimpse_demo_comments", JSON.stringify(state.comments));
}

async function castVote(side) {
  const poll = currentPoll();
  if (!poll) return;
  const score = state.scores[poll.id] || {};
  if (pollStatus(poll, score).closed) {
    toast("Voting has closed on this poll.");
    renderArena();
    return;
  }

  const prev = getStoredVote(poll.id);
  const next = prev === side ? null : side;

  if (next && !localStorage.getItem(VOTER_STATE_KEY)) {
    state.pendingSide = side;
    openStates("voter");
    return;
  }

  const move = (from, to) => {
    if (from !== null && from !== undefined) score[from] = Math.max(0, Number(score[from] || 0) - 1);
    if (to !== null && to !== undefined) score[to] = Number(score[to] || 0) + 1;
    if (to !== null && to !== undefined) localStorage.setItem(VOTE_KEY(poll.id), to);
    else localStorage.removeItem(VOTE_KEY(poll.id));
    state.scores[poll.id] = score;
    renderArena();
  };

  move(prev, next);
  if (next !== null) {
    const btn = document.querySelector(`[data-vote="${next}"]`);
    if (btn) btn.classList.add("is-animating");
  }
  toast(next === null ? "Vote removed." : prev !== null ? "Vote switched." : "Vote locked in.");

  if (state.demo) {
    saveDemoScores();
    return;
  }

  const { data, error } = await state.client.rpc("set_vote", {
    p_poll_id: poll.id,
    p_side: next === null ? "none" : next,
    p_state: voterStateForServer(),
  });

  if (error) {
    console.error("set_vote failed:", error);
    move(next, prev); // undo
    toast("Vote did not save: " + (error.message || "unknown error"));
    return;
  }

  loadStateResults().then(renderStateResults);

  if (data && typeof data === "object") {
    state.scores[poll.id] = data;
    renderArena();
  }
}

async function postComment(handle, body, parentId) {
  const poll = currentPoll();
  if (!poll) return;
  const row = {
    poll_id: poll.id,
    parent_id: parentId || null,
    handle,
    body,
    score: 0,
    state: voterStateForServer(),
    created_at: new Date().toISOString(),
  };

  if (state.demo) {
    row.id = crypto.randomUUID();
    state.comments.unshift(row);
    saveDemoComments();
    renderComments();
    return;
  }

  const { data, error } = await state.client.rpc("post_comment", {
    p_poll_id: row.poll_id,
    p_parent_id: row.parent_id,
    p_handle: row.handle,
    p_body: row.body,
    p_state: voterStateForServer(),
  });

  if (error) {
    toast(error.message || "Comment did not post.");
    return;
  }

  const saved = Array.isArray(data) ? data[0] : data;
  if (saved && !state.comments.some((c) => c.id === saved.id)) state.comments.unshift(saved);
  renderComments();
}

async function reportComment(id) {
  if (state.demo) {
    toast("Reported. Thanks.");
    return;
  }
  const { error } = await state.client.rpc("report_comment", { p_comment_id: id });
  toast(error ? error.message || "Could not report." : "Reported. Thanks.");
}

function sharePoll(kind) {
  const poll = currentPoll();
  if (!poll) return;
  const label = poll.kind === "yesno" ? poll.prompt : `${poll.options.map((o) => o.name).join(" vs ")}: ${poll.prompt}`;
  const text = `${label} Vote on Glimpse`;
  const url = location.href;
  if (kind === "whatsapp") {
    window.open(`https://wa.me/?text=${encodeURIComponent(text + " " + url)}`, "_blank", "noopener");
  } else if (kind === "x") {
    window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`, "_blank", "noopener");
  } else if (navigator.clipboard) {
    navigator.clipboard.writeText(url).then(() => toast("Link copied."), () => toast("Copy failed."));
  }
}

async function voteComment(id, direction) {
  const existing = getCommentVotes()[id];
  if (existing) {
    toast("You already scored this take.");
    return;
  }

  const delta = direction === "up" ? 1 : -1;
  const comment = state.comments.find((row) => row.id === id);
  if (!comment) return;

  comment.score += delta;
  setCommentVote(id, direction);
  renderComments();

  if (state.demo) {
    saveDemoComments();
    return;
  }

  const { data, error } = await state.client.rpc("vote_comment", {
    p_comment_id: id,
    p_delta: delta,
  });

  if (error) {
    comment.score -= delta;
    const votes = getCommentVotes();
    delete votes[id];
    localStorage.setItem(COMMENT_VOTE_KEY, JSON.stringify(votes));
    renderComments();
    toast(error.message || "Could not update that score.");
    return;
  }

  if (typeof data === "number") {
    comment.score = data;
    renderComments();
  }
}

function tickTimer() {
  const poll = currentPoll();
  if (!poll) return;
  const el = document.getElementById("pollTimer");
  const score = state.scores[poll.id] || {};
  const status = pollStatus(poll, score);

  if (status.closed) {
    el.textContent = status.auto ? "Poll closed" : "Poll closed. Result announced.";
    if (state.lastClosed === false) renderArena();
    return;
  }
  if (!poll.endsAt) {
    el.textContent = "";
    return;
  }

  const diff = Math.max(0, new Date(poll.endsAt).getTime() - Date.now());
  const d = Math.floor(diff / 86400000);
  const h = Math.floor((diff % 86400000) / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const sec = Math.floor((diff % 60000) / 1000);
  el.textContent = `Ends in ${d}d ${h}h ${m}m ${sec}s`;
}

function bindEvents() {
  document.getElementById("categoryTabs").addEventListener("click", async (event) => {
    const tab = event.target.closest("[data-category]");
    if (!tab) return;
    state.category = tab.dataset.category;
    state.pollId = null;
    state.stateFilter = null;
    history.replaceState(null, "", "#" + tab.dataset.category);
    renderTabs();
    await refresh();
  });

  document.getElementById("battleArena").addEventListener("click", (event) => {
    const button = event.target.closest("[data-vote]");
    if (!button || button.disabled) return;
    castVote(button.dataset.vote);
  });

  document.getElementById("commentForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const handleInput = document.getElementById("commentHandle");
    const bodyInput = document.getElementById("commentInput");
    const handle = (handleInput.value.trim() || "Anonymous").slice(0, 18);
    const body = bodyInput.value.trim();
    if (body.length < 2) {
      toast("Write a real take first.");
      return;
    }
    localStorage.setItem(HANDLE_KEY, handle);
    handleInput.value = handle;
    bodyInput.value = "";
    await postComment(handle, body, null);
    const sheetBody = document.querySelector(".sheet-body");
    if (sheetBody) sheetBody.scrollTop = 0;
  });

  document.getElementById("commentFeed").addEventListener("click", async (event) => {
    const up = event.target.closest("[data-c-vote]");
    const reply = event.target.closest("[data-reply]");
    const item = event.target.closest(".comment-item");
    if (!item) return;

    if (event.target.closest("[data-report]")) {
      await reportComment(item.dataset.id);
      return;
    }

    if (up) {
      await voteComment(item.dataset.id, up.dataset.cVote);
      return;
    }

    if (reply) {
      const existing = item.querySelector(".reply-form");
      if (existing) {
        existing.remove();
        return;
      }
      const form = document.createElement("form");
      form.className = "reply-form";
      form.innerHTML = `
        <input class="reply-input" maxlength="220" placeholder="Reply in the stands..." required />
        <button class="primary-button small" type="submit">Reply</button>
      `;
      item.querySelector(".comment-main").appendChild(form);
      form.addEventListener("submit", async (submitEvent) => {
        submitEvent.preventDefault();
        const text = form.querySelector("input").value.trim();
        if (!text) return;
        const handle =
          (document.getElementById("commentHandle").value.trim() ||
            localStorage.getItem(HANDLE_KEY) ||
            "Anonymous").slice(0, 18);
        await postComment(handle, text, item.dataset.id);
      });
    }
  });

  document.getElementById("pollPicker").addEventListener("click", async (event) => {
    const chip = event.target.closest("[data-poll-id]");
    if (!chip) return;
    state.pollId = chip.dataset.pollId;
    await refresh();
  });

  document.getElementById("commentPreview").addEventListener("click", (event) => {
    const target = event.target.closest("[data-open-comments]");
    if (target) openComments(target.dataset.openComments === "write");
  });
  document.getElementById("closeSheet").addEventListener("click", closeComments);
  document.getElementById("commentSheet").addEventListener("click", (event) => {
    if (event.target.id === "commentSheet") closeComments();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeComments();
  });

  document.getElementById("stateBar").addEventListener("click", async (event) => {
    if (event.target.closest("[data-state-open]")) openStates();
    if (event.target.closest("[data-state-clear]")) await pickState(null);
  });
  document.getElementById("stateList").addEventListener("click", (event) => {
    const btn = event.target.closest("[data-state]");
    if (!btn) return;
    if (state.pickMode === "voter") setVoterState(btn.dataset.state);
    else pickState(btn.dataset.state);
  });
  document.getElementById("stateSearch").addEventListener("input", (event) => {
    const q = event.target.value.trim().toLowerCase();
    document.querySelectorAll(".state-btn").forEach((b) => {
      b.hidden = !b.dataset.state.toLowerCase().includes(q);
    });
  });
  const stateModal = document.getElementById("stateModal");
  document.getElementById("closeStates").addEventListener("click", closeStates);
  stateModal.addEventListener("click", (event) => { if (event.target === stateModal) closeStates(); });
  document.getElementById("skipState").addEventListener("click", () => setVoterState("Unspecified"));
  document.getElementById("commentStateNote").addEventListener("click", (event) => {
    if (event.target.closest("[data-voter-change]")) {
      state.pendingSide = null;
      openStates("voter");
    }
  });
  document.getElementById("voterNote").addEventListener("click", (event) => {
    if (event.target.closest("[data-voter-change]")) {
      state.pendingSide = null;
      openStates("voter");
    }
  });

  document.getElementById("shareRow").addEventListener("click", (event) => {
    const btn = event.target.closest("[data-share]");
    if (btn) sharePoll(btn.dataset.share);
  });

  const modal = document.getElementById("historyModal");
  document.getElementById("historyButton").addEventListener("click", async () => {
    await loadAllScores();
    renderHistory();
    modal.hidden = false;
  });
  document.getElementById("closeHistory").addEventListener("click", () => {
    modal.hidden = true;
  });
  modal.addEventListener("click", (event) => {
    if (event.target === modal) modal.hidden = true;
  });
}

function subscribeRealtime() {
  if (state.demo) return;

  state.client
    .channel("glimpse-arena")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "poll_scores" },
      (payload) => {
        const row = payload.new;
        if (!row) return;
        state.scores[row.poll_id] = row.counts || {};
        if (row.poll_id === currentPoll()?.id) {
          renderArena();
          loadStateResults().then(renderStateResults);
        }
      }
    )
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "comments" },
      (payload) => {
        const row = payload.new;
        if (!row || row.poll_id !== currentPoll()?.id) return;
        if (state.comments.some((item) => item.id === row.id)) return;
        state.comments.unshift(row);
        renderComments();
      }
    )
    .subscribe();
}

async function refresh() {
  await Promise.all([loadScores(), loadComments(), loadStateResults()]);
  renderArena();
  renderStateResults();
  renderComments();
}

async function init() {
  const savedHandle = localStorage.getItem(HANDLE_KEY);
  if (savedHandle) document.getElementById("commentHandle").value = savedHandle;

  if (keysReady() && window.supabase) {
    state.client = window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey);
    state.demo = false;
  } else {
    state.demo = true;
  }

  if (!state.demo) {
    await ensureSession();
    await loadSections();
    await loadPolls();
  }
  const fromHash = location.hash.slice(1);
  if (SECTIONS.some((x) => x.id === fromHash)) state.category = fromHash;
  else if (!SECTIONS.some((x) => x.id === state.category) && SECTIONS.length) state.category = SECTIONS[0].id;
  renderTabs();
  renderVoterNote();
  bindEvents();
  window.setInterval(tickTimer, 1000);
  await refresh();
  subscribeRealtime();

  if (state.demo) {
    toast("Demo mode: votes stay on this phone until you add Supabase keys.");
  }
}

init();
