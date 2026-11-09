/**
 * 個人情報自動マスキングツール - Canvas制御モジュール (ui.js)
 * 責務: 基準画像・マスキング矩形の描画、座標変換、Canvas上でのポインター/ジェスチャー操作制御
 */

class CanvasUI {
  constructor(canvas, wrapper) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.wrapper = wrapper;

    // トランスフォーム
    this.scale = 1.0;
    this.offsetX = 0;
    this.offsetY = 0;

    // 内部データ
    this.baseCanvas = null;
    this.cachedMaskedCanvas = null;
    this.rects = [];
    this.selectedRectId = null;
    this.mode = 'draw';
    this.isPreviewMode = false;
    this.lastWrapperSize = { w: 0, h: 0 };

    // 定数
    this.HANDLE_SIZE = 10;
    this.HIT_SLOP = 22; // タップ当たり判定（44px相当）

    // 操作状態
    this.activeAction = null;
    this.activeHandle = null;
    this.dragStartScreen = { x: 0, y: 0 };
    this.dragStartImg = { x: 0, y: 0 };
    this.initialRectSnapshot = null;
    this.preEditRectsSnapshot = null;
    this.draftRect = null;
    this.panStartOffset = { x: 0, y: 0 };
    this.activePointers = new Map();
    this.initialPinchDistance = 0;
    this.initialPinchCenter = { x: 0, y: 0 };
    this.initialScale = 1.0;
    this.isSpacePanActive = false;

    // コールバック
    this.callbacks = { onRectCreated: null, onRectModified: null, onSelectionChanged: null, onHistoryPush: null };
    this._initEvents();
  }

  _initEvents() {
    const observer = new ResizeObserver(() => { this.resizeCanvas(); this.render(); });
    observer.observe(this.wrapper);
    this.canvas.addEventListener('pointerdown', (e) => this._onPointerDown(e));
    this.canvas.addEventListener('pointermove', (e) => this._onPointerMove(e));
    this.canvas.addEventListener('pointerup', (e) => this._onPointerUp(e));
    this.canvas.addEventListener('pointercancel', (e) => this._onPointerUp(e));
    this.wrapper.addEventListener('wheel', (e) => this._onWheel(e), { passive: false });
  }

  resizeCanvas() {
    const rect = this.wrapper.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      if (this.lastWrapperSize.w > 0 && this.lastWrapperSize.h > 0 &&
          (rect.width !== this.lastWrapperSize.w || rect.height !== this.lastWrapperSize.h)) {
        this.offsetX += (rect.width - this.lastWrapperSize.w) / 2;
        this.offsetY += (rect.height - this.lastWrapperSize.h) / 2;
      }
      this.lastWrapperSize = { w: rect.width, h: rect.height };
    }
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.round(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.round(rect.height * dpr));
    this.canvas.style.width = `${rect.width}px`;
    this.canvas.style.height = `${rect.height}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  setImage(baseCanvas) {
    this.baseCanvas = baseCanvas;
    this.cachedMaskedCanvas = null;
    this.rects = [];
    this.selectedRectId = null;
    this.isPreviewMode = false;
    this.activePointers.clear();
    this.resizeCanvas();
    if (this.baseCanvas) this.fitToScreen();
    this.render();
  }

  fitToScreen() {
    if (!this.baseCanvas) return;
    const wrapperRect = this.wrapper.getBoundingClientRect();
    const scaleX = (wrapperRect.width - 32) / this.baseCanvas.width;
    const scaleY = (wrapperRect.height - 32) / this.baseCanvas.height;
    this.scale = Math.min(scaleX, scaleY, 1.0);
    this.offsetX = (wrapperRect.width - this.baseCanvas.width * this.scale) / 2;
    this.offsetY = (wrapperRect.height - this.baseCanvas.height * this.scale) / 2;
  }

  setRects(rects) {
    this.rects = rects;
    this.cachedMaskedCanvas = (this.isPreviewMode && this.baseCanvas)
      ? MaskerEngine.renderMaskedCanvas(this.baseCanvas, this.rects) : null;
    if (this.selectedRectId && !this.rects.some(r => r.id === this.selectedRectId)) {
      this.selectedRectId = null;
      if (this.callbacks.onSelectionChanged) this.callbacks.onSelectionChanged(null);
    }
    this.render();
  }

  setMode(mode) { this.mode = mode; }

  setSpacePanActive(active) {
    this.isSpacePanActive = active;
    this.canvas.style.cursor = active ? 'grab' : 'default';
  }

  setPreviewMode(isPreview) {
    this.isPreviewMode = isPreview;
    this.cachedMaskedCanvas = (isPreview && this.baseCanvas)
      ? MaskerEngine.renderMaskedCanvas(this.baseCanvas, this.rects) : null;
    this.render();
  }

  // 座標変換
  screenToImage(screenX, screenY) {
    return { x: (screenX - this.offsetX) / this.scale, y: (screenY - this.offsetY) / this.scale };
  }

  imageToScreen(imgX, imgY) {
    return { x: imgX * this.scale + this.offsetX, y: imgY * this.scale + this.offsetY };
  }

  // 描画
  render() {
    if (!this.baseCanvas) {
      const rect = this.wrapper.getBoundingClientRect();
      this.ctx.clearRect(0, 0, rect.width, rect.height);
      return;
    }

    const wrapperRect = this.wrapper.getBoundingClientRect();
    const ctx = this.ctx;
    ctx.clearRect(0, 0, wrapperRect.width, wrapperRect.height);

    ctx.save();
    ctx.translate(this.offsetX, this.offsetY);
    ctx.scale(this.scale, this.scale);

    if (this.isPreviewMode) {
      if (!this.cachedMaskedCanvas) {
        this.cachedMaskedCanvas = MaskerEngine.renderMaskedCanvas(this.baseCanvas, this.rects);
      }
      ctx.drawImage(this.cachedMaskedCanvas, 0, 0);
    } else {
      ctx.drawImage(this.baseCanvas, 0, 0);

      for (const r of this.rects) {
        const isSelected = r.id === this.selectedRectId;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
        ctx.fillRect(r.x, r.y, r.width, r.height);
        ctx.strokeStyle = isSelected ? '#3b82f6' : 'rgba(244, 244, 245, 0.8)';
        ctx.lineWidth = (isSelected ? 2 : 1.5) / this.scale;
        ctx.strokeRect(r.x, r.y, r.width, r.height);
      }

      if (this.activeAction === 'create' && this.draftRect) {
        ctx.fillStyle = 'rgba(59, 130, 246, 0.2)';
        ctx.fillRect(this.draftRect.x, this.draftRect.y, this.draftRect.width, this.draftRect.height);
        ctx.strokeStyle = '#3b82f6';
        ctx.lineWidth = 1.5 / this.scale;
        ctx.strokeRect(this.draftRect.x, this.draftRect.y, this.draftRect.width, this.draftRect.height);
      }
    }
    ctx.restore();

    if (!this.isPreviewMode && this.selectedRectId) {
      const selected = this.rects.find(r => r.id === this.selectedRectId);
      if (selected) {
        this._renderHandles(selected);
      }
    }
  }

  _renderHandles(rect) {
    const ctx = this.ctx;
    const handles = this._getHandlePositions(rect);
    ctx.save();
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 2;

    const size = this.HANDLE_SIZE;
    for (const h of Object.values(handles)) {
      ctx.fillRect(h.x - size / 2, h.y - size / 2, size, size);
      ctx.strokeRect(h.x - size / 2, h.y - size / 2, size, size);
    }
    ctx.restore();
  }

  _getHandlePositions(rect) {
    const tl = this.imageToScreen(rect.x, rect.y);
    const br = this.imageToScreen(rect.x + rect.width, rect.y + rect.height);
    const midX = (tl.x + br.x) / 2;
    const midY = (tl.y + br.y) / 2;
    return {
      nw: { x: tl.x, y: tl.y }, n: { x: midX, y: tl.y }, ne: { x: br.x, y: tl.y },
      e:  { x: br.x, y: midY }, se: { x: br.x, y: br.y }, s: { x: midX, y: br.y },
      sw: { x: tl.x, y: br.y }, w:  { x: tl.x, y: midY }
    };
  }

  hitTestHandle(screenX, screenY) {
    if (!this.selectedRectId) return null;
    const selected = this.rects.find(r => r.id === this.selectedRectId);
    if (!selected) return null;
    for (const [key, pos] of Object.entries(this._getHandlePositions(selected))) {
      if (Math.hypot(screenX - pos.x, screenY - pos.y) <= this.HIT_SLOP) return key;
    }
    return null;
  }

  hitTestRect(imgX, imgY) {
    for (let i = this.rects.length - 1; i >= 0; i--) {
      const r = this.rects[i];
      if (imgX >= r.x && imgX <= r.x + r.width && imgY >= r.y && imgY <= r.y + r.height) return r;
    }
    return null;
  }

  // ポインター・ジェスチャーイベント処理
  _onPointerDown(e) {
    if (!this.baseCanvas) return;
    this.canvas.setPointerCapture(e.pointerId);
    const rect = this.wrapper.getBoundingClientRect();
    this.activePointers.set(e.pointerId, { x: e.clientX - rect.left, y: e.clientY - rect.top });

    if (this.activePointers.size === 2) {
      // 1本指での進行中操作をロールバックして2本指ピンチ＋パンに移行
      this.draftRect = null;
      if ((this.activeAction === 'move' || this.activeAction === 'resize') && this.initialRectSnapshot) {
        const target = this.rects.find(r => r.id === this.selectedRectId);
        if (target) Object.assign(target, this.initialRectSnapshot);
      }
      this.initialRectSnapshot = null;
      this.preEditRectsSnapshot = null;
      this.activeAction = 'pinch';
      const pts = Array.from(this.activePointers.values());
      this.initialPinchDistance = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      this.initialPinchCenter = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
      this.initialScale = this.scale;
      this.panStartOffset = { x: this.offsetX, y: this.offsetY };
      this.render();
      return;
    }
    if (this.activePointers.size > 2) return;

    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    const imgCoords = this.screenToImage(screenX, screenY);
    this.dragStartScreen = { x: screenX, y: screenY };
    this.dragStartImg = { x: imgCoords.x, y: imgCoords.y };

    if (this.isPreviewMode || this.isSpacePanActive || this.mode === 'pan' || e.button === 1) {
      this.activeAction = 'pan';
      this.panStartOffset = { x: this.offsetX, y: this.offsetY };
      return;
    }

    const hitHandle = this.hitTestHandle(screenX, screenY);
    if (hitHandle) {
      this.activeAction = 'resize';
      this.activeHandle = hitHandle;
      const target = this.rects.find(r => r.id === this.selectedRectId);
      this.preEditRectsSnapshot = this.rects.map(r => ({ ...r }));
      this.initialRectSnapshot = { ...target };
      return;
    }

    const hitRect = this.hitTestRect(imgCoords.x, imgCoords.y);
    if (hitRect) {
      this.selectedRectId = hitRect.id;
      this.activeAction = 'move';
      this.preEditRectsSnapshot = this.rects.map(r => ({ ...r }));
      this.initialRectSnapshot = { ...hitRect };
      if (this.callbacks.onSelectionChanged) this.callbacks.onSelectionChanged(this.selectedRectId);
      this.render();
      return;
    }

    this.selectedRectId = null;
    if (this.callbacks.onSelectionChanged) this.callbacks.onSelectionChanged(null);
    this.activeAction = 'create';
    this.draftRect = { x: imgCoords.x, y: imgCoords.y, width: 0, height: 0 };
    this.render();
  }

  _onPointerMove(e) {
    if (!this.activePointers.has(e.pointerId)) return;
    const rect = this.wrapper.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    this.activePointers.set(e.pointerId, { x: screenX, y: screenY });

    if (this.activeAction === 'pinch' && this.activePointers.size === 2) {
      const pts = Array.from(this.activePointers.values());
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const centerX = (pts[0].x + pts[1].x) / 2;
      const centerY = (pts[0].y + pts[1].y) / 2;
      if (this.initialPinchDistance > 0) {
        const factor = dist / this.initialPinchDistance;
        const newScale = Math.max(0.1, Math.min(5.0, this.initialScale * factor));
        const ratio = newScale / this.initialScale;
        this.offsetX = centerX - (this.initialPinchCenter.x - this.panStartOffset.x) * ratio;
        this.offsetY = centerY - (this.initialPinchCenter.y - this.panStartOffset.y) * ratio;
        this.scale = newScale;
        this.render();
      }
      return;
    }

    if (this.activeAction === 'pan') {
      this.offsetX = this.panStartOffset.x + (screenX - this.dragStartScreen.x);
      this.offsetY = this.panStartOffset.y + (screenY - this.dragStartScreen.y);
      this.render();
      return;
    }

    const currentImg = this.screenToImage(screenX, screenY);
    if (this.activeAction === 'create') {
      this.draftRect = {
        x: Math.min(this.dragStartImg.x, currentImg.x),
        y: Math.min(this.dragStartImg.y, currentImg.y),
        width: Math.abs(currentImg.x - this.dragStartImg.x),
        height: Math.abs(currentImg.y - this.dragStartImg.y)
      };
      this.render();
      return;
    }

    if (this.activeAction === 'move' && this.initialRectSnapshot) {
      const dx = currentImg.x - this.dragStartImg.x;
      const dy = currentImg.y - this.dragStartImg.y;
      const target = this.rects.find(r => r.id === this.selectedRectId);
      if (target) {
        const maxX = this.baseCanvas.width - target.width;
        const maxY = this.baseCanvas.height - target.height;
        target.x = Math.max(0, Math.min(maxX, Math.round(this.initialRectSnapshot.x + dx)));
        target.y = Math.max(0, Math.min(maxY, Math.round(this.initialRectSnapshot.y + dy)));
        this.render();
      }
      return;
    }

    if (this.activeAction === 'resize' && this.initialRectSnapshot) {
      this._applyResize(currentImg.x - this.dragStartImg.x, currentImg.y - this.dragStartImg.y);
      this.render();
    }
  }

  _applyResize(dx, dy) {
    const init = this.initialRectSnapshot;
    const target = this.rects.find(r => r.id === this.selectedRectId);
    if (!target) return;

    let newX = init.x, newY = init.y, newW = init.width, newH = init.height;
    if (this.activeHandle.includes('w')) {
      newX = Math.min(init.x + init.width - 8, init.x + dx);
      newW = init.width - (newX - init.x);
    }
    if (this.activeHandle.includes('e')) newW = Math.max(8, init.width + dx);
    if (this.activeHandle.includes('n')) {
      newY = Math.min(init.y + init.height - 8, init.y + dy);
      newH = init.height - (newY - init.y);
    }
    if (this.activeHandle.includes('s')) newH = Math.max(8, init.height + dy);

    newX = Math.max(0, newX);
    newY = Math.max(0, newY);
    newW = Math.min(this.baseCanvas.width - newX, newW);
    newH = Math.min(this.baseCanvas.height - newY, newH);
    target.x = Math.round(newX);
    target.y = Math.round(newY);
    target.width = Math.round(newW);
    target.height = Math.round(newH);
  }

  _onPointerUp(e) {
    if (this.activePointers.has(e.pointerId)) this.activePointers.delete(e.pointerId);
    if (this.activePointers.size > 0) return;

    if (this.activeAction === 'create' && this.draftRect) {
      const rectObj = MaskerEngine.createManualRect(
        this.draftRect.x, this.draftRect.y, this.draftRect.width, this.draftRect.height,
        this.baseCanvas.width, this.baseCanvas.height
      );
      if (rectObj && this.callbacks.onRectCreated) this.callbacks.onRectCreated(rectObj);
      this.draftRect = null;
    } else if (this.activeAction === 'move' || this.activeAction === 'resize') {
      const init = this.initialRectSnapshot;
      const target = this.rects.find(r => r.id === this.selectedRectId);
      const changed = init && target && (
        target.x !== init.x || target.y !== init.y ||
        target.width !== init.width || target.height !== init.height
      );
      if (changed) {
        if (this.callbacks.onHistoryPush) this.callbacks.onHistoryPush(this.preEditRectsSnapshot);
        if (this.callbacks.onRectModified) this.callbacks.onRectModified();
      }
    }

    this.activeAction = null;
    this.activeHandle = null;
    this.initialRectSnapshot = null;
    this.preEditRectsSnapshot = null;
    this.render();
  }

  _onWheel(e) {
    if (!this.baseCanvas) return;
    e.preventDefault();

    const rect = this.wrapper.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
    const newScale = Math.max(0.1, Math.min(5.0, this.scale * zoomFactor));

    this.offsetX = mouseX - (mouseX - this.offsetX) * (newScale / this.scale);
    this.offsetY = mouseY - (mouseY - this.offsetY) * (newScale / this.scale);
    this.scale = newScale;
    this.render();
  }
}
