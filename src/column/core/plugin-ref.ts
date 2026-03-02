import type ColumnsPlugin from "../../main";

let _plugin: ColumnsPlugin | null = null;

export function setPluginInstance(plugin: ColumnsPlugin | null): void {
	_plugin = plugin;
}

export function getPluginInstance(): ColumnsPlugin {
	if (!_plugin) throw new Error("Columns plugin not initialized");
	return _plugin;
}
