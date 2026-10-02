const CONFIG = {
  url: "https://hmfwgnazdmhdiydushzm.supabase.co",
  key: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhtZndnbmF6ZG1oZGl5ZHVzaHptIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA4NDY2NzQsImV4cCI6MjEwNjQyMjY3NH0.9kqZDcfTvvB5DKONImi07sc5Ll5x4i3YAy8sTjNRDf0",
};
const sb = window.supabase.createClient(CONFIG.url, CONFIG.key);
const $ = (id) => document.getElementById(id);
const esc = (v) => { const d = document.createElement("div"); d.textContent = v == null ? "" : v; return d.innerHTML; };
const slug = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24);
let polls = [], scores = {}, comments = [], sections = [], editing = null, editingSec = null;
const NG_STATES = ["Abia","Adamawa","Akwa Ibom","Anambra","Bauchi","Bayelsa","Benue","Borno","Cross River","Delta","Ebonyi","Edo","Ekiti","Enugu","FCT Abuja","Gombe","Imo","Jigawa","Kaduna","Kano","Katsina","Kebbi","Kogi","Kwara","Lagos","Nasarawa","Niger","Ogun","Ondo","Osun","Oyo","Plateau","Rivers","Sokoto","Taraba","Yobe","Zamfara"];
NG_STATES.forEach((n) => $("pollForm").elements.state.add(new Option(n, n)));

function toast(m) {
  const el = $("toast");
  el.textContent = m;
  el.classList.add("show");
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove("show"), 3200);
}

function view(name) {
  $("login").hidden = name !== "login";
  $("panel").hidden = name !== "panel";
  $("logout").hidden = name !== "panel";
}

async function boot() {
  const { data } = await sb.auth.getSession();
  const user = data.session && data.session.user;
  if (user && !user.is_anonymous) await enter();
  else view("login");
}

async function enter() {
  const { data } = await sb.from("admins").select("user_id").maybeSingle();
  if (!data) {
    await sb.auth.signOut();
    view("login");
    $("loginMsg").textContent = "That account is not an admin.";
    return;
  }
  view("panel");
  await loadAll();
}

$("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = Object.fromEntries(new FormData(e.target));
  $("loginMsg").textContent = "";
  const { error } = await sb.auth.signInWithPassword({ email: f.email, password: f.password });
  if (error) { $("loginMsg").textContent = error.message; return; }
  await enter();
});

$("logout").addEventListener("click", async () => {
  await sb.auth.signOut();
  view("login");
});

$("adminTabs").addEventListener("click", (e) => {
  const b = e.target.closest("[data-go]");
  if (!b) return;
  document.querySelectorAll("#adminTabs .tab").forEach((t) => t.classList.toggle("active", t === b));
  document.querySelectorAll("[data-tab]").forEach((s) => (s.hidden = s.dataset.tab !== b.dataset.go));
  if (b.dataset.go === "comments") loadComments();
  if (b.dataset.go === "words") loadWords();
  if (b.dataset.go === "messages") loadMessages();
  if (b.dataset.go === "insights") loadInsights();
});

async function loadAll() {
  const [p, sc, se] = await Promise.all([
    sb.from("polls").select("*").order("created_at", { ascending: false }),
    sb.from("poll_scores").select("poll_id, side_a, side_b"),
    sb.from("sections").select("*").order("sort_order"),
  ]);
  polls = p.data || [];
  sections = se.data || [];
  fillCategories();
  renderSections();
  fillInsightPolls();
  scores = {};
  (sc.data || []).forEach((r) => (scores[r.poll_id] = r));
  renderPolls();
}

function status(p) {
  if (p.archived) return "Archived (hidden from site)";
  if (p.winner) return "Winner: " + (p.winner === "a" ? p.a_name : p.b_name);
  if (p.closed) return "Closed";
  if (p.ends_at) return new Date(p.ends_at) <= new Date() ? "Ended, auto result" : "Ends " + new Date(p.ends_at).toLocaleString("en-NG");
  return "Open, manual result";
}

function renderPolls() {
  $("pollList").innerHTML = polls.length
    ? polls.map((p) => {
        const s = scores[p.id] || { side_a: 0, side_b: 0 };
        return `<div class="item" data-id="${esc(p.id)}">
          <div><strong>${esc(p.a_name)} vs ${esc(p.b_name)}</strong>
            <div class="muted">${esc(p.category)}${p.state ? " · " + esc(p.state) : ""} · ${esc(status(p))} · votes ${s.side_a} - ${s.side_b}</div>
            <div class="muted">${esc(p.prompt)}</div></div>
          <div class="btns">
            <button data-act="edit">Edit</button>
            <button data-act="win-a">Winner: ${esc(p.a_name)}</button>
            <button data-act="win-b">Winner: ${esc(p.b_name)}</button>
            <button data-act="close">Close</button>
            <button data-act="reopen">Reopen</button>
            <button data-act="archive">${p.archived ? "Unhide" : "Hide"}</button>
            <button data-act="delete" class="danger">Delete</button>
          </div></div>`;
      }).join("")
    : '<p class="muted">No polls yet. Add one above.</p>';
}

async function done(error, msg) {
  if (error) { toast(error.message); return; }
  toast(msg || "Done.");
  await loadAll();
}

$("pollList").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-act]");
  if (!b) return;
  const id = b.closest(".item").dataset.id;
  const p = polls.find((x) => x.id === id);
  const a = b.dataset.act;
  if (a === "edit") return startEdit(p);
  if (a === "delete") {
    if (!confirm("Delete this poll with all its votes and comments? This cannot be undone.")) return;
    const { error } = await sb.rpc("admin_delete_poll", { p_id: id });
    return done(error, "Poll deleted.");
  }
  const patch = {
    "win-a": { winner: "a" }, "win-b": { winner: "b" }, close: { closed: true },
    reopen: { closed: false, winner: null, ends_at: null }, archive: { archived: !p.archived },
  }[a];
  const { error } = await sb.from("polls").update(patch).eq("id", id);
  done(error);
});

function localInput(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function startEdit(p) {
  editing = p.id;
  const f = $("pollForm").elements;
  f.category.value = p.category; f.state.value = p.state || ""; f.prompt.value = p.prompt; f.ends_at.value = localInput(p.ends_at);
  f.a_name.value = p.a_name; f.a_credit.value = p.a_credit || "";
  f.b_name.value = p.b_name; f.b_credit.value = p.b_credit || "";
  f.a_file.value = ""; f.b_file.value = "";
  $("formTitle").textContent = "Edit poll (leave photos empty to keep them)";
  $("cancelEdit").hidden = false;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function resetForm() {
  editing = null;
  $("pollForm").reset();
  $("formTitle").textContent = "Add a poll";
  $("cancelEdit").hidden = true;
}
$("cancelEdit").addEventListener("click", resetForm);

function squareJpeg(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const s = Math.min(img.width, img.height);
      const out = Math.min(1000, s);
      const c = document.createElement("canvas");
      c.width = c.height = out;
      c.getContext("2d").drawImage(img, (img.width - s) / 2, (img.height - s) * 0.25, s, s, 0, 0, out, out);
      c.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not read that image"))), "image/jpeg", 0.82);
    };
    img.onerror = () => reject(new Error("Could not read that image"));
    img.src = URL.createObjectURL(file);
  });
}

async function photo(file, existing) {
  if (!file || !file.size) return existing || "";
  const blob = await squareJpeg(file);
  const path = Date.now() + "-" + Math.random().toString(36).slice(2, 7) + ".jpg";
  const { error } = await sb.storage.from("poll-images").upload(path, blob, { contentType: "image/jpeg", cacheControl: "31536000" });
  if (error) throw error;
  return sb.storage.from("poll-images").getPublicUrl(path).data.publicUrl;
}

$("pollForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const d = Object.fromEntries(new FormData(e.target));
  const old = editing && polls.find((p) => p.id === editing);
  const btn = $("saveBtn");
  btn.disabled = true;
  try {
    const row = {
      category: d.category, state: hasStates(d.category) && d.state ? d.state : null, prompt: d.prompt.trim(),
      a_name: d.a_name.trim(), b_name: d.b_name.trim(),
      a_credit: d.a_credit.trim() || null, b_credit: d.b_credit.trim() || null,
      ends_at: d.ends_at ? new Date(d.ends_at).toISOString() : null,
    };
    row.a_img = await photo(d.a_file, old && old.a_img);
    row.b_img = await photo(d.b_file, old && old.b_img);
    if (!row.a_img || !row.b_img) throw new Error("Add a photo for both sides.");
    let res;
    if (editing) res = await sb.from("polls").update(row).eq("id", editing);
    else res = await sb.from("polls").insert({ id: `${row.category}-${slug(row.a_name)}-vs-${slug(row.b_name)}-${Date.now().toString(36)}`, ...row });
    if (res.error) throw res.error;
    resetForm();
    await done(null, "Poll saved.");
  } catch (err) {
    toast(err.message || "Could not save.");
  }
  btn.disabled = false;
});

async function loadComments() {
  const [c, r] = await Promise.all([
    sb.from("comments").select("id, poll_id, handle, body, hidden, score, created_at").order("created_at", { ascending: false }).limit(300),
    sb.from("reports").select("comment_id"),
  ]);
  const counts = {};
  (r.data || []).forEach((x) => (counts[x.comment_id] = (counts[x.comment_id] || 0) + 1));
  comments = (c.data || []).map((x) => ({ ...x, reports: counts[x.id] || 0 }));
  renderComments();
}

function renderComments() {
  const f = $("cFilter").value;
  const list = comments.filter((c) => (f === "reported" ? c.reports > 0 : f === "hidden" ? c.hidden : true))
    .sort((a, b) => (f === "reported" ? b.reports - a.reports : 0));
  $("commentList").innerHTML = list.length
    ? list.map((c) => {
        const p = polls.find((x) => x.id === c.poll_id);
        return `<div class="item" data-id="${esc(c.id)}">
          <div><strong>${esc(c.handle)}</strong> <span class="muted">${new Date(c.created_at).toLocaleString("en-NG")}</span>
            <div>${esc(c.body)}</div>
            <div class="muted">${p ? esc(p.a_name + " vs " + p.b_name) : "deleted poll"} · ${c.reports} reports · score ${c.score}${c.hidden ? " · HIDDEN" : ""}</div></div>
          <div class="btns">
            ${c.hidden ? '<button data-cact="restore">Restore</button>' : '<button data-cact="hide">Hide</button>'}
            <button data-cact="delete" class="danger">Delete</button>
          </div></div>`;
      }).join("")
    : '<p class="muted">Nothing here.</p>';
}
$("cFilter").addEventListener("change", renderComments);

$("commentList").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-cact]");
  if (!b) return;
  const id = b.closest(".item").dataset.id;
  let error;
  if (b.dataset.cact === "hide") ({ error } = await sb.from("comments").update({ hidden: true }).eq("id", id));
  else if (b.dataset.cact === "restore") {
    ({ error } = await sb.from("comments").update({ hidden: false }).eq("id", id));
    if (!error) await sb.from("reports").delete().eq("comment_id", id);
  } else {
    if (!confirm("Delete this comment and its replies?")) return;
    ({ error } = await sb.from("comments").delete().eq("id", id));
  }
  if (error) return toast(error.message);
  toast("Done.");
  loadComments();
});

async function loadWords() {
  const { data } = await sb.from("blocked_words").select("word").order("word");
  $("wordList").innerHTML = (data || []).length
    ? data.map((w) => `<div class="item" data-w="${esc(w.word)}"><div>${esc(w.word)}</div><div class="btns"><button class="danger" data-wdel>Remove</button></div></div>`).join("")
    : '<p class="muted">No blocked words yet.</p>';
}

$("wordForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const word = $("wordInput").value.trim().toLowerCase();
  if (!word) return;
  const { error } = await sb.from("blocked_words").insert({ word });
  if (error) return toast(error.message);
  $("wordInput").value = "";
  loadWords();
});

$("wordList").addEventListener("click", async (e) => {
  if (!e.target.closest("[data-wdel]")) return;
  const { error } = await sb.from("blocked_words").delete().eq("word", e.target.closest(".item").dataset.w);
  if (error) return toast(error.message);
  loadWords();
});

const hasStates = (id) => { const s = sections.find((x) => x.id === id); return !!(s && s.has_states); };

function fillCategories() {
  const sel = $("pollForm").elements.category;
  const cur = sel.value;
  sel.innerHTML = sections.map((s) => `<option value="${esc(s.id)}">${esc(s.emoji)} ${esc(s.label)}${s.active ? "" : " (hidden)"}</option>`).join("");
  if (cur) sel.value = cur;
}

function renderSections() {
  $("secList").innerHTML = sections.length
    ? sections.map((s, i) => `<div class="item" data-id="${esc(s.id)}">
        <div><strong>${esc(s.emoji)} ${esc(s.label)}</strong>
          <div class="muted">${s.active ? "Visible" : "Hidden"}${s.has_states ? " · state races" : ""} · ${polls.filter((p) => p.category === s.id).length} polls</div></div>
        <div class="btns">
          <button data-sact="edit">Edit</button>
          <button data-sact="up" ${i === 0 ? "disabled" : ""}>Up</button>
          <button data-sact="down" ${i === sections.length - 1 ? "disabled" : ""}>Down</button>
          <button data-sact="toggle">${s.active ? "Hide" : "Show"}</button>
          <button data-sact="delete" class="danger">Delete</button>
        </div></div>`).join("")
    : '<p class="muted">No sections.</p>';
}

function resetSec() {
  editingSec = null;
  $("secForm").reset();
  $("secTitle").textContent = "Add a section";
  $("secCancel").hidden = true;
}
$("secCancel").addEventListener("click", resetSec);

$("secForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const d = Object.fromEntries(new FormData(e.target));
  const row = { label: d.label.trim(), emoji: (d.emoji || "").trim(), has_states: !!d.has_states };
  let error;
  if (editingSec) ({ error } = await sb.from("sections").update(row).eq("id", editingSec));
  else {
    let id = slug(row.label) || "section";
    if (sections.some((s) => s.id === id)) id += "-" + Date.now().toString(36).slice(-3);
    ({ error } = await sb.from("sections").insert({ id, ...row, sort_order: Math.max(0, ...sections.map((s) => s.sort_order)) + 1 }));
  }
  if (!error) resetSec();
  done(error, "Section saved.");
});

$("secList").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-sact]");
  if (!b) return;
  const id = b.closest(".item").dataset.id;
  const i = sections.findIndex((s) => s.id === id);
  const s = sections[i];
  const act = b.dataset.sact;
  let error;
  if (act === "edit") {
    editingSec = id;
    const f = $("secForm").elements;
    f.label.value = s.label; f.emoji.value = s.emoji; f.has_states.checked = s.has_states;
    $("secTitle").textContent = "Edit section";
    $("secCancel").hidden = false;
    return;
  }
  if (act === "toggle") ({ error } = await sb.from("sections").update({ active: !s.active }).eq("id", id));
  else if (act === "delete") {
    if (!confirm("Delete this section?")) return;
    ({ error } = await sb.from("sections").delete().eq("id", id));
    if (error && error.code === "23503") error = { message: "This section still has polls. Hide it, or delete its polls first." };
  } else {
    const o = sections[act === "up" ? i - 1 : i + 1];
    if (!o) return;
    const r1 = await sb.from("sections").update({ sort_order: o.sort_order }).eq("id", id);
    const r2 = await sb.from("sections").update({ sort_order: s.sort_order }).eq("id", o.id);
    error = r1.error || r2.error;
  }
  done(error);
});

async function loadMessages() {
  const { data } = await sb.from("contact_messages").select("*").order("created_at", { ascending: false }).limit(200);
  $("msgList").innerHTML = (data || []).length
    ? data.map((m) => `<div class="item" data-id="${esc(m.id)}">
        <div><strong>${esc(m.name || "Anonymous")}</strong> <span class="muted">${esc(m.email || "no email")} · ${new Date(m.created_at).toLocaleString("en-NG")}${m.is_read ? "" : " · NEW"}</span>
          <div>${esc(m.body)}</div></div>
        <div class="btns">
          ${m.is_read ? "" : '<button data-mact="read">Mark read</button>'}
          <button data-mact="delete" class="danger">Delete</button>
        </div></div>`).join("")
    : '<p class="muted">No messages yet.</p>';
}

$("msgList").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-mact]");
  if (!b) return;
  const id = b.closest(".item").dataset.id;
  const res = b.dataset.mact === "read"
    ? await sb.from("contact_messages").update({ is_read: true }).eq("id", id)
    : await sb.from("contact_messages").delete().eq("id", id);
  if (res.error) return toast(res.error.message);
  loadMessages();
});

function fillInsightPolls() {
  const sel = $("insPoll");
  const cur = sel.value;
  sel.innerHTML = polls.map((p) => `<option value="${esc(p.id)}">${esc(p.a_name)} vs ${esc(p.b_name)}${p.state ? " (" + esc(p.state) + ")" : ""}</option>`).join("");
  if (cur) sel.value = cur;
}

const pct = (n, t) => (t ? Math.round((n / t) * 100) : 0);
$("insPoll").addEventListener("change", loadInsights);

async function loadInsights() {
  const id = $("insPoll").value;
  const [b, v] = await Promise.all([
    id ? sb.rpc("admin_vote_breakdown", { p_poll_id: id }) : Promise.resolve({ data: [] }),
    sb.rpc("admin_voter_states"),
  ]);
  if (b.error || v.error) return toast((b.error || v.error).message);

  const voters = (v.data || []).sort((x, y) => y.voters - x.voters);
  const vTotal = voters.reduce((n, r) => n + Number(r.voters), 0);
  $("insVoters").innerHTML = voters.length
    ? voters.map((r) => `<div class="statrow"><span>${esc(r.voter_state)}</span><span>${pct(Number(r.voters), vTotal)}% · ${r.voters} people</span></div><div class="bar"><span style="width:${pct(Number(r.voters), vTotal)}%"></span></div>`).join("")
    : '<p class="muted">No votes yet.</p>';

  const p = polls.find((x) => x.id === id);
  if (!p) { $("insBody").innerHTML = ""; return; }
  const by = {};
  let A = 0, B = 0;
  (b.data || []).forEach((r) => {
    const o = by[r.voter_state] || (by[r.voter_state] = { a: 0, b: 0 });
    const n = Number(r.votes);
    if (r.side === "a") { o.a += n; A += n; } else { o.b += n; B += n; }
  });
  const T = A + B;
  if (!T) { $("insBody").innerHTML = '<p class="muted">No votes on this poll yet.</p>'; return; }

  const names = { a: p.a_name, b: p.b_name };
  const block = (k, tot) => `<div><h3>${esc(names[k])}: ${tot} votes (${pct(tot, T)}%)</h3>
    <div class="muted">Where their votes come from</div>` +
    Object.entries(by).map(([s, o]) => [s, o[k]]).filter((x) => x[1] > 0).sort((x, y) => y[1] - x[1]).slice(0, 10)
      .map(([s, n]) => `<div class="statrow"><span>${esc(s)}</span><span>${pct(n, tot)}% · ${n}</span></div><div class="bar"><span style="width:${pct(n, tot)}%"></span></div>`).join("") + "</div>";

  const rows = Object.entries(by).sort((x, y) => y[1].a + y[1].b - (x[1].a + x[1].b)).map(([s, o]) => {
    const t = o.a + o.b;
    const lead = o.a === o.b ? "Tie" : o.a > o.b ? `${names.a} ${pct(o.a, t)}%` : `${names.b} ${pct(o.b, t)}%`;
    return `<tr><td>${esc(s)}</td><td>${o.a}</td><td>${o.b}</td><td>${t}</td><td>${esc(lead)}</td></tr>`;
  }).join("");

  $("insBody").innerHTML = `<div class="grid2">${block("a", A)}${block("b", B)}</div>
    <h3>By state</h3>
    <div class="tbl"><table><tr><th>State</th><th>${esc(names.a)}</th><th>${esc(names.b)}</th><th>Total</th><th>Leading</th></tr>${rows}</table></div>`;
}

boot();
