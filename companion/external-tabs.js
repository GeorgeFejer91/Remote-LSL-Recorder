const STORAGE_KEY = "remote-lsl-recorder.external-tabs.v1";

// URLs are browser navigation only, never recorder commands or native fetches.
export function validatePageUrl(value, hostUrl) {
  if (typeof value !== "string" || value.length > 4096) throw new Error("Use a page URL of at most 4096 characters.");
  let url;
  try { url = new URL(value.trim()); } catch { throw new Error("Enter a complete HTTPS page URL."); }
  const host = new URL(hostUrl);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback && host.protocol !== "https:")) {
    throw new Error("Use HTTPS. HTTP localhost is available only in the desktop app or local development.");
  }
  if (url.username || url.password) throw new Error("URLs with embedded usernames or passwords are not supported.");
  return url;
}

export function savedPageUrl(url) {
  const saved = new URL(url);
  saved.search = "";
  saved.hash = "";
  return saved.href;
}

export function restoreTabs(raw, hostUrl) {
  if (!raw || raw.length > 1_000_000) return [];
  try {
    const values = JSON.parse(raw);
    if (!Array.isArray(values)) return [];
    return values.flatMap((value) => {
      try {
        if (typeof value?.name !== "string" || !value.name.trim() || value.name.length > 80) return [];
        return [{ name: value.name.trim(), url: savedPageUrl(validatePageUrl(value.url, hostUrl)) }];
      } catch { return []; }
    });
  } catch { return []; }
}

export function mountExternalTabs() {
  const bar = document.getElementById("page-tabs");
  const recorder = document.getElementById("recorder-panel");
  const panels = document.getElementById("external-panels");
  const recorderTab = document.getElementById("recorder-tab");
  const add = document.getElementById("add-page-tab");
  const tabs = [];
  let sequence = 0;

  function select(tab, focus = true) {
    recorder.hidden = Boolean(tab);
    panels.hidden = !tab;
    document.body.classList.toggle("external-page-active", Boolean(tab));
    recorderTab.setAttribute("aria-selected", String(!tab));
    recorderTab.tabIndex = tab ? -1 : 0;
    for (const entry of tabs) {
      entry.panel.hidden = entry !== tab;
      entry.button.setAttribute("aria-selected", String(entry === tab));
      entry.button.tabIndex = entry === tab ? 0 : -1;
    }
    if (focus) {
      const selected = tab?.button ?? recorderTab;
      selected.focus();
      selected.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }

  function save(status) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(tabs.map(({ name, url }) => ({ name, url }))));
    } catch {
      if (status) status.textContent += " Browser storage is unavailable; these tabs last until this page closes.";
    }
  }

  function create({ name = "New page", url = "" } = {}, focus = true) {
    const id = `external-page-${++sequence}`;
    const button = element("button", name);
    button.type = "button";
    button.id = `${id}-tab`;
    button.dataset.fitText = "action";
    button.setAttribute("role", "tab");
    button.setAttribute("aria-controls", id);
    bar.insertBefore(button, add);
    const panel = element("section", "", "external-page");
    panel.id = id;
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("aria-labelledby", button.id);
    panel.tabIndex = 0;
    const form = element("form", "", "page-connector");
    const nameInput = input(`${id}-name`, "text", name, 80);
    const urlInput = input(`${id}-url`, "url", url, 4096);
    urlInput.placeholder = "https://experiment.example/controller/";
    const load = action("Load page", "submit");
    const unload = action("Unload");
    unload.disabled = true;
    const close = action("Close tab");
    const actions = element("div", "", "page-actions");
    actions.append(unload, close);
    form.append(field("Tab name", nameInput), field("Remote page URL", urlInput), load);
    const status = element("p", "Enter the experiment’s controller page or invitation URL, then Load page. Connect inside that page.", "page-status");
    status.setAttribute("role", "status");
    const help = element("p", "If the page stays blank, its server may block embedding. Switching tabs keeps loaded pages open. Unload ends this page’s connections. Names and base URLs are saved on this device; query strings and invitations are not.", "page-help");
    const settings = element("details", "", "page-settings");
    settings.open = true;
    settings.append(element("summary", "Page settings"), form, help);
    const viewport = element("div", "", "page-viewport");
    const empty = element("p", "No external page loaded.", "page-empty");
    viewport.append(empty);
    panel.append(settings, actions, status, viewport);
    panels.append(panel);
    const tab = { name, url, button, panel };
    tabs.push(tab);
    let frame;
    function stop() {
      frame?.remove();
      frame = undefined;
      viewport.replaceChildren(empty);
      urlInput.value = tab.url;
      unload.disabled = true;
    }
    button.addEventListener("click", () => select(tab));
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      try {
        const target = validatePageUrl(urlInput.value, location.href);
        const nextName = nameInput.value.trim();
        if (!nextName || nextName.length > 80) throw new Error("Enter a tab name of 1–80 characters.");
        stop();
        tab.name = nextName;
        tab.url = savedPageUrl(target);
        nameInput.value = nextName;
        button.textContent = nextName;
        urlInput.value = tab.url;
        frame = document.createElement("iframe");
        frame.title = nextName;
        // Opaque origin also isolates pages served from the companion's own host.
        // Web Crypto and data-only WebRTC work without allow-same-origin.
        frame.setAttribute("sandbox", "allow-scripts allow-forms");
        frame.setAttribute("allow", "camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'");
        frame.referrerPolicy = "no-referrer";
        frame.src = target.href;
        viewport.replaceChildren(frame);
        settings.open = false;
        unload.disabled = false;
        status.textContent = "Page requested. Use its own Connect and status controls.";
        save(status);
      } catch (error) { status.textContent = error.message; }
    });
    unload.addEventListener("click", () => {
      stop();
      settings.open = true;
      status.textContent = "Page unloaded. Load a fresh invitation to reconnect.";
    });
    close.addEventListener("click", () => {
      const index = tabs.indexOf(tab);
      const wasSelected = button.getAttribute("aria-selected") === "true";
      stop();
      tabs.splice(index, 1);
      panel.remove();
      button.remove();
      if (wasSelected) select(tabs[Math.max(0, index - 1)]);
      save();
    });
    panel.hidden = true;
    button.setAttribute("aria-selected", "false");
    button.tabIndex = -1;
    if (focus) { select(tab, false); urlInput.focus(); }
    return tab;
  }

  recorderTab.addEventListener("click", () => select());
  add.addEventListener("click", () => { create(); save(); });
  bar.addEventListener("keydown", (event) => {
    const buttons = [recorderTab, ...tabs.map((tab) => tab.button)];
    const index = buttons.indexOf(event.target);
    if (index < 0 || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
      : (index + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length;
    select(next === 0 ? undefined : tabs[next - 1]);
  });
  try {
    for (const saved of restoreTabs(localStorage.getItem(STORAGE_KEY), location.href)) create(saved, false);
  } catch { /* Private browser mode can deny storage. Tabs still work. */ }
  select(undefined, false);
  window.addEventListener("resize", () => requestAnimationFrame(() => {
    bar.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }));
}

function element(tag, text, className) {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  return node;
}

function action(text, type = "button") {
  const button = element("button", text, "secondary");
  button.type = type;
  button.dataset.fitText = "action";
  return button;
}

function input(id, type, value, maxLength) {
  const node = document.createElement("input");
  Object.assign(node, { id, type, value, maxLength, required: true, autocomplete: "off" });
  return node;
}

function field(text, node) {
  const label = element("label", text);
  label.htmlFor = node.id;
  const wrapper = element("div", "", "page-field");
  wrapper.append(label, node);
  return wrapper;
}
