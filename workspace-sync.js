import { validatePageUrl } from "./external-tabs.js?v=0.1.6";

// Catalog pages travel individually on BRSP's reliable command/ack lane.
// The frequent preview state carries only a revision and count.
export function createWorkspaceSync({ getConnection, applyPages, clearPages, onError = () => {} }) {
  let job;
  let appliedRevision;
  function cancel() { if (job) clearTimeout(job.timer); job = undefined; }
  function clear() { cancel(); appliedRevision = undefined; clearPages(); }
  function request() {
    const current = job;
    try {
      current.commandId = getConnection().sendCommand("workspace.observe", "read-page", {
        catalogRevision: current.revision, index: current.pages.length,
      });
      current.timer = setTimeout(() => {
        if (job !== current) return;
        cancel(); onError("Desktop panels did not finish synchronizing. Waiting to retry…");
      }, 8000);
    } catch { cancel(); onError("Desktop panels could not be requested."); }
  }
  return {
    clear,
    observe(state) {
      if (state.approval !== "approved") { clear(); return; }
      const catalog = state.externalPages;
      if (!catalog || !Number.isSafeInteger(catalog.revision) || catalog.revision < 0
        || !Number.isSafeInteger(catalog.count) || catalog.count < 0 || catalog.count > 100_000) return;
      if (catalog.revision === appliedRevision || catalog.revision === job?.revision) return;
      cancel();
      if (catalog.count === 0) { applyPages([]); appliedRevision = catalog.revision; return; }
      job = { revision: catalog.revision, count: catalog.count, pages: [], bytes: 0 };
      request();
    },
    applied(detail) {
      if (!job || detail.commandId !== job.commandId) return;
      clearTimeout(job.timer);
      if (!detail.ok) {
        cancel();
        if (detail.error !== "catalog_changed") onError("Desktop panel synchronization was rejected.");
        return;
      }
      const { page, index, catalogRevision } = detail.result ?? {};
      try {
        if (catalogRevision !== job.revision || index !== job.pages.length
          || !page || typeof page.id !== "string" || !/^[A-Za-z0-9_-]{1,64}$/u.test(page.id)
          || typeof page.name !== "string" || !page.name.trim() || [...page.name].length > 80
          || /[\u0000-\u001f\u007f]/u.test(page.name)
          || job.pages.some((entry) => entry.id === page.id)) throw new Error();
        const url = validatePageUrl(page.url, "http://tauri.localhost/").href;
        if (new TextEncoder().encode(url).byteLength > 4096) throw new Error();
        const entry = { id: page.id, name: page.name, url };
        job.bytes += new TextEncoder().encode(JSON.stringify(entry)).byteLength;
        if (job.bytes > 1_000_000) throw new Error();
        job.pages.push(entry);
        if (job.pages.length === job.count) {
          const complete = job;
          cancel();
          applyPages(complete.pages);
          appliedRevision = complete.revision;
        } else request();
      } catch { cancel(); onError("Desktop sent an invalid panel catalog."); }
    },
  };
}
