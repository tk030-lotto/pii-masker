/**
 * 個人情報自動マスキングツール
 * 履歴管理モジュール (history.js)
 *
 * 矩形スナップショットのUndo/Redoを管理する。
 * 画像データは保持せず、矩形配列のみを最大50件保存する。
 */

class HistoryManager {
  /**
   * @param {number} maxSize 最大履歴保持件数
   */
  constructor(maxSize = 50) {
    this.maxSize = maxSize;
    this.undoStack = [];
    this.redoStack = [];
  }

  /**
   * 矩形配列のディープコピーを生成する
   * @param {Array<Object>} items 矩形オブジェクト配列
   * @returns {Array<Object>} コピーされた配列
   * @private
   */
  _clone(items) {
    return items.map(item => ({ ...item }));
  }

  /**
   * 現在の状態を履歴に記録する
   * 新しい操作が行われたため、redoStackは破棄される
   * @param {Array<Object>} items 保存する矩形配列
   */
  push(items) {
    if (!Array.isArray(items)) return;
    this.undoStack.push(this._clone(items));
    if (this.undoStack.length > this.maxSize) {
      this.undoStack.shift();
    }
    this.redoStack = [];
  }

  /**
   * 直前の状態を取り消す
   * @param {Array<Object>} currentItems 現在の矩形配列
   * @returns {Array<Object>|null} 復元された矩形配列、取り消し不可の場合はnull
   */
  undo(currentItems) {
    if (!this.canUndo()) return null;
    const previous = this.undoStack.pop();
    this.redoStack.push(this._clone(currentItems));
    return this._clone(previous);
  }

  /**
   * 取り消した操作をやり直す
   * @param {Array<Object>} currentItems 現在の矩形配列
   * @returns {Array<Object>|null} 復元された矩形配列、やり直し不可の場合はnull
   */
  redo(currentItems) {
    if (!this.canRedo()) return null;
    const next = this.redoStack.pop();
    this.undoStack.push(this._clone(currentItems));
    return this._clone(next);
  }

  /**
   * 取り消し可能かを返す
   * @returns {boolean}
   */
  canUndo() {
    return this.undoStack.length > 0;
  }

  /**
   * やり直し可能かを返す
   * @returns {boolean}
   */
  canRedo() {
    return this.redoStack.length > 0;
  }

  /**
   * 履歴をすべて消去する
   */
  clear() {
    this.undoStack = [];
    this.redoStack = [];
  }
}

