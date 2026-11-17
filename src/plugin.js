import { plugin, logger } from "@eniac/flexdesigner";
import { createCanvas, loadImage } from "canvas";
const { SMTCMonitor } = require("@coooookies/windows-smtc-monitor");

const FONT_STACK = '"Segoe UI", "Microsoft YaHei", "Meiryo", "Malgun Gothic", sans-serif';
const canvas = createCanvas(1000, 60);
const ctx = canvas.getContext("2d");

const monitor = new SMTCMonitor();

let device = {
    serialNumber: "",
    keys: []
};

let mediaData = {
    sessionId: "",
    title: "No media playing",
    artist: "",
    artBuffer: null,
    artImage: null,
    accentColor: null,
    duration: 0,
    basePosition: 0,
    lastSyncTime: 0,
    position: 0,
    isPlaying: false
};

let customSettings = {
    progressColor: "",
    progressBgColor: "",
    enableGradient: null
};

let marqueeState = {
    titleOffset: 0,
    artistOffset: 0,
    titlePauseTicks: 10,
    artistPauseTicks: 10
};

let progressTimer = null;
let marqueeTimer = null;
let debounceTimer = null;
let isUpdating = false;
let lastDrawnImage = "";

const MARQUEE_SEPARATOR = "     •     ";
const MARQUEE_STEP_PX = 4;

function registerDevice(serialNumber, keys) {
    device.serialNumber = serialNumber;
    device.keys = keys || [];
    lastDrawnImage = "";
}

function resetMarquee() {
    marqueeState.titleOffset = 0;
    marqueeState.artistOffset = 0;
    marqueeState.titlePauseTicks = 10;
    marqueeState.artistPauseTicks = 10;
}

function getCalculatedPosition() {
    if (!mediaData.isPlaying || mediaData.lastSyncTime === 0) {
        return mediaData.basePosition;
    }
    const elapsedSec = (Date.now() - mediaData.lastSyncTime) / 1000;
    const current = mediaData.basePosition + elapsedSec;
    return mediaData.duration > 0 ? Math.min(current, mediaData.duration) : current;
}

function scheduleMediaUpdate(appId, delay = 120) {
    if (appId) {
        mediaData.sessionId = appId;
    }
    if (debounceTimer) {
        clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
        debounceTimer = null;
        updateMediaState();
    }, delay);
}

monitor.on("session-media-changed", (appId) => {
    scheduleMediaUpdate(appId, 150);
});

monitor.on("session-playback-changed", (appId) => {
    if (!mediaData.sessionId || mediaData.sessionId === appId) {
        scheduleMediaUpdate(appId, 100);
    }
});

monitor.on("session-timeline-changed", (appId) => {
    if (!mediaData.sessionId || mediaData.sessionId === appId) {
        scheduleMediaUpdate(appId, 30);
    }
});

async function updateMediaState(retryCount = 0) {
    if (isUpdating) return;
    isUpdating = true;

    try {
        const key = getActiveKey();
        if (!key) return;

        let session = null;
        try {
            session = mediaData.sessionId
                ? SMTCMonitor.getMediaSessionByAppId(mediaData.sessionId)
                : SMTCMonitor.getCurrentMediaSession();

            if (!session) {
                const sessions = SMTCMonitor.getMediaSessions();
                session = sessions && sessions.length > 0 ? sessions : null;
            }
        } catch {
            session = null;
        }

        if (!session) {
            mediaData.title = "Nothing playing";
            mediaData.artist = "";
            mediaData.artBuffer = null;
            mediaData.artImage = null;
            mediaData.accentColor = null;
            mediaData.duration = 0;
            mediaData.basePosition = 0;
            mediaData.lastSyncTime = 0;
            mediaData.position = 0;
            mediaData.isPlaying = false;
            resetMarquee();
            await renderMediaWidget(device.serialNumber, key);
            return;
        }

        let media = null;
        let timeline = null;
        let playback = null;

        try {
            media = session.media;
            timeline = session.timeline;
            playback = session.playback;
        } catch {
            if (retryCount < 3) {
                setTimeout(() => updateMediaState(retryCount + 1), 250);
            }
            return;
        }

        const newSessionId = session.appId || mediaData.sessionId;
        const newTitle = media?.title || "Unknown title";
        const newDuration = timeline?.duration || 0;
        const rawPos = timeline?.position || 0;
        const newIsPlaying = playback?.playbackStatus === 4 || playback?.status === "Playing";

        const isTrackChanged = newSessionId !== mediaData.sessionId || newTitle !== mediaData.title;
        const isPlayStateChanged = newIsPlaying !== mediaData.isPlaying;
        const isSeeked = Math.abs(rawPos - mediaData.basePosition) > 1.5;

        if (isTrackChanged) {
            resetMarquee();
        }

        if (isTrackChanged || isPlayStateChanged || isSeeked || mediaData.lastSyncTime === 0) {
            mediaData.basePosition = rawPos;
            mediaData.lastSyncTime = Date.now() - 400;
        }

        mediaData.sessionId = newSessionId;
        mediaData.title = newTitle;
        mediaData.artist = media?.artist || "";
        mediaData.duration = newDuration;
        mediaData.isPlaying = newIsPlaying;
        mediaData.position = getCalculatedPosition();

        let thumb = null;
        try {
            thumb = media?.thumbnail;
        } catch {
            thumb = null;
        }

        if (thumb && Buffer.isBuffer(thumb) && thumb.length > 0) {
            if (!mediaData.artBuffer || !thumb.equals(mediaData.artBuffer)) {
                mediaData.artBuffer = thumb;
                mediaData.artImage = null;
                mediaData.accentColor = null;
                try {
                    const img = await loadImage(thumb);
                    mediaData.artImage = img;
                    mediaData.accentColor = extractAccentColor(img);
                } catch (imgErr) {
                    logger.error("Failed to decode album thumbnail:", imgErr);
                    mediaData.artImage = null;
                    mediaData.accentColor = null;
                }
            }
        } else if (!thumb) {
            mediaData.artBuffer = null;
            mediaData.artImage = null;
            mediaData.accentColor = null;
        }

        await renderMediaWidget(device.serialNumber, key);
    } catch (err) {
        logger.error("Unexpected error updating media state:", err);
    } finally {
        isUpdating = false;
    }
}

function getActiveKey() {
    if (device.keys && Array.isArray(device.keys) && device.keys.length > 0) {
        return device.keys.find(k => k.cid === "com.xrystalll.mediainfo.page") || device.keys;
    }
    return null;
}

function startMonitor() {
    const key = getActiveKey();

    if (key && mediaData.sessionId) {
        mediaData.position = getCalculatedPosition();
        renderMediaWidget(device.serialNumber, key);
    }

    updateMediaState();

    // Update playback seconds and progress bar once per second
    if (!progressTimer) {
        progressTimer = setInterval(() => {
            if (mediaData.isPlaying && mediaData.duration > 0 && !isUpdating) {
                mediaData.position = getCalculatedPosition();
                const activeKey = getActiveKey();

                if (activeKey) {
                    renderMediaWidget(device.serialNumber, activeKey);
                }
            }
        }, 1000);
    }

    // Smooth marquee ticker (5 FPS to avoid saturating USB buffer)
    if (!marqueeTimer) {
        marqueeTimer = setInterval(() => {
            if (isUpdating) return;

            const activeKey = getActiveKey();
            if (!activeKey) return;

            if (advanceMarquee(activeKey)) {
                renderMediaWidget(device.serialNumber, activeKey);
            }
        }, 200);
    }
}

function stopMonitor() {
    if (progressTimer) {
        clearInterval(progressTimer);
        progressTimer = null;
    }
    if (marqueeTimer) {
        clearInterval(marqueeTimer);
        marqueeTimer = null;
    }
    if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
    }
}

function checkWidgetVisibility() {
    const key = getActiveKey();

    if (key) {
        startMonitor();
    } else {
        stopMonitor();
    }
}

async function renderMediaWidget(serialNumber, key) {
    if (!ctx || !canvas || !serialNumber || !key) return;

    const width = key.style?.width || 600;
    const height = key.style?.height || 60;

    if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
    }

    // 1. Background: smooth 5-stop horizontal gradient or pure black
    ctx.clearRect(0, 0, width, height);

    const useGradient = customSettings.enableGradient !== null
        ? customSettings.enableGradient
        : (key.data?.enableGradient !== false);

    if (useGradient) {
        const bgGradient = ctx.createLinearGradient(0, 0, width, 0);

        if (mediaData.accentColor) {
            const { r, g, b } = mediaData.accentColor;

            bgGradient.addColorStop(0,    `rgb(${r}, ${g}, ${b})`);
            bgGradient.addColorStop(0.25, `rgb(${Math.round(r * 0.62)}, ${Math.round(g * 0.62)}, ${Math.round(b * 0.62)})`);
            bgGradient.addColorStop(0.50, `rgb(${Math.round(r * 0.30)}, ${Math.round(g * 0.30)}, ${Math.round(b * 0.30)})`);
            bgGradient.addColorStop(0.75, `rgb(${Math.round(r * 0.10)}, ${Math.round(g * 0.10)}, ${Math.round(b * 0.10)})`);
            bgGradient.addColorStop(1,    "#000000");
        } else {
            bgGradient.addColorStop(0,    "#1E1E1E");
            bgGradient.addColorStop(0.45, "#0D0D0D");
            bgGradient.addColorStop(1,    "#000000");
        }
        ctx.fillStyle = bgGradient;
    } else {
        ctx.fillStyle = "#000000";
    }

    ctx.fillRect(0, 0, width, height);

    const padding = 2;
    const rightPadding = 6;
    const progressHeight = 3;
    const artSize = height - padding * 2 - progressHeight;
    const textStartX = padding + artSize + 8;

    // 2. Album artwork or gray placeholder on the left
    if (mediaData.artImage) {
        ctx.save();
        roundRectPath(ctx, padding, padding, artSize, artSize, 5);
        ctx.clip();
        ctx.drawImage(mediaData.artImage, padding, padding, artSize, artSize);
        ctx.restore();
    } else {
        drawCoverPlaceholder(ctx, padding, padding, artSize, 5);
    }

    // 3. Playback time aligned with artist row on the right ("0:00 / 0:00")
    let timeBlockWidth = 0;

    if (mediaData.duration > 0) {
        const currentStr = formatTime(mediaData.position);
        const totalStr = ` / ${formatTime(mediaData.duration)}`;

        ctx.textAlign = "right";
        ctx.font = "14px Arial";

        ctx.fillStyle = "#888888";
        ctx.fillText(totalStr, width - rightPadding, 45);
        const totalPartWidth = ctx.measureText(totalStr).width;

        ctx.fillStyle = "#FFFFFF";
        ctx.font = "bold 14px Arial";
        ctx.fillText(currentStr, width - rightPadding - totalPartWidth, 45);
        const currentPartWidth = ctx.measureText(currentStr).width;

        timeBlockWidth = currentPartWidth + totalPartWidth + 10;
    }

    // 4. Track title and artist text with marquee support
    ctx.textAlign = "left";

    if (mediaData.artist) {
        const maxTitleWidth = width - textStartX - rightPadding;

        drawScrollingText(
            ctx,
            mediaData.title,
            textStartX,
            23,
            maxTitleWidth,
            `bold 19px ${FONT_STACK}`,
            "#FFFFFF",
            marqueeState.titleOffset
        );

        const maxArtistWidth = width - textStartX - rightPadding - timeBlockWidth;
        drawScrollingText(
            ctx,
            mediaData.artist,
            textStartX,
            45,
            maxArtistWidth,
            `14px ${FONT_STACK}`,
            "#AAAAAA",
            marqueeState.artistOffset
        );
    } else {
        const maxTitleWidth = width - textStartX - rightPadding - timeBlockWidth;
        drawScrollingText(
            ctx,
            mediaData.title,
            textStartX,
            35,
            maxTitleWidth,
            `bold 19px ${FONT_STACK}`,
            "#FFFFFF",
            marqueeState.titleOffset
        );
    }

    // 5. Bottom progress bar with configurable colors
    if (mediaData.duration > 0) {
        const progressRatio = Math.min(Math.max(mediaData.position / mediaData.duration, 0), 1);
        const barColor = customSettings.progressColor || key.data?.progressColor || "#1DB954";
        const barBgColor = customSettings.progressBgColor || key.data?.progressBgColor || "#000000";

        ctx.fillStyle = barBgColor;
        ctx.fillRect(0, height - progressHeight, width, progressHeight);

        ctx.fillStyle = barColor;
        ctx.fillRect(0, height - progressHeight, width * progressRatio, progressHeight);
    }

    // 6. Send rendered PNG frame to Flexbar if changed
    try {
        const imageBuffer = canvas.toBuffer("image/png");
        const base64Image = imageBuffer.toString("base64");

        if (base64Image === lastDrawnImage) {
            return;
        }

        lastDrawnImage = base64Image;

        key.style.showImage = true;
        key.style.showIcon = false;
        key.style.showTitle = false;
        key.style.bgColor = "#000000";
        key.style.borderWidth = 0;
        key.style.image = `data:image/png;base64,${base64Image}`;

        plugin.draw(serialNumber, key, "draw");
    } catch (encodeError) {
        logger.error("Failed to encode canvas buffer:", encodeError);
    }
}

// Calculate next marquee step; returns true only if a redraw is needed
function advanceMarquee(key) {
    const width = key.style?.width || 600;
    const height = key.style?.height || 60;
    const padding = 2;
    const rightPadding = 6;
    const progressHeight = 3;
    const artSize = height - padding * 2 - progressHeight;
    const textStartX = padding + artSize + 8;

    let timeBlockWidth = 0;
    if (mediaData.duration > 0) {
        ctx.font = `bold 14px ${FONT_STACK}`; 
        const currentW = ctx.measureText(formatTime(mediaData.position)).width;
        ctx.font = `14px ${FONT_STACK}`;
        const totalW = ctx.measureText(` / ${formatTime(mediaData.duration)}`).width;
        timeBlockWidth = currentW + totalW + 10;
    }

    let needsRedraw = false;

    // 1. Check Title overflow
    const maxTitleWidth = mediaData.artist
        ? width - textStartX - rightPadding
        : width - textStartX - rightPadding - timeBlockWidth;

    ctx.font = `bold 19px ${FONT_STACK}`;
    const titleWidth = ctx.measureText(mediaData.title || "").width;

    if (titleWidth > maxTitleWidth && maxTitleWidth > 0) {
        if (marqueeState.titlePauseTicks > 0) {
            marqueeState.titlePauseTicks--;
        } else {
            const loopWidth = ctx.measureText(mediaData.title + MARQUEE_SEPARATOR).width;
            marqueeState.titleOffset += MARQUEE_STEP_PX;
            if (marqueeState.titleOffset >= loopWidth) {
                marqueeState.titleOffset = 0;
                marqueeState.titlePauseTicks = 10;
            }
            needsRedraw = true;
        }
    } else {
        marqueeState.titleOffset = 0;
    }

    // 2. Check Artist overflow
    if (mediaData.artist) {
        const maxArtistWidth = width - textStartX - rightPadding - timeBlockWidth;
        ctx.font = `14px ${FONT_STACK}`;
        const artistWidth = ctx.measureText(mediaData.artist).width;

        if (artistWidth > maxArtistWidth && maxArtistWidth > 0) {
            if (marqueeState.artistPauseTicks > 0) {
                marqueeState.artistPauseTicks--;
            } else {
                const loopWidth = ctx.measureText(mediaData.artist + MARQUEE_SEPARATOR).width;
                marqueeState.artistOffset += MARQUEE_STEP_PX;
                if (marqueeState.artistOffset >= loopWidth) {
                    marqueeState.artistOffset = 0;
                    marqueeState.artistPauseTicks = 10;
                }
                needsRedraw = true;
            }
        } else {
            marqueeState.artistOffset = 0;
        }
    } else {
        marqueeState.artistOffset = 0;
    }

    return needsRedraw;
}

// Draw static text if it fits, or clipped looping marquee if it overflows
function drawScrollingText(ctx, text, x, y, maxWidth, font, color, offset) {
    if (!text || maxWidth <= 0) return;

    ctx.font = font;
    ctx.fillStyle = color;
    const textWidth = ctx.measureText(text).width;

    if (textWidth <= maxWidth) {
        ctx.fillText(text, x, y);
        return;
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y - 22, maxWidth, 28);
    ctx.clip();

    const fullLoopText = text + MARQUEE_SEPARATOR;
    const loopWidth = ctx.measureText(fullLoopText).width;
    const drawX = x - offset;

    ctx.fillText(fullLoopText, drawX, y);
    if (drawX + loopWidth < x + maxWidth) {
        ctx.fillText(fullLoopText, drawX + loopWidth, y);
    }

    ctx.restore();
}

// Extract dominant vibrant color from album cover using a 16x16 sample canvas
function extractAccentColor(img) {
    try {
        const sampleCanvas = createCanvas(16, 16);
        const sampleCtx = sampleCanvas.getContext("2d");
        sampleCtx.drawImage(img, 0, 0, 16, 16);

        const data = sampleCtx.getImageData(0, 0, 16, 16).data;
        let bestColor = null;
        let maxScore = -1;

        for (let i = 0; i < data.length; i += 4) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];

            const max = Math.max(r, g, b);
            const min = Math.min(r, g, b);
            const delta = max - min;
            const brightness = (r + g + b) / 3;

            if (brightness < 25 || brightness > 235) continue;

            const score = delta * 1.5 + brightness * 0.3;
            if (score > maxScore) {
                maxScore = score;
                bestColor = { r, g, b };
            }
        }

        if (!bestColor) {
            return { r: 65, g: 65, b: 65 };
        }

        const dimFactor = 0.42;
        return {
            r: Math.round(bestColor.r * dimFactor),
            g: Math.round(bestColor.g * dimFactor),
            b: Math.round(bestColor.b * dimFactor)
        };
    } catch {
        return null;
    }
}

// Gray placeholder with Material Design "music_note" icon (24x24 grid)
function drawCoverPlaceholder(ctx, x, y, size, radius) {
    ctx.save();
    roundRectPath(ctx, x, y, size, size, radius);
    ctx.fillStyle = "#2A2A2A";
    ctx.fill();

    const iconSize = size * 0.58;
    const scale = iconSize / 24;
    const offsetX = x + (size - iconSize) / 2;
    const offsetY = y + (size - iconSize) / 2;

    ctx.translate(offsetX, offsetY);
    ctx.scale(scale, scale);
    ctx.fillStyle = "#757575";

    ctx.beginPath();
    ctx.arc(10, 17, 4, 0, Math.PI * 2);
    ctx.moveTo(12, 3);
    ctx.lineTo(18, 3);
    ctx.lineTo(18, 7);
    ctx.lineTo(14, 7);
    ctx.lineTo(14, 17);
    ctx.lineTo(12, 17);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
}

function formatTime(totalSeconds) {
    if (!totalSeconds || isNaN(totalSeconds) || totalSeconds < 0) return "0:00";

    const seconds = Math.round(totalSeconds);
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    const paddedSecs = secs < 10 ? `0${secs}` : secs;
    if (hrs > 0) {
        const paddedMins = mins < 10 ? `0${mins}` : mins;
        return `${hrs}:${paddedMins}:${paddedSecs}`;
    }
    return `${mins}:${paddedSecs}`;
}

function roundRectPath(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.arcTo(x + width, y, x + width, y + height, radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.arcTo(x + width, y + height, x, y + height, radius);
    ctx.lineTo(x + radius, y + height);
    ctx.arcTo(x, y + height, x, y, radius);
    ctx.lineTo(x, y + radius);
    ctx.arcTo(x, y, x + radius, y, radius);
    ctx.closePath();
}

function applyUpdatedKeys(payload) {
    if (payload.keys && Array.isArray(payload.keys)) {
        device.keys = payload.keys;
    } else if (payload.key) {
        const idx = device.keys.findIndex(k => k.uid === payload.key.uid || k.cid === payload.key.cid);
        if (idx !== -1) {
            device.keys[idx] = payload.key;
        } else {
            device.keys = [payload.key];
        }
    }
    lastDrawnImage = "";
}

// Receive live settings updates from UI
plugin.on("ui.message", (payload) => {
    const data = payload?.data || payload;
    if (data?.type === "update-settings") {
        customSettings.progressColor = data.progressColor;
        customSettings.progressBgColor = data.progressBgColor;
        customSettings.enableGradient = data.enableGradient;
        lastDrawnImage = "";
        const key = getActiveKey();
        if (key) {
            renderMediaWidget(device.serialNumber, key);
        }
    }
});

plugin.on("plugin.alive", (payload) => {
    registerDevice(payload.serialNumber, payload.keys);
    checkWidgetVisibility();
});

plugin.on("plugin.config.updated", (payload) => {
    applyUpdatedKeys(payload);
    checkWidgetVisibility();
});

plugin.start();
