const SWIPE_PX = 50;
const HOLD_MS = 220;
const END_SLACK_SEC = 0.08;

export function createViewer({ root, stage, bars, image, video, closeButton }, { onSeen, getMedia } = {}) {
  let stories = [];
  let index = 0;
  let token = 0;
  let pointer = null;
  let sliceReady = false;
  let raf = 0;
  let endedToken = 0;
  let currentMediaId = null;
  const urls = new Map();

  function isOpen() {
    return !root.hidden;
  }

  function stopTrack() {
    cancelAnimationFrame(raf);
    raf = 0;
  }

  function revokeUrls() {
    for (const url of urls.values()) URL.revokeObjectURL(url);
    urls.clear();
  }

  function urlFor(mediaId, blob) {
    if (!urls.has(mediaId)) urls.set(mediaId, URL.createObjectURL(blob));
    return urls.get(mediaId);
  }

  function haltVideo() {
    stopTrack();
    sliceReady = false;
    video.removeEventListener("ended", onVideoEnded);
    video.pause();
  }

  function close() {
    token += 1;
    pointer = null;
    root.hidden = true;
    root.classList.remove("paused");
    haltVideo();
    currentMediaId = null;
    video.removeAttribute("src");
    video.load();
    revokeUrls();
    image.removeAttribute("src");
    bars.replaceChildren();
  }

  function onVideoEnded() {
    if (endedToken !== token) return;
    const story = stories[index];
    if (!story || story.type !== "video") return;
    if (video.currentTime + 0.25 < story.end) return;
    show(index + 1);
  }

  function show(nextIndex) {
    if (nextIndex < 0) nextIndex = 0;
    if (nextIndex >= stories.length) {
      close();
      return;
    }

    index = nextIndex;
    token += 1;
    const myToken = token;
    const story = stories[index];
    root.classList.remove("paused");
    haltVideo();
    renderBars(myToken, story);
    onSeen?.(story.id);

    if (story.type === "video") {
      image.hidden = true;
      image.removeAttribute("src");
      video.hidden = false;
      video.setAttribute("aria-label", `Story ${index + 1} of ${stories.length}`);
      playVideo(story, myToken).catch(() => {
        if (myToken === token && isOpen()) show(index + 1);
      });
      return;
    }

    video.hidden = true;
    image.hidden = false;
    image.src = story.src;
    image.alt = `Story ${index + 1} of ${stories.length}`;
  }

  function renderBars(myToken, story) {
    bars.replaceChildren();
    stories.forEach((_, barIndex) => {
      const bar = document.createElement("div");
      bar.className = "bar";
      if (barIndex < index) bar.classList.add("done");
      if (barIndex === index) {
        bar.classList.add("active");
        if (story.type === "video") bar.classList.add("live");
      }

      const fill = document.createElement("span");
      if (barIndex === index && story.type !== "video") {
        fill.addEventListener("animationend", (event) => {
          if (event.target !== fill || myToken !== token) return;
          show(index + 1);
        });
      }
      bar.append(fill);
      bars.append(bar);
    });
  }

  function track(myToken, story) {
    stopTrack();
    const tick = () => {
      if (myToken !== token || !isOpen()) return;
      const span = story.end - story.start;
      const fill = bars.querySelector(".bar.active.live > span");
      if (fill && span > 0) {
        const progress = (video.currentTime - story.start) / span;
        fill.style.transform = `scaleX(${Math.min(1, Math.max(0, progress))})`;
      }
      const played = video.currentTime - story.start;
      if (played > 0 && played >= span - END_SLACK_SEC) {
        show(index + 1);
        return;
      }
      if (!video.paused && !video.ended) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  }

  async function playVideo(story, myToken) {
    const blob = await getMedia(story.mediaId);
    if (myToken !== token || !isOpen()) return;
    if (!blob) throw new Error("That video is missing.");

    if (currentMediaId !== story.mediaId) {
      const ready = once(video, "loadedmetadata");
      video.src = urlFor(story.mediaId, blob);
      currentMediaId = story.mediaId;
      await ready;
      if (myToken !== token || !isOpen()) return;
    }

    await seek(video, story.start);
    if (myToken !== token || !isOpen()) return;

    sliceReady = true;
    endedToken = myToken;
    video.addEventListener("ended", onVideoEnded);
    if (root.classList.contains("paused")) return;

    await startPlayback(myToken, story);
  }

  async function startPlayback(myToken, story) {
    try {
      video.muted = false;
      await video.play();
    } catch {
      video.muted = true;
      await video.play();
    }
    if (myToken !== token || !isOpen()) return;
    if (root.classList.contains("paused")) {
      video.pause();
      return;
    }
    track(myToken, story);
  }

  function resume() {
    const story = stories[index];
    if (!isOpen() || story?.type !== "video" || !sliceReady) return;
    startPlayback(token, story).catch(() => {});
  }

  function step(delta) {
    if (!isOpen()) return;
    show(index + delta);
  }

  function open(nextStories, startIndex) {
    stories = nextStories;
    root.hidden = false;
    show(startIndex);
  }

  function sync(nextStories) {
    const currentId = stories[index]?.id;
    const sameList =
      nextStories.length === stories.length &&
      nextStories.every((story, storyIndex) => story.id === stories[storyIndex]?.id);

    stories = nextStories;
    if (!isOpen() || sameList) return;
    if (!stories.length) {
      close();
      return;
    }

    const still = stories.findIndex((story) => story.id === currentId);
    if (still === -1) show(Math.min(index, stories.length - 1));
    else show(still);
  }

  function endPointer(event) {
    if (!pointer || event.pointerId !== pointer.id) return;
    const dx = event.clientX - pointer.x;
    const held = Date.now() - pointer.t >= HOLD_MS;
    const swiped = pointer.swiped || Math.abs(dx) >= SWIPE_PX;
    pointer = null;
    root.classList.remove("paused");
    if (!isOpen()) return;

    if (swiped) {
      step(dx < 0 ? 1 : -1);
      return;
    }
    if (held) {
      resume();
      return;
    }

    const rect = stage.getBoundingClientRect();
    const x = event.clientX - rect.left;
    if (x < rect.width / 3) step(-1);
    else if (x > (rect.width * 2) / 3) step(1);
    else resume();
  }

  stage.addEventListener("pointerdown", (event) => {
    if (!isOpen() || event.button !== 0) return;
    if (event.target.closest(".close")) return;
    pointer = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      t: Date.now(),
      swiped: false,
    };
    root.classList.add("paused");
    if (stories[index]?.type === "video") {
      video.pause();
      stopTrack();
    }
    try {
      stage.setPointerCapture(event.pointerId);
    } catch {
      // The pointer can already be gone. Pause still applies.
    }
  });

  stage.addEventListener("pointermove", (event) => {
    if (!pointer || event.pointerId !== pointer.id) return;
    if (Math.abs(event.clientX - pointer.x) >= SWIPE_PX) pointer.swiped = true;
  });

  stage.addEventListener("pointerup", endPointer);
  stage.addEventListener("pointercancel", (event) => {
    if (!pointer || event.pointerId !== pointer.id) return;
    pointer = null;
    root.classList.remove("paused");
    resume();
  });

  closeButton.addEventListener("click", (event) => {
    event.stopPropagation();
    close();
  });

  document.addEventListener("keydown", (event) => {
    if (!isOpen()) return;
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      step(1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      step(-1);
    }
  });

  return { open, close, sync, isOpen };
}

function once(target, event, isReady = () => false) {
  if (isReady()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const finish = (error) => {
      target.removeEventListener(event, onDone);
      target.removeEventListener("error", onError);
      if (error) reject(error);
      else resolve();
    };
    const onDone = () => finish();
    const onError = () => finish(new Error("That video could not be read."));
    target.addEventListener(event, onDone);
    target.addEventListener("error", onError);
    if (isReady()) finish();
  });
}

function seek(video, time) {
  const target = Math.max(0, time);
  if (Math.abs(video.currentTime - target) < END_SLACK_SEC) return Promise.resolve();
  const sought = once(video, "seeked");
  video.currentTime = target;
  return sought;
}
