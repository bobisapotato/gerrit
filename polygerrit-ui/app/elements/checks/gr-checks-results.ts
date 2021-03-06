/**
 * @license
 * Copyright (C) 2020 The Android Open Source Project
 *
 * Licensed under the Apache License, Version 2.0 (the 'License');
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an 'AS IS' BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import {html} from 'lit-html';
import {
  css,
  customElement,
  internalProperty,
  property,
  PropertyValues,
  query,
} from 'lit-element';
import {GrLitElement} from '../lit/gr-lit-element';
import '@polymer/paper-tooltip/paper-tooltip';
import {
  Category,
  CheckRun,
  Link,
  LinkIcon,
  RunStatus,
  Tag,
} from '../../api/checks';
import {sharedStyles} from '../../styles/shared-styles';
import {RunResult} from '../../services/checks/checks-model';
import {
  allResults,
  hasCompletedWithoutResults,
  hasResultsOf,
  iconForCategory,
} from '../../services/checks/checks-util';
import {assertIsDefined} from '../../utils/common-util';
import {whenVisible} from '../../utils/dom-util';
import {durationString} from '../../utils/date-util';

@customElement('gr-result-row')
class GrResultRow extends GrLitElement {
  @property()
  result?: RunResult;

  @property()
  isExpanded = false;

  @property({type: Boolean, reflect: true})
  isExpandable = false;

  @property()
  shouldRender = false;

  static get styles() {
    return [
      sharedStyles,
      css`
        :host {
          display: contents;
        }
        :host([isexpandable]) {
          cursor: pointer;
        }
        tr {
          border-top: 1px solid var(--border-color);
        }
        iron-icon.launch {
          color: var(--link-color);
          margin-right: var(--spacing-s);
        }
        td.iconCol {
          padding-left: var(--spacing-l);
          padding-right: var(--spacing-m);
        }
        .iconCol div {
          width: 20px;
        }
        .nameCol div {
          width: 165px;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .summaryCol {
          /* Forces this column to get the remaining space that is left over by
             the other columns. */
          width: 99%;
        }
        .expanderCol div {
          width: 20px;
        }
        td {
          white-space: nowrap;
          padding: var(--spacing-s);
        }
        td .summary-cell {
          display: flex;
          max-width: calc(100vw - 700px);
        }
        td .summary-cell .summary {
          font-weight: var(--font-weight-bold);
          flex-shrink: 1;
          overflow: hidden;
          text-overflow: ellipsis;
          margin-right: var(--spacing-s);
        }
        td .summary-cell .message {
          flex-grow: 1;
          /* Looks a bit stupid, but the idea is that .message shrinks first,
             and only when that has shrunken to 0, then .summary should also
             start shrinking (substantially). */
          flex-shrink: 1000000;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        td .summary-cell .tags .tag {
          color: var(--deemphasized-text-color);
          display: inline-block;
          border-radius: 20px;
          background-color: var(--tag-background);
          padding: 0 var(--spacing-m);
          margin-left: var(--spacing-s);
        }
        td .summary-cell .label {
          color: var(--deemphasized-text-color);
          display: inline-block;
          border-radius: 20px;
          background-color: var(--label-background);
          padding: 0 var(--spacing-m);
          margin-left: var(--spacing-s);
        }
      `,
    ];
  }

  update(changedProperties: PropertyValues) {
    if (changedProperties.has('result')) {
      this.isExpandable = !!this.result?.summary && !!this.result?.message;
    }
    super.update(changedProperties);
  }

  firstUpdated() {
    const loading = this.shadowRoot?.querySelector('.container');
    assertIsDefined(loading, '"Loading" element');
    whenVisible(loading, () => this.setAttribute('shouldRender', 'true'), 200);
  }

  render() {
    if (!this.result) return '';
    if (!this.shouldRender) {
      return html`
        <tr class="container">
          <td class="iconCol"></td>
          <td class="nameCol">
            <div><span class="loading">Loading...</span></div>
          </td>
          <td class="summaryCol"></td>
          <td class="expanderCol"></td>
        </tr>
      `;
    }
    return html`
      <tr class="container" @click="${this.toggleExpanded}">
        <td class="iconCol">
          <div>${this.renderIcon()}</div>
        </td>
        <td class="nameCol">
          <div><span>${this.result.checkName}</span></div>
        </td>
        <td class="summaryCol">
          <div class="summary-cell">
            ${(this.result.links?.slice(0, 5) ?? []).map(this.renderLink)}
            ${this.renderSummary(this.result.summary)}
            <div class="message">
              ${this.isExpanded ? '' : this.result.message}
            </div>
            <div class="tags">
              ${(this.result.tags ?? []).map(t => this.renderTag(t))}
            </div>
            ${this.renderLabel()}
          </div>
          <gr-result-expanded
            .result="${this.result}"
            ?hidden="${!this.isExpanded}"
          ></gr-result-expanded>
        </td>
        <td class="expanderCol">
          <div
            class="show-hide"
            role="switch"
            tabindex="0"
            ?hidden="${!this.isExpandable}"
            ?aria-checked="${this.isExpanded}"
            aria-label="${this.isExpanded
              ? 'Collapse result row'
              : 'Expand result row'}"
            @keydown="${this.toggleExpanded}"
          >
            <iron-icon
              icon="${this.isExpanded
                ? 'gr-icons:expand-less'
                : 'gr-icons:expand-more'}"
            ></iron-icon>
          </div>
        </td>
      </tr>
    `;
  }

  private toggleExpanded() {
    if (!this.isExpandable) return;
    this.isExpanded = !this.isExpanded;
  }

  renderSummary(text?: string) {
    if (!text) return;
    return html`
      <!-- The &nbsp; is for being able to shrink a tiny amount without
       the text itself getting shrunk with an ellipsis. -->
      <div class="summary">${text}&nbsp;</div>
    `;
  }

  renderLink(link: Link) {
    const tooltipText = link.tooltip ?? 'Link to details';
    return html`
      <a href="${link.url}" target="_blank">
        <iron-icon
          aria-label="external link to details"
          class="launch"
          icon="gr-icons:launch"
        ></iron-icon>
        <paper-tooltip offset="5">${tooltipText}</paper-tooltip>
      </a>
    `;
  }

  renderIcon() {
    if (this.result?.status !== RunStatus.RUNNING) return;
    return html`<iron-icon icon="gr-icons:timelapse"></iron-icon>`;
  }

  renderLabel() {
    const label = this.result?.labelName;
    if (!label) return;
    return html`<div class="label">${label}</div>`;
  }

  renderTag(tag: Tag) {
    return html`<div class="tag">${tag.name}</div>`;
  }
}

@customElement('gr-result-expanded')
class GrResultExpanded extends GrLitElement {
  @property()
  result?: RunResult;

  static get styles() {
    return [
      sharedStyles,
      css`
        .message {
          padding: var(--spacing-m) var(--spacing-m) var(--spacing-m) 0;
        }
      `,
    ];
  }

  render() {
    if (!this.result) return '';
    return html`
      <gr-endpoint-decorator name="check-result-expanded">
        <gr-endpoint-param
          name="run"
          value="${this.result}"
        ></gr-endpoint-param>
        <gr-endpoint-param
          name="result"
          value="${this.result}"
        ></gr-endpoint-param>
        <div class="message">
          ${this.result.message}
        </div>
      </gr-endpoint-decorator>
    `;
  }
}

@customElement('gr-checks-results')
export class GrChecksResults extends GrLitElement {
  @query('#filterInput')
  filterInput?: HTMLInputElement;

  @internalProperty()
  filterRegExp = new RegExp('');

  @property()
  runs: CheckRun[] = [];

  /**
   * This is the current state of whether a section is expanded or not. As long
   * as isSectionExpandedByUser is false this will be computed by a default rule
   * on every render.
   */
  private isSectionExpanded = new Map<Category | 'SUCCESS', boolean>();

  /**
   * Keeps track of whether the user intentionally changed the expansion state.
   * Once this is true the default rule for showing a section expanded or not
   * is not applied anymore.
   */
  private isSectionExpandedByUser = new Map<Category | 'SUCCESS', boolean>();

  static get styles() {
    return [
      sharedStyles,
      css`
        :host {
          display: block;
          padding: var(--spacing-xl);
        }
        input#filterInput {
          margin-top: var(--spacing-s);
          padding: var(--spacing-s) var(--spacing-m);
          min-width: 400px;
        }
        .categoryHeader {
          margin-top: var(--spacing-l);
          margin-left: var(--spacing-l);
          cursor: default;
        }
        .categoryHeader .title {
          text-transform: capitalize;
        }
        .categoryHeader .expandIcon {
          width: var(--line-height-h3);
          height: var(--line-height-h3);
          margin-right: var(--spacing-s);
        }
        .categoryHeader .statusIcon {
          position: relative;
          top: 2px;
        }
        .categoryHeader .statusIcon.error {
          color: var(--error-foreground);
        }
        .categoryHeader .statusIcon.warning {
          color: var(--warning-foreground);
        }
        .categoryHeader .statusIcon.info {
          color: var(--info-foreground);
        }
        .categoryHeader .statusIcon.success {
          color: var(--success-foreground);
        }
        .collapsed .noResultsMessage,
        .collapsed table {
          display: none;
        }
        .collapsed {
          border-bottom: 1px solid var(--border-color);
          padding-bottom: var(--spacing-m);
        }
        .noResultsMessage {
          width: 100%;
          max-width: 1280px;
          margin-top: var(--spacing-m);
          background-color: var(--background-color-primary);
          box-shadow: var(--elevation-level-1);
          padding: var(--spacing-s)
            calc(20px + var(--spacing-l) + var(--spacing-m) + var(--spacing-s));
        }
        table.resultsTable {
          width: 100%;
          max-width: 1280px;
          margin-top: var(--spacing-m);
          background-color: var(--background-color-primary);
          box-shadow: var(--elevation-level-1);
        }
        tr.headerRow th {
          text-align: left;
          font-weight: var(--font-weight-bold);
          padding: var(--spacing-s);
        }
      `,
    ];
  }

  render() {
    return html`
      <div><h2 class="heading-2">Results</h2></div>
      ${this.renderFilter()} ${this.renderSection(Category.ERROR)}
      ${this.renderSection(Category.WARNING)}
      ${this.renderSection(Category.INFO)} ${this.renderSection('SUCCESS')}
    `;
  }

  renderFilter() {
    if (allResults(this.runs).length <= 3) {
      if (this.filterRegExp.source.length > 0) {
        this.filterRegExp = new RegExp('');
      }
      return;
    }
    return html`
      <input
        id="filterInput"
        type="text"
        placeholder="Filter results by regular expression"
        @input="${this.onInput}"
      />
    `;
  }

  onInput() {
    assertIsDefined(this.filterInput, 'filter <input> element');
    this.filterRegExp = new RegExp(this.filterInput.value, 'i');
  }

  renderSection(category: Category | 'SUCCESS') {
    const catString = category.toString().toLowerCase();
    let runs = this.runs;
    if (category === 'SUCCESS') {
      runs = runs.filter(hasCompletedWithoutResults);
    } else {
      runs = runs.filter(r => hasResultsOf(r, category));
    }
    const all = runs.reduce((allResults: RunResult[], run) => {
      return [...allResults, ...this.computeRunResults(category, run)];
    }, []);
    const filtered = all.filter(
      result =>
        this.filterRegExp.test(result.checkName) ||
        this.filterRegExp.test(result.summary)
    );
    let expanded = this.isSectionExpanded.get(category);
    const expandedByUser = this.isSectionExpandedByUser.get(category) ?? false;
    if (!expandedByUser || expanded === undefined) {
      expanded = all.length > 0;
      this.isSectionExpanded.set(category, expanded);
    }
    const expandedClass = expanded ? 'expanded' : 'collapsed';
    const icon = expanded ? 'gr-icons:expand-less' : 'gr-icons:expand-more';
    return html`
      <div class="${expandedClass}">
        <h3
          class="categoryHeader heading-3"
          @click="${() => this.toggleExpanded(category)}"
        >
          <iron-icon class="expandIcon" icon="${icon}"></iron-icon>
          <iron-icon
            icon="gr-icons:${iconForCategory(category)}"
            class="statusIcon ${catString}"
          ></iron-icon>
          <span class="title">${catString}</span>
          <span class="count">${this.renderCount(all, filtered)}</span>
        </h3>
        ${this.renderResults(all, filtered)}
      </div>
    `;
  }

  renderResults(all: RunResult[], filtered: RunResult[]) {
    if (all.length === 0) {
      return html`<div class="noResultsMessage">No results</div>`;
    }
    if (filtered.length === 0) {
      return html`
        <div class="noResultsMessage">
          None of the results match the filter.
        </div>
      `;
    }
    return html`
      <table class="resultsTable">
        <thead>
          <tr class="headerRow">
            <th class="iconCol"></th>
            <th class="nameCol">Run</th>
            <th class="summaryCol">Summary</th>
            <th class="expanderCol"></th>
          </tr>
        </thead>
        <tbody>
          ${filtered.map(
            result => html`<gr-result-row .result="${result}"></gr-result-row>`
          )}
        </tbody>
      </table>
    `;
  }

  renderCount(all: RunResult[], filtered: RunResult[]) {
    if (all.length === filtered.length) {
      return html`(${all.length})`;
    } else {
      return html`(${filtered.length} of ${all.length})`;
    }
  }

  toggleExpanded(category: Category | 'SUCCESS') {
    const expanded = this.isSectionExpanded.get(category);
    assertIsDefined(expanded, 'expanded must have been set in initial render');
    this.isSectionExpanded.set(category, !expanded);
    this.isSectionExpandedByUser.set(category, true);
    this.requestUpdate();
  }

  computeRunResults(category: Category | 'SUCCESS', run: CheckRun) {
    if (category === 'SUCCESS') return [this.computeSuccessfulRunResult(run)];
    return (
      run.results
        ?.filter(result => result.category === category)
        .map(result => {
          return {...run, ...result};
        }) ?? []
    );
  }

  computeSuccessfulRunResult(run: CheckRun): RunResult {
    const adaptedRun: RunResult = {
      category: Category.INFO, // will not be used, but is required
      summary: run.statusDescription ?? '',
      ...run,
    };
    if (!run.statusDescription) {
      const start = run.scheduledTimestamp ?? run.startedTimestamp;
      const end = run.finishedTimestamp;
      let duration = '';
      if (start && end) {
        duration = ` in ${durationString(start, end, true)}`;
      }
      adaptedRun.message = `Completed without results${duration}.`;
    }
    if (run.statusLink) {
      adaptedRun.links = [
        {
          url: run.statusLink,
          primary: true,
          icon: LinkIcon.EXTERNAL,
        },
      ];
    }
    return adaptedRun;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'gr-result-row': GrResultRow;
    'gr-result-expanded': GrResultExpanded;
    'gr-checks-results': GrChecksResults;
  }
}
