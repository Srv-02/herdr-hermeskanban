// A stand-in for herdr's module in node --test (test/flows.test.js). exec goes to the test's fake machine; shared is a
// plain map the test can read.
const h = globalThis.__hkHerdr ??= { store: {}, exec: async () => ({ code: 0, stdout: "", stderr: "" }) };

export const exec = (...args) => h.exec(...args);
export const shared = (key) => h.store[key];
export const setShared = (key, value) => { h.store[key] = value; };
export const theme = () => new Proxy({}, { get: () => "#808080" });
export const notify = () => null;
export const closeOverlay = () => null;
export const checking = () => false;
export const appHome = () => "/nonexistent/herdr-app";
export const readTextFile = async () => null;
export const writeTextFile = async () => null;
