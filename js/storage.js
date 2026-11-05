const STORAGE_KEY = "stories";
const SEEN_KEY = "stories-seen";
const DB_NAME = "stories-media";
const STORE = "blobs";
const DAY_MS = 24 * 60 * 60 * 1000;

let databasePromise = null;

export function isExpired(story, now = Date.now()) {
  return now - story.createdAt >= DAY_MS;
}

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function isStory(story) {
  if (!story || typeof story.id !== "string" || typeof story.createdAt !== "number") return false;
  if (story.type === "video") {
    return (
      typeof story.mediaId === "string" &&
      typeof story.poster === "string" &&
      Number.isFinite(story.start) &&
      Number.isFinite(story.end) &&
      story.end > story.start
    );
  }
  return typeof story.src === "string";
}

export function load() {
  return readJson(STORAGE_KEY, []).filter(isStory);
}

export function loadSeen() {
  return readJson(SEEN_KEY, []).filter((id) => typeof id === "string");
}

function save(stories) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(stories));
}

function saveSeen(ids) {
  localStorage.setItem(SEEN_KEY, JSON.stringify(ids));
}

function openDatabase() {
  if (!databasePromise) {
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE)) database.createObjectStore(STORE);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        databasePromise = null;
        reject(request.error);
      };
    });
  }
  return databasePromise;
}

function requestDone(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error("Could not save that video."));
  });
}

export async function saveMedia(id, blob) {
  const database = await openDatabase();
  const transaction = database.transaction(STORE, "readwrite");
  transaction.objectStore(STORE).put(blob, id);
  await transactionDone(transaction);
}

export async function loadMedia(id) {
  const database = await openDatabase();
  const transaction = database.transaction(STORE, "readonly");
  const blob = await requestDone(transaction.objectStore(STORE).get(id));
  return blob || null;
}

export async function deleteMedia(id) {
  const database = await openDatabase();
  const transaction = database.transaction(STORE, "readwrite");
  transaction.objectStore(STORE).delete(id);
  await transactionDone(transaction);
}

function dropUnusedMedia(previous, stories) {
  const live = new Set(stories.map((story) => story.mediaId).filter(Boolean));
  const gone = new Set();
  for (const story of previous) {
    if (story.mediaId && !live.has(story.mediaId)) gone.add(story.mediaId);
  }
  for (const id of gone) deleteMedia(id).catch(() => {});
}

function commit(stories) {
  const previous = load();
  save(stories);
  const live = new Set(stories.map((story) => story.id));
  saveSeen(loadSeen().filter((id) => live.has(id)));
  dropUnusedMedia(previous, stories);
  return stories;
}

export function prune(now = Date.now()) {
  return commit(load().filter((story) => !isExpired(story, now)));
}

export function add(story) {
  return addMany([story]);
}

export function addMany(items) {
  const stories = load().filter((story) => !isExpired(story));
  stories.push(...items);
  return commit(stories);
}

export function markSeen(id) {
  const seen = new Set(loadSeen());
  seen.add(id);
  saveSeen([...seen]);
}

export function nextExpiryDelay(stories, now = Date.now()) {
  if (!stories.length) return null;
  const earliest = Math.min(...stories.map((story) => story.createdAt + DAY_MS));
  return Math.max(0, earliest - now);
}
