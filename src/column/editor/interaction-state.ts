import type {EditorView} from "@codemirror/view";
import type {ActiveEditState, ActiveDragState} from "../core/widget-types";

/**
 * Per-EditorView interaction state for column widgets.
 * Replaces module-level globals to support multiple editor panes safely.
 */
export class ColumnInteractionState {
	activeEdit: ActiveEditState | null = null;
	activeDragState: ActiveDragState | null = null;
	activeDragPoint: {x: number; y: number} | null = null;
	cleanupActiveDragTracking: (() => void) | null = null;
	cursorDropIndicator: HTMLElement | null = null;
	resolvedDropPos: number | null = null;
	selectedColumns: Set<number> = new Set();
	selectionContainerEl: HTMLElement | null = null;
}

const stateMap = new WeakMap<EditorView, ColumnInteractionState>();

export function getInteractionState(view: EditorView): ColumnInteractionState {
	let state = stateMap.get(view);
	if (!state) {
		state = new ColumnInteractionState();
		stateMap.set(view, state);
	}
	return state;
}
