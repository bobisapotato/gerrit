/**
 * @license
 * Copyright (C) 2018 The Android Open Source Project
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
import './gr-change-requirements.js';
import {isHidden} from '../../../test/test-utils.js';

const basicFixture = fixtureFromElement('gr-change-requirements');

suite('gr-change-metadata tests', () => {
  let element;

  setup(() => {
    element = basicFixture.instantiate();
  });

  test('requirements computed fields', () => {
    assert.isTrue(element._computeShowWip({work_in_progress: true}));
    assert.isFalse(element._computeShowWip({work_in_progress: false}));

    assert.equal(element._computeRequirementClass(true), 'approved');
    assert.equal(element._computeRequirementClass(false), '');

    assert.equal(element._computeRequirementIcon(true), 'gr-icons:check');
    assert.equal(element._computeRequirementIcon(false),
        'gr-icons:schedule');
  });

  test('label computed fields', () => {
    assert.equal(element._computeLabelIcon({approved: []}), 'gr-icons:check');
    assert.equal(element._computeLabelIcon({rejected: []}), 'gr-icons:close');
    assert.equal(element._computeLabelIcon({}), 'gr-icons:schedule');

    assert.equal(element._computeLabelClass({approved: []}), 'approved');
    assert.equal(element._computeLabelClass({rejected: []}), 'rejected');
    assert.equal(element._computeLabelClass({}), '');
    assert.equal(element._computeLabelClass({value: 0}), '');

    assert.equal(element._computeLabelValue(1), '+1');
    assert.equal(element._computeLabelValue(-1), '-1');
    assert.equal(element._computeLabelValue(0), '0');
  });

  test('_computeLabels', () => {
    assert.equal(element._optionalLabels.length, 0);
    assert.equal(element._requiredLabels.length, 0);
    element._computeLabels({base: {
      test: {
        all: [{_account_id: 1, name: 'bojack', value: 1}],
        default_value: 0,
        values: [],
        value: 1,
      },
      opt_test: {
        all: [{_account_id: 1, name: 'bojack', value: 1}],
        default_value: 0,
        values: [],
        optional: true,
      },
    }});
    assert.equal(element._optionalLabels.length, 1);
    assert.equal(element._requiredLabels.length, 1);

    assert.equal(element._optionalLabels[0].labelName, 'opt_test');
    assert.equal(element._optionalLabels[0].icon, 'gr-icons:schedule');
    assert.equal(element._optionalLabels[0].style, '');
    assert.ok(element._optionalLabels[0].labelInfo);
  });

  test('optional show/hide', () => {
    element._optionalLabels = [{label: 'test'}];
    flush();

    assert.ok(element.shadowRoot
        .querySelector('section.optional'));
    MockInteractions.tap(element.shadowRoot
        .querySelector('.showHide'));
    flush();

    assert.isFalse(element._showOptionalLabels);
    assert.isTrue(isHidden(element.shadowRoot
        .querySelector('section.optional')));
  });

  test('properly converts satisfied labels', () => {
    element.change = {
      status: 'NEW',
      labels: {
        Verified: {
          approved: [],
        },
      },
      requirements: [],
    };
    flush();

    assert.ok(element.shadowRoot
        .querySelector('.approved'));
    assert.ok(element.shadowRoot
        .querySelector('.name'));
    assert.equal(element.shadowRoot
        .querySelector('.name').text, 'Verified');
  });

  test('properly converts unsatisfied labels', () => {
    element.change = {
      status: 'NEW',
      labels: {
        Verified: {
          approved: false,
        },
      },
    };
    flush();

    const name = element.shadowRoot
        .querySelector('.name');
    assert.ok(name);
    assert.isFalse(name.hasAttribute('hidden'));
    assert.equal(name.text, 'Verified');
  });

  test('properly displays Work In Progress', () => {
    element.change = {
      status: 'NEW',
      labels: {},
      requirements: [],
      work_in_progress: true,
    };
    flush();

    const changeIsWip = element.shadowRoot
        .querySelector('.title');
    assert.ok(changeIsWip);
  });

  test('properly displays a satisfied requirement', () => {
    element.change = {
      status: 'NEW',
      labels: {},
      requirements: [{
        fallback_text: 'Resolve all comments',
        status: 'OK',
      }],
    };
    flush();

    const requirement = element.shadowRoot
        .querySelector('.requirement');
    assert.ok(requirement);
    assert.isFalse(requirement.hasAttribute('hidden'));
    assert.ok(requirement.querySelector('.approved'));
    assert.equal(requirement.querySelector('.name').text,
        'Resolve all comments');
  });

  test('satisfied class is applied with OK', () => {
    element.change = {
      status: 'NEW',
      labels: {},
      requirements: [{
        fallback_text: 'Resolve all comments',
        status: 'OK',
      }],
    };
    flush();

    const requirement = element.shadowRoot
        .querySelector('.requirement');
    assert.ok(requirement);
    assert.ok(requirement.querySelector('.approved'));
  });

  test('satisfied class is not applied with NOT_READY', () => {
    element.change = {
      status: 'NEW',
      labels: {},
      requirements: [{
        fallback_text: 'Resolve all comments',
        status: 'NOT_READY',
      }],
    };
    flush();

    const requirement = element.shadowRoot
        .querySelector('.requirement');
    assert.ok(requirement);
    assert.strictEqual(requirement.querySelector('.approved'), null);
  });

  test('satisfied class is not applied with RULE_ERROR', () => {
    element.change = {
      status: 'NEW',
      labels: {},
      requirements: [{
        fallback_text: 'Resolve all comments',
        status: 'RULE_ERROR',
      }],
    };
    flush();

    const requirement = element.shadowRoot
        .querySelector('.requirement');
    assert.ok(requirement);
    assert.strictEqual(requirement.querySelector('.approved'), null);
  });
});

