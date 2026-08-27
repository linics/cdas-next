import { register } from "node:module";

register(new URL("./server-only-loader.mjs", import.meta.url).href, import.meta.url);
