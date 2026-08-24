"use strict";

const api = globalThis.browser ?? globalThis.chrome;

const DEFAULTS = { accounts: "0", label: "", interval: 1, reuseTab: true };
const LIMITS = { minInterval: 1, maxInterval: 120, maxAccounts: 5, maxAccountIndex: 99, maxLabelLength: 100 };

const $ = (id) => document.getElementById(id);

function status(msg, sticky) {
  $("status").textContent = msg;
  if (!sticky) setTimeout(() => { $("status").textContent = ""; }, 3000);
}

async function load() {
  const s = { ...DEFAULTS, ...(await api.storage.local.get(DEFAULTS)) };
  $("accounts").value = s.accounts;
  $("label").value = s.label;
  $("interval").value = s.interval;
  $("reuseTab").checked = !!s.reuseTab;
}

function validateAccounts(raw) {
  if (!/^\s*\d{1,2}(\s*,\s*\d{1,2})*\s*$/.test(raw)) {
    return { error: "Account index must be digits, e.g. 0 or 0,1" };
  }
  const list = raw.split(",").map((a) => a.trim());
  if (list.length > LIMITS.maxAccounts) {
    return { error: `At most ${LIMITS.maxAccounts} accounts.` };
  }
  if (list.some((a) => Number(a) > LIMITS.maxAccountIndex)) {
    return { error: `Account index must be ${LIMITS.maxAccountIndex} or lower.` };
  }
  // Indices are compared numerically: "0,00" and "1,1" name one mailbox twice,
  // and summing it twice would report an unread total that is simply wrong.
  const seen = new Set();
  for (const a of list) {
    const n = Number(a);
    if (seen.has(n)) {
      return { error: `Account ${n} is listed more than once.` };
    }
    seen.add(n);
  }
  return { value: Array.from(seen).join(",") };
}

$("save").addEventListener("click", async () => {
  const accounts = validateAccounts($("accounts").value.trim() || "0");
  if (accounts.error) return status(accounts.error);

  const raw = Number($("interval").value);
  if (!Number.isFinite(raw) || raw < LIMITS.minInterval || raw > LIMITS.maxInterval) {
    return status(`Interval must be between ${LIMITS.minInterval} and ${LIMITS.maxInterval} minutes.`);
  }

  const label = $("label").value.trim();
  if (label.length > LIMITS.maxLabelLength) {
    return status(`Label must be ${LIMITS.maxLabelLength} characters or fewer.`);
  }

  await api.storage.local.set({
    accounts: accounts.value,
    label,
    interval: raw,
    reuseTab: $("reuseTab").checked
  });
  status("Saved.");
});

$("checkNow").addEventListener("click", async () => {
  const btn = $("checkNow");
  btn.disabled = true;
  status("Checking…", true);   // never report a count while the check is running
  try {
    const res = await api.runtime.sendMessage({ type: "check-now" });
    const s = res && res.status;
    if (s === "ok") status(`${res.count} unread.`);
    else if (s === "partial") {
      // The background reports which total it displayed; saying "last known"
      // when it is actually a partial sum is a different, wrong statement.
      status(res.partialSource === "cached"
        ? "Some accounts unavailable — showing last known total."
        : "Some accounts unavailable — showing partial total.");
    }
    else if (s === "auth") status("Not signed in to Gmail.");
    else if (s === "permission") status("Permission needed — click the toolbar button.");
    else status("Couldn't reach Gmail.");
  } catch (e) {
    status("Check failed.");
  } finally {
    btn.disabled = false;
  }
});

load();
