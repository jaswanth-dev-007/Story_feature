import { fileToStoryImage, fileToVideoStories } from "./image.js";
import { add, addMany, deleteMedia, loadMedia, loadSeen, markSeen, nextExpiryDelay, prune, saveMedia } from "./storage.js";
import { createViewer } from "./viewer.js";

const addButton = document.querySelector("#add-story");
const rings = document.querySelector("#rings");
const fileInput = document.querySelector("#file");
const error = document.querySelector("#error");

const viewer = createViewer(
  {
    root: document.querySelector("#viewer"),
    stage: document.querySelector("#stage"),
    bars: document.querySelector("#bars"),
    image: document.querySelector("#story-image"),
    video: document.querySelector("#story-video"),
    closeButton: document.querySelector("#close-story"),
  },
  {
    onSeen(id) {
      markSeen(id);
      rings.querySelector(`[data-id="${CSS.escape(id)}"]`)?.classList.add("seen");
    },
    getMedia: loadMedia,
  }
);

let expiryTimer = 0;

function showError(message) {
  error.hidden = false;
  error.textContent = message;
}

function clearError() {
  error.hidden = true;
  error.textContent = "";
}

function ringSrc(story) {
  return story.type === "video" ? story.poster : story.src;
}

function render(stories) {
  const seen = new Set(loadSeen());
  rings.replaceChildren();

  stories.forEach((story, index) => {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = seen.has(story.id) ? "ring seen" : "ring";
    button.dataset.id = story.id;
    button.setAttribute("aria-label", `View story ${index + 1}`);

    const img = document.createElement("img");
    img.src = ringSrc(story);
    img.alt = "";
    button.append(img);

    button.addEventListener("click", () => {
      const fresh = prune();
      const nextIndex = fresh.findIndex((item) => item.id === story.id);
      if (!fresh.length || nextIndex === -1) {
        refresh();
        return;
      }
      viewer.open(fresh, nextIndex);
    });

    item.append(button);
    rings.append(item);
  });
}

function schedule(stories) {
  window.clearTimeout(expiryTimer);
  const delay = nextExpiryDelay(stories);
  if (delay === null) return;
  expiryTimer = window.setTimeout(refresh, delay);
}

function refresh() {
  const stories = prune();
  render(stories);
  viewer.sync(stories);
  schedule(stories);
}

async function addVideo(file) {
  const slices = await fileToVideoStories(file);
  const mediaId = crypto.randomUUID();
  await saveMedia(mediaId, file);
  const createdAt = Date.now();
  try {
    return addMany(
      slices.map((slice) => ({
        id: crypto.randomUUID(),
        type: "video",
        mediaId,
        poster: slice.poster,
        start: slice.start,
        end: slice.end,
        createdAt,
      }))
    );
  } catch (err) {
    await deleteMedia(mediaId);
    throw err;
  }
}

addButton.addEventListener("click", () => fileInput.click());

fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  fileInput.value = "";
  if (!file) return;

  clearError();
  addButton.disabled = true;
  try {
    const stories = file.type.startsWith("video/")
      ? await addVideo(file)
      : add({
          id: crypto.randomUUID(),
          type: "image",
          src: await fileToStoryImage(file),
          createdAt: Date.now(),
        });
    render(stories);
    schedule(stories);
  } catch (err) {
    const quota = err?.name === "QuotaExceededError";
    showError(quota ? "Not enough space to save this story." : err.message || "Could not add that story.");
  } finally {
    addButton.disabled = false;
  }
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") refresh();
});

refresh();
