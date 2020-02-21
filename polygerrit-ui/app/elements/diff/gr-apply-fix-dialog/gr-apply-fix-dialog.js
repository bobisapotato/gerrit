/**
 * @license
 * Copyright (C) 2019 The Android Open Source Project
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
(function() {
  'use strict';
  Polymer({
    is: 'gr-apply-fix-dialog',

    properties: {
      // Diff rendering preference API response.
      prefs: Array,
      // ChangeInfo API response object.
      change: Object,
      changeNum: String,
      _patchNum: Number,
      // robot ID associated with a robot comment.
      _robotId: String,
      // Selected FixSuggestionInfo entity from robot comment API response.
      _currentFix: Object,
      // Flattened /preview API response DiffInfo map object.
      _currentPreviews: {type: Array, value: () => []},
      // FixSuggestionInfo entities from robot comment API response.
      _fixSuggestions: Array,
      _isApplyFixLoading: {
        type: Boolean,
        value: false,
      },
      // Index of currently showing suggested fix.
      _selectedFixIdx: Number,
    },

    behaviors: [
      Gerrit.FireBehavior,
    ],

    /**
     * Given robot comment CustomEvent objevt, fetch diffs associated
     * with first robot comment suggested fix and open dialog.
     *
     * @param {*} e CustomEvent to be passed from gr-comment with
     * robot comment detail.
     * @return {Promise<undefined>} Promise that resolves either when all
     * preview diffs are fetched or no fix suggestions in custom event detail.
     */
    open(e) {
      this._patchNum = e.detail.patchNum;
      this._fixSuggestions = e.detail.comment.fix_suggestions;
      this._robotId = e.detail.comment.robot_id;
      if (this._fixSuggestions == null || this._fixSuggestions.length == 0) {
        return Promise.resolve();
      }
      this._selectedFixIdx = 0;
      const promises = [];
      promises.push(
          this._showSelectedFixSuggestion(this._fixSuggestions[0]),
          this.$.applyFixOverlay.open()
      );
      return Promise.all(promises)
          .then(() => {
            // ensures gr-overlay repositions overlay in center
            this.$.applyFixOverlay.fire('iron-resize');
          });
    },

    attached() {
      this.refitOverlay = () => {
        // re-center the dialog as content changed
        this.$.applyFixOverlay.fire('iron-resize');
      };
      this.addEventListener('diff-context-expanded', this.refitOverlay);
    },

    detached() {
      this.removeEventListener('diff-context-expanded', this.refitOverlay);
    },

    _showSelectedFixSuggestion(fixSuggestion) {
      this._currentFix = fixSuggestion;
      return this._fetchFixPreview(fixSuggestion.fix_id);
    },

    _fetchFixPreview(fixId) {
      return this.$.restAPI
          .getRobotCommentFixPreview(this.changeNum, this._patchNum, fixId)
          .then(res => {
            if (res != null) {
              const previews = Object.keys(res).map(key => {
                return {filepath: key, preview: res[key]};
              });
              this._currentPreviews = previews;
            }
          })
          .catch(err => {
            this._close();
            throw err;
          });
    },

    hasSingleFix(_fixSuggestions) {
      return (_fixSuggestions || {}).length === 1;
    },

    overridePartialPrefs(prefs) {
      // generate a smaller gr-diff than fullscreen for dialog
      return Object.assign({}, prefs, {line_length: 50});
    },

    onCancel(e) {
      if (e) {
        e.stopPropagation();
      }
      this._close();
    },

    addOneTo(_selectedFixIdx) {
      return _selectedFixIdx + 1;
    },

    _onPrevFixClick(e) {
      if (e) e.stopPropagation();
      if (this._selectedFixIdx >= 1 && this._fixSuggestions != null) {
        this._selectedFixIdx -= 1;
        return this._showSelectedFixSuggestion(
            this._fixSuggestions[this._selectedFixIdx]);
      }
    },

    _onNextFixClick(e) {
      if (e) e.stopPropagation();
      if (this._selectedFixIdx < this._fixSuggestions.length &&
        this._fixSuggestions != null) {
        this._selectedFixIdx += 1;
        return this._showSelectedFixSuggestion(
            this._fixSuggestions[this._selectedFixIdx]);
      }
    },

    _noPrevFix(_selectedFixIdx) {
      return _selectedFixIdx === 0;
    },

    _noNextFix(_selectedFixIdx, fixSuggestions) {
      if (fixSuggestions == null) return true;
      return _selectedFixIdx === fixSuggestions.length - 1;
    },

    _close() {
      this._currentFix = {};
      this._currentPreviews = [];
      this._isApplyFixLoading = false;

      this.dispatchEvent(new CustomEvent('close-fix-preview', {
        bubbles: true,
        composed: true,
      }));
      this.$.applyFixOverlay.close();
    },

    _getApplyFixButtonLabel(isLoading) {
      return isLoading ? 'Saving...' : 'Apply Fix';
    },

    _handleApplyFix(e) {
      if (e) {
        e.stopPropagation();
      }
      if (this._currentFix == null || this._currentFix.fix_id == null) {
        return;
      }
      this._isApplyFixLoading = true;
      return this.$.restAPI.applyFixSuggestion(this.changeNum, this._patchNum,
          this._currentFix.fix_id).then(res => {
        Gerrit.Nav.navigateToChange(this.change, 'edit', this._patchNum);
        this._close();
      });
    },

    getFixDescription(currentFix) {
      return currentFix != null && currentFix.description ?
        currentFix.description : '';
    },
  });
})();
