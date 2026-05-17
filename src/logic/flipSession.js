// Pinned flip opportunities: state management and localStorage persistence.

const STORAGE_KEY = 'flipSession.items';

function load() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
  } catch {
    return [];
  }
}

function save(items) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  window.dispatchEvent(new CustomEvent('forge:flip-session-changed'));
}

export function getItems() {
  return load();
}

export function addPin(snapshot) {
  const items = load();
  const existing = items.find(i =>
    i.itemId   === snapshot.itemId &&
    i.buyCity  === snapshot.buyCity &&
    i.sellCity === snapshot.sellCity
  );
  if (existing) {
    existing.qty += snapshot.qty;
    save(items);
  } else {
    items.push(snapshot);
    save(items);
  }
}

export function removePin(id) {
  save(load().filter(i => i.id !== id));
}

export function updatePin(id, changes) {
  const items = load();
  const idx = items.findIndex(i => i.id === id);
  if (idx >= 0) Object.assign(items[idx], changes);
  save(items);
}

export function clearAll() {
  save([]);
}

export function clearDone() {
  save(load().filter(i => !i.done));
}
