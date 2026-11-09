/**
 * 個人情報自動マスキングツール
 * マスキングエンジン (masker.js)
 *
 * 矩形データモデルの生成・管理、余白計算、不可逆塗りつぶし（黒塗り）を担当する。
 */

const MaskerEngine = (() => {
  let idCounter = 1;

  /**
   * 一意な矩形IDを生成する
   * @returns {string} 例: "rect-1"
   */
  function generateId() {
    return `rect-${idCounter++}`;
  }

  /**
   * 手動マスキング矩形オブジェクトを生成する
   * @param {number} x
   * @param {number} y
   * @param {number} width
   * @param {number} height
   * @param {number} imageWidth
   * @param {number} imageHeight
   * @returns {Object|null} 8px未満の場合はnull
   */
  function createManualRect(x, y, width, height, imageWidth, imageHeight) {
    // 負の幅・高さを正規化
    let normX = width < 0 ? x + width : x;
    let normY = height < 0 ? y + height : y;
    let normW = Math.abs(width);
    let normH = Math.abs(height);

    // 画像範囲内にクランプ
    normX = Math.max(0, Math.min(imageWidth, normX));
    normY = Math.max(0, Math.min(imageHeight, normY));
    normW = Math.min(imageWidth - normX, normW);
    normH = Math.min(imageHeight - normY, normH);

    // 最小サイズ判定（基準画像座標で8x8画素以上）
    if (normW < 8 || normH < 8) {
      return null;
    }

    return {
      id: generateId(),
      type: 'manual',
      source: 'manual',
      x: Math.round(normX),
      y: Math.round(normY),
      width: Math.round(normW),
      height: Math.round(normH),
      level: null,
      score: null,
      selected: true
    };
  }

  /**
   * 塗り用の余白（マージン）を計算する
   * 仕様: margin = max(2, round(min(width, height) * 0.1))
   * @param {number} width
   * @param {number} height
   * @returns {number} 余白画素数
   */
  function calculateMargin(width, height) {
    return Math.max(2, Math.round(Math.min(width, height) * 0.1));
  }

  /**
   * 余白を適用した塗り用矩形領域を計算する（画像境界でクリッピング）
   * @param {Object} rect
   * @param {number} imageWidth
   * @param {number} imageHeight
   * @returns {{ x: number, y: number, width: number, height: number }}
   */
  function getExpandedBounds(rect, imageWidth, imageHeight) {
    const margin = calculateMargin(rect.width, rect.height);
    const x = Math.max(0, rect.x - margin);
    const y = Math.max(0, rect.y - margin);
    const right = Math.min(imageWidth, rect.x + rect.width + margin);
    const bottom = Math.min(imageHeight, rect.y + rect.height + margin);

    return {
      x,
      y,
      width: Math.max(0, right - x),
      height: Math.max(0, bottom - y)
    };
  }

  /**
   * 基準画像と矩形リストから、不可逆マスキングを適用した新しいCanvasを生成する
   * @param {HTMLCanvasElement} baseCanvas 基準画像Canvas
   * @param {Array<Object>} rects 矩形オブジェクト配列
   * @returns {HTMLCanvasElement} マスキング適用済みCanvas
   */
  function renderMaskedCanvas(baseCanvas, rects) {
    const outputCanvas = document.createElement('canvas');
    outputCanvas.width = baseCanvas.width;
    outputCanvas.height = baseCanvas.height;

    const ctx = outputCanvas.getContext('2d', { alpha: true });
    // 基準画像を等倍で転写
    ctx.drawImage(baseCanvas, 0, 0);

    // 採用されている矩形に不可逆黒塗りつぶし（余白つき）を適用
    ctx.fillStyle = '#000000';

    for (const rect of rects) {
      if (!rect.selected) continue;
      const bounds = getExpandedBounds(rect, baseCanvas.width, baseCanvas.height);
      if (bounds.width > 0 && bounds.height > 0) {
        ctx.fillRect(bounds.x, bounds.y, bounds.width, bounds.height);
      }
    }

    return outputCanvas;
  }

  return {
    createManualRect,
    calculateMargin,
    getExpandedBounds,
    renderMaskedCanvas
  };
})();

