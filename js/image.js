/**
 * 個人情報自動マスキングツール
 * 画像処理モジュール (image.js)
 *
 * 画像の読み込み、Exif向き反映、画素数制限チェック・縮小、
 * 基準Canvasの生成、およびマスキング後Blobの出力を担当する。
 */

const ImageHandler = (() => {
  // 総画素数の上限（約1,600万画素: 例 4000x4000 等）
  const MAX_PIXELS = 16000000;

  // サポートするMIMEタイプ
  const SUPPORTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

  /**
   * ファイルからMIMEタイプを取得する（file.typeが空の場合は拡張子から補完）
   * @param {File} file
   * @returns {string}
   */
  function resolveMimeType(file) {
    if (!file) return '';
    if (file.type) {
      return file.type.toLowerCase();
    }
    const name = (file.name || '').toLowerCase();
    if (name.endsWith('.jpg') || name.endsWith('.jpeg')) return 'image/jpeg';
    if (name.endsWith('.png')) return 'image/png';
    if (name.endsWith('.webp')) return 'image/webp';
    return '';
  }

  /**
   * ファイルがサポート対象形式かを検証する
   * @param {File} file
   * @returns {boolean}
   */
  function isSupported(file) {
    const mime = resolveMimeType(file);
    return SUPPORTED_TYPES.includes(mime);
  }

  /**
   * 画像ファイルを読み込み、Exif向きを反映した基準Canvasを生成する
   * @param {File} file
   * @returns {Promise<{
   *   canvas: HTMLCanvasElement,
   *   width: number,
   *   height: number,
   *   originalWidth: number,
   *   originalHeight: number,
   *   isResized: boolean,
   *   originalType: string,
   *   fileName: string
   * }>}
   */
  async function loadAndDecode(file) {
    const resolvedType = resolveMimeType(file);
    if (!SUPPORTED_TYPES.includes(resolvedType)) {
      throw new Error('非対応のファイル形式です。JPEG（.jpg / .jpeg）、PNG（.png）、WebP（.webp）形式の画像ファイルを選択してください。');
    }

    let imageSource = null;
    let rawWidth = 0;
    let rawHeight = 0;

    // createImageBitmap による Exif 向き反映を試行
    if (typeof window.createImageBitmap === 'function') {
      try {
        imageSource = await window.createImageBitmap(file, { imageOrientation: 'from-image' });
        rawWidth = imageSource.width;
        rawHeight = imageSource.height;
      } catch (e) {
        // createImageBitmap失敗時のフォールバックへ
        imageSource = null;
      }
    }

    // createImageBitmap が使えない、または失敗した場合は Image 要素でデコード
    if (!imageSource) {
      imageSource = await new Promise((resolve, reject) => {
        const img = new Image();
        const objectUrl = URL.createObjectURL(file);
        img.onload = () => {
          URL.revokeObjectURL(objectUrl);
          resolve(img);
        };
        img.onerror = () => {
          URL.revokeObjectURL(objectUrl);
          reject(new Error('画像の読み込み・デコードに失敗しました。ファイルが破損している可能性があります。'));
        };
        img.src = objectUrl;
      });
      rawWidth = imageSource.naturalWidth || imageSource.width;
      rawHeight = imageSource.naturalHeight || imageSource.height;
    }

    // 画素数上限のチェックと縮小比率の算出
    const totalPixels = rawWidth * rawHeight;
    let targetWidth = rawWidth;
    let targetHeight = rawHeight;
    let isResized = false;

    if (totalPixels > MAX_PIXELS) {
      const scale = Math.sqrt(MAX_PIXELS / totalPixels);
      targetWidth = Math.max(1, Math.round(rawWidth * scale));
      targetHeight = Math.max(1, Math.round(rawHeight * scale));
      isResized = true;
    }

    // 基準Canvasを作成して等倍描画
    const baseCanvas = document.createElement('canvas');
    baseCanvas.width = targetWidth;
    baseCanvas.height = targetHeight;
    const ctx = baseCanvas.getContext('2d', { alpha: true });
    ctx.drawImage(imageSource, 0, 0, targetWidth, targetHeight);

    // ImageBitmapのリソース解放
    if (imageSource.close && typeof imageSource.close === 'function') {
      imageSource.close();
    }

    return {
      canvas: baseCanvas,
      width: targetWidth,
      height: targetHeight,
      originalWidth: rawWidth,
      originalHeight: rawHeight,
      isResized,
      originalType: resolvedType,
      fileName: file.name
    };
  }

  /**
   * 出力MIMEタイプと品質を決定する
   * @param {string} originalType
   * @returns {{ mimeType: string, quality: number|undefined, extension: string }}
   */
  function getExportFormat(originalType) {
    switch (originalType) {
      case 'image/jpeg':
        return { mimeType: 'image/jpeg', quality: 0.92, extension: 'jpg' };
      case 'image/webp':
        return { mimeType: 'image/webp', quality: 0.92, extension: 'webp' };
      case 'image/png':
      default:
        return { mimeType: 'image/png', quality: undefined, extension: 'png' };
    }
  }

  /**
   * 拡張子から適切な形式情報を逆引きする
   * @param {string} mimeType
   * @returns {string} 拡張子
   */
  function mimeToExtension(mimeType) {
    switch (mimeType) {
      case 'image/jpeg': return 'jpg';
      case 'image/webp': return 'webp';
      case 'image/png': return 'png';
      default: return 'png';
    }
  }

  /**
   * マスキング後CanvasからBlobを生成する
   * @param {HTMLCanvasElement} canvas
   * @param {string} originalType 元のMIMEタイプ
   * @returns {Promise<{ blob: Blob, actualType: string, extension: string, formatChanged: boolean }>}
   */
  function exportBlob(canvas, originalType) {
    const format = getExportFormat(originalType);

    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error('画像Blobの生成に失敗しました。'));
          return;
        }

        const actualType = blob.type;
        const formatChanged = actualType !== format.mimeType;
        const extension = mimeToExtension(actualType);

        resolve({
          blob,
          actualType,
          extension,
          formatChanged
        });
      }, format.mimeType, format.quality);
    });
  }

  /**
   * 元ファイル名に基づき保存ファイル名を生成する
   * @param {string} originalFileName
   * @param {string} extension
   * @returns {string} 例: sample_masked.jpg
   */
  function generateExportFileName(originalFileName, extension) {
    const dotIndex = originalFileName.lastIndexOf('.');
    const baseName = dotIndex !== -1 ? originalFileName.substring(0, dotIndex) : originalFileName;
    return `${baseName}_masked.${extension}`;
  }

  return {
    isSupported,
    loadAndDecode,
    exportBlob,
    generateExportFileName
  };
})();

