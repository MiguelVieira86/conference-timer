// ===== CONFIGURAÇÃO =====
const INITIAL_SECONDS = 15 * 60;

const textColor = "#ffffff";
const textColorWarning = "#ff1919"; // Vermelho para últimos 5 minutos
const bgColor = "#000000";
const flashColor = "#ff5e5e"; // Cor do flash de alerta

const GAP_EM = 0.08;
const OUTER_MARGIN = 0.05;

const MAX_MINUTES = 99;
const MAX_SECONDS_TOTAL = (MAX_MINUTES * 60) + 59; // 99:59

const WARNING_THRESHOLD = 5 * 60; // 5 minutos em segundos

const MENU_HIDE_DELAY = 2500;   // começa fade aos 2.5s
const CURSOR_HIDE_DELAY = 3000; // cursor some brusco aos 3s

const ADJUSTMENT_PAUSE_DELAY = 1000; // pausa de 1 segundo ao ajustar segundos

const FLASH_DURATION = 150; // Duração de cada flash em ms
const FLASH_COUNT = 2; // Número de flashes
const FLASH_INTERVAL = 200; // Intervalo entre flashes
// =======================

let totalSeconds = INITIAL_SECONDS;
let presetSeconds = INITIAL_SECONDS;

let running = false;
let timerId = null;

// Sistema de pausa temporária ao ajustar segundos
let adjustmentPauseTimer = null;
let wasRunningBeforeAdjustment = false;

// Sistema de flash de alerta
let isFlashingWarning = false; // flash dos 5 minutos
let isFlashingEnd = false;     // flash do fim (00:00)
let hasFlashedAt5Min = false;  // Controla se já fez flash aos 5:00

// Sistema de piscar ao chegar a 00:00
let isBlinking = false;
let blinkVisible = true;
let blinkTimer = null;

// Tecla B pressionada — flash manual
let bKeyHeld = false;

const canvas = document.getElementById("screen");
const ctx = canvas.getContext("2d");
const controls = document.getElementById("controls");

// ---------- util ----------
function clampSecondsTotal(n) {
  return Math.max(0, Math.min(MAX_SECONDS_TOTAL, n));
}
function getMMSS(secondsTotal) {
  const c = clampSecondsTotal(secondsTotal);
  return { mm: Math.floor(c / 60), ss: c % 60 };
}
function formatMMSS(secondsTotal) {
  const { mm, ss } = getMMSS(secondsTotal);
  return String(mm).padStart(2, "0") + ":" + String(ss).padStart(2, "0");
}
function applyPresetFromCurrent() {
  // Só guarda o preset se o timer estiver parado (não em contagem nem a piscar)
  if (!running && !isBlinking) {
    presetSeconds = clampSecondsTotal(totalSeconds);
  }
}

// ---------- Auto-hide (menu fade + cursor brusco) ----------
let menuTimer = null;
let cursorTimer = null;

function showMenu() {
  if (!controls) return;
  controls.classList.remove("is-fading");
}
function fadeMenu() {
  if (!controls) return;
  controls.classList.add("is-fading");
}

function showCursor() {
  document.body.style.cursor = "";
}
function hideCursor() {
  document.body.style.cursor = "none";
}

function resetAutoHide() {
  // MENU: aparece já, e agenda fade aos 2.5s
  if (menuTimer) clearTimeout(menuTimer);
  showMenu();
  menuTimer = setTimeout(() => {
    fadeMenu(); // o CSS faz fade-out em 0.5s
  }, MENU_HIDE_DELAY);

  // CURSOR: aparece já, e some brusco aos 3s
  if (cursorTimer) clearTimeout(cursorTimer);
  showCursor();
  cursorTimer = setTimeout(() => {
    hideCursor();
  }, CURSOR_HIDE_DELAY);
}

function bindAutoHide() {
  const wake = (e) => {
    // Tecla B não acorda o menu/cursor
    if (e && e.code === "KeyB") return;
    resetAutoHide();
  };

  window.addEventListener("mousemove", wake, { passive: true });
  window.addEventListener("pointerdown", wake, { passive: true });
  window.addEventListener("touchstart", wake, { passive: true });
  window.addEventListener("keydown", wake);

  window.addEventListener("blur", () => {
    showMenu();
    showCursor();
    if (menuTimer) clearTimeout(menuTimer);
    if (cursorTimer) clearTimeout(cursorTimer);
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      showMenu();
      showCursor();
      if (menuTimer) clearTimeout(menuTimer);
      if (cursorTimer) clearTimeout(cursorTimer);
    } else {
      resetAutoHide();
    }
  });
}

// ---------- Fullscreen (cross-browser) ----------
function isFullscreen() {
  return !!(
    document.fullscreenElement ||
    document.webkitFullscreenElement ||
    document.mozFullScreenElement ||
    document.msFullscreenElement
  );
}
function requestFs(el) {
  if (el.requestFullscreen) return el.requestFullscreen();
  if (el.webkitRequestFullscreen) return el.webkitRequestFullscreen();
  if (el.mozRequestFullScreen) return el.mozRequestFullScreen();
  if (el.msRequestFullscreen) return el.msRequestFullscreen();
  return Promise.reject(new Error("Fullscreen not supported"));
}
function exitFs() {
  if (document.exitFullscreen) return document.exitFullscreen();
  if (document.webkitExitFullscreen) return document.webkitExitFullscreen();
  if (document.mozCancelFullScreen) return document.mozCancelFullScreen();
  if (document.msExitFullscreen) return document.msExitFullscreen();
  return Promise.reject(new Error("Exit fullscreen not supported"));
}
async function toggleFullscreen() {
  try {
    if (isFullscreen()) await exitFs();
    else await requestFs(document.documentElement);
  } catch (_) {}
  resetAutoHide();
}

// ---------- Canvas ----------
function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const w = window.innerWidth;
  const h = window.innerHeight;

  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  canvas.style.width = w + "px";
  canvas.style.height = h + "px";

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function measureGlyph(ch) {
  const m = ctx.measureText(ch);
  return {
    width: (m.actualBoundingBoxLeft ?? 0) + (m.actualBoundingBoxRight ?? m.width),
    left: (m.actualBoundingBoxLeft ?? 0),
    ascent: (m.actualBoundingBoxAscent ?? 0),
    descent: (m.actualBoundingBoxDescent ?? 0),
  };
}

function computeFontSizeAndLayout(W, H) {
  let fs = Math.floor(H * 0.88);

  function calc(size) {
    ctx.font = `${size}px Technology, monospace`;
    const d = measureGlyph("8");
    const c = measureGlyph(":");
    const g = size * GAP_EM;

    return {
      total: d.width * 4 + c.width + g * 4,
      digitCell: d.width,
      colonCell: c.width,
      gap: g,
      digit: d,
      fontSize: size,
    };
  }

  const maxW = W * (1 - OUTER_MARGIN * 2);
  let L = calc(fs);

  let guard = 0;
  while (L.total > maxW && guard < 40) {
    fs = Math.floor(fs * 0.97);
    L = calc(fs);
    guard++;
  }

  return L;
}

function drawTimer(forceFlash = false) {
  const W = window.innerWidth;
  const H = window.innerHeight;

  // Se o B está pressionado, força sempre o modo flash
  if (bKeyHeld) forceFlash = true;

  // Fundo: normal ou flash
  if (forceFlash) {
    ctx.fillStyle = flashColor;
  } else {
    ctx.fillStyle = bgColor;
  }
  ctx.fillRect(0, 0, W, H);

  totalSeconds = clampSecondsTotal(totalSeconds);
  const str = formatMMSS(totalSeconds);

  const { fontSize, digitCell, colonCell, gap, digit } = computeFontSizeAndLayout(W, H);

  ctx.font = `${fontSize}px Technology, monospace`;
  
  // Escolhe a cor do texto
  if (forceFlash) {
    // Durante o flash, inverte: fundo vermelho, texto branco
    ctx.fillStyle = textColor;
  } else {
    // Vermelho se <= 5 minutos (incluindo 00:00), branco caso contrário
    if (totalSeconds <= WARNING_THRESHOLD) {
      ctx.fillStyle = textColorWarning;
    } else {
      ctx.fillStyle = textColor;
    }
  }

  // Centrar verticalmente com a caixa visual real do glifo
  // ascent e descent vêm do measureGlyph("8") — são os valores reais do canvas
  const ascent    = digit.ascent;
  const descent   = digit.descent;
  const baselineY = Math.round((H + ascent - descent) / 2);

  const widths = [digitCell, digitCell, colonCell, digitCell, digitCell];
  const totalW = widths.reduce((a, b) => a + b, 0) + gap * 4;
  let x = (W - totalW) / 2;

  // Só desenha os dígitos se não estiver no estado invisível do piscar
  if (!isBlinking || blinkVisible) {
    for (let i = 0; i < str.length; i++) {
      const ch = str[i];
      const m = measureGlyph(ch);
      const drawX = x + (widths[i] - m.width) / 2 + m.left;
      ctx.fillText(ch, drawX, baselineY);
      x += widths[i] + gap;
    }
  }
}

// ---------- Sistema de Flash de Alerta ----------
function triggerFlashThenBlink() {
  if (isFlashingEnd) return;
  isFlashingEnd = true;
  let flashesRemaining = FLASH_COUNT;

  function doFlash() {
    if (flashesRemaining <= 0) {
      isFlashingEnd = false;
      drawTimer(false);
      startBlinking();
      return;
    }
    drawTimer(true);
    setTimeout(() => {
      drawTimer(false);
      flashesRemaining--;
      if (flashesRemaining > 0) {
        setTimeout(doFlash, FLASH_INTERVAL);
      } else {
        isFlashingEnd = false;
        drawTimer(false);
        startBlinking();
      }
    }, FLASH_DURATION);
  }

  doFlash();
}

function triggerFlash() {
  if (isFlashingWarning) return;
  
  isFlashingWarning = true;
  let flashesRemaining = FLASH_COUNT;
  
  function doFlash() {
    // Aborta se o flash final já começou
    if (isFlashingEnd) {
      isFlashingWarning = false;
      return;
    }
    if (flashesRemaining <= 0) {
      isFlashingWarning = false;
      drawTimer(false);
      return;
    }
    drawTimer(true);
    setTimeout(() => {
      if (isFlashingEnd) { isFlashingWarning = false; return; }
      drawTimer(false);
      flashesRemaining--;
      if (flashesRemaining > 0) {
        setTimeout(doFlash, FLASH_INTERVAL);
      } else {
        isFlashingWarning = false;
      }
    }, FLASH_DURATION);
  }
  
  doFlash();
}

function startBlinking() {
  if (isBlinking) return;
  isBlinking = true;
  blinkVisible = true;

  function tick() {
    blinkVisible = !blinkVisible;
    drawTimer();
    blinkTimer = setTimeout(tick, 500);
  }

  drawTimer();
  blinkTimer = setTimeout(tick, 500);
}

function stopBlinking() {
  if (!isBlinking) return;
  isBlinking = false;
  blinkVisible = true;
  if (blinkTimer) {
    clearTimeout(blinkTimer);
    blinkTimer = null;
  }
}

function checkAndTriggerFlashAt5Min() {
  // Só faz flash exactamente aos 5:00 (300 segundos) e apenas uma vez
  if (totalSeconds === WARNING_THRESHOLD && !hasFlashedAt5Min) {
    hasFlashedAt5Min = true;
    triggerFlash();
  }
  
  // Reset se voltar a subir acima de 5 minutos (ajuste manual)
  if (totalSeconds > WARNING_THRESHOLD) {
    hasFlashedAt5Min = false;
  }
}

// ---------- Atualizar ícone do botão play/pause ----------
function updatePlayPauseButton() {
  const playPauseBtn = document.getElementById("playPause");
  if (!playPauseBtn) return;
  
  if (running) {
    playPauseBtn.textContent = "❚❚";
    playPauseBtn.setAttribute("aria-label", "pause");
  } else {
    playPauseBtn.textContent = "▶";
    playPauseBtn.setAttribute("aria-label", "play");
  }
}

// ---------- Sistema de pausa temporária ----------
function pauseTemporarily() {
  // Guarda o estado atual
  if (!wasRunningBeforeAdjustment) {
    wasRunningBeforeAdjustment = running;
  }
  
  // Pausa o timer se estiver a correr
  if (running) {
    running = false;
    if (timerId) clearInterval(timerId);
    timerId = null;
    updatePlayPauseButton();
  }
  
  // Cancela qualquer timer de retoma anterior
  if (adjustmentPauseTimer) {
    clearTimeout(adjustmentPauseTimer);
  }
  
  // Agenda a retoma após 1 segundo
  adjustmentPauseTimer = setTimeout(() => {
    if (wasRunningBeforeAdjustment) {
      // Retoma o timer
      running = true;
      startCountdownInterval();
      updatePlayPauseButton();
    }
    wasRunningBeforeAdjustment = false;
    adjustmentPauseTimer = null;
  }, ADJUSTMENT_PAUSE_DELAY);
}

// ---------- Ajustes (wrap/carry) ----------
function adjustMinutes(delta) {
  const wasBlinking = isBlinking;

  if (isBlinking) {
    stopBlinking();
  }

  const { mm, ss } = getMMSS(totalSeconds);
  const newMM = (mm + delta + 100) % 100;
  totalSeconds = clampSecondsTotal(newMM * 60 + ss);
  applyPresetFromCurrent();

  // Qualquer ajuste manual reseta o flag do flash dos 5 min
  hasFlashedAt5Min = false;

  // Se o ajuste aterrou exactamente nos 5:00 enquanto o timer corre,
  // o setInterval vai saltar este valor — dispara o flash aqui
  if (running && totalSeconds === WARNING_THRESHOLD) {
    hasFlashedAt5Min = true;
    triggerFlash();
  }

  // Retoma a contagem se saímos do piscar e não há intervalo activo
  if (wasBlinking && totalSeconds > 0 && !timerId) {
    running = true;
    startCountdownInterval();
    updatePlayPauseButton();
  }

  drawTimer();
  resetAutoHide();
}

function adjustSeconds(delta) {
  const wasBlinking = isBlinking;

  if (isBlinking) {
    stopBlinking();
  } else if (running) {
    pauseTemporarily();
  }

  let { mm, ss } = getMMSS(totalSeconds);

  if (delta > 0) {
    ss++;
    if (ss === 60) { ss = 0; mm = (mm + 1) % 100; }
  } else if (delta < 0) {
    ss--;
    if (ss === -1) { ss = 59; mm = (mm + 99) % 100; }
  }

  totalSeconds = clampSecondsTotal(mm * 60 + ss);
  applyPresetFromCurrent();

  // Qualquer ajuste manual reseta o flag do flash dos 5 min
  hasFlashedAt5Min = false;

  // Retoma a contagem se saímos do piscar e não há intervalo activo
  if (wasBlinking && totalSeconds > 0 && !timerId) {
    running = true;
    startCountdownInterval();
    updatePlayPauseButton();
  }

  drawTimer();
  resetAutoHide();
}

// ---------- Timer ----------

// Inicia o intervalo de contagem regressiva (usado em vários sítios)
function startCountdownInterval() {
  // Garante que não há intervalo anterior a correr
  if (timerId) {
    clearInterval(timerId);
    timerId = null;
  }
  timerId = setInterval(() => {
    if (totalSeconds > 0) {
      totalSeconds--;
      drawTimer();
      checkAndTriggerFlashAt5Min();
      if (totalSeconds === 0) {
        clearInterval(timerId);
        timerId = null;
        running = true; // mantém activo para o botão mostrar pause
        updatePlayPauseButton();
        triggerFlashThenBlink();
      }
    }
  }, 1000);
}

function startTimer() {
  if (running) return;
  
  stopBlinking(); // Para o piscar se estava ativo
  
  // Cancela qualquer pausa temporária pendente
  if (adjustmentPauseTimer) {
    clearTimeout(adjustmentPauseTimer);
    adjustmentPauseTimer = null;
  }
  wasRunningBeforeAdjustment = false;
  
  running = true;
  startCountdownInterval();
  updatePlayPauseButton();
  resetAutoHide();
}

function pauseTimer() {
  running = false;
  if (timerId) clearInterval(timerId);
  timerId = null;
  
  stopBlinking(); // Para o piscar se estava activo
  drawTimer();    // Garante que os números ficam sempre visíveis ao pausar
  
  // Cancela qualquer pausa temporária pendente
  if (adjustmentPauseTimer) {
    clearTimeout(adjustmentPauseTimer);
    adjustmentPauseTimer = null;
  }
  wasRunningBeforeAdjustment = false;
  
  updatePlayPauseButton();
  resetAutoHide();
}

function toggleStartPause() {
  if (running) pauseTimer();
  else startTimer();
}

function resetTimer() {
  pauseTimer();
  stopBlinking();
  totalSeconds = clampSecondsTotal(presetSeconds);
  hasFlashedAt5Min = false; // Reset do sistema de flash
  drawTimer();
  resetAutoHide();
}

// ---------- Duplo clique no canvas para fullscreen ----------
function bindCanvasDoubleClick() {
  if (!canvas) return;
  
  canvas.addEventListener("dblclick", (e) => {
    e.preventDefault();
    toggleFullscreen();
  });
}

// ---------- Bind UI (robusto) ----------

// Press-and-hold que replica o comportamento das setas do teclado
// (pausa inicial ~500ms, depois repeat contínuo ~50ms)
function bindHoldButton(el, action) {
  if (!el) return;

  let holdTimer = null;
  let holdInterval = null;

  function start(e) {
    e.preventDefault();
    action();
    holdTimer = setTimeout(() => {
      holdInterval = setInterval(action, 50);
    }, 500);
  }

  function stop() {
    if (holdTimer)    clearTimeout(holdTimer);
    if (holdInterval) clearInterval(holdInterval);
    holdTimer = null;
    holdInterval = null;
  }

  el.addEventListener("pointerdown", start);
  window.addEventListener("pointerup",     stop);
  window.addEventListener("pointercancel", stop);
}

function bindControls() {
  const plusMin = document.getElementById("plusMin");
  const minusMin = document.getElementById("minusMin");
  const plusSec = document.getElementById("plusSec");
  const minusSec = document.getElementById("minusSec");
  const playPauseBtn = document.getElementById("playPause");
  const resetBtn = document.getElementById("reset");
  const fsBtn = document.getElementById("fullscreen");

  bindHoldButton(plusMin,  () => adjustMinutes(+1));
  bindHoldButton(minusMin, () => adjustMinutes(-1));
  bindHoldButton(plusSec,  () => adjustSeconds(+1));
  bindHoldButton(minusSec, () => adjustSeconds(-1));

  if (playPauseBtn) playPauseBtn.addEventListener("click", toggleStartPause);
  if (resetBtn) resetBtn.addEventListener("click", resetTimer);

  if (fsBtn) {
    fsBtn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      toggleFullscreen();
    });
  }
}

// ---------- Atalhos ----------
function bindKeyboardShortcuts() {
  window.addEventListener("keydown", (e) => {
    // Tecla B tratada antes do resetAutoHide para não revelar menu/cursor
    if (e.code === "KeyB" && !e.repeat) {
      e.preventDefault();
      bKeyHeld = true;
      drawTimer(true);
      return;
    }

    resetAutoHide();

    if (e.code === "Space") {
      e.preventDefault();
      toggleStartPause();
      return;
    }
    if (e.code === "KeyR") {
      e.preventDefault();
      resetTimer();
      return;
    }
    if (e.code === "KeyF") {
      e.preventDefault();
      toggleFullscreen();
      return;
    }

    if (e.code === "ArrowUp") {
      e.preventDefault();
      if (e.shiftKey) adjustMinutes(+1);
      else adjustSeconds(+1);
      return;
    }
    if (e.code === "ArrowDown") {
      e.preventDefault();
      if (e.shiftKey) adjustMinutes(-1);
      else adjustSeconds(-1);
      return;
    }
  });

  window.addEventListener("keyup", (e) => {
    if (e.code === "KeyB") {
      e.preventDefault();
      bKeyHeld = false;
      // Restaura o estado visual correto ao largar o B
      drawTimer(false);
    }
  });
}

// ---------- Start ----------
async function start() {
  resizeCanvas();

  if (document.fonts && document.fonts.load) {
    try {
      await document.fonts.load("48px Technology");
      await document.fonts.ready;
    } catch (_) {}
  }

  totalSeconds = clampSecondsTotal(totalSeconds);
  presetSeconds = clampSecondsTotal(presetSeconds);

  bindControls();
  bindKeyboardShortcuts();
  bindCanvasDoubleClick();
  bindAutoHide();

  drawTimer();
  updatePlayPauseButton();
  resetAutoHide();
}

// Repõe o menu para a posição central original
function resetControlsPosition() {
  if (!controls) return;
  controls.style.left = "50%";
  controls.style.top = "";
  controls.style.bottom = "22px";
  controls.style.transform = "translateX(-50%)";
}

window.addEventListener("resize", () => {
  resizeCanvas();
  drawTimer();
  resetControlsPosition();
  resetAutoHide();
});

document.addEventListener("fullscreenchange", () => {
  resizeCanvas();
  drawTimer();
  resetControlsPosition();
  resetAutoHide();
});
document.addEventListener("webkitfullscreenchange", () => {
  resizeCanvas();
  drawTimer();
  resetControlsPosition();
  resetAutoHide();
});

screen.orientation && screen.orientation.addEventListener("change", () => {
  resizeCanvas();
  drawTimer();
  resetControlsPosition();
  resetAutoHide();
});

start();
