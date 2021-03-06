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
import {PluginApi} from '../../../api/plugin';
import {ChangeMetadataPluginApi} from '../../../api/change-metadata';
import {HookApi} from '../../../api/hook';
import {appContext} from '../../../services/app-context';

export class GrChangeMetadataApi implements ChangeMetadataPluginApi {
  private hook: HookApi | null;

  public plugin: PluginApi;

  private readonly reporting = appContext.reportingService;

  constructor(plugin: PluginApi) {
    this.plugin = plugin;
    this.hook = null;
    this.reporting.trackApi(this.plugin, 'metadata', 'constructor');
  }

  _createHook() {
    this.hook = this.plugin.hook('change-metadata-item');
  }

  onLabelsChanged(callback: (value: unknown) => void) {
    this.reporting.trackApi(this.plugin, 'metadata', 'onLabelsChanged');
    if (!this.hook) {
      this._createHook();
    }
    this.hook!.onAttached((element: Element) =>
      this.plugin.attributeHelper(element).bind('labels', callback)
    );
    return this;
  }
}
