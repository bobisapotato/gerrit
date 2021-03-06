/**
 * @license
 * Copyright (C) 2015 The Android Open Source Project
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

import '../../../test/common-test-setup-karma.js';
import {IronOverlayManager} from '@polymer/iron-overlay-behavior/iron-overlay-manager.js';
import './gr-reply-dialog.js';
import {mockPromise} from '../../../test/test-utils.js';
import {SpecialFilePath} from '../../../constants/constants.js';
import {appContext} from '../../../services/app-context.js';
import {addListenerForTest} from '../../../test/test-utils.js';
import {stubRestApi} from '../../../test/test-utils.js';
import {JSON_PREFIX} from '../../shared/gr-rest-api-interface/gr-rest-apis/gr-rest-api-helper.js';
import {CODE_REVIEW} from '../../../utils/label-util.js';
import {createAccountWithId} from '../../../test/test-data-generators.js';

const basicFixture = fixtureFromElement('gr-reply-dialog');

function cloneableResponse(status, text) {
  return {
    ok: false,
    status,
    text() {
      return Promise.resolve(text);
    },
    clone() {
      return {
        ok: false,
        status,
        text() {
          return Promise.resolve(text);
        },
      };
    },
  };
}

suite('gr-reply-dialog tests', () => {
  let element;
  let changeNum;
  let patchNum;

  let getDraftCommentStub;
  let setDraftCommentStub;
  let eraseDraftCommentStub;

  let lastId = 0;
  const makeAccount = function() { return {_account_id: lastId++}; };
  const makeGroup = function() { return {id: lastId++}; };

  setup(() => {
    changeNum = 42;
    patchNum = 1;

    stubRestApi('getConfig').returns(Promise.resolve({}));
    stubRestApi('getAccount').returns(Promise.resolve({}));
    stubRestApi('getChange').returns(Promise.resolve({}));
    stubRestApi('getChangeSuggestedReviewers').returns(Promise.resolve([]));

    sinon.stub(appContext.flagsService, 'isEnabled').returns(true);

    element = basicFixture.instantiate();
    element.change = {
      _number: changeNum,
      owner: {
        _account_id: 999,
        display_name: 'Kermit',
      },
      labels: {
        'Verified': {
          values: {
            '-1': 'Fails',
            ' 0': 'No score',
            '+1': 'Verified',
          },
          default_value: 0,
        },
        'Code-Review': {
          values: {
            '-2': 'Do not submit',
            '-1': 'I would prefer that you didn\'t submit this',
            ' 0': 'No score',
            '+1': 'Looks good to me, but someone else must approve',
            '+2': 'Looks good to me, approved',
          },
          default_value: 0,
        },
      },
    };
    element.patchNum = patchNum;
    element.permittedLabels = {
      'Code-Review': [
        '-1',
        ' 0',
        '+1',
      ],
      'Verified': [
        '-1',
        ' 0',
        '+1',
      ],
    };

    getDraftCommentStub = sinon.stub(element.storage, 'getDraftComment');
    setDraftCommentStub = sinon.stub(element.storage, 'setDraftComment');
    eraseDraftCommentStub = sinon.stub(element.storage, 'eraseDraftComment');

    // sinon.stub(patchSetUtilMockProxy, 'fetchChangeUpdates')
    //     .returns(Promise.resolve({isLatest: true}));

    // Allow the elements created by dom-repeat to be stamped.
    flush();
  });

  function stubSaveReview(jsonResponseProducer) {
    return sinon.stub(
        element,
        '_saveReview')
        .callsFake(review => new Promise((resolve, reject) => {
          try {
            const result = jsonResponseProducer(review) || {};
            const resultStr = JSON_PREFIX + JSON.stringify(result);
            resolve({
              ok: true,
              text() {
                return Promise.resolve(resultStr);
              },
            });
          } catch (err) {
            reject(err);
          }
        }));
  }

  test('default to publishing draft comments with reply', done => {
    // Async tick is needed because iron-selector content is distributed and
    // distributed content requires an observer to be set up.
    // Note: Double flush seems to be needed in Safari. {@see Issue 4963}.
    flush(() => {
      flush(() => {
        element.draft = 'I wholeheartedly disapprove';

        stubSaveReview(review => {
          assert.deepEqual(review, {
            drafts: 'PUBLISH_ALL_REVISIONS',
            labels: {
              'Code-Review': 0,
              'Verified': 0,
            },
            comments: {
              [SpecialFilePath.PATCHSET_LEVEL_COMMENTS]: [{
                message: 'I wholeheartedly disapprove',
                unresolved: false,
              }],
            },
            reviewers: [],
          });
          assert.isFalse(element.$.commentList.hidden);
          done();
        });

        // This is needed on non-Blink engines most likely due to the ways in
        // which the dom-repeat elements are stamped.
        flush(() => {
          MockInteractions.tap(element.shadowRoot
              .querySelector('.send'));
        });
      });
    });
  });

  test('modified attention set', done => {
    element.serverConfig = {
      change: {enable_attention_set: true},
    };
    element._newAttentionSet = new Set([314]);
    const buttonEl = element.shadowRoot.querySelector('.edit-attention-button');
    MockInteractions.tap(buttonEl);
    flush();

    stubSaveReview(review => {
      assert.isTrue(review.ignore_automatic_attention_set_rules);
      assert.deepEqual(review.add_to_attention_set, [{
        user: 314,
        reason: 'Anonymous replied on the change',
      }]);
      assert.deepEqual(review.remove_from_attention_set, []);
      done();
    });
    MockInteractions.tap(element.shadowRoot.querySelector('.send'));
  });

  function checkComputeAttention(status, userId, reviewerIds, ownerId,
      attSetIds, replyToIds, expectedIds, uploaderId, hasDraft,
      includeComments = true) {
    const user = {_account_id: userId};
    const reviewers = {base: reviewerIds.map(id => {
      return {_account_id: id};
    })};
    const draftThreads = [
      {comments: []},
    ];
    if (hasDraft) {
      draftThreads[0].comments.push({__draft: true, unresolved: true});
    }
    replyToIds.forEach(id => draftThreads[0].comments.push({
      author: {_account_id: id},
    }));
    const change = {
      owner: {_account_id: ownerId},
      status,
      attention_set: {},
    };
    attSetIds.forEach(id => change.attention_set[id] = {});
    if (uploaderId) {
      change.current_revision = 1;
      change.revisions = [{}, {uploader: {_account_id: uploaderId}}];
    }
    element.change = change;
    element._reviewers = reviewers.base;

    flush();
    const hasDrafts = draftThreads.length > 0;
    element._computeNewAttention(
        user, reviewers, [], change, draftThreads, includeComments, undefined,
        hasDrafts);
    assert.sameMembers([...element._newAttentionSet], expectedIds);
  }

  test('computeNewAttention NEW', () => {
    checkComputeAttention('NEW', null, [], 999, [], [], [999]);
    checkComputeAttention('NEW', 1, [], 999, [], [], [999]);
    checkComputeAttention('NEW', 1, [], 999, [1], [], [999]);
    checkComputeAttention('NEW', 1, [22], 999, [], [], [999]);
    checkComputeAttention('NEW', 1, [22], 999, [22], [], [22, 999]);
    checkComputeAttention('NEW', 1, [22], 999, [], [22], [22, 999]);
    checkComputeAttention('NEW', 1, [22, 33], 999, [33], [22], [22, 33, 999]);
    // If the owner replies, then do not add them.
    checkComputeAttention('NEW', 1, [], 1, [], [], []);
    checkComputeAttention('NEW', 1, [], 1, [1], [], []);
    checkComputeAttention('NEW', 1, [22], 1, [], [], []);

    checkComputeAttention('NEW', 1, [22], 1, [], [22], [22]);
    checkComputeAttention('NEW', 1, [22, 33], 1, [33], [22], [22, 33]);
    checkComputeAttention('NEW', 1, [22, 33], 1, [], [22], [22]);
    checkComputeAttention('NEW', 1, [22, 33], 1, [], [22, 33], [22, 33]);
    checkComputeAttention('NEW', 1, [22, 33], 1, [22, 33], [], [22, 33]);
    // with uploader
    checkComputeAttention('NEW', 1, [], 1, [], [2], [2], 2);
    checkComputeAttention('NEW', 1, [], 1, [2], [], [2], 2);
    checkComputeAttention('NEW', 1, [], 3, [], [], [2, 3], 2);
  });

  test('computeNewAttention MERGED', () => {
    checkComputeAttention('MERGED', null, [], 999, [], [], []);
    checkComputeAttention('MERGED', 1, [], 999, [], [], []);
    checkComputeAttention('MERGED', 1, [], 999, [], [], [999], undefined, true);
    checkComputeAttention(
        'MERGED', 1, [], 999, [], [], [], undefined, true, false);
    checkComputeAttention('MERGED', 1, [], 999, [1], [], []);
    checkComputeAttention('MERGED', 1, [22], 999, [], [], []);
    checkComputeAttention('MERGED', 1, [22], 999, [22], [], [22]);
    checkComputeAttention('MERGED', 1, [22], 999, [], [22], []);
    checkComputeAttention('MERGED', 1, [22, 33], 999, [33], [22], [33]);
    checkComputeAttention('MERGED', 1, [], 1, [], [], []);
    checkComputeAttention('MERGED', 1, [], 1, [], [], [], undefined, true);
    checkComputeAttention('MERGED', 1, [], 1, [1], [], []);
    checkComputeAttention('MERGED', 1, [], 1, [1], [], [], undefined, true);
    checkComputeAttention('MERGED', 1, [22], 1, [], [], []);
    checkComputeAttention('MERGED', 1, [22], 1, [], [22], []);
    checkComputeAttention('MERGED', 1, [22, 33], 1, [33], [22], [33]);
    checkComputeAttention('MERGED', 1, [22, 33], 1, [], [22], []);
    checkComputeAttention('MERGED', 1, [22, 33], 1, [], [22, 33], []);
    checkComputeAttention('MERGED', 1, [22, 33], 1, [22, 33], [], [22, 33]);
  });

  test('computeNewAttention when adding reviewers', () => {
    const user = {_account_id: 1};
    const reviewers = {base: [
      {_account_id: 1, _pendingAdd: true},
      {_account_id: 2, _pendingAdd: true},
    ]};
    const change = {
      owner: {_account_id: 5},
      status: 'NEW',
      attention_set: {},
    };
    element.change = change;
    element._reviewers = reviewers.base;
    flush();

    element._computeNewAttention(user, reviewers, [], change, [], true);
    assert.sameMembers([...element._newAttentionSet], [1, 2]);

    // If the user votes on the change, then they should not be added to the
    // attention set, even if they have just added themselves as reviewer.
    // But voting should also add the owner (5).
    const labelsChanged = true;
    element._computeNewAttention(
        user, reviewers, [], change, [], true, labelsChanged);
    assert.sameMembers([...element._newAttentionSet], [2, 5]);
  });

  test('computeNewAttention when sending wip change for review', () => {
    const reviewers = {base: [
      {_account_id: 2},
      {_account_id: 3},
    ]};
    const change = {
      owner: {_account_id: 1},
      status: 'NEW',
      attention_set: {},
    };
    element.change = change;
    element._reviewers = reviewers.base;
    flush();

    // For an active change there is no reason to add anyone to the set.
    let user = {_account_id: 1};
    element._computeNewAttention(user, reviewers, [], change, [], false);
    assert.sameMembers([...element._newAttentionSet], []);

    // If the change is "work in progress" and the owner sends a reply, then
    // add all reviewers.
    element.canBeStarted = true;
    flush();
    user = {_account_id: 1};
    element._computeNewAttention(user, reviewers, [], change, [], false);
    assert.sameMembers([...element._newAttentionSet], [2, 3]);

    // ... but not when someone else replies.
    user = {_account_id: 4};
    element._computeNewAttention(user, reviewers, [], change, [], false);
    assert.sameMembers([...element._newAttentionSet], []);
  });

  test('computeNewAttentionAccounts', () => {
    element._reviewers = [
      {_account_id: 123, display_name: 'Ernie'},
      {_account_id: 321, display_name: 'Bert'},
    ];
    element._ccs = [
      {_account_id: 7, display_name: 'Elmo'},
    ];
    const compute = (currentAtt, newAtt) =>
      element._computeNewAttentionAccounts(
          undefined, new Set(currentAtt), new Set(newAtt))
          .map(a => a._account_id);

    assert.sameMembers(compute([], []), []);
    assert.sameMembers(compute([], [999]), [999]);
    assert.sameMembers(compute([999], []), []);
    assert.sameMembers(compute([999], [999]), []);
    assert.sameMembers(compute([123, 321], [999]), [999]);
    assert.sameMembers(compute([999], [7, 123, 999]), [7, 123]);
  });

  test('_computeCommentAccounts', () => {
    element.change = {
      labels: {
        'Code-Review': {
          all: [
            {_account_id: 1, value: 0},
            {_account_id: 2, value: 1},
            {_account_id: 3, value: 2},
          ],
          values: {
            '-2': 'Do not submit',
            '-1': 'I would prefer that you didnt submit this',
            ' 0': 'No score',
            '+1': 'Looks good to me, but someone else must approve',
            '+2': 'Looks good to me, approved',
          },
        },
      },
    };
    const threads = [
      {
        comments: [
          {author: {_account_id: 1}, unresolved: false},
          {author: {_account_id: 2}, unresolved: true},
        ],
      },
      {
        comments: [
          {author: {_account_id: 3}, unresolved: false},
          {author: {_account_id: 4}, unresolved: false},
        ],
      },
    ];
    const actualAccounts = [...element._computeCommentAccounts(threads)];
    // Account 3 is not included, because the comment is resolved *and* they
    // have given the highest possible vote on the Code-Review label.
    assert.sameMembers(actualAccounts, [1, 2, 4]);
  });

  test('toggle resolved checkbox', done => {
    // Async tick is needed because iron-selector content is distributed and
    // distributed content requires an observer to be set up.
    // Note: Double flush seems to be needed in Safari. {@see Issue 4963}.
    const checkboxEl = element.shadowRoot.querySelector(
        '#resolvedPatchsetLevelCommentCheckbox');
    MockInteractions.tap(checkboxEl);
    flush(() => {
      flush(() => {
        element.draft = 'I wholeheartedly disapprove';

        stubSaveReview(review => {
          assert.deepEqual(review, {
            drafts: 'PUBLISH_ALL_REVISIONS',
            labels: {
              'Code-Review': 0,
              'Verified': 0,
            },
            comments: {
              [SpecialFilePath.PATCHSET_LEVEL_COMMENTS]: [{
                message: 'I wholeheartedly disapprove',
                unresolved: true,
              }],
            },
            reviewers: [],
          });
          done();
        });

        // This is needed on non-Blink engines most likely due to the ways in
        // which the dom-repeat elements are stamped.
        flush(() => {
          MockInteractions.tap(element.shadowRoot
              .querySelector('.send'));
        });
      });
    });
  });

  test('keep draft comments with reply', done => {
    MockInteractions.tap(element.shadowRoot.querySelector('#includeComments'));
    assert.equal(element._includeComments, false);

    // Async tick is needed because iron-selector content is distributed and
    // distributed content requires an observer to be set up.
    // Note: Double flush seems to be needed in Safari. {@see Issue 4963}.
    flush(() => {
      flush(() => {
        element.draft = 'I wholeheartedly disapprove';

        stubSaveReview(review => {
          assert.deepEqual(review, {
            drafts: 'KEEP',
            labels: {
              'Code-Review': 0,
              'Verified': 0,
            },
            comments: {
              [SpecialFilePath.PATCHSET_LEVEL_COMMENTS]: [{
                message: 'I wholeheartedly disapprove',
                unresolved: false,
              }],
            },
            reviewers: [],
          });
          assert.isTrue(element.$.commentList.hidden);
          done();
        });

        // This is needed on non-Blink engines most likely due to the ways in
        // which the dom-repeat elements are stamped.
        flush(() => {
          MockInteractions.tap(element.shadowRoot
              .querySelector('.send'));
        });
      });
    });
  });

  test('label picker', done => {
    element.draft = 'I wholeheartedly disapprove';
    stubSaveReview(review => {
      assert.deepEqual(review, {
        drafts: 'PUBLISH_ALL_REVISIONS',
        labels: {
          'Code-Review': -1,
          'Verified': -1,
        },
        comments: {
          [SpecialFilePath.PATCHSET_LEVEL_COMMENTS]: [{
            message: 'I wholeheartedly disapprove',
            unresolved: false,
          }],
        },
        reviewers: [],
      });
    });

    sinon.stub(element.$.labelScores, 'getLabelValues').callsFake( () => {
      return {
        'Code-Review': -1,
        'Verified': -1,
      };
    });

    element.addEventListener('send', () => {
      // Flush to ensure properties are updated.
      flush(() => {
        assert.isFalse(element.disabled,
            'Element should be enabled when done sending reply.');
        assert.equal(element.draft.length, 0);
        done();
      });
    });

    // This is needed on non-Blink engines most likely due to the ways in
    // which the dom-repeat elements are stamped.
    flush(() => {
      MockInteractions.tap(element.shadowRoot
          .querySelector('.send'));
      assert.isTrue(element.disabled);
    });
  });

  test('getlabelValue returns value', done => {
    flush(() => {
      element.shadowRoot
          .querySelector('gr-label-scores')
          .shadowRoot
          .querySelector(`gr-label-score-row[name="Verified"]`)
          .setSelectedValue(-1);
      assert.equal('-1', element.getLabelValue('Verified'));
      done();
    });
  });

  test('getlabelValue when no score is selected', done => {
    flush(() => {
      element.shadowRoot
          .querySelector('gr-label-scores')
          .shadowRoot
          .querySelector(`gr-label-score-row[name="Code-Review"]`)
          .setSelectedValue(-1);
      assert.strictEqual(element.getLabelValue('Verified'), ' 0');
      done();
    });
  });

  test('setlabelValue', done => {
    element._account = {_account_id: 1};
    flush(() => {
      const label = 'Verified';
      const value = '+1';
      element.setLabelValue(label, value);

      const labels = element.$.labelScores.getLabelValues();
      assert.deepEqual(labels, {
        'Code-Review': 0,
        'Verified': 1,
      });
      done();
    });
  });

  function getActiveElement() {
    return IronOverlayManager.deepActiveElement;
  }

  function isVisible(el) {
    assert.ok(el);
    return getComputedStyle(el).getPropertyValue('display') != 'none';
  }

  function overlayObserver(mode) {
    return new Promise(resolve => {
      function listener() {
        element.removeEventListener('iron-overlay-' + mode, listener);
        resolve();
      }
      element.addEventListener('iron-overlay-' + mode, listener);
    });
  }

  function isFocusInsideElement(element) {
    // In Polymer 2 focused element either <paper-input> or nested
    // native input <input> element depending on the current focus
    // in browser window.
    // For example, the focus is changed if the developer console
    // get a focus.
    let activeElement = getActiveElement();
    while (activeElement) {
      if (activeElement === element) {
        return true;
      }
      if (activeElement.parentElement) {
        activeElement = activeElement.parentElement;
      } else {
        activeElement = activeElement.getRootNode().host;
      }
    }
    return false;
  }

  function testConfirmationDialog(done, cc) {
    const yesButton = element
        .shadowRoot
        .querySelector('.reviewerConfirmationButtons gr-button:first-child');
    const noButton = element
        .shadowRoot
        .querySelector('.reviewerConfirmationButtons gr-button:last-child');

    element._ccPendingConfirmation = null;
    element._reviewerPendingConfirmation = null;
    flush();
    assert.isFalse(isVisible(element.$.reviewerConfirmationOverlay));

    // Cause the confirmation dialog to display.
    let observer = overlayObserver('opened');
    const group = {
      id: 'id',
      name: 'name',
    };
    if (cc) {
      element._ccPendingConfirmation = {
        group,
        count: 10,
      };
    } else {
      element._reviewerPendingConfirmation = {
        group,
        count: 10,
      };
    }
    flush();

    if (cc) {
      assert.deepEqual(
          element._ccPendingConfirmation,
          element._pendingConfirmationDetails);
    } else {
      assert.deepEqual(
          element._reviewerPendingConfirmation,
          element._pendingConfirmationDetails);
    }

    observer
        .then(() => {
          assert.isTrue(isVisible(element.$.reviewerConfirmationOverlay));
          observer = overlayObserver('closed');
          const expected = 'Group name has 10 members';
          assert.notEqual(
              element.$.reviewerConfirmationOverlay.innerText
                  .indexOf(expected),
              -1);
          MockInteractions.tap(noButton); // close the overlay
          return observer;
        }).then(() => {
          assert.isFalse(isVisible(element.$.reviewerConfirmationOverlay));

          // We should be focused on account entry input.
          assert.isTrue(
              isFocusInsideElement(
                  element.$.reviewers.$.entry.$.input.$.input
              )
          );

          // No reviewer/CC should have been added.
          assert.equal(element.$.ccs.additions().length, 0);
          assert.equal(element.$.reviewers.additions().length, 0);

          // Reopen confirmation dialog.
          observer = overlayObserver('opened');
          if (cc) {
            element._ccPendingConfirmation = {
              group,
              count: 10,
            };
          } else {
            element._reviewerPendingConfirmation = {
              group,
              count: 10,
            };
          }
          return observer;
        })
        .then(() => {
          assert.isTrue(isVisible(element.$.reviewerConfirmationOverlay));
          observer = overlayObserver('closed');
          MockInteractions.tap(yesButton); // Confirm the group.
          return observer;
        })
        .then(() => {
          assert.isFalse(isVisible(element.$.reviewerConfirmationOverlay));
          const additions = cc ?
            element.$.ccs.additions() :
            element.$.reviewers.additions();
          assert.deepEqual(
              additions,
              [
                {
                  group: {
                    id: 'id',
                    name: 'name',
                    confirmed: true,
                    _group: true,
                    _pendingAdd: true,
                  },
                },
              ]);

          // We should be focused on account entry input.
          if (cc) {
            assert.isTrue(
                isFocusInsideElement(
                    element.$.ccs.$.entry.$.input.$.input
                )
            );
          } else {
            assert.isTrue(
                isFocusInsideElement(
                    element.$.reviewers.$.entry.$.input.$.input
                )
            );
          }
        })
        .then(done);
  }

  test('cc confirmation', done => {
    testConfirmationDialog(done, true);
  });

  test('reviewer confirmation', done => {
    testConfirmationDialog(done, false);
  });

  test('_getStorageLocation', () => {
    const actual = element._getStorageLocation();
    assert.equal(actual.changeNum, changeNum);
    assert.equal(actual.patchNum, '@change');
    assert.equal(actual.path, '@change');
  });

  test('_reviewersMutated when account-text-change is fired from ccs', () => {
    flush();
    assert.isFalse(element._reviewersMutated);
    assert.isTrue(element.$.ccs.allowAnyInput);
    assert.isFalse(element.shadowRoot
        .querySelector('#reviewers').allowAnyInput);
    element.$.ccs.dispatchEvent(new CustomEvent('account-text-changed',
        {bubbles: true, composed: true}));
    assert.isTrue(element._reviewersMutated);
  });

  test('gets draft from storage on open', () => {
    const storedDraft = 'hello world';
    getDraftCommentStub.returns({message: storedDraft});
    element.open();
    assert.isTrue(getDraftCommentStub.called);
    assert.equal(element.draft, storedDraft);
  });

  test('gets draft from storage even when text is already present', () => {
    const storedDraft = 'hello world';
    getDraftCommentStub.returns({message: storedDraft});
    element.draft = 'foo bar';
    element.open();
    assert.isTrue(getDraftCommentStub.called);
    assert.equal(element.draft, storedDraft);
  });

  test('blank if no stored draft', () => {
    getDraftCommentStub.returns(null);
    element.draft = 'foo bar';
    element.open();
    assert.isTrue(getDraftCommentStub.called);
    assert.equal(element.draft, '');
  });

  test('does not check stored draft when quote is present', () => {
    const storedDraft = 'hello world';
    const quote = '> foo bar';
    getDraftCommentStub.returns({message: storedDraft});
    element.quote = quote;
    element.open();
    assert.isFalse(getDraftCommentStub.called);
    assert.equal(element.draft, quote);
    assert.isNotOk(element.quote);
  });

  test('updates stored draft on edits', () => {
    const firstEdit = 'hello';
    const location = element._getStorageLocation();

    element.draft = firstEdit;
    element.flushDebouncer('store');

    assert.isTrue(setDraftCommentStub.calledWith(location, firstEdit));

    element.draft = '';
    element.flushDebouncer('store');

    assert.isTrue(eraseDraftCommentStub.calledWith(location));
  });

  test('400 converts to human-readable server-error', done => {
    stubRestApi('saveChangeReview').callsFake(
        (changeNum, patchNum, review, errFn) => {
          errFn(cloneableResponse(
              400,
              '....{"reviewers":{"id1":{"error":"human readable"}}}'
          ));
          return Promise.resolve(undefined);
        }
    );

    const listener = event => {
      if (event.target !== document) return;
      event.detail.response.text().then(body => {
        if (body === 'human readable') {
          done();
        }
      });
    };
    addListenerForTest(document, 'server-error', listener);

    flush(() => { element.send(); });
  });

  test('non-json 400 is treated as a normal server-error', done => {
    stubRestApi('saveChangeReview').callsFake(
        (changeNum, patchNum, review, errFn) => {
          errFn(cloneableResponse(400, 'Comment validation error!'));
          return Promise.resolve(undefined);
        }
    );

    const listener = event => {
      if (event.target !== document) return;
      event.detail.response.text().then(body => {
        if (body === 'Comment validation error!') {
          done();
        }
      });
    };
    addListenerForTest(document, 'server-error', listener);

    // Async tick is needed because iron-selector content is distributed and
    // distributed content requires an observer to be set up.
    flush(() => { element.send(); });
  });

  test('filterReviewerSuggestion', () => {
    const owner = makeAccount();
    const reviewer1 = makeAccount();
    const reviewer2 = makeGroup();
    const cc1 = makeAccount();
    const cc2 = makeGroup();
    let filter = element._filterReviewerSuggestionGenerator(false);

    element._owner = owner;
    element._reviewers = [reviewer1, reviewer2];
    element._ccs = [cc1, cc2];

    assert.isTrue(filter({account: makeAccount()}));
    assert.isTrue(filter({group: makeGroup()}));

    // Owner should be excluded.
    assert.isFalse(filter({account: owner}));

    // Existing and pending reviewers should be excluded when isCC = false.
    assert.isFalse(filter({account: reviewer1}));
    assert.isFalse(filter({group: reviewer2}));

    filter = element._filterReviewerSuggestionGenerator(true);

    // Existing and pending CCs should be excluded when isCC = true;.
    assert.isFalse(filter({account: cc1}));
    assert.isFalse(filter({group: cc2}));
  });

  test('_focusOn', () => {
    sinon.spy(element, '_chooseFocusTarget');
    flush();
    const textareaStub = sinon.stub(element.$.textarea, 'async');
    const reviewerEntryStub = sinon.stub(element.$.reviewers.focusStart,
        'async');
    const ccStub = sinon.stub(element.$.ccs.focusStart, 'async');
    element._focusOn();
    assert.equal(element._chooseFocusTarget.callCount, 1);
    assert.deepEqual(textareaStub.callCount, 1);
    assert.deepEqual(reviewerEntryStub.callCount, 0);
    assert.deepEqual(ccStub.callCount, 0);

    element._focusOn(element.FocusTarget.ANY);
    assert.equal(element._chooseFocusTarget.callCount, 2);
    assert.deepEqual(textareaStub.callCount, 2);
    assert.deepEqual(reviewerEntryStub.callCount, 0);
    assert.deepEqual(ccStub.callCount, 0);

    element._focusOn(element.FocusTarget.BODY);
    assert.equal(element._chooseFocusTarget.callCount, 2);
    assert.deepEqual(textareaStub.callCount, 3);
    assert.deepEqual(reviewerEntryStub.callCount, 0);
    assert.deepEqual(ccStub.callCount, 0);

    element._focusOn(element.FocusTarget.REVIEWERS);
    assert.equal(element._chooseFocusTarget.callCount, 2);
    assert.deepEqual(textareaStub.callCount, 3);
    assert.deepEqual(reviewerEntryStub.callCount, 1);
    assert.deepEqual(ccStub.callCount, 0);

    element._focusOn(element.FocusTarget.CCS);
    assert.equal(element._chooseFocusTarget.callCount, 2);
    assert.deepEqual(textareaStub.callCount, 3);
    assert.deepEqual(reviewerEntryStub.callCount, 1);
    assert.deepEqual(ccStub.callCount, 1);
  });

  test('_chooseFocusTarget', () => {
    element._account = undefined;
    assert.strictEqual(
        element._chooseFocusTarget(), element.FocusTarget.BODY);

    element._account = {_account_id: 1};
    assert.strictEqual(
        element._chooseFocusTarget(), element.FocusTarget.BODY);

    element.change.owner = {_account_id: 2};
    assert.strictEqual(
        element._chooseFocusTarget(), element.FocusTarget.BODY);

    element.change.owner._account_id = 1;
    element.change._reviewers = null;
    assert.strictEqual(
        element._chooseFocusTarget(), element.FocusTarget.REVIEWERS);

    element._reviewers = [];
    assert.strictEqual(
        element._chooseFocusTarget(), element.FocusTarget.REVIEWERS);

    element._reviewers.push({});
    assert.strictEqual(
        element._chooseFocusTarget(), element.FocusTarget.BODY);
  });

  test('only send labels that have changed', done => {
    flush(() => {
      stubSaveReview(review => {
        assert.deepEqual(review.labels, {
          'Code-Review': 0,
          'Verified': -1,
        });
      });

      element.addEventListener('send', () => {
        done();
      });
      // Without wrapping this test in flush(), the below two calls to
      // MockInteractions.tap() cause a race in some situations in shadow DOM.
      // The send button can be tapped before the others, causing the test to
      // fail.

      element.shadowRoot
          .querySelector('gr-label-scores').shadowRoot
          .querySelector(
              'gr-label-score-row[name="Verified"]')
          .setSelectedValue(-1);
      MockInteractions.tap(element.shadowRoot
          .querySelector('.send'));
    });
  });

  test('_processReviewerChange', () => {
    const mockIndexSplices = function(toRemove) {
      return [{
        removed: [toRemove],
      }];
    };

    element._processReviewerChange(
        mockIndexSplices(makeAccount()), 'REVIEWER');
    assert.equal(element._reviewersPendingRemove.REVIEWER.length, 1);
  });

  test('_purgeReviewersPendingRemove', () => {
    const removeStub = sinon.stub(element, '_removeAccount');
    const mock = function() {
      element._reviewersPendingRemove = {
        CC: [makeAccount()],
        REVIEWER: [makeAccount(), makeAccount()],
      };
    };
    const checkObjEmpty = function(obj) {
      for (const prop of Object.keys(obj)) {
        if (obj[prop].length) { return false; }
      }
      return true;
    };
    mock();
    element._purgeReviewersPendingRemove(true); // Cancel
    assert.isFalse(removeStub.called);
    assert.isTrue(checkObjEmpty(element._reviewersPendingRemove));

    mock();
    element._purgeReviewersPendingRemove(false); // Submit
    assert.isTrue(removeStub.called);
    assert.isTrue(checkObjEmpty(element._reviewersPendingRemove));
  });

  test('_removeAccount', done => {
    stubRestApi('removeChangeReviewer')
        .returns(Promise.resolve({ok: true}));
    const arr = [makeAccount(), makeAccount()];
    element.change.reviewers = {
      REVIEWER: arr.slice(),
    };

    element._removeAccount(arr[1], 'REVIEWER').then(() => {
      assert.equal(element.change.reviewers.REVIEWER.length, 1);
      assert.deepEqual(element.change.reviewers.REVIEWER, arr.slice(0, 1));
      done();
    });
  });

  test('moving from cc to reviewer', () => {
    element._reviewersPendingRemove = {
      CC: [],
      REVIEWER: [],
    };
    flush();

    const reviewer1 = makeAccount();
    const reviewer2 = makeAccount();
    const reviewer3 = makeAccount();
    const cc1 = makeAccount();
    const cc2 = makeAccount();
    const cc3 = makeAccount();
    const cc4 = makeAccount();
    element._reviewers = [reviewer1, reviewer2, reviewer3];
    element._ccs = [cc1, cc2, cc3, cc4];
    element.push('_reviewers', cc1);
    flush();

    assert.deepEqual(element._reviewers,
        [reviewer1, reviewer2, reviewer3, cc1]);
    assert.deepEqual(element._ccs, [cc2, cc3, cc4]);
    assert.deepEqual(element._reviewersPendingRemove.CC, [cc1]);

    element.push('_reviewers', cc4, cc3);
    flush();

    assert.deepEqual(element._reviewers,
        [reviewer1, reviewer2, reviewer3, cc1, cc4, cc3]);
    assert.deepEqual(element._ccs, [cc2]);
    assert.deepEqual(element._reviewersPendingRemove.CC, [cc1, cc4, cc3]);
  });

  test('update attention section when reviewers and ccs change', () => {
    element._account = makeAccount();
    element._reviewers = [makeAccount(), makeAccount()];
    element._ccs = [makeAccount(), makeAccount()];
    element.draftCommentThreads = [];
    const modifyButton =
        element.shadowRoot.querySelector('.edit-attention-button');
    MockInteractions.tap(modifyButton);
    flush();

    // "Modify" button disabled, because "Send" button is disabled.
    assert.isFalse(element._attentionExpanded);
    element.draft = 'a test comment';
    MockInteractions.tap(modifyButton);
    flush();
    assert.isTrue(element._attentionExpanded);

    let accountLabels = Array.from(element.shadowRoot.querySelectorAll(
        '.attention-detail gr-account-label'));
    assert.equal(accountLabels.length, 5);

    element.push('_reviewers', makeAccount());
    element.push('_ccs', makeAccount());
    flush();

    // The 'attention modified' section collapses and resets when reviewers or
    // ccs change.
    assert.isFalse(element._attentionExpanded);

    MockInteractions.tap(
        element.shadowRoot.querySelector('.edit-attention-button'));
    flush();

    assert.isTrue(element._attentionExpanded);
    accountLabels = Array.from(element.shadowRoot.querySelectorAll(
        '.attention-detail gr-account-label'));
    assert.equal(accountLabels.length, 7);

    element.pop('_reviewers', makeAccount());
    element.pop('_reviewers', makeAccount());
    element.pop('_ccs', makeAccount());
    element.pop('_ccs', makeAccount());

    MockInteractions.tap(
        element.shadowRoot.querySelector('.edit-attention-button'));
    flush();

    accountLabels = Array.from(element.shadowRoot.querySelectorAll(
        '.attention-detail gr-account-label'));
    assert.equal(accountLabels.length, 3);
  });

  test('moving from reviewer to cc', () => {
    element._reviewersPendingRemove = {
      CC: [],
      REVIEWER: [],
    };
    flush();

    const reviewer1 = makeAccount();
    const reviewer2 = makeAccount();
    const reviewer3 = makeAccount();
    const cc1 = makeAccount();
    const cc2 = makeAccount();
    const cc3 = makeAccount();
    const cc4 = makeAccount();
    element._reviewers = [reviewer1, reviewer2, reviewer3];
    element._ccs = [cc1, cc2, cc3, cc4];
    element.push('_ccs', reviewer1);
    flush();

    assert.deepEqual(element._reviewers,
        [reviewer2, reviewer3]);
    assert.deepEqual(element._ccs, [cc1, cc2, cc3, cc4, reviewer1]);
    assert.deepEqual(element._reviewersPendingRemove.REVIEWER, [reviewer1]);

    element.push('_ccs', reviewer3, reviewer2);
    flush();

    assert.deepEqual(element._reviewers, []);
    assert.deepEqual(element._ccs,
        [cc1, cc2, cc3, cc4, reviewer1, reviewer3, reviewer2]);
    assert.deepEqual(element._reviewersPendingRemove.REVIEWER,
        [reviewer1, reviewer3, reviewer2]);
  });

  test('migrate reviewers between states', async () => {
    element._reviewersPendingRemove = {
      CC: [],
      REVIEWER: [],
    };
    flush();
    const reviewers = element.$.reviewers;
    const ccs = element.$.ccs;
    const reviewer1 = makeAccount();
    const reviewer2 = makeAccount();
    const cc1 = makeAccount();
    const cc2 = makeAccount();
    const cc3 = makeAccount();
    element._reviewers = [reviewer1, reviewer2];
    element._ccs = [cc1, cc2, cc3];

    const mutations = [];

    stubSaveReview(review => mutations.push(...review.reviewers));

    sinon.stub(element, '_removeAccount').callsFake((account, type) => {
      mutations.push({state: 'REMOVED', account});
      return Promise.resolve();
    });

    // Remove and add to other field.
    reviewers.dispatchEvent(
        new CustomEvent('remove', {
          detail: {account: reviewer1},
          composed: true, bubbles: true,
        }));
    ccs.$.entry.dispatchEvent(
        new CustomEvent('add', {
          detail: {value: {account: reviewer1}},
          composed: true, bubbles: true,
        }));
    ccs.dispatchEvent(
        new CustomEvent('remove', {
          detail: {account: cc1},
          composed: true, bubbles: true,
        }));
    ccs.dispatchEvent(
        new CustomEvent('remove', {
          detail: {account: cc3},
          composed: true, bubbles: true,
        }));
    reviewers.$.entry.dispatchEvent(
        new CustomEvent('add', {
          detail: {value: {account: cc1}},
          composed: true, bubbles: true,
        }));

    // Add to other field without removing from former field.
    // (Currently not possible in UI, but this is a good consistency check).
    reviewers.$.entry.dispatchEvent(
        new CustomEvent('add', {
          detail: {value: {account: cc2}},
          composed: true, bubbles: true,
        }));
    ccs.$.entry.dispatchEvent(
        new CustomEvent('add', {
          detail: {value: {account: reviewer2}},
          composed: true, bubbles: true,
        }));
    const mapReviewer = function(reviewer, opt_state) {
      const result = {reviewer: reviewer._account_id};
      if (opt_state) {
        result.state = opt_state;
      }
      return result;
    };

    // Send and purge and verify moves, delete cc3.
    await element.send()
        .then(keepReviewers =>
          element._purgeReviewersPendingRemove(false, keepReviewers));
    expect(mutations).to.have.lengthOf(5);
    expect(mutations[0]).to.deep.equal(mapReviewer(cc1));
    expect(mutations[1]).to.deep.equal(mapReviewer(cc2));
    expect(mutations[2]).to.deep.equal(mapReviewer(reviewer1, 'CC'));
    expect(mutations[3]).to.deep.equal(mapReviewer(reviewer2, 'CC'));
    expect(mutations[4]).to.deep.equal({account: cc3, state: 'REMOVED'});
  });

  test('emits cancel on esc key', () => {
    const cancelHandler = sinon.spy();
    element.addEventListener('cancel', cancelHandler);
    MockInteractions.pressAndReleaseKeyOn(element, 27, null, 'esc');
    flush();

    assert.isTrue(cancelHandler.called);
  });

  test('should not send on enter key', () => {
    stubSaveReview(() => undefined);
    element.addEventListener('send', () => assert.fail('wrongly called'));
    MockInteractions.pressAndReleaseKeyOn(element, 13, null, 'enter');
    flush();
  });

  test('emit send on ctrl+enter key', done => {
    stubSaveReview(() => undefined);
    element.addEventListener('send', () => done());
    MockInteractions.pressAndReleaseKeyOn(element, 13, 'ctrl', 'enter');
    flush();
  });

  test('_computeMessagePlaceholder', () => {
    assert.equal(
        element._computeMessagePlaceholder(false),
        'Say something nice...');
    assert.equal(
        element._computeMessagePlaceholder(true),
        'Add a note for your reviewers...');
  });

  test('_computeSendButtonLabel', () => {
    assert.equal(
        element._computeSendButtonLabel(false),
        'Send');
    assert.equal(
        element._computeSendButtonLabel(true),
        'Send and Start review');
  });

  test('_handle400Error reviewers and CCs', done => {
    const error1 = 'error 1';
    const error2 = 'error 2';
    const error3 = 'error 3';
    const text = ')]}\'' + JSON.stringify({
      reviewers: {
        username1: {
          input: 'username1',
          error: error1,
        },
        username2: {
          input: 'username2',
          error: error2,
        },
        username3: {
          input: 'username3',
          error: error3,
        },
      },
    });
    const listener = e => {
      e.detail.response.text().then(text => {
        assert.equal(text, [error1, error2, error3].join(', '));
        done();
      });
    };
    addListenerForTest(document, 'server-error', listener);
    element._handle400Error(cloneableResponse(400, text));
  });

  test('fires height change when the drafts comments load', done => {
    // Flush DOM operations before binding to the autogrow event so we don't
    // catch the events fired from the initial layout.
    flush(() => {
      const autoGrowHandler = sinon.stub();
      element.addEventListener('autogrow', autoGrowHandler);
      element.draftCommentThreads = [];
      flush(() => {
        assert.isTrue(autoGrowHandler.called);
        done();
      });
    });
  });

  suite('start review and save buttons', () => {
    let sendStub;

    setup(() => {
      sendStub = sinon.stub(element, 'send').callsFake(() => Promise.resolve());
      element.canBeStarted = true;
      // Flush to make both Start/Save buttons appear in DOM.
      flush();
    });

    test('start review sets ready', () => {
      MockInteractions.tap(element.shadowRoot
          .querySelector('.send'));
      flush();
      assert.isTrue(sendStub.calledWith(true, true));
    });

    test('save review doesn\'t set ready', () => {
      MockInteractions.tap(element.shadowRoot
          .querySelector('.save'));
      flush();
      assert.isTrue(sendStub.calledWith(true, false));
    });
  });

  test('buttons disabled until all API calls are resolved', () => {
    stubSaveReview(review => {
      return {ready: true};
    });
    return element.send(true, true).then(() => {
      assert.isFalse(element.disabled);
    });
  });

  suite('error handling', () => {
    const expectedDraft = 'draft';
    const expectedError = new Error('test');

    setup(() => {
      element.draft = expectedDraft;
    });

    function assertDialogOpenAndEnabled() {
      assert.strictEqual(expectedDraft, element.draft);
      assert.isFalse(element.disabled);
    }

    test('error occurs in _saveReview', () => {
      stubSaveReview(review => {
        throw expectedError;
      });
      return element.send(true, true).catch(err => {
        assert.strictEqual(expectedError, err);
        assertDialogOpenAndEnabled();
      });
    });

    suite('pending diff drafts?', () => {
      test('yes', async () => {
        const promise = mockPromise();
        const refreshSpy = sinon.spy();
        element.addEventListener('comment-refresh', refreshSpy);
        stubRestApi('hasPendingDiffDrafts').returns(true);
        stubRestApi('awaitPendingDiffDrafts').returns(promise);

        element.open();

        assert.isFalse(refreshSpy.called);
        assert.isTrue(element._savingComments);

        promise.resolve();
        await flush();

        assert.isTrue(refreshSpy.called);
        assert.isFalse(element._savingComments);
      });

      test('no', () => {
        stubRestApi('hasPendingDiffDrafts').returns(false);
        element.open();
        assert.isFalse(element._savingComments);
      });
    });
  });

  test('_computeSendButtonDisabled_canBeStarted', () => {
    // Mock canBeStarted
    assert.isFalse(element._computeSendButtonDisabled(
        /* canBeStarted= */ true,
        /* draftCommentThreads= */ [],
        /* text= */ '',
        /* reviewersMutated= */ false,
        /* labelsChanged= */ false,
        /* includeComments= */ false,
        /* disabled= */ false,
        /* commentEditing= */ false,
        /* change= */ element.change,
        /* account= */ makeAccount()
    ));
  });

  test('_computeSendButtonDisabled_allFalse', () => {
    // Mock everything false
    assert.isTrue(element._computeSendButtonDisabled(
        /* canBeStarted= */ false,
        /* draftCommentThreads= */ [],
        /* text= */ '',
        /* reviewersMutated= */ false,
        /* labelsChanged= */ false,
        /* includeComments= */ false,
        /* disabled= */ false,
        /* commentEditing= */ false,
        /* change= */ element.change,
        /* account= */ makeAccount()
    ));
  });

  test('_computeSendButtonDisabled_draftCommentsSend', () => {
    // Mock nonempty comment draft array, with sending comments.
    assert.isFalse(element._computeSendButtonDisabled(
        /* canBeStarted= */ false,
        /* draftCommentThreads= */ [{comments: [{__draft: true}]}],
        /* text= */ '',
        /* reviewersMutated= */ false,
        /* labelsChanged= */ false,
        /* includeComments= */ true,
        /* disabled= */ false,
        /* commentEditing= */ false,
        /* change= */ element.change,
        /* account= */ makeAccount()
    ));
  });

  test('_computeSendButtonDisabled_draftCommentsDoNotSend', () => {
    // Mock nonempty comment draft array, without sending comments.
    assert.isTrue(element._computeSendButtonDisabled(
        /* canBeStarted= */ false,
        /* draftCommentThreads= */ [{comments: [{__draft: true}]}],
        /* text= */ '',
        /* reviewersMutated= */ false,
        /* labelsChanged= */ false,
        /* includeComments= */ false,
        /* disabled= */ false,
        /* commentEditing= */ false,
        /* change= */ element.change,
        /* account= */ makeAccount()
    ));
  });

  test('_computeSendButtonDisabled_changeMessage', () => {
    // Mock nonempty change message.
    assert.isFalse(element._computeSendButtonDisabled(
        /* canBeStarted= */ false,
        /* draftCommentThreads= */ {},
        /* text= */ 'test',
        /* reviewersMutated= */ false,
        /* labelsChanged= */ false,
        /* includeComments= */ false,
        /* disabled= */ false,
        /* commentEditing= */ false,
        /* change= */ element.change,
        /* account= */ makeAccount()
    ));
  });

  test('_computeSendButtonDisabled_reviewersChanged', () => {
    // Mock reviewers mutated.
    assert.isFalse(element._computeSendButtonDisabled(
        /* canBeStarted= */ false,
        /* draftCommentThreads= */ {},
        /* text= */ '',
        /* reviewersMutated= */ true,
        /* labelsChanged= */ false,
        /* includeComments= */ false,
        /* disabled= */ false,
        /* commentEditing= */ false,
        /* change= */ element.change,
        /* account= */ makeAccount()
    ));
  });

  test('_computeSendButtonDisabled_labelsChanged', () => {
    // Mock labels changed.
    assert.isFalse(element._computeSendButtonDisabled(
        /* canBeStarted= */ false,
        /* draftCommentThreads= */ {},
        /* text= */ '',
        /* reviewersMutated= */ false,
        /* labelsChanged= */ true,
        /* includeComments= */ false,
        /* disabled= */ false,
        /* commentEditing= */ false,
        /* change= */ element.change,
        /* account= */ makeAccount()
    ));
  });

  test('_computeSendButtonDisabled_dialogDisabled', () => {
    // Whole dialog is disabled.
    assert.isTrue(element._computeSendButtonDisabled(
        /* canBeStarted= */ false,
        /* draftCommentThreads= */ {},
        /* text= */ '',
        /* reviewersMutated= */ false,
        /* labelsChanged= */ true,
        /* includeComments= */ false,
        /* disabled= */ true,
        /* commentEditing= */ false,
        /* change= */ element.change,
        /* account= */ makeAccount()
    ));
  });

  test('_computeSendButtonDisabled_existingVote', async () => {
    const account = createAccountWithId();
    element.change.labels[CODE_REVIEW].all = [account];
    await flush();

    // User has already voted.
    assert.isFalse(element._computeSendButtonDisabled(
        /* canBeStarted= */ false,
        /* draftCommentThreads= */ {},
        /* text= */ '',
        /* reviewersMutated= */ false,
        /* labelsChanged= */ false,
        /* includeComments= */ false,
        /* disabled= */ false,
        /* commentEditing= */ false,
        /* change= */ element.change,
        /* account= */ account
    ));
  });

  test('_submit blocked when no mutations exist', async () => {
    const sendStub = sinon.stub(element, 'send').returns(Promise.resolve());
    // Stub the below function to avoid side effects from the send promise
    // resolving.
    sinon.stub(element, '_purgeReviewersPendingRemove');
    element.account = makeAccount();
    element.draftCommentThreads = [];
    await flush();

    MockInteractions.tap(element.shadowRoot
        .querySelector('gr-button.send'));
    assert.isFalse(sendStub.called);

    element.draftCommentThreads = [{comments: [
      {__draft: true, path: 'test', line: 1, patch_set: 1},
    ]}];
    await flush();

    MockInteractions.tap(element.shadowRoot
        .querySelector('gr-button.send'));
    assert.isTrue(sendStub.called);
  });

  test('getFocusStops', async () => {
    // Setting draftCommentThreads to an empty object causes _sendDisabled to be
    // computed to false.
    element.draftCommentThreads = [];
    element.account = makeAccount();
    await flush();

    assert.equal(element.getFocusStops().end, element.$.cancelButton);
    element.draftCommentThreads = [
      {comments: [{__draft: true, path: 'test', line: 1, patch_set: 1}]},
    ];
    await flush();

    assert.equal(element.getFocusStops().end, element.$.sendButton);
  });

  test('setPluginMessage', () => {
    element.setPluginMessage('foo');
    assert.equal(element.$.pluginMessage.textContent, 'foo');
  });
});

