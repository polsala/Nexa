import {
  Univer,
  LogLevel,
  type IUniverConfig,
  type PluginCtor,
} from "@univerjs/core";
import { FUniver } from "@univerjs/core/lib/facade";
import type { UniverSheetsCorePreset } from "@univerjs/preset-sheets-core";

// The upstream umbrella package installs both OSS and proprietary presets.
// Register the explicitly selected OSS plugin collections without that package.
type Preset = ReturnType<typeof UniverSheetsCorePreset>;
export function createUniver({
  presets,
  ...config
}: IUniverConfig & { presets: Preset[] }) {
  const univer = new Univer({ logLevel: LogLevel.WARN, ...config });
  const plugins = new Map<string, { plugin: PluginCtor; options: unknown }>();
  for (const preset of presets) {
    for (const entry of preset.plugins) {
      const [plugin, options] = Array.isArray(entry)
        ? entry
        : [entry, undefined];
      plugins.delete(plugin.pluginName);
      plugins.set(plugin.pluginName, { plugin, options });
    }
  }
  for (const { plugin, options } of plugins.values())
    univer.registerPlugin(plugin, options);
  return { univer, univerAPI: FUniver.newAPI(univer) };
}
