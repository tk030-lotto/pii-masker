/**
 * 個人情報自動マスキングツール
 * アプリケーション主制御モジュール (app.js)
 *
 * 責務:
 * 1. アプリケーションの状態遷移管理 (EMPTY | LOADING | REVIEW | EXPORTING)
 * 2. ファイル読み込み（ファイル選択・ドラッグ＆ドロップ）と初期化
 * 3. ツールバー・キーボードショートカット等のUIイベント制御
 * 4. マスキング済み画像の保存・ダウンロード処理
 */

document.addEventListener('DOMContentLoaded', () => {
  // DOM要素の参照
  const uploadSection = document.getElementById('upload-section');
  const editorSection = document.getElementById('editor-section');
  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('file-input');
  const selectFileBtn = document.getElementById('select-file-btn');

  const imageNameBadge = document.getElementById('image-name-badge');
  const imageSizeBadge = document.getElementById('image-size-badge');
  const imageResizeBadge = document.getElementById('image-resize-badge');
  const maskCountBadge = document.getElementById('mask-count-badge');

  const modeDrawBtn = document.getElementById('mode-draw-btn');
  const modePanBtn = document.getElementById('mode-pan-btn');
  const modeHelpText = document.getElementById('mode-help-text');

  const undoBtn = document.getElementById('undo-btn');
  const redoBtn = document.getElementById('redo-btn');
  const deleteSelectedBtn = document.getElementById('delete-selected-btn');
  const clearAllBtn = document.getElementById('clear-all-btn');

  const canvasWrapper = document.getElementById('canvas-wrapper');
  const viewCanvas = document.getElementById('view-canvas');

  const previewToggleBtn = document.getElementById('preview-toggle-btn');
  const resetBtn = document.getElementById('reset-btn');
  const exportBtn = document.getElementById('export-btn');
  const statusNotice = document.getElementById('status-notice');
  const uploadNotice = document.getElementById('upload-notice');
  const resetConfirmBox = document.getElementById('reset-confirm-box');
  const resetConfirmYesBtn = document.getElementById('reset-confirm-yes-btn');
  const resetConfirmNoBtn = document.getElementById('reset-confirm-no-btn');

  // モジュールインスタンス
  const history = new HistoryManager(50);
  const canvasUI = new CanvasUI(viewCanvas, canvasWrapper);

  // 内部状態
  let appState = 'EMPTY';
  let currentImageMeta = null;
  let rects = [];
  let isPreviewActive = false;
  let activeExportUrl = null;
  let activeExportTimer = null;

  // ---------------------------------------------------------------------------
  // UI状態更新・リソース解放ヘルパー
  // ---------------------------------------------------------------------------

  function revokeActiveExportUrl() {
    if (activeExportTimer) { clearTimeout(activeExportTimer); activeExportTimer = null; }
    if (activeExportUrl) { URL.revokeObjectURL(activeExportUrl); activeExportUrl = null; }
  }

  function updateToolbarState() {
    undoBtn.disabled = isPreviewActive || !history.canUndo();
    redoBtn.disabled = isPreviewActive || !history.canRedo();
    deleteSelectedBtn.disabled = isPreviewActive || !canvasUI.selectedRectId;
    clearAllBtn.disabled = isPreviewActive || rects.length === 0;
    modeDrawBtn.disabled = isPreviewActive;
    modePanBtn.disabled = isPreviewActive;
    maskCountBadge.textContent = `矩形: ${rects.length}件`;
  }

  function showNotice(message, type = 'info') {
    statusNotice.textContent = message;
    statusNotice.className = `notice-box ${type} mt-4`;
    statusNotice.classList.remove('hidden');
  }

  function hideNotice() { statusNotice.classList.add('hidden'); }

  function showUploadError(message) {
    uploadNotice.textContent = message;
    uploadNotice.className = 'notice-box error mt-4';
    uploadNotice.classList.remove('hidden');
  }

  function hideUploadError() { uploadNotice.classList.add('hidden'); }

  function setMode(mode) {
    canvasUI.setMode(mode);
    if (mode === 'draw') {
      modeDrawBtn.classList.add('btn-active');
      modeDrawBtn.setAttribute('aria-pressed', 'true');
      modePanBtn.classList.remove('btn-active');
      modePanBtn.setAttribute('aria-pressed', 'false');
      modeHelpText.textContent = '【描画・編集モード】ドラッグしてマスキング矩形を追加 / 矩形を選択して移動・端をドラッグしてサイズ変更';
    } else {
      modePanBtn.classList.add('btn-active');
      modePanBtn.setAttribute('aria-pressed', 'true');
      modeDrawBtn.classList.remove('btn-active');
      modeDrawBtn.setAttribute('aria-pressed', 'false');
      modeHelpText.textContent = '【表示・移動モード】ドラッグして画面移動 / ホイール・ピンチで拡大縮小';
    }
  }

  // ---------------------------------------------------------------------------
  // CanvasUI コールバック連携
  // ---------------------------------------------------------------------------

  canvasUI.callbacks.onHistoryPush = (snapshot) => {
    history.push(snapshot || rects);
  };

  canvasUI.callbacks.onRectCreated = (newRect) => {
    history.push(rects);
    rects.push(newRect);
    canvasUI.selectedRectId = newRect.id;
    canvasUI.setRects(rects);
    updateToolbarState();
  };

  canvasUI.callbacks.onRectModified = () => {
    updateToolbarState();
  };

  canvasUI.callbacks.onSelectionChanged = () => {
    updateToolbarState();
  };

  // ---------------------------------------------------------------------------
  // 画像読み込みと初期化
  // ---------------------------------------------------------------------------

  async function handleFile(file, extraIgnoredCount = 0) {
    if (!file) return;

    appState = 'LOADING';
    hideNotice();
    hideUploadError();
    resetConfirmBox.classList.add('hidden');

    try {
      const meta = await ImageHandler.loadAndDecode(file);
      revokeActiveExportUrl();
      currentImageMeta = meta;
      rects = [];
      isPreviewActive = false;
      previewToggleBtn.classList.remove('btn-active');
      previewToggleBtn.textContent = '仕上がり確認';
      history.clear();

      imageNameBadge.textContent = meta.fileName;
      imageSizeBadge.textContent = `${meta.width} × ${meta.height} px`;

      const notices = [];
      if (meta.isResized) {
        imageResizeBadge.classList.remove('hidden');
        notices.push(`総画素数が上限を超えているため縮小して読み込みました（${meta.originalWidth}×${meta.originalHeight} → ${meta.width}×${meta.height}）。`);
      } else {
        imageResizeBadge.classList.add('hidden');
      }
      if (extraIgnoredCount > 0) {
        notices.push(`画像は1枚ずつ処理するため、先頭の1枚のみ読み込みました（他${extraIgnoredCount}件は対象外として除外）。`);
      }
      if (notices.length > 0) {
        showNotice(notices.join(' '), 'warn');
      }

      uploadSection.classList.add('hidden');
      editorSection.classList.remove('hidden');
      canvasUI.setImage(meta.canvas);
      canvasUI.setRects(rects);

      setMode('draw');
      updateToolbarState();
      appState = 'REVIEW';
    } catch (err) {
      const msg = (err && err.message) ? err.message : '画像の読み込みに失敗しました。ファイル形式や破損有無を確認してください。';
      if (currentImageMeta) {
        showNotice(msg, 'error');
        appState = 'REVIEW';
      } else {
        showUploadError(msg);
        appState = 'EMPTY';
      }
    }
  }

  // ---------------------------------------------------------------------------
  // ファイル入力・ドラッグ＆ドロップ
  // ---------------------------------------------------------------------------

  selectFileBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    fileInput.click();
  });

  dropzone.addEventListener('click', () => fileInput.click());

  dropzone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fileInput.click();
    }
  });

  fileInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files.length > 0) {
      const extra = e.target.files.length - 1;
      handleFile(e.target.files[0], extra);
    }
    fileInput.value = '';
  });

  ['dragenter', 'dragover'].forEach(name => {
    dropzone.addEventListener(name, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.add('dragover');
    });
  });

  ['dragleave', 'drop'].forEach(name => {
    dropzone.addEventListener(name, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.remove('dragover');
    });
  });

  dropzone.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    if (dt && dt.files && dt.files.length > 0) {
      const extra = dt.files.length - 1;
      handleFile(dt.files[0], extra);
    }
  });

  // ---------------------------------------------------------------------------
  // ツールバー・アクションボタン
  // ---------------------------------------------------------------------------

  modeDrawBtn.addEventListener('click', () => setMode('draw'));
  modePanBtn.addEventListener('click', () => setMode('pan'));

  undoBtn.addEventListener('click', () => {
    if (!history.canUndo()) return;
    const restored = history.undo(rects);
    if (restored) {
      rects = restored;
      canvasUI.setRects(rects);
      updateToolbarState();
    }
  });

  redoBtn.addEventListener('click', () => {
    if (!history.canRedo()) return;
    const restored = history.redo(rects);
    if (restored) {
      rects = restored;
      canvasUI.setRects(rects);
      updateToolbarState();
    }
  });

  deleteSelectedBtn.addEventListener('click', () => {
    if (!canvasUI.selectedRectId) return;
    history.push(rects);
    rects = rects.filter(r => r.id !== canvasUI.selectedRectId);
    canvasUI.selectedRectId = null;
    canvasUI.setRects(rects);
    updateToolbarState();
  });

  clearAllBtn.addEventListener('click', () => {
    if (isPreviewActive || rects.length === 0) return;
    history.push(rects);
    rects = [];
    canvasUI.selectedRectId = null;
    canvasUI.setRects(rects);
    updateToolbarState();
    showNotice('すべてのマスキング矩形を消去しました。「元に戻す」で復元できます。', 'info');
  });

  previewToggleBtn.addEventListener('click', () => {
    isPreviewActive = !isPreviewActive;
    canvasUI.setPreviewMode(isPreviewActive);
    if (isPreviewActive) {
      previewToggleBtn.classList.add('btn-active');
      previewToggleBtn.textContent = '編集に戻る';
      modeHelpText.textContent = '【仕上がり確認モード】ドラッグで画面移動 / ホイール・ピンチで拡大縮小（「編集に戻る」で矩形編集を再開）';
      showNotice('仕上がり確認モードです。余白を含めて塗りつぶした結果を表示しています。');
    } else {
      previewToggleBtn.classList.remove('btn-active');
      previewToggleBtn.textContent = '仕上がり確認';
      setMode(canvasUI.mode);
      hideNotice();
    }
    updateToolbarState();
  });

  resetBtn.addEventListener('click', () => resetConfirmBox.classList.remove('hidden'));
  resetConfirmNoBtn.addEventListener('click', () => resetConfirmBox.classList.add('hidden'));

  resetConfirmYesBtn.addEventListener('click', () => {
    resetConfirmBox.classList.add('hidden');
    revokeActiveExportUrl();
    currentImageMeta = null;
    rects = [];
    history.clear();
    canvasUI.setImage(null);
    isPreviewActive = false;
    previewToggleBtn.classList.remove('btn-active');
    previewToggleBtn.textContent = '仕上がり確認';
    hideNotice();
    hideUploadError();
    editorSection.classList.add('hidden');
    uploadSection.classList.remove('hidden');
    appState = 'EMPTY';
  });

  exportBtn.addEventListener('click', async () => {
    if (!currentImageMeta) return;

    appState = 'EXPORTING';
    exportBtn.disabled = true;
    exportBtn.textContent = '保存中...';

    try {
      const maskedCanvas = MaskerEngine.renderMaskedCanvas(currentImageMeta.canvas, rects);
      const exportResult = await ImageHandler.exportBlob(maskedCanvas, currentImageMeta.originalType);
      const saveName = ImageHandler.generateExportFileName(currentImageMeta.fileName, exportResult.extension);

      revokeActiveExportUrl();
      activeExportUrl = URL.createObjectURL(exportResult.blob);
      const a = document.createElement('a');
      a.href = activeExportUrl;
      a.download = saveName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      activeExportTimer = setTimeout(() => {
        revokeActiveExportUrl();
      }, 5000);

      let noticeMsg = 'マスキング済み画像を保存しました。保存した画像で、塗った部分と、検出対象外の情報が残っていないかを確認してください。';
      if (exportResult.formatChanged) {
        noticeMsg += `（※お使いのブラウザの対応状況により、${exportResult.extension.toUpperCase()} 形式で保存しました）`;
      }
      showNotice(noticeMsg, 'info');
    } catch (err) {
      const msg = (err && err.message) ? err.message : '出力画像の生成に失敗しました。';
      showNotice(`保存に失敗しました: ${msg} 再度「マスキング画像を保存」をお試しください。`, 'error');
    } finally {
      exportBtn.disabled = false;
      exportBtn.textContent = 'マスキング画像を保存';
      appState = 'REVIEW';
    }
  });

  // ---------------------------------------------------------------------------
  // キーボードショートカット
  // ---------------------------------------------------------------------------

  window.addEventListener('keydown', (e) => {
    if (appState !== 'REVIEW') return;

    if (e.key === ' ') {
      const tag = document.activeElement ? document.activeElement.tagName : '';
      if (tag !== 'BUTTON' && tag !== 'INPUT') {
        e.preventDefault();
      }
      if (!e.repeat) {
        canvasUI.setSpacePanActive(true);
      }
      return;
    }

    if (e.key === 'Escape') {
      if (isPreviewActive) {
        previewToggleBtn.click();
        return;
      }
      canvasUI.selectedRectId = null;
      canvasUI.render();
      updateToolbarState();
      return;
    }

    if (isPreviewActive) return;

    if ((e.key === 'Delete' || e.key === 'Backspace') && canvasUI.selectedRectId) {
      e.preventDefault();
      history.push(rects);
      rects = rects.filter(r => r.id !== canvasUI.selectedRectId);
      canvasUI.selectedRectId = null;
      canvasUI.setRects(rects);
      updateToolbarState();
      return;
    }

    const modKey = e.ctrlKey || e.metaKey;
    const keyLower = e.key.toLowerCase();

    if (modKey && !e.shiftKey && keyLower === 'z') {
      e.preventDefault();
      if (history.canUndo()) {
        const restored = history.undo(rects);
        if (restored) {
          rects = restored;
          canvasUI.setRects(rects);
          updateToolbarState();
        }
      }
      return;
    }

    if ((modKey && keyLower === 'y') || (modKey && e.shiftKey && keyLower === 'z')) {
      e.preventDefault();
      if (history.canRedo()) {
        const restored = history.redo(rects);
        if (restored) {
          rects = restored;
          canvasUI.setRects(rects);
          updateToolbarState();
        }
      }
    }
  });

  window.addEventListener('keyup', (e) => {
    if (e.key === ' ') {
      canvasUI.setSpacePanActive(false);
    }
  });
});
