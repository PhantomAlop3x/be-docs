/* BeDocs app */
(() => {
  "use strict";

  const BLOCKS = "p,h1,h2,h3,h4,h5,h6,li,blockquote,div,pre";
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
  const mod = isMac ? "Cmd" : "Ctrl";

  const appEl = document.getElementById("app");
  const editor = document.getElementById("editor");
  const menubar = document.getElementById("menubar");
  const toolbar = document.getElementById("toolbar");
  const titleInput = document.getElementById("doc-title");
  const countStat = document.getElementById("stat-count");
  const saveStat = document.getElementById("stat-save");
  const blockSelect = document.getElementById("block-style");
  const spacingSelect = document.getElementById("line-spacing");

  let dirty = false;
  let fileHandle = null;

  function markDirty() {
    dirty = true;
    saveStat.textContent = "Unsaved changes";
  }

  function setClean(label) {
    dirty = false;
    saveStat.textContent = label || "";
  }

  /* ---------- Icons ---------- */

  const ICONS = {
    undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
    redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h3"/>',
    alignLeft: '<path d="M4 6h16M4 10h10M4 14h16M4 18h10"/>',
    alignCenter: '<path d="M4 6h16M7 10h10M4 14h16M7 18h10"/>',
    alignRight: '<path d="M4 6h16M10 10h10M4 14h16M10 18h10"/>',
    alignJustify: '<path d="M4 6h16M4 10h16M4 14h16M4 18h16"/>',
    ul: '<path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/>',
    ol:
      '<path d="M10 6h10M10 12h10M10 18h10"/>' +
      '<g fill="currentColor" stroke="none" font-family="sans-serif" font-size="7" font-weight="600">' +
      '<text x="2" y="8.5">1</text><text x="2" y="14.5">2</text><text x="2" y="20.5">3</text></g>',
    hr: '<path d="M8 6h8M3 12h18M8 18h8"/>',
    clear: '<path d="M6 5h12M12 5v14M4 20 20 4"/>',
    outline: '<path d="M4 6h16M8 12h12M12 18h8"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    chevron: '<path d="m9 6 6 6-6 6"/>',
    image:
      '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.5"/><path d="m21 16-5-5L5 20"/>',
    video: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 11 5-3v8l-5-3z"/>',
    layoutInline: '<path d="M3 5h18M3 19h18"/><rect x="8" y="9" width="8" height="6" rx="1"/>',
    layoutLeft: '<rect x="3" y="5" width="7" height="7" rx="1"/><path d="M13 6h8M13 10h8M3 16h18M3 20h18"/>',
    layoutRight: '<rect x="14" y="5" width="7" height="7" rx="1"/><path d="M3 6h8M3 10h8M3 16h18M3 20h18"/>',
    layoutBehind:
      '<rect x="7" y="5" width="10" height="14" rx="1" stroke-dasharray="2.5 2.5"/><path d="M3 9h18M3 12h18M3 15h18"/>',
    layoutFront:
      '<path d="M3 9h18M3 15h18"/><rect x="7" y="5" width="10" height="14" rx="1" style="fill: var(--chrome)"/>',
    trash: '<path d="M4 7h16M10 7V4h4v3M6 7l1 13h10l1-13"/>',
  };

  function svg(name, size = 18) {
    return (
      '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size + '" fill="none" stroke="currentColor" ' +
      'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      ICONS[name] +
      "</svg>"
    );
  }

  document.querySelectorAll("[data-icon]").forEach((btn) => {
    btn.innerHTML = svg(btn.dataset.icon);
  });

  /* ---------- Selection helpers ---------- */

  let savedRange = null;

  document.addEventListener("selectionchange", () => {
    const sel = document.getSelection();
    if (sel.rangeCount && editor.contains(sel.anchorNode)) {
      savedRange = sel.getRangeAt(0).cloneRange();
      refreshToolbar();
      setActiveFromCaret(sel.anchorNode);
      updateMediaSelection(savedRange);
    }
  });

  function focusEditor() {
    editor.focus({ preventScroll: true });
    if (savedRange) {
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(savedRange);
    }
  }

  function getBlock(node) {
    let n = node && (node.nodeType === 1 ? node : node.parentElement);
    while (n && n !== editor) {
      if (n.matches && n.matches(BLOCKS)) return n;
      n = n.parentElement;
    }
    return null;
  }

  function touchesBlock(range, el) {
    if (!range.intersectsNode(el)) return false;
    // A selection that ends at the very start of a block (for example after a
    // triple click) should not include that next block.
    if (
      !range.collapsed &&
      range.endOffset === 0 &&
      (range.endContainer === el || el.contains(range.endContainer)) &&
      !el.contains(range.startContainer)
    ) {
      return false;
    }
    return true;
  }

  function selectedBlocks() {
    const sel = window.getSelection();
    if (!sel.rangeCount) return [];
    const range = sel.getRangeAt(0);
    const found = [...editor.querySelectorAll(BLOCKS)].filter((el) => touchesBlock(range, el));
    if (found.length === 0) {
      const b = getBlock(range.startContainer);
      return b ? [b] : [];
    }
    // Skip wrappers that contain other matched blocks
    return found.filter((el) => !found.some((o) => o !== el && el.contains(o)));
  }

  /* ---------- Editor commands ---------- */

  function afterChange() {
    markDirty();
    updateStatus();
    refreshToolbar();
    queueOutline();
    refreshObjectUI();
  }

  function exec(cmd, value = null) {
    focusEditor();
    document.execCommand(cmd, false, value);
    afterChange();
  }

  function setBlock(kind) {
    // Title is a Heading 1 element with a "title" class
    const tag = kind === "title" ? "h1" : kind;
    exec("formatBlock", "<" + tag + ">");
    selectedBlocks().forEach((b) => b.classList.toggle("title", kind === "title"));
    refreshToolbar();
    queueOutline();
  }

  function setBlockStyle(prop, value) {
    focusEditor();
    selectedBlocks().forEach((b) => {
      b.style[prop] = value;
    });
    afterChange();
  }

  function insertHr() {
    focusEditor();
    document.execCommand("insertHorizontalRule");
    const last = editor.lastElementChild;
    if (last && last.tagName === "HR") {
      const p = document.createElement("p");
      p.innerHTML = "<br>";
      editor.appendChild(p);
    }
    afterChange();
  }

  async function pastePlain() {
    try {
      const text = await navigator.clipboard.readText();
      focusEditor();
      document.execCommand("insertText", false, text);
      afterChange();
    } catch (err) {
      focusEditor();
      alert("Your browser blocked clipboard access. Use " + mod + "+V instead.");
    }
  }

  function hasContent() {
    return editor.innerText.trim().length > 0 || !!editor.querySelector("img,video,hr");
  }

  /* ---------- Files: new, open, save ---------- */

  const FILE_TYPES = [
    { description: "BeDocs document", accept: { "application/json": [".bdoc"] } },
  ];

  const ALLOWED_TAGS = new Set([
    "P", "BR", "H1", "H2", "H3", "H4", "H5", "H6", "STRONG", "B", "EM", "I", "U", "S", "STRIKE", "DEL",
    "SUB", "SUP", "UL", "OL", "LI", "BLOCKQUOTE", "HR", "DIV", "SPAN", "PRE", "CODE", "A", "IMG", "VIDEO", "SOURCE",
  ]);
  const DROP_TAGS = new Set([
    "SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "LINK", "META", "BASE", "FORM", "INPUT", "BUTTON",
    "TEXTAREA", "SELECT", "SVG", "MATH", "TEMPLATE", "NOSCRIPT",
  ]);
  const TAG_ATTRS = {
    A: ["href", "title"],
    IMG: ["src", "alt", "width", "height", "data-layout"],
    VIDEO: ["src", "controls", "width", "height", "loop", "muted", "preload", "playsinline", "data-layout"],
    SOURCE: ["src", "type"],
  };
  const ALLOWED_STYLES = new Set([
    "text-align", "line-height", "margin-top", "margin-bottom", "color", "background-color",
    "font-size", "font-family", "font-weight", "font-style", "text-decoration",
  ]);

  const LAYOUT_VALUES = new Set(["wrap-left", "wrap-right", "behind", "front"]);

  // Images and video only keep a pixel width and the two position variables from their style
  function cleanMediaStyle(text) {
    const out = [];
    const w = /(?:^|;)\s*width\s*:\s*(\d+(?:\.\d+)?)px\s*(?=;|$)/i.exec(text);
    if (w && +w[1] >= 1 && +w[1] <= 5000) out.push("width: " + w[1] + "px");
    ["x", "y"].forEach((axis) => {
      const m = new RegExp("(?:^|;)\\s*--" + axis + "\\s*:\\s*(-?\\d+(?:\\.\\d+)?)px\\s*(?=;|$)", "i").exec(text);
      if (m && Math.abs(+m[1]) <= 20000) out.push("--" + axis + ": " + m[1] + "px");
    });
    return out.join("; ");
  }

  function isSafeUrl(name, value) {
    const v = value.trim();
    if (name === "href") return /^(https?:|mailto:|#)/i.test(v);
    return /^(https?:|data:(image|video)\/)/i.test(v);
  }

  // A .bdoc file is untrusted input, so only known-safe tags and attributes are loaded
  function cleanNode(node) {
    [...node.childNodes].forEach((child) => {
      if (child.nodeType === 3) return;
      if (child.nodeType !== 1) {
        child.remove();
        return;
      }
      const tag = child.tagName;
      if (DROP_TAGS.has(tag)) {
        child.remove();
        return;
      }
      cleanNode(child);
      if (!ALLOWED_TAGS.has(tag)) {
        child.replaceWith(...child.childNodes);
        return;
      }
      [...child.attributes].forEach((a) => {
        const name = a.name.toLowerCase();
        if (name === "style" && (tag === "IMG" || tag === "VIDEO")) {
          const cleaned = cleanMediaStyle(a.value);
          if (cleaned) child.setAttribute("style", cleaned);
          else child.removeAttribute("style");
        } else if (name === "style") {
          const kept = [];
          for (const prop of child.style) {
            const val = child.style.getPropertyValue(prop);
            if (ALLOWED_STYLES.has(prop) && !/url\(|expression|javascript:/i.test(val)) {
              kept.push(prop + ": " + val);
            }
          }
          if (kept.length) child.setAttribute("style", kept.join("; "));
          else child.removeAttribute("style");
        } else if (name === "class") {
          if (!(tag === "H1" && a.value === "title")) child.removeAttribute("class");
        } else if ((TAG_ATTRS[tag] || []).includes(name)) {
          if ((name === "src" || name === "href") && !isSafeUrl(name, a.value)) child.removeAttribute(a.name);
          if (name === "data-layout" && !LAYOUT_VALUES.has(a.value)) child.removeAttribute(a.name);
        } else {
          child.removeAttribute(a.name);
        }
      });
      if (tag === "A" && child.hasAttribute("href")) {
        child.setAttribute("target", "_blank");
        child.setAttribute("rel", "noopener noreferrer");
      }
    });
  }

  function sanitizeHtml(html) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    cleanNode(doc.body);
    return doc.body.innerHTML;
  }

  function currentTitle() {
    return titleInput.value.trim() || "Untitled document";
  }

  function baseName(fileName) {
    return fileName.replace(/\.bdoc$/i, "").trim() || "Untitled document";
  }

  function safeFileName(title) {
    return title.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim() || "Untitled document";
  }

  function cleanContentHtml() {
    const clone = editor.cloneNode(true);
    clone.querySelectorAll(".media-selected").forEach((n) => {
      n.classList.remove("media-selected");
      if (!n.getAttribute("class")) n.removeAttribute("class");
    });
    return clone.innerHTML;
  }

  function serialize() {
    return JSON.stringify(
      {
        format: "bedocs",
        version: 1,
        title: currentTitle(),
        modified: new Date().toISOString(),
        content: cleanContentHtml(),
      },
      null,
      2
    );
  }

  function loadDocument(text, fileName, handle) {
    let data = null;
    try {
      data = JSON.parse(text);
    } catch (err) {
      data = null;
    }
    if (!data || data.format !== "bedocs" || typeof data.content !== "string") {
      alert("This file could not be opened because it is not a valid .bdoc file.");
      return false;
    }

    editor.innerHTML = sanitizeHtml(data.content);
    if (!editor.firstChild) editor.innerHTML = "<p><br></p>";
    titleInput.value =
      typeof data.title === "string" && data.title.trim() ? data.title.trim() : baseName(fileName);
    syncTitle();

    fileHandle = handle || null;
    savedRange = null;
    activeHeading = null;
    canvas.scrollTop = 0;
    setClean("Saved");
    focusEditor();
    updateStatus();
    refreshToolbar();
    renderOutline();
    return true;
  }

  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = ".bdoc,application/json";
  fileInput.hidden = true;
  document.body.appendChild(fileInput);

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files && fileInput.files[0];
    fileInput.value = "";
    if (!file) return;
    try {
      loadDocument(await file.text(), file.name, null);
    } catch (err) {
      alert("The file could not be read.");
    }
  });

  async function openFile() {
    if (dirty && hasContent() && !confirm("You have unsaved changes. Open another file and discard them?")) {
      return;
    }
    if (!window.showOpenFilePicker) {
      fileInput.click();
      return;
    }
    try {
      const [handle] = await window.showOpenFilePicker({ types: FILE_TYPES, multiple: false });
      const file = await handle.getFile();
      loadDocument(await file.text(), file.name, handle);
    } catch (err) {
      if (err && err.name === "AbortError") return;
      alert("The file could not be opened.");
    }
  }

  function downloadFile() {
    const blob = new Blob([serialize()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = safeFileName(currentTitle()) + ".bdoc";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function saveFile(forceAs = false) {
    // Browsers without the file picker API download a copy instead
    if (!window.showSaveFilePicker) {
      downloadFile();
      setClean("Saved");
      return;
    }
    try {
      let handle = forceAs ? null : fileHandle;
      if (!handle) {
        handle = await window.showSaveFilePicker({
          suggestedName: safeFileName(currentTitle()) + ".bdoc",
          types: FILE_TYPES,
        });
        titleInput.value = baseName(handle.name);
        syncTitle();
      }
      const writable = await handle.createWritable();
      await writable.write(serialize());
      await writable.close();
      fileHandle = handle;
      setClean("Saved");
    } catch (err) {
      if (err && err.name === "AbortError") return;
      fileHandle = null;
      alert("The file could not be saved. Try File > Save as to pick a new location.");
    }
  }

  // New documents open in a new tab so the current one is never lost
  function newDoc() {
    const url = window.location.href.split("#")[0].split("?")[0];
    const w = window.open(url, "_blank");
    if (!w) alert("Your browser blocked the new tab. Allow pop-ups for this site and try again.");
  }

  /* ---------- Images and video ---------- */

  const MAX_IMAGE_SIDE = 2000;
  const WARN_BYTES = 10 * 1024 * 1024;
  const MAX_VIDEO_BYTES = 80 * 1024 * 1024;

  function mb(bytes) {
    const n = bytes / (1024 * 1024);
    return n < 10 ? n.toFixed(1) : String(Math.round(n));
  }

  function readAsDataURL(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  // Photos and screenshots larger than MAX_IMAGE_SIDE are scaled down to keep files small.
  // GIF, SVG and other formats are embedded untouched so animation and vectors survive.
  async function prepareImage(file) {
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return readAsDataURL(file);
    let bitmap;
    try {
      bitmap = await createImageBitmap(file);
    } catch (err) {
      return readAsDataURL(file);
    }
    const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height));
    if (scale === 1) {
      bitmap.close();
      return readAsDataURL(file);
    }
    const cv = document.createElement("canvas");
    cv.width = Math.round(bitmap.width * scale);
    cv.height = Math.round(bitmap.height * scale);
    cv.getContext("2d").drawImage(bitmap, 0, 0, cv.width, cv.height);
    bitmap.close();
    return cv.toDataURL(file.type, 0.88);
  }

  function confirmLarge(bytes, what) {
    return confirm(
      "This " + what + " is about " + mb(bytes) + " MB. It will be stored inside your .bdoc file, " +
        "making the file large and slower to open. Insert it anyway?"
    );
  }

  function escapeAttr(text) {
    return text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function insertHtml(html) {
    focusEditor();
    if (!document.execCommand("insertHTML", false, html)) {
      const sel = window.getSelection();
      if (sel.rangeCount) {
        const range = sel.getRangeAt(0);
        range.deleteContents();
        const tpl = document.createElement("template");
        tpl.innerHTML = html;
        const last = tpl.content.lastChild;
        range.insertNode(tpl.content);
        if (last) {
          range.setStartAfter(last);
          range.collapse(true);
          sel.removeAllRanges();
          sel.addRange(range);
        }
      }
    }
    afterChange();
  }

  const DEFAULT_MEDIA_WIDTH = 480;

  const LAYOUTS = [
    { id: "inline", label: "In line with text", icon: "layoutInline" },
    { id: "wrap-left", label: "Wrap text around, object on the left", icon: "layoutLeft" },
    { id: "wrap-right", label: "Wrap text around, object on the right", icon: "layoutRight" },
    { id: "behind", label: "Behind text, free position", icon: "layoutBehind" },
    { id: "front", label: "In front of text, free position", icon: "layoutFront" },
  ];

  const SIZE_PRESETS = [
    ["25% of width", 0.25],
    ["50% of width", 0.5],
    ["75% of width", 0.75],
    ["Full width", 1],
    ["Original size", "original"],
  ];

  let selectedMedia = null;

  // Changes the browser's own undo history does not know about (inserted video, image layout,
  // size and position). They can be undone one by one until the next time the user types.
  const undoStack = [];

  function topLevelBlock(node) {
    let n = node && (node.nodeType === 1 ? node : node.parentNode);
    if (!n || n === editor || !editor.contains(n)) return null;
    while (n.parentNode !== editor) n = n.parentNode;
    return n;
  }

  // A video gets its own paragraph below the current one, with an empty paragraph after it for typing
  function insertVideoBlock(src) {
    focusEditor();
    const sel = window.getSelection();
    const prior = sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
    const block = prior ? topLevelBlock(prior.startContainer) : null;

    const holder = document.createElement("p");
    holder.innerHTML =
      '<video src="' + src + '" controls preload="metadata" playsinline style="width: ' +
      DEFAULT_MEDIA_WIDTH + 'px"></video>';

    let caretBlock;
    let nodes;
    if (block && block.tagName === "P" && !block.textContent.trim() && !block.querySelector("img,video,hr")) {
      block.before(holder);
      caretBlock = block;
      nodes = [holder];
    } else {
      caretBlock = document.createElement("p");
      caretBlock.innerHTML = "<br>";
      if (block) block.after(holder, caretBlock);
      else editor.append(holder, caretBlock);
      nodes = [holder, caretBlock];
    }

    const r = document.createRange();
    r.setStart(caretBlock, 0);
    r.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r);
    holder.scrollIntoView({ block: "nearest" });

    undoStack.push(() => {
      if (!nodes[0].isConnected) return false;
      nodes.forEach((n) => n.remove());
      ensureContent();
      if (prior && editor.contains(prior.startContainer)) {
        const s = window.getSelection();
        s.removeAllRanges();
        s.addRange(prior);
      }
      return true;
    });
    afterChange();
  }

  function undoSpecial() {
    while (undoStack.length) {
      const undo = undoStack.pop();
      if (undo()) {
        afterChange();
        return true;
      }
    }
    return false;
  }

  editor.addEventListener("beforeinput", (e) => {
    if (e.inputType === "historyUndo" && undoSpecial()) e.preventDefault();
  });

  function imageSize(src) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
      img.onerror = () => resolve({ w: 0, h: 0 });
      img.src = src;
    });
  }

  async function insertMedia(file) {
    const isImage = file.type.startsWith("image/");
    const isVideo = file.type.startsWith("video/");
    if (!isImage && !isVideo) {
      alert(file.name + " is not an image or video file.");
      return;
    }

    let src;
    if (isVideo) {
      if (file.size > MAX_VIDEO_BYTES) {
        alert(
          "This video is " + mb(file.size) + " MB, which is too large to embed. " +
            "Try a shorter or more compressed clip."
        );
        return;
      }
      if (file.size > WARN_BYTES && !confirmLarge(file.size, "video")) return;
      src = await readAsDataURL(file);
    } else {
      src = await prepareImage(file);
      const bytes = Math.round(src.length * 0.75);
      if (bytes > WARN_BYTES && !confirmLarge(bytes, "image")) return;
    }

    if (isVideo) {
      insertVideoBlock(src);
    } else {
      const label = escapeAttr(file.name.replace(/\.[^.]+$/, ""));
      const size = await imageSize(src);
      const width = Math.min(size.w || DEFAULT_MEDIA_WIDTH, DEFAULT_MEDIA_WIDTH);
      insertHtml('<img src="' + src + '" alt="' + label + '" style="width: ' + width + 'px">');
    }
  }

  async function insertFiles(files) {
    for (const file of files) {
      try {
        await insertMedia(file);
      } catch (err) {
        alert("Could not insert " + file.name + ".");
      }
    }
  }

  function makePicker(accept, multiple) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.multiple = multiple;
    input.hidden = true;
    document.body.appendChild(input);
    input.addEventListener("change", () => {
      const files = [...input.files];
      input.value = "";
      if (files.length) insertFiles(files);
    });
    return input;
  }

  const imageInput = makePicker("image/*", true);
  const videoInput = makePicker("video/*", false);

  // Track the image or video that is currently selected
  function updateMediaSelection(range) {
    let found = null;
    if (range && !range.collapsed && range.startContainer === range.endContainer && range.endOffset - range.startOffset === 1) {
      const node = range.startContainer.childNodes[range.startOffset];
      if (node && node.nodeType === 1 && (node.tagName === "IMG" || node.tagName === "VIDEO")) found = node;
    }
    editor.querySelectorAll(".media-selected").forEach((n) => {
      if (n !== found) n.classList.remove("media-selected");
    });
    if (found) found.classList.add("media-selected");
    selectedMedia = found;
    refreshObjectUI();
  }

  function selectMedia(m) {
    const r = document.createRange();
    r.selectNode(m);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
    savedRange = r.cloneRange();
    updateMediaSelection(r);
  }

  const isMedia = (n) => n && (n.tagName === "IMG" || n.tagName === "VIDEO");

  // Objects set to "behind text" sit under the text, so Ctrl/Cmd + click picks them
  function behindMediaAt(x, y) {
    return [...editor.querySelectorAll('[data-layout="behind"]')].reverse().find((m) => {
      const r = m.getBoundingClientRect();
      return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    });
  }

  // Clicking an image or video selects it, so it can be moved, resized, deleted or aligned
  editor.addEventListener("click", (e) => {
    let t = e.target;
    if ((e.ctrlKey || e.metaKey) && !isMedia(t)) {
      const hit = behindMediaAt(e.clientX, e.clientY);
      if (hit) t = hit;
    }
    if (!isMedia(t)) return;
    // Leave the bottom strip of a video alone so its play controls keep working
    if (t.tagName === "VIDEO" && t.getBoundingClientRect().bottom - e.clientY < 44) return;
    selectMedia(t);
    e.preventDefault();
  });

  function mediaFilesFrom(dataTransfer) {
    return [...(dataTransfer ? dataTransfer.files : [])].filter((f) => /^(image|video)\//.test(f.type));
  }

  function hasFiles(dataTransfer) {
    return !!dataTransfer && [...dataTransfer.types].includes("Files");
  }

  function rangeFromPoint(x, y) {
    if (document.caretRangeFromPoint) return document.caretRangeFromPoint(x, y);
    if (document.caretPositionFromPoint) {
      const pos = document.caretPositionFromPoint(x, y);
      if (pos) {
        const r = document.createRange();
        r.setStart(pos.offsetNode, pos.offset);
        r.collapse(true);
        return r;
      }
    }
    return null;
  }

  // Pasting a copied image or screenshot inserts it (text pastes are left alone)
  editor.addEventListener("paste", (e) => {
    const files = mediaFilesFrom(e.clipboardData);
    if (!files.length || e.clipboardData.getData("text/plain").trim()) return;
    e.preventDefault();
    insertFiles(files);
  });

  // Dropping files onto the page inserts images and video at the drop point.
  // Other dropped files are blocked so the browser never navigates away from unsaved work.
  document.addEventListener("dragover", (e) => {
    if (hasFiles(e.dataTransfer)) e.preventDefault();
  });

  document.addEventListener("drop", (e) => {
    if (!hasFiles(e.dataTransfer)) return;
    e.preventDefault();
    if (!editor.contains(e.target)) return;
    const files = mediaFilesFrom(e.dataTransfer);
    if (!files.length) {
      alert("Only image and video files can be dropped into a document.");
      return;
    }
    const r = rangeFromPoint(e.clientX, e.clientY);
    if (r && editor.contains(r.startContainer)) savedRange = r;
    insertFiles(files);
  });

  function ensureContent() {
    if (!editor.firstChild || editor.innerHTML === "<br>") {
      editor.innerHTML = "<p><br></p>";
      const r = document.createRange();
      r.setStart(editor.firstChild, 0);
      r.collapse(true);
      const s = window.getSelection();
      s.removeAllRanges();
      s.addRange(r);
    }
  }

  // A selected image or video does not respond to the browser's justify commands,
  // so its paragraph is aligned directly
  function align(cmd, value) {
    if (editor.querySelector(".media-selected")) setBlockStyle("textAlign", value);
    else exec(cmd);
  }

  const run = {
    undo: () => {
      focusEditor();
      if (!undoSpecial()) exec("undo");
    },
    redo: () => exec("redo"),
    cut: () => exec("cut"),
    copy: () => exec("copy"),
    pastePlain,
    selectAll: () => exec("selectAll"),
    bold: () => exec("bold"),
    italic: () => exec("italic"),
    underline: () => exec("underline"),
    strike: () => exec("strikeThrough"),
    clear: () => exec("removeFormat"),
    alignLeft: () => align("justifyLeft", "left"),
    alignCenter: () => align("justifyCenter", "center"),
    alignRight: () => align("justifyRight", "right"),
    alignJustify: () => align("justifyFull", "justify"),
    ul: () => exec("insertUnorderedList"),
    ol: () => exec("insertOrderedList"),
    hr: insertHr,
    newDoc,
    open: openFile,
    insertImage: () => imageInput.click(),
    insertVideo: () => videoInput.click(),
    save: () => saveFile(false),
    saveAs: () => saveFile(true),
    print: () => window.print(),
    toggleOutline: () => setOutlineHidden(!isOutlineHidden()),
  };

  /* ---------- Toolbar ---------- */

  toolbar.addEventListener("mousedown", (e) => {
    // Keep the text selection when clicking buttons (selects need to take focus)
    if (e.target.closest("button")) e.preventDefault();
  });

  toolbar.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (btn && run[btn.dataset.action]) run[btn.dataset.action]();
  });

  blockSelect.addEventListener("change", () => setBlock(blockSelect.value));
  spacingSelect.addEventListener("change", () => setBlockStyle("lineHeight", spacingSelect.value));

  const TOGGLE_STATES = {
    bold: "bold",
    italic: "italic",
    underline: "underline",
    strike: "strikeThrough",
    ul: "insertUnorderedList",
    ol: "insertOrderedList",
    alignLeft: "justifyLeft",
    alignCenter: "justifyCenter",
    alignRight: "justifyRight",
    alignJustify: "justifyFull",
  };

  function refreshToolbar() {
    toolbar.querySelectorAll("[data-action]").forEach((btn) => {
      const cmd = TOGGLE_STATES[btn.dataset.action];
      if (!cmd) return;
      let on = false;
      try {
        on = document.queryCommandState(cmd);
      } catch (err) {
        on = false;
      }
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-pressed", String(on));
    });

    const sel = window.getSelection();
    const block = sel.rangeCount ? getBlock(sel.anchorNode) : null;
    if (!block) return;

    const tag = block.tagName.toLowerCase();
    const isTitle = tag === "h1" && block.classList.contains("title");
    blockSelect.value = isTitle ? "title" : ["h1", "h2", "h3"].includes(tag) ? tag : "p";

    const cs = getComputedStyle(block);
    const ratio = parseFloat(cs.lineHeight) / parseFloat(cs.fontSize);
    const match = [...spacingSelect.options].find((o) => Math.abs(parseFloat(o.value) - ratio) < 0.02);
    spacingSelect.value = match ? match.value : "";
  }

  /* ---------- Menus ---------- */

  const sep = { type: "sep" };
  const head = (label) => ({ type: "heading", label });
  const item = (label, fn, note) => ({ label, run: fn, note });

  const menuDefs = [
    {
      label: "File",
      items: [
        item("New", run.newDoc, "Opens in new tab"),
        sep,
        item("Open...", run.open, mod + "+O"),
        item("Save", run.save, mod + "+S"),
        item("Save as...", run.saveAs, mod + "+Shift+S"),
        sep,
        item("Print", run.print, mod + "+P"),
      ],
    },
    {
      label: "Edit",
      items: [
        item("Undo", run.undo, mod + "+Z"),
        item("Redo", run.redo, mod + "+Shift+Z"),
        sep,
        item("Cut", run.cut, mod + "+X"),
        item("Copy", run.copy, mod + "+C"),
        item("Paste as plain text", run.pastePlain),
        sep,
        item("Select all", run.selectAll, mod + "+A"),
      ],
    },
    {
      label: "View",
      items: [
        item(() => (isOutlineHidden() ? "Show outline" : "Hide outline"), run.toggleOutline),
      ],
    },
    {
      label: "Insert",
      items: [item("Horizontal line", run.hr), sep, item("Image...", run.insertImage), item("Video...", run.insertVideo)],
    },
    {
      label: "Format",
      items: [
        item("Bold", run.bold, mod + "+B"),
        item("Italic", run.italic, mod + "+I"),
        item("Underline", run.underline, mod + "+U"),
        item("Strikethrough", run.strike),
        sep,
        item("Clear formatting", run.clear),
        sep,
        head("Image and video layout"),
        ...LAYOUTS.map((L) => ({
          label: L.label,
          run: () => selectedMedia && setLayout(selectedMedia, L.id),
          enabled: () => !!selectedMedia,
        })),
        sep,
        head("Image and video size"),
        ...SIZE_PRESETS.map(([label, value]) => ({
          label,
          run: () => selectedMedia && applySizePreset(selectedMedia, value),
          enabled: () => !!selectedMedia,
        })),
      ],
    },
    {
      label: "Paragraph",
      items: [
        head("Style"),
        item("Normal text", () => setBlock("p")),
        item("Title", () => setBlock("title")),
        item("Heading 1", () => setBlock("h1")),
        item("Heading 2", () => setBlock("h2")),
        item("Heading 3", () => setBlock("h3")),
        sep,
        head("Alignment"),
        item("Left", run.alignLeft),
        item("Center", run.alignCenter),
        item("Right", run.alignRight),
        item("Justified", run.alignJustify),
        sep,
        head("Lists"),
        item("Bulleted list", run.ul),
        item("Numbered list", run.ol),
        sep,
        head("Line spacing"),
        item("1.0", () => setBlockStyle("lineHeight", "1")),
        item("1.15", () => setBlockStyle("lineHeight", "1.15")),
        item("1.5", () => setBlockStyle("lineHeight", "1.5")),
        item("2.0", () => setBlockStyle("lineHeight", "2")),
        sep,
        head("Space after paragraph"),
        item("None", () => setBlockStyle("marginBottom", "0")),
        item("Default", () => setBlockStyle("marginBottom", "")),
        item("Wide", () => setBlockStyle("marginBottom", "1.5em")),
      ],
    },
  ];

  const menus = [];
  let openIdx = -1;

  function el(tag, cls) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    return n;
  }

  function buildMenus() {
    menuDefs.forEach((def, i) => {
      const wrap = el("div", "menu");
      const btn = el("button", "menu-btn");
      btn.type = "button";
      btn.textContent = def.label;
      btn.setAttribute("aria-haspopup", "true");
      btn.setAttribute("aria-expanded", "false");

      const list = el("div", "menu-list");
      list.setAttribute("role", "menu");
      list.hidden = true;

      def.items.forEach((it) => {
        if (it.type === "sep") {
          const s = el("div", "menu-sep");
          s.setAttribute("role", "separator");
          list.appendChild(s);
          return;
        }
        if (it.type === "heading") {
          const h = el("div", "menu-heading");
          h.textContent = it.label;
          list.appendChild(h);
          return;
        }
        const b = el("button", "menu-item");
        b.type = "button";
        b.setAttribute("role", "menuitem");
        const label = el("span");
        label.textContent = typeof it.label === "function" ? it.label() : it.label;
        if (typeof it.label === "function") it.labelEl = label;
        b.appendChild(label);
        if (it.note) {
          const note = el("span", "menu-note");
          note.textContent = it.note;
          b.appendChild(note);
        }
        if (it.enabled) it.btnEl = b;
        if (it.disabled) {
          b.disabled = true;
        } else {
          b.addEventListener("mousedown", (e) => e.preventDefault());
          b.addEventListener("click", () => {
            closeMenus();
            it.run();
          });
        }
        list.appendChild(b);
      });

      btn.addEventListener("mousedown", (e) => e.preventDefault());
      btn.addEventListener("click", () => (openIdx === i ? closeMenus() : openMenu(i)));
      btn.addEventListener("mouseenter", () => {
        if (openIdx >= 0 && openIdx !== i) openMenu(i);
      });

      wrap.append(btn, list);
      menubar.appendChild(wrap);
      menus.push({ btn, list });
    });
  }

  function openMenu(i) {
    closeMenus();
    menuDefs[i].items.forEach((it) => {
      if (it.labelEl) it.labelEl.textContent = it.label();
      if (it.btnEl) it.btnEl.disabled = !it.enabled();
    });
    menus[i].list.hidden = false;
    menus[i].btn.classList.add("open");
    menus[i].btn.setAttribute("aria-expanded", "true");
    openIdx = i;
  }

  function closeMenus() {
    menus.forEach((m) => {
      m.list.hidden = true;
      m.btn.classList.remove("open");
      m.btn.setAttribute("aria-expanded", "false");
    });
    openIdx = -1;
  }

  document.addEventListener("pointerdown", (e) => {
    if (!menubar.contains(e.target)) closeMenus();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && openIdx >= 0) {
      closeMenus();
      focusEditor();
    }
  });

  menubar.addEventListener("keydown", (e) => {
    const enabledItems = (list) => [...list.querySelectorAll(".menu-item:not(:disabled)")];
    const btnIdx = menus.findIndex((m) => m.btn === document.activeElement);
    const listIdx = menus.findIndex((m) => m.list.contains(document.activeElement));
    const sideways = e.key === "ArrowRight" || e.key === "ArrowLeft";
    const step = e.key === "ArrowRight" ? 1 : -1;

    if (btnIdx >= 0) {
      if (sideways) {
        const n = (btnIdx + step + menus.length) % menus.length;
        menus[n].btn.focus();
        if (openIdx >= 0) openMenu(n);
        e.preventDefault();
      } else if (e.key === "ArrowDown") {
        openMenu(btnIdx);
        const first = enabledItems(menus[btnIdx].list)[0];
        if (first) first.focus();
        e.preventDefault();
      }
    } else if (listIdx >= 0) {
      const its = enabledItems(menus[listIdx].list);
      const i = its.indexOf(document.activeElement);
      if (e.key === "ArrowDown") {
        its[(i + 1) % its.length].focus();
        e.preventDefault();
      } else if (e.key === "ArrowUp") {
        its[(i - 1 + its.length) % its.length].focus();
        e.preventDefault();
      } else if (sideways) {
        const n = (listIdx + step + menus.length) % menus.length;
        menus[n].btn.focus();
        openMenu(n);
        e.preventDefault();
      } else if (e.key === "Escape") {
        closeMenus();
        menus[listIdx].btn.focus();
        e.preventDefault();
        e.stopPropagation();
      }
    }
  });

  buildMenus();

  /* ---------- Outline ---------- */

  const canvas = document.getElementById("canvas");
  const outlineBody = document.getElementById("outline-body");
  const outlineToggleBtn = toolbar.querySelector('[data-action="toggleOutline"]');
  const collapsed = new WeakMap();
  let activeHeading = null;
  let outlineQueued = false;
  let ignoreScrollUntil = 0;
  let outlinePressed = false;

  function isOutlineHidden() {
    return appEl.classList.contains("outline-hidden");
  }

  function setOutlineHidden(hidden, persist = true) {
    appEl.classList.toggle("outline-hidden", hidden);
    outlineToggleBtn.classList.toggle("active", !hidden);
    outlineToggleBtn.setAttribute("aria-pressed", String(!hidden));
    if (persist) {
      try {
        localStorage.setItem("bedocs.outline", hidden ? "hidden" : "shown");
      } catch (err) {
        /* storage unavailable, ignore */
      }
    }
  }

  function headingLevel(h) {
    if (h.tagName === "H1") return h.classList.contains("title") ? 0 : 1;
    if (h.tagName === "H2") return 2;
    return 3;
  }

  function collectHeadings() {
    return [...editor.querySelectorAll("h1,h2,h3")]
      .map((h) => ({ el: h, level: headingLevel(h), text: h.textContent.replace(/\u200b/g, "").trim() }))
      .filter((h) => h.text);
  }

  // Smaller headings nest under the nearest larger heading above them
  function buildTree(list) {
    const root = { children: [] };
    const stack = [{ level: -1, node: root }];
    list.forEach((h) => {
      const node = { el: h.el, level: h.level, text: h.text, children: [] };
      while (stack[stack.length - 1].level >= h.level) stack.pop();
      stack[stack.length - 1].node.children.push(node);
      stack.push({ level: h.level, node });
    });
    return root.children;
  }

  function containsActive(n) {
    return n.children.some((c) => c.el === activeHeading || containsActive(c));
  }

  function renderList(nodes) {
    const ul = el("ul", "ol-list");
    nodes.forEach((n) => {
      const li = el("li");
      const row = el("div", "ol-row lv-" + n.level);
      const isCollapsed = collapsed.get(n.el) === true;

      if (n.children.length) {
        const t = el("button", "ol-toggle");
        t.type = "button";
        t.setAttribute("aria-expanded", String(!isCollapsed));
        t.setAttribute("aria-label", (isCollapsed ? "Expand " : "Collapse ") + n.text);
        t.innerHTML = svg("chevron", 14);
        t.addEventListener("click", () => {
          collapsed.set(n.el, !isCollapsed);
          renderOutline();
        });
        row.appendChild(t);
      } else {
        row.appendChild(el("span", "ol-spacer"));
      }

      const link = el("button", "ol-link");
      link.type = "button";
      link.textContent = n.text;
      link.title = n.text;
      link.addEventListener("click", () => jumpTo(n.el));
      row.appendChild(link);

      if (n.el === activeHeading) row.classList.add("active");
      else if (isCollapsed && containsActive(n)) row.classList.add("has-active");

      li.appendChild(row);
      if (n.children.length && !isCollapsed) li.appendChild(renderList(n.children));
      ul.appendChild(li);
    });
    return ul;
  }

  function renderOutline() {
    outlineQueued = false;
    // Rebuilding mid-click would replace the button under the pointer and swallow the click
    if (outlinePressed) {
      outlineQueued = true;
      return;
    }
    const scrollTop = outlineBody.scrollTop;
    const tree = buildTree(collectHeadings());
    outlineBody.textContent = "";
    if (!tree.length) {
      const p = el("p", "outline-empty");
      p.textContent = "Add a title or headings to your document and they will appear here for quick jumping.";
      outlineBody.appendChild(p);
      return;
    }
    outlineBody.appendChild(renderList(tree));
    outlineBody.scrollTop = scrollTop;
  }

  function queueOutline() {
    if (outlineQueued) return;
    outlineQueued = true;
    requestAnimationFrame(renderOutline);
  }

  const JUMP_MARGIN = 16;

  function scrollHeadingIntoPlace(h) {
    const offset = h.getBoundingClientRect().top - canvas.getBoundingClientRect().top - JUMP_MARGIN;
    if (Math.abs(offset) > 1) canvas.scrollTop += offset;
  }

  function jumpTo(h) {
    // Move the caret and focus first, because focusing can disturb scrolling
    const r = document.createRange();
    r.selectNodeContents(h);
    r.collapse(true);
    savedRange = r;
    focusEditor();

    // Then scroll immediately, and once more after layout to correct any drift
    scrollHeadingIntoPlace(h);
    requestAnimationFrame(() => scrollHeadingIntoPlace(h));

    activeHeading = h;
    ignoreScrollUntil = performance.now() + 300;
    queueOutline();

    if (window.matchMedia("(max-width: 720px)").matches) setOutlineHidden(true);
  }

  function setActiveFromCaret(node) {
    let found = null;
    editor.querySelectorAll("h1,h2,h3").forEach((h) => {
      if (!h.textContent.trim()) return;
      if (h === node || h.contains(node) || h.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING) {
        found = h;
      }
    });
    if (found !== activeHeading) {
      activeHeading = found;
      queueOutline();
    }
  }

  let scrollQueued = false;
  canvas.addEventListener(
    "scroll",
    () => {
      if (scrollQueued || performance.now() < ignoreScrollUntil) return;
      scrollQueued = true;
      requestAnimationFrame(() => {
        scrollQueued = false;
        const top = canvas.getBoundingClientRect().top + 24;
        let found = null;
        editor.querySelectorAll("h1,h2,h3").forEach((h) => {
          if (h.textContent.trim() && h.getBoundingClientRect().top <= top) found = h;
        });
        if (found !== activeHeading) {
          activeHeading = found;
          queueOutline();
        }
      });
    },
    { passive: true }
  );

  // Keep focus and selection in the editor when clicking outline buttons
  outlineBody.addEventListener("mousedown", (e) => {
    if (e.target.closest("button")) e.preventDefault();
  });

  outlineBody.addEventListener("pointerdown", () => {
    outlinePressed = true;
  });

  document.addEventListener("pointerup", () => {
    if (!outlinePressed) return;
    outlinePressed = false;
    if (outlineQueued) requestAnimationFrame(renderOutline);
  });

  document.addEventListener("pointercancel", () => {
    outlinePressed = false;
  });

  document.getElementById("outline-close").addEventListener("mousedown", (e) => e.preventDefault());
  document.getElementById("outline-close").addEventListener("click", () => setOutlineHidden(true));

  (function initOutline() {
    let stored = null;
    try {
      stored = localStorage.getItem("bedocs.outline");
    } catch (err) {
      stored = null;
    }
    const hidden = stored ? stored === "hidden" : window.matchMedia("(max-width: 720px)").matches;
    setOutlineHidden(hidden, false);
    renderOutline();
  })();

  /* ---------- Object layout, size and position ---------- */

  const MIN_SIZE = 40;
  const SNAP_DISTANCE = 6;

  const layoutOf = (m) => m.getAttribute("data-layout") || "inline";
  const isPositioned = (m) => layoutOf(m) === "behind" || layoutOf(m) === "front";

  function setAttr(node, name, value) {
    if (value === null || value === undefined) node.removeAttribute(name);
    else node.setAttribute(name, value);
  }

  function snapshotMedia(m) {
    return { m, layout: m.getAttribute("data-layout"), style: m.getAttribute("style") };
  }

  function restoreMedia(snap) {
    if (!snap.m.isConnected) return false;
    setAttr(snap.m, "data-layout", snap.layout);
    setAttr(snap.m, "style", snap.style);
    return true;
  }

  // Remember the previous state so the change can be undone
  function recordMediaChange(before) {
    const now = snapshotMedia(before.m);
    if (now.layout === before.layout && now.style === before.style) return;
    undoStack.push(() => restoreMedia(before));
    afterChange();
  }

  function contentWidth() {
    const cs = getComputedStyle(editor);
    return editor.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  }

  // Which edge of the object stays put when its width changes
  function mediaAlignment(m) {
    const layout = layoutOf(m);
    if (layout === "wrap-left") return "left";
    if (layout === "wrap-right") return "right";
    const block = getBlock(m);
    const a = block ? getComputedStyle(block).textAlign : "left";
    if (a === "center") return "center";
    if (a === "right" || a === "end") return "right";
    return "left";
  }

  function setLayout(m, layout) {
    if (layoutOf(m) === layout) return;
    const before = snapshotMedia(m);
    const wasFree = isPositioned(m);
    const goingFree = layout === "behind" || layout === "front";

    // Keep the object where it is on screen when it becomes freely positioned
    let x = 0;
    let y = 0;
    if (goingFree && !wasFree) {
      const r = m.getBoundingClientRect();
      const a = (m.offsetParent || editor).getBoundingClientRect();
      x = Math.round(r.left - a.left);
      y = Math.round(r.top - a.top);
    }

    if (layout === "inline") m.removeAttribute("data-layout");
    else m.setAttribute("data-layout", layout);

    if (!goingFree) {
      m.style.removeProperty("--x");
      m.style.removeProperty("--y");
      if (!m.getAttribute("style")) m.removeAttribute("style");
    } else if (!wasFree) {
      m.style.setProperty("--x", x + "px");
      m.style.setProperty("--y", y + "px");
      // A paragraph holding only a free object would collapse, so give it a line to stay editable
      const block = getBlock(m);
      if (block && !block.textContent.trim() && !block.querySelector("br")) {
        block.appendChild(document.createElement("br"));
      }
    }

    recordMediaChange(before);
    refreshObjectUI();
  }

  function applySizePreset(m, preset) {
    const before = snapshotMedia(m);
    let w;
    if (preset === "original") {
      w = m.tagName === "IMG" ? m.naturalWidth : m.videoWidth;
    } else {
      w = Math.round(contentWidth() * preset);
    }
    w = Math.max(MIN_SIZE, w || DEFAULT_MEDIA_WIDTH);
    m.style.width = w + "px";
    recordMediaChange(before);
    refreshObjectUI();
  }

  /* --- Selection frame, resize handles and the small toolbar --- */

  const ui = el("div");
  ui.id = "obj-ui";
  ui.hidden = true;
  canvas.appendChild(ui);

  const guides = el("div", "obj-guides");
  const frame = el("div", "obj-frame");
  const moveSurface = el("div", "obj-move");
  const bar = el("div", "obj-bar");
  const chip = el("div", "snap-chip");
  chip.hidden = true;
  frame.appendChild(moveSurface);
  ui.append(guides, frame, bar);
  document.body.appendChild(chip);

  const handleEls = {};
  ["nw", "ne", "sw", "se"].forEach((corner) => {
    const h = el("div", "obj-handle h-" + corner);
    h.addEventListener("pointerdown", (e) => startResize(e, corner));
    frame.appendChild(h);
    handleEls[corner] = h;
  });

  bar.setAttribute("role", "toolbar");
  bar.setAttribute("aria-label", "Image and video options");

  LAYOUTS.forEach((L) => {
    const b = el("button", "tb small");
    b.type = "button";
    b.title = L.label;
    b.setAttribute("aria-label", L.label);
    b.dataset.layout = L.id;
    b.innerHTML = svg(L.icon, 16);
    b.addEventListener("click", () => selectedMedia && setLayout(selectedMedia, L.id));
    bar.appendChild(b);
  });

  bar.appendChild(el("span", "bar-sep"));

  const sizeSelect = el("select", "tb-select");
  sizeSelect.title = "Size";
  sizeSelect.setAttribute("aria-label", "Size");
  const placeholder = el("option");
  placeholder.value = "";
  placeholder.textContent = "Size";
  sizeSelect.appendChild(placeholder);
  SIZE_PRESETS.forEach(([label, value]) => {
    const o = el("option");
    o.value = String(value);
    o.textContent = label;
    sizeSelect.appendChild(o);
  });
  sizeSelect.addEventListener("change", () => {
    const v = sizeSelect.value;
    sizeSelect.value = "";
    if (!v || !selectedMedia) return;
    applySizePreset(selectedMedia, v === "original" ? v : parseFloat(v));
  });
  bar.appendChild(sizeSelect);

  bar.appendChild(el("span", "bar-sep"));

  const deleteBtn = el("button", "tb small");
  deleteBtn.type = "button";
  deleteBtn.title = "Delete";
  deleteBtn.setAttribute("aria-label", "Delete");
  deleteBtn.innerHTML = svg("trash", 16);
  deleteBtn.addEventListener("click", () => selectedMedia && exec("delete"));
  bar.appendChild(deleteBtn);

  // Keep the selection while using the frame and toolbar (the size list needs normal focus)
  bar.addEventListener("mousedown", (e) => {
    if (!e.target.closest("select")) e.preventDefault();
  });
  frame.addEventListener("mousedown", (e) => e.preventDefault());

  function refreshObjectUI() {
    const m = selectedMedia;
    if (!m || !m.isConnected) {
      ui.hidden = true;
      return;
    }
    ui.hidden = false;

    const cr = canvas.getBoundingClientRect();
    const r = m.getBoundingClientRect();
    const x = r.left - cr.left + canvas.scrollLeft;
    const y = r.top - cr.top + canvas.scrollTop;
    frame.style.left = x + "px";
    frame.style.top = y + "px";
    frame.style.width = r.width + "px";
    frame.style.height = r.height + "px";

    // Only show the handles that stay under the pointer while resizing
    const positioned = isPositioned(m);
    const side = positioned ? "center" : mediaAlignment(m);
    const show = side === "center" ? ["nw", "ne", "sw", "se"] : side === "left" ? ["ne", "se"] : ["nw", "sw"];
    Object.keys(handleEls).forEach((c) => {
      handleEls[c].style.display = show.includes(c) ? "" : "none";
    });

    // Free objects can be dragged by their frame (video keeps its play controls clear)
    moveSurface.style.display = positioned ? "" : "none";
    moveSurface.style.bottom = positioned && m.tagName === "VIDEO" ? "44px" : "0";

    bar.querySelectorAll("[data-layout]").forEach((b) => {
      b.classList.toggle("active", b.dataset.layout === layoutOf(m));
    });

    // The toolbar sits above the object, or below it, or pinned to the top of the view
    const barH = bar.offsetHeight;
    let top = y - barH - 10;
    if (top < canvas.scrollTop + 8) {
      const below = y + r.height + 10;
      top = below + barH <= canvas.scrollTop + canvas.clientHeight - 8 ? below : canvas.scrollTop + 8;
    }
    const maxLeft = canvas.scrollLeft + canvas.clientWidth - bar.offsetWidth - 8;
    bar.style.top = top + "px";
    bar.style.left = Math.max(8, Math.min(x, maxLeft)) + "px";
  }

  canvas.addEventListener("scroll", () => {
    if (selectedMedia) refreshObjectUI();
  }, { passive: true });

  new ResizeObserver(() => refreshObjectUI()).observe(editor);
  editor.addEventListener("load", refreshObjectUI, true);
  editor.addEventListener("loadedmetadata", refreshObjectUI, true);

  /* --- Resizing --- */

  function startResize(e, corner) {
    const m = selectedMedia;
    if (!m || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    const before = snapshotMedia(m);
    const r0 = m.getBoundingClientRect();
    const positioned = isPositioned(m);
    const east = corner.includes("e");
    const north = corner.includes("n");
    // A centred object grows on both sides, so the width changes twice as fast as the pointer moves
    const factor = !positioned && mediaAlignment(m) === "center" ? 2 : 1;
    const x0 = positioned ? m.offsetLeft : 0;
    const y0 = positioned ? m.offsetTop : 0;
    const maxW = positioned ? editor.clientWidth : contentWidth();
    const startX = e.clientX;
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);

    const move = (ev) => {
      const dx = ev.clientX - startX;
      const w = Math.round(Math.min(maxW, Math.max(MIN_SIZE, r0.width + (east ? dx : -dx) * factor)));
      m.style.width = w + "px";
      if (positioned) {
        // Keep the corner opposite the handle where it is
        const h = r0.height * (w / r0.width);
        if (!east) m.style.setProperty("--x", Math.round(x0 + (r0.width - w)) + "px");
        if (north) m.style.setProperty("--y", Math.round(y0 + (r0.height - h)) + "px");
      }
      refreshObjectUI();
    };
    const up = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
      target.removeEventListener("pointercancel", up);
      recordMediaChange(before);
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
    target.addEventListener("pointercancel", up);
  }

  /* --- Moving, with snapping and alignment guides --- */

  // Lines an object can snap to, in screen coordinates. "side" says which edge of the object matches.
  function snapReference(m) {
    const er = editor.getBoundingClientRect();
    const cs = getComputedStyle(editor);
    const pl = parseFloat(cs.paddingLeft);
    const pr = parseFloat(cs.paddingRight);
    const pt = parseFloat(cs.paddingTop);
    const pb = parseFloat(cs.paddingBottom);

    const xs = [
      { v: er.left, side: "start", kind: "edge" },
      { v: er.left + pl, side: "start", kind: "margin" },
      { v: er.left + er.width / 2, side: "center", kind: "docCenter" },
      { v: er.right - pr, side: "end", kind: "margin" },
      { v: er.right, side: "end", kind: "edge" },
    ];
    const ys = [
      { v: er.top, side: "start", kind: "edge" },
      { v: er.top + pt, side: "start", kind: "margin" },
      { v: er.top + pt + (er.height - pt - pb) / 2, side: "center", kind: "docCenter" },
      { v: er.bottom - pb, side: "end", kind: "margin" },
    ];

    editor.querySelectorAll("img,video").forEach((o) => {
      if (o === m) return;
      const r = o.getBoundingClientRect();
      const name = o.tagName === "IMG" ? "image" : "video";
      xs.push(
        { v: r.left, side: "start", kind: "object", name },
        { v: r.left + r.width / 2, side: "center", kind: "object", name },
        { v: r.right, side: "end", kind: "object", name }
      );
      ys.push(
        { v: r.top, side: "start", kind: "object", name },
        { v: r.top + r.height / 2, side: "center", kind: "object", name },
        { v: r.bottom, side: "end", kind: "object", name }
      );
    });
    return { xs, ys, er };
  }

  function snapAxis(edges, lines) {
    let best = null;
    lines.forEach((ln) => {
      const d = ln.v - edges[ln.side];
      if (Math.abs(d) <= SNAP_DISTANCE && (best === null || Math.abs(d) < Math.abs(best))) best = d;
    });
    if (best === null) return { delta: 0, hits: [] };
    return { delta: best, hits: lines.filter((ln) => Math.abs(ln.v - (edges[ln.side] + best)) < 0.5) };
  }

  function clearGuides() {
    guides.textContent = "";
    chip.hidden = true;
  }

  function drawGuides(xHits, yHits, ref) {
    guides.textContent = "";
    const cr = canvas.getBoundingClientRect();

    xHits.forEach((ln) => {
      const g = el("div", "guide v");
      g.style.left = ln.v - cr.left + canvas.scrollLeft + "px";
      g.style.top = canvas.scrollTop + "px";
      g.style.height = canvas.clientHeight + "px";
      guides.appendChild(g);
    });
    yHits.forEach((ln) => {
      const g = el("div", "guide h");
      g.style.top = ln.v - cr.top + canvas.scrollTop + "px";
      g.style.left = ref.er.left - cr.left + canvas.scrollLeft + "px";
      g.style.width = ref.er.width + "px";
      guides.appendChild(g);
    });

    const msgs = new Set();
    const docX = xHits.some((h) => h.kind === "docCenter");
    const docY = yHits.some((h) => h.kind === "docCenter");
    if (docX && docY) msgs.add("Centered in document");
    else if (docX) msgs.add("Centered horizontally");
    else if (docY) msgs.add("Centered vertically");
    [...xHits, ...yHits].forEach((h) => {
      if (h.kind === "edge") msgs.add("At document edge");
      else if (h.kind === "margin") msgs.add("At text margin");
      else if (h.kind === "object") msgs.add((h.side === "center" ? "Centered with " : "Aligned with ") + h.name);
    });

    if (msgs.size) {
      chip.textContent = [...msgs].join(" \u00b7 ");
      chip.style.left = cr.left + cr.width / 2 + "px";
      chip.style.top = cr.top + 12 + "px";
      chip.hidden = false;
    } else {
      chip.hidden = true;
    }
  }

  function startMove(e, m) {
    e.preventDefault();
    const before = snapshotMedia(m);
    const startX = e.clientX;
    const startY = e.clientY;
    const x0 = m.offsetLeft;
    const y0 = m.offsetTop;
    const r0 = m.getBoundingClientRect();
    const ref = snapReference(m);
    const target = e.target;
    target.setPointerCapture(e.pointerId);

    const move = (ev) => {
      let dx = ev.clientX - startX;
      let dy = ev.clientY - startY;
      let xHits = [];
      let yHits = [];
      // Hold Alt to move without snapping
      if (!ev.altKey) {
        const sx = snapAxis(
          { start: r0.left + dx, center: r0.left + r0.width / 2 + dx, end: r0.right + dx },
          ref.xs
        );
        const sy = snapAxis(
          { start: r0.top + dy, center: r0.top + r0.height / 2 + dy, end: r0.bottom + dy },
          ref.ys
        );
        dx += sx.delta;
        dy += sy.delta;
        xHits = sx.hits;
        yHits = sy.hits;
      }
      m.style.setProperty("--x", Math.round(x0 + dx) + "px");
      m.style.setProperty("--y", Math.round(y0 + dy) + "px");
      refreshObjectUI();
      drawGuides(xHits, yHits, ref);
    };
    const up = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
      target.removeEventListener("pointercancel", up);
      clearGuides();
      recordMediaChange(before);
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
    target.addEventListener("pointercancel", up);
  }

  moveSurface.addEventListener("pointerdown", (e) => {
    if (e.button === 0 && selectedMedia) startMove(e, selectedMedia);
  });

  // Objects in front of the text can be dragged straight away
  function isFrontHit(e) {
    const t = e.target;
    if (!isMedia(t) || layoutOf(t) !== "front") return false;
    return !(t.tagName === "VIDEO" && t.getBoundingClientRect().bottom - e.clientY < 44);
  }

  editor.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || !isFrontHit(e)) return;
    selectMedia(e.target);
    startMove(e, e.target);
  });
  editor.addEventListener("mousedown", (e) => {
    if (isFrontHit(e)) e.preventDefault();
  });
  editor.addEventListener("dragstart", (e) => {
    if (isMedia(e.target) && isPositioned(e.target)) e.preventDefault();
  });

  // Arrow keys nudge a selected free object (hold Shift for bigger steps)
  editor.addEventListener("keydown", (e) => {
    const m = selectedMedia;
    if (!m || !isPositioned(m) || e.ctrlKey || e.metaKey || e.altKey) return;
    const step = e.shiftKey ? 10 : 1;
    const dx = e.key === "ArrowRight" ? step : e.key === "ArrowLeft" ? -step : 0;
    const dy = e.key === "ArrowDown" ? step : e.key === "ArrowUp" ? -step : 0;
    if (!dx && !dy) return;
    e.preventDefault();
    const before = snapshotMedia(m);
    m.style.setProperty("--x", m.offsetLeft + dx + "px");
    m.style.setProperty("--y", m.offsetTop + dy + "px");
    recordMediaChange(before);
    refreshObjectUI();
  });

  /* ---------- Title, status, lifecycle ---------- */

  function syncTitle() {
    const t = titleInput.value.trim() || "Untitled document";
    document.title = t + " - BeDocs";
  }

  titleInput.addEventListener("input", () => {
    markDirty();
    syncTitle();
  });

  titleInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      focusEditor();
    }
  });

  function updateStatus() {
    const text = editor.innerText.replace(/\u200b/g, "").trim();
    const words = text ? text.split(/\s+/).length : 0;
    countStat.textContent = words + (words === 1 ? " word, " : " words, ") + text.length + " characters";
  }

  editor.addEventListener("input", () => {
    ensureContent();
    undoStack.length = 0;
    markDirty();
    updateStatus();
    queueOutline();
  });

  window.addEventListener("beforeunload", (e) => {
    if (dirty && hasContent()) {
      e.preventDefault();
      e.returnValue = "";
    }
  });

  document.addEventListener("keydown", (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === "s") {
      e.preventDefault();
      saveFile(e.shiftKey);
    } else if (k === "o") {
      e.preventDefault();
      openFile();
    }
  });

  document.execCommand("defaultParagraphSeparator", false, "p");
  syncTitle();
  updateStatus();
  editor.focus({ preventScroll: true });
})();
