import { prepareDataForSave, sanitizeData } from "./dataModel.js";

const REMOTE_ENDPOINT = "./api/data";

export async function loadServerState() {
  if (location.protocol === "file:") return { reachable: false, data: null };
  try {
    const resp = await fetch(REMOTE_ENDPOINT, { cache: "no-store" });
    if (!resp.ok) return { reachable: false, data: null };
    const raw = await resp.json();
    return { reachable: true, data: raw ? sanitizeData(raw) : null };
  } catch {
    return { reachable: false, data: null };
  }
}

export async function loadServerData() {
  const state = await loadServerState();
  return state.data;
}

export async function saveServerData(data) {
  if (location.protocol === "file:") return false;
  try {
    const out = prepareDataForSave(data);
    const resp = await fetch(REMOTE_ENDPOINT, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(out),
    });
    return resp.ok;
  } catch {
    return false;
  }
}
