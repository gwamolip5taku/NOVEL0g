(() => {
  "use strict";

  const DEFAULT_WIDTH = 2000;
  const MIN_WIDTH = 400;
  const MIN_FONT_SIZE = 10;

  const LAYOUT = {
    padding: 108 / 650,
    gap: 36 / 650,
    minHeight: 400 / 650,
  };

  const ALLOWED_TAGS = new Set(["B", "STRONG", "I", "EM", "U", "S", "STRIKE", "BR", "DIV", "P"]);

  const state = {
    imageUrl: null,
    imageSize: null,
    imagePos: { x: 50, y: 50 },
    drag: null,
    fontUploads: [],
    busy: false,
  };

  const $ = (id) => document.getElementById(id);
  const el = {
    titleInput: $("title-input"), subtitleInput: $("subtitle-input"), bodyInput: $("body-input"),
    titleSize: $("title-size"), subtitleSize: $("subtitle-size"), bodySize: $("body-size"),
    font: $("font"),
    fileFont: $("file-font"), dropFont: $("drop-font"), mainFont: $("main-font"), metaFont: $("meta-font"),
    fileImg: $("file-img"), dropImg: $("drop-img"), mainImg: $("main-img"), metaImg: $("meta-img"),
    imgRemove: $("img-remove"), imgReset: $("img-reset"),
    imgWidth: $("img-width"), imgWidthValue: $("img-width-value"),
    canvasWidth: $("canvas-width"), download: $("download"), status: $("status"),
    outSize: $("out-size"), canvas: $("canvas"), inner: $("canvas-inner"),
    imgArea: $("img-area"), imgInner: $("img-inner"), textArea: document.querySelector(".text-area"),
    titlePreview: $("title-preview"), subtitlePreview: $("subtitle-preview"), bodyPreview: $("body-preview"),
  };

  const PLAIN_FIELDS = [
    { input: el.titleInput,    size: el.titleSize,    preview: el.titlePreview },
    { input: el.subtitleInput, size: el.subtitleSize, preview: el.subtitlePreview },
  ];
  const BODY_FIELD = { input: el.bodyInput, size: el.bodySize, preview: el.bodyPreview };

  const IMG_META_DEFAULT = el.metaImg.textContent;

  const INITIAL_FONT = "lib:JeonjuCraftMyungjo:300";

  function readNumber(input, fallback, min) {
    const n = Number(input.value);
    if (!input.value || !Number.isFinite(n)) return fallback;
    return Math.max(min, n);
  }

  const canvasWidth = () => readNumber(el.canvasWidth, DEFAULT_WIDTH, MIN_WIDTH);
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  function escapeHtml(text) {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function copySafe(source, target) {
    target.replaceChildren();
    const walk = (from, to) => {
      for (const node of from.childNodes) {
        if (node.nodeType === Node.TEXT_NODE) {
          to.append(node.textContent);
        } else if (node.nodeType === Node.ELEMENT_NODE) {
          if (ALLOWED_TAGS.has(node.tagName)) {
            const clean = document.createElement(node.tagName);
            to.append(clean);
            walk(node, clean);
          } else {
            walk(node, to);
          }
        }
      }
    };
    walk(source, target);
  }

  function fileNameFromTitle() {
    const name = el.titleInput.textContent
      .replace(/[^a-zA-Z0-9가-힣\s_-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .toLowerCase();
    return name || "novelog";
  }

  function saveBlob(blob, fileName) {
    const link = document.createElement("a");
    link.download = fileName;
    link.href = URL.createObjectURL(blob);
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  function setStatus(text, isError = false) {
    el.status.textContent = text;
    el.status.classList.toggle("is-error", isError);
  }

  const MD = {
    fence: /^\s*```/,
    heading: /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/,
    hr: /^\s{0,3}([-*_])(\s*\1){2,}\s*$/,
    quote: /^\s{0,3}>\s?/,
    ul: /^\s*[-*+]\s+(.*)$/,
    ol: /^\s*(\d{1,9})[.)]\s+(.*)$/,
  };

  const isBlockStart = (line) =>
    MD.fence.test(line) || MD.heading.test(line) || MD.hr.test(line) ||
    MD.quote.test(line) || MD.ul.test(line) || MD.ol.test(line);

  function mdInline(text) {
    return text.split(/`([^`]+)`/).map((part, i) => {
      if (i % 2 === 1) return `<code>${escapeHtml(part)}</code>`;
      return escapeHtml(part)
        .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, "<u>$1</u>")
        .replace(/\*\*(?=\S)(.+?)\*\*/g, "<strong>$1</strong>")
        .replace(/__(?=\S)(.+?)__/g, "<strong>$1</strong>")
        .replace(/~~(?=\S)(.+?)~~/g, "<del>$1</del>")
        .replace(/\*(?=\S)(.+?)\*/g, "<em>$1</em>")
        .replace(/(^|[^\w가-힣])_(?=\S)(.+?)_(?![\w가-힣])/g, "$1<em>$2</em>");
    }).join("");
  }

  function markdownToHtml(md) {
    const lines = md.replace(/\r\n?/g, "\n").split("\n");
    const out = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      if (!line.trim()) { i++; continue; }

      if (MD.fence.test(line)) {
        const code = [];
        i++;
        while (i < lines.length && !MD.fence.test(lines[i])) code.push(lines[i++]);
        i++;
        out.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
        continue;
      }

      const h = line.match(MD.heading);
      if (h) {
        const level = Math.min(h[1].length, 3);
        out.push(`<h${level}>${mdInline(h[2])}</h${level}>`);
        i++;
        continue;
      }

      if (MD.hr.test(line)) { out.push("<hr>"); i++; continue; }

      if (MD.quote.test(line)) {
        const inner = [];
        while (i < lines.length && MD.quote.test(lines[i])) inner.push(lines[i++].replace(MD.quote, ""));
        out.push(`<blockquote>${markdownToHtml(inner.join("\n"))}</blockquote>`);
        continue;
      }

      const ordered = MD.ol.test(line);
      if (ordered || MD.ul.test(line)) {
        const re = ordered ? MD.ol : MD.ul;
        const start = ordered ? Number(line.match(MD.ol)[1]) : 1;
        const items = [];
        while (i < lines.length && re.test(lines[i])) {
          const m = lines[i++].match(re);
          const parts = [mdInline(ordered ? m[2] : m[1])];
          while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i])) parts.push(mdInline(lines[i++].trim()));
          items.push(`<li>${parts.join("<br>")}</li>`);
        }
        const tag = ordered ? "ol" : "ul";
        const startAttr = ordered && start !== 1 ? ` start="${start}"` : "";
        out.push(`<${tag}${startAttr}>${items.join("")}</${tag}>`);
        continue;
      }

      const para = [];
      while (i < lines.length && lines[i].trim() && !(para.length && isBlockStart(lines[i]))) {
        para.push(mdInline(lines[i++]));
      }
      out.push(`<p>${para.join("<br>")}</p>`);
    }

    return out.join("");
  }

  function renderPlain(field) {
    copySafe(field.input, field.preview);
    if (!field.preview.textContent.trim()) field.preview.replaceChildren();
    if (!field.input.textContent.trim()) field.input.replaceChildren();
  }

  function renderBody() {
    el.bodyPreview.innerHTML = markdownToHtml(el.bodyInput.value);
  }

  function renderFontSize(field) {
    field.preview.style.fontSize = readNumber(field.size, MIN_FONT_SIZE, MIN_FONT_SIZE) + "px";
  }

  PLAIN_FIELDS.forEach((field) => {
    field.input.addEventListener("input", () => renderPlain(field));
    field.size.addEventListener("input", () => renderFontSize(field));

    field.input.addEventListener("paste", (e) => {
      e.preventDefault();
      const text = e.clipboardData.getData("text/plain");
      document.execCommand("insertText", false, text);
    });
  });

  el.bodyInput.addEventListener("input", renderBody);
  el.bodySize.addEventListener("input", () => renderFontSize(BODY_FIELD));

  const NOONNU = "https://cdn.jsdelivr.net/gh/projectnoonnu/";
  const FONT_LIBRARY = [
    {
      family: "Pretendard",
      name: "프리텐다드",
      base: NOONNU + "pretendard@1.0/Pretendard-",
      files: { 100: "Thin", 200: "ExtraLight", 300: "Light", 400: "Regular", 500: "Medium",
               600: "SemiBold", 700: "Bold", 800: "ExtraBold", 900: "Black" },
    },
    {
      family: "Paperozi",
      name: "페이퍼로지",
      base: NOONNU + "2408-3@1.0/Paperlogy-",
      files: { 100: "1Thin", 200: "2ExtraLight", 300: "3Light", 400: "4Regular", 500: "5Medium",
               600: "6SemiBold", 700: "7Bold", 800: "8ExtraBold", 900: "9Black" },
    },
    {
      family: "JeonjuCraftMyungjo",
      name: "전주공예 명조",
      base: NOONNU + "noonfonts_2310@1.0/JeonjuCraftMj",
      files: { 300: "L", 700: "B" },
    },
    {
      family: "MiceMyungjo",
      name: "MICE 명조",
      base: NOONNU + "noonfonts_2206-01@1.0/",
      files: { 400: "MICEMyungjo" },
    },
  ];

  const FONT_FORMATS = { woff2: "woff2", woff: "woff", ttf: "truetype", otf: "opentype" };

  const faceStyle = document.createElement("style");
  faceStyle.id = "font-faces";
  document.head.append(faceStyle);

  function renderFontFaces() {
    const face = (family, src, format, weight) => `@font-face {
  font-family: '${family}';
  src: url('${src}') format('${format}');
  font-weight: ${weight};
  font-display: swap;
}`;
    const lib = FONT_LIBRARY.flatMap((f) =>
      Object.entries(f.files).map(([weight, file]) => face(f.family, `${f.base}${file}.woff2`, "woff2", weight)));
    const uploads = state.fontUploads.map((u) => face(u.family, u.src, u.format, 400));
    faceStyle.textContent = [...lib, ...uploads].join("\n");
  }

  function resolveFont(value) {
    if (value.startsWith("up:")) {
      const u = state.fontUploads[Number(value.slice(3))];
      if (u) return { family: u.family, weight: 400 };
    }
    const [, family, weight] = value.split(":");
    return { family, weight: Number(weight) };
  }

  function renderFontSelects() {
    const groups = FONT_LIBRARY.map((f) => {
      const options = Object.keys(f.files)
        .map((w) => `<option value="lib:${f.family}:${w}">${f.name} ${w}</option>`).join("");
      return `<optgroup label="${f.name}">${options}</optgroup>`;
    });
    if (state.fontUploads.length) {
      const options = state.fontUploads
        .map((u, i) => `<option value="up:${i}">${escapeHtml(u.label)}</option>`).join("");
      groups.push(`<optgroup label="올린 글꼴">${options}</optgroup>`);
    }
    const current = el.font.value || INITIAL_FONT;
    el.font.innerHTML = groups.join("");
    el.font.value = current;
  }

  function applyFonts() {
    const { family, weight } = resolveFont(el.font.value);
    el.inner.style.fontFamily = `'${family}', serif`;
    el.titlePreview.style.fontWeight = Math.max(700, weight);
    el.subtitlePreview.style.fontWeight = weight;
    el.bodyPreview.style.fontWeight = weight;
  }

  const readDataUrl = (file) => new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => resolve(null);
    r.readAsDataURL(file);
  });

  async function loadFonts(files) {
    const results = await Promise.all(files.map(async (file) => {
      const ext = (file.name.split(".").pop() || "").toLowerCase();
      const format = FONT_FORMATS[ext];
      const src = format ? await readDataUrl(file) : null;
      return { file, format, src };
    }));

    const added = [];
    const failed = [];
    for (const { file, format, src } of results) {
      if (!src) { failed.push(file.name); continue; }
      const label = file.name.replace(/\.[^.]+$/, "");
      state.fontUploads.push({ label, family: `NovelogUpload${state.fontUploads.length}`, src, format });
      added.push(label);
    }

    renderFontFaces();
    renderFontSelects();
    applyFonts();

    el.dropFont.classList.toggle("is-error", !added.length);
    el.dropFont.classList.toggle("is-loaded", added.length > 0);
    if (!added.length) {
      el.mainFont.textContent = "글꼴 파일 업로드";
      el.metaFont.textContent = `읽지 못했습니다: ${failed.join(", ")}`;
    } else {
      el.mainFont.textContent = added.join(", ");
      el.metaFont.textContent = `올린 글꼴 ${state.fontUploads.length}개 · 선택칸 맨 아래 "올린 글꼴"에서 고르세요`
        + (failed.length ? ` · 실패: ${failed.join(", ")}` : "");
    }
  }

  el.font.addEventListener("change", applyFonts);

  function showImageError(file, message) {
    el.dropImg.classList.remove("is-loaded");
    el.dropImg.classList.add("is-error");
    el.mainImg.textContent = file.name;
    el.metaImg.textContent = message;
  }

  function setImage(file) {
    if (!file.type.startsWith("image/")) {
      showImageError(file, "이미지 파일이 아닙니다.");
      return;
    }

    const url = URL.createObjectURL(file);
    const probe = new Image();
    probe.onload = () => {
      if (state.imageUrl) URL.revokeObjectURL(state.imageUrl);
      state.imageUrl = url;
      state.imageSize = { w: probe.naturalWidth, h: probe.naturalHeight };

      el.imgInner.style.backgroundImage = `url("${url}")`;
      el.imgArea.hidden = false;
      el.imgRemove.disabled = false;
      el.imgReset.disabled = false;
      el.imgWidth.disabled = false;
      setImagePos(50, 50);

      el.dropImg.classList.remove("is-error");
      el.dropImg.classList.add("is-loaded");
      el.mainImg.textContent = file.name;
      el.metaImg.textContent = `${probe.naturalWidth} × ${probe.naturalHeight} px · 미리보기에서 끌어 위치 조절`;
    };
    probe.onerror = () => {
      URL.revokeObjectURL(url);
      showImageError(file, "이미지를 읽지 못했습니다.");
    };
    probe.src = url;
  }

  function removeImage() {
    if (state.imageUrl) URL.revokeObjectURL(state.imageUrl);
    state.imageUrl = null;
    state.imageSize = null;

    el.imgInner.style.backgroundImage = "";
    el.imgArea.hidden = true;
    el.imgRemove.disabled = true;
    el.imgReset.disabled = true;
    el.imgWidth.disabled = true;
    setImagePos(50, 50);

    el.dropImg.classList.remove("is-loaded", "is-error");
    el.mainImg.textContent = "이미지 파일";
    el.metaImg.textContent = IMG_META_DEFAULT;
  }

  function renderImageWidth() {
    const percent = el.imgWidth.value;
    el.imgWidthValue.textContent = percent + "%";
    el.imgArea.style.width = percent + "%";
  }

  function setImagePos(x, y) {
    state.imagePos = { x, y };
    el.imgInner.style.backgroundPosition = `${x}% ${y}%`;
  }

  function wireDrop(drop, input, onFiles) {
    input.addEventListener("change", () => {
      if (input.files.length) onFiles([...input.files]);
      input.value = "";
    });
    ["dragenter", "dragover"].forEach((t) =>
      drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add("is-over"); }));
    ["dragleave", "drop"].forEach((t) =>
      drop.addEventListener(t, () => drop.classList.remove("is-over")));
    drop.addEventListener("drop", (e) => {
      e.preventDefault();
      if (e.dataTransfer.files.length) onFiles([...e.dataTransfer.files]);
    });
  }

  wireDrop(el.dropImg, el.fileImg, (files) => setImage(files[0]));
  wireDrop(el.dropFont, el.fileFont, loadFonts);
  el.imgRemove.addEventListener("click", removeImage);
  el.imgReset.addEventListener("click", () => setImagePos(50, 50));
  el.imgWidth.addEventListener("input", renderImageWidth);

  function overflowOf() {
    const boxW = el.imgArea.offsetWidth;
    const boxH = el.imgArea.offsetHeight;
    const { w, h } = state.imageSize;
    const fit = Math.max(boxW / w, boxH / h);
    return { x: w * fit - boxW, y: h * fit - boxH };
  }

  el.imgArea.addEventListener("pointerdown", (e) => {
    if (!state.imageSize || e.button !== 0) return;
    e.preventDefault();
    el.imgArea.setPointerCapture(e.pointerId);
    el.imgArea.classList.add("is-dragging");
    state.drag = {
      id: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startPos: { ...state.imagePos },
      scale: el.canvas.clientWidth / canvasWidth(),
      overflow: overflowOf(),
    };
  });

  el.imgArea.addEventListener("pointermove", (e) => {
    const d = state.drag;
    if (!d || e.pointerId !== d.id) return;
    const dx = (e.clientX - d.startX) / d.scale;
    const dy = (e.clientY - d.startY) / d.scale;
    const x = d.overflow.x > 0.5 ? clamp(d.startPos.x - (dx / d.overflow.x) * 100, 0, 100) : 50;
    const y = d.overflow.y > 0.5 ? clamp(d.startPos.y - (dy / d.overflow.y) * 100, 0, 100) : 50;
    setImagePos(Math.round(x * 10) / 10, Math.round(y * 10) / 10);
  });

  const endDrag = (e) => {
    if (!state.drag || e.pointerId !== state.drag.id) return;
    state.drag = null;
    el.imgArea.classList.remove("is-dragging");
  };
  el.imgArea.addEventListener("pointerup", endDrag);
  el.imgArea.addEventListener("pointercancel", endDrag);

  function renderScale() {
    const w = canvasWidth();
    const scale = el.canvas.clientWidth / w;

    el.inner.style.width = w + "px";
    el.inner.style.minHeight = Math.round(w * LAYOUT.minHeight) + "px";
    el.textArea.style.padding = Math.round(w * LAYOUT.padding) + "px";
    el.textArea.style.gap = Math.round(w * LAYOUT.gap) + "px";
    el.inner.style.transform = `scale(${scale})`;

    const h = el.inner.offsetHeight;
    el.canvas.style.height = h * scale + "px";
    el.outSize.textContent = `PNG ${w} × ${h} px`;
  }

  const observer = new ResizeObserver(() => renderScale());
  observer.observe(el.canvas);
  observer.observe(el.inner);
  el.canvasWidth.addEventListener("input", renderScale);

  async function downloadPng() {
    if (state.busy) return;
    if (typeof html2canvas !== "function") {
      setStatus("이미지 변환 도구를 불러오지 못했습니다. 인터넷 연결을 확인한 뒤 새로고침해 주세요.", true);
      return;
    }

    state.busy = true;
    el.download.disabled = true;
    el.download.textContent = "이미지 만드는 중…";
    setStatus("이미지를 그리는 중입니다.");

    try {
      await document.fonts.ready;

      const w = canvasWidth();
      const h = el.inner.offsetHeight;
      const shot = await html2canvas(el.inner, {
        scale: 1,
        width: w,
        height: h,
        backgroundColor: "#fff",
        logging: false,
        onclone: (doc) => {
          const inner = doc.getElementById("canvas-inner");
          const box = doc.getElementById("canvas");
          inner.style.transform = "none";
          inner.style.height = h + "px";
          box.style.width = w + "px";
          box.style.height = h + "px";
        },
      });

      const blob = await new Promise((resolve) => shot.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("PNG 변환 실패");
      saveBlob(blob, `${fileNameFromTitle()}.png`);

      setStatus(`PNG를 저장했습니다 · ${shot.width} × ${shot.height} px`);
    } catch (err) {
      console.error(err);
      setStatus("이미지를 만들지 못했습니다. 콘솔(F12)을 확인해 주세요.", true);
    } finally {
      state.busy = false;
      el.download.disabled = false;
      el.download.textContent = "PNG 다운로드";
    }
  }

  el.download.addEventListener("click", downloadPng);

  renderFontFaces();
  renderFontSelects();
  applyFonts();
  PLAIN_FIELDS.forEach((field) => { renderPlain(field); renderFontSize(field); });
  renderBody();
  renderFontSize(BODY_FIELD);
  renderImageWidth();
  renderScale();

  const hasFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes("Files");
  window.addEventListener("dragover", (e) => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener("drop", (e) => { if (hasFiles(e)) e.preventDefault(); });
})();
