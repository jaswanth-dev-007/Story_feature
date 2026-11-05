const MAX_WIDTH = 1080;
const MAX_HEIGHT = 1920;
const POSTER_EDGE = 256;
const SLICE_SEC = 60;

export function fitSize(width, height, maxWidth = MAX_WIDTH, maxHeight = MAX_HEIGHT) {
  const scale = Math.min(1, maxWidth / width, maxHeight / height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export function sliceDuration(duration) {
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error("That video has no duration.");
  }

  const slices = [];
  let start = 0;
  do {
    const end = Math.min(start + SLICE_SEC, duration);
    if (end <= start) break;
    slices.push({ start, end });
    start = end;
  } while (start < duration);

  if (!slices.length) throw new Error("That video has no duration.");
  return slices;
}

export function fileToStoryImage(file) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith("image/")) {
      reject(new Error("Choose an image or a video."));
      return;
    }

    const url = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      URL.revokeObjectURL(url);
      const { width, height } = fitSize(image.naturalWidth, image.naturalHeight);
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      context.fillStyle = "#000";
      context.fillRect(0, 0, width, height);
      context.drawImage(image, 0, 0, width, height);
      resolve(canvas.toDataURL("image/jpeg", 0.85));
    };

    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("That image could not be read."));
    };

    image.src = url;
  });
}

function waitFor(target, event, isReady = () => false) {
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

function drawPoster(video) {
  const { width, height } = fitSize(video.videoWidth, video.videoHeight, POSTER_EDGE, POSTER_EDGE);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  context.drawImage(video, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", 0.8);
}

async function capturePoster(video, time) {
  const target = Math.min(Math.max(time, 0), Math.max(0, video.duration - 0.05));
  if (Math.abs(video.currentTime - target) > 0.08) {
    const sought = waitFor(video, "seeked");
    video.currentTime = target;
    await sought;
  } else if (video.readyState < 2) {
    await waitFor(video, "loadeddata", () => video.readyState >= 2);
  }
  if (!video.videoWidth || !video.videoHeight) {
    throw new Error("That video could not be read.");
  }
  return drawPoster(video);
}

export async function fileToVideoStories(file) {
  if (!file || !file.type.startsWith("video/")) {
    throw new Error("Choose an image or a video.");
  }

  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.preload = "auto";
  video.muted = true;
  video.playsInline = true;
  const ready = waitFor(video, "loadedmetadata", () => video.readyState >= 1);
  video.src = url;

  try {
    await ready;
    const slices = sliceDuration(video.duration);
    try {
      await video.play();
      video.pause();
    } catch {
      // A poster can still be taken from the first decoded frame.
    }

    for (const slice of slices) {
      slice.poster = await capturePoster(video, slice.start);
    }
    return slices;
  } catch (err) {
    if (err instanceof Error && err.message) throw err;
    throw new Error("That video could not be read.");
  } finally {
    video.pause();
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}
