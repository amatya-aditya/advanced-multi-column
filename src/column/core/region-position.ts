import type {EditorView} from "@codemirror/view";
import type {ColumnRegion} from "./types";

type PositionResolver = () => void;

const resolvers = new WeakMap<ColumnRegion, PositionResolver>();

/**
 * Let a rendered block re-derive its region offsets from its own DOM. A
 * rendered widget can outlive the offsets it was built with (CodeMirror keeps
 * the DOM of an equal widget), so offsets are refreshed before every edit.
 */
export function bindRegionToDom(region: ColumnRegion, view: EditorView, dom: HTMLElement): void {
	resolvers.set(region, () => {
		if (!dom.isConnected) return;
		let pos: number;
		try {
			pos = view.posAtDOM(dom);
		} catch {
			return;
		}
		if (pos === region.from) return;
		const length = region.to - region.from;
		region.from = pos;
		region.to = pos + length;
	});
}

/** Bring `region.from`/`region.to` up to date with the live document. */
export function refreshRegionPosition(region: ColumnRegion): void {
	resolvers.get(region)?.();
}
