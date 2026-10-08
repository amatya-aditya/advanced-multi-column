// Minimal Chrome DevTools Protocol client for driving Obsidian's window.

export async function connect(port) {
	const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
	const page = targets.find((t) => t.type === "page" && t.url.startsWith("app://obsidian.md"));
	if (!page) throw new Error("Obsidian's window is not available on the debugging port");
	const ws = new WebSocket(page.webSocketDebuggerUrl);
	let id = 1;
	const pending = new Map();
	ws.onmessage = (e) => {
		const m = JSON.parse(e.data);
		pending.get(m.id)?.(m);
		pending.delete(m.id);
	};
	await new Promise((resolve, reject) => {
		ws.onopen = resolve;
		ws.onerror = reject;
	});
	const send = (method, params = {}) => new Promise((resolve) => {
		const i = id++;
		pending.set(i, resolve);
		ws.send(JSON.stringify({id: i, method, params}));
	});
	const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

	/** Evaluate an expression in the page (promises are awaited) and return its value. */
	const ev = async (expression) => {
		const res = await send("Runtime.evaluate", {expression, awaitPromise: true, returnByValue: true});
		if (res.result?.exceptionDetails) {
			const d = res.result.exceptionDetails;
			throw new Error(`page error: ${d.exception?.description ?? d.text}`);
		}
		return res.result?.result?.value;
	};
	/** Call a page-side helper: `call("name", ...args)` runs `window.__amcTest.name(...args)`. */
	const call = (name, ...args) => ev(`window.__amcTest.${name}(...${JSON.stringify(args)})`);

	const click = async ({x, y}, modifiers = 0) => {
		await send("Input.dispatchMouseEvent", {type: "mouseMoved", x, y});
		await send("Input.dispatchMouseEvent", {type: "mousePressed", x, y, button: "left", clickCount: 1, modifiers});
		await sleep(50);
		await send("Input.dispatchMouseEvent", {type: "mouseReleased", x, y, button: "left", clickCount: 1, modifiers});
	};
	const KEYS = {
		Escape: ["Escape", 27], Enter: ["Enter", 13],
		w: ["KeyW", 87], o: ["KeyO", 79], e: ["KeyE", 69],
	};
	/**
	 * Press a key; `mods`: 2 = Ctrl. Ctrl is pressed and released around the key
	 * as on a real keyboard: without its own key events, a freshly started
	 * Obsidian ignored the first Ctrl shortcut.
	 */
	const key = async (name, mods = 0) => {
		const [code, vk] = KEYS[name];
		const ctrl = (mods & 2) !== 0;
		if (ctrl) await send("Input.dispatchKeyEvent", {type: "rawKeyDown", key: "Control", code: "ControlLeft", windowsVirtualKeyCode: 17, modifiers: 2});
		await send("Input.dispatchKeyEvent", {type: "rawKeyDown", key: name, code, windowsVirtualKeyCode: vk, modifiers: mods});
		await send("Input.dispatchKeyEvent", {type: "keyUp", key: name, code, windowsVirtualKeyCode: vk, modifiers: mods});
		if (ctrl) await send("Input.dispatchKeyEvent", {type: "keyUp", key: "Control", code: "ControlLeft", windowsVirtualKeyCode: 17, modifiers: 0});
	};
	const type = (text) => send("Input.insertText", {text});
	/** Animation frames stop while the window is hidden; bring it to the front. */
	const front = () => send("Page.bringToFront");

	return {send, ev, call, click, key, type, front, sleep, close: () => ws.close()};
}
